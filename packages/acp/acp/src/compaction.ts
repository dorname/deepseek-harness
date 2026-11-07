/**
 * ACP face of dsh session compaction (S52): the dsh extension method
 * `session/compact` and its wire vocabulary. ACP 1.4.0 has no compaction
 * request method, so the method name, params, and response fields are dsh
 * extensions documented in the package README and the upgrade guide; the
 * lifecycle notifications ride the SDK's UNSTABLE `compaction_update` type
 * behind the client's `session.compaction` capability.
 *
 * Execution semantics are entirely the compaction engine's: this module only
 * validates params, maps the classified failures onto JSON-RPC internal error
 * `data.code`, and shapes the response.
 *
 * @module @deepseek-ai/dsh-acp/compaction
 */

import { RequestError, type ContentBlock } from '@agentclientprotocol/sdk'
import { manualCompactionFailureText } from '@deepseek-ai/dsh-command-compact'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'

/** ACP method name for explicit session compaction (a dsh extension; ACP 1.4.0 has no compaction request). */
export const COMPACTION_METHOD = 'session/compact'

/** Parsed `session/compact` request params. */
export interface AcpCompactionRequest {
  /** The bridge-owned session to compact. */
  readonly sessionId: string
}

/** One successful explicit compaction's statistics and retained summary. */
export interface AcpCompactionResult {
  /** Stable identity shared by this compaction's complete durable lifecycle. */
  readonly compactionId: string
  /** The seq of the committed `compaction/summary` event. */
  readonly summarySeq: number
  /** How many surface nodes the summary replaced. */
  readonly shadowedCount: number
  /** Estimated token count of the replaced content. */
  readonly shadowedTokenCount: number
  /** The retained summary content blocks. */
  readonly summary: readonly ContentBlock[]
}

/** The `session/compact` response. `null` means no compactable history existed (not an error). */
export interface AcpCompactionResponse {
  readonly result: AcpCompactionResult | null
}

/**
 * Validate raw `session/compact` JSON-RPC params.
 * @param params - the untyped wire params.
 * @returns the parsed request.
 * @throws RequestError invalid params when the shape is not `{ sessionId: string }`.
 */
export function parseCompactionRequest(params: unknown): AcpCompactionRequest {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw RequestError.invalidParams(undefined, 'session/compact params must be an object with a sessionId')
  }
  const { sessionId } = params as { sessionId?: unknown }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw RequestError.invalidParams(undefined, 'session/compact requires a non-empty sessionId string')
  }
  return { sessionId }
}

/**
 * Map one failed manual compaction onto its wire error. The six classified
 * engine failures carry their code in `data.code` and reuse the `/compact`
 * command's human text as the message; an aborted request maps to
 * `cancelled`, whose notification form does not exist because the durable
 * `compaction/end` error text does not distinguish cancellation.
 * @param error - the compaction failure (classified or an abort rejection).
 * @returns the JSON-RPC internal error carrying the wire vocabulary.
 */
export function sessionCompactWireError(error: unknown): RequestError {
  if (error instanceof ManualCompactionError) {
    return RequestError.internalError({ code: error.code }, manualCompactionFailureText(error))
  }
  return RequestError.internalError({ code: 'cancelled' }, 'Compaction cancelled.')
}
