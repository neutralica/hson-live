import type { HsonNode, Primitive } from "../../core/types.js";
import { STR_TAG } from "../../core/constants.js";
import type {
  DocumentLiveMapAttrsApi,
  DocumentLiveMapFlagsApi,
  DocumentLiveMapMode,
  LiveMapDocumentContent,
  LiveMapDocumentRequestTarget,
  LiveMapDisposer,
  LiveMapGraphCommit,
  LiveMapGraphInsertContentOp,
  LiveMapGraphMoveContentOp,
  LiveMapGraphRemoveContentOp,
  LiveMapGraphReplaceContentOp,
} from "../../types/livemap.types.js";
import {
  InternalDocumentTraversalError,
  lower_internal_document_content_insert,
  lower_internal_document_content_remove,
  lower_internal_document_content_slot,
  lower_internal_document_content_target,
  lower_internal_document_element_target,
  resolve_internal_document_location,
  type InternalDocumentLogicalEdge,
} from "./livemap.document.logical.js";
import { find_internal_document_id } from "./livemap.document.id-discovery.js";
import { LiveMapDocumentMutationError, LiveMapSchemaError } from "./livemap.error.js";

type DocumentLocationOwner = Readonly<{
  readonly rev: number;
  root: () => HsonNode;
}>;

type DocumentLocationMutations = Readonly<{
  attrs: DocumentLiveMapAttrsApi;
  flags: DocumentLiveMapFlagsApi;
  replace: (
    target: LiveMapDocumentRequestTarget,
    index: number,
    replacement: LiveMapDocumentContent,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceContentOp>;
  remove: (
    target: LiveMapDocumentRequestTarget,
    index: number,
  ) => LiveMapGraphCommit<LiveMapGraphRemoveContentOp>;
  insert: (
    target: LiveMapDocumentRequestTarget,
    index: number,
    value: LiveMapDocumentContent,
  ) => LiveMapGraphCommit<LiveMapGraphInsertContentOp>;
  move: (
    target: LiveMapDocumentRequestTarget,
    from: number,
    to: number,
  ) => LiveMapGraphCommit<LiveMapGraphMoveContentOp>;
}>;

type DocumentLocationWatch = (
  path: readonly number[],
  listener: (next: HsonNode | Primitive | undefined) => void,
) => LiveMapDisposer;

type LocationAttrs = Readonly<{
  get: (name: string) => ReturnType<DocumentLiveMapAttrsApi["get"]>;
  has: (name: string) => boolean;
  keys: () => readonly string[];
  must: Readonly<{ get: (name: string) => ReturnType<DocumentLiveMapAttrsApi["must"]["get"]> }>;
  set: (name: string, value: Parameters<DocumentLiveMapAttrsApi["set"]>[2]) => ReturnType<DocumentLiveMapAttrsApi["set"]>;
  drop: (name: string) => ReturnType<DocumentLiveMapAttrsApi["drop"]>;
  setMany: (values: Parameters<DocumentLiveMapAttrsApi["setMany"]>[1]) => ReturnType<DocumentLiveMapAttrsApi["setMany"]>;
  dropMany: (names: readonly string[]) => ReturnType<DocumentLiveMapAttrsApi["dropMany"]>;
  clear: () => ReturnType<DocumentLiveMapAttrsApi["clear"]>;
  replace: (values: Parameters<DocumentLiveMapAttrsApi["replace"]>[1]) => ReturnType<DocumentLiveMapAttrsApi["replace"]>;
}>;

type LocationFlags = Readonly<{
  has: (name: string) => boolean;
  set: (...names: string[]) => ReturnType<DocumentLiveMapFlagsApi["set"]>;
  clear: (...names: string[]) => ReturnType<DocumentLiveMapFlagsApi["clear"]>;
}>;

type DocumentLocation = Readonly<{
  readonly rev: number;
  path: () => readonly number[];
  snap: () => HsonNode | Primitive | undefined;
  watch: (listener: (next: HsonNode | Primitive | undefined) => void) => LiveMapDisposer;
  at: (path: readonly number[]) => DocumentLocation;
  id: (value: string) => DocumentLocation | undefined;
  replace: (value: LiveMapDocumentContent) => LiveMapGraphCommit<LiveMapGraphReplaceContentOp>;
  delete: () => LiveMapGraphCommit<LiveMapGraphRemoveContentOp>;
  insert: (index: number, value: LiveMapDocumentContent) =>
    LiveMapGraphCommit<LiveMapGraphInsertContentOp>;
  move: (from: number, to: number) => LiveMapGraphCommit<LiveMapGraphMoveContentOp>;
  attrs: LocationAttrs;
  flags: LocationFlags;
}>;

const documentLocations = new WeakSet<object>();

/** Exact-object evidence for a document location created by LiveMap. @internal */
export function is_livemap_document_location(value: unknown): boolean {
  return typeof value === "object" && value !== null && documentLocations.has(value);
}

/** Build passive, fixed-coordinate locations over logical document content. */
export function make_livemap_document_location_factory(
  owner: DocumentLocationOwner,
  mode: DocumentLiveMapMode,
  mutations: DocumentLocationMutations,
  watch: DocumentLocationWatch,
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

    let location: DocumentLocation;
    const attrs = make_location_attrs(owner, mode, mutations, logicalPath);
    const flags = make_location_flags(owner, mode, mutations, logicalPath);
    location = Object.freeze({
      get rev() {
        return owner.rev;
      },
      path: () => Object.freeze([...logicalPath]),
      snap: () => read_livemap_document_logical_location(owner.root(), mode, logicalPath),
      watch: (listener) => watch(logicalPath, listener),
      at: (relativePath) => at([...logicalPath, ...must_document_logical_path(relativePath)]),
      id: (value) => find_internal_document_id(discoveryMap, location, must_document_id(value)),
      replace: (value) => replace_document_location(owner, mode, mutations, logicalPath, value),
      delete: () => delete_document_location(owner, mode, mutations, logicalPath),
      insert: (index, value) => insert_document_location(owner, mode, mutations, logicalPath, index, value),
      move: (from, to) => move_document_location(owner, mode, mutations, logicalPath, from, to),
      attrs,
      flags,
    });
    documentLocations.add(location);
    locations.set(key, location);
    return location;
  };

  discoveryMap = Object.freeze({ mode, root: owner.root, at });
  return at;
}

function make_location_flags(
  owner: DocumentLocationOwner,
  mode: DocumentLiveMapMode,
  mutations: DocumentLocationMutations,
  path: readonly number[],
): LocationFlags {
  const target = (): LiveMapDocumentRequestTarget => {
    const edges: InternalDocumentLogicalEdge[] = path.map((index) => ({ kind: "content", index }));
    try {
      return lower_internal_document_element_target(
        resolve_internal_document_location(owner.root(), mode, edges),
      );
    } catch (cause) {
      throw location_mutation_error("replace-attrs", path, cause);
    }
  };
  return Object.freeze({
    has: (name) => mutations.flags.has(target(), name),
    set: (...names) => mutations.flags.set(target(), ...names),
    clear: (...names) => mutations.flags.clear(target(), ...names),
  });
}

function resolve_document_content_owner(
  owner: DocumentLocationOwner,
  mode: DocumentLiveMapMode,
  path: readonly number[],
) {
  const edges: InternalDocumentLogicalEdge[] = path.map((index) => ({ kind: "content", index }));
  const root = owner.root();
  const endpoint = resolve_internal_document_location(root, mode, edges);
  return endpoint.kind === "content"
    ? endpoint
    : resolve_internal_document_location(root, mode, [...edges, { kind: "facet", facet: "content" }]);
}

function insert_document_location(
  owner: DocumentLocationOwner,
  mode: DocumentLiveMapMode,
  mutations: DocumentLocationMutations,
  path: readonly number[],
  index: number,
  value: LiveMapDocumentContent,
): LiveMapGraphCommit<LiveMapGraphInsertContentOp> {
  try {
    const lowering = lower_internal_document_content_insert(
      resolve_document_content_owner(owner, mode, path),
      index,
      value,
    );
    if (lowering.kind === "content-insert") {
      return mutations.insert(lowering.target, lowering.index, lowering.content);
    }
    if (lowering.kind === "replace-root") {
      return mutations.insert(Object.freeze({ kind: "path", path: Object.freeze([]) }), index, value);
    }
    throw location_mutation_error("insert-content", path);
  } catch (cause) {
    if (cause instanceof LiveMapDocumentMutationError || cause instanceof LiveMapSchemaError) throw cause;
    throw location_mutation_error("insert-content", path, cause);
  }
}

function move_document_location(
  owner: DocumentLocationOwner,
  mode: DocumentLiveMapMode,
  mutations: DocumentLocationMutations,
  path: readonly number[],
  from: number,
  to: number,
): LiveMapGraphCommit<LiveMapGraphMoveContentOp> {
  try {
    const target = lower_internal_document_content_target(
      resolve_document_content_owner(owner, mode, path),
    );
    return mutations.move(target, from, to);
  } catch (cause) {
    if (cause instanceof LiveMapDocumentMutationError || cause instanceof LiveMapSchemaError) throw cause;
    throw location_mutation_error("move-content", path, cause);
  }
}

function make_location_attrs(
  owner: DocumentLocationOwner,
  mode: DocumentLiveMapMode,
  mutations: DocumentLocationMutations,
  path: readonly number[],
): LocationAttrs {
  const target = (operation: LiveMapDocumentMutationError["operation"]): LiveMapDocumentRequestTarget => {
    const edges: InternalDocumentLogicalEdge[] = path.map((index) => ({ kind: "content", index }));
    try {
      return lower_internal_document_element_target(
        resolve_internal_document_location(owner.root(), mode, edges),
      );
    } catch (cause) {
      throw location_mutation_error(operation, path, cause);
    }
  };
  const must = Object.freeze({ get: (name: string) => mutations.attrs.must.get(target("must-get-attr"), name) });
  return Object.freeze({
    get: (name) => mutations.attrs.get(target("get-attr"), name),
    has: (name) => mutations.attrs.has(target("has-attr"), name),
    keys: () => mutations.attrs.keys(target("list-attrs")),
    must,
    set: (name, value) => mutations.attrs.set(target("set-attr"), name, value),
    drop: (name) => mutations.attrs.drop(target("remove-attr"), name),
    setMany: (values) => mutations.attrs.setMany(target("replace-attrs"), values),
    dropMany: (names) => mutations.attrs.dropMany(target("replace-attrs"), names),
    clear: () => mutations.attrs.clear(target("replace-attrs")),
    replace: (values) => mutations.attrs.replace(target("replace-attrs"), values),
  });
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
    if (cause instanceof LiveMapDocumentMutationError || cause instanceof LiveMapSchemaError) throw cause;
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
  operation: LiveMapDocumentMutationError["operation"],
  path: readonly number[],
  cause?: unknown,
): LiveMapDocumentMutationError {
  const renderedPath = JSON.stringify(path);
  const code = cause instanceof InternalDocumentTraversalError && cause.code === "INVALID_EDGE_INDEX"
    ? "INVALID_DOCUMENT_PATH_INDEX"
    : cause instanceof InternalDocumentTraversalError
        && (cause.code === "PHYSICAL_TARGET_UNAVAILABLE" || cause.code === "FACET_UNAVAILABLE")
      ? "DOCUMENT_TARGET_KIND"
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

export function read_livemap_document_logical_location(
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
