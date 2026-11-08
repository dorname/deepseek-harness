/**
 * Shared core for the user-questions intents the ACP bridge answers over the
 * standard `session/request_permission` channel. Each intent face (plan
 * review, goal authorization review) supplies its intent kind and vocabulary
 * builder; the transport seam, ownership filtering, and outcome mapping are
 * identical and live here.
 *
 * @module @deepseek-ai/dsh-acp/permission-review
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionRequestEvent } from '@deepseek-ai/dsh-user-questions/types'

/** optionId that approves the reviewed artifact on the permission channel. */
export const APPROVE_OPTION_ID = 'approve'

/** One selectable choice on the permission channel for a review question. */
export interface PermissionReviewOption {
  /** Stable option id the outcome echoes back. */
  optionId: string
  /** User-facing label. */
  name: string
  /** ACP permission kind; reviews are one-shot decisions. */
  kind: 'allow_once' | 'reject_once'
}

/** One settled permission round trip, narrowed for review mapping. */
export type RequestPermissionOutcome =
  | {
    /** The client dismissed the review instead of choosing. */
    kind: 'cancelled'
  }
  | {
    /** The client selected an option. */
    kind: 'selected'
    /** The chosen option id. */
    optionId: string
  }

/**
 * The dismissal error the reviewing tool already maps to its turn-back message.
 * @returns the `ASK_CANCELLED` error carrying the generic dismissal text.
 */
export function reviewDismissed(): UserQuestionError {
  return new UserQuestionError('the ACP client dismissed the review', 'ASK_CANCELLED')
}

/**
 * Build the two-option review vocabulary for one permission request.
 * @param approveLabel - the question's approving option label (the intent's `approve`).
 * @param declineLabel - the question's other option label.
 * @param declineOptionId - stable option id the decline outcome echoes back.
 * @returns the approve/decline pair in presentation order.
 */
export function permissionReviewOptions(
  approveLabel: string,
  declineLabel: string,
  declineOptionId: string,
): PermissionReviewOption[] {
  return [
    { optionId: APPROVE_OPTION_ID, name: approveLabel, kind: 'allow_once' },
    { optionId: declineOptionId, name: declineLabel, kind: 'reject_once' },
  ]
}

/** A bridge-owned session record narrowed to what a review answerer needs. */
export interface ReviewSessionSource {
  /** The exact session whose reviews this answerer forwards. */
  agent: Agent
  /** Await every update queued before this call. */
  drainUpdates(): Promise<void>
}

/** The intent kind and option vocabulary one review face claims. */
export interface PermissionReviewFace {
  /** The user-questions intent kind this face claims. */
  intentKind: 'plan-review' | 'goal-review'
  /** Build the permission options for one question's approve/decline labels. */
  buildOptions(approveLabel: string, declineLabel: string): PermissionReviewOption[]
}

/**
 * Build the `user-questions/request` waterfall listener body that forwards
 * one review intent over `session/request_permission`. Requests whose single
 * question carries the face's intent with a logged tool call and a distinct
 * decline label are claimed; every other request — other intents, other
 * sessions, multi-question batches — delegates to `next()`.
 *
 * @param source - the bridge-owned session record whose agent is under review.
 * @param request - the scoped waterfall request.
 * @param next - delegate to later listeners.
 * @param sendPermission - transport seam that performs one permission round trip.
 * @param face - the intent kind and option vocabulary this answerer claims.
 * @returns the structured answer claiming the request, or `next()`'s promise.
 */
export function answerPermissionReview(
  source: ReviewSessionSource,
  request: AskUserQuestionRequestEvent,
  next: () => Promise<AskUserQuestionAnswer>,
  sendPermission: (sessionId: string, callId: string, approveLabel: string, declineLabel: string) => Promise<RequestPermissionOutcome>,
  face: PermissionReviewFace,
): Promise<AskUserQuestionAnswer> {
  const record = source.agent === request.agent ? source : undefined
  if (record === undefined || request.questions.length !== 1) return next()
  const question = request.questions[0]
  /* v8 ignore next -- the length guard proves questions[0] exists; the check only satisfies noUncheckedIndexedAccess. */
  if (question === undefined) return next()
  const intent = question.intent
  if (intent === undefined || intent.kind !== face.intentKind || intent.callId === undefined) return next()
  const declineLabel = (question.options ?? []).map(option => option.label).find(label => label !== intent.approve)
  if (declineLabel === undefined) return next()
  const callId = intent.callId
  return source.drainUpdates()
    .then(() => sendPermission(record.agent.session.id, callId, intent.approve, declineLabel))
    .then((outcome) => {
      if (outcome.kind === 'cancelled') throw reviewDismissed()
      return {
        answers: [{
          id: question.id,
          selected: [outcome.optionId === APPROVE_OPTION_ID ? intent.approve : declineLabel],
        }],
      }
    })
}
