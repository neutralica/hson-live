import type { LiveMapDocumentBindingSource } from "../../types/livemap.types.js";
import type { LocusDocumentLibrary, EchoProjectedDocumentLibrary, EchoLocalDocumentLibrary } from "../../types/governor.types.js";
import { selected_governed_document } from "../../internal/governed-document.js";
import {
  reflect_document,
  type DocumentMirror,
} from "./mirror.document.js";

// Governed reflection selects the registered canonical facade, not its locations.
type GovernedDocumentMap = LocusDocumentLibrary
  | Omit<EchoProjectedDocumentLibrary, "at">
  | Omit<EchoLocalDocumentLibrary, "at">;

/** Canonical LiveMap-authoritative Mirror facade. */
export interface Mirror {
  (map: LiveMapDocumentBindingSource): DocumentMirror;
  (map: GovernedDocumentMap): DocumentMirror;
}

const reflectDocument = (map: LiveMapDocumentBindingSource | GovernedDocumentMap): DocumentMirror => {
  const selected = selected_governed_document(map);
  if (selected !== undefined) return reflect_document(selected);
  if (!("document" in map)) throw new TypeError("Mirror requires a selected document Library.");
  return reflect_document(map as LiveMapDocumentBindingSource);
};

export const hsonMirror: Mirror = Object.freeze(reflectDocument);
