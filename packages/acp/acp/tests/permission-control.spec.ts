import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { AcpPermissionControl } from '../src/permission-control.ts'
import { makeBridgeHarness, textResponse, type BridgeHarness } from './harness.ts'
import { reported } from './helpers/reporter.ts'

/** Report one case of this suite's OpenLogos ids from the wrapping `it`. */
function c(id: string, name: string, fn: () => Promise<void>): void {
  it(name, () => reported(id, fn))
}

/** Scripted response issuing exactly one tool call. */
function oneToolCall(name: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId('call-s49'), name, argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('call-s49'), name, arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** The permission options a fully composed session advertises, in order. */
function permissionOptions(options: { configOptions?: Array<{ id: string }> | null }): Array<{ id: string }> {
  return (options.configOptions ?? []).filter(option => option.id === 'permission_policy' || option.id === 'permission_preset')
}

describe('ACP permission policy and preset configuration (S49)', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  async function started(extra: Parameters<typeof makeBridgeHarness>[0] = {}) {
    harness = await makeBridgeHarness({ approval: true, presets: true, ...extra })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    return harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
  }

  c('UT-S49-01', 'validates the policy vocabulary and preset names fail-loud without state changes', async () => {
    const created = await started()
    for (const policy of ['ask', 'never', 'always']) {
      const result = await harness!.client.setSessionConfigOption({
        sessionId: created.sessionId,
        configId: 'permission_policy',
        value: policy,
      })
      expect(permissionOptions(result)[0]).toMatchObject({ id: 'permission_policy', currentValue: policy })
    }

    // Unknown values fail loud; the policy stays.
    await expect(harness!.client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'permission_policy',
      value: 'paranoid',
    })).rejects.toThrow(/unknown permission policy value.*ask, never, always/)

    // Unknown presets fail the same way and leave the preset selection intact.
    await expect(harness!.client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'permission_preset',
      value: 'paranoid-access',
    })).rejects.toThrow(/unknown permission preset "paranoid-access" \(available: read-only, workspace-write, danger-full-access\)/)

    // The state survived every rejected call, and a model-option mutation
    // still returns the complete option state with the permission options.
    // The plain model has no reasoning tier, so its option drops out.
    const after = await harness!.client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'model',
      value: '["mock","plain"]',
    })
    expect(after.configOptions?.map(option => option.id)).toEqual([
      'model', 'permission_policy', 'permission_preset',
    ])
    expect(permissionOptions(after)[0]).toMatchObject({ currentValue: 'always' })
    expect(permissionOptions(after)[1]).toMatchObject({ id: 'permission_preset', currentValue: 'custom' })
  })

  c('UT-S49-05', 'advertises permission options on new and resume and restores the effective policy', async () => {
    const created = await started({ script: [oneToolCall('resume_probe'), textResponse('probe ran')] })

    // session/new advertises both options: the seeded policy value and the
    // deployment's preset catalog.
    const options = permissionOptions(created)
    expect(options.map(option => option.id)).toEqual(['permission_policy', 'permission_preset'])
    expect(options[0]).toMatchObject({ type: 'select', currentValue: 'ask', options: [
      { value: 'ask' }, { value: 'never' }, { value: 'always' },
    ] })
    expect(options[1]).toMatchObject({ currentValue: 'workspace-write', options: [
      { value: 'read-only', name: 'read-only' },
      { value: 'workspace-write', name: 'workspace-write' },
      { value: 'danger-full-access', name: 'danger-full-access' },
    ] })

    await harness!.client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'permission_policy',
      value: 'always',
    })
    const persistenceRoot = harness!.persistenceRoot
    await harness!.client.closeSession({ sessionId: created.sessionId })

    // Resume restores the policy from the durable fold and echoes it. The
    // `always` tier matches no preset bundle, so the derived preset reads
    // `custom` — the same current-value-only state the projection exposes.
    harness = await makeBridgeHarness({ script: [oneToolCall('resume_probe'), textResponse('probe ran')], approval: true, presets: true, persistenceRoot })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const resumed = await harness.client.resumeSession({ sessionId: created.sessionId, cwd: process.cwd(), mcpServers: [] })
    const resumedOptions = permissionOptions(resumed)
    expect(resumedOptions[0]).toMatchObject({ currentValue: 'always' })
    expect(resumedOptions[1]).toMatchObject({ currentValue: 'custom' })

    // The restored policy still gates execution: every tool call asks.
    harness.ctx.tools.register(defineContentToolFixture({
      name: 'resume_probe',
      description: 'Probe tool.',
      parameters: {},
      execute: async () => [{ type: 'text', text: 'ran' }],
    }))
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    await harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'call the resume probe tool once, then summarize.' }],
    })
    expect(harness.permissionRequests).toHaveLength(1)
    expect(harness.permissionRequests[0]?.options.map(option => option.kind).sort()).toEqual(['allow_once', 'reject_once'])
  })

  c('UT-S49-06', 'applies each catalog preset through one entry and reports the derived current value', async () => {
    const created = await started()
    const session = () => harness!.ctx.agents.get(SessionId(created.sessionId))!.session

    for (const preset of ['read-only', 'workspace-write', 'danger-full-access'] as const) {
      const applied = await harness!.client.setSessionConfigOption({
        sessionId: created.sessionId,
        configId: 'permission_preset',
        value: preset,
      })
      expect(permissionOptions(applied)[1]).toMatchObject({ currentValue: preset })
    }
    const types = session().snapshotEvents().map(event => event.type)
    expect(types.filter(type => type === 'permission/preset')).toHaveLength(4) // seed + three switches
    expect(types.filter(type => type === 'sandbox/mode')).toHaveLength(4)
    const approval = session().snapshotEvents().filter((event): event is SessionEvent<'approval/policy'> => event.type === 'approval/policy')
    expect(approval.map(event => event.data.policy)).toEqual(['ask', 'never'])

    // A preset application resets the approval knob to the bundle's own
    // value, so the selection matches the catalog again afterwards.
    await harness!.client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'permission_policy',
      value: 'always',
    })
    const reapplied = await harness!.client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'permission_preset',
      value: 'read-only',
    })
    expect(permissionOptions(reapplied)[1]).toMatchObject({ currentValue: 'read-only' })
    const approvalEvents = session().snapshotEvents().filter((event): event is SessionEvent<'approval/policy'> => event.type === 'approval/policy')
    expect(approvalEvents.at(-1)?.data).toMatchObject({ policy: 'ask' })
  })

  it('validates value types and absent services on direct control calls', async () => {
    const created = await started()
    const agent = harness!.ctx.agents.get(SessionId(created.sessionId))!

    // Direct calls skip the SDK client, so the control's own type checks run.
    const control = new AcpPermissionControl(harness!.ctx, agent)
    expect(() => control.set('permission_policy', 42)).toThrow(/unknown permission policy value/)
    expect(() => control.set('permission_preset', true)).toThrow(/permission_preset requires a select value/)
    expect(() => control.set('unknown_option', 'x')).toThrow(/unknown session config option: unknown_option/)
    expect(control.owns('permission_policy')).toBe(true)
    expect(control.owns('permission_preset')).toBe(true)
    expect(control.owns('model')).toBe(false)

    // A deployment without the preset service fails the preset option explicitly.
    const bare = await makeBridgeHarness({ approval: true })
    await bare.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const bareSession = await bare.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const bareAgent = bare.ctx.agents.get(SessionId(bareSession.sessionId))!
    const bareControl = new AcpPermissionControl(bare.ctx, bareAgent)
    expect(() => bareControl.set('permission_preset', 'read-only')).toThrow(/permission presets are not available/)
    await bare.dispose()
  })

  it('omits the permission options when the services are not composed', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    expect(permissionOptions(created)).toEqual([])
    await expect(harness.client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'permission_policy',
      value: 'always',
    })).rejects.toThrow(/permission policy is not available/)
  })
})
