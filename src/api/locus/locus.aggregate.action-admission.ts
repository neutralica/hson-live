import type { HsonDataValue } from "../data/hson-data.js";
import type {
  LocusActionAuthorizer,
  LocusActionDelivery,
  LocusActionPayloads,
  LocusActionTerminalOutcome,
  LocusClientActionMessage,
  LocusClientActionResult,
  LocusConnectionContext,
  LocusDisposer,
  LocusActionOrigin,
} from "../../types/locus.types.js";
import { authorize_locus_action } from "./locus.action-authorization.js";
import type { LocusActionDedupeStore } from "./locus.actions.js";
import { make_locus_action_response } from "./locus.action-response.js";

/** The queued operation closes over the validated definition, origin and exact input. */
export type LocusAggregateAdmittedAction = Readonly<{
  ok: true;
  payload: HsonDataValue | undefined;
  run: () => Promise<HsonDataValue | undefined>;
}>;

export type LocusAggregateValidatedAction =
  | LocusAggregateAdmittedAction
  | Readonly<{ ok: false; code: string; message: string }>;

/** Internal authority capture installed only by the owning aggregate Locus runtime. */
export type LocusAggregateActionAuthorityInternals<TActions extends LocusActionPayloads> = Readonly<{
  authorizer: LocusActionAuthorizer<TActions> | undefined;
  actionRequests: LocusActionDedupeStore;
  logicalMapId: string;
  incarnationId: string;
  currentSeq: () => number;
  headRev: () => number;
  validateAction: (message: LocusClientActionMessage, origin: LocusActionOrigin) => LocusAggregateValidatedAction;
  executeAction: (
    admitted: LocusAggregateAdmittedAction,
  ) => Promise<LocusActionTerminalOutcome>;
  acquireActionActivity: () => LocusDisposer;
}>;

export type LocusAggregateExternalActionAttempt = Readonly<{
  message: LocusClientActionMessage;
  origin: Extract<LocusActionOrigin, { kind: "session" }>;
  connection?: LocusConnectionContext;
  attachmentCurrent: () => boolean;
}>;

export type LocusAggregateActionAdmissionResult =
  | Readonly<{ response: LocusClientActionResult; kind: "untracked" | "rejected" }>
  | Readonly<{
      response: LocusClientActionResult;
      kind: "deduped";
      delivery: Exclude<LocusActionDelivery, "rejected">;
    }>;

function rejectionResponse<TActions extends LocusActionPayloads>(
  authority: LocusAggregateActionAuthorityInternals<TActions>,
  message: LocusClientActionMessage,
  code: string,
  errorMessage: string,
  stable: boolean,
): LocusClientActionResult {
  return Object.freeze({
    type: "error",
    id: message.id,
    ...(message.requestId === undefined ? {} : { requestId: message.requestId }),
    ...(message.attemptId === undefined ? {} : { attemptId: message.attemptId }),
    ok: false,
    seq: authority.currentSeq(),
    completionRev: authority.headRev(),
    ...(stable ? { delivery: "rejected" as const } : {}),
    error: Object.freeze({ code, message: errorMessage }),
  });
}

/** Capture identity before reading the caller's payload or doing attachment work. */
export function capture_locus_action_message(message: LocusClientActionMessage): LocusClientActionMessage {
  const { id, name, ...fields } = message;
  return Object.freeze({ ...fields, id, name });
}

/** Authority-owned admission for one decoded remote action attempt. */
export async function admit_locus_aggregate_external_action<
  TActions extends LocusActionPayloads,
>(
  authority: LocusAggregateActionAuthorityInternals<TActions>,
  attempt: LocusAggregateExternalActionAttempt,
): Promise<LocusAggregateActionAdmissionResult> {
  const { message } = attempt;
  const stable = message.requestId !== undefined && message.clientId !== undefined;
  const rejectStaleAttachment = (): LocusAggregateActionAdmissionResult => Object.freeze({
    kind: "rejected",
    response: rejectionResponse(
      authority,
      message,
      "LOCUS_SESSION_ATTACHMENT_FENCED",
      "Locus session attachment is no longer authoritative.",
      stable,
    ),
  });

  if (!attempt.attachmentCurrent()) return rejectStaleAttachment();

  const validated = authority.validateAction(message, attempt.origin);
  if (!validated.ok) {
    return Object.freeze({
      kind: "rejected",
      response: rejectionResponse(authority, message, validated.code, validated.message, stable),
    });
  }

  // Data reflection may have fenced the attachment before application authorization.
  if (!attempt.attachmentCurrent()) return rejectStaleAttachment();

  const authorization = authorize_locus_action<TActions>({
    authorizer: authority.authorizer,
    action: message.name,
    payload: validated.payload,
    origin: attempt.origin,
    logicalMapId: authority.logicalMapId,
    incarnationId: authority.incarnationId,
    ...(attempt.connection === undefined ? {} : { connection: attempt.connection }),
  });
  const authorized = authorization instanceof Promise ? await authorization : authorization;
  if (!authorized.ok) {
    return Object.freeze({
      kind: "rejected",
      response: rejectionResponse(authority, message, authorized.code, authorized.message, stable),
    });
  }

  // This is the last attachment-sensitive boundary. Once a new request record
  // is installed, aggregate authority work is independent of its transport.
  if (!attempt.attachmentCurrent()) return rejectStaleAttachment();

  const run = () => authority.executeAction(validated);
  if (!stable) {
    const releaseActivity = authority.acquireActionActivity();
    try {
      return Object.freeze({
        kind: "untracked",
        response: make_locus_action_response(message.id, await run()),
      });
    } finally {
      releaseActivity();
    }
  }

  const result = await authority.actionRequests.execute({
    clientId: message.clientId,
    requestId: message.requestId,
    ownerPrincipalId: attempt.connection?.principalId,
    actionName: message.name,
    payload: validated.payload,
    retry: message.retry === true,
    acquireExecutionActivity: authority.acquireActionActivity,
    run,
  });
  if (!result.ok) {
    return Object.freeze({
      kind: "rejected",
      response: rejectionResponse(authority, message, result.code, result.message, true),
    });
  }
  return Object.freeze({
    kind: "deduped",
    delivery: result.delivery,
    response: make_locus_action_response(
      message.id,
      result.outcome,
      message.requestId,
      result.delivery,
      message.attemptId,
    ),
  });
}
