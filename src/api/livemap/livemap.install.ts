import type { LiveMap, LiveMapSnapshot } from "../../types/livemap.types.js";
import { make_livemap_mirror_from_snapshot_internal } from "./livemap.libraries.js";

/** Install one detached complete aggregate snapshot into a fresh runtime domain. */
export function install_libraries_snapshot(snapshot: LiveMapSnapshot): Readonly<{ map: LiveMap }> {
  return Object.freeze({ map: make_livemap_mirror_from_snapshot_internal(snapshot) });
}
