import type { JsonValue } from "../../core/types.js";
import type { LiveMap, LiveMapAuthority, LiveMapLibraries } from "../../types/livemap.types.js";
import type {
  Echo,
  EchoOptions,
  LocusActionPayloads,
  MultiLibraryEcho,
  MultiLibraryEchoOptions,
} from "../../types/locus.types.js";
import { is_public_multi_library_livemap } from "../livemap/livemap.libraries.js";
import { create_multi_library_echo } from "./echo.multi-library.js";
import { create_solo_echo_internal } from "./echo.solo.js";

export function create_echo<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: MultiLibraryEchoOptions<TMap>): MultiLibraryEcho<TMap, TActions>;
export function create_echo<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: EchoOptions<LiveMap<TState>>): Echo<LiveMap<TState>, TActions>;
export function create_echo<
  TMap extends LiveMapAuthority,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: EchoOptions<TMap> & Readonly<{ map: TMap }>): Echo<TMap, TActions>;
export function create_echo(
  options: EchoOptions<LiveMapAuthority> | MultiLibraryEchoOptions<LiveMapLibraries>,
): unknown {
  if (options.map !== undefined && is_public_multi_library_livemap(options.map)) {
    return create_multi_library_echo(options as MultiLibraryEchoOptions<LiveMapLibraries>);
  }
  return create_solo_echo_internal(options as EchoOptions<LiveMapAuthority> & Readonly<{ map: LiveMapAuthority }>);
}
