import type { JsonValue } from "../../core/types.js";
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
import { make_locus_action_response } from "./locus.action-admission.js";

export type LocusAggregateValidatedAction =
  | Readonly<{ ok: true; payload: JsonValue | undefined }>
  | Readonly<{ ok: false; code: string; message: string }>;

export type LocusAggregateExternalActionAuthority<TActions extends LocusActionPayloads> = Readonly<{
  authorizer: LocusActionAuthorizer<TActions> | undefined;
  actionRequests: LocusActionDedupeStore;
  logicalMapId: string;
  incarnationId: string;
  currentSeq: () => number;
  headRev: () => number;
  validateAction: (message: LocusClientActionMessage<TActions>) => LocusAggregateValidatedAction;
  executeAction: (
    message: LocusClientActionMessage<TActions>,
    payload: JsonValue | undefined,
  ) => Promise<LocusActionTerminalOutcome>;
  acquireActionActivity: () => LocusDisposer;
}>;

export type LocusAggregateExternalActionAttempt<TActions extends LocusActionPayloads> = Readonly<{
  message: LocusClientActionMessage<TActions>;
  origin: Extract<LocusActionOrigin, { kind: "session" }>;
  connection?: LocusConnectionContext;
  attachmentCurrent: () => boolean;
}>;

export type LocusAggregateActionAdmissionResult =
  | Readonly<{ response: LocusClientActionResult; kind: "legacy" | "rejected" }>
  | Readonly<{
      response: LocusClientActionResult;
      kind: "deduped";
      delivery: Exclude<LocusActionDelivery, "rejected">;
    }>;

function rejectionResponse<TActions extends LocusActionPayloads>(
  authority: LocusAggregateExternalActionAuthority<TActions>,
  message: LocusClientActionMessage<TActions>,
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

/** Authority-owned admission for one decoded fixed-registry aggregate action attempt. */
export async function admit_locus_aggregate_external_action<
  TActions extends LocusActionPayloads,
>(
  authority: LocusAggregateExternalActionAuthority<TActions>,
  attempt: LocusAggregateExternalActionAttempt<TActions>,
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

  const validated = authority.validateAction(message);
  if (!validated.ok) {
    return Object.freeze({
      kind: "rejected",
      response: rejectionResponse(authority, message, validated.code, validated.message, stable),
    });
  }

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

  const run = () => authority.executeAction(message, authorized.payload);
  if (!stable) {
    const releaseActivity = authority.acquireActionActivity();
    try {
      return Object.freeze({
        kind: "legacy",
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
    payload: authorized.payload,
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
