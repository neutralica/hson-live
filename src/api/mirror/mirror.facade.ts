import type { JsonValue } from "../../core/types.js";
import type { DocumentLiveMap, LiveMapDocumentLibrary } from "../../types/livemap.types.js";
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
  (map: DocumentLiveMap | LiveMapDocumentLibrary): DocumentMirror;
  collection: <TItem extends JsonValue>(
    options: CollectionMirrorOptions<TItem>,
  ) => CollectionMirror<TItem>;
}

const reflectDocument = (map: DocumentLiveMap | LiveMapDocumentLibrary): DocumentMirror =>
  reflect_document(map);

export const hsonMirror: Mirror = Object.freeze(Object.assign(
  reflectDocument,
  { collection: reflect_collection },
));
