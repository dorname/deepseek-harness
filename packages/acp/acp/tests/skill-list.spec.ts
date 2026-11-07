/** S50: ACP `session/skills_list` enumeration over the real bridge. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { listSessionSkills, parseSkillsListRequest } from '../src/skill-list.ts'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'
import { reported } from './helpers/reporter.ts'

/** JSON-RPC codes the SDK maps wire errors onto. */
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

/** Report one case of this suite's OpenLogos ids from the wrapping `it`. */
function c(id: string, name: string, fn: () => Promise<void>): void {
  it(name, () => reported(id, fn))
}

/** Settle a rejected wire call into its RequestError, or undefined for anything else. */
function wireError<T>(call: Promise<T>): Promise<RequestError | undefined> {
  return call.then(
    () => { throw new Error('expected the wire call to fail') },
    (error: unknown) => (error instanceof RequestError ? error : undefined),
  )
}

/** Register one runtime skill on the real registry; omitted invocation permits both surfaces. */
function registerRuntimeSkill(
  ctx: Context,
  name: string,
  description: string,
  invocation?: { modelInvocable: boolean; userInvocable: boolean },
): void {
  ctx.skills.register({
    name,
    description,
    content: `Instructions for ${name}.`,
    source: 'runtime',
    ...(invocation === undefined ? {} : { invocation }),
  })
}

describe('ACP session skills_list (S50)', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  async function started(extra: Parameters<typeof makeBridgeHarness>[0] = {}) {
    harness = await makeBridgeHarness({ skills: true, ...extra })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    return harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
  }

  c('UT-S50-01', 'registers the method and validates sessions and params on the wire', async () => {
    const created = await started()
    registerRuntimeSkill(harness!.ctx, 'alpha', 'First routing description.')
    registerRuntimeSkill(harness!.ctx, 'beta', 'Second routing description.')

    const result = await harness!.client.skillsList({ sessionId: created.sessionId })
    expect(result).toEqual({ skills: [
      { name: 'alpha', description: 'First routing description.', modelInvocable: true, userInvocable: true },
      { name: 'beta', description: 'Second routing description.', modelInvocable: true, userInvocable: true },
    ] })

    // Unknown ids reject in the invalid params class instead of returning an empty list.
    const unknownSession = await wireError(harness!.client.skillsList({ sessionId: 'unknown-id' }))
    expect(unknownSession?.code).toBe(INVALID_PARAMS)
    expect(unknownSession?.message).toContain('unknown session: unknown-id')

    // The extension params parser guards the wire before the bridge handler:
    // an empty params object names the sessionId requirement, not the session.
    const malformed = await wireError(harness!.client.skillsList({}))
    expect(malformed?.code).toBe(INVALID_PARAMS)
    expect(malformed?.message).toContain('requires a non-empty sessionId string')
  })

  c('UT-S50-02', 'resolves the preset scoped registry first and falls back to the global registry', async () => {
    const created = await started()
    registerRuntimeSkill(harness!.ctx, 'global-only', 'Global routing description.')
    const agent = harness!.ctx.agents.get(SessionId(created.sessionId))!

    // A preset mount wins: its registry output rides the wire unfiltered, and
    // the lookup forwards the session's cwd and the exact agent scope. Same-name
    // override merging is the registry's layered contract, owned by dsh-skill's
    // suite; this seam owns which registry is addressed.
    const scopedList = vi.fn(() => Promise.resolve([
      { name: 'alpha', description: 'Scoped override wins.', invocation: { modelInvocable: false, userInvocable: true } },
      { name: 'scoped-only', description: 'Composed for this Agent.', invocation: { modelInvocable: true, userInvocable: false } },
    ]))
    const serviceFor = vi.fn(() => ({ list: scopedList }))
    harness!.ctx.provide('agentPresets', { serviceFor } as never)
    await expect(harness!.client.skillsList({ sessionId: created.sessionId })).resolves.toEqual({ skills: [
      { name: 'alpha', description: 'Scoped override wins.', modelInvocable: false, userInvocable: true },
      { name: 'scoped-only', description: 'Composed for this Agent.', modelInvocable: true, userInvocable: false },
    ] })
    expect(serviceFor).toHaveBeenCalledWith(agent, 'skills')
    expect(scopedList).toHaveBeenCalledWith({ cwd: process.cwd(), scope: agent })

    // Without a preset mount the same wire call reads the global registry with
    // the same forwarded view.
    await harness!.dispose()
    const fresh = await started()
    const freshAgent = harness!.ctx.agents.get(SessionId(fresh.sessionId))!
    registerRuntimeSkill(harness!.ctx, 'global-only', 'Global routing description.')
    const globalList = vi.spyOn(harness!.ctx.skills, 'list')
    harness!.ctx.provide('agentPresets', { serviceFor: () => undefined } as never)
    await expect(harness!.client.skillsList({ sessionId: fresh.sessionId })).resolves.toEqual({ skills: [
      { name: 'global-only', description: 'Global routing description.', modelInvocable: true, userInvocable: true },
    ] })
    expect(globalList).toHaveBeenCalledWith({ cwd: process.cwd(), scope: freshAgent })
  })

  c('UT-S50-03', 'lists both exclusive tiers without invocation filtering, name-sorted', async () => {
    const created = await started()
    registerRuntimeSkill(harness!.ctx, 'model-only', 'Routed to the model surface only.', { modelInvocable: true, userInvocable: false })
    registerRuntimeSkill(harness!.ctx, 'gesture-only', 'Routed to the human gesture surface only.', { modelInvocable: false, userInvocable: true })
    registerRuntimeSkill(harness!.ctx, 'both', 'Available on both surfaces.')

    // The exact-object comparison pins name sort order, full descriptions,
    // resolved flags, and the four agreed response fields (no path, whenToUse,
    // source, or provider leakage).
    await expect(harness!.client.skillsList({ sessionId: created.sessionId })).resolves.toEqual({ skills: [
      { name: 'both', description: 'Available on both surfaces.', modelInvocable: true, userInvocable: true },
      { name: 'gesture-only', description: 'Routed to the human gesture surface only.', modelInvocable: false, userInvocable: true },
      { name: 'model-only', description: 'Routed to the model surface only.', modelInvocable: true, userInvocable: false },
    ] })
  })

  c('UT-S50-04', 'fails loud with an internal error when no composition mounts the registry', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    const absent = await wireError(harness.client.skillsList({ sessionId: created.sessionId }))
    expect(absent?.code).toBe(INTERNAL_ERROR)
    expect(absent?.message).toContain('skill registry is absent')
    expect(absent?.message).toContain("neither this session's agent preset nor the host composition")
  })

  c('UT-S50-05', 'is read-only: repeated calls agree and append no session events', async () => {
    const created = await started()
    registerRuntimeSkill(harness!.ctx, 'alpha', 'First routing description.')
    registerRuntimeSkill(harness!.ctx, 'beta', 'Second routing description.')
    const agent = harness!.ctx.agents.get(SessionId(created.sessionId))!
    const eventsBefore = agent.session.snapshotEvents().length

    const first = await harness!.client.skillsList({ sessionId: created.sessionId })
    const second = await harness!.client.skillsList({ sessionId: created.sessionId })

    expect(second).toEqual(first)
    expect(first.skills).toHaveLength(2)
    expect(agent.session.snapshotEvents().length).toBe(eventsBefore)
    // The real Loader composition and skill-filesystem catalog parity are
    // pinned by the keyless snapshot scenario snapshots/acp/skills-list.
  })

  it('rejects enumeration in the closing window with the invalid params class', async () => {
    harness = await makeBridgeHarness({ skills: true })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const flushing: PromiseWithResolvers<void> = Promise.withResolvers()
    const flush = vi.spyOn(harness.ctx.sessions, 'flush').mockImplementationOnce(() => flushing.promise.then(() => true))

    const closing = harness.client.closeSession({ sessionId: created.sessionId })
    await vi.waitFor(() => { expect(flush).toHaveBeenCalled() })
    // A list racing close passes the session's own RequestError through with
    // its invalid params code instead of re-wrapping it as an internal error.
    const duringClose = await wireError(harness.client.skillsList({ sessionId: created.sessionId }))
    expect(duringClose?.code).toBe(INVALID_PARAMS)
    expect(duringClose?.message).toContain(`session is closing: ${created.sessionId}`)
    flushing.resolve()

    await expect(closing).resolves.toEqual({})
  })

  it('rejects a session without a project cwd', async () => {
    harness = await makeBridgeHarness({ skills: true })
    const sessionId = SessionId('cwdless-skills')
    const session = harness.ctx.sessions.create(sessionId)
    const agent = { id: sessionId, session, status: 'idle', ctx: harness.ctx } as Agent
    await expect(listSessionSkills(harness.ctx, agent)).rejects.toThrow(/has no project cwd/)
  })

  it('validates raw params strictly', () => {
    expect(parseSkillsListRequest({ sessionId: 's1' })).toEqual({ sessionId: 's1' })
    for (const params of [undefined, null, 42, 'session', [], ['x']]) {
      expect(() => parseSkillsListRequest(params)).toThrow(/must be an object with a sessionId/)
    }
    for (const sessionId of [42, undefined, '']) {
      expect(() => parseSkillsListRequest({ sessionId })).toThrow(/requires a non-empty sessionId string/)
    }
  })
})
