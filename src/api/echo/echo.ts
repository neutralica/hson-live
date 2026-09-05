import type { LiveMapAuthority, LiveMapLibraries } from "../../types/livemap.types.js";
import type {
  Echo,
  EchoOptions,
  EchoRecoveryOptions,
  LocusActionPayloads,
} from "../../types/locus.types.js";
import { is_public_multi_library_livemap } from "../livemap/livemap.libraries.js";
import { create_endpoint_echo_internal } from "./echo.client.js";
import { create_multi_library_echo } from "./echo.multi-library.js";
import { create_solo_echo_internal } from "./echo.solo.js";

export function create_echo<
  TMap extends undefined = undefined,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: EchoOptions<TMap>): Echo<TMap, TActions>;
export function create_echo<
  TMap extends LiveMapAuthority | LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: Omit<EchoOptions<undefined>, "map" | "recovery"> & Readonly<{
  map: TMap;
  recovery: EchoRecoveryOptions;
}>): Echo<TMap, TActions>;
export function create_echo(
  options: EchoOptions<undefined> | EchoOptions<LiveMapAuthority> | EchoOptions<LiveMapLibraries>,
): unknown {
  const map = options.map;
  const recovery = options.recovery;
  if ((map === undefined) !== (recovery === undefined)) {
    throw new Error("Echo replica construction requires map and recovery together.");
  }
  if (map === undefined) return create_endpoint_echo_internal(options as EchoOptions<undefined>);
  if (is_public_multi_library_livemap(map)) return create_multi_library_echo(options as EchoOptions<LiveMapLibraries>);
  return create_solo_echo_internal(options as EchoOptions<LiveMapAuthority>);
}
