import type { LiveMapDocumentLibrary, LiveMapDocumentContent, LiveMapDocumentRequestTarget,
  LiveMapDocumentCommitTarget } from "../types/livemap.types.js";
import { validate_document_path } from "../api/livemap/livemap.document.path.js";
import {
  lower_internal_document_content_insert,
  lower_internal_document_content_remove,
  lower_internal_document_content_slot,
  lower_internal_document_content_target,
  lower_internal_document_element_target,
  resolve_internal_document_location,
  type InternalDocumentLogicalEdge,
} from "../api/livemap/livemap.document.logical.js";

const selectedDocuments = new WeakMap<object, LiveMapDocumentLibrary>();

/** Keep governor document handles usable by Mirror without exposing their map. */
export function register_governed_document(handle: object, selected: LiveMapDocumentLibrary): void {
  selectedDocuments.set(handle, selected);
}

export function selected_governed_document(value: object): LiveMapDocumentLibrary | undefined {
  return selectedDocuments.get(value);
}

function edges(path: readonly number[]): InternalDocumentLogicalEdge[] {
  return path.map((index) => ({ kind: "content", index }));
}

function target(request: LiveMapDocumentRequestTarget): LiveMapDocumentCommitTarget {
  return Object.freeze({ kind: "path" as const, path: validate_document_path(request.path) });
}

function content(document: LiveMapDocumentLibrary, path: readonly number[]) {
  const root = document.root();
  const pathEdges = edges(path);
  const endpoint = resolve_internal_document_location(root, document.mode, pathEdges);
  return endpoint.kind === "content" ? endpoint : resolve_internal_document_location(root, document.mode,
    [...pathEdges, { kind: "facet", facet: "content" }]);
}

/** Lower selected logical locations into the canonical hosted action vocabulary. */
export function governed_document_element_target(document: LiveMapDocumentLibrary, path: readonly number[]) {
  return target(lower_internal_document_element_target(
    resolve_internal_document_location(document.root(), document.mode, edges(path))));
}

export function governed_document_slot(document: LiveMapDocumentLibrary, path: readonly number[]) {
  if (path.length === 0) throw new Error("Document root is not a replaceable content slot.");
  const slot = lower_internal_document_content_slot(resolve_internal_document_location(document.root(), document.mode, edges(path)));
  return Object.freeze({ target: target(slot.target), index: slot.index });
}

export function governed_document_remove_slot(document: LiveMapDocumentLibrary, path: readonly number[]) {
  if (path.length === 0) throw new Error("Document root is not a removable content slot.");
  const index = path[path.length - 1];
  if (index === undefined) throw new Error("Document content index is unavailable.");
  const lowering = lower_internal_document_content_remove(content(document, path.slice(0, -1)), index);
  if (lowering.kind === "content-remove") return Object.freeze({ target: target(lowering.target), index: lowering.index });
  if (lowering.kind === "replace-root") return Object.freeze({ target: target({ kind: "path", path: [] }), index });
  throw new Error("Document content location is not removable.");
}

export function governed_document_insert_slot(document: LiveMapDocumentLibrary, path: readonly number[],
  index: number, value: LiveMapDocumentContent) {
  const lowering = lower_internal_document_content_insert(content(document, path), index, value);
  if (lowering.kind === "content-insert") return Object.freeze({ target: target(lowering.target), index: lowering.index,
    content: lowering.content });
  if (lowering.kind === "replace-root") return Object.freeze({ target: target({ kind: "path", path: [] }), index,
    content: value });
  throw new Error("Document content location is not insertable.");
}

export function governed_document_move_target(document: LiveMapDocumentLibrary, path: readonly number[]) {
  return target(lower_internal_document_content_target(content(document, path)));
}
