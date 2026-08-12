import { ELEM_TAG, ROOT_TAG } from "../../core/constants.js";
import { clone_node } from "../../core/clone-node.js";
import { classify_ordinary_hson_structure } from "../../core/hson-structural-mode.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { decode_public_attrs } from "../../core/public-attrs.js";
import type {
  CanonicalPublicAttrs,
  HsonMeta,
  HsonNode,
  Primitive,
} from "../../core/types.js";
import type {
  DocumentLiveMapMode,
  LiveMapDocumentContent,
  LiveMapDocumentPath,
  LiveMapDocumentRequestTarget,
} from "../../types/livemap.types.js";
import { classify_live_root_mode } from "./livemap.document.js";
import { make_internal_document_content_carrier } from "./livemap.document.mutation.js";
import {
  append_document_path,
  parent_document_path,
  resolve_document_path,
  validate_document_path,
} from "./livemap.document.path.js";

/** Internal-only logical document edge. This module is not a package entrypoint. */
export type InternalDocumentLogicalEdge =
  | Readonly<{ kind: "content"; index: number }>
  | Readonly<{ kind: "raw-content"; index: number }>
  | Readonly<{ kind: "facet"; facet: InternalDocumentFacet }>;

export type InternalDocumentFacet = "tag" | "attrs" | "metadata" | "content";

export type InternalDocumentPhysicalAssociation =
  | Readonly<{
    kind: "direct";
    path: LiveMapDocumentPath;
  }>
  | Readonly<{
    kind: "carrier";
    path: LiveMapDocumentPath;
    carrierPaths: readonly LiveMapDocumentPath[];
  }>
  | Readonly<{
    kind: "facet";
    facet: Exclude<InternalDocumentFacet, "content">;
    ownerPath: LiveMapDocumentPath;
  }>
  | Readonly<{
    kind: "none";
    reason: "empty-fragment" | "empty-element-content";
    ownerPath?: LiveMapDocumentPath;
  }>;

export type InternalDocumentLogicalResolution =
  | Readonly<{
    kind: "node";
    value: HsonNode;
    physical: InternalDocumentPhysicalAssociation;
  }>
  | Readonly<{
    kind: "primitive";
    value: Primitive;
    physical: InternalDocumentPhysicalAssociation;
  }>
  | Readonly<{
    kind: "content";
    scope: "fragment" | "element";
    length: number;
    physical: InternalDocumentPhysicalAssociation;
  }>
  | Readonly<{
    kind: "facet";
    facet: "tag";
    value: string;
    access: "readonly";
    physical: InternalDocumentPhysicalAssociation;
  }>
  | Readonly<{
    kind: "facet";
    facet: "attrs";
    value: CanonicalPublicAttrs;
    access: "operation-specific";
    physical: InternalDocumentPhysicalAssociation;
  }>
  | Readonly<{
    kind: "facet";
    facet: "metadata";
    value: Readonly<HsonMeta>;
    access: "protected";
    physical: InternalDocumentPhysicalAssociation;
  }>;

export type InternalDocumentContentMutationLowering =
  | Readonly<{
    kind: "content-insert";
    target: LiveMapDocumentRequestTarget;
    index: number;
    content: LiveMapDocumentContent;
  }>
  | Readonly<{
    kind: "content-remove";
    target: LiveMapDocumentRequestTarget;
    index: number;
  }>
  | Readonly<{
    kind: "replace-root";
    root: HsonNode;
  }>;

export type InternalDocumentTraversalFailureCode =
  | "INVALID_DOCUMENT_ROOT"
  | "INVALID_EDGE_INDEX"
  | "CONTENT_INDEX_OUT_OF_RANGE"
  | "PRIMITIVE_DESCENT"
  | "FACET_UNAVAILABLE"
  | "FACET_DESCENT"
  | "PHYSICAL_TARGET_UNAVAILABLE";

/** Structured internal failure; deliberately absent from every public entrypoint. */
export class InternalDocumentTraversalError extends Error {
  readonly code: InternalDocumentTraversalFailureCode;
  readonly edgeIndex: number | undefined;

  constructor(
    code: InternalDocumentTraversalFailureCode,
    reason: string,
    edgeIndex?: number,
    options?: ErrorOptions,
  ) {
    super(`Internal logical document traversal failed: ${reason}`, options);
    this.name = "InternalDocumentTraversalError";
    this.code = code;
    this.edgeIndex = edgeIndex;
  }
}

type NodeCursor = Readonly<{
  kind: "node";
  node: HsonNode;
  path: LiveMapDocumentPath;
  carrierPaths: readonly LiveMapDocumentPath[];
}>;

type PrimitiveCursor = Readonly<{
  kind: "primitive";
  value: Primitive;
  path: LiveMapDocumentPath;
  carrierPaths: readonly LiveMapDocumentPath[];
}>;

type ContentCursor = Readonly<{
  kind: "content";
  scope: "fragment" | "element";
  ownerPath?: LiveMapDocumentPath;
  logicalOwnerPath?: LiveMapDocumentPath;
  node?: HsonNode;
  carrierPaths: readonly LiveMapDocumentPath[];
  emptyReason?: "empty-fragment" | "empty-element-content";
}>;

type FacetCursor = Extract<InternalDocumentLogicalResolution, Readonly<{ kind: "facet" }>>;
type TraversalCursor = NodeCursor | PrimitiveCursor | ContentCursor | FacetCursor;

/**
 * Resolve logical document edges against one current canonical root.
 *
 * Logical content edges hide the ordinary element's `_hson_elem` carrier.
 * Raw content edges remain available only for internal structural leaves such
 * as the payload of `_hson_str`. Returned node/facet values are detached reads;
 * the physical association remains the sole mutation/location authority.
 */
export function resolve_internal_document_location(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  edges: readonly InternalDocumentLogicalEdge[],
): InternalDocumentLogicalResolution {
  return materialize_resolution(resolve_internal_document_cursor(root, mode, edges));
}

function resolve_internal_document_cursor(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  edges: readonly InternalDocumentLogicalEdge[],
): TraversalCursor {
  let cursor = document_root_cursor(root, mode);

  for (const [edgeIndex, edge] of edges.entries()) {
    if (cursor.kind === "primitive") {
      throw traversal_error("PRIMITIVE_DESCENT", "an edge descends through a primitive endpoint", edgeIndex);
    }
    if (cursor.kind === "facet") {
      throw traversal_error("FACET_DESCENT", "non-content facets are terminal values", edgeIndex);
    }

    if (edge.kind === "facet") {
      cursor = resolve_facet(cursor, edge.facet, edgeIndex);
      continue;
    }

    const index = validated_edge_index(edge.index, edgeIndex);
    if (edge.kind === "content") {
      const content = cursor.kind === "content"
        ? cursor
        : logical_element_content_cursor(cursor, edgeIndex);
      cursor = content_child_cursor(content, index, edgeIndex);
      continue;
    }

    cursor = raw_content_child_cursor(cursor, index, edgeIndex);
  }

  return cursor;
}

/** Internal one-shot canonical preorder search specialized to exact string IDs. */
export function find_internal_document_id_path(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  scopeEdges: readonly InternalDocumentLogicalEdge[],
  scopePath: readonly number[],
  id: string,
): readonly number[] | undefined {
  const scope = resolve_internal_document_cursor(root, mode, scopeEdges);

  const visit = (
    cursor: TraversalCursor,
    logicalPath: readonly number[],
  ): readonly number[] | undefined => {
    if (cursor.kind === "node" && is_ordinary_element_node(cursor.node)) {
      const attrs = decode_public_attrs(cursor.node.$_attrs ?? {});
      if (attrs?.id === id) return Object.freeze([...logicalPath]);

      const content = logical_element_content_cursor(cursor, scopeEdges.length);
      return visit_content(content, logicalPath);
    }
    if (cursor.kind === "content") return visit_content(cursor, logicalPath);
    return undefined;
  };

  const visit_content = (
    cursor: ContentCursor,
    logicalPath: readonly number[],
  ): readonly number[] | undefined => {
    const length = cursor.node?.$_content.length ?? 0;
    for (let index = 0; index < length; index += 1) {
      const child = content_child_cursor(cursor, index, scopeEdges.length);
      const found = visit(child, Object.freeze([...logicalPath, index]));
      if (found !== undefined) return found;
    }
    return undefined;
  };

  return visit(scope, scopePath);
}

/** Lower a resolved logical content container to the existing mutation target. */
export function lower_internal_document_content_target(
  resolution: InternalDocumentLogicalResolution,
): LiveMapDocumentRequestTarget {
  if (resolution.kind !== "content"
    || (resolution.physical.kind !== "direct" && resolution.physical.kind !== "carrier")) {
    throw traversal_error(
      "PHYSICAL_TARGET_UNAVAILABLE",
      "the logical endpoint has no existing canonical content-owner target",
    );
  }
  return Object.freeze({ kind: "path", path: resolution.physical.path });
}

/** Lower one resolved child endpoint to its parent target and physical slot. */
export function lower_internal_document_content_slot(
  resolution: InternalDocumentLogicalResolution,
): Readonly<{ target: LiveMapDocumentRequestTarget; index: number }> {
  if (resolution.kind !== "node" && resolution.kind !== "primitive") {
    throw traversal_error("PHYSICAL_TARGET_UNAVAILABLE", "the logical endpoint is not one content slot");
  }
  if (resolution.physical.kind !== "direct" && resolution.physical.kind !== "carrier") {
    throw traversal_error("PHYSICAL_TARGET_UNAVAILABLE", "the logical endpoint has no physical content path");
  }
  const path = resolution.physical.path;
  const index = path[path.length - 1];
  const parent = parent_document_path(path);
  if (index === undefined || parent === undefined) {
    throw traversal_error("PHYSICAL_TARGET_UNAVAILABLE", "the logical endpoint is not below a physical content owner");
  }
  return Object.freeze({
    target: Object.freeze({ kind: "path", path: parent }),
    index,
  });
}

/** Lower an ordinary element or one of its facets to the existing attrs target. */
export function lower_internal_document_element_target(
  resolution: InternalDocumentLogicalResolution,
): LiveMapDocumentRequestTarget {
  if (resolution.physical.kind === "facet") {
    return Object.freeze({ kind: "path", path: resolution.physical.ownerPath });
  }
  if (resolution.kind === "node"
    && is_ordinary_element_node(resolution.value)
    && (resolution.physical.kind === "direct" || resolution.physical.kind === "carrier")) {
    return Object.freeze({ kind: "path", path: resolution.physical.path });
  }
  throw traversal_error("PHYSICAL_TARGET_UNAVAILABLE", "the logical endpoint is not an ordinary element target");
}

/**
 * Lower logical insertion without inventing a path for absent canonical state.
 * The returned instruction is transient and must be handed to an existing
 * content-insert or root-replacement planner.
 */
export function lower_internal_document_content_insert(
  resolution: InternalDocumentLogicalResolution,
  indexInput: number,
  content: LiveMapDocumentContent,
): InternalDocumentContentMutationLowering {
  const index = validated_edge_index(indexInput);
  if (resolution.kind !== "content") {
    throw traversal_error("PHYSICAL_TARGET_UNAVAILABLE", "insertion requires a logical content container");
  }
  if (index > resolution.length) {
    throw traversal_error(
      "CONTENT_INDEX_OUT_OF_RANGE",
      `logical insertion index ${index} is outside 0 through ${resolution.length}`,
    );
  }
  if (resolution.physical.kind === "direct" || resolution.physical.kind === "carrier") {
    return Object.freeze({
      kind: "content-insert",
      target: Object.freeze({ kind: "path", path: resolution.physical.path }),
      index,
      content,
    });
  }
  if (resolution.physical.kind !== "none" || index !== 0) {
    throw traversal_error("PHYSICAL_TARGET_UNAVAILABLE", "empty content can materialize only at insertion index zero");
  }
  const carrier = make_internal_document_content_carrier(content);
  if (resolution.physical.reason === "empty-element-content"
    && resolution.physical.ownerPath !== undefined) {
    return Object.freeze({
      kind: "content-insert",
      target: Object.freeze({ kind: "path", path: resolution.physical.ownerPath }),
      index: 0,
      content: carrier,
    });
  }
  const root: HsonNode = { $_tag: ROOT_TAG, $_content: [carrier] };
  return Object.freeze({ kind: "replace-root", root });
}

/** Lower logical removal, collapsing the last materialized owner canonically. */
export function lower_internal_document_content_remove(
  resolution: InternalDocumentLogicalResolution,
  indexInput: number,
): InternalDocumentContentMutationLowering {
  const index = validated_edge_index(indexInput);
  if (resolution.kind !== "content" || index >= resolution.length) {
    throw traversal_error("CONTENT_INDEX_OUT_OF_RANGE", "logical removal index is outside current content");
  }
  if (resolution.physical.kind !== "direct" && resolution.physical.kind !== "carrier") {
    throw traversal_error("PHYSICAL_TARGET_UNAVAILABLE", "logical content has no materialized removal target");
  }
  if (resolution.length > 1) {
    return Object.freeze({
      kind: "content-remove",
      target: Object.freeze({ kind: "path", path: resolution.physical.path }),
      index,
    });
  }
  if (resolution.scope === "fragment") {
    const root: HsonNode = { $_tag: ROOT_TAG, $_content: [] };
    return Object.freeze({ kind: "replace-root", root });
  }
  const carrierPath = resolution.physical.path;
  const carrierIndex = carrierPath[carrierPath.length - 1];
  const ownerPath = parent_document_path(carrierPath);
  if (carrierIndex === undefined || ownerPath === undefined) {
    throw traversal_error("PHYSICAL_TARGET_UNAVAILABLE", "element carrier has no owning content slot");
  }
  return Object.freeze({
    kind: "content-remove",
    target: Object.freeze({ kind: "path", path: ownerPath }),
    index: carrierIndex,
  });
}

function document_root_cursor(root: HsonNode, mode: DocumentLiveMapMode): TraversalCursor {
  try {
    const observed = classify_live_root_mode(root);
    if (observed !== mode) {
      throw new InternalDocumentTraversalError(
        "INVALID_DOCUMENT_ROOT",
        `the supplied mode ${mode} does not match canonical mode ${observed}`,
      );
    }
  } catch (cause) {
    if (cause instanceof InternalDocumentTraversalError) throw cause;
    throw new InternalDocumentTraversalError(
      "INVALID_DOCUMENT_ROOT",
      "the supplied root is not an exact canonical document graph",
      undefined,
      { cause },
    );
  }

  if (mode === "element") {
    const endpoint = resolve_document_path(root, mode, validate_document_path([]));
    if (!is_Node(endpoint) || !is_ordinary_element_node(endpoint)) {
      throw traversal_error("INVALID_DOCUMENT_ROOT", "element mode has no ordinary root element");
    }
    return Object.freeze({
      kind: "node",
      node: endpoint,
      path: validate_document_path([]),
      carrierPaths: Object.freeze([]),
    });
  }

  if (root.$_tag === ROOT_TAG && root.$_content.length === 0) {
    return Object.freeze({
      kind: "content",
      scope: "fragment",
      carrierPaths: Object.freeze([]),
      emptyReason: "empty-fragment",
    });
  }

  const endpoint = resolve_document_path(root, mode, validate_document_path([]));
  if (!is_Node(endpoint) || endpoint.$_tag !== ELEM_TAG) {
    throw traversal_error("INVALID_DOCUMENT_ROOT", "fragment mode has no canonical document content cluster");
  }
  return Object.freeze({
    kind: "content",
    scope: "fragment",
    ownerPath: validate_document_path([]),
    node: endpoint,
    carrierPaths: Object.freeze([]),
  });
}

function resolve_facet(
  cursor: NodeCursor | ContentCursor,
  facet: InternalDocumentFacet,
  edgeIndex: number,
): TraversalCursor {
  if (facet === "content") {
    if (cursor.kind === "content") return cursor;
    return logical_element_content_cursor(cursor, edgeIndex);
  }
  if (cursor.kind !== "node" || !is_ordinary_element_node(cursor.node)) {
    throw traversal_error("FACET_UNAVAILABLE", `facet ${facet} requires an ordinary element`, edgeIndex);
  }
  const physical: InternalDocumentPhysicalAssociation = Object.freeze({
    kind: "facet",
    facet,
    ownerPath: cursor.path,
  });
  if (facet === "tag") {
    return Object.freeze({ kind: "facet", facet, value: cursor.node.$_tag, access: "readonly", physical });
  }
  if (facet === "attrs") {
    const attrs = decode_public_attrs(cursor.node.$_attrs ?? {});
    if (attrs === undefined) {
      throw traversal_error("INVALID_DOCUMENT_ROOT", "ordinary element attrs are not canonical", edgeIndex);
    }
    return Object.freeze({ kind: "facet", facet, value: attrs, access: "operation-specific", physical });
  }
  const metadata: HsonMeta = clone_node(cursor.node.$_meta ?? {});
  return Object.freeze({
    kind: "facet",
    facet,
    value: Object.freeze(metadata),
    access: "protected",
    physical,
  });
}

function logical_element_content_cursor(cursor: NodeCursor, edgeIndex: number): ContentCursor {
  if (!is_ordinary_element_node(cursor.node)) {
    throw traversal_error("FACET_UNAVAILABLE", "logical content requires an ordinary element", edgeIndex);
  }
  const structure = classify_ordinary_hson_structure(cursor.node);
  if (structure.kind === "empty-element") {
    return Object.freeze({
      kind: "content",
      scope: "element",
      logicalOwnerPath: cursor.path,
      carrierPaths: cursor.carrierPaths,
      emptyReason: "empty-element-content",
    });
  }
  if (structure.kind !== "element") {
    throw traversal_error(
      "INVALID_DOCUMENT_ROOT",
      `ordinary document element has non-element structure ${structure.kind}`,
      edgeIndex,
    );
  }
  const carrierPath = append_document_path(cursor.path, 0);
  return Object.freeze({
    kind: "content",
    scope: "element",
    ownerPath: carrierPath,
    node: structure.cluster,
    carrierPaths: Object.freeze([...cursor.carrierPaths, carrierPath]),
  });
}

function content_child_cursor(
  cursor: ContentCursor,
  index: number,
  edgeIndex: number,
): NodeCursor | PrimitiveCursor {
  if (cursor.node === undefined || cursor.ownerPath === undefined || index >= cursor.node.$_content.length) {
    throw traversal_error(
      "CONTENT_INDEX_OUT_OF_RANGE",
      `logical ${cursor.scope} content index ${index} is outside ${cursor.node?.$_content.length ?? 0} slot(s)`,
      edgeIndex,
    );
  }
  return child_cursor(cursor.node, cursor.ownerPath, cursor.carrierPaths, index, edgeIndex);
}

function raw_content_child_cursor(
  cursor: NodeCursor | ContentCursor,
  index: number,
  edgeIndex: number,
): NodeCursor | PrimitiveCursor {
  if (cursor.kind === "content") {
    if (cursor.node === undefined || cursor.ownerPath === undefined || index >= cursor.node.$_content.length) {
      throw traversal_error(
        "CONTENT_INDEX_OUT_OF_RANGE",
        `raw content index ${index} is outside ${cursor.node?.$_content.length ?? 0} slot(s)`,
        edgeIndex,
      );
    }
    return child_cursor(cursor.node, cursor.ownerPath, cursor.carrierPaths, index, edgeIndex);
  }
  if (index >= cursor.node.$_content.length) {
    throw traversal_error(
      "CONTENT_INDEX_OUT_OF_RANGE",
      `raw content index ${index} is outside ${cursor.node.$_content.length} slot(s)`,
      edgeIndex,
    );
  }
  return child_cursor(cursor.node, cursor.path, cursor.carrierPaths, index, edgeIndex);
}

function child_cursor(
  owner: HsonNode,
  ownerPath: LiveMapDocumentPath,
  carrierPaths: readonly LiveMapDocumentPath[],
  index: number,
  edgeIndex: number,
): NodeCursor | PrimitiveCursor {
  const value = owner.$_content[index];
  if (value === undefined) {
    throw traversal_error("CONTENT_INDEX_OUT_OF_RANGE", `content index ${index} has no canonical value`, edgeIndex);
  }
  const path = append_document_path(ownerPath, index);
  if (is_Node(value)) {
    return Object.freeze({ kind: "node", node: value, path, carrierPaths });
  }
  return Object.freeze({ kind: "primitive", value, path, carrierPaths });
}

function materialize_resolution(cursor: TraversalCursor): InternalDocumentLogicalResolution {
  if (cursor.kind === "facet") return cursor;
  if (cursor.kind === "content") {
    return Object.freeze({
      kind: "content",
      scope: cursor.scope,
      length: cursor.node?.$_content.length ?? 0,
      physical: cursor_physical_association(cursor),
    });
  }
  if (cursor.kind === "node") {
    return Object.freeze({
      kind: "node",
      value: clone_node(cursor.node),
      physical: cursor_physical_association(cursor),
    });
  }
  return Object.freeze({
    kind: "primitive",
    value: cursor.value,
    physical: cursor_physical_association(cursor),
  });
}

function cursor_physical_association(
  cursor: NodeCursor | PrimitiveCursor | ContentCursor,
): InternalDocumentPhysicalAssociation {
  const path = cursor.kind === "content" ? cursor.ownerPath : cursor.path;
  if (path === undefined) {
    const reason = cursor.kind === "content" && cursor.emptyReason !== undefined
      ? cursor.emptyReason
      : "empty-element-content";
    const ownerPath = cursor.kind === "content" && cursor.emptyReason === "empty-element-content"
      ? cursor.logicalOwnerPath
      : undefined;
    return Object.freeze({ kind: "none", reason, ...(ownerPath === undefined ? {} : { ownerPath }) });
  }
  if (cursor.carrierPaths.length === 0) return Object.freeze({ kind: "direct", path });
  return Object.freeze({
    kind: "carrier",
    path,
    carrierPaths: Object.freeze([...cursor.carrierPaths]),
  });
}

function validated_edge_index(index: number, edgeIndex?: number): number {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw traversal_error("INVALID_EDGE_INDEX", "content indexes must be non-negative safe integers", edgeIndex);
  }
  return index;
}

function traversal_error(
  code: InternalDocumentTraversalFailureCode,
  reason: string,
  edgeIndex?: number,
): InternalDocumentTraversalError {
  return new InternalDocumentTraversalError(code, reason, edgeIndex);
}
