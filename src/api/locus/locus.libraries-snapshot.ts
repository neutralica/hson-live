import type { HostedLiveMapSnapshot } from "../../types/livemap.types.js";

type LibrariesSnapshotAuthority = Readonly<{
  capture: () => HostedLiveMapSnapshot;
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

/** @internal Nominal runtime recognition for the public registry Locus authority. */
export function is_locus_libraries_snapshot_authority_internal(
  value: unknown,
): boolean {
  return typeof value === "object" && value !== null && authorities.has(value);
}

/** @internal Capture one hosted aggregate semantic cut through its bound authority. */
export function capture_locus_libraries_snapshot_internal(
  authority: object,
): HostedLiveMapSnapshot {
  const capability = authorities.get(authority);
  if (capability === undefined) throw new TypeError("A hosted Libraries snapshot requires one Locus authority.");
  return capability.capture();
}
