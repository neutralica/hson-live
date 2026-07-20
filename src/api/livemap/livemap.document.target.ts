import { ELEM_TAG, ROOT_TAG } from "../../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { is_persisted_quid } from "../../core/persisted-quid.js";
import type { HsonNode, Primitive } from "../../core/types.js";
import type {
  DocumentLiveMapMode,
  LiveMapDocumentTarget,
} from "../../types/livemap.types.js";
import { index_livemap_document_elements } from "./livemap.document.identity.js";
import { LiveMapDocumentMutationError } from "./livemap.error.js";

export type LiveMapDocumentOperation = LiveMapDocumentMutationError["operation"];

export function normalize_document_target(
  input: unknown,
  operation: LiveMapDocumentOperation,
): LiveMapDocumentTarget {
  if (!is_plain_record(input) || (input.kind !== "path" && input.kind !== "quid")) {
    throw document_error("INVALID_DOCUMENT_TARGET", operation, "target must discriminate kind as path or quid");
  }

  if (input.kind === "path") {
    if (Object.keys(input).some((key) => key !== "kind" && key !== "path") || !Array.isArray(input.path)) {
      throw document_error("INVALID_DOCUMENT_TARGET", operation, "path target must contain only kind and path");
    }
    const path = input.path.map((segment) => {
      if (typeof segment !== "number" || !Number.isInteger(segment) || segment < 0) {
        throw document_error("INVALID_DOCUMENT_PATH", operation, "every document path segment must be a non-negative integer");
      }
      return segment;
    });
    return Object.freeze({ kind: "path", path: Object.freeze(path) });
  }

  if (Object.keys(input).some((key) => key !== "kind" && key !== "quid")
    || !is_persisted_quid(input.quid)) {
    throw document_error("INVALID_DOCUMENT_TARGET", operation, "QUID target must contain one canonical persisted QUID");
  }
  return Object.freeze({ kind: "quid", quid: input.quid });
}

export function resolve_document_target(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  target: LiveMapDocumentTarget,
  operation: LiveMapDocumentOperation,
): HsonNode | Primitive {
  if (target.kind === "quid") {
    let endpoint: HsonNode | undefined;
    try {
      endpoint = index_livemap_document_elements(root).get(target.quid);
    } catch (cause) {
      throw document_error("INVALID_DOCUMENT_IDENTITY", operation, "current persisted identity is invalid", cause);
    }
    if (endpoint === undefined) {
      throw document_error("DOCUMENT_TARGET_NOT_FOUND", operation, `no element carries persisted QUID ${JSON.stringify(target.quid)}`);
    }
    return endpoint;
  }

  let endpoint: HsonNode | Primitive = document_path_base(root, mode, operation);
  for (const segment of target.path) {
    if (!is_Node(endpoint) || segment >= endpoint.$_content.length) {
      throw document_error("DOCUMENT_PATH_OUT_OF_RANGE", operation, `document path cannot resolve content segment ${segment}`);
    }
    endpoint = endpoint.$_content[segment];
  }
  return endpoint;
}

export function require_document_attr_element(
  endpoint: HsonNode | Primitive,
  operation: LiveMapDocumentOperation,
): HsonNode {
  if (!is_ordinary_element_node(endpoint)) {
    throw document_error("DOCUMENT_TARGET_KIND", operation, "target must resolve to an ordinary document element");
  }
  return endpoint;
}

function document_path_base(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  operation: LiveMapDocumentOperation,
): HsonNode {
  const cluster = root.$_tag === ELEM_TAG
    ? root
    : root.$_tag === ROOT_TAG && is_Node(root.$_content[0]) && root.$_content[0].$_tag === ELEM_TAG
      ? root.$_content[0]
      : undefined;
  if (cluster === undefined) {
    throw document_error("DOCUMENT_TARGET_NOT_FOUND", operation, "owned document cluster is unavailable");
  }
  if (mode === "fragment") return cluster;
  const element = cluster.$_content[0];
  if (!is_ordinary_element_node(element)) {
    throw document_error("DOCUMENT_TARGET_NOT_FOUND", operation, "owned top-level element is unavailable");
  }
  return element;
}

function document_error(
  code: LiveMapDocumentMutationError["code"],
  operation: LiveMapDocumentOperation,
  reason: string,
  cause?: unknown,
): LiveMapDocumentMutationError {
  return new LiveMapDocumentMutationError(code, operation, reason, cause === undefined ? undefined : { cause });
}

function is_plain_record(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
