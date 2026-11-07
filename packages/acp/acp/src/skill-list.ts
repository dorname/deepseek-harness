/** Standard ACP session skill enumeration over one bridge-owned Agent. */

import type { Context } from '@deepseek-ai/cordis'
import { RequestError } from '@agentclientprotocol/sdk'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Side-effect type import: declares the optional `skills` registry this list reads.
import type {} from '@deepseek-ai/dsh-skill'
// Side-effect type import: types the optional `agentPresets` service this list resolves through.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

/** ACP method name for the session skill catalog (a dsh extension; ACP 1.4.0 has no skill surface). */
export const SKILLS_LIST_METHOD = 'session/skills_list'

/** Parsed `session/skills_list` request params. */
export interface AcpSkillListRequest {
  /** The bridge-owned session to enumerate. */
  readonly sessionId: string
}

/** One skill available to the session, with both resolved invocation flags. */
export interface AcpSkillEntry {
  /** Kebab-case identifier referenced as `/name`. */
  readonly name: string
  /** Full routing description, never truncated. */
  readonly description: string
  /** Whether the model catalog and `skill` tool include this skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs include this skill. */
  readonly userInvocable: boolean
}

/** The `session/skills_list` response: the invocation-neutral catalog, name-sorted. */
export interface AcpSkillList {
  readonly skills: readonly AcpSkillEntry[]
}

/**
 * The one preset-registry member the skill chain reads. `AgentPresetRegistry`
 * satisfies this structurally; tests substitute a same-shape double.
 */
export interface ScopedSkillSource {
  /**
   * Read a service supplied inside an Agent's isolated preset group.
   * @param agent - agent whose composition is queried.
   * @param name - Cordis service name.
   * @returns the service, or undefined without a preset mount of it.
   */
  serviceFor(agent: { ctx: Context }, name: 'skills'): Context['skills'] | undefined
}

/**
 * Resolve the skill registry for one bridge-owned agent: the agent preset's
 * scoped mount wins, then the host composition's global registry.
 * @param agent - the exact bridge-owned agent.
 * @param presets - the optional preset registry (a real `AgentPresetRegistry`
 *   satisfies {@link ScopedSkillSource} structurally).
 * @param global - the host composition's global registry, or undefined.
 * @returns undefined when neither composition mounts dsh-skill.
 */
export function resolveSkillRegistry(
  agent: Agent,
  presets: ScopedSkillSource | undefined,
  global: Context['skills'] | undefined,
): Context['skills'] | undefined {
  return presets?.serviceFor(agent, 'skills') ?? global
}

/**
 * Enumerate one bridge-owned session's skills without applying invocation
 * filtering: both flags ride the wire so the client distinguishes entries.
 * Registry caches make repeated calls consistent while staying current with
 * catalog changes; nothing is cached at this layer and no session event is
 * appended.
 * @param ctx - ACP plugin context carrying the optional preset and skill services.
 * @param agent - the exact bridge-owned agent whose composition is enumerated.
 * @returns the name-sorted catalog for the session's cwd and composition.
 * @throws when no skill registry is composed or the session has no project cwd.
 */
export async function listSessionSkills(ctx: Context, agent: Agent): Promise<AcpSkillList> {
  const registry = resolveSkillRegistry(agent, ctx.get('agentPresets'), ctx.get('skills'))
  if (registry === undefined) {
    throw new Error(
      'skill registry is absent: neither this session\'s agent preset nor the host composition mounts @deepseek-ai/dsh-skill',
    )
  }
  const cwd = agent.session.header.cwd
  if (cwd === undefined) {
    throw new Error(`session "${agent.session.id}" has no project cwd`)
  }
  const skills = await registry.list({ cwd, scope: agent })
  return {
    skills: skills.map(skill => ({
      name: skill.name,
      description: skill.description,
      modelInvocable: skill.invocation.modelInvocable,
      userInvocable: skill.invocation.userInvocable,
    })),
  }
}

/**
 * Validate raw `session/skills_list` JSON-RPC params.
 * @param params - the untyped wire params.
 * @returns the parsed request.
 * @throws RequestError invalid params when the shape is not `{ sessionId: string }`.
 */
export function parseSkillsListRequest(params: unknown): AcpSkillListRequest {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw RequestError.invalidParams(undefined, 'session/skills_list params must be an object with a sessionId')
  }
  const { sessionId } = params as { sessionId?: unknown }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw RequestError.invalidParams(undefined, 'session/skills_list requires a non-empty sessionId string')
  }
  return { sessionId }
}
