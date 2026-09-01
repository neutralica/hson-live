import type { JsonValue } from "../../core/types.js";
import type {
  LocusActionAuthorizer,
  LocusActionAuthorizationContext,
  LocusActionOrigin,
  LocusActionPayloads,
  LocusConnectionContext,
} from "../../types/locus.types.js";

export type LocusActionAuthorizationResult =
  | Readonly<{ ok: true; payload: JsonValue | undefined }>
  | Readonly<{
    ok: false;
    code: "LOCUS_ACTION_FORBIDDEN" | "LOCUS_ACTION_AUTHORIZATION_FAILED";
    message: string;
    cause?: unknown;
  }>;

function clone_action_value(value: JsonValue, frozen: boolean): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const clone = value.map((item) => clone_action_value(item, frozen));
    if (frozen) Object.freeze(clone);
    return clone;
  }
  const clone: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) clone[key] = clone_action_value(value[key], frozen);
  return frozen ? Object.freeze(clone) : clone;
}

export function clone_locus_action_payload(
  value: JsonValue | undefined,
  frozen: boolean,
): JsonValue | undefined {
  return value === undefined ? undefined : clone_action_value(value, frozen);
}

/** Shared policy boundary used after exact action validation by every Locus target form. */
export function authorize_locus_action<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(input: Readonly<{
  authorizer: LocusActionAuthorizer<TActions> | undefined;
  action: string;
  payload: JsonValue | undefined;
  origin: Extract<LocusActionOrigin, { kind: "session" }>;
  logicalMapId: string;
  incarnationId: string;
  connection?: LocusConnectionContext;
}>): LocusActionAuthorizationResult | Promise<LocusActionAuthorizationResult> {
  if (input.authorizer === undefined) return { ok: true, payload: input.payload };
  const policyPayload = clone_locus_action_payload(input.payload, true);
  const handlerPayload = clone_locus_action_payload(input.payload, false);
  const context = Object.freeze({
    action: input.action,
    session: Object.freeze({
      sessionId: input.origin.sessionId,
      epoch: input.origin.epoch,
      resumable: input.origin.resumable,
    }),
    payload: policyPayload,
    logicalMapId: input.logicalMapId,
    incarnationId: input.incarnationId,
    ...(input.connection === undefined ? {} : { connection: input.connection }),
  }) as LocusActionAuthorizationContext<TActions>;

  const finish = (decision: boolean): LocusActionAuthorizationResult => decision
    ? { ok: true, payload: handlerPayload }
    : {
      ok: false,
      code: "LOCUS_ACTION_FORBIDDEN",
      message: "Locus action is not authorized.",
    };
  const failed = (cause: unknown): LocusActionAuthorizationResult => ({
    ok: false,
    code: "LOCUS_ACTION_AUTHORIZATION_FAILED",
    message: "Locus action authorization failed.",
    cause,
  });
  try {
    const decision = input.authorizer(context);
    return typeof decision === "boolean" ? finish(decision) : decision.then(finish, failed);
  } catch (cause) {
    return failed(cause);
  }
}
