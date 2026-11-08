/**
 * Protocol smoke for ACP-over-network.
 *
 * Supports two modes:
 *
 * 1. Local (default): boots a real dsh-acp-network server on a random loopback
 *    port with a mocked LLM, then drives it through the ACP SDK over WebSocket.
 *    The local composition also mounts the approval and permission-preset
 *    services and one probe tool for the `always` permission round-trip, the
 *    real skill registry over a seeded project skills fixture for the
 *    `session/skills_list` enumeration, and the real plan-mode controller for
 *    the `session/set_mode` surface.
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

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  type SessionUpdate,
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
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import PlanModeController from '@deepseek-ai/dsh-plan-mode'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { closeMockServers, mockServer } from '../../../../llm/llm-pi-ai/tests/mock-server.ts'
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

/** One scripted entry: plain chunks, or chunks held back for `waitMs` first. */
type ScriptedEntry = StreamChunk[] | { waitMs: number; chunks: StreamChunk[] }

class SmokeAdapter extends LlmAdapter {
  constructor(
    private readonly responses: Map<string, StreamChunk[]>,
    /**
     * Per-key FIFO of full responses consumed ahead of the static map, so one
     * key can drive a multi-step turn (tool call, tool call, final text).
     */
    private readonly scripted: Map<string, ScriptedEntry[]> = new Map(),
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
    if (!Array.isArray(entry)) {
      // Hold the response back so the turn stays active for a wide busy window.
      const deadline = Date.now() + entry.waitMs
      while (Date.now() < deadline) {
        if (options.signal?.aborted) throw new Error('aborted')
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    for (const chunk of Array.isArray(entry) ? entry : entry.chunks) {
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

/** One OpenAI-compatible SSE chat-completion response carrying `text` (the pi-ai wire shape). */
function sseEvents(text: string): string[] {
  return [
    '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
    `{"choices":[{"delta":{"content":"${text}"},"index":0,"finish_reason":null}]}`,
    '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
    '[DONE]',
  ]
}

type ChunkUpdate = { sessionUpdate?: string; content?: { type?: string; text?: string } | null }

/** Assemble the agent text chunks a captured update list carries. */
function agentText(updates: SessionUpdate[]): string {
  return (updates as ChunkUpdate[])
    .filter(update => update.sessionUpdate === 'agent_message_chunk'
      && update.content?.type === 'text'
      && typeof update.content.text === 'string')
    .map(update => update.content!.text)
    .join('')
}

function toolCallResponse(name: string, callId: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId(callId), name, argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(callId), name, arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/**
 * The SMOKE-06 compaction prompts. Long enough that the framed checkpoint
 * stays below the shadowed span's route price — the shrink invariant rejects
 * a summary that would not lower pressure, so the history must comfortably
 * exceed the fixed framing's own estimate (~90 tokens).
 */
const CONDENSE_PROMPT_A = [
  'In plain prose (no lists), write about 150 words on how a lighthouse fresnel lens concentrates light into a horizontal beam.',
  'For context the summary should preserve: the lens replaced arrays of silvered mirrors, cut reflection losses, and let one optical design serve stations across a wide range of nominal ranges.'.repeat(2),
  'Also note for the summary that coastal stations standardized on several lens orders, and that the rotating apparatus was originally driven by clockwork weights wound by hand every night.',
].join(' ')
const CONDENSE_PROMPT_B = [
  'In plain prose (no lists), write about 150 words on how a tidal power station converts rising and falling water levels into electricity.',
  'For context the summary should preserve: a barrage across an estuary impounds a basin, sluice gates fill it at high tide, and the head difference drives low-head turbines on the ebb.'.repeat(2),
  'Also note for the summary that output tracks the lunar cycle, that tidal-stream arrays are the newer in-water alternative, and that the plant connects to the grid through a substation.',
].join(' ')

/** One config option in a new/resume response; SMOKE-07 reads the grouped `model` select. */
interface ModelConfigOption {
  id: string
  type?: string
  currentValue?: string
  options?: Array<{ group?: string; options?: { value: string }[]; value?: string }>
}

interface SmokeClient {
  initialize: (params: { protocolVersion: number }) => Promise<unknown>
  authenticate: (params: { methodId: string; _meta: { token: string } }) => Promise<unknown>
  newSession: (params: { cwd: string; mcpServers: [] }) => Promise<{
    sessionId: string
    modes?: { currentModeId: string; availableModes: { id: string; name: string }[] }
    configOptions?: ModelConfigOption[]
  }>
  listSessions: (params: { cwd: string }) => Promise<{ sessions: Array<{ sessionId: string; cwd: string }> }>
  resumeSession: (params: { sessionId: string; cwd: string; mcpServers: [] }) => Promise<{
    modes?: { currentModeId: string }
    configOptions?: ModelConfigOption[]
  }>
  closeSession: (params: { sessionId: string }) => Promise<unknown>
  cancel: (params: { sessionId: string }) => Promise<void>
  setSessionConfigOption: (params: { sessionId: string; configId: string; value: string }) => Promise<unknown>
  setSessionMode: (params: { sessionId: string; modeId: string }) => Promise<unknown>
  skillsList: (params: { sessionId: string } | Record<string, never>) => Promise<{
    skills: { name: string; description: string; modelInvocable: boolean; userInvocable: boolean }[]
  }>
  prompt: (params: PromptRequest, options?: SendRequestOptions) => Promise<PromptResponse>
  /** The dsh extension explicit-compaction method; execution runs on the session's engine. */
  compact: (params: { sessionId: string }) => Promise<{
    result: {
      compactionId: string
      summarySeq: number
      shadowedCount: number
      shadowedTokenCount: number
      summary: { type: string }[]
    } | null
  }>
  /** Session updates in receive order, for the plan-mode and compaction assertions. */
  updates: SessionUpdate[]
}

async function makeClient(
  url: string,
  options: {
    answerPermission?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
    declareCompaction?: boolean
  } = {},
): Promise<{ client: SmokeClient; dispose: () => Promise<void> }> {
  const token = AcpNetworkPlugin.signHmacToken(SECRET, SUBJECT, AUDIENCE)
  const updates: SmokeClient['updates'] = []
  const clientApp = createAcpClientApp({ name: 'dsh-acp-network-smoke-client' })
  clientApp.onNotification(methods.client.session.update, ({ params }) => {
    updates.push(params.update)
  })
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
    cancel: params => agent.notify(methods.agent.session.cancel, params),
    setSessionConfigOption: params => agent.request(methods.agent.session.setConfigOption, params),
    setSessionMode: params => agent.request(methods.agent.session.setMode, params),
    skillsList: params => agent.request('session/skills_list', params),
    prompt: (params, options) => agent.request(methods.agent.session.prompt, params, options),
    compact: params => agent.request('session/compact', params),
    updates,
  }

  const initializeParams: { protocolVersion: number; clientCapabilities?: { session: { compaction: Record<string, never> } } }
    = { protocolVersion: PROTOCOL_VERSION }
  if (options.declareCompaction === true) initializeParams.clientCapabilities = { session: { compaction: {} } }
  await client.initialize(initializeParams)
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
  const scripted = new Map<string, ScriptedEntry[]>([
    ['probe', [toolCallResponse('smoke_probe', 'call-allow'), toolCallResponse('smoke_probe', 'call-reject'), textResponse('second call was denied, stopping')]],
    // SMOKE-06 keys. The compaction summarizer reuses the conversation's last
    // user text as its adapter key, so each key queues its turn response and
    // then the summary response; the busy key holds its final text back to
    // keep the agent active while the race lands.
    [CONDENSE_PROMPT_A, [textResponse('history worth condensing'), textResponse('## Checkpoint\n\nThe lens question was fully answered.')]],
    [CONDENSE_PROMPT_B, [textResponse('undeclared history worth condensing'), textResponse('## Checkpoint\n\nThe tidal question was fully answered.')]],
    ['busy probe', [{ waitMs: 200, chunks: toolCallResponse('smoke_probe', 'call-busy') }, { waitMs: 1500, chunks: textResponse('probe finished') }]],
  ])
  const executed: string[] = []
  const adapter = new SmokeAdapter(responses, scripted)

  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { personaPrefix: '' } })
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  await ctx.plugin(TokenMeter)
  // Explicit-only compaction for SMOKE-06: the zero retain budget keeps even a
  // one-turn scripted history compactible.
  await ctx.plugin(BasicCompactionEngine, { auto: false, retainTokens: 0 })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ApprovalService)
  await ctx.plugin(PlanModeController, { section: 'Smoke plan guidance: plan before acting.' })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { watch: false })
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

/**
 * Seed the project skills fixture under one session cwd: both invocation
 * exclusives and one both-surfaces skill, so the SMOKE-04 catalog assertions
 * check frontmatter-resolved flags against a known catalog.
 */
async function seedSmokeSkills(root: string): Promise<void> {
  const entries = [
    {
      dir: join(root, '.dsh', 'skills', 'smoke-gesture'),
      frontmatter: 'name: smoke-gesture\ndescription: Smoke skill on the human gesture surface only\ndisable-model-invocation: true',
      body: 'Gesture-only smoke skill.',
    },
    {
      dir: join(root, '.dsh', 'skills', 'smoke-shared'),
      frontmatter: 'name: smoke-shared\ndescription: Smoke skill on both invocation surfaces',
      body: 'Plain smoke skill.',
    },
    {
      dir: join(root, '.agents', 'skills', 'smoke-model'),
      frontmatter: 'name: smoke-model\ndescription: Smoke skill on the model surface only\nuser-invocable: false',
      body: 'Model-only smoke skill.',
    },
  ]
  for (const entry of entries) {
    await mkdir(entry.dir, { recursive: true })
    await writeFile(join(entry.dir, 'SKILL.md'), `---\n${entry.frontmatter}\n---\n\n${entry.body}\n`)
  }
}

/**
 * SMOKE-acp-network-04: `session/skills_list` on the network transport. The
 * seeded project fixture pins structure, ordering, and frontmatter-resolved
 * flags; the call is read-only across a prompt round-trip.
 */
async function runSmoke04(url: string, persistenceRoot: string): Promise<void> {
  await seedSmokeSkills(persistenceRoot)
  const { client, dispose } = await makeClient(url)
  try {
    const { sessionId } = await client.newSession({ cwd: persistenceRoot, mcpServers: [] })

    const listed = await client.skillsList({ sessionId })
    const skills = listed.skills
    // Structure: name-sorted, exactly the four agreed fields per entry, and
    // scalar field types even for catalog entries beyond the fixture (user
    // roots of the runner machine may contribute extras).
    const names = skills.map(skill => skill.name)
    for (let index = 1; index < names.length; index++) {
      if (!(names[index - 1]! < names[index]!)) {
        throw new Error(`SMOKE-04: skills not name-sorted: ${JSON.stringify(names)}`)
      }
    }
    for (const skill of skills) {
      const keys = Object.keys(skill).sort()
      if (!(keys.length === 4 && keys[0] === 'description' && keys[1] === 'modelInvocable' && keys[2] === 'name' && keys[3] === 'userInvocable')) {
        throw new Error(`SMOKE-04: skill entry carries ${JSON.stringify(keys)} instead of the four agreed fields`)
      }
      if (typeof skill.description !== 'string' || typeof skill.modelInvocable !== 'boolean' || typeof skill.userInvocable !== 'boolean') {
        throw new Error(`SMOKE-04: skill entry field types invalid: ${JSON.stringify(skill)}`)
      }
    }
    const byName = new Map(skills.map(skill => [skill.name, skill]))
    const expected: Array<[string, boolean, boolean]> = [
      ['smoke-gesture', false, true],
      ['smoke-model', true, false],
      ['smoke-shared', true, true],
    ]
    for (const [name, modelInvocable, userInvocable] of expected) {
      const skill = byName.get(name)
      if (skill === undefined) throw new Error(`SMOKE-04: seeded skill "${name}" missing from the catalog`)
      if (skill.modelInvocable !== modelInvocable || skill.userInvocable !== userInvocable) {
        throw new Error(`SMOKE-04: seeded skill "${name}" flags ${JSON.stringify(skill)} instead of model=${String(modelInvocable)} user=${String(userInvocable)}`)
      }
    }
    console.log(`SMOKE-04 skills_list: ok (${String(skills.length)} skills, fixture flags match)`)

    // Unknown ids reject in the invalid params class.
    await client.skillsList({ sessionId: 'unknown-id' }).then(
      () => { throw new Error('SMOKE-04: unknown session id was accepted') },
      (error: unknown) => {
        if (!(error instanceof Error) || !error.message.includes('unknown session: unknown-id')) {
          throw new Error(`SMOKE-04: wrong unknown-session error: ${String(error)}`)
        }
      },
    )
    console.log('SMOKE-04 unknown session: ok')

    // Read-only: a prompt round-trip settles and a re-list agrees.
    const result = await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'hello' }] })
    assertStopReason('SMOKE-04', result)
    const relisted = await client.skillsList({ sessionId })
    if (JSON.stringify(relisted.skills) !== JSON.stringify(skills)) {
      throw new Error('SMOKE-04: re-listed catalog diverged after a prompt')
    }
    console.log('SMOKE-04 prompt round-trip + re-list: ok')

    await client.closeSession({ sessionId })
    console.log('SMOKE-04 closeSession: ok')
  } finally {
    await dispose()
  }
}

/**
 * SMOKE-acp-network-05: the plan-mode face (`session/set_mode`, the `modes`
 * advertisement, and `current_mode_update` timing) on the network transport.
 * Every step rides standard methods, so it also verifies a staging target's
 * deployed face; the plan-review permission mapping stays on the unit and
 * real-API lanes because it depends on model behavior.
 */
async function runSmoke05(url: string, persistenceRoot: string): Promise<void> {
  const modeIds = (client: SmokeClient): string[] =>
    client.updates.filter((update): update is Extract<SessionUpdate, { sessionUpdate: 'current_mode_update' }> => update.sessionUpdate === 'current_mode_update')
      .map(update => update.currentModeId ?? '<missing>')

  const { client, dispose } = await makeClient(url)
  let sessionId: string
  try {
    const created = await client.newSession({ cwd: persistenceRoot, mcpServers: [] })
    sessionId = created.sessionId
    console.log(`SMOKE-05 newSession: ${sessionId}`)

    const modes = created.modes
    if (modes === undefined) throw new Error('SMOKE-05: newSession response lacks the modes advertisement')
    if (modes.currentModeId !== 'normal') {
      throw new Error(`SMOKE-05: currentModeId ${JSON.stringify(modes.currentModeId)} instead of "normal"`)
    }
    const advertised = modes.availableModes.map(mode => mode.id)
    if (advertised.length !== 2 || advertised[0] !== 'plan' || advertised[1] !== 'normal') {
      throw new Error(`SMOKE-05: availableModes ${JSON.stringify(advertised)} instead of exactly plan, normal`)
    }
    if (!modes.availableModes.every(mode => typeof mode.name === 'string' && mode.name.length > 0)) {
      throw new Error('SMOKE-05: an advertised mode lacks a name')
    }
    console.log('SMOKE-05 modes advertisement: ok')

    await client.setSessionMode({ sessionId, modeId: 'plan' })
    if (JSON.stringify(modeIds(client)) !== JSON.stringify(['plan'])) {
      throw new Error(`SMOKE-05: mode updates after set plan: ${JSON.stringify(modeIds(client))}`)
    }
    console.log('SMOKE-05 set_mode plan + exactly one update: ok')

    // The record survives disconnects as active; release it so the reconnect
    // below may resume.
    await client.closeSession({ sessionId })
  } finally {
    await dispose()
  }

  // Resume after reconnect restores the committed mode.
  const { client: client2, dispose: dispose2 } = await makeClient(url)
  try {
    const resumed = await client2.resumeSession({ sessionId, cwd: persistenceRoot, mcpServers: [] })
    if (resumed.modes?.currentModeId !== 'plan') {
      throw new Error(`SMOKE-05: resumed currentModeId ${JSON.stringify(resumed.modes?.currentModeId)} instead of "plan"`)
    }
    console.log('SMOKE-05 resume restores plan: ok')

    // Switch back, then repeat the committed state silently.
    await client2.setSessionMode({ sessionId, modeId: 'normal' })
    if (JSON.stringify(modeIds(client2)) !== JSON.stringify(['normal'])) {
      throw new Error(`SMOKE-05: mode updates after set normal: ${JSON.stringify(modeIds(client2))}`)
    }
    await client2.setSessionMode({ sessionId, modeId: 'normal' })
    if (modeIds(client2).length !== 1) {
      throw new Error(`SMOKE-05: the repeated set emitted updates: ${JSON.stringify(modeIds(client2))}`)
    }
    console.log('SMOKE-05 switch back + silent noop: ok')

    // Re-enter plan; an unknown id rejects in the invalid params class with
    // the advertised vocabulary and no update.
    await client2.setSessionMode({ sessionId, modeId: 'plan' })
    if (JSON.stringify(modeIds(client2)) !== JSON.stringify(['normal', 'plan'])) {
      throw new Error(`SMOKE-05: mode updates after re-entering plan: ${JSON.stringify(modeIds(client2))}`)
    }
    await client2.setSessionMode({ sessionId, modeId: 'other' }).then(
      () => { throw new Error('SMOKE-05: unknown mode id was accepted') },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('unknown session mode: other') || !message.includes('plan, normal')) {
          throw new Error(`SMOKE-05: wrong unknown-mode error: ${message}`)
        }
      },
    )
    if (modeIds(client2).length !== 2) {
      throw new Error(`SMOKE-05: the rejected set emitted updates: ${JSON.stringify(modeIds(client2))}`)
    }
    console.log('SMOKE-05 vocabulary error branch: ok')

    // An ordinary prompt round-trip still settles, then the session closes.
    const result = await client2.prompt({ sessionId, prompt: [{ type: 'text', text: 'hello' }] })
    assertStopReason('SMOKE-05', result)
    console.log('SMOKE-05 prompt round-trip: ok')

    await client2.closeSession({ sessionId })
    console.log('SMOKE-05 closeSession: ok')
  } finally {
    await dispose2()
  }
}

/** Poll a predicate until it holds, or fail the label after the timeout. */
async function waitForCondition(label: string, probe: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`${label}: timed out`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/** Reject with the recorded wire error, or fail when the call resolves. */
async function expectWireError<T>(label: string, call: PromiseLike<T>): Promise<{ message: string; data?: unknown }> {
  return await call.then(
    () => { throw new Error(`${label}: the wire call resolved instead of failing`) },
    (error: unknown) => {
      if (error instanceof Error) return { message: error.message, data: (error as { data?: unknown }).data }
      throw new Error(`${label}: non-error rejection ${String(error)}`)
    },
  )
}

/**
 * SMOKE-acp-network-06: the `session/compact` face on the network transport.
 * A capability-declaring client compacts a one-turn scripted history and
 * receives the ordered `compaction_update` pair, a mid-turn race classifies
 * busy, fresh history and unknown sessions hit their wire branches, an
 * undeclared connection stays silent through the same lifecycle, and the
 * compacted session resumes and keeps serving turns. Needs the local smoke
 * composition (compaction engine over the scripted adapter).
 */
async function runSmoke06(url: string, persistenceRoot: string): Promise<void> {
  const compactionUpdates = (client: SmokeClient): Extract<SessionUpdate, { sessionUpdate: 'compaction_update' }>[] =>
    client.updates.filter((update): update is Extract<SessionUpdate, { sessionUpdate: 'compaction_update' }> => update.sessionUpdate === 'compaction_update')

  const { client, dispose } = await makeClient(url, { declareCompaction: true })
  try {
    // Declared connection: one compactible turn, then the structured result
    // and the ordered in_progress → completed notification pair.
    const created = await client.newSession({ cwd: persistenceRoot, mcpServers: [] })
    assertStopReason('SMOKE-06', await client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: CONDENSE_PROMPT_A }],
    }))
    const response = await client.compact({ sessionId: created.sessionId })
    if (response.result === null) throw new Error('SMOKE-06: compact returned null for known history')
    const { compactionId, summarySeq, shadowedCount, shadowedTokenCount, summary } = response.result
    if (typeof compactionId !== 'string' || compactionId.length === 0) throw new Error('SMOKE-06: bad compactionId')
    if (typeof summarySeq !== 'number') throw new Error('SMOKE-06: bad summarySeq')
    if (!(shadowedCount >= 1)) throw new Error(`SMOKE-06: bad shadowedCount ${String(shadowedCount)}`)
    if (!(shadowedTokenCount >= 1)) throw new Error(`SMOKE-06: bad shadowedTokenCount ${String(shadowedTokenCount)}`)
    if (summary.length === 0 || summary[0]?.type !== 'text') throw new Error('SMOKE-06: bad summary blocks')
    await waitForCondition('SMOKE-06 compaction updates', () => compactionUpdates(client).length >= 2)
    const [inProgress, completed] = compactionUpdates(client)
    if (inProgress?.status !== 'in_progress' || inProgress.compactionId !== compactionId) {
      throw new Error(`SMOKE-06: first update ${JSON.stringify(inProgress)} instead of in_progress`)
    }
    if (completed?.status !== 'completed' || completed.compactionId !== compactionId) {
      throw new Error(`SMOKE-06: second update ${JSON.stringify(completed)} instead of completed`)
    }
    if ((completed.summary?.length ?? 0) === 0) throw new Error('SMOKE-06: completed update carries no summary blocks')
    console.log(`SMOKE-06 compact + notifications: ok (shadowed ${String(shadowedCount)} nodes, ${String(shadowedTokenCount)} tokens)`)

    // Resume after reconnect reconstructs through the compaction-bearing log.
    await client.closeSession({ sessionId: created.sessionId })
    const { client: resumed, dispose: disposeResumed } = await makeClient(url, { declareCompaction: true })
    try {
      await resumed.resumeSession({ sessionId: created.sessionId, cwd: persistenceRoot, mcpServers: [] })
      assertStopReason('SMOKE-06 resume', await resumed.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'resume' }],
      }))
      if (compactionUpdates(resumed).length !== 0) {
        throw new Error('SMOKE-06: resume emitted compaction updates')
      }
      console.log('SMOKE-06 resume through compacted log: ok')
    } finally {
      await disposeResumed()
    }

    // Mid-turn race: while the scripted turn holds its final segment back, the
    // agent is active and the compaction classifies busy. The tool-call card
    // proves the turn is mid-flight before the race fires.
    const busy = await client.newSession({ cwd: persistenceRoot, mcpServers: [] })
    await client.setSessionConfigOption({ sessionId: busy.sessionId, configId: 'permission_policy', value: 'never' })
    const longTurn = client.prompt({ sessionId: busy.sessionId, prompt: [{ type: 'text', text: 'busy probe' }] })
    await waitForCondition('SMOKE-06 mid-turn anchor', () => client.updates.some(update => update.sessionUpdate === 'tool_call_update'))
    const busyError = await expectWireError('SMOKE-06 race', client.compact({ sessionId: busy.sessionId }))
    if (!busyError.message.includes('Compaction is unavailable') || JSON.stringify(busyError.data ?? {}) !== JSON.stringify({ code: 'busy' })) {
      throw new Error(`SMOKE-06: wrong busy error: ${busyError.message} ${JSON.stringify(busyError.data ?? {})}`)
    }
    await client.cancel({ sessionId: busy.sessionId })
    if ((await longTurn).stopReason !== 'cancelled') {
      throw new Error('SMOKE-06: the raced turn did not cancel cleanly')
    }
    console.log('SMOKE-06 busy branch: ok')

    // Fresh history and unknown sessions hit their wire branches.
    const fresh = await client.newSession({ cwd: persistenceRoot, mcpServers: [] })
    const freshResult = await client.compact({ sessionId: fresh.sessionId })
    if (freshResult.result !== null) throw new Error('SMOKE-06: fresh-history compact did not return null')
    if (compactionUpdates(client).length !== 2) throw new Error('SMOKE-06: the null compaction emitted updates')
    console.log('SMOKE-06 fresh null without events: ok')
    const unknownError = await expectWireError('SMOKE-06 unknown', client.compact({ sessionId: 'unknown-id' }))
    if (!unknownError.message.includes('unknown session: unknown-id')) {
      throw new Error(`SMOKE-06: wrong unknown-session error: ${unknownError.message}`)
    }
    console.log('SMOKE-06 unknown session: ok')

    await client.closeSession({ sessionId: busy.sessionId })
    await client.closeSession({ sessionId: fresh.sessionId })
  } finally {
    await dispose()
  }

  // Undeclared connection: the identical lifecycle delivers zero updates.
  const { client: quiet, dispose: disposeQuiet } = await makeClient(url)
  try {
    const quietSession = await quiet.newSession({ cwd: persistenceRoot, mcpServers: [] })
    assertStopReason('SMOKE-06 undeclared', await quiet.prompt({
      sessionId: quietSession.sessionId,
      prompt: [{ type: 'text', text: CONDENSE_PROMPT_B }],
    }))
    const quietResult = await quiet.compact({ sessionId: quietSession.sessionId })
    if (quietResult.result === null) throw new Error('SMOKE-06: the undeclared compaction returned null')
    if (compactionUpdates(quiet).length !== 0) {
      throw new Error('SMOKE-06: the undeclared connection received compaction updates')
    }
    await quiet.closeSession({ sessionId: quietSession.sessionId })
    console.log('SMOKE-06 undeclared silence: ok')
  } finally {
    await disposeQuiet()
  }
}

/**
 * SMOKE-acp-network-07: the multi-provider supply face on the network
 * transport. The server composition mounts real llm-pi-ai with two routes
 * from the `providerList` array form over local OpenAI-compatible mock
 * backends. Covers the grouped configOptions advertisement and the default
 * pair, the `set_config_option` switch landing on the chosen route, the
 * selection's persistence across a fresh client + resume, and the load-time
 * failure of a composition supplying both config keys.
 */
async function runSmoke07(): Promise<void> {
  const alpha = await mockServer([{ events: sseEvents('from-alpha') }])
  const beta = await mockServer([{ events: sseEvents('from-beta') }, { events: sseEvents('from-beta') }])
  const persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-acp-network-smoke07-'))
  const ctx = new Context()
  try {
    process.env.ACP_SMOKE_PI_KEY ??= 'smoke-key'
    await mountAgentLoopTestDependencies(ctx, { systemPrompt: { personaPrefix: '' } })
    await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
    await ctx.plugin(TokenMeter)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LlmPiAi, {
      providerList: [
        { provider: 'alpha', apiKeyEnv: 'ACP_SMOKE_PI_KEY', api: 'openai-completions', baseURL: alpha.url, models: [{ id: 'fast' }] },
        { provider: 'beta', apiKeyEnv: 'ACP_SMOKE_PI_KEY', api: 'openai-completions', baseURL: beta.url, models: [{ id: 'deep' }] },
      ],
    })
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin({
      name: 'acp-network-smoke07',
      inject: AcpNetworkPlugin.inject,
      apply: (inner: Context) => {
        AcpNetworkPlugin.apply(inner, {
          provider: 'alpha',
          model: 'fast',
          secret: SECRET,
          audience: AUDIENCE,
          transport: 'websocket',
          path: '/acp',
        })
      },
    })
    const url = `ws://127.0.0.1:${ctx.webServer.port}/acp`

    const grouped = (configOptions?: ModelConfigOption[]): { values: string[]; groups: number; current: string | undefined } => {
      const model = configOptions?.find(option => option.id === 'model')
      if (model?.type !== 'select') throw new Error('SMOKE-07: the model config option is missing or not a select')
      const values: string[] = []
      let groups = 0
      for (const entry of model.options ?? []) {
        if (entry.group !== undefined) {
          groups += 1
          for (const inner of entry.options ?? []) values.push(inner.value)
        } else if (entry.value !== undefined) values.push(entry.value)
      }
      return { values, groups, current: model.currentValue }
    }

    const { client, dispose } = await makeClient(url)
    let sessionId: string
    const alphaBefore = alpha.requests.length
    const betaBefore = beta.requests.length
    try {
      const created = await client.newSession({ cwd: persistenceRoot, mcpServers: [] })
      sessionId = created.sessionId
      const advertised = grouped(created.configOptions)
      if (advertised.groups !== 2) throw new Error(`SMOKE-07: expected two provider groups, got ${String(advertised.groups)}`)
      for (const expected of ['["alpha","fast"]', '["beta","deep"]']) {
        if (!advertised.values.includes(expected)) throw new Error(`SMOKE-07: configOptions is missing ${expected}`)
      }
      if (advertised.current !== '["alpha","fast"]') {
        throw new Error(`SMOKE-07: the default selection is ${String(advertised.current)}`)
      }
      console.log('SMOKE-07 grouped configOptions: ok')

      await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'one' }] })
      if (agentText(client.updates) !== 'from-alpha') throw new Error('SMOKE-07: the default prompt text is wrong')
      const defaultRouted = alpha.requests.length - alphaBefore
      if (defaultRouted !== 1 || beta.requests.length - betaBefore !== 0) {
        throw new Error('SMOKE-07: the default prompt did not route to alpha alone')
      }
      console.log('SMOKE-07 default route prompt: ok')

      await client.setSessionConfigOption({ sessionId, configId: 'model', value: '["beta","deep"]' })
      const seen = client.updates.length
      await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'two' }] })
      if (agentText(client.updates.slice(seen)) !== 'from-beta') throw new Error('SMOKE-07: the switched prompt text is wrong')
      if (alpha.requests.length - alphaBefore !== 1 || beta.requests.length - betaBefore !== 1) {
        throw new Error('SMOKE-07: the switched prompt did not route to beta alone')
      }
      console.log('SMOKE-07 set_config_option switch: ok')

      await client.closeSession({ sessionId })
    } finally {
      await dispose()
    }

    // Selection persistence: a fresh client resumes the closed session and
    // the switched pair still routes the prompt.
    {
      const { client, dispose } = await makeClient(url)
      try {
        const resumed = await client.resumeSession({ sessionId, cwd: persistenceRoot, mcpServers: [] })
        const model = resumed.configOptions?.find(option => option.id === 'model')
        if (model?.currentValue !== '["beta","deep"]') {
          throw new Error(`SMOKE-07: the resumed selection is ${String(model?.currentValue)}`)
        }
        await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'three' }] })
        if (!agentText(client.updates).endsWith('from-beta')) throw new Error('SMOKE-07: the resumed prompt text is wrong')
        if (beta.requests.length - betaBefore !== 2) throw new Error('SMOKE-07: the resumed prompt did not route to beta')
        console.log('SMOKE-07 resume persistence: ok')
      } finally {
        await dispose()
      }
    }

    // The conflict composition (both config keys naming routes) fails loud at load.
    {
      const conflict = new Context()
      try {
        await mountAgentLoopTestDependencies(conflict, { systemPrompt: { personaPrefix: '' } })
        let mounted = false
        try {
          await conflict.plugin(LlmPiAi, {
            providers: { alpha: { apiKeyEnv: 'ACP_SMOKE_PI_KEY', api: 'openai-completions', baseURL: alpha.url, models: [{ id: 'fast' }] } },
            providerList: [
              { provider: 'beta', apiKeyEnv: 'ACP_SMOKE_PI_KEY', api: 'openai-completions', baseURL: beta.url, models: [{ id: 'deep' }] },
            ],
          })
          mounted = true
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('both supply routes')) throw error
        }
        if (mounted) throw new Error('SMOKE-07: the conflict composition mounted instead of failing loud')
        console.log('SMOKE-07 conflict composition load failure: ok')
      } finally {
        await conflict.fiber.dispose()
      }
    }
  } finally {
    await ctx.fiber.dispose()
    await rm(persistenceRoot, { recursive: true, force: true })
    await closeMockServers()
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

    // SMOKE-04 needs the local composition (skill registry over the seeded
    // fixture) and a prompt round-trip; a staging target or the handshake-only
    // mode cannot reproduce it, and that is reported as a skip rather than a pass.
    if (STAGING_URL || NO_PROMPT) {
      console.log('\nSMOKE-04 skipped: skill enumeration needs the local smoke composition.')
    } else {
      await runSmoke04(url, persistenceRoot)
    }

    // SMOKE-05 rides only standard methods, so it runs against a staging
    // target's deployed plan-mode face too. The plan-review permission
    // mapping is not part of the smoke: it depends on model behavior and
    // stays on the unit and real-API lanes.
    await runSmoke05(url, persistenceRoot)

    // SMOKE-06 needs the local composition (compaction engine over the
    // scripted adapter); a staging target or the handshake-only mode cannot
    // reproduce it, and that is reported as a skip rather than a pass.
    if (STAGING_URL || NO_PROMPT) {
      console.log('\nSMOKE-06 skipped: the compaction face needs the local smoke composition.')
    } else {
      await runSmoke06(url, persistenceRoot)
    }

    // SMOKE-07 needs the local composition (llm-pi-ai array routes over
    // local mock HTTP backends); a staging target or the handshake-only mode
    // has no providerList supply, and that is reported as a skip rather
    // than a pass.
    if (STAGING_URL || NO_PROMPT) {
      console.log('\nSMOKE-07 skipped: the multi-provider face needs the local llm-pi-ai array composition.')
    } else {
      await runSmoke07()
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
