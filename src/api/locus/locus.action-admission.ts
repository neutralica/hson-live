import type { JsonValue } from "../../core/types.js";
import type { LiveMapAnyOp, LiveMapAuthority, LiveMapCommit } from "../../types/livemap.types.js";
import type {
  LocusActionAuthorizer, LocusActionContext, LocusActionDelivery, LocusActionOrigin, LocusActionPayloads,
  LocusActionTerminalOutcome, LocusActions, LocusClientActionMessage, LocusClientActionResult,
  LocusConnectionContext, LocusMapValue, LocusMutationDraft, LocusReadonlyMap, LocusSchema, LocusSeq,
} from "../../types/locus.types.js";
import type { LocusActionDedupeStore } from "./locus.actions.js";
import { authorize_locus_action } from "./locus.action-authorization.js";
import { LocusAuthorityError } from "./locus.authority.js";
import { decode_locus_action_payload, locus_schema_error_message } from "./locus.action-validation.js";
import { is_locus_document_action_target, resolve_locus_document_action } from "./locus.document-actions.js";
import { is_locus_json_value } from "./locus.protocol.js";
import type { LocusCommitCausation, LiveTraceContext } from "./locus.trace.js";

type LocusActionHandler<TMap extends LiveMapAuthority, TActions extends LocusActionPayloads> =
  NonNullable<Partial<LocusActions<TActions, TMap>>[keyof TActions & string]>;

export type LocusValidatedAction<TMap extends LiveMapAuthority, TActions extends LocusActionPayloads> =
  | Readonly<{ ok: true; handler: LocusActionHandler<TMap, TActions>; payload: JsonValue | undefined }>
  | Readonly<{ ok: false; code: "LOCUS_ACTION_UNKNOWN" | "LOCUS_ACTION_UNAVAILABLE" | "LOCUS_ACTION_INVALID"; message: string }>;

export type LocusSoloExternalActionAuthority<TMap extends LiveMapAuthority, TActions extends LocusActionPayloads> = Readonly<{
  map: TMap;
  readonlyMap: LocusReadonlyMap<TMap>;
  actions: Partial<LocusActions<TActions, TMap>>;
  schema: LocusSchema<LocusMapValue<TMap>, TActions> | undefined;
  authorizer: LocusActionAuthorizer<TActions> | undefined;
  actionRequests: LocusActionDedupeStore;
  mutations: Readonly<{
    mutate: (mutation: (draft: TMap) => LiveMapCommit<LiveMapAnyOp>, source: "action", causation?: LocusCommitCausation) => Promise<LiveMapCommit<LiveMapAnyOp>>;
  }>;
  logicalMapId: string;
  incarnationId: string;
  mapMode: LiveMapAuthority["mode"];
  currentSeq: () => LocusSeq;
  nextSeq: () => LocusSeq;
  headRev: () => number;
  disposed: () => boolean;
  traceStateBoundary: (trace: LiveTraceContext | undefined, parentSpanId: string | undefined, previousRev: number) => void;
}>;

export type LocusSoloExternalActionAttempt<TActions extends LocusActionPayloads, TMap extends LiveMapAuthority> = Readonly<{
  message: LocusClientActionMessage<TActions>;
  origin: Extract<LocusActionOrigin, { kind: "session" }>;
  connection?: LocusConnectionContext;
  emitEvent?: LocusActionContext<TMap>["emit_event"];
  trace?: LiveTraceContext;
  parentSpanId?: string;
}>;

export type LocusSoloActionAdmissionResult =
  | Readonly<{ response: LocusClientActionResult; kind: "legacy" | "rejected" }>
  | Readonly<{ response: LocusClientActionResult; kind: "deduped"; delivery: Exclude<LocusActionDelivery, "rejected">; sourceTraceId?: string }>;

function safeErrorCode(cause: unknown, fallback: string): string {
  return typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : fallback;
}

export function locus_action_public_error_code(code: "LOCUS_ACTION_UNKNOWN" | "LOCUS_ACTION_UNAVAILABLE" | "LOCUS_ACTION_INVALID"):
  "LOCUS_UNKNOWN_ACTION" | "LOCUS_ACTION_UNAVAILABLE" | "LOCUS_SCHEMA_INVALID_PAYLOAD" {
  if (code === "LOCUS_ACTION_UNKNOWN") return "LOCUS_UNKNOWN_ACTION";
  if (code === "LOCUS_ACTION_UNAVAILABLE") return "LOCUS_ACTION_UNAVAILABLE";
  return "LOCUS_SCHEMA_INVALID_PAYLOAD";
}

function actionCausation<TMap extends LiveMapAuthority, TActions extends LocusActionPayloads>(
  authority: LocusSoloExternalActionAuthority<TMap, TActions>,
  message: LocusClientActionMessage<TActions>,
  origin: LocusActionOrigin,
  trace: LiveTraceContext | undefined,
): LocusCommitCausation | undefined {
  if (trace === undefined) return undefined;
  return Object.freeze({
    sourceTraceId: trace.traceId,
    ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
    ...(message.attemptId !== undefined ? { attemptId: message.attemptId } : {}),
    logicalMapId: authority.logicalMapId,
    incarnationId: authority.incarnationId,
    mapMode: authority.mapMode,
    origin: origin.kind,
    sourceAction: message.name,
  });
}

export function resolve_locus_action_for_execution<TMap extends LiveMapAuthority, TActions extends LocusActionPayloads>(
  authority: LocusSoloExternalActionAuthority<TMap, TActions>,
  message: LocusClientActionMessage<TActions>,
  trace?: LiveTraceContext,
  parentSpanId?: string,
): LocusValidatedAction<TMap, TActions> {
  const lookupSpan = trace?.beginSpan("locus", "action.lookup", parentSpanId, () => ({ action: message.name }));
  const documentAction = resolve_locus_document_action(authority.map, message.name, message.payload);
  if (documentAction.kind === "unavailable") {
    lookupSpan?.failure(() => ({ action: message.name, errorCode: "LOCUS_ACTION_UNAVAILABLE" }));
    return { ok: false, code: "LOCUS_ACTION_UNAVAILABLE", message: documentAction.message };
  }
  const configuredHandler = authority.actions[message.name];
  if (documentAction.kind === "not-document-action" && !configuredHandler) {
    lookupSpan?.failure(() => ({ action: message.name, errorCode: "LOCUS_UNKNOWN_ACTION" }));
    return { ok: false, code: "LOCUS_ACTION_UNKNOWN", message: `Unknown Locus action: ${message.name}` };
  }
  lookupSpan?.success(() => ({ action: message.name }));

  const validationSpan = trace?.beginSpan("locus", "payload.validation", parentSpanId, () => ({
    action: message.name,
    payloadPresent: message.payload !== undefined,
  }));
  if (documentAction.kind === "invalid") {
    validationSpan?.failure(() => ({ action: message.name, errorCode: "LOCUS_SCHEMA_INVALID_PAYLOAD", issueCount: 1 }));
    return { ok: false, code: "LOCUS_ACTION_INVALID", message: documentAction.message };
  }
  if (documentAction.kind === "ready") {
    const handler: LocusActionHandler<TMap, TActions> = async (context) => {
      await context.mutate((draft) => {
        if (!is_locus_document_action_target(draft)) throw new Error("Locus document action draft mode is unavailable.");
        return documentAction.execute(draft);
      });
    };
    validationSpan?.success(() => ({ action: message.name, schemaConfigured: true }));
    return { ok: true, handler, payload: documentAction.payload };
  }
  if (!configuredHandler) throw new Error("Locus action resolution lost its configured handler.");
  const actionSchema = authority.schema?.actions?.[message.name];
  let payloadResult;
  try {
    payloadResult = decode_locus_action_payload(actionSchema?.payload, message.payload);
  } catch (cause) {
    validationSpan?.failure(() => ({ action: message.name, errorCode: safeErrorCode(cause, "LOCUS_SCHEMA_DECODER_FAILED") }));
    throw cause;
  }
  if (!payloadResult.ok) {
    validationSpan?.failure(() => ({ action: message.name, errorCode: "LOCUS_SCHEMA_INVALID_PAYLOAD", issueCount: payloadResult.issues.length }));
    return { ok: false, code: "LOCUS_ACTION_INVALID", message: locus_schema_error_message(payloadResult.issues) };
  }
  validationSpan?.success(() => ({ action: message.name, schemaConfigured: actionSchema?.payload !== undefined }));
  return { ok: true, handler: configuredHandler, payload: payloadResult.value };
}

function authorizeAction<TMap extends LiveMapAuthority, TActions extends LocusActionPayloads>(
  authority: LocusSoloExternalActionAuthority<TMap, TActions>,
  message: LocusClientActionMessage<TActions>,
  payload: JsonValue | undefined,
  origin: Extract<LocusActionOrigin, { kind: "session" }>,
  trace?: LiveTraceContext,
  parentSpanId?: string,
  connection?: LocusConnectionContext,
) {
  if (authority.authorizer === undefined) {
    trace?.emit({ subsystem: "locus", phase: "action.authorization", status: "skip", ...(parentSpanId !== undefined ? { parentSpanId } : {}), details: () => ({ action: message.name, reason: "implicit-allow" }) });
    return { ok: true as const, payload };
  }
  const authorizationSpan = trace?.beginSpan("locus", "action.authorization", parentSpanId, () => ({ action: message.name }));
  const authorization = authorize_locus_action<TActions>({
    authorizer: authority.authorizer,
    action: message.name,
    payload,
    origin,
    logicalMapId: authority.logicalMapId,
    incarnationId: authority.incarnationId,
    ...(connection === undefined ? {} : { connection }),
  });
  function finish(result: Awaited<typeof authorization>) {
    if (!result.ok) {
      authorizationSpan?.failure(() => ({ action: message.name, outcome: result.code === "LOCUS_ACTION_FORBIDDEN" ? "denied" : "failed", errorCode: result.code }));
      return result;
    }
    authorizationSpan?.success(() => ({ action: message.name, outcome: "allowed" }));
    return result;
  }
  return authorization instanceof Promise ? authorization.then(finish) : finish(authorization);
}

function rejectionResponse<TActions extends LocusActionPayloads>(
  message: LocusClientActionMessage<TActions>, currentSeq: LocusSeq, completionRev: number,
  code: string, errorMessage: string, stable: boolean,
): LocusClientActionResult {
  return {
    type: "error", id: message.id,
    ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
    ...(message.attemptId !== undefined ? { attemptId: message.attemptId } : {}),
    ok: false, seq: currentSeq, completionRev,
    ...(stable ? { delivery: "rejected" as const } : {}),
    error: { code, message: errorMessage },
  };
}

export function make_locus_action_response(
  id: string, outcome: LocusActionTerminalOutcome, requestId?: string,
  delivery?: LocusActionDelivery, attemptId?: string,
): LocusClientActionResult {
  if (outcome.state === "succeeded") {
    return {
      type: "ack", id, ok: true, seq: outcome.seq, completionRev: outcome.completionRev,
      ...(requestId ? { requestId } : {}), ...(attemptId ? { attemptId } : {}),
      ...(delivery ? { delivery } : {}), ...(outcome.result !== undefined ? { result: outcome.result } : {}),
    };
  }
  return {
    type: "error", id, ok: false, seq: outcome.seq, completionRev: outcome.completionRev,
    ...(requestId ? { requestId } : {}), ...(attemptId ? { attemptId } : {}),
    ...(delivery ? { delivery } : {}), error: outcome.error,
  };
}

export async function execute_locus_action_handler<
  TMap extends LiveMapAuthority,
  TActions extends LocusActionPayloads,
>(input: Readonly<{
  authority: Pick<LocusSoloExternalActionAuthority<TMap, TActions>,
    "readonlyMap" | "mutations" | "currentSeq" | "nextSeq" | "headRev" | "traceStateBoundary">;
  message: LocusClientActionMessage<TActions>;
  handler: LocusActionHandler<TMap, TActions>;
  payload: JsonValue | undefined;
  origin: LocusActionOrigin;
  emitEvent: LocusActionContext<TMap>["emit_event"];
  trace?: LiveTraceContext;
  parentSpanId?: string;
  causation?: LocusCommitCausation;
}>): Promise<LocusActionTerminalOutcome> {
  const previousRev = input.authority.headRev();
  const handlerSpan = input.trace?.beginSpan(
    "locus", "handler.execute", input.parentSpanId,
    () => ({ action: input.message.name, origin: input.origin.kind }),
  );
  let open = true;
  const pending: Promise<LiveMapCommit<LiveMapAnyOp>>[] = [];
  const context: LocusActionContext<TMap> = Object.freeze({
    map: input.authority.readonlyMap,
    mutate(mutation: (draft: LocusMutationDraft<TMap>) => LiveMapCommit<LiveMapAnyOp>) {
      if (!open) {
        return Promise.reject(new LocusAuthorityError(
          "LOCUS_AUTHORITY_CLOSED",
          "Locus action mutation context is expired.",
        ));
      }
      const operation = input.authority.mutations.mutate(
        mutation as unknown as (draft: TMap) => LiveMapCommit<LiveMapAnyOp>,
        "action",
        input.causation,
      );
      pending.push(operation);
      return operation;
    },
    seq: input.authority.currentSeq(),
    origin: input.origin,
    emit_event: input.emitEvent,
  });
  const finish = (): Promise<void> | undefined => {
    open = false;
    if (pending.length === 0) return undefined;
    return Promise.allSettled(pending).then((results) => {
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    });
  };

  try {
    const result = await input.handler(context, input.payload as never, input.message);
    const tracked = finish();
    if (tracked !== undefined) await tracked;
    if (result !== undefined && !is_locus_json_value(result)) {
      handlerSpan?.failure(() => ({ action: input.message.name, errorCode: "LOCUS_ACTION_OUTCOME_NORMALIZATION_FAILED" }));
      input.authority.traceStateBoundary(input.trace, input.parentSpanId, previousRev);
      return Object.freeze({
        state: "failed", seq: input.authority.currentSeq(), completionRev: input.authority.headRev(),
        error: Object.freeze({
          message: "Locus action result could not be normalized for transport.",
          code: "LOCUS_ACTION_OUTCOME_NORMALIZATION_FAILED",
        }),
      });
    }
    handlerSpan?.success(() => ({ action: input.message.name, resultPresent: result !== undefined }));
    input.authority.traceStateBoundary(input.trace, input.parentSpanId, previousRev);
    return Object.freeze({
      state: "succeeded", seq: input.authority.nextSeq(), completionRev: input.authority.headRev(),
      ...(result !== undefined ? { result } : {}),
    });
  } catch (caught) {
    let cause = caught;
    try {
      const tracked = finish();
      if (tracked !== undefined) await tracked;
    } catch (trackedCause) {
      cause = trackedCause;
    }
    const causeCode = safeErrorCode(cause, "LOCUS_ACTION_FAILED");
    handlerSpan?.failure(() => ({ action: input.message.name, errorCode: causeCode }));
    input.authority.traceStateBoundary(input.trace, input.parentSpanId, previousRev);
    return Object.freeze({
      state: "failed", seq: input.authority.currentSeq(), completionRev: input.authority.headRev(),
      error: Object.freeze({
        message: cause instanceof Error ? cause.message : "Locus action failed.",
        code: causeCode,
      }),
    });
  }
}

/** Authority-owned admission for one decoded solo external action attempt. */
export async function admit_locus_solo_external_action<
  TMap extends LiveMapAuthority,
  TActions extends LocusActionPayloads,
>(
  authority: LocusSoloExternalActionAuthority<TMap, TActions>,
  attempt: LocusSoloExternalActionAttempt<TActions, TMap>,
): Promise<LocusSoloActionAdmissionResult> {
  const { message, origin, trace, parentSpanId } = attempt;
  const stable = message.requestId !== undefined && message.clientId !== undefined;
  if (!stable && authority.disposed()) {
    return Object.freeze({
      kind: "rejected",
      response: rejectionResponse(message, authority.currentSeq(), authority.headRev(), "LOCUS_DISPOSED", "Locus is disposed.", false),
    });
  }

  const validated = resolve_locus_action_for_execution(authority, message, trace, parentSpanId);
  if (!validated.ok) {
    return Object.freeze({
      kind: "rejected",
      response: rejectionResponse(
        message, authority.currentSeq(), authority.headRev(),
        locus_action_public_error_code(validated.code), validated.message, stable,
      ),
    });
  }

  // Stable attempts include server-established attachment evidence. Legacy
  // attempts intentionally retain their existing context discrepancy.
  const authorization = authorizeAction(
    authority, message, validated.payload, origin, trace, parentSpanId,
    stable ? attempt.connection : undefined,
  );
  const authorized = authorization instanceof Promise ? await authorization : authorization;
  if (!authorized.ok) {
    return Object.freeze({
      kind: "rejected",
      response: rejectionResponse(
        message, authority.currentSeq(), authority.headRev(),
        authorized.code, authorized.message, stable,
      ),
    });
  }

  const causation = actionCausation(authority, message, origin, trace);
  const run = () => execute_locus_action_handler({
    authority,
    message,
    handler: validated.handler,
    payload: authorized.payload,
    origin,
    emitEvent: attempt.emitEvent ?? (() => false),
    ...(trace !== undefined ? { trace } : {}),
    ...(parentSpanId !== undefined ? { parentSpanId } : {}),
    ...(causation !== undefined ? { causation } : {}),
  });

  if (!stable) {
    return Object.freeze({
      kind: "legacy",
      response: make_locus_action_response(message.id, await run()),
    });
  }

  const result = await authority.actionRequests.execute({
    clientId: message.clientId,
    requestId: message.requestId,
    actionName: message.name,
    payload: authorized.payload,
    retry: message.retry === true,
    ...(trace !== undefined ? { sourceTraceId: trace.traceId } : {}),
    run,
  });
  if (!result.ok) {
    trace?.emit({
      subsystem: "locus", phase: "action.dedupe", status: "failure",
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      details: () => ({
        action: message.name, sourceAction: message.name, delivery: "rejected",
        ...(trace !== undefined ? { sourceTraceId: trace.traceId } : {}),
        ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
        ...(message.attemptId !== undefined ? { attemptId: message.attemptId } : {}),
        errorCode: result.code,
      }),
    });
    return Object.freeze({
      kind: "rejected",
      response: rejectionResponse(message, authority.currentSeq(), authority.headRev(), result.code, result.message, true),
    });
  }

  trace?.emit({
    subsystem: "locus", phase: "action.dedupe",
    status: result.delivery === "executed" ? "success" : "skip",
    ...(parentSpanId !== undefined ? { parentSpanId } : {}),
    details: () => ({
      action: message.name, sourceAction: message.name, delivery: result.delivery,
      ...(result.sourceTraceId !== undefined ? { sourceTraceId: result.sourceTraceId } : {}),
      ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
      ...(message.attemptId !== undefined ? { attemptId: message.attemptId } : {}),
    }),
  });
  return Object.freeze({
    kind: "deduped",
    response: make_locus_action_response(message.id, result.outcome, message.requestId, result.delivery, message.attemptId),
    delivery: result.delivery,
    ...(result.sourceTraceId === undefined ? {} : { sourceTraceId: result.sourceTraceId }),
  });
}
