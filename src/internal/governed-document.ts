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

function content(document: Pick<LiveMapDocumentLibrary, "root" | "mode">, path: readonly number[]) {
  const root = document.root();
  const pathEdges = edges(path);
  const endpoint = resolve_internal_document_location(root, document.mode, pathEdges);
  return endpoint.kind === "content" ? endpoint : resolve_internal_document_location(root, document.mode,
    [...pathEdges, { kind: "facet", facet: "content" }]);
}

/** Lower selected logical locations into the canonical hosted action vocabulary. */
export function governed_document_element_target(document: Pick<LiveMapDocumentLibrary, "root" | "mode">, path: readonly number[]) {
  return target(lower_internal_document_element_target(
    resolve_internal_document_location(document.root(), document.mode, edges(path))));
}

export function governed_document_slot(document: Pick<LiveMapDocumentLibrary, "root" | "mode">, path: readonly number[]) {
  if (path.length === 0) throw new Error("Document root is not a replaceable content slot.");
  const slot = lower_internal_document_content_slot(resolve_internal_document_location(document.root(), document.mode, edges(path)));
  return Object.freeze({ target: target(slot.target), index: slot.index });
}

export function governed_document_remove_slot(document: Pick<LiveMapDocumentLibrary, "root" | "mode">, path: readonly number[]) {
  if (path.length === 0) throw new Error("Document root is not a removable content slot.");
  const index = path[path.length - 1];
  if (index === undefined) throw new Error("Document content index is unavailable.");
  const lowering = lower_internal_document_content_remove(content(document, path.slice(0, -1)), index);
  if (lowering.kind === "content-remove") return Object.freeze({ target: target(lowering.target), index: lowering.index });
  if (lowering.kind === "replace-root") return Object.freeze({ target: target({ kind: "path", path: [] }), index });
  throw new Error("Document content location is not removable.");
}

export function governed_document_insert_slot(document: Pick<LiveMapDocumentLibrary, "root" | "mode">, path: readonly number[],
  index: number, value: LiveMapDocumentContent) {
  const lowering = lower_internal_document_content_insert(content(document, path), index, value);
  if (lowering.kind === "content-insert") return Object.freeze({ target: target(lowering.target), index: lowering.index,
    content: lowering.content });
  if (lowering.kind === "replace-root") return Object.freeze({ target: target({ kind: "path", path: [] }), index,
    content: value });
  throw new Error("Document content location is not insertable.");
}

export function governed_document_move_target(document: Pick<LiveMapDocumentLibrary, "root" | "mode">, path: readonly number[]) {
  return target(lower_internal_document_content_target(content(document, path)));
}

/** Preserve the existing QUAD lifetime while exposing only observation authority. */
export function read_document_quad(
  raw: import("../types/livemap.types.js").LiveMapDocumentQuadLocation,
): import("../types/livemap.types.js").AuthorityDocumentQuadLocation<never> {
  return Object.freeze({
    get active() { return raw.active; }, get rev() { return raw.rev; },
    path: () => raw.path(), snap: () => raw.snap(), dispose: () => raw.dispose(),
    at: (path: readonly number[]) => read_document_quad(raw.at(path)),
    attrs: Object.freeze({ get: raw.attrs.get, has: raw.attrs.has, keys: raw.attrs.keys, must: raw.attrs.must }),
    flags: Object.freeze({ has: raw.flags.has }),
  });
}

/** Resolve identity inside the ordinary authority submission, never into a durable address. */
export function write_document_quad(
  raw: import("../types/livemap.types.js").LiveMapDocumentQuadLocation,
  edit: (subject: import("../types/livemap.types.js").LiveMapDocumentQuadLocation,
    run: (location: import("../api/livemap/livemap.staged.js").StagedDocumentLocation) => void) => Promise<void>,
): import("../types/livemap.types.js").AuthorityDocumentQuadLocation {
  const read = read_document_quad(raw);
  return Object.freeze({
    ...read, get active() { return raw.active; }, get rev() { return raw.rev; },
    at: (path: readonly number[]) => write_document_quad(raw.at(path), edit),
    replace: value => edit(raw, location => location.replace(value)),
    delete: () => edit(raw, location => location.delete()),
    insert: (index, value) => edit(raw, location => location.insert(index, value)),
    move: (from, to) => edit(raw, location => location.move(from, to)),
    attrs: Object.freeze({ ...read.attrs,
      set: (name: string, value: import("../types/livemap.types.js").LiveMapDocumentAttributeValue) => edit(raw, location => location.attrs.set(name, value)),
      drop: (name: string) => edit(raw, location => location.attrs.drop(name)),
      setMany: (values: import("../types/livemap.types.js").LiveMapDocumentAttrs) => edit(raw, location => location.attrs.setMany(values)),
      dropMany: (names: readonly string[]) => edit(raw, location => location.attrs.dropMany(names)),
      clear: () => edit(raw, location => location.attrs.clear()),
      replace: (values: import("../types/livemap.types.js").LiveMapDocumentAttrs) => edit(raw, location => location.attrs.replace(values)),
    }),
    flags: Object.freeze({ ...read.flags,
      set: (...names: string[]) => edit(raw, location => location.flags.set(...names)),
      clear: (...names: string[]) => edit(raw, location => location.flags.clear(...names)),
    }),
  });
}
