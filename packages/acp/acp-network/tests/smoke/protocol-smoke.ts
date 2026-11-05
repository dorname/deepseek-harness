/**
 * Protocol smoke for ACP-over-network.
 *
 * Supports two modes:
 *
 * 1. Local (default): boots a real dsh-acp-network server on a random loopback
 *    port with a mocked LLM, then drives it through the ACP SDK over WebSocket.
 *    The local composition also mounts the approval and permission-preset
 *    services and one probe tool for the `always` permission round-trip.
 * 2. Staging: connect to an existing server URL via `ACP_SMOKE_URL`. That
 *    target's composition is unknown, so the permission round-trip is skipped
 *    (reported by the caller, never as a pass).
 *
 * Environment variables:
 * - `ACP_SMOKE_URL`        — staging WebSocket URL (e.g. wss://dsh-acp-network.example/acp)
 * - `ACP_SMOKE_SECRET`     — shared HMAC secret (default: smoke-test-secret)
 * - `ACP_SMOKE_SUBJECT`    — token subject (default: smoke-test-subject)
 * - `ACP_SMOKE_AUDIENCE`   — token audience (default: dsh-acp-smoke)
 * - `ACP_SMOKE_STRICT`     — when "false", do not require `stopReason === 'end_turn'`
 * - `ACP_SMOKE_PHASE`      — "persist" or "resume" runs one half of the durable-session
 *   check so an orchestrator (smoke-staging.sh) can restart the server between the
 *   two invocations; "resume" reads the id from `ACP_SMOKE_SESSION_ID` or the file
 *   named by `ACP_SMOKE_SESSION_FILE`, and both phases use `ACP_SMOKE_CWD`
 *   (default /dsh-home/acp-smoke) as the stable session cwd
 *
 * Run from repo root:
 *   pnpm exec tsx packages/acp/acp-network/tests/smoke/protocol-smoke.ts
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { Context } from '@deepseek-ai/cordis'
import {
  client as createAcpClientApp,
  methods,
  PROTOCOL_VERSION,
  type AgentContext,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SendRequestOptions,
} from '@agentclientprotocol/sdk'
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import {
  LlmAdapter,
  ToolCallId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as AcpNetworkPlugin from '../../src/index.ts'
import { reportResult } from '../helpers/reporter.ts'

const STAGING_URL = process.env.ACP_SMOKE_URL
const SECRET = process.env.ACP_SMOKE_SECRET ?? 'smoke-test-secret'
const SUBJECT = process.env.ACP_SMOKE_SUBJECT ?? 'smoke-test-subject'
const AUDIENCE = process.env.ACP_SMOKE_AUDIENCE ?? 'dsh-acp-smoke'
const STRICT_STOP_REASON = (process.env.ACP_SMOKE_STRICT ?? 'true') === 'true'
const NO_PROMPT = (process.env.ACP_SMOKE_NO_PROMPT ?? 'false') === 'true'
const PHASE = process.env.ACP_SMOKE_PHASE
const PHASE_CWD = process.env.ACP_SMOKE_CWD ?? '/dsh-home/acp-smoke'
const SESSION_FILE = process.env.ACP_SMOKE_SESSION_FILE
const RESUME_SESSION_ID = process.env.ACP_SMOKE_SESSION_ID

class SmokeAdapter extends LlmAdapter {
  constructor(
    private readonly responses: Map<string, StreamChunk[]>,
    /**
     * Per-key FIFO of full responses consumed ahead of the static map, so one
     * key can drive a multi-step turn (tool call, tool call, final text).
     */
    private readonly scripted: Map<string, StreamChunk[][]> = new Map(),
    private readonly provider = 'mock-smoke',
  ) {
    super()
  }

  override providerInfo(provider: string) {
    if (provider !== this.provider) throw new Error(`unknown provider ${provider}`)
    return { id: this.provider, name: 'Smoke' }
  }

  override listModels(provider: string) {
    return Promise.resolve(provider === this.provider ? [{
      provider: this.provider,
      id: 'mock',
      name: 'Smoke',
      description: 'Smoke model.',
      inputModalities: ['text'] as const,
    }] : [])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: ['text'],
      context: { contextWindow: 1_024 },
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const userMessages = options.messages.filter(m => m.source?.kind === 'user')
    const last = userMessages.at(-1)
    const key = last?.content.map(c => c.type === 'text' ? c.text : '').join('').trim() ?? ''
    const queued = this.scripted.get(key)?.shift()
    const entry = queued ?? this.responses.get(key)
    if (entry === undefined) throw new Error(`SmokeAdapter: no script for "${key}"`)
    for (const chunk of entry) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(name: string, callId: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId(callId), name, argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(callId), name, arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

interface SmokeClient {
  initialize: (params: { protocolVersion: number }) => Promise<unknown>
  authenticate: (params: { methodId: string; _meta: { token: string } }) => Promise<unknown>
  newSession: (params: { cwd: string; mcpServers: [] }) => Promise<{ sessionId: string }>
  listSessions: (params: { cwd: string }) => Promise<{ sessions: Array<{ sessionId: string; cwd: string }> }>
  resumeSession: (params: { sessionId: string; cwd: string; mcpServers: [] }) => Promise<unknown>
  closeSession: (params: { sessionId: string }) => Promise<unknown>
  setSessionConfigOption: (params: { sessionId: string; configId: string; value: string }) => Promise<unknown>
  prompt: (params: PromptRequest, options?: SendRequestOptions) => Promise<PromptResponse>
}

async function makeClient(
  url: string,
  options: { answerPermission?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse> } = {},
): Promise<{ client: SmokeClient; dispose: () => Promise<void> }> {
  const token = AcpNetworkPlugin.signHmacToken(SECRET, SUBJECT, AUDIENCE)
  const clientApp = createAcpClientApp({ name: 'dsh-acp-network-smoke-client' })
  if (options.answerPermission !== undefined) {
    clientApp.onRequest(methods.client.session.requestPermission, ({ params }) => options.answerPermission!(params))
  }
  const stream = createWebSocketStream(url, { WebSocket })
  const connection = clientApp.connect(stream)
  const agent = connection.agent as AgentContext

  const client: SmokeClient = {
    initialize: async params => agent.request(methods.agent.initialize, params),
    authenticate: async params => agent.request(methods.agent.authenticate, params),
    newSession: params => agent.request(methods.agent.session.new, params),
    listSessions: params => agent.request(methods.agent.session.list, params),
    resumeSession: params => agent.request(methods.agent.session.resume, params),
    closeSession: params => agent.request(methods.agent.session.close, params),
    setSessionConfigOption: params => agent.request(methods.agent.session.setConfigOption, params),
    prompt: (params, options) => agent.request(methods.agent.session.prompt, params, options),
  }

  await client.initialize({ protocolVersion: PROTOCOL_VERSION })
  await client.authenticate({ methodId: 'bearer', _meta: { token } })

  return {
    client,
    dispose: async () => {
      connection.close()
    },
  }
}

function assertStopReason(label: string, result: PromptResponse): void {
  if (!STRICT_STOP_REASON) return
  if (result.stopReason !== 'end_turn') {
    throw new Error(`${label}: unexpected stopReason ${JSON.stringify(result.stopReason)}`)
  }
}

async function runSmoke01(client: SmokeClient, persistenceRoot: string): Promise<void> {
  const { sessionId } = await client.newSession({ cwd: persistenceRoot, mcpServers: [] })
  console.log(`SMOKE-01 newSession: ${sessionId}`)

  const result = await client.prompt({
    sessionId,
    prompt: [{ type: 'text', text: 'hello' }],
  })
  assertStopReason('SMOKE-01', result)
  console.log('SMOKE-01 prompt: ok')

  await client.closeSession({ sessionId })
  console.log('SMOKE-01 closeSession: ok')

  const listed = await client.listSessions({ cwd: persistenceRoot })
  if (!listed.sessions.some(s => s.sessionId === sessionId)) {
    throw new Error('SMOKE-01: session not visible in listSessions')
  }
  console.log('SMOKE-01 listSessions: ok')
}

async function runSmoke02(client: SmokeClient, persistenceRoot: string): Promise<string> {
  const { sessionId } = await client.newSession({ cwd: persistenceRoot, mcpServers: [] })
  console.log(`SMOKE-02 newSession: ${sessionId}`)

  const result = await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'resume' }] })
  assertStopReason('SMOKE-02 first prompt', result)
  console.log('SMOKE-02 first prompt: ok')

  await client.closeSession({ sessionId })
  console.log('SMOKE-02 closeSession: ok')
  return sessionId
}

async function runSmoke02Resume(client: SmokeClient, persistenceRoot: string, sessionId: string): Promise<void> {
  await client.resumeSession({ sessionId, cwd: persistenceRoot, mcpServers: [] })
  const result = await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'resume' }] })
  assertStopReason('SMOKE-02 resume prompt', result)
  console.log('SMOKE-02 resume + prompt: ok')
}

async function runSmoke01Lifecycle(client: SmokeClient, persistenceRoot: string): Promise<void> {
  const { sessionId } = await client.newSession({ cwd: persistenceRoot, mcpServers: [] })
  console.log(`SMOKE-01 newSession: ${sessionId}`)

  await client.closeSession({ sessionId })
  console.log('SMOKE-01 closeSession: ok')

  const listed = await client.listSessions({ cwd: persistenceRoot })
  if (!listed.sessions.some(s => s.sessionId === sessionId)) {
    throw new Error('SMOKE-01: session not visible in listSessions')
  }
  console.log('SMOKE-01 listSessions: ok')
}

async function runSmoke02ResumeLifecycle(
  url: string,
  client: SmokeClient,
  persistenceRoot: string,
): Promise<string> {
  const { sessionId } = await client.newSession({ cwd: persistenceRoot, mcpServers: [] })
  console.log(`SMOKE-02 newSession: ${sessionId}`)

  await client.closeSession({ sessionId })
  console.log('SMOKE-02 closeSession: ok')

  const { client: client2, dispose } = await makeClient(url)
  try {
    await client2.resumeSession({ sessionId, cwd: persistenceRoot, mcpServers: [] })
    console.log('SMOKE-02 resume: ok')
  } finally {
    await dispose()
  }
  return sessionId
}

async function startLocalServer(): Promise<{
  url: string
  dispose: () => Promise<void>
  persistenceRoot: string
  executed: string[]
}> {
  const persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-acp-network-smoke-'))
  const responses = new Map<string, StreamChunk[]>([
    ['hello', textResponse('hello from smoke')],
    ['resume', textResponse('resumed successfully')],
  ])
  const scripted = new Map<string, StreamChunk[][]>([
    ['probe', [toolCallResponse('smoke_probe', 'call-allow'), toolCallResponse('smoke_probe', 'call-reject'), textResponse('second call was denied, stopping')]],
  ])
  const executed: string[] = []
  const adapter = new SmokeAdapter(responses, scripted)

  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { personaPrefix: '' } })
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ApprovalService)
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('acp-network smoke does not execute bash') },
    run() { throw new Error('acp-network smoke does not execute bash') },
    start() { throw new Error('acp-network smoke does not execute bash') },
  })
  // The shipped base-bundle preset table, so the advertised catalog matches production.
  await ctx.plugin(PermissionPresetService, {
    presets: {
      'read-only': { sandbox: 'read-only', approval: 'ask' },
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
      'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    },
  })
  ctx.llm.registerAdapter(['mock-smoke'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'smoke_probe',
    description: 'Probe tool for the permission round-trip smoke.',
    parameters: {},
    execute: async (_args, exec) => {
      if (exec.agent === undefined) throw new Error('smoke_probe requires an agent scope')
      executed.push('ran')
      return [{ type: 'text', text: 'probed' }]
    },
  }))

  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin({
    name: 'acp-network-smoke',
    inject: AcpNetworkPlugin.inject,
    apply: (inner: Context) => {
      AcpNetworkPlugin.apply(inner, {
        provider: 'mock-smoke',
        model: 'mock',
        secret: SECRET,
        audience: AUDIENCE,
        transport: 'websocket',
        path: '/acp',
      })
    },
  })

  const port = ctx.webServer.port
  const url = `ws://127.0.0.1:${port}/acp`
  console.log(`Smoke server listening on ${url}`)

  return {
    url,
    persistenceRoot,
    executed,
    dispose: async () => {
      await ctx.fiber.dispose()
      await rm(persistenceRoot, { recursive: true, force: true })
    },
  }
}

/**
 * SMOKE-acp-network-03: the `always` permission round-trip on the network
 * transport. One turn, two tool calls, two one-shot answers: the first call
 * executes, the second is denied, and every ask carries exactly the two
 * one-shot options.
 */
async function runSmoke03(url: string, persistenceRoot: string, executed: string[]): Promise<void> {
  const requests: RequestPermissionRequest[] = []
  const answers = ['allow-once', 'reject-once']
  const { client, dispose } = await makeClient(url, {
    answerPermission: (request) => {
      requests.push(request)
      for (const option of request.options) {
        if (option.kind === 'allow_always') throw new Error('SMOKE-03: offered a durable grant under the always policy')
      }
      const optionId = answers.shift()
      if (optionId === undefined) throw new Error('SMOKE-03: unexpected third permission request')
      return Promise.resolve({ outcome: { outcome: 'selected', optionId } })
    },
  })
  try {
    const { sessionId } = await client.newSession({ cwd: persistenceRoot, mcpServers: [] })
    await client.setSessionConfigOption({ sessionId, configId: 'permission_policy', value: 'always' })

    // Unknown vocabulary fails loud over the wire.
    await client.setSessionConfigOption({ sessionId, configId: 'permission_policy', value: 'paranoid' })
      .then(
        () => { throw new Error('SMOKE-03: unknown policy value was accepted') },
        (error: unknown) => {
          if (!(error instanceof Error) || !error.message.includes('unknown permission policy value')) {
            throw new Error(`SMOKE-03: wrong unknown-policy error: ${String(error)}`)
          }
        },
      )

    const result = await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'probe' }] })
    assertStopReason('SMOKE-03', result)
    if (requests.length !== 2) {
      throw new Error(`SMOKE-03: expected exactly 2 permission requests, saw ${String(requests.length)}`)
    }
    if (executed.length !== 1) {
      throw new Error(`SMOKE-03: expected exactly the first call to execute, saw ${String(executed.length)} executions`)
    }
    for (const request of requests) {
      const kinds = request.options.map(option => option.kind).sort()
      if (!(kinds.length === 2 && kinds[0] === 'allow_once' && kinds[1] === 'reject_once')) {
        throw new Error(`SMOKE-03: request offered ${JSON.stringify(kinds)} instead of the two one-shot options`)
      }
    }
    await client.closeSession({ sessionId })
    console.log('SMOKE-03 always round-trip: ok (2 asks, allow-once ran, reject-once denied)')
  } finally {
    await dispose()
  }
}

/** Phase 'persist': create one session, prompt it, close it, and publish its id. */
async function runPersistPhase(client: SmokeClient): Promise<void> {
  const { sessionId } = await client.newSession({ cwd: PHASE_CWD, mcpServers: [] })
  console.log(`SMOKE-PERSIST newSession: ${sessionId}`)

  if (!NO_PROMPT) {
    const result = await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'resume' }] })
    assertStopReason('SMOKE-PERSIST', result)
    console.log('SMOKE-PERSIST prompt: ok')
  }

  await client.closeSession({ sessionId })
  console.log('SMOKE-PERSIST closeSession: ok')

  if (SESSION_FILE !== undefined) await writeFile(SESSION_FILE, `${sessionId}\n`)
  console.log(`ACP_SMOKE_SESSION_ID=${sessionId}`)
}

/** Phase 'resume': resume a published session id against a restarted server. */
async function runResumePhase(client: SmokeClient): Promise<void> {
  const sessionId = RESUME_SESSION_ID
    ?? (SESSION_FILE !== undefined ? (await readFile(SESSION_FILE, 'utf8')).trim() : undefined)
  if (sessionId === undefined || sessionId === '') {
    throw new Error('resume phase requires ACP_SMOKE_SESSION_ID or ACP_SMOKE_SESSION_FILE')
  }
  console.log(`SMOKE-RESUME resume: ${sessionId}`)

  await client.resumeSession({ sessionId, cwd: PHASE_CWD, mcpServers: [] })
  if (!NO_PROMPT) {
    const result = await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'resume' }] })
    assertStopReason('SMOKE-RESUME', result)
    console.log('SMOKE-RESUME prompt: ok')
  }
  console.log('SMOKE-RESUME: ok')
}

async function main(): Promise<void> {
  const persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-acp-network-smoke-'))
  let localServer: Awaited<ReturnType<typeof startLocalServer>> | undefined
  try {
    const server = STAGING_URL
      ? { url: STAGING_URL, executed: [] as string[] }
      : await startLocalServer().then((started) => {
        localServer = started
        return started
      })
    const { url } = server

    if (PHASE === 'persist' || PHASE === 'resume') {
      // Orchestrated half-runs: smoke-staging.sh restarts the staging server
      // between the two invocations. A local server keeps no state across
      // processes, so phases are only meaningful against ACP_SMOKE_URL.
      const { client, dispose } = await makeClient(url)
      try {
        if (PHASE === 'persist') await runPersistPhase(client)
        else await runResumePhase(client)
      } finally {
        await dispose()
      }
      console.log(`\nACP_SMOKE_PHASE=${PHASE} passed.`)
      return
    }

    if (NO_PROMPT) {
      // SMOKE-01: handshake, authenticate, session lifecycle
      {
        const { client, dispose } = await makeClient(url)
        try {
          await runSmoke01Lifecycle(client, persistenceRoot)
        } finally {
          await dispose()
        }
      }

      // SMOKE-02: resume after reconnect
      {
        const { client, dispose } = await makeClient(url)
        try {
          await runSmoke02ResumeLifecycle(url, client, persistenceRoot)
        } finally {
          await dispose()
        }
      }
    } else {
      // SMOKE-01: full prompt loop
      {
        const { client, dispose } = await makeClient(url)
        try {
          await runSmoke01(client, persistenceRoot)
        } finally {
          await dispose()
        }
      }

      // SMOKE-02: resume after reconnect
      {
        const { client, dispose } = await makeClient(url)
        let sessionId: string
        try {
          sessionId = await runSmoke02(client, persistenceRoot)
        } finally {
          await dispose()
        }

        const { client: client2, dispose: dispose2 } = await makeClient(url)
        try {
          await runSmoke02Resume(client2, persistenceRoot, sessionId)
        } finally {
          await dispose2()
        }
      }
    }

    // SMOKE-03 needs the local composition (approval, presets, probe tool);
    // a staging target or the handshake-only mode cannot reproduce it, and
    // that is reported as a skip rather than a pass.
    if (STAGING_URL || NO_PROMPT) {
      console.log('\nSMOKE-03 skipped: the permission round-trip needs the local smoke composition.')
    } else {
      await runSmoke03(url, persistenceRoot, server.executed)
    }

    console.log('\nAll ACP-over-network smoke checks passed.')
    reportResult('ST-S01', 'pass')
    reportResult('ST-S02', 'pass')
  } finally {
    if (localServer) {
      await localServer.dispose()
    } else {
      await rm(persistenceRoot, { recursive: true, force: true })
    }
  }
}

main().catch((error: unknown) => {
  console.error('Smoke failed:', error)
  reportResult('ST-S01', 'fail', error instanceof Error ? error.message : String(error))
  reportResult('ST-S02', 'fail', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
