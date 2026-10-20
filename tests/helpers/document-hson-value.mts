import { Hson, type HsonDocument } from "../../src/hson-authoring.ts";
import { read_livemap_document_logical_location } from "../../src/api/livemap/livemap.document.location.ts";

/** Structural assertions explicitly inspect the canonical Hson representation. */
export function document_hson_value(source: HsonDocument | undefined) {
  return source === undefined ? undefined
    : read_livemap_document_logical_location(Hson.document.toNode(source), "document", []);
}
