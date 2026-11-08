/**
 * Test harness for the network ACP transport.
 *
 * Boots a real Cordis context with a WebServer and the ACP network plugin,
 * then connects an ACP SDK client over a local WebSocket.
 */

import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import {
  client as createAcpClientApp,
  methods,
  PROTOCOL_VERSION,
  type Agent as AcpAgent,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SendRequestOptions,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client'
import AttachmentStore, { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { type GenerateOptions, LlmAdapter, type LlmResolvedModelInfo, type StreamChunk, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as AcpNetworkPlugin from '../src/index.ts'

/** Scripted text response ending in a clean stop. */
export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Scripted adapter for protocol tests. */
class MockAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(
    private readonly script: StreamChunk[][],
    private readonly provider = 'mock',
  ) {
    super()
  }

  override providerInfo(provider: string) {
    if (provider !== this.provider) throw new Error(`MockAdapter: unknown provider ${provider}`)
    return { id: this.provider, name: 'Mock' }
  }

  override listModels(provider: string) {
    return Promise.resolve(provider === this.provider ? [
      {
        provider: this.provider,
        id: 'mock',
        name: 'Mock Reasoner',
        description: 'Mock model with selectable reasoning.',
        inputModalities: ['text'] as const,
      },
    ] : [])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: ['text'],
      context: { contextWindow: 1_024 },
      ...model === 'mock' ? {
        reasoning: {
          efforts: [
            { id: ReasoningEffortId('low'), name: 'Low' },
            { id: ReasoningEffortId('high'), name: 'High' },
          ],
          defaultEffort: ReasoningEffortId('high'),
        },
      } : {},
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('MockAdapter: script exhausted')
    for (const chunk of entry) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

const IMAGE_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 2048,
  maxImagePixels: 1024,
  maxImageDimension: 2000,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

class MemoryAttachmentStore extends AttachmentStore {
  readonly imageLimits = IMAGE_LIMITS
  readonly saved: SaveImageAttachment[] = []
  readonly objects = new Map<string, StoredImageAttachment>()

  async validateImage(input: SaveImageAttachment): Promise<void> {
    if (input.data.byteLength === 0) throw new AttachmentError('Image is empty.', 'INVALID_IMAGE')
  }

  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push(input)
    const digest = createHash('sha256').update(input.data).digest('hex')
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId(`sha256:${digest}`),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
    }
    this.objects.set(ref.attachmentId, { ref, data: Uint8Array.from(input.data) })
    return Promise.resolve(ref)
  }

  async readImage(ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    const stored = this.objects.get(ref.attachmentId)
    if (stored === undefined) throw new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
    return { ref: stored.ref, data: Uint8Array.from(stored.data) }
  }
}

export type CapturedUpdate = SessionNotification['update']

interface NetworkBridgeClient {
  initialize: NonNullable<AcpAgent['initialize']>
  authenticate: NonNullable<AcpAgent['authenticate']>
  newSession: NonNullable<AcpAgent['newSession']>
  listSessions: NonNullable<AcpAgent['listSessions']>
  resumeSession: NonNullable<AcpAgent['resumeSession']>
  closeSession: NonNullable<AcpAgent['closeSession']>
  setSessionConfigOption: NonNullable<AcpAgent['setSessionConfigOption']>
  prompt: (params: PromptRequest, options?: SendRequestOptions) => Promise<PromptResponse>
  cancel: NonNullable<AcpAgent['cancel']>
  /** The dsh extension export trio under test (ACP 1.4.0 has no export method). */
  exportBegin: (params: { sessionId: string; includeDescendants?: boolean }) => Promise<{
    exportId: string
    filename: string
  }>
  exportRead: (params: { exportId: string }) => Promise<{ data: string; eof: boolean }>
  exportCancel: (params: { exportId: string }) => Promise<Record<string, never>>
}

export interface NetworkBridgeHarness {
  ctx: Context
  client: NetworkBridgeClient
  adapter: MockAdapter | undefined
  attachments: MemoryAttachmentStore | undefined
  updates: CapturedUpdate[]
  sessionUpdates: { sessionId: string; update: CapturedUpdate }[]
  permissionRequests: RequestPermissionRequest[]
  persistenceRoot: string
  onPermission: (request: RequestPermissionRequest) => RequestPermissionResponse
  url: string
  secret: string
  dispose: () => Promise<void>
}

export async function makeNetworkBridgeHarness(options: {
  script?: StreamChunk[][]
  secret?: string
  authenticate?: boolean
  transport?: 'websocket' | 'http' | 'both'
  persona?: string
  persistenceRoot?: string
  /** Replaces the scripted MockAdapter with a caller-mounted LLM surface (real plugins, mock HTTP routes). */
  llmMount?: (ctx: Context) => Promise<void>
  /** The acp-network default provider/model pair; defaults to the scripted adapter's route. */
  provider?: string
  model?: string
  /** Forwarded bridge export chunk bound (S55 wire-contract tests). */
  exportChunkBytes?: number
} = {}): Promise<NetworkBridgeHarness> {
  const adapter = new MockAdapter(options.script ?? [textResponse('hello')])
  const ctx = new Context()
  const ownsPersistenceRoot = options.persistenceRoot === undefined
  const persistenceRoot = options.persistenceRoot ?? await mkdtemp(join(tmpdir(), 'dsh-acp-network-test-'))
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { personaPrefix: options.persona ?? '' } })
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  // The base-bundle session-query mount: `openAt: never` keeps exact reads and
  // lineage traces (session export) available without ever opening SQLite.
  await ctx.plugin(SqliteSessionQueryEngine, { path: ':memory:', openAt: 'never' })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(MemoryAttachmentStore)
  const loopFiber = await ctx.plugin(AgentLoop, { agents: [] })
  void loopFiber
  if (options.llmMount === undefined) {
    ctx.llm.registerAdapter(['mock'], adapter)
  } else {
    await options.llmMount(ctx)
  }

  const secret = options.secret ?? 'test-secret'
  const webServerFiber = await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  void webServerFiber
  await ctx.plugin({
    name: 'acp-network-test',
    inject: AcpNetworkPlugin.inject,
    apply: (inner: Context) => {
      AcpNetworkPlugin.apply(inner, {
        provider: options.provider ?? 'mock',
        model: options.model ?? 'mock',
        secret,
        transport: options.transport ?? 'websocket',
        path: '/acp',
        ...(options.exportChunkBytes === undefined ? {} : { exportChunkBytes: options.exportChunkBytes }),
      })
    },
  })

  const port = ctx.webServer.port
  const url = `ws://127.0.0.1:${port}/acp`

  const updates: CapturedUpdate[] = []
  const sessionUpdates: { sessionId: string; update: CapturedUpdate }[] = []
  const permissionRequests: RequestPermissionRequest[] = []

  const clientApp = createAcpClientApp({ name: 'dsh-acp-network-test-client' })
    .onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params.update)
      sessionUpdates.push({ sessionId: params.sessionId, update: params.update })
      return Promise.resolve()
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      permissionRequests.push(params)
      return Promise.resolve({ outcome: { outcome: 'cancelled' } })
    })

  const stream = createWebSocketStream(url, {
    WebSocket,
  })
  const clientConnection = clientApp.connect(stream)
  const client = clientConnection.agent

  const harness: NetworkBridgeHarness = {
    ctx,
    client: {
      initialize: params => client.request(methods.agent.initialize, params),
      authenticate: params => client.request(methods.agent.authenticate, params),
      newSession: params => client.request(methods.agent.session.new, params),
      listSessions: params => client.request(methods.agent.session.list, params),
      resumeSession: params => client.request(methods.agent.session.resume, params),
      closeSession: params => client.request(methods.agent.session.close, params),
      setSessionConfigOption: params => client.request(methods.agent.session.setConfigOption, params),
      prompt: (params, opts) => client.request(methods.agent.session.prompt, params, opts),
      cancel: params => client.notify(methods.agent.session.cancel, params),
      exportBegin: params => client.request('session/export_begin', params),
      exportRead: params => client.request('session/export_read', params),
      exportCancel: params => client.request('session/export_cancel', params),
    },
    adapter: options.llmMount === undefined ? adapter : undefined,
    attachments: ctx.get('attachments') as MemoryAttachmentStore | undefined,
    updates,
    sessionUpdates,
    permissionRequests,
    persistenceRoot,
    onPermission: () => ({ outcome: { outcome: 'cancelled' } }),
    url,
    secret,
    dispose: async () => {
      await ctx.fiber.dispose()
      if (ownsPersistenceRoot) await rm(persistenceRoot, { recursive: true, force: true })
    },
  }

  await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION })
  if (options.authenticate !== false) {
    const token = AcpNetworkPlugin.signHmacToken(secret, 'test-subject', 'dsh-acp')
    await harness.client.authenticate({ methodId: 'bearer', _meta: { token } })
  }

  return harness
}
