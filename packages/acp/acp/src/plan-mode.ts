/**
 * ACP face of dsh plan mode (S51): the standard `session/set_mode` vocabulary,
 * the optional `modes` advertisement for new/resume responses, and the
 * plan-review answerer that forwards `exit_plan_mode` reviews over the
 * existing `session/request_permission` channel.
 *
 * Mode state lives in {@link PlanModeController} and the durable `plan/mode`
 * event; this module only validates vocabulary, reads committed state, and
 * maps the review question. Profiles without the plan-mode plugin advertise no
 * `modes` field and fail loud on `session/set_mode`.
 *
 * @module @deepseek-ai/dsh-acp/plan-mode
 */

import { RequestError, type SessionModeState } from '@agentclientprotocol/sdk'
import type { Context } from '@deepseek-ai/cordis'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type { AskUserQuestionAnswer, AskUserQuestionRequestEvent } from '@deepseek-ai/dsh-user-questions/types'
import { answerPermissionReview, permissionReviewOptions } from './permission-review.ts'
import type { PermissionReviewOption, RequestPermissionOutcome, ReviewSessionSource } from './permission-review.ts'

/** The session mode id for dsh plan mode. */
export const PLAN_MODE_ID = 'plan'

/** The session mode id for the default (non-plan) mode. */
export const NORMAL_MODE_ID = 'normal'

/** Complete advertised mode vocabulary, advertisement order. */
export const SESSION_MODE_IDS = [PLAN_MODE_ID, NORMAL_MODE_ID] as const

/** optionId that approves the reviewed plan on the permission channel. */
export const APPROVE_OPTION_ID = 'approve'

/** optionId that declines the reviewed plan on the permission channel. */
export const KEEP_PLANNING_OPTION_ID = 'keep-planning'

export type { RequestPermissionOutcome } from './permission-review.ts'

/** Standard invalid-parameter failure with protocol-safe detail. */
function invalidParams(detail: string): RequestError {
  return RequestError.invalidParams(undefined, detail)
}

/** Standard internal failure with protocol-safe detail. */
function internalError(detail: string): RequestError {
  return RequestError.internalError(undefined, detail)
}

/** The plan-review face: the intent kind this answerer claims and its permission vocabulary. */
const PLAN_REVIEW_FACE = {
  intentKind: 'plan-review',
  buildOptions: planReviewPermissionOptions,
} as const

/**
 * Validate one client-supplied mode id against the advertised vocabulary.
 * @param modeId - raw `session/set_mode` mode id.
 * @returns the validated dsh mode id.
 */
export function parseSessionModeId(modeId: string): (typeof SESSION_MODE_IDS)[number] {
  if (modeId !== PLAN_MODE_ID && modeId !== NORMAL_MODE_ID) {
    throw invalidParams(`unknown session mode: ${modeId} (expected one of: ${SESSION_MODE_IDS.join(', ')})`)
  }
  return modeId
}

/**
 * Read the committed plan state as the standard mode advertisement.
 * @param ctx - ACP plugin context whose composition may own a plan-mode controller.
 * @param agent - the session's live agent.
 * @returns the two-mode advertisement, or `undefined` when the plan-mode
 *   plugin is not composed (the response omits `modes` entirely).
 */
export function sessionModes(ctx: Context, agent: Agent): SessionModeState | undefined {
  const controller = ctx.get('planMode')
  if (controller === undefined) return undefined
  return {
    currentModeId: controller.get(agent).active ? PLAN_MODE_ID : NORMAL_MODE_ID,
    availableModes: [
      { id: PLAN_MODE_ID, name: 'Plan', description: 'Research and plan first; exit_plan_mode presents the plan for review.' },
      { id: NORMAL_MODE_ID, name: 'Normal', description: 'Default mode; the agent acts directly on each request.' },
    ],
  }
}

/**
 * Apply one validated mode selection to the session's plan controller.
 * @param ctx - ACP plugin context whose composition may own a plan-mode controller.
 * @param agent - the session's live agent.
 * @param modeId - validated vocabulary id.
 * @throws {RequestError} internal error when the plan-mode plugin is not
 *   composed, or when committing the selection fails; the selection outcome
 *   (committed/queued/cancelled/noop) is intentionally not returned — the
 *   `current_mode_update` notification derived from the durable event is the
 *   only effect observation.
 */
export function applySessionMode(ctx: Context, agent: Agent, modeId: string): void {
  const controller = ctx.get('planMode')
  if (controller === undefined) {
    throw internalError('plan mode is not composed in this session: mount @deepseek-ai/dsh-plan-mode')
  }
  try {
    controller.set(agent, modeId === PLAN_MODE_ID)
  } catch (error: unknown) {
    if (error instanceof RequestError) throw error
    throw internalError(`session mode change failed: ${errorChain(error)}`)
  }
}

/**
 * Build the two-option review vocabulary for one permission request.
 * @param approveLabel - the question's approving option label (the intent's `approve`).
 * @param declineLabel - the question's other option label.
 * @returns the approve/keep-planning pair in presentation order.
 */
export function planReviewPermissionOptions(approveLabel: string, declineLabel: string): PermissionReviewOption[] {
  return permissionReviewOptions(approveLabel, declineLabel, KEEP_PLANNING_OPTION_ID)
}

/**
 * Build the `user-questions/request` waterfall listener that forwards
 * plan-review questions over `session/request_permission`. Every non-plan
 * review — other questions, other sessions, multi-question batches, intents
 * without a logged tool call — delegates to `next()`, keeping the existing
 * no-answerer behavior for the future full userQuestions channel.
 *
 * @param source - the bridge-owned session record whose agent is under review.
 * @param request - the scoped waterfall request.
 * @param next - delegate to later listeners.
 * @param sendPermission - transport seam that performs one permission round trip.
 * @returns the structured answer claiming the request, or `next()`'s promise.
 */
export function answerPlanReview(
  source: ReviewSessionSource,
  request: AskUserQuestionRequestEvent,
  next: () => Promise<AskUserQuestionAnswer>,
  sendPermission: (sessionId: string, callId: string, approveLabel: string, declineLabel: string) => Promise<RequestPermissionOutcome>,
): Promise<AskUserQuestionAnswer> {
  return answerPermissionReview(source, request, next, sendPermission, PLAN_REVIEW_FACE)
}
