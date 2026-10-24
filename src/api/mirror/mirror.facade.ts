import type { LiveMapDocumentLibrary } from "../../types/livemap.types.js";
import type { LocusDocumentLibrary, EchoProjectedDocumentLibrary, EchoLocalDocumentLibrary } from "../../types/governor.types.js";
import { selected_governed_document } from "../../internal/governed-document.js";
import {
  reflect_document,
  type DocumentMirror,
} from "./mirror.document.js";

/** Canonical LiveMap-authoritative Mirror facade. */
export interface Mirror {
  (map: LiveMapDocumentLibrary): DocumentMirror;
  (map: LocusDocumentLibrary | EchoProjectedDocumentLibrary | EchoLocalDocumentLibrary): DocumentMirror;
}

const reflectDocument = (map: LiveMapDocumentLibrary | LocusDocumentLibrary | EchoProjectedDocumentLibrary | EchoLocalDocumentLibrary): DocumentMirror => {
  const selected = selected_governed_document(map);
  if (selected !== undefined) return reflect_document(selected);
  if (!("document" in map)) throw new TypeError("Mirror requires a selected document Library.");
  return reflect_document(map as LiveMapDocumentLibrary);
};

export const hsonMirror: Mirror = Object.freeze(reflectDocument);
