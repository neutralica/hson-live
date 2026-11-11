import { type HsonDataValue } from "../data/hson-data.js";
import type {
  LocusActionAuthorizer,
  LocusActionAuthorizationContext,
  LocusActionOrigin,
  LocusActionPayloads,
  LocusConnectionContext,
} from "../../types/locus.types.js";
import { is_locus_document_action_name } from "./locus.document-actions.js";

export type LocusActionAuthorizationResult =
  | Readonly<{ ok: true }>
  | Readonly<{
    ok: false;
    code: "LOCUS_ACTION_FORBIDDEN" | "LOCUS_ACTION_AUTHORIZATION_FAILED";
    message: string;
  }>;

/** Shared policy boundary used after exact action validation by every Locus target form. */
export function authorize_locus_action<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(input: Readonly<{
  authorizer: LocusActionAuthorizer<TActions> | undefined;
  action: string;
  payload: HsonDataValue | undefined;
  origin: Extract<LocusActionOrigin, { kind: "session" }>;
  logicalMapId: string;
  incarnationId: string;
  connection?: LocusConnectionContext;
}>): LocusActionAuthorizationResult | Promise<LocusActionAuthorizationResult> {
  const finish = (decision: unknown): LocusActionAuthorizationResult => decision === true
    ? { ok: true }
    : {
      ok: false,
      code: "LOCUS_ACTION_FORBIDDEN",
      message: "Locus action is not authorized.",
    };
  // Built-in Document actions have already passed the session's write-grant
  // check. Custom remote actions need an affirmative application decision.
  if (input.authorizer === undefined) return finish(is_locus_document_action_name(input.action));
  const context: LocusActionAuthorizationContext<TActions> = Object.freeze({
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
  });

  const failed = (): LocusActionAuthorizationResult => ({
    ok: false,
    code: "LOCUS_ACTION_AUTHORIZATION_FAILED",
    message: "Locus action authorization failed.",
  });
  try {
    const decision = input.authorizer(context);
    // Assimilate cross-realm Promises before accepting only the boolean true.
    return typeof decision === "boolean" ? finish(decision) : Promise.resolve(decision).then(finish, failed);
  } catch {
    return failed();
  }
}
