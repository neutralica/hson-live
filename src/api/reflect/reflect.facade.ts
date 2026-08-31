import type { JsonValue } from "../../core/types.js";
import type { DocumentLiveMap, LiveMapDocumentLibrary } from "../../types/livemap.types.js";
import type {
  CollectionReflect,
  CollectionReflectOptions,
} from "../../types/reflect.types.js";
import {
  reflect_collection,
} from "./reflect.collection.js";
import {
  reflect_document,
  type DocumentReflect,
} from "./reflect.document.js";

/** Canonical LiveMap-authoritative reflector facade. */
export interface Reflect {
  (map: DocumentLiveMap | LiveMapDocumentLibrary): DocumentReflect;
  collection: <TItem extends JsonValue>(
    options: CollectionReflectOptions<TItem>,
  ) => CollectionReflect<TItem>;
}

const reflectDocument = (map: DocumentLiveMap | LiveMapDocumentLibrary): DocumentReflect =>
  reflect_document(map);

export const hsonReflect: Reflect = Object.freeze(Object.assign(
  reflectDocument,
  { collection: reflect_collection },
));
