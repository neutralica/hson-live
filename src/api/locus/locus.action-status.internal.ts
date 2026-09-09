import type {
  LocusActionStatusResult,
} from "./locus.actions.js";
import type {
  LocusActionRequestId,
  LocusClientId,
  LocusConnectionContext,
} from "../../types/locus.types.js";

/**
 * Internal-only retained-status ingress owned by a concrete Locus runtime.
 * This module is not reachable from a supported package entrypoint.
 */
export type LocusRetainedActionStatusIngress = Readonly<{
  clientId: LocusClientId;
  requestId: LocusActionRequestId;
  connection?: Pick<LocusConnectionContext, "principalId">;
}>;

type BoundRetainedActionStatus = (
  ingress: LocusRetainedActionStatusIngress,
) => LocusActionStatusResult;

const retainedActionStatuses = new WeakMap<object, BoundRetainedActionStatus>();

export function register_locus_retained_action_status_internal(
  locus: object,
  status: BoundRetainedActionStatus,
): void {
  retainedActionStatuses.set(locus, status);
}

export function alias_locus_retained_action_status_internal(
  locus: object,
  authority: object,
): void {
  const status = retainedActionStatuses.get(authority);
  if (status === undefined) throw new Error("Locus retained action status authority is unavailable.");
  retainedActionStatuses.set(locus, status);
}

/** Observe one retained action request without creating a semantic session. */
export function read_locus_retained_action_status_internal(
  locus: object,
  ingress: LocusRetainedActionStatusIngress,
): LocusActionStatusResult {
  const status = retainedActionStatuses.get(locus);
  if (status === undefined) throw new Error("Locus retained action status authority is unavailable.");
  return status(ingress);
}
