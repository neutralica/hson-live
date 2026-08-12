import type { HsonNode, Primitive } from "../../core/types.js";
import { STR_TAG } from "../../core/constants.js";
import type {
  DocumentLiveMapMode,
  LiveMapDocumentContent,
  LiveMapDocumentRequestTarget,
  LiveMapGraphCommit,
  LiveMapGraphRemoveContentOp,
  LiveMapGraphReplaceContentOp,
} from "../../types/livemap.types.js";
import {
  InternalDocumentTraversalError,
  lower_internal_document_content_remove,
  lower_internal_document_content_slot,
  resolve_internal_document_location,
  type InternalDocumentLogicalEdge,
} from "./livemap.document.logical.js";
import { find_internal_document_id } from "./livemap.document.id-discovery.js";
import { LiveMapDocumentMutationError } from "./livemap.error.js";

type DocumentLocationOwner = Readonly<{
  readonly rev: number;
  root: () => HsonNode;
}>;

type DocumentLocationMutations = Readonly<{
  replace: (
    target: LiveMapDocumentRequestTarget,
    index: number,
    replacement: LiveMapDocumentContent,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceContentOp>;
  remove: (
    target: LiveMapDocumentRequestTarget,
    index: number,
  ) => LiveMapGraphCommit<LiveMapGraphRemoveContentOp>;
}>;

type DocumentLocation = Readonly<{
  readonly rev: number;
  path: () => readonly number[];
  snap: () => HsonNode | Primitive | undefined;
  at: (path: readonly number[]) => DocumentLocation;
  id: (value: string) => DocumentLocation | undefined;
  replace: (value: LiveMapDocumentContent) => LiveMapGraphCommit<LiveMapGraphReplaceContentOp>;
  delete: () => LiveMapGraphCommit<LiveMapGraphRemoveContentOp>;
}>;

/** Build passive, fixed-coordinate locations over logical document content. */
export function make_livemap_document_location_factory(
  owner: DocumentLocationOwner,
  mode: DocumentLiveMapMode,
  mutations: DocumentLocationMutations,
): (path: readonly number[]) => DocumentLocation {
  const locations = new Map<string, DocumentLocation>();
  let discoveryMap: Readonly<{
    mode: DocumentLiveMapMode;
    root: () => HsonNode;
    at: (path: readonly number[]) => DocumentLocation;
  }>;

  const at = (path: readonly number[]): DocumentLocation => {
    const logicalPath = must_document_logical_path(path);
    const key = logicalPath.join("/");
    const existing = locations.get(key);
    if (existing !== undefined) return existing;

    const location: DocumentLocation = Object.freeze({
      get rev() {
        return owner.rev;
      },
      path: () => Object.freeze([...logicalPath]),
      snap: () => read_document_logical_location(owner.root(), mode, logicalPath),
      at: (relativePath) => at([...logicalPath, ...must_document_logical_path(relativePath)]),
      id: (value) => find_internal_document_id(discoveryMap, location, must_document_id(value)),
      replace: (value) => replace_document_location(owner, mode, mutations, logicalPath, value),
      delete: () => delete_document_location(owner, mode, mutations, logicalPath),
    });
    locations.set(key, location);
    return location;
  };

  discoveryMap = Object.freeze({ mode, root: owner.root, at });
  return at;
}

function replace_document_location(
  owner: DocumentLocationOwner,
  mode: DocumentLiveMapMode,
  mutations: DocumentLocationMutations,
  path: readonly number[],
  replacement: LiveMapDocumentContent,
): LiveMapGraphCommit<LiveMapGraphReplaceContentOp> {
  const resolution = resolve_mutable_document_location(owner.root(), mode, path, "replace-content");
  let slot: ReturnType<typeof lower_internal_document_content_slot>;
  try {
    slot = lower_internal_document_content_slot(resolution);
  } catch (cause) {
    throw location_mutation_error("replace-content", path, cause);
  }
  return mutations.replace(slot.target, slot.index, replacement);
}

function delete_document_location(
  owner: DocumentLocationOwner,
  mode: DocumentLiveMapMode,
  mutations: DocumentLocationMutations,
  path: readonly number[],
): LiveMapGraphCommit<LiveMapGraphRemoveContentOp> {
  require_non_root_document_location(path, "remove-content");
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  if (index === undefined) throw location_mutation_error("remove-content", path);

  const parentEdges: InternalDocumentLogicalEdge[] = parentPath.map((part) => ({
    kind: "content",
    index: part,
  }));
  const root = owner.root();
  try {
    const parent = resolve_internal_document_location(root, mode, parentEdges);
    const content = parent.kind === "content"
      ? parent
      : resolve_internal_document_location(root, mode, [
        ...parentEdges,
        { kind: "facet", facet: "content" },
    ]);
    const lowering = lower_internal_document_content_remove(content, index);
    if (lowering.kind === "replace-root") {
      return mutations.remove(Object.freeze({ kind: "path", path: Object.freeze([]) }), index);
    }
    if (lowering.kind !== "content-remove") throw location_mutation_error("remove-content", path);
    return mutations.remove(lowering.target, lowering.index);
  } catch (cause) {
    if (cause instanceof LiveMapDocumentMutationError) throw cause;
    throw location_mutation_error("remove-content", path, cause);
  }
}

function resolve_mutable_document_location(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  path: readonly number[],
  operation: "replace-content" | "remove-content",
) {
  require_non_root_document_location(path, operation);
  const edges: readonly InternalDocumentLogicalEdge[] = path.map((index) => ({ kind: "content", index }));
  try {
    return resolve_internal_document_location(root, mode, edges);
  } catch (cause) {
    throw location_mutation_error(operation, path, cause);
  }
}

function require_non_root_document_location(
  path: readonly number[],
  operation: "replace-content" | "remove-content",
): void {
  if (path.length !== 0) return;
  throw new LiveMapDocumentMutationError(
    "DOCUMENT_TARGET_KIND",
    operation,
    "the document root location is not a content item",
  );
}

function location_mutation_error(
  operation: "replace-content" | "remove-content",
  path: readonly number[],
  cause?: unknown,
): LiveMapDocumentMutationError {
  const renderedPath = JSON.stringify(path);
  const code = cause instanceof InternalDocumentTraversalError
    && cause.code === "INVALID_EDGE_INDEX"
    ? "INVALID_DOCUMENT_PATH_INDEX"
    : "INVALID_DOCUMENT_CONTENT_INDEX";
  return new LiveMapDocumentMutationError(
    code,
    operation,
    `logical content location ${renderedPath} is not currently occupied`,
    cause === undefined ? undefined : { cause },
  );
}

function must_document_id(value: unknown): string {
  if (typeof value === "string") return value;
  throw new TypeError("LiveMap document ID is not a string");
}

function must_document_logical_path(path: unknown): readonly number[] {
  if (!Array.isArray(path)) throw new Error("LiveMap document logical path is not an array");
  return Object.freeze(path.map((part, index) => {
    if (typeof part === "number" && Number.isSafeInteger(part) && part >= 0) return part;
    throw new Error(`LiveMap document logical path part is not valid at index ${index}`);
  }));
}

function read_document_logical_location(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  path: readonly number[],
): HsonNode | Primitive | undefined {
  const edges: readonly InternalDocumentLogicalEdge[] = path.map((index) => ({ kind: "content", index }));
  try {
    const resolution = resolve_internal_document_location(root, mode, edges);
    if (resolution.kind === "primitive") return resolution.value;
    if (resolution.kind === "node") {
      if (resolution.value.$_tag === STR_TAG && resolution.value.$_content.length === 1) {
        const payload = resolution.value.$_content[0];
        if (typeof payload !== "object" || payload === null) return payload;
      }
      return resolution.value;
    }
    if (resolution.kind === "content" && path.length === 0) return root;
    return undefined;
  } catch (error) {
    if (error instanceof InternalDocumentTraversalError
      && (error.code === "CONTENT_INDEX_OUT_OF_RANGE"
        || error.code === "PRIMITIVE_DESCENT"
        || error.code === "FACET_UNAVAILABLE")) {
      return undefined;
    }
    throw error;
  }
}
