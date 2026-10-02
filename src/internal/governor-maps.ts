import type { LiveMap } from "../types/livemap.types.js";
import type { Locus } from "../types/locus.core.types.js";

const locusMaps = new WeakMap<object, LiveMap>();
const echoMaps = new WeakMap<object, LiveMap>();

/** Internal composition access for persistence, projection, and package tests. */
export function register_locus_map_internal(locus: object, map: LiveMap): void { locusMaps.set(locus, map); }
export function register_echo_map_internal(echo: object, map: LiveMap): void { echoMaps.set(echo, map); }
export function locus_map_internal<TMap extends LiveMap>(locus: Locus<TMap>): TMap;
export function locus_map_internal(locus: object): LiveMap;
export function locus_map_internal(locus: object): LiveMap {
  const map = locusMaps.get(locus);
  if (map === undefined) throw new Error("Locus authority map is unavailable.");
  return map;
}
export function echo_map_internal(echo: object): LiveMap {
  const map = echoMaps.get(echo);
  if (map === undefined) throw new Error("Echo replica map is unavailable.");
  return map;
}
