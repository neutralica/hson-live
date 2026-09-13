import type { HostedLiveMapLibrariesSnapshot, LiveMapLibraries } from "../../types/livemap.types.js";
import type { EchoRecoveryOptions } from "../../types/locus.types.js";
import { make_livemap_hosted_mirror_from_snapshot_internal } from "../livemap/livemap.libraries.js";

type LibrariesSnapshotAuthority = Readonly<{
  capture: () => HostedLiveMapLibrariesSnapshot;
}>;

const authorities = new WeakMap<object, LibrariesSnapshotAuthority>();

/** @internal Bind the exact hosted aggregate capture capability to its public Locus facade. */
export function register_locus_libraries_snapshot_authority_internal(
  locus: object,
  authority: LibrariesSnapshotAuthority,
): void {
  authorities.set(locus, authority);
}

/** @internal Preserve exact authority identity through public durable facade wrapping. */
export function alias_locus_libraries_snapshot_authority_internal(
  alias: object,
  source: object,
): void {
  const authority = authorities.get(source);
  if (authority !== undefined) authorities.set(alias, authority);
}

/** @internal Nominal runtime recognition for the public multi-library Locus authority. */
export function is_locus_libraries_snapshot_authority_internal(
  value: unknown,
): boolean {
  return typeof value === "object" && value !== null && authorities.has(value);
}

/** @internal Capture one hosted aggregate semantic cut through its bound authority. */
export function capture_locus_libraries_snapshot_internal(
  authority: object,
): HostedLiveMapLibrariesSnapshot {
  const capability = authorities.get(authority);
  if (capability === undefined) throw new TypeError("A hosted Libraries snapshot requires one LocusMultiLibrary authority.");
  return capability.capture();
}

/** Install one hosted aggregate cut and its existing Echo recovery cursor. */
export function install_locus_libraries_snapshot(
  snapshot: HostedLiveMapLibrariesSnapshot,
): Readonly<{ map: LiveMapLibraries; recovery: EchoRecoveryOptions }> {
  const map = make_livemap_hosted_mirror_from_snapshot_internal(snapshot);
  return Object.freeze({
    map,
    recovery: Object.freeze({
      logicalMapId: snapshot.authority.logicalMapId,
      cursor: Object.freeze({
        incarnationId: snapshot.authority.incarnationId,
        lastAppliedRev: snapshot.revision,
      }),
    }),
  });
}
