import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { makeBridgeHarness, textResponse, type BridgeHarness } from './harness.ts'
import { reported } from './helpers/reporter.ts'

/** Scripted response issuing exactly one tool call. */
function oneToolCall(name: string, callId: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId(callId), name, argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(callId), name, arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

describe('ACP always and never policy round trips (S49)', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('UT-S49-02: asks before every tool call under always and settles one-shot answers', () => reported('UT-S49-02', async () => {
    harness = await makeBridgeHarness({
      script: [
        oneToolCall('writer', 'call-1'),
        oneToolCall('writer', 'call-2'),
        textResponse('second was denied, stopping'),
      ],
      approval: true,
      presets: true,
    })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const executed: string[] = []
    harness.ctx.tools.register(defineContentToolFixture({
      name: 'writer',
      description: 'Write one probe value.',
      parameters: {},
      execute: async () => {
        executed.push('ran')
        return [{ type: 'text', text: 'wrote' }]
      },
    }))
    await harness.client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'permission_policy',
      value: 'always',
    })
    const answers = ['allow-once', 'reject-once']
    harness.onPermission = (request) => {
      // Exactly the two one-shot choices, never a durable grant.
      expect(request.options.map(option => option.kind).sort()).toEqual(['allow_once', 'reject_once'])
      expect(request.options.some(option => option.kind === 'allow_always')).toBe(false)
      const answer = answers.shift()
      if (answer === undefined) throw new Error('unexpected third permission request')
      return { outcome: { outcome: 'selected', optionId: answer } }
    }

    const result = await harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'write two probe values with the writer tool.' }],
    })

    expect(result.stopReason).toBe('end_turn')
    expect(harness.permissionRequests).toHaveLength(2)
    expect(harness.permissionRequests[0]?.toolCall).toMatchObject({ toolCallId: 'call-1' })
    expect(harness.permissionRequests[1]?.toolCall).toMatchObject({ toolCallId: 'call-2' })
    // allow-once executed the first call; reject-once denied the second.
    expect(executed).toEqual(['ran'])
    const session = harness.ctx.agents.get(SessionId(created.sessionId))!.session
    const decided = session.snapshotEvents().filter((event): event is SessionEvent<'approval/decided'> => event.type === 'approval/decided')
    expect(decided.map(event => event.data.outcome)).toEqual(['allowed-once', 'rejected'])
  }))

  it('ST-S49-02: never suppresses escalation asks across resume while the default still delivers', () => reported('ST-S49-02', async () => {
    /** Register the probe tool whose execute requests one sandbox escalation. */
    const mountEscalator = (target: BridgeHarness): void => {
      target.ctx.tools.register(defineContentToolFixture({
        name: 'escalator',
        description: 'Probe tool that requests a sandbox escalation before finishing.',
        parameters: {},
        execute: async (_args, exec) => {
          if (exec.agent === undefined) throw new Error('escalator requires an agent scope')
          outcomes.push(await target.ctx.approval.request({
            agent: exec.agent,
            toolName: exec.name,
            callId: exec.callId,
            reason: 'escalate sandbox to danger-full-access: ST probe',
          }))
          return [{ type: 'text', text: `escalation ${outcomes.at(-1)}` }]
        },
      }))
    }
    const outcomes: string[] = []
    harness = await makeBridgeHarness({
      script: [oneToolCall('escalator', 'call-esc-1'), textResponse('first turn done')],
      approval: true,
      presets: true,
    })
    mountEscalator(harness)
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const neverSession = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.setSessionConfigOption({
      sessionId: neverSession.sessionId,
      configId: 'permission_policy',
      value: 'never',
    })

    // Inside a real turn, the escalation request is silently rejected: no
    // permission request ever reaches the client.
    await harness.client.prompt({
      sessionId: neverSession.sessionId,
      prompt: [{ type: 'text', text: 'escalate and finish.' }],
    })
    expect(outcomes).toEqual(['rejected'])
    expect(harness.permissionRequests).toHaveLength(0)

    // Resume restores the policy: the post-resume escalation is still silent.
    const persistenceRoot = harness.persistenceRoot
    await harness.client.closeSession({ sessionId: neverSession.sessionId })
    harness = await makeBridgeHarness({
      script: [
        oneToolCall('escalator', 'call-esc-2'),
        textResponse('resumed turn done'),
        oneToolCall('escalator', 'call-esc-3'),
        textResponse('default turn done'),
      ],
      approval: true,
      presets: true,
      persistenceRoot,
    })
    mountEscalator(harness)
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const resumed = await harness.client.resumeSession({ sessionId: neverSession.sessionId, cwd: process.cwd(), mcpServers: [] })
    expect(resumed.configOptions?.find(option => option.id === 'permission_policy'))
      .toMatchObject({ currentValue: 'never' })
    await harness.client.prompt({
      sessionId: neverSession.sessionId,
      prompt: [{ type: 'text', text: 'escalate again and finish.' }],
    })
    expect(outcomes).toEqual(['rejected', 'rejected'])
    expect(harness.permissionRequests).toHaveLength(0)

    // A session without a policy keeps the default: the escalation ask reaches
    // the client and its rejection is final.
    const defaultSession = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'reject-once' } })
    await harness.client.prompt({
      sessionId: defaultSession.sessionId,
      prompt: [{ type: 'text', text: 'escalate on the default policy and finish.' }],
    })
    expect(outcomes).toEqual(['rejected', 'rejected', 'rejected'])
    expect(harness.permissionRequests).toHaveLength(1)
    expect(harness.permissionRequests[0]?.sessionId).toBe(defaultSession.sessionId)
  }))
})
