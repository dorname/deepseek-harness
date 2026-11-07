/** S52: ACP session/compact over the real bridge — validation, failure mapping, capability-gated updates. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk'
import { manualCompactionFailureText } from '@deepseek-ai/dsh-command-compact'
import { ManualCompactionError, type ManualCompactionErrorCode } from '@deepseek-ai/dsh-compaction'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionSeq, type Session } from '@deepseek-ai/dsh-session'
import { COMPACTION_METHOD, parseCompactionRequest, sessionCompactWireError } from '../src/index.ts'
import {
  makeBridgeHarness,
  textResponse,
  type BridgeHarness,
  type CapturedUpdate,
  type ScriptedCompactionEngine,
} from './harness.ts'
import { reported } from './helpers/reporter.ts'

/** JSON-RPC codes the SDK maps wire errors onto. */
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

/** Report one case of this suite's OpenLogos ids from the wrapping `it`. */
function c(id: string, name: string, fn: () => Promise<void>): void {
  it(name, () => reported(id, fn))
}

/** Settle a rejected wire call into its RequestError, or undefined for anything else. */
function wireError<T>(call: PromiseLike<T> | T): Promise<RequestError | undefined> {
  return Promise.resolve(call).then(
    () => { throw new Error('expected the wire call to fail') },
    (error: unknown) => (error instanceof RequestError ? error : undefined),
  )
}

/** Capture a synchronous throw, or fail when the call returns. */
function syncError(call: () => unknown): unknown {
  try {
    call()
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected the call to throw')
}

/** The `compaction_update` updates observed so far, in delivery order. */
function compactionUpdates(harness: BridgeHarness) {
  return harness.updates.filter(
    (update): update is Extract<CapturedUpdate, { sessionUpdate: 'compaction_update' }> =>
      update.sessionUpdate === 'compaction_update',
  )
}

/** The live session behind a bridge-owned session id. */
function sessionOf(harness: BridgeHarness, sessionId: string): Session {
  return (harness.ctx.agents.get(SessionId(sessionId)) as Agent).session
}

/** The committed `compaction/*` log entries of a session. */
function compactionEvents(session: Session) {
  return session.snapshotEvents().filter(event => event.type.startsWith('compaction/'))
}

describe('ACP session compaction (S52)', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  c('UT-S52-01', 'validates params and routes an owned session onto the compaction engine', async () => {
    harness = await makeBridgeHarness({ compaction: 'stub', compactionOutcomes: [{ kind: 'result', result: null }] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    expect(COMPACTION_METHOD).toBe('session/compact')

    const fresh = await harness.client.compact({ sessionId: created.sessionId })
    expect(fresh).toEqual({ result: null })
    const engine = harness.ctx.get('compaction') as ScriptedCompactionEngine
    expect(engine.calls).toHaveLength(1)
    expect(engine.calls[0]!.sourceCommandId).toMatch(/^acp-/)

    const unknownSession = await wireError(harness.client.compact({ sessionId: 'unknown-id' }))
    expect(unknownSession?.code).toBe(INVALID_PARAMS)
    expect(unknownSession?.message).toBe('Invalid params: unknown session: unknown-id')

    const emptyProbe = await wireError(harness.client.compact({} as { sessionId: string }))
    expect(emptyProbe?.code).toBe(INVALID_PARAMS)

    for (const probe of [undefined, null, [], 'session/compact', {}, { sessionId: 42 }, { sessionId: '' }]) {
      const error = syncError(() => parseCompactionRequest(probe))
      expect(error).toBeInstanceOf(RequestError)
      expect((error as RequestError).code).toBe(INVALID_PARAMS)
    }
  })

  c('UT-S52-03', 'maps the six failure codes, aborts, and unexpected throws onto the wire vocabulary', async () => {
    const codes: readonly ManualCompactionErrorCode[] = ['busy', 'cancelled', 'changed', 'summary', 'commit', 'persistence']

    // Pure mapping: every code lands on internal error with the shared /compact text.
    for (const code of codes) {
      const wire = sessionCompactWireError(new ManualCompactionError(code, 'diagnostic'))
      expect(wire.code).toBe(INTERNAL_ERROR)
      expect(wire.data).toEqual({ code })
      expect(wire.message).toBe(`Internal error: ${manualCompactionFailureText(new ManualCompactionError(code, 'diagnostic'))}`)
    }
    // The fallback maps a non-classified engine failure onto cancelled.
    const fallback = sessionCompactWireError(new Error('engine exploded'))
    expect(fallback.code).toBe(INTERNAL_ERROR)
    expect(fallback.data).toEqual({ code: 'cancelled' })
    expect(fallback.message).toBe('Internal error: Compaction cancelled.')

    // Wire round-trip: one registered call per code through the real bridge.
    harness = await makeBridgeHarness({
      compaction: 'stub',
      compactionOutcomes: codes.map(code => ({ kind: 'error', code })),
    })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    for (const code of codes) {
      const wire = await wireError(harness.client.compact({ sessionId: created.sessionId }))
      expect(wire?.code).toBe(INTERNAL_ERROR)
      expect(wire?.data).toEqual({ code })
      expect(wire?.message).toBe(`Internal error: ${manualCompactionFailureText(new ManualCompactionError(code, 'diagnostic'))}`)
    }

    // Wire abort: a cancelled JSON-RPC request maps to the cancelled class.
    harness = await makeBridgeHarness({ compaction: 'stub', compactionOutcomes: [{ kind: 'hang' }] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const abortSession = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const controller = new AbortController()
    const pending = harness.client.compact({ sessionId: abortSession.sessionId }, { cancellationSignal: controller.signal })
    await vi.waitFor(() => {
      expect((harness!.ctx.get('compaction') as ScriptedCompactionEngine).calls).toHaveLength(1)
    })
    controller.abort()
    const cancelled = await wireError(pending)
    expect(cancelled?.code).toBe(INTERNAL_ERROR)
    expect(cancelled?.data).toEqual({ code: 'cancelled' })
    expect(cancelled?.message).toBe('Internal error: Compaction cancelled.')

    // Wire unexpected: an engine TypeError stays on the generic internal error.
    harness = await makeBridgeHarness({ compaction: 'stub', compactionOutcomes: [{ kind: 'unexpected' }] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const genericSession = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const generic = await wireError(harness.client.compact({ sessionId: genericSession.sessionId }))
    expect(generic?.code).toBe(INTERNAL_ERROR)
    expect(generic?.message).toContain('Internal error: session compaction failed')
    expect((generic?.data as { code?: string } | undefined)?.code).toBeUndefined()
  })

  c('UT-S52-04', 'returns null for fresh history and busy during an active turn', async () => {
    harness = await makeBridgeHarness({ compaction: 'basic' })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    await expect(harness.client.compact({ sessionId: created.sessionId })).resolves.toEqual({ result: null })
    expect(compactionEvents(sessionOf(harness, created.sessionId))).toHaveLength(0)

    // A live turn keeps the agent non-idle; the real engine classifies busy.
    harness = await makeBridgeHarness({ compaction: 'basic', script: ['hang'] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const busySession = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const turn = harness.client.prompt({
      sessionId: busySession.sessionId,
      prompt: [{ type: 'text', text: 'hold the turn open.' }],
    })
    await vi.waitFor(() => { expect(harness!.adapter.requests.length).toBeGreaterThan(0) })
    const busy = await wireError(harness.client.compact({ sessionId: busySession.sessionId }))
    expect(busy?.code).toBe(INTERNAL_ERROR)
    expect(busy?.data).toEqual({ code: 'busy' })
    expect(busy?.message).toBe('Internal error: Compaction is unavailable because this process has an active compaction, or the agent is not idle.')
    void harness.client.cancel({ sessionId: busySession.sessionId })
    await expect(turn).resolves.toMatchObject({ stopReason: 'cancelled' })
  })

  c('UT-S52-05', 'derives compaction_update only for capability-declaring connections', async () => {
    // Declared connection, successful run: in_progress then completed with the
    // stashed compaction/summary blocks.
    harness = await makeBridgeHarness({
      compaction: 'stub',
      compactionOutcomes: [
        { kind: 'lifecycle', summary: [{ type: 'text', text: 'first summary' }] },
        { kind: 'lifecycle', summary: [{ type: 'text', text: 'second summary' }] },
      ],
    })
    await harness.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { session: { compaction: {} } },
    })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const first = await harness.client.compact({ sessionId: created.sessionId })
    expect(first.result).toMatchObject({
      compactionId: 'scripted-1',
      shadowedCount: 2,
      shadowedTokenCount: 42,
      summary: [{ type: 'text', text: 'first summary' }],
    })
    expect(typeof first.result?.summarySeq).toBe('number')
    await vi.waitFor(() => { expect(compactionUpdates(harness!)).toHaveLength(2) })
    const [inProgress, completed] = compactionUpdates(harness)
    expect(inProgress).toEqual({ sessionUpdate: 'compaction_update', compactionId: 'scripted-1', status: 'in_progress' })
    expect(completed).toEqual({
      sessionUpdate: 'compaction_update',
      compactionId: 'scripted-1',
      status: 'completed',
      summary: [{ type: 'text', text: 'first summary' }],
    })

    // compaction/prune never derives a notification: the second run's barrier
    // proves the drained queue carried exactly the four start/end updates.
    sessionOf(harness, created.sessionId).append('compaction/prune', {
      shadowedRange: { start: SessionSeq(1), end: SessionSeq(2) },
      shadowedSeqs: [SessionSeq(1)],
      shadowedTokenCount: 7,
    })
    await harness.client.compact({ sessionId: created.sessionId })
    await vi.waitFor(() => { expect(compactionUpdates(harness!)).toHaveLength(4) })
    expect(compactionUpdates(harness).map(update => update.status)).toEqual(['in_progress', 'completed', 'in_progress', 'completed'])
    expect(compactionUpdates(harness).map(update => update.compactionId)).toEqual(['scripted-1', 'scripted-1', 'scripted-2', 'scripted-2'])

    // Declared connection, failed run: the end-event error text rides the failed update.
    harness = await makeBridgeHarness({
      compaction: 'stub',
      compactionOutcomes: [{ kind: 'lifecycle', summary: [{ type: 'text', text: 'abandoned' }], error: 'scripted boom' }],
    })
    await harness.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { session: { compaction: {} } },
    })
    const failedSession = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const failed = await wireError(harness.client.compact({ sessionId: failedSession.sessionId }))
    expect(failed?.data).toEqual({ code: 'summary' })
    await vi.waitFor(() => { expect(compactionUpdates(harness!)).toHaveLength(2) })
    const [, terminal] = compactionUpdates(harness)
    expect(terminal).toEqual({
      sessionUpdate: 'compaction_update',
      compactionId: 'scripted-1',
      status: 'failed',
      error: 'scripted boom',
    })

    // Undeclared connection: the identical lifecycle delivers zero compaction
    // updates; a later assistant update proves the update queue drained past
    // the compaction appends.
    harness = await makeBridgeHarness({
      compaction: 'stub',
      compactionOutcomes: [{ kind: 'lifecycle', summary: [{ type: 'text', text: 'quiet summary' }] }],
      script: [textResponse('post-compaction turn')],
    })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const quietSession = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await expect(harness.client.compact({ sessionId: quietSession.sessionId }))
      .resolves.toMatchObject({ result: { compactionId: 'scripted-1' } })
    await expect(harness.client.prompt({
      sessionId: quietSession.sessionId,
      prompt: [{ type: 'text', text: 'drain the queue.' }],
    })).resolves.toMatchObject({ stopReason: 'end_turn' })
    await vi.waitFor(() => {
      expect(harness!.sessionUpdates.some(entry => entry.update.sessionUpdate === 'agent_message_chunk')).toBe(true)
    })
    expect(compactionUpdates(harness)).toHaveLength(0)
  })

  c('UT-S52-06', 'fails loud when the composition has no compaction engine', async () => {
    harness = await makeBridgeHarness({})
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    const absent = await wireError(harness.client.compact({ sessionId: created.sessionId }))
    expect(absent?.code).toBe(INTERNAL_ERROR)
    expect(absent?.message).toContain('compaction service is absent')
    expect(compactionEvents(sessionOf(harness, created.sessionId))).toHaveLength(0)
  })
})
