import type { HsonNode, JsonValue } from "../../core/types.js";
import type { ClassifiedLiveMap, LiveMap } from "../../types/livemap.types.js";
import { hsonTransform } from "../transform/transform.facade.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { make_classified_livemap } from "./livemap.core.js";
import { make_livemap_libraries } from "./livemap.libraries.js";
import type { LiveMapLibraries, LiveMapLibrariesInput } from "../../types/livemap.types.js";

export interface HsonLiveMapFacade {
  readonly fromJson: typeof fromJson;
  readonly fromHson: typeof fromHson;
  readonly fromNode: typeof fromNode;
  readonly fromLibraries: typeof fromLibraries;
}

function must_data_livemap(map: ClassifiedLiveMap): LiveMap {
  if (map.mode === "data-object" || map.mode === "data-array") return map;
  throw new Error(`LiveMap JSON construction produced unexpected root mode ${map.mode}.`);
}

function fromJson(input: string | JsonValue): LiveMap {
  return must_data_livemap(
    make_classified_livemap(hsonTransform.fromJson(input).toNode()),
  );
}

function fromHson(input: string): ClassifiedLiveMap {
  // LiveMap owns a document/data root carrier. Public Transform detaches its
  // Hson source result, so this subsystem consumes the parser-owned root
  // directly without changing LiveMap's established root contract.
  return make_classified_livemap(parse_hson(input, { allowTopLevelDocumentText: true }));
}

function fromNode(node: HsonNode): ClassifiedLiveMap {
  return make_classified_livemap(node);
}

/** Establish one fixed, named local Library registry. */
function fromLibraries<const TLibraries extends LiveMapLibrariesInput>(
  libraries: TLibraries,
): LiveMapLibraries<TLibraries> {
  return make_livemap_libraries(libraries);
}

/** Canonical DOM-free LiveMap construction facade. */
export const hsonLiveMap: HsonLiveMapFacade = Object.freeze({
  fromJson,
  fromHson,
  fromNode,
  fromLibraries,
});
