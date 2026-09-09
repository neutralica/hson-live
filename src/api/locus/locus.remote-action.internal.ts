import type {
  LocusActionPayloads,
  LocusClientActionMessage,
  LocusClientActionResult,
  LocusConnectionContext,
} from "../../types/locus.types.js";

/**
 * Internal-only ingress owned by a concrete Locus runtime. This module is not
 * reachable from a supported package entrypoint.
 */
export type LocusRemoteActionIngress<TActions extends LocusActionPayloads = LocusActionPayloads> = Readonly<{
  message: LocusClientActionMessage<TActions>;
  connection?: LocusConnectionContext;
}>;

type BoundRemoteActionAdmission = (
  ingress: LocusRemoteActionIngress,
) => Promise<LocusClientActionResult>;

const remoteActionAdmissions = new WeakMap<object, BoundRemoteActionAdmission>();

export function register_locus_remote_action_admission_internal(
  locus: object,
  admission: BoundRemoteActionAdmission,
): void {
  remoteActionAdmissions.set(locus, admission);
}

export function alias_locus_remote_action_admission_internal(
  locus: object,
  authority: object,
): void {
  const admission = remoteActionAdmissions.get(authority);
  if (admission === undefined) throw new Error("Locus remote action authority is unavailable.");
  remoteActionAdmissions.set(locus, admission);
}

/** Admit one decoded remote action through a real operation-scoped session. */
export function admit_locus_remote_action_internal<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  locus: object,
  ingress: LocusRemoteActionIngress<TActions>,
): Promise<LocusClientActionResult> {
  const admission = remoteActionAdmissions.get(locus);
  if (admission === undefined) {
    return Promise.reject(new Error("Locus remote action authority is unavailable."));
  }
  return admission(ingress as LocusRemoteActionIngress);
}
