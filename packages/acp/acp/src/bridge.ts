/**
 * Reusable ACP bridge for one JSON-RPC connection.
 *
 * The bridge exposes persistent harness sessions to one trusted programmatic
 * client. Multiple bridges may coexist in the same Cordis context; each bridge
 * owns only the sessions it created or resumed, and global events are filtered
 * by exact Agent/Session identity. This makes the stdio server and per-socket
 * network servers share the same session lifecycle code.
 *
 * @module @deepseek-ai/dsh-acp/bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { errorChain } from '@deepseek-ai/dsh-llm'
import {
  agent as createAcpAgentApp,
  methods,
  PROTOCOL_VERSION,
  RequestError,
  type AgentContext,
  type AuthenticateRequest,
  type CancelNotification,
  type CloseSessionRequest,
  type CloseSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type SessionNotification,
  type Stream,
} from '@agentclientprotocol/sdk'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
// Side-effect type import: declaration-merges the approval waterfall answered below.
import type {} from '@deepseek-ai/dsh-user-approval'
// Side-effect type import: declaration-merges the plan-mode controller read below.
import type {} from '@deepseek-ai/dsh-plan-mode'
// Side-effect type import: declaration-merges the review waterfall answered below.
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  COMPACTION_METHOD,
  parseCompactionRequest,
  sessionCompactWireError,
  type AcpCompactionResponse,
} from './compaction.ts'
import { supportsAcpImagePrompts } from './content.ts'
import { AcpMcpConfigError } from './mcp.ts'
import { AcpModelConfigError } from './model-control.ts'
import { AcpPermissionConfigError } from './permission-control.ts'
import {
  answerPlanReview,
  parseSessionModeId,
  planReviewPermissionOptions,
  type RequestPermissionOutcome,
} from './plan-mode.ts'
import {
  parseSkillsListRequest,
  SKILLS_LIST_METHOD,
  type AcpSkillList,
} from './skill-list.ts'
import { AcpSession } from './session.ts'

const DEFAULT_SESSION_LIST_PAGE_SIZE = 100

/** Core services required by the standard automation controls. */
export const inject = ['agents', 'llm', 'sessionPersistence', 'sessions']

/** Plugin config: the provider/model selection used for each ACP-created agent. */
export interface AcpConfig {
  /** Provider route for created agents. */
  provider?: string
  /** Model name for created agents. */
  model?: string
  /** Maximum summaries returned by one session/list page. */
  sessionListPageSize?: number
}

/** Runtime-only transport override; production uses stdio or a network plugin. */
export const Config: Schema<AcpConfig> = Schema.object({
  provider: Schema.string(),
  model: Schema.string(),
  sessionListPageSize: Schema.natural().min(1).default(DEFAULT_SESSION_LIST_PAGE_SIZE),
})

/** Validates credentials presented by a network client. Return void if valid. */
export type Authenticator = (request: AuthenticateRequest) => Promise<void>

/** Options for creating a bridge beyond the public Config schema. */
export interface AcpBridgeOptions extends AcpConfig {
  /** Optional authenticator for network transports; stdio omits it. */
  authenticate?: Authenticator
  /** Optional capability overrides; defaults advertise resume/list/close. */
  capabilities?: {
    /** Whether `session/load` is advertised; stdio defaults to true. */
    loadSession?: boolean
  }
}

/** ACP connection handle returned by {@link AcpBridge.connect}. */
export interface AcpConnection {
  /** The SDK client context used to send notifications and permission requests. */
  readonly client: AgentContext
  /** Resolves when the underlying transport closes. */
  readonly closed: Promise<void>
  /** Initiates quiescent teardown of all bridge-owned sessions. */
  close(): Promise<void>
}

/** Preserve invalid-parameter detail in the SDK wire error message. */
function invalidParams(detail: string): RequestError {
  return RequestError.invalidParams(undefined, detail)
}

/** Preserve failed-turn detail; plain handler errors become a generic wire internal error. */
function internalError(detail: string): RequestError {
  return RequestError.internalError(undefined, detail)
}

/** Standard automation-only ACP bridge for one client connection. */
export class AcpBridge {
  private readonly ctx: Context
  private readonly config: AcpBridgeOptions
  private readonly persistence: Context['sessionPersistence']
  private readonly logger: Context['logger']
  private readonly sessionListPageSize: number
  private readonly sessions = new Map<SessionId, AcpSession>()
  private readonly activating = new Set<SessionId>()
  private closed = false
  private imagePromptEnabled = false

  constructor(ctx: Context, config: AcpBridgeOptions) {
    this.ctx = ctx
    this.config = config
    this.persistence = ctx.sessionPersistence
    this.logger = ctx.logger
    this.sessionListPageSize = resolveSessionListPageSize(config.sessionListPageSize)

    ctx.on('session/event', (session, event) => {
      const record = this.sessions.get(session.header.id)
      if (record?.ownsSession(session) === true) record.onSessionEvent(session, event)
    })

    ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
      this.ownedRecord(agent)?.onInboxClaimed(message, turn)
    })

    ctx.on('agent/error', ({ agent, turn, error }) => {
      this.ownedRecord(agent)?.onAgentError(turn, error)
    })

    ctx.on('llm/adapters-updated', () => {
      for (const record of this.sessions.values()) record.topologyChanged()
    })
  }

  /**
   * Connect this bridge to one transport stream.
   * @param stream - Framed JSON-RPC byte stream owned by the connection until it closes.
   * @returns The connection driving session traffic over the stream.
   */
  connect(stream: Stream): AcpConnection {
    if (this.closed) throw new Error('ACP bridge has been disposed')

    let quiescing: Promise<void> | undefined

    const assertOpen = (): void => {
      if (this.closed) throw internalError('the ACP bridge has been disposed')
    }

    const requireSession = (sessionId: SessionId): AcpSession => {
      const record = this.sessions.get(sessionId)
      if (record === undefined) throw invalidParams(`unknown session: ${sessionId}`)
      return record
    }

    const clientConnRef: { current: AgentContext | undefined } = { current: undefined }

    // The client capability declaration arrives at initialize, before any
    // session exists; sessions created on this connection carry the flag so
    // their compaction updates stay inside the declaring connection.
    let clientCompactionUpdates = false

    const notify = async (notification: SessionNotification): Promise<void> => {
      const clientConn = clientConnRef.current
      if (clientConn === undefined) return
      try {
        await clientConn.notify(methods.client.session.update, notification)
      /* v8 ignore start -- the ACP SDK contains notification-handler failures; only a transport write failure reaches this guard. */
      } catch (error: unknown) {
        this.logger.warn(`acp: session/update failed: ${String(error)}`)
      }
      /* v8 ignore stop */
    }

    const implementation = {
      initialize: async (params: InitializeRequest): Promise<InitializeResponse> => {
        this.imagePromptEnabled = await supportsAcpImagePrompts(this.ctx, this.config.provider, this.config.model)
        clientCompactionUpdates = params.clientCapabilities?.session?.compaction != null
        const response: InitializeResponse = {
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' },
          agentCapabilities: {
            mcpCapabilities: { http: true },
            promptCapabilities: { image: this.imagePromptEnabled, audio: false, embeddedContext: false },
            sessionCapabilities: {
              close: {},
              list: {},
              resume: {},
              ...this.config.capabilities?.loadSession === true ? { load: {} } : {},
            },
          },
          authMethods: [],
        }
        return response
      },

      authenticate: async (params: AuthenticateRequest): Promise<void> => {
        await this.config.authenticate?.(params)
      },

      newSession: async (params: NewSessionRequest, signal: AbortSignal): Promise<NewSessionResponse> => {
        assertOpen()
        validateWorkspaceParams(params)
        const sessionId = brandString<SessionId>(randomUUID())
        let record: AcpSession
        try {
          record = await AcpSession.create(this.ctx, {
            sessionId,
            cwd: params.cwd,
            mcpServers: params.mcpServers,
            agentOptions: agentOptions(this.config),
            fallbackSelection: initialSelection(this.config),
            signal,
            notify,
            compactionUpdates: clientCompactionUpdates,
          })
        } catch (error: unknown) {
          if (error instanceof AcpMcpConfigError) throw invalidParams(error.message)
          throw error
        }
        /* v8 ignore next 4 -- a real transport close can race an in-flight create. */
        if (this.closed) {
          await record.close('connection closed during session/new')
          throw internalError('connection closed during session/new')
        }
        this.sessions.set(sessionId, record)
        try {
          const configOptions = await record.configOptions(signal)
          const modes = record.modes()
          assertOpen()
          await this.ctx.sessions.flush(record.agent.session)
          assertOpen()
          return { sessionId, configOptions, ...modes === undefined ? {} : { modes } }
        } catch (error: unknown) {
          this.sessions.delete(sessionId)
          await record.close('session/new activation failed')
          throw error
        }
      },

      resumeSession: async (params: ResumeSessionRequest, signal: AbortSignal): Promise<ResumeSessionResponse> => {
        assertOpen()
        validateWorkspaceParams(params)
        const sessionId = brandString<SessionId>(params.sessionId)
        if (this.sessions.has(sessionId) || this.activating.has(sessionId) || this.ctx.sessions.get(sessionId) !== undefined) {
          throw invalidParams(`session is already active: ${sessionId}`)
        }
        this.activating.add(sessionId)
        return (async (): Promise<ResumeSessionResponse> => {
          const persisted = (await this.persistence.stat(sessionId, { signal }))?.header
          if (persisted === undefined || persisted.origin === 'subagent' || persisted.parentSession !== undefined) {
            throw invalidParams(`session is not resumable: ${sessionId}`)
          }
          if (!await sameDirectory(persisted.cwd, params.cwd)) {
            throw invalidParams(`session cwd does not match: ${params.cwd}`)
          }
          let record: AcpSession
          try {
            record = await AcpSession.resume(this.ctx, {
              sessionId,
              cwd: params.cwd,
              mcpServers: params.mcpServers ?? [],
              agentOptions: agentOptions(this.config),
              fallbackSelection: initialSelection(this.config),
              signal,
              notify,
              compactionUpdates: clientCompactionUpdates,
            })
          } catch (error: unknown) {
            if (error instanceof AcpMcpConfigError) throw invalidParams(error.message)
            throw error
          }
          /* v8 ignore start -- the persisted header was checked before resume; the factory restores that exact header. */
          if (!await sameDirectory(record.agent.session.header.cwd, params.cwd)) {
            await record.close('session/resume cwd mismatch')
            throw invalidParams(`session cwd does not match: ${params.cwd}`)
          }
          /* v8 ignore stop */
          /* v8 ignore next 4 -- a real transport close can race an in-flight resume. */
          if (this.closed) {
            await record.close('connection closed during session/resume')
            throw internalError('connection closed during session/resume')
          }
          this.sessions.set(sessionId, record)
          try {
            const configOptions = await record.configOptions(signal)
            const modes = record.modes()
            return { configOptions, ...modes === undefined ? {} : { modes } }
          } catch (error: unknown) {
            this.sessions.delete(sessionId)
            await record.close('session/resume option discovery failed')
            throw error
          }
        })().finally(() => { this.activating.delete(sessionId) })
      },

      listSessions: async (params: ListSessionsRequest, signal: AbortSignal): Promise<ListSessionsResponse> => {
        assertOpen()
        if (params.cwd !== undefined && params.cwd !== null && !isAbsolute(params.cwd)) {
          throw invalidParams(`cwd must be an absolute path: ${params.cwd}`)
        }
        let cursor: SessionListCursor | undefined
        try {
          cursor = decodeSessionListCursor(params.cursor)
        } catch (error: unknown) {
          throw invalidParams((error as Error).message)
        }
        const listed = await this.persistence.list({ signal })
        const filtered = await Promise.all(listed.map(async ({ header }) => {
          if (
            this.sessions.has(header.id)
              || this.activating.has(header.id)
              || this.ctx.sessions.get(header.id) !== undefined
              || header.origin === 'subagent'
              || header.parentSession !== undefined
              || header.cwd === undefined
              || !isAbsolute(header.cwd)
          ) return undefined
          if (params.cwd !== undefined && params.cwd !== null && !await sameDirectory(header.cwd, params.cwd)) {
            return undefined
          }
          return { sessionId: header.id, cwd: header.cwd, createdAt: header.createdAt }
        }))
        const entries = filtered
          .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
          .sort((left, right) => right.createdAt - left.createdAt || compareSessionIds(left.sessionId, right.sessionId))
        const remaining = cursor === undefined
          ? entries
          : entries.filter(entry => isAfterSessionListCursor(entry, cursor))
        const page = remaining.slice(0, this.sessionListPageSize)
        const next = remaining.length > page.length ? page.at(-1) : undefined
        return {
          sessions: page.map(({ sessionId, cwd }) => ({ sessionId, cwd })),
          ...next === undefined ? {} : { nextCursor: encodeSessionListCursor(next) },
        }
      },

      setSessionConfigOption: async (
        params: SetSessionConfigOptionRequest,
        signal: AbortSignal,
      ): Promise<SetSessionConfigOptionResponse> => {
        assertOpen()
        const record = requireSession(brandString<SessionId>(params.sessionId))
        try {
          return { configOptions: await record.setConfig(params.configId, params.value, signal) }
        } catch (error: unknown) {
          if (error instanceof AcpModelConfigError) throw invalidParams(error.message)
          if (error instanceof AcpPermissionConfigError) throw invalidParams(error.message)
          throw error
        }
      },

      skillsList: async (params: { sessionId: string }): Promise<AcpSkillList> => {
        assertOpen()
        const record = requireSession(brandString<SessionId>(params.sessionId))
        try {
          return await record.skills()
        } catch (error: unknown) {
          if (error instanceof RequestError) throw error
          throw internalError(`skills list failed: ${errorChain(error)}`)
        }
      },

      setSessionMode: async (params: SetSessionModeRequest): Promise<SetSessionModeResponse> => {
        assertOpen()
        const record = requireSession(brandString<SessionId>(params.sessionId))
        const modeId = parseSessionModeId(params.modeId)
        try {
          record.setMode(modeId)
          // The committed-state update is the effect fact: enqueue it before
          // the response write so clients observe the new mode first.
          await record.drainUpdates()
        } catch (error: unknown) {
          if (error instanceof RequestError) throw error
          throw internalError(`session mode change failed: ${errorChain(error)}`)
        }
        return {}
      },

      compactSession: async (params: { sessionId: string }, signal: AbortSignal): Promise<AcpCompactionResponse> => {
        assertOpen()
        const record = requireSession(brandString<SessionId>(params.sessionId))
        // ACP clients have no command channel, so the bridge mints the durable
        // transaction's sourceCommandId to mark itself as the initiator.
        const sourceCommandId = brandString<CommandId>(`acp-${randomUUID()}`)
        try {
          return await record.compact(sourceCommandId, signal)
        } catch (error: unknown) {
          if (error instanceof RequestError) throw error
          if (error instanceof ManualCompactionError || signal.aborted) throw sessionCompactWireError(error)
          throw internalError(`session compaction failed: ${errorChain(error)}`)
        }
      },

      closeSession: async (params: CloseSessionRequest): Promise<CloseSessionResponse> => {
        assertOpen()
        const sessionId = brandString<SessionId>(params.sessionId)
        const record = requireSession(sessionId)
        try {
          await record.close('ACP session closed')
        } catch (error: unknown) {
          throw internalError(`session close failed: ${errorChain(error)}`)
        } finally {
          if (this.sessions.get(sessionId) === record) this.sessions.delete(sessionId)
        }
        return {}
      },

      prompt: async (params: PromptRequest, requestSignal: AbortSignal): Promise<PromptResponse> => {
        assertOpen()
        const record = requireSession(brandString<SessionId>(params.sessionId))
        return record.prompt(params, this.imagePromptEnabled, requestSignal)
      },

      cancel: (params: CancelNotification): Promise<void> => {
        this.sessions.get(brandString<SessionId>(params.sessionId))?.cancel()
        return Promise.resolve()
      },
    }

    const app = createAcpAgentApp({ name: 'deepseek-harness-acp' })
      .onRequest(methods.agent.initialize, ({ params }) => implementation.initialize(params))
      .onRequest(methods.agent.authenticate, async ({ params }) => {
        await implementation.authenticate(params)
        return {}
      })
      .onRequest(methods.agent.session.new, ({ params, signal }) => implementation.newSession(params, signal))
      .onRequest(methods.agent.session.list, ({ params, signal }) => implementation.listSessions(params, signal))
      .onRequest(methods.agent.session.resume, ({ params, signal }) => implementation.resumeSession(params, signal))
      .onRequest(methods.agent.session.close, ({ params }) => implementation.closeSession(params))
      .onRequest(methods.agent.session.setConfigOption, ({ params, signal }) => implementation.setSessionConfigOption(params, signal))
      .onRequest(methods.agent.session.prompt, ({ params, signal }) => implementation.prompt(params, signal))
      // dsh extension: ACP 1.4.0 has no skill surface, so the catalog rides an
      // extension method with an explicit params parser (see SKILLS_LIST_METHOD).
      .onRequest(SKILLS_LIST_METHOD, parseSkillsListRequest, ({ params }) => implementation.skillsList(params))
      .onRequest(methods.agent.session.setMode, ({ params }) => implementation.setSessionMode(params))
      // dsh extension: ACP 1.4.0 has no compaction request method; execution
      // semantics and every policy stay inside the composed engine (S52).
      .onRequest(COMPACTION_METHOD, parseCompactionRequest, ({ params, signal }) => implementation.compactSession(params, signal))
      .onNotification(methods.agent.session.cancel, ({ params }) => implementation.cancel(params))

    // Permission requests are a machine policy channel for ACP clients such as
    // dsh-subagent-acp. The bridge offers one-shot choices only and never infers a
    // durable grant from an unknown client response.
    const approvalOff = this.ctx.on('approval/request', (request, next) => {
      const record = this.ownedRecord(request.agent)
      if (record === undefined || request.callId === undefined) return next()
      const callId = request.callId
      return record.drainUpdates().then((): Promise<RequestPermissionResponse | 'cancelled'> => {
        const clientConn = clientConnRef.current
        if (clientConn === undefined) return Promise.resolve('cancelled' as const)
        const params: RequestPermissionRequest = {
          sessionId: record.agent.session.id,
          toolCall: { toolCallId: callId },
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ],
        }
        return clientConn.request(methods.client.session.requestPermission, params)
      }).then((response) => {
        if (response === 'cancelled' || response.outcome.outcome === 'cancelled') return 'cancelled'
        return response.outcome.optionId === 'allow-once' ? 'allowed-once' : 'rejected'
      })
    })

    // Plan reviews (exit_plan_mode) are the one user-questions intent this
    // bridge answers: they ride the standard permission channel with the
    // approve/keep-planning option vocabulary. Every other question keeps the
    // no-answerer behavior reserved for the full userQuestions channel.
    const sendPermission = (
      sessionId: string,
      callId: string,
      approveLabel: string,
      declineLabel: string,
    ): Promise<RequestPermissionOutcome> => {
      const clientConn = clientConnRef.current
      if (clientConn === undefined) return Promise.resolve({ kind: 'cancelled' })
      const params: RequestPermissionRequest = {
        sessionId,
        toolCall: { toolCallId: callId },
        options: planReviewPermissionOptions(approveLabel, declineLabel),
      }
      return clientConn.request(methods.client.session.requestPermission, params).then(response => (
        response.outcome.outcome === 'cancelled'
          ? { kind: 'cancelled' }
          : { kind: 'selected', optionId: response.outcome.optionId }
      ))
    }

    const questionsOff = this.ctx.on('user-questions/request', (request, next) => {
      if (request.agent === undefined) return next()
      const record = this.ownedRecord(request.agent)
      if (record === undefined) return next()
      return answerPlanReview(record, request, next, sendPermission)
    })

    const connection = app.connect(stream)
    clientConnRef.current = connection.client

    const quiesce = (): Promise<void> => {
      if (quiescing !== undefined) return quiescing
      this.closed = true
      approvalOff()
      questionsOff()
      const records = [...this.sessions.values()]
      quiescing = (async () => {
        const disposals = await Promise.allSettled(records.map(record => record.close('ACP bridge disposed')))
        for (const record of records) {
          /* v8 ignore next -- closed blocks concurrent handlers; each captured record remains mapped until this loop. */
          if (this.sessions.get(record.agent.session.id) === record) this.sessions.delete(record.agent.session.id)
        }
        const failures: unknown[] = []
        for (const result of disposals) {
          if (result.status === 'rejected') failures.push(result.reason as unknown)
        }
        if (failures.length > 0) {
          const detail = failures.map(failure => errorChain(failure)).join('; ')
          throw new AggregateError(
            failures,
            `ACP agent teardown failed for ${failures.length} session(s): ${detail}`,
          )
        }
      })()
      return quiescing
    }

    /* v8 ignore start -- production transport rejection and teardown failure. */
    const closed = connection.closed
      .catch((error: unknown) => {
        this.logger.warn(`acp: connection closed with an error: ${String(error)}`)
      })
      .then(quiesce)
      .catch((error: unknown) => {
        this.logger.warn(`acp: connection-close teardown failed: ${String(error)}`)
      })
    /* v8 ignore stop */

    return {
      client: clientConnRef.current,
      closed,
      close: quiesce,
    }
  }

  /** Dispose every owned session. Used when the hosting plugin shuts down. */
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const records = [...this.sessions.values()]
    const disposals = await Promise.allSettled(records.map(record => record.close('ACP bridge disposed')))
    this.sessions.clear()
    const failures: unknown[] = []
    for (const result of disposals) {
      if (result.status === 'rejected') failures.push(result.reason as unknown)
    }
    if (failures.length > 0) {
      const detail = failures.map(failure => errorChain(failure)).join('; ')
      throw new AggregateError(failures, `ACP bridge disposal failed for ${failures.length} session(s): ${detail}`)
    }
  }

  /** Return the bridge-owned record for an agent, rejecting same-id impostors. */
  private ownedRecord(agent: Parameters<AcpSession['owns']>[0]): AcpSession | undefined {
    const record = this.sessions.get(agent.session.id)
    return record?.owns(agent) === true ? record : undefined
  }
}

/** Build per-agent options from plugin config without assigning absent optional fields. */
function agentOptions(config: AcpConfig): { provider?: string; model?: string } {
  return {
    ...config.provider !== undefined ? { provider: config.provider } : {},
    ...config.model !== undefined ? { model: config.model } : {},
  }
}

/** Initial session selection when both deployment fields are present. */
function initialSelection(config: AcpConfig): ModelSelection | undefined {
  return config.provider === undefined || config.model === undefined
    ? undefined
    : { provider: config.provider, model: config.model }
}

interface SessionListCursor {
  createdAt: number
  sessionId: string
}

/** Resolve and validate the deployment-owned session page limit. */
function resolveSessionListPageSize(value: number | undefined): number {
  const resolved = value ?? DEFAULT_SESSION_LIST_PAGE_SIZE
  /* v8 ignore start -- Cordis applies the positive-integer Config schema; this protects direct apply callers. */
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error('acp: sessionListPageSize must be a positive safe integer')
  }
  /* v8 ignore stop */
  return resolved
}

/** Decode an opaque keyset cursor without assigning meaning to client metadata. */
function decodeSessionListCursor(value: string | null | undefined): SessionListCursor | undefined {
  if (value === undefined || value === null) return undefined
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('session/list cursor is invalid')
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    const createdAt: unknown = Array.isArray(decoded) ? decoded[0] : undefined
    const sessionId: unknown = Array.isArray(decoded) ? decoded[1] : undefined
    if (
      !Array.isArray(decoded)
      || decoded.length !== 2
      || typeof createdAt !== 'number'
      || !Number.isSafeInteger(createdAt)
      || createdAt < 0
      || typeof sessionId !== 'string'
      || sessionId.length === 0
    ) throw new Error('invalid cursor fields')
    const canonical = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')
    if (canonical !== value) throw new Error('non-canonical cursor')
    return { createdAt, sessionId }
  } catch (_invalidCursor) {
    throw new Error('session/list cursor is invalid')
  }
}

/** Encode the last returned ordering key as an opaque continuation token. */
function encodeSessionListCursor(entry: SessionListCursor): string {
  return Buffer.from(JSON.stringify([entry.createdAt, entry.sessionId]), 'utf8').toString('base64url')
}

/** Test whether an entry follows the cursor in newest-first list order. */
function isAfterSessionListCursor(entry: SessionListCursor, cursor: SessionListCursor): boolean {
  return entry.createdAt < cursor.createdAt
    || (entry.createdAt === cursor.createdAt && compareSessionIds(entry.sessionId, cursor.sessionId) > 0)
}

/** Compare opaque session ids by stable UTF-8 bytes, independent of process locale. */
function compareSessionIds(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

/** Reject workspace features outside the automation contract. */
function validateWorkspaceParams(params: { cwd: string; additionalDirectories?: string[] | null }): void {
  if (!isAbsolute(params.cwd)) throw invalidParams(`cwd must be an absolute path: ${params.cwd}`)
  if (
    params.additionalDirectories !== undefined
    && params.additionalDirectories !== null
    && params.additionalDirectories.length > 0
  ) {
    throw invalidParams('additionalDirectories is not supported')
  }
}

/** Compare existing directories by physical identity and missing paths lexically. */
async function sameDirectory(left: string | undefined, right: string): Promise<boolean> {
  if (left === undefined) return false
  try {
    const [realLeft, realRight] = await Promise.all([realpath(left), realpath(right)])
    return realLeft === realRight
  } catch (_unresolvablePath) {
    return resolve(left) === resolve(right)
  }
}
