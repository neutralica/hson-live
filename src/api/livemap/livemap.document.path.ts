import { ROOT_TAG } from "../../core/constants.js";
import { is_Node } from "../../core/node-guards.js";
import type { HsonNode, Primitive } from "../../core/types.js";
import type {
  DocumentLiveMapMode,
  LiveMapDocumentPath,
  LiveMapGraphOp,
} from "../../types/livemap.types.js";

export type LiveMapDocumentPathFailureCode =
  | "MALFORMED_DOCUMENT_PATH"
  | "INVALID_DOCUMENT_PATH_INDEX"
  | "DOCUMENT_ROOT_UNAVAILABLE"
  | "DOCUMENT_PATH_OUT_OF_RANGE"
  | "DOCUMENT_PATH_PRIMITIVE_DESCENT";

/** Structured neutral failure owned by canonical document-path processing. */
export class LiveMapDocumentPathError extends TypeError {
  readonly code: LiveMapDocumentPathFailureCode;
  readonly segmentIndex: number | undefined;
  readonly segment: unknown;

  constructor(
    code: LiveMapDocumentPathFailureCode,
    reason: string,
    segmentIndex?: number,
    segment?: unknown,
  ) {
    super(`Invalid canonical LiveMap document path: ${reason}`);
    this.name = "LiveMapDocumentPathError";
    this.code = code;
    this.segmentIndex = segmentIndex;
    this.segment = segment;
  }
}

/** Validate, detach, freeze, and establish the sole document-path brand. */
export function validate_document_path(input: unknown): LiveMapDocumentPath {
  if (!Array.isArray(input)) {
    throw new LiveMapDocumentPathError(
      "MALFORMED_DOCUMENT_PATH",
      "the path must be an array of canonical content indexes",
    );
  }
  const detached: number[] = [];
  for (const [segmentIndex, segment] of input.entries()) {
    if (typeof segment !== "number" || !Number.isSafeInteger(segment) || segment < 0) {
      throw new LiveMapDocumentPathError(
        "INVALID_DOCUMENT_PATH_INDEX",
        "every segment must be a finite, non-negative safe integer",
        segmentIndex,
        segment,
      );
    }
    detached.push(segment);
  }

  // This is the sole brand-establishing point, immediately after validation
  // and detachment. The runtime representation remains an ordinary array.
  return Object.freeze(detached) as LiveMapDocumentPath;
}

/** Lexicographic numeric ordering suitable for deterministic indexes and output. */
export function compare_document_paths(
  left: LiveMapDocumentPath,
  right: LiveMapDocumentPath,
): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) continue;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return left.length < right.length ? -1 : left.length > right.length ? 1 : 0;
}

export function document_path_equal(
  left: LiveMapDocumentPath,
  right: LiveMapDocumentPath,
): boolean {
  return compare_document_paths(left, right) === 0;
}

/** Return whether `prefix` is equal to or an ancestor of `path`. */
export function document_path_is_prefix(
  prefix: LiveMapDocumentPath,
  path: LiveMapDocumentPath,
): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((part, index) => path[index] === part);
}

export function append_document_path(
  path: LiveMapDocumentPath,
  segment: unknown,
): LiveMapDocumentPath {
  return validate_document_path([...path, segment]);
}

export function parent_document_path(
  path: LiveMapDocumentPath,
): LiveMapDocumentPath | undefined {
  return path.length === 0
    ? undefined
    : validate_document_path(path.slice(0, -1));
}

/** Deterministic JSON-array key; no string-key path semantics are admitted. */
export function encode_document_path(path: LiveMapDocumentPath): string {
  return JSON.stringify(path);
}

/** Resolve one validated path through canonical `$_content` ownership. */
export function resolve_document_path(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  path: LiveMapDocumentPath,
): HsonNode | Primitive {
  let endpoint: HsonNode | Primitive = document_path_base(root, mode);
  for (const [segmentIndex, segment] of path.entries()) {
    if (!is_Node(endpoint)) {
      throw new LiveMapDocumentPathError(
        "DOCUMENT_PATH_PRIMITIVE_DESCENT",
        `segment ${segment} descends through a primitive reached at ordinal ${segmentIndex}`,
        segmentIndex,
        segment,
      );
    }
    if (segment >= endpoint.$_content.length) {
      throw new LiveMapDocumentPathError(
        "DOCUMENT_PATH_OUT_OF_RANGE",
        `segment ${segment} is outside ${endpoint.$_content.length} content slot(s) at ordinal ${segmentIndex}`,
        segmentIndex,
        segment,
      );
    }
    const next: HsonNode | Primitive | undefined = endpoint.$_content[segment];
    if (next === undefined) {
      throw new LiveMapDocumentPathError(
        "DOCUMENT_PATH_OUT_OF_RANGE",
        `segment ${segment} does not own a canonical content value`,
        segmentIndex,
        segment,
      );
    }
    endpoint = next;
  }
  return endpoint;
}

/** Find the canonical path of one exact node inside the selected document root. */
export function find_document_node_path(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  target: HsonNode,
): LiveMapDocumentPath | undefined {
  const base = document_path_base(root, mode);
  if (base === target) return validate_document_path([]);

  const visit = (node: HsonNode, path: LiveMapDocumentPath): LiveMapDocumentPath | undefined => {
    for (const [index, content] of node.$_content.entries()) {
      if (!is_Node(content)) continue;
      const childPath = append_document_path(path, index);
      if (content === target) return childPath;
      const nested = visit(content, childPath);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  return visit(base, validate_document_path([]));
}

export type LiveMapDocumentPathEffect =
  | Readonly<{ kind: "insert"; parent: LiveMapDocumentPath; index: number }>
  | Readonly<{ kind: "delete"; parent: LiveMapDocumentPath; index: number }>
  | Readonly<{ kind: "replace"; parent: LiveMapDocumentPath; index: number }>
  | Readonly<{ kind: "move"; parent: LiveMapDocumentPath; from: number; to: number }>
  | Readonly<{ kind: "replace-root" }>;

export type LiveMapDocumentPathTransform =
  | Readonly<{ kind: "unchanged"; path: LiveMapDocumentPath }>
  | Readonly<{ kind: "moved"; path: LiveMapDocumentPath }>
  | Readonly<{ kind: "retired"; reason: "deleted" | "replaced" | "root-replaced" }>
  | Readonly<{ kind: "invalid"; reason: string }>;

/**
 * Derive the one canonical path effect represented by a graph operation.
 * Attribute operations preserve locations and therefore have no path effect.
 */
export function document_path_effect_for_graph_operation(
  operation: LiveMapGraphOp,
): LiveMapDocumentPathEffect | undefined {
  if (operation.op === "replace-root") return Object.freeze({ kind: "replace-root" });
  if (operation.op === "set-attr"
    || operation.op === "remove-attr"
    || operation.op === "replace-attrs"
    || operation.op === "ensure-quid") {
    return undefined;
  }
  if (operation.op === "insert-content") {
    return Object.freeze({ kind: "insert", parent: operation.target.path, index: operation.index });
  }
  if (operation.op === "remove-content") {
    return Object.freeze({ kind: "delete", parent: operation.target.path, index: operation.index });
  }
  if (operation.op === "replace-content") {
    return Object.freeze({ kind: "replace", parent: operation.target.path, index: operation.index });
  }
  return Object.freeze({
    kind: "move",
    parent: operation.target.path,
    from: operation.from,
    to: operation.to,
  });
}

/**
 * Transform one known structural location through one canonical content
 * effect. `move.to` is the final sibling index after removal.
 */
export function transform_document_path(
  path: LiveMapDocumentPath,
  effect: LiveMapDocumentPathEffect,
): LiveMapDocumentPathTransform {
  if (effect.kind === "replace-root") {
    return Object.freeze({ kind: "retired", reason: "root-replaced" });
  }
  const primaryIndex = effect.kind === "move" ? effect.from : effect.index;
  if (!Number.isSafeInteger(primaryIndex) || primaryIndex < 0) {
    return Object.freeze({ kind: "invalid", reason: "effect index must be a non-negative safe integer" });
  }
  if (effect.kind === "move" && (!Number.isSafeInteger(effect.to) || effect.to < 0)) {
    return Object.freeze({ kind: "invalid", reason: "move destination must be a non-negative safe integer" });
  }
  if (!document_path_is_prefix(effect.parent, path) || document_path_equal(effect.parent, path)) {
    return Object.freeze({ kind: "unchanged", path });
  }

  const ordinal = effect.parent.length;
  const sibling = path[ordinal];
  if (sibling === undefined) {
    return Object.freeze({ kind: "invalid", reason: "path has no child segment below the effect parent" });
  }
  const rewrite = (next: number): LiveMapDocumentPathTransform => Object.freeze({
    kind: "moved",
    path: validate_document_path([
      ...path.slice(0, ordinal),
      next,
      ...path.slice(ordinal + 1),
    ]),
  });

  if (effect.kind === "insert") {
    return sibling >= effect.index
      ? rewrite(sibling + 1)
      : Object.freeze({ kind: "unchanged", path });
  }
  if (effect.kind === "delete") {
    if (sibling === effect.index) return Object.freeze({ kind: "retired", reason: "deleted" });
    return sibling > effect.index
      ? rewrite(sibling - 1)
      : Object.freeze({ kind: "unchanged", path });
  }
  if (effect.kind === "replace") {
    return sibling === effect.index
      ? Object.freeze({ kind: "retired", reason: "replaced" })
      : Object.freeze({ kind: "unchanged", path });
  }
  if (effect.from === effect.to) return Object.freeze({ kind: "unchanged", path });
  if (sibling === effect.from) return rewrite(effect.to);
  if (effect.from < effect.to && sibling > effect.from && sibling <= effect.to) {
    return rewrite(sibling - 1);
  }
  if (effect.from > effect.to && sibling >= effect.to && sibling < effect.from) {
    return rewrite(sibling + 1);
  }
  return Object.freeze({ kind: "unchanged", path });
}

function document_path_base(root: HsonNode, mode: DocumentLiveMapMode): HsonNode {
  if (mode !== "document" || root.$_tag !== ROOT_TAG) {
    throw new LiveMapDocumentPathError("DOCUMENT_ROOT_UNAVAILABLE", "the owned internal document root is unavailable");
  }
  return root;
}
