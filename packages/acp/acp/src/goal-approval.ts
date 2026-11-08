/**
 * ACP face of goal completion authorization (S54): the goal-review answerer
 * that forwards `update_goal` authorization reviews over the existing
 * `session/request_permission` channel, with the Authorize/Deny option
 * vocabulary.
 *
 * The answer itself never grants anything on the wire: the goal tool in the
 * host converts an Authorize outcome into a witnessed user message the
 * model's own re-call consumes, so no external caller can complete a goal.
 * Profiles without the goal tools never produce `goal-review` questions, and
 * this answerer delegates them to `next()` untouched.
 *
 * @module @deepseek-ai/dsh-acp/goal-approval
 */

import type { AskUserQuestionAnswer, AskUserQuestionRequestEvent } from '@deepseek-ai/dsh-user-questions/types'
import { answerPermissionReview, permissionReviewOptions } from './permission-review.ts'
import type { PermissionReviewOption, RequestPermissionOutcome, ReviewSessionSource } from './permission-review.ts'

/** optionId that authorizes the reviewed goal operation on the permission channel. */
export const GOAL_APPROVE_OPTION_ID = 'approve'

/** optionId that declines the reviewed goal operation on the permission channel. */
export const GOAL_DENY_OPTION_ID = 'deny'

/**
 * Build the two-option review vocabulary for one goal authorization request.
 * @param approveLabel - the question's authorizing option label (the intent's `approve`).
 * @param denyLabel - the question's other option label.
 * @returns the approve/deny pair in presentation order.
 */
export function goalReviewPermissionOptions(approveLabel: string, denyLabel: string): PermissionReviewOption[] {
  return permissionReviewOptions(approveLabel, denyLabel, GOAL_DENY_OPTION_ID)
}

/** The goal-review face: the intent kind this answerer claims and its permission vocabulary. */
const GOAL_REVIEW_FACE = {
  intentKind: 'goal-review',
  buildOptions: goalReviewPermissionOptions,
} as const

/**
 * Build the `user-questions/request` waterfall listener that forwards
 * goal-review questions over `session/request_permission`. Every non-goal
 * review — plan reviews, generic questions, other sessions, multi-question
 * batches — delegates to `next()`.
 *
 * @param source - the bridge-owned session record whose agent is under review.
 * @param request - the scoped waterfall request.
 * @param next - delegate to later listeners.
 * @param sendPermission - transport seam that performs one permission round trip.
 * @returns the structured answer claiming the request, or `next()`'s promise.
 */
/* jscpd:ignore-start -- deliberately mirrors answerPlanReview: each face exports its own wrapper over the shared review core. */
export function answerGoalReview(
  source: ReviewSessionSource,
  request: AskUserQuestionRequestEvent,
  next: () => Promise<AskUserQuestionAnswer>,
  sendPermission: (
    sessionId: string,
    callId: string,
    approveLabel: string,
    declineLabel: string,
  ) => Promise<RequestPermissionOutcome>,
): Promise<AskUserQuestionAnswer> {
  return answerPermissionReview(source, request, next, sendPermission, GOAL_REVIEW_FACE)
}
/* jscpd:ignore-end */
