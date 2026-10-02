import type { JsonValue } from "../../core/types.js";
import type { LiveMapDocumentLibrary } from "../../types/livemap.types.js";
import type { GovernorDocumentLibrary, EchoProjectedDocumentLibrary, EchoLocalDocumentLibrary } from "../../types/governor.types.js";
import { selected_governed_document } from "../../internal/governed-document.js";
import type {
  CollectionMirror,
  CollectionMirrorOptions,
} from "../../types/mirror.types.js";
import {
  reflect_collection,
} from "./mirror.collection.js";
import {
  reflect_document,
  type DocumentMirror,
} from "./mirror.document.js";

/** Canonical LiveMap-authoritative Mirror facade. */
export interface Mirror {
  (map: LiveMapDocumentLibrary): DocumentMirror;
  (map: GovernorDocumentLibrary | EchoProjectedDocumentLibrary | EchoLocalDocumentLibrary): DocumentMirror;
  collection: <TItem extends JsonValue>(
    options: CollectionMirrorOptions<TItem>,
  ) => CollectionMirror<TItem>;
}

const reflectDocument = (map: LiveMapDocumentLibrary | GovernorDocumentLibrary | EchoProjectedDocumentLibrary | EchoLocalDocumentLibrary): DocumentMirror => {
  const selected = selected_governed_document(map);
  if (selected !== undefined) return reflect_document(selected);
  if (!("document" in map)) throw new TypeError("Mirror requires a selected document Library.");
  return reflect_document(map as LiveMapDocumentLibrary);
};

export const hsonMirror: Mirror = Object.freeze(Object.assign(
  reflectDocument,
  { collection: reflect_collection },
));
