/**
 * ACP face of dsh session-log export (S55): three dsh extension methods that
 * stream the same ZIP artifact the host webserver serves at
 * `/api/session.export` along the ACP connection. ACP 1.4.0 has no export
 * method and both transports carry JSON text only, so the archive rides
 * pull-based chunked reads: `export_begin` opens a per-connection cursor over
 * the producer's byte stream, `export_read` returns at most one configured
 * chunk as canonical base64 until `eof`, and `export_cancel` aborts the
 * producer. Pull-based reads are the flow control — the client's read pace
 * gates the producer through the existing response capacity gate, and a
 * disconnected client restarts with a fresh `export_begin` (point-in-time
 * snapshot semantics, no resume).
 *
 * Authorization is the bridge's owned-session map: only sessions the calling
 * connection created or resumed are exportable, and the artifact is the full
 * raw session log (strictly more than the projected wire view), matching what
 * the browser download exposes to an equally trusted caller.
 *
 * @module @deepseek-ai/dsh-acp/export
 */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { RequestError } from '@agentclientprotocol/sdk'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  flushLiveSessionLog,
  readSessionLogText,
  sessionLogExportDeps,
  sessionLogZipFilename,
  streamSessionLogZip,
  type SessionLogCompressionLevel,
  type SessionLogExportReady,
} from '@deepseek-ai/dsh-session-log-export'

/** ACP method name that opens one export cursor (a dsh extension; ACP 1.4.0 has no export method). */
export const EXPORT_BEGIN_METHOD = 'session/export_begin'

/** ACP method name that pulls one chunk from an open export cursor. */
export const EXPORT_READ_METHOD = 'session/export_read'

/** ACP method name that aborts an open export cursor. */
export const EXPORT_CANCEL_METHOD = 'session/export_cancel'

/** Opaque per-connection export cursor id minted at `export_begin`. */
export type SessionExportId = Branded<'SessionExportId'>

/** Default raw-byte ceiling for one `session/export_read` response. */
export const DEFAULT_EXPORT_CHUNK_BYTES = 262144

/** Smallest accepted `exportChunkBytes` config value. */
export const MIN_EXPORT_CHUNK_BYTES = 16384

/** Largest accepted `exportChunkBytes` config value. */
export const MAX_EXPORT_CHUNK_BYTES = 4194304

/** Parsed `session/export_begin` request params. */
export interface AcpExportBeginRequest {
  /** The bridge-owned session whose point-in-time snapshot is exported. */
  readonly sessionId: string
  /** Whether descendant subagent logs join the archive (defaults to false). */
  readonly includeDescendants: boolean
}

/** The `session/export_begin` response: the cursor to read and the archive filename. */
export interface AcpExportBeginResponse {
  /** Opaque cursor id passed to `export_read`/`export_cancel`. */
  readonly exportId: string
  /** Canonical archive filename (`dsh-session-<id>.zip`). */
  readonly filename: string
}

/** Parsed `session/export_read` / `session/export_cancel` request params. */
export interface AcpExportCursorRequest {
  /** The cursor id returned by `export_begin`. */
  readonly exportId: string
}

/** The `session/export_read` response: one canonical base64 chunk and its terminal flag. */
export interface AcpExportReadResponse {
  /** Canonical base64 of at most the configured chunk bytes; empty only at `eof`. */
  readonly data: string
  /** Terminal delivery: the cursor is finished and removed after this response. */
  readonly eof: boolean
}

/** The `session/export_cancel` response: success carries no fields. */
export type AcpExportCancelResponse = Record<string, never>

/**
 * Validate raw `session/export_begin` JSON-RPC params.
 * @param params - the untyped wire params.
 * @returns the parsed request with `includeDescendants` defaulted to false.
 * @throws RequestError invalid params when the shape is not `{ sessionId: string, includeDescendants?: boolean }`.
 */
export function parseExportBeginRequest(params: unknown): AcpExportBeginRequest {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw RequestError.invalidParams(undefined, 'session/export_begin params must be an object with a sessionId')
  }
  const { sessionId, includeDescendants } = params as {
    sessionId?: unknown
    includeDescendants?: unknown
  }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw RequestError.invalidParams(undefined, 'session/export_begin requires a non-empty sessionId string')
  }
  if (includeDescendants !== undefined && typeof includeDescendants !== 'boolean') {
    throw RequestError.invalidParams(undefined, 'session/export_begin includeDescendants must be a boolean')
  }
  return { sessionId, includeDescendants: includeDescendants === true }
}

/**
 * Validate raw `session/export_read` / `session/export_cancel` JSON-RPC params.
 * @param params - the untyped wire params.
 * @returns the parsed request.
 * @throws RequestError invalid params when the shape is not `{ exportId: string }`.
 */
export function parseExportCursorRequest(params: unknown): AcpExportCursorRequest {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw RequestError.invalidParams(undefined, 'session export cursor params must be an object with an exportId')
  }
  const { exportId } = params as { exportId?: unknown }
  if (typeof exportId !== 'string' || exportId.length === 0) {
    throw RequestError.invalidParams(undefined, 'session export requires a non-empty exportId string')
  }
  return { exportId }
}

/** The invalid-params error for a cursor that never existed or already reached a terminal state. */
/**
 * The `unknown_cursor` wire error: `Invalid params` with the vocabulary code.
 * @returns the RequestError to throw for reads and cancels on retired cursors.
 */
export function unknownExportCursor(): RequestError {
  return RequestError.invalidParams({ code: 'unknown_cursor' }, 'export cursor is unknown or already finished')
}

/**
 * Map a failed read onto its wire error. A cancelled cursor (the abort raced
 * an in-flight read) is indistinguishable from an unknown one because the
 * terminal state deletes the cursor; every other producer failure is a
 * sanitized `export_failed` internal error — producer messages can carry host
 * filesystem detail and never reach the wire.
 * @param error - the read failure.
 * @returns the JSON-RPC error carrying the wire vocabulary.
 */
export function sessionExportReadWireError(error: unknown): RequestError {
  if (error instanceof RequestError) return error
  if (error instanceof SessionExportAbortedError) return unknownExportCursor()
  return RequestError.internalError({ code: 'export_failed' }, 'session export stream failed')
}

/**
 * Map a failed begin onto its wire error. Params and the `not_found` root
 * error are already `RequestError`s; any other producer-side failure (service
 * resolution, flush, root read) becomes a generic internal error.
 * @param error - the begin failure.
 * @returns the JSON-RPC error carrying the wire vocabulary.
 */
export function sessionExportBeginWireError(error: unknown): RequestError {
  if (error instanceof RequestError) return error
  return RequestError.internalError({ code: 'export_failed' }, 'session export failed before any byte was delivered')
}

/** Sentinel for a read that lost the race against `export_cancel` or connection teardown. */
class SessionExportAbortedError extends Error {}

/** One open export: its chunked reader, filename, and cancellation owner. */
export class SessionExportCursor {
  private chunks: Uint8Array[] = []
  private chunked = 0
  private sourceDone = false

  constructor(
    /** Opaque cursor id returned to the client. */
    readonly id: SessionExportId,
    /** Canonical archive filename returned to the client. */
    readonly filename: string,
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    /** Cancellation owner; aborting it terminates the producer without a truncated archive. */
    readonly abort: AbortController,
  ) {}

  /**
   * Pull up to `limit` raw bytes off the producer and encode them. Never
   * exceeds `limit` regardless of producer chunk sizes; the terminal response
   * (`eof: true`) carries the remaining bytes or an empty payload and may only
   * follow the producer's clean end.
   * @param limit - maximum raw bytes in this response.
   * @returns the base64 chunk with its terminal flag.
   */
  async read(limit: number): Promise<AcpExportReadResponse> {
    if (this.abort.signal.aborted) throw new SessionExportAbortedError()
    while (!this.sourceDone && this.chunked < limit) {
      const next = await this.reader.read()
      if (next.done) {
        this.sourceDone = true
        break
      }
      this.chunks.push(next.value)
      this.chunked += next.value.byteLength
    }
    if (this.chunked === 0) {
      return { data: '', eof: true }
    }
    const flat = Buffer.concat(this.chunks)
    const take = Math.min(limit, flat.byteLength)
    const rest = flat.subarray(take)
    this.chunks = rest.byteLength > 0 ? [rest] : []
    this.chunked = rest.byteLength
    return { data: flat.subarray(0, take).toString('base64'), eof: this.sourceDone && this.chunked === 0 }
  }

  /** Abort the producer and drop buffered bytes. The cursor leaves the registry before this runs. */
  cancel(): void {
    this.abort.abort()
    this.chunks = []
    this.chunked = 0
    this.sourceDone = true
    // Teardown races the producer's own abort error; the loser's rejection is expected.
    void this.reader.cancel().catch(() => undefined)
  }
}

/** Per-connection registry of open export cursors; terminal states delete entries immediately. */
export class SessionExportRegistry {
  private readonly cursors = new Map<string, SessionExportCursor>()

  /**
   * Register one freshly opened cursor.
   * @param cursor - the cursor created from the export producer's byte stream.
   */
  add(cursor: SessionExportCursor): void {
    this.cursors.set(cursor.id, cursor)
  }

  /**
   * Look up a cursor without removing it.
   * @param id - the client-presented cursor id.
   * @returns the cursor, or undefined when unknown or already finished.
   */
  get(id: string): SessionExportCursor | undefined {
    return this.cursors.get(id)
  }

  /**
   * Remove a cursor, returning it for cancellation.
   * @param id - the client-presented cursor id.
   * @returns the removed cursor, or undefined when unknown or already finished.
   */
  take(id: string): SessionExportCursor | undefined {
    const cursor = this.cursors.get(id)
    if (cursor !== undefined) this.cursors.delete(id)
    return cursor
  }

  /** Abort every open cursor and clear the registry (connection teardown). */
  abortAll(): void {
    for (const cursor of this.cursors.values()) cursor.cancel()
    this.cursors.clear()
  }
}

/**
 * Open one export cursor for a bridge-owned session: flush the live log,
 * pre-read the root log (a missing root answers before any byte exists), and
 * start the producer over the same pipeline as the HTTP download route.
 * @param ctx - ACP plugin context whose export services are read on demand.
 * @param registry - the connection's cursor registry.
 * @param request - the parsed begin request.
 * @param compressionLevel - DEFLATE level from the deployment config.
 * @param signal - cancellation observed around the flush and root-read barrier.
 * @returns the cursor id and canonical filename.
 * @throws RequestError internal `not_found` when the session has no persisted log.
 * @throws Error naming the absent service when the composition mounts neither
 *   session-query, session-persistence, nor attachments.
 */
export async function beginSessionExport(
  ctx: Context,
  registry: SessionExportRegistry,
  request: AcpExportBeginRequest,
  compressionLevel: SessionLogCompressionLevel,
  signal: AbortSignal,
): Promise<AcpExportBeginResponse> {
  const deps = sessionLogExportDeps(ctx)
  const absent =
    deps.sessionQuery === undefined || deps.sessionPersistence === undefined || deps.attachments === undefined
  if (absent) {
    throw new Error(
      'session export is unavailable: the composition must mount @deepseek-ai/dsh-session-query, @deepseek-ai/dsh-session-persistence, and @deepseek-ai/dsh-attachment',
    )
  }
  const sessionId = brandString<SessionId>(request.sessionId)
  await flushLiveSessionLog(deps, sessionId, signal)
  const rootContent = await readSessionLogText(deps.sessionPersistence, sessionId, signal)
  if (rootContent === undefined) {
    throw RequestError.internalError({ code: 'not_found' }, `session "${sessionId}" has no exportable log`)
  }
  const ready: SessionLogExportReady = {
    sessionQuery: deps.sessionQuery,
    sessionPersistence: deps.sessionPersistence,
    attachments: deps.attachments,
    sessions: deps.sessions,
  }
  const abort = new AbortController()
  const stream = streamSessionLogZip(ready, rootContent, sessionId, request.includeDescendants, compressionLevel, abort.signal)
  const id = brandString<SessionExportId>(randomUUID())
  const cursor = new SessionExportCursor(id, sessionLogZipFilename(sessionId), stream.getReader(), abort)
  registry.add(cursor)
  return { exportId: cursor.id, filename: cursor.filename }
}
