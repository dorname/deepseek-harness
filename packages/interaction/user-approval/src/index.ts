/**
 * Service Definition for the approval capability seam, covering requests, cancellation, audit, and per-session policy. Missing
 * answerers fail closed; grants apply only to the requested action.
 * @module @deepseek-ai/dsh-user-approval
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'user-approval': { kind: 'user-approval' } & ContextFormed
  }
}

import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'

declare module '@deepseek-ai/cordis' {
  interface Context {
    approval: ApprovalService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's approval policy was switched to `'ask'` or `'never'` —
     * log-only, durable, replayable, never in the model transcript (the model
     * learns the policy from the runtime-context snapshot and live switch
     * notices). The LAST policy event across this type and
     * `approval/policy-always` (by seq) is the session's override. The payload
     * is frozen at the format-4 vocabulary: widening it would be a breaking
     * persistence change, so later tiers switch through their own event type.
     * `source: 'delegation'` marks an override seeded into a child; an absent
     * source is a runtime switch.
     */
    'approval/policy': {
      policy: 'ask' | 'never'
      /** Marks an override seeded into a child at delegation. */
      source?: 'delegation'
    }
    /**
     * The session's approval policy was switched to `'always'` — the same
     * durable record as `approval/policy` for the tier added after format 4.
     * A separate ordinary event type keeps `approval/policy`'s payload frozen
     * at the accepted format-4 union (adding an event type is a same-version
     * persistence change; widening an existing payload union is not). Born
     * versioned (the `subagent/catalog` pattern) so future payload growth
     * lands as higher-`version` alternatives without a format bump. The LAST
     * policy event across `approval/policy` and this type (by seq) is the
     * session's override. `source: 'delegation'` marks an override seeded
     * into a child; an absent source is a runtime switch.
     */
    'approval/policy-always': {
      version: 0
      policy: 'always'
      /** Marks an override seeded into a child at delegation. */
      source?: 'delegation'
    }
  }
}

import { ApprovalRequestId } from './types.ts'
import type { ApprovalOutcome, ApprovalRequestEvent } from './types.ts'

export { ApprovalRequestId } from './types.ts'
export type { ApprovalOutcome } from './types.ts'

/** Every {@link ApprovalOutcome}, for runtime normalization of answerer returns. */
const OUTCOMES: readonly ApprovalOutcome[] = ['allowed-once', 'rejected', 'cancelled', 'unavailable']

/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 *   Ordinary tool calls that no ask source covers still run without asking.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 * - `'always'` — every tool call asks before it runs: a pre-execute listener
 *   turns each call into an ask that dispatches to the composed answerers.
 *   The external-client stance (ACP `permission_policy=always`) where every
 *   action needs an explicit one-shot grant.
 */
export type ApprovalPolicy = 'ask' | 'never' | 'always'

/** Every {@link ApprovalPolicy}, for option advertisement and runtime validation of untrusted policy strings. */
export const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ['ask', 'never', 'always']

/**
 * The payload `version` of every `approval/policy-always` event written today.
 * Exported so writers and readers share the constant behind the event map's
 * `version: 0` literal; future payload growth raises it alongside a new
 * versioned alternative.
 */
export const APPROVAL_POLICY_ALWAYS_VERSION = 0

/** Model-facing statement for the deterministic `'never'` policy. */
const NEVER_SENTENCE = 'Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).'
/** Model-facing statement for an interactive policy that may still fail closed. */
const ASK_SENTENCE = 'Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.'
/** Model-facing statement for the per-call `'always'` policy. */
const ALWAYS_SENTENCE = 'Approval policy: always. Every tool call is submitted for user approval before it executes; only explicitly approved calls run.'

/**
 * Whether the log currently sits inside an open turn (a `turn/start` not yet
 * closed by a `turn/end`) — the {@link ApprovalService.request} precondition.
 * The audit pair must be turn-enclosed: the turn is the durable log's
 * commit/replay boundary, so a bare event appended between turns is
 * indistinguishable from a crash tail and silently dropped on reload.
 */
function hasOpenTurn(session: Session): boolean {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const type = session.eventAt(SessionSeq(seq))?.type
    if (type === 'turn/start') return true
    if (type === 'turn/end') return false
  }
  return false
}

/**
 * Append the durable representation of a session policy override. Invalid
 * values throw before the log changes; consumers fold the new value on each
 * read. `always` switches land on `approval/policy-always` — the tier added
 * after format 4, whose event type keeps `approval/policy`'s payload frozen.
 * @param session - the session the override belongs to.
 * @param policy - the policy in effect until the next switch.
 */
export function setApprovalPolicy(session: Session, policy: ApprovalPolicy): void {
  if (!APPROVAL_POLICIES.includes(policy)) {
    throw new TypeError('approval policy must be one of "ask", "never", or "always"')
  }
  if (policy === 'always') {
    session.append('approval/policy-always', { version: APPROVAL_POLICY_ALWAYS_VERSION, policy })
  } else {
    session.append('approval/policy', { policy })
  }
}

/**
 * The audited ask reason for the `always` per-call gate. Exported for the tool
 * runtime, which routes the upgraded ask through the approval seam.
 */
export const ALWAYS_TOOL_REASON = 'the approval policy requires approval for every tool call'

/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
export interface ApprovalRequest extends ApprovalRequestEvent {
  /**
   * The agent on whose behalf the question is asked. Routes the question (a
   * UI answerer only answers for agents it owns) and receives the audit
   * events on its session log.
   */
  readonly agent: Agent
  /** The tool the question is about (presentation and audit). */
  readonly toolName: string
  /**
   * The exact tool call being decided, when the asker has one — lets a UI
   * attach the prompt to the tool call it already streamed.
   */
  readonly callId?: ToolCallId
  /** The asker's human-readable explanation of WHY it is asking. */
  readonly reason?: string
  /**
   * Aborting withdraws the question: the request settles `'cancelled'`
   * immediately and a late answer from a still-pending answerer is discarded.
   */
  readonly signal?: AbortSignal
}

/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * The deployment's default approval stance for sessions without an
   * `approval/policy` override — `'ask'` delegates to the composed answerers
   * (fail-closed with none); `'never'` auto-rejects every ask without
   * prompting (the deterministic CI/unattended stance). `'always'` is not a
   * deployable default: it is a per-session interactive stance switched by
   * the user (or an ACP client) after the session exists, so the config
   * schema accepts only `'ask' | 'never'`.
   */
  readonly policy?: 'ask' | 'never'
}

/**
 * Approval service that applies session policy before answerers and logs every
 * ask/outcome pair to the requesting session. It exposes deterministic policy
 * changes to the model through the runtime-context snapshot and switch notices.
 */
export class ApprovalService extends Service {
  static Config: z<Config> = z.object({
    policy: z.union(['ask', 'never'] as const).default('ask'),
  })

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'approval')

    const effective = (agent: Agent): ApprovalPolicy => this.effectivePolicy(agent.session)

    // The complete current value travels after retained history, so switching
    // policy does not rewrite the stable system-prompt cache prefix.
    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'approval:policy',
        order: scope.systemPrompt.getContextOrder('APPROVAL_POLICY'),
        text: (context) => {
          const agent = context.agent
          // A bare assemble() (tests, diagnostics) has no session to state.
          if (agent === undefined) return ''
          const policy = effective(agent)
          return policy === 'never' ? NEVER_SENTENCE : policy === 'always' ? ALWAYS_SENTENCE : ASK_SENTENCE
        },
      })
    })

    // The `always` floor is enforced by the tool runtime's pre-execute gate
    // (see `@deepseek-ai/dsh-tools`), which reads {@link ApprovalService.effectivePolicy}
    // and routes the upgraded ask through the same serviceAsk path; registering
    // it here would need the tools event types and close a project-reference
    // cycle with `@deepseek-ai/dsh-tools`.
  }

  /**
   * Switch one live agent's policy and queue the transition for its next model
   * step. Session initialization uses {@link setApprovalPolicy} directly
   * because there is no previously visible policy to change.
   * @param agent - the live agent whose policy is changing.
   * @param policy - the new effective policy.
   */
  setPolicy(agent: Agent, policy: ApprovalPolicy): void {
    const previous = this.effectivePolicy(agent.session)
    if (previous === policy) return
    setApprovalPolicy(agent.session, policy)
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `The approval policy changed from "${previous}" to "${policy}" (changed by the user).`,
      }],
      source: { kind: 'user-approval' },
    }))
  }

  /**
   * Ask the composed answerers to decide one readonly same-process request.
   * The service borrows the request, agent, session, and live signal directly.
   * The request requires an open turn because the audit pair must be enclosed
   * by the durable log's commit/replay boundary; an idle ask rejects before
   * appending anything. The answerer phase always produces an outcome: an
   * aborted signal yields `'cancelled'`, a missing or throwing answerer yields
   * `'unavailable'` (fail closed), and a rogue non-vocabulary return value is
   * normalized to `'unavailable'`. A failure that prevents either audit append
   * from committing still rejects because returning an unlogged decision would
   * violate the pair. Session contains post-commit observer failures, so an
   * authoritative append cannot reject the request or suppress its matching
   * audit event.
   * @param req - the pending decision (agent, tool identity, reason, signal).
   * @returns the closed outcome; `'allowed-once'` is the only grant.
   * @throws when no turn is open or either audit event fails before the session
   *   append commit point.
   */
  async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
    const session = req.agent.session
    if (!hasOpenTurn(session)) {
      throw new Error(
        'approval.request() outside an open turn: the approval/asked + approval/decided audit pair '
        + 'must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). '
        + 'Ask from inside the turn that needs the decision.',
      )
    }
    const id = ApprovalRequestId(randomUUID())
    session.append('approval/asked', {
      id,
      toolName: req.toolName,
      ...req.callId !== undefined ? { callId: req.callId } : {},
      ...req.reason !== undefined ? { reason: req.reason } : {},
    })
    const outcome = await this.decide(req, session)
    session.append('approval/decided', { id, outcome })
    return outcome
  }

  /**
   * The session's effective policy: its own policy-event fold
   * (`approval/policy` + `approval/policy-always`), else the
   * configured default (the schema already defaulted an omitted policy to
   * `'ask'`; the `??` only narrows the optional-input TYPE). Read by the ACP
   * config advertisement to publish the current policy value.
   * @param session - the exact accepted session whose policy applies.
   * @returns the policy every ask for this session resolves under right now.
   */
  effectivePolicy(session: Session): ApprovalPolicy {
    return this.overrideOf(session) ?? this.config.policy ?? 'ask'
  }

  /**
   * Read the session override without applying the configured default.
   * @param session - session whose log supplies the override.
   * @returns the last logged policy, or `undefined` without one.
   */
  overrideOf(session: Session): ApprovalPolicy | undefined {
    for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const event = session.eventAt(SessionSeq(seq))
      if (event?.type === 'approval/policy' || event?.type === 'approval/policy-always') return event.data.policy
    }
    return undefined
  }

  /**
   * Dispatch the waterfall, contained and raced against the request signal.
   * @param req - the borrowed public request.
   * @param session - the request agent's session used for policy lookup.
   * @returns the normalized closed outcome.
   */
  private async decide(req: ApprovalRequest, session: Session): Promise<ApprovalOutcome> {
    const signal = req.signal
    if (signal?.aborted) return 'cancelled'
    // The 'never' policy is decided HERE, before any dispatch: a listener
    // registered with `prepend: true` after this service mounts would sit
    // ahead of any gate LISTENER, so a listener-shaped gate cannot keep the
    // documented promise that 'never' rejects deterministically regardless
    // of registration order — only the service's own request path can.
    if (this.effectivePolicy(session) === 'never') return 'rejected'
    // Enter the promise chain BEFORE dispatching: a listener that throws
    // SYNCHRONOUSLY (before its first await) must land in the same rejection
    // path as an async one — `Promise.resolve(call())` would let it escape
    // the containment into the caller.
    const answer: Promise<ApprovalOutcome> = Promise.resolve().then(
      () => this.ctx.waterfall(
        scopeTarget(req.agent, req.agent), 'approval/request', req,
        () => Promise.resolve<ApprovalOutcome>('unavailable'),
      ),
    ).then(
      // Normalize a rogue (non-vocabulary) answerer return to the fail-closed
      // outcome instead of leaking it into callers' closed-union switches.
      outcome => OUTCOMES.includes(outcome) ? outcome : 'unavailable',
      // A throwing answerer must fail the QUESTION closed, not the caller's
      // tool call open — the seam contains its callbacks.
      () => 'unavailable',
    )
    if (signal === undefined) return answer
    return await new Promise<ApprovalOutcome>((resolve) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        resolve('cancelled')
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void answer.then((outcome) => {
        signal.removeEventListener('abort', onAbort)
        // After an abort won the race this resolve is a settled-promise no-op:
        // the late answer is discarded by construction.
        resolve(outcome)
      })
    })
  }
}

export default ApprovalService
