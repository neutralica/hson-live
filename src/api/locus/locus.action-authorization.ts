import type { HsonData } from "../data/hson-data.js";
import type {
  LocusActionAuthorizer,
  LocusActionAuthorizationContext,
  LocusActionOrigin,
  LocusActionPayloads,
  LocusConnectionContext,
} from "../../types/locus.types.js";

export type LocusActionAuthorizationResult =
  | Readonly<{ ok: true; payload: HsonData | undefined }>
  | Readonly<{
    ok: false;
    code: "LOCUS_ACTION_FORBIDDEN" | "LOCUS_ACTION_AUTHORIZATION_FAILED";
    message: string;
    cause?: unknown;
  }>;

/** Shared policy boundary used after exact action validation by every Locus target form. */
export function authorize_locus_action<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(input: Readonly<{
  authorizer: LocusActionAuthorizer<TActions> | undefined;
  action: string;
  payload: HsonData | undefined;
  origin: Extract<LocusActionOrigin, { kind: "session" }>;
  logicalMapId: string;
  incarnationId: string;
  connection?: LocusConnectionContext;
}>): LocusActionAuthorizationResult | Promise<LocusActionAuthorizationResult> {
  if (input.authorizer === undefined) return { ok: true, payload: input.payload };
  const context = Object.freeze({
    action: input.action,
    session: Object.freeze({
      sessionId: input.origin.sessionId,
      epoch: input.origin.epoch,
      resumable: input.origin.resumable,
    }),
    payload: input.payload,
    logicalMapId: input.logicalMapId,
    incarnationId: input.incarnationId,
    ...(input.connection === undefined ? {} : { connection: input.connection }),
  }) as LocusActionAuthorizationContext<TActions>;

  const finish = (decision: boolean): LocusActionAuthorizationResult => decision
    ? { ok: true, payload: input.payload }
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
