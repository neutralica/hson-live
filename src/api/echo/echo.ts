import type { LiveMap } from "../../types/livemap.types.js";
import type {
  Echo,
  EchoOptions,
  EchoRecoveryOptions,
  LocusActionPayloads,
} from "../../types/locus.types.js";
import { acquire_echo_map_management_internal } from "../../internal/echo-map-capability.js";
import { create_endpoint_echo_internal } from "./echo.client.js";
import {
  create_lazy_replica_echo_internal,
  DEFAULT_ECHO_REPLICA_LOADERS,
  type EchoReplicaLoaders,
} from "./echo.lazy.js";

export function create_echo<
  TMap extends undefined = undefined,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: EchoOptions<TMap>): Echo<TMap, TActions>;
export function create_echo<
  TMap extends LiveMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: Omit<EchoOptions<undefined>, "map" | "recovery"> & Readonly<{
  map: TMap;
  recovery: EchoRecoveryOptions;
}>): Echo<TMap, TActions>;
export function create_echo(
  options: EchoOptions<undefined> | EchoOptions<LiveMap>,
): unknown {
  const map = options.map;
  const recovery = options.recovery;
  if ((map === undefined) !== (recovery === undefined)) {
    throw new Error("Echo replica construction requires map and recovery together.");
  }
  if (map === undefined) return create_endpoint_echo_internal(options as EchoOptions<undefined>);
  if (recovery === undefined) throw new Error("Echo replica construction requires map and recovery together.");
  const management = acquire_echo_map_management_internal(map);
  try {
    const replicaOptions: Omit<EchoOptions<undefined>, "map" | "recovery"> & Readonly<{
      map: LiveMap;
      recovery: EchoRecoveryOptions;
    }> = { ...options, map, recovery };
    return create_lazy_replica_echo_internal<LiveMap>(
      replicaOptions,
      management,
      DEFAULT_ECHO_REPLICA_LOADERS,
    );
  } catch (cause) {
    management.release();
    throw cause;
  }
}

/** @internal Test seam for deterministic deferred-loader lifecycle proofs. */
export function create_echo_with_replica_loaders_internal(
  options: EchoOptions<undefined>,
  loaders: EchoReplicaLoaders,
): Echo<undefined>;
/** @internal Test seam for deterministic deferred-loader lifecycle proofs. */
export function create_echo_with_replica_loaders_internal(
  options: EchoOptions<LiveMap>,
  loaders: EchoReplicaLoaders,
): Echo<LiveMap>;
/** @internal Test seam for deterministic deferred-loader lifecycle proofs. */
export function create_echo_with_replica_loaders_internal(
  options: EchoOptions<undefined> | EchoOptions<LiveMap>,
  loaders: EchoReplicaLoaders,
): Echo<undefined> | Echo<LiveMap> {
  const map = options.map;
  const recovery = options.recovery;
  if ((map === undefined) !== (recovery === undefined)) {
    throw new Error("Echo replica construction requires map and recovery together.");
  }
  if (map === undefined) return create_endpoint_echo_internal(options as EchoOptions<undefined>);
  if (recovery === undefined) throw new Error("Echo replica construction requires map and recovery together.");
  const management = acquire_echo_map_management_internal(map);
  try {
    const replicaOptions: Omit<EchoOptions<undefined>, "map" | "recovery"> & Readonly<{
      map: LiveMap;
      recovery: EchoRecoveryOptions;
    }> = { ...options, map, recovery };
    return create_lazy_replica_echo_internal<LiveMap>(
      replicaOptions,
      management,
      loaders,
    );
  } catch (cause) {
    management.release();
    throw cause;
  }
}
