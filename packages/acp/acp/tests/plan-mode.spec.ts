/** S51: ACP plan mode over the real bridge — vocabulary, modes advertisement, review channel. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import { makeBridgeHarness, oneToolCallWithArgs, textResponse, type BridgeHarness } from './harness.ts'
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

/** The `current_mode_update` updates observed so far, in delivery order. */
function modeUpdates(harness: BridgeHarness): string[] {
  return harness.updates
    .filter((update): update is Extract<typeof update, { sessionUpdate: 'current_mode_update' }> => update.sessionUpdate === 'current_mode_update')
    .map(update => update.currentModeId)
}

/** The live plan controller view for a bridge-owned session. */
function planState(harness: BridgeHarness, sessionId: string): { active: boolean; pending?: boolean } {
  const agent = harness.ctx.agents.get(SessionId(sessionId)) as Agent
  return harness.ctx.get('planMode')!.get(agent)
}

describe('ACP plan mode standard face (S51)', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  c('UT-S51-01', 'validates vocabulary and session ownership on session/set_mode', async () => {
    harness = await makeBridgeHarness({ planMode: true })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    const unknownSession = await wireError(harness.client.setSessionMode({ sessionId: 'unknown-id', modeId: 'plan' }))
    expect(unknownSession?.code).toBe(INVALID_PARAMS)
    expect(unknownSession?.message).toContain('unknown session: unknown-id')

    const unknownMode = await wireError(harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'other' }))
    expect(unknownMode?.code).toBe(INVALID_PARAMS)
    expect(unknownMode?.message).toContain('unknown session mode: other')
    expect(unknownMode?.message).toContain('plan, normal')

    const malformed = await wireError(harness.client.setSessionMode({} as { sessionId: string; modeId: string }))
    expect(malformed?.code).toBe(INVALID_PARAMS)
  })

  it('rejects mode changes in the closing window with the invalid params class', async () => {
    harness = await makeBridgeHarness({ planMode: true })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const flushing: PromiseWithResolvers<void> = Promise.withResolvers()
    const flush = vi.spyOn(harness.ctx.sessions, 'flush').mockImplementationOnce(() => flushing.promise.then(() => true))

    const closing = harness.client.closeSession({ sessionId: created.sessionId })
    await vi.waitFor(() => { expect(flush).toHaveBeenCalled() })
    const duringClose = await wireError(harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'plan' }))
    expect(duringClose?.code).toBe(INVALID_PARAMS)
    expect(duringClose?.message).toContain(`session is closing: ${created.sessionId}`)
    flushing.resolve()

    await expect(closing).resolves.toEqual({})
  })

  c('UT-S51-02', 'advertises the two-mode state on new and restores it on resume', async () => {
    harness = await makeBridgeHarness({ planMode: true })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    expect(created.modes?.currentModeId).toBe('normal')
    expect(created.modes?.availableModes.map(mode => mode.id)).toEqual(['plan', 'normal'])
    expect(created.modes?.availableModes.every(mode => typeof mode.name === 'string' && mode.name.length > 0)).toBe(true)

    await expect(harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'plan' })).resolves.toEqual({})
    expect(modeUpdates(harness)).toEqual(['plan'])

    const persistenceRoot = harness.persistenceRoot
    await harness.client.closeSession({ sessionId: created.sessionId })
    const first = harness
    harness = await makeBridgeHarness({ planMode: true, persistenceRoot })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const resumed = await harness.client.resumeSession({ sessionId: created.sessionId, cwd: process.cwd(), mcpServers: [] })
    expect(resumed.modes?.currentModeId).toBe('plan')
    expect(resumed.modes?.availableModes.map(mode => mode.id)).toEqual(['plan', 'normal'])
    await first.dispose()
  })

  c('UT-S51-03', 'commits between turns, queues mid-turn, and stays silent on noop and cancelled', async () => {
    harness = await makeBridgeHarness({
      planMode: true,
      script: ['hang', textResponse('second turn done'), 'hang', textResponse('fourth turn done')],
    })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    // Between turns: the commit lands immediately with exactly one update.
    await expect(harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'plan' })).resolves.toEqual({})
    expect(modeUpdates(harness)).toEqual(['plan'])
    // Noop: re-selecting the committed state appends nothing.
    await expect(harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'plan' })).resolves.toEqual({})
    expect(modeUpdates(harness)).toEqual(['plan'])

    // Mid-turn: the selection queues; the update arrives only when the next
    // accepted in-turn pre-step commits it.
    const queued = harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'open a turn to queue against.' }],
    })
    await vi.waitFor(() => { expect(harness!.adapter.requests.length).toBeGreaterThan(0) })
    await expect(harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'normal' })).resolves.toEqual({})
    expect(modeUpdates(harness)).toEqual(['plan'])
    void harness.client.cancel({ sessionId: created.sessionId })
    await expect(queued).resolves.toMatchObject({ stopReason: 'cancelled' })
    await expect(harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'run the committed switch.' }],
    })).resolves.toMatchObject({ stopReason: 'end_turn' })
    expect(modeUpdates(harness)).toEqual(['plan', 'normal'])

    // Cancelled: re-selecting the committed state while an opposite pending
    // exists clears the pending silently.
    const cleared = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await expect(harness.client.setSessionMode({ sessionId: cleared.sessionId, modeId: 'plan' })).resolves.toEqual({})
    expect(modeUpdates(harness)).toEqual(['plan', 'normal', 'plan'])
    const hang = harness.client.prompt({
      sessionId: cleared.sessionId,
      prompt: [{ type: 'text', text: 'open a turn to clear against.' }],
    })
    await vi.waitFor(() => { expect(harness!.adapter.requests.length).toBeGreaterThan(2) })
    await expect(harness.client.setSessionMode({ sessionId: cleared.sessionId, modeId: 'normal' })).resolves.toEqual({})
    expect(modeUpdates(harness)).toEqual(['plan', 'normal', 'plan'])
    await expect(harness.client.setSessionMode({ sessionId: cleared.sessionId, modeId: 'plan' })).resolves.toEqual({})
    void harness.client.cancel({ sessionId: cleared.sessionId })
    await expect(hang).resolves.toMatchObject({ stopReason: 'cancelled' })
    await expect(harness.client.prompt({
      sessionId: cleared.sessionId,
      prompt: [{ type: 'text', text: 'drain the cancelled selection.' }],
    })).resolves.toMatchObject({ stopReason: 'end_turn' })
    expect(modeUpdates(harness)).toEqual(['plan', 'normal', 'plan'])
    expect(planState(harness, cleared.sessionId).active).toBe(true)
  })

  c('UT-S51-04', 'maps plan reviews over request_permission in all three outcomes', async () => {
    const planArgs = JSON.stringify({ plan: '# Test plan\n\nDo the thing.' })
    harness = await makeBridgeHarness({
      planMode: true,
      userQuestions: true,
      script: [
        oneToolCallWithArgs('exit_plan_mode', 'call-plan-1', planArgs),
        textResponse('carry out the plan'),
        oneToolCallWithArgs('exit_plan_mode', 'call-plan-2', planArgs),
        textResponse('revising the plan'),
        oneToolCallWithArgs('exit_plan_mode', 'call-plan-3', planArgs),
        textResponse('staying in plan mode'),
      ],
    })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'plan' })
    expect(modeUpdates(harness)).toEqual(['plan'])

    // Approve: the review rides the permission channel, arrives after the
    // tool-call card, and the silent switch commits at the next accepted
    // pre-step.
    const reviewSeenToolCall: boolean[] = []
    harness.onPermission = (request) => {
      expect(request.options.map(option => option.optionId)).toEqual(['approve', 'keep-planning'])
      expect(request.options.map(option => option.kind)).toEqual(['allow_once', 'reject_once'])
      expect(request.options.map(option => option.name)).toEqual(['Approve', 'Keep planning'])
      expect(request.toolCall).toMatchObject({ toolCallId: 'call-plan-1' })
      reviewSeenToolCall.push(harness!.sessionUpdates.some(entry => entry.update.sessionUpdate === 'tool_call' && 'toolCallId' in entry.update && entry.update.toolCallId === 'call-plan-1'))
      return { outcome: { outcome: 'selected', optionId: 'approve' } }
    }
    await expect(harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'present a plan for approval.' }],
    })).resolves.toMatchObject({ stopReason: 'end_turn' })
    expect(reviewSeenToolCall).toEqual([true])
    expect(harness.permissionRequests).toHaveLength(1)
    expect(modeUpdates(harness)).toEqual(['plan', 'normal'])
    expect(planState(harness, created.sessionId).active).toBe(false)

    // Keep planning: re-enter plan mode, decline maps back, the model
    // revises, and the session stays in plan mode.
    await harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'plan' })
    expect(modeUpdates(harness)).toEqual(['plan', 'normal', 'plan'])
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'keep-planning' } })
    await expect(harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'present the plan again.' }],
    })).resolves.toMatchObject({ stopReason: 'end_turn' })
    expect(harness.permissionRequests).toHaveLength(2)
    expect(modeUpdates(harness)).toEqual(['plan', 'normal', 'plan'])
    expect(planState(harness, created.sessionId).active).toBe(true)

    // Dismissal: a cancelled outcome maps to the tool's turn-back branch and
    // the session keeps its mode.
    harness.onPermission = () => ({ outcome: { outcome: 'cancelled' } })
    await expect(harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'present once more; the client will dismiss.' }],
    })).resolves.toMatchObject({ stopReason: 'end_turn' })
    expect(harness.permissionRequests).toHaveLength(3)
    expect(modeUpdates(harness)).toEqual(['plan', 'normal', 'plan'])
    expect(planState(harness, created.sessionId).active).toBe(true)
  })

  c('UT-S51-05', 'passes non-plan-review questions through to the no-answerer behavior', async () => {
    harness = await makeBridgeHarness({ planMode: true, userQuestions: true, script: [textResponse('generic question asked'), textResponse('batch question asked')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const questions = harness.ctx.get('userQuestions')
    expect(questions).toBeDefined()
    const ask = (batch: AskUserQuestionItem[]): Promise<unknown> => questions!.ask({
      questions: batch,
      agent: harness!.ctx.agents.get(SessionId(created.sessionId))!,
    })

    const generic = ask([{ id: 'q1', question: 'Pick one?', options: [{ label: 'A' }, { label: 'B' }] }])
    await expect(generic).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    const batch = ask([
      { id: 'q2', question: 'Two questions?', detail: '# A plan to review', options: [{ label: 'A' }, { label: 'B' }], intent: { kind: 'plan-review', approve: 'A' } },
      { id: 'q3', question: 'Still two.' },
    ])
    await expect(batch).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    expect(harness.permissionRequests).toHaveLength(0)
  })

  c('UT-S51-06', 'fails loud and omits modes when the plan-mode plugin is absent', async () => {
    harness = await makeBridgeHarness({})
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    expect('modes' in created ? created.modes : undefined).toBeUndefined()

    const absent = await wireError(harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'plan' }))
    expect(absent?.code).toBe(INTERNAL_ERROR)
    expect(absent?.message).toContain('plan mode is not composed')
    expect(modeUpdates(harness)).toEqual([])
  })

  it('derives every mode update from the durable plan/mode event', async () => {
    harness = await makeBridgeHarness({ planMode: true })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'plan' })
    const session = harness.ctx.agents.get(SessionId(created.sessionId))!.session
    const committed = session.snapshotEvents().filter((event): event is SessionEvent<'plan/mode'> => event.type === 'plan/mode')
    expect(committed.map(event => event.data.active)).toEqual([true])
    expect(modeUpdates(harness)).toEqual(['plan'])
  })
})
