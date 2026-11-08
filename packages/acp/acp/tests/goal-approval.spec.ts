/** S54: goal completion authorization over the real bridge — wire vocabulary, witnessed re-call, decline paths. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import { answerGoalReview } from '@deepseek-ai/dsh-acp'
import type { RequestPermissionOutcome } from '@deepseek-ai/dsh-acp'
import { makeBridgeHarness, oneToolCallWithArgs, textResponse, type BridgeHarness } from './harness.ts'
import { reported } from './helpers/reporter.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'test': { kind: 'test' } & ContextFormed
  }
}

/** Report one case of this suite's OpenLogos ids from the wrapping `it`. */
function c(id: string, name: string, fn: () => Promise<void>): void {
  it(name, () => reported(id, fn))
}

/** The bridge-owned live agent of one session id. */
function ownedAgent(harness: BridgeHarness, sessionId: string): Agent {
  return harness.ctx.agents.get(SessionId(sessionId))!
}

/** User-message events of one source kind appended after `boundarySeq`. */
function userMessages(harness: BridgeHarness, sessionId: string, boundarySeq: number, sourceKind: string) {
  return ownedAgent(harness, sessionId).session.snapshotEvents()
    .filter((event): event is SessionEvent<'user/message'> => event.type === 'user/message'
      && event.data.source.kind === sourceKind
      && event.seq > boundarySeq)
}

describe('ACP goal authorization face (S54)', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  c('ST-S54-01', 'round trips an unauthorized completion over request_permission and completes through the witnessed re-call', async () => {
    const script: (StreamChunk[] | 'hang')[] = [
      oneToolCallWithArgs('create_goal', 'call-create', JSON.stringify({ objective: 'ship the authorization slice' })),
      textResponse('goal created'),
    ]
    harness = await makeBridgeHarness({ userQuestions: true, goal: true, script })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const agent = ownedAgent(harness, created.sessionId)

    // Turn 1: a direct human prompt creates the goal.
    await expect(harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'create a persistent goal.' }],
    })).resolves.toMatchObject({ stopReason: 'end_turn' })
    const goal = harness.ctx.goals.get(agent)
    expect(goal).toMatchObject({ phase: 'active', activation: 'armed' })

    // Turn 2 opens on a non-human producer: the completion is unauthorized,
    // so the ask rides the permission channel with the goal vocabulary.
    script.push(oneToolCallWithArgs('update_goal', 'call-complete-1', JSON.stringify({
      goal_id: goal!.id, revision: goal!.revision, action: 'complete',
    })))
    script.push(oneToolCallWithArgs('update_goal', 'call-complete-2', JSON.stringify({
      goal_id: goal!.id, revision: goal!.revision, action: 'complete',
    })))
    script.push(textResponse('completed after authorization'))
    const boundarySeq = ownedAgent(harness, created.sessionId).session.snapshotEvents().length
    harness.onPermission = (request) => {
      expect(request.options.map(option => option.optionId)).toEqual(['approve', 'deny'])
      expect(request.options.map(option => option.kind)).toEqual(['allow_once', 'reject_once'])
      expect(request.options.map(option => option.name)).toEqual(['Authorize', 'Deny'])
      expect(request.toolCall).toMatchObject({ toolCallId: 'call-complete-1' })
      return { outcome: { outcome: 'selected', optionId: 'approve' } }
    }
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'continue autonomously' }],
      source: { kind: 'test' },
    }))
    await vi.waitFor(() => {
      expect(harness!.ctx.goals.get(agent)?.phase).toBe('complete')
    })
    expect(harness.permissionRequests).toHaveLength(1)

    // The Authorize outcome steered one user-sourced message into the open
    // turn; the model's re-call completed through that direct-human witness.
    const steered = userMessages(harness, created.sessionId, boundarySeq, 'user')
    expect(steered).toHaveLength(1)
    const steerBlock = steered[0]?.data.content[0]
    if (steerBlock?.type !== 'text') throw new Error('expected one steered text block')
    expect(steerBlock.text).toContain(`authorized completing goal ${goal!.id}`)
    expect(steerBlock.text).toContain('Call update_goal again now')

    // The wire card followed the tool-call card (drainUpdates ordering).
    const sawToolCall = harness.sessionUpdates.some(entry => entry.update.sessionUpdate === 'tool_call'
      && 'toolCallId' in entry.update
      && entry.update.toolCallId === 'call-complete-1')
    expect(sawToolCall).toBe(true)
  })

  it('maps a Deny outcome to the declined authority rejection without any steered witness', async () => {
    const script: (StreamChunk[] | 'hang')[] = [
      oneToolCallWithArgs('create_goal', 'call-create', JSON.stringify({ objective: 'denied over the wire' })),
      textResponse('goal created'),
    ]
    harness = await makeBridgeHarness({ userQuestions: true, goal: true, script })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const agent = ownedAgent(harness, created.sessionId)
    await expect(harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'create a persistent goal.' }],
    })).resolves.toMatchObject({ stopReason: 'end_turn' })
    const goal = harness.ctx.goals.get(agent)
    expect(goal).toMatchObject({ phase: 'active' })

    script.push(oneToolCallWithArgs('update_goal', 'call-complete-1', JSON.stringify({
      goal_id: goal!.id, revision: goal!.revision, action: 'complete',
    })))
    script.push(textResponse('the completion was declined'))
    const boundarySeq = agent.session.snapshotEvents().length
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'deny' } })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'continue autonomously' }],
      source: { kind: 'test' },
    }))
    await vi.waitFor(() => {
      // The turn ended: the declined completion left the goal active and the
      // model reported back instead of retrying.
      const turnEnds = agent.session.snapshotEvents()
        .filter(event => event.type === 'turn/end' && event.seq > boundarySeq)
      expect(turnEnds.length).toBeGreaterThan(0)
    })
    expect(harness.permissionRequests).toHaveLength(1)
    expect(harness.ctx.goals.get(agent)?.phase).toBe('active')
    expect(userMessages(harness, created.sessionId, boundarySeq, 'user')).toHaveLength(0)
  })

  it('maps a cancelled outcome to the turn-back text without granting anything', async () => {
    const script: (StreamChunk[] | 'hang')[] = [
      oneToolCallWithArgs('create_goal', 'call-create', JSON.stringify({ objective: 'dismissed over the wire' })),
      textResponse('goal created'),
    ]
    harness = await makeBridgeHarness({ userQuestions: true, goal: true, script })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const agent = ownedAgent(harness, created.sessionId)
    await expect(harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'create a persistent goal.' }],
    })).resolves.toMatchObject({ stopReason: 'end_turn' })
    const goal = harness.ctx.goals.get(agent)

    script.push(oneToolCallWithArgs('update_goal', 'call-complete-1', JSON.stringify({
      goal_id: goal!.id, revision: goal!.revision, action: 'complete',
    })))
    script.push(textResponse('waiting for the human instead'))
    harness.onPermission = () => ({ outcome: { outcome: 'cancelled' } })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'continue autonomously' }],
      source: { kind: 'test' },
    }))
    await vi.waitFor(() => {
      const turnEnds = agent.session.snapshotEvents()
        .filter(event => event.type === 'turn/end')
      expect(turnEnds.length).toBeGreaterThan(1)
    })
    expect(harness.ctx.goals.get(agent)?.phase).toBe('active')
    // The tool result carries the turn-back text the model reads.
    const results = agent.session.snapshotEvents()
      .filter(event => event.type === 'tool/result')
      .map(event => JSON.stringify(event.data))
    expect(results.some(text => text.includes('dismissed the goal review to speak instead'))).toBe(true)
  })

  c('UT-S54-06', 'keeps the bridge pass-through for generic and multi-question asks', async () => {
    harness = await makeBridgeHarness({ userQuestions: true, goal: true, script: [textResponse('unused')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const questions = harness.ctx.get('userQuestions')
    expect(questions).toBeDefined()
    const ask = (batch: AskUserQuestionItem[]): Promise<unknown> => questions!.ask({
      questions: batch,
      agent: ownedAgent(harness!, created.sessionId),
    })

    const generic = ask([{ id: 'q1', question: 'Pick one?', options: [{ label: 'A' }, { label: 'B' }] }])
    await expect(generic).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    const batch = ask([
      { id: 'q2', question: 'Two questions?', detail: 'ship it', options: [{ label: 'Authorize' }, { label: 'Deny' }], intent: { kind: 'goal-review', approve: 'Authorize', goalId: 'goal-1' } },
      { id: 'q3', question: 'Still two.' },
    ])
    await expect(batch).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    const unowned = questions!.ask({
      questions: [{
        id: 'q4', question: 'Authorize completing?', detail: 'ship it',
        options: [{ label: 'Authorize' }, { label: 'Deny' }],
        intent: { kind: 'goal-review', approve: 'Authorize', goalId: 'goal-1' },
      }],
    })
    await expect(unowned).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    expect(harness.permissionRequests).toHaveLength(0)
  })

  it('delegates mismatched sessions, option-less questions, and call-less intents to next()', async () => {
    harness = await makeBridgeHarness({ userQuestions: false, goal: false, script: [textResponse('unused')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const first = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const second = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const owned = ownedAgent(harness, first.sessionId)
    const other = ownedAgent(harness, second.sessionId)

    let drained = 0
    const source = { agent: owned, drainUpdates: async () => { drained += 1 } }
    const delegated: AskUserQuestionAnswer = { answers: [{ id: 'delegated', selected: [] }] }
    const next = async (): Promise<AskUserQuestionAnswer> => delegated
    const sendPermission = async (): Promise<RequestPermissionOutcome> => {
      throw new Error('the permission channel must stay untouched')
    }
    const goalIntent = (callId?: string) => ({
      kind: 'goal-review' as const,
      approve: 'Authorize',
      goalId: 'goal-1',
      ...(callId === undefined ? {} : { callId: ToolCallId(callId) }),
    })

    // Another session's agent never claims another session's review.
    expect(await answerGoalReview(
      source,
      { questions: [{ id: 'q-owned', question: 'Authorize completing?', detail: 'ship it', options: [{ label: 'Authorize' }, { label: 'Deny' }], intent: goalIntent('call-1') }], agent: other },
      next,
      sendPermission,
    )).toBe(delegated)

    // A question without options has no distinct decline label.
    expect(await answerGoalReview(
      source,
      { questions: [{ id: 'q-no-opt', question: 'Authorize completing?', detail: 'ship it', intent: goalIntent('call-2') }], agent: owned },
      next,
      sendPermission,
    )).toBe(delegated)

    // An intent without a logged tool call is not a wire review.
    expect(await answerGoalReview(
      source,
      { questions: [{ id: 'q-no-call', question: 'Authorize completing?', detail: 'ship it', options: [{ label: 'Authorize' }, { label: 'Deny' }], intent: goalIntent() }], agent: owned },
      next,
      sendPermission,
    )).toBe(delegated)

    expect(drained).toBe(0)
  })
})
