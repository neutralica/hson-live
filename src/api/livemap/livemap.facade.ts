import type { HsonNode, JsonValue } from "../../core/types.js";
import type { ClassifiedLiveMap, DocumentLiveMap, LiveMap } from "../../types/livemap.types.js";
import type { HsonData, HsonDocument } from "../transform/transform.types.js";
import { ExactDataCarrier, hson_data_value } from "../data/hson-data.js";
import { ExactDocumentCarrier, hson_document_root } from "../document/hson-document.js";
import { projected_value_to_hson_root } from "../../core/projected-value-graph.js";
import { hsonTransform } from "../transform/transform.facade.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { make_classified_livemap } from "./livemap.core.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";
import { make_livemap_libraries } from "./livemap.libraries.js";
import type { LiveMapLibraries, LiveMapLibrariesInput } from "../../types/livemap.types.js";

export interface HsonLiveMapFacade {
  readonly fromJson: typeof fromJson;
  readonly fromHson: typeof fromHson;
  readonly fromData: typeof fromData;
  readonly fromDocument: typeof fromDocument;
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

function fromData(input: HsonData): LiveMap {
  if (typeof input !== "string") throw new TypeError("LiveMap.fromData requires Hson data text.");
  const value = hson_data_value(ExactDataCarrier.fromHson(input));
  return must_data_livemap(make_classified_livemap(projected_value_to_hson_root(value)));
}

function fromDocument(input: HsonDocument): DocumentLiveMap {
  if (typeof input !== "string") throw new TypeError("LiveMap.fromDocument requires Hson document text.");
  const document = ExactDocumentCarrier.fromHson(input);
  if (document.toHson() !== input) throw new TypeError("LiveMap.fromDocument requires canonical Hson document text.");
  const root = hson_document_root(document);
  const map = make_classified_livemap(root);
  if (map.mode !== "document") throw new TypeError("LiveMap.fromDocument requires document content.");
  return map;
}

function fromNode(node: HsonNode): ClassifiedLiveMap {
  admit_portable_hson_node(node, "LiveMap.fromNode");
  return make_classified_livemap(node);
}

/** Establish one fixed, named local Library registry. */
function fromLibraries<const TLibraries extends LiveMapLibrariesInput>(
  libraries: TLibraries,
): LiveMapLibraries<TLibraries> {
  for (const [name, input] of Object.entries(libraries)) {
    if ("document" in input && input.document !== undefined && typeof input.document !== "string") {
      admit_portable_hson_node(input.document, `LiveMap.fromLibraries(${name})`);
    }
  }
  return make_livemap_libraries(libraries);
}

/** Canonical DOM-free LiveMap construction facade. */
export const hsonLiveMap: HsonLiveMapFacade = Object.freeze({
  fromJson,
  fromHson,
  fromData,
  fromDocument,
  fromNode,
  fromLibraries,
});
