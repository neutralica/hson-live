import { is_ordinary_element_node } from "../../core/node-guards.js";
import { is_persisted_quid } from "../../core/persisted-quid.js";
import { read_hson_node_quid } from "../../core/hson-node-quid.js";
import type { HsonNode, Primitive } from "../../core/types.js";
import type {
  DocumentLiveMapMode,
  LiveMapDocumentCommitTarget,
  LiveMapDocumentRequestTarget,
} from "../../types/livemap.types.js";
import type { LiveMapDocumentIdentityOverlay } from "./livemap.document.identity.js";
import {
  LiveMapDocumentPathError,
  resolve_document_path,
  validate_document_path,
} from "./livemap.document.path.js";
import { LiveMapDocumentMutationError } from "./livemap.error.js";

export type LiveMapDocumentOperation = LiveMapDocumentMutationError["operation"];

/** Validate and detach one active request target. */
export function normalize_document_request_target(
  input: unknown,
  operation: LiveMapDocumentOperation,
): LiveMapDocumentRequestTarget {
  if (!is_plain_record(input) || (input.kind !== "path" && input.kind !== "quid")) {
    throw document_error("INVALID_DOCUMENT_TARGET", operation, "target must discriminate kind as path or quid");
  }

  if (input.kind === "path") {
    if (!has_exact_keys(input, ["kind", "path"])) {
      throw document_error("INVALID_DOCUMENT_TARGET", operation, "path request must contain only kind and path");
    }
    return Object.freeze({ kind: "path", path: validate_path(input.path, operation) });
  }

  if (!has_exact_keys(input, ["kind", "quid"]) || !is_persisted_quid(input.quid)) {
    throw document_error("INVALID_DOCUMENT_TARGET", operation, "QUID request must contain one canonical persisted QUID");
  }
  return Object.freeze({ kind: "quid", quid: input.quid });
}

/** Compatibility name retained for existing active-request consumers. */
export const normalize_document_target = normalize_document_request_target;

/** Validate one path-authoritative canonical operation target. */
export function normalize_document_commit_target(
  input: unknown,
  operation: LiveMapDocumentOperation,
): LiveMapDocumentCommitTarget {
  if (!is_plain_record(input) || input.kind !== "path") {
    throw document_error("INVALID_DOCUMENT_COMMIT_TARGET", operation, "canonical target must discriminate kind as path");
  }
  if (!has_only_keys(input, ["kind", "path", "witness"]) || !Object.hasOwn(input, "path")) {
    throw document_error("INVALID_DOCUMENT_COMMIT_TARGET", operation, "canonical target contains missing or unknown fields");
  }
  const path = validate_path(input.path, operation);
  if (!Object.hasOwn(input, "witness")) return Object.freeze({ kind: "path", path });
  const witness = normalize_witness(input.witness, operation);
  return Object.freeze({ kind: "path", path, witness });
}

/** Resolve a live request without changing its compatibility semantics. */
export function resolve_document_target(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  overlay: LiveMapDocumentIdentityOverlay,
  target: LiveMapDocumentRequestTarget,
  operation: LiveMapDocumentOperation,
): HsonNode | Primitive {
  if (target.kind === "path") {
    return resolve_path(root, mode, validate_path(target.path, operation), operation);
  }
  return resolve_quid_request(root, mode, overlay, target.quid, operation).endpoint;
}

/**
 * Lower one active request to the path-authoritative target stored in a new
 * commit. This is the only Unit 1 compatibility seam that routes by QUID.
 */
export function canonicalize_document_request_target(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  overlay: LiveMapDocumentIdentityOverlay,
  input: unknown,
  operation: LiveMapDocumentOperation,
): Readonly<{
  target: LiveMapDocumentCommitTarget;
  endpoint: HsonNode | Primitive;
}> {
  const request = normalize_document_request_target(input, operation);
  if (request.kind === "path") {
    const path = validate_path(request.path, operation);
    return Object.freeze({
      target: Object.freeze({ kind: "path", path }),
      endpoint: resolve_path(root, mode, path, operation),
    });
  }

  const resolved = resolve_quid_request(root, mode, overlay, request.quid, operation);
  const endpoint = resolved.endpoint;
  if (!is_ordinary_element_node(endpoint)) {
    throw document_error("DOCUMENT_TARGET_KIND", operation, "QUID request did not resolve to an ordinary element");
  }
  return Object.freeze({
    target: Object.freeze({
      kind: "path",
      path: resolved.path,
      witness: Object.freeze({ quid: request.quid }),
    }),
    endpoint,
  });
}

/** Resolve only the path and treat an optional witness as non-routing evidence. */
export function resolve_document_commit_target(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  overlay: LiveMapDocumentIdentityOverlay,
  input: unknown,
  operation: LiveMapDocumentOperation,
): Readonly<{
  target: LiveMapDocumentCommitTarget;
  endpoint: HsonNode | Primitive;
}> {
  const target = normalize_document_commit_target(input, operation);
  const endpoint = resolve_path(root, mode, target.path, operation);
  if (target.witness !== undefined && is_ordinary_element_node(endpoint)) {
    const activeQuid = overlay.quidAtPath(target.path);
    if (activeQuid !== undefined && activeQuid !== target.witness.quid) {
      throw document_error(
        "DOCUMENT_WITNESS_MISMATCH",
        operation,
        `path endpoint carries ${JSON.stringify(activeQuid)}, not witness ${JSON.stringify(target.witness.quid)}`,
      );
    }
  }
  return Object.freeze({ target, endpoint });
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

function resolve_quid_request(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  overlay: LiveMapDocumentIdentityOverlay,
  quid: string,
  operation: LiveMapDocumentOperation,
): Readonly<{ path: ReturnType<typeof validate_document_path>; endpoint: HsonNode | Primitive }> {
  const path = overlay.pathForQuid(quid);
  if (path === undefined) {
    throw document_error("DOCUMENT_TARGET_NOT_FOUND", operation, `no element carries persisted QUID ${JSON.stringify(quid)}`);
  }
  const endpoint = resolve_path(root, mode, path, operation);
  if (!is_ordinary_element_node(endpoint)) {
    throw document_error(
      "INVALID_DOCUMENT_IDENTITY",
      operation,
      `active QUID ${JSON.stringify(quid)} resolves to an ineligible endpoint`,
    );
  }
  let activeQuid: string | undefined;
  try {
    activeQuid = read_hson_node_quid(endpoint);
  } catch (cause) {
    throw document_error(
      "INVALID_DOCUMENT_IDENTITY",
      operation,
      `active QUID ${JSON.stringify(quid)} resolves through inconsistent metadata`,
      cause,
    );
  }
  if (activeQuid !== quid) {
    throw document_error(
      "INVALID_DOCUMENT_IDENTITY",
      operation,
      `active QUID ${JSON.stringify(quid)} disagrees with its installed overlay path`,
    );
  }
  return Object.freeze({ path, endpoint });
}

function resolve_path(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  path: ReturnType<typeof validate_document_path>,
  operation: LiveMapDocumentOperation,
): HsonNode | Primitive {
  try {
    return resolve_document_path(root, mode, path);
  } catch (cause) {
    throw map_path_error(cause, operation);
  }
}

function validate_path(
  input: unknown,
  operation: LiveMapDocumentOperation,
): ReturnType<typeof validate_document_path> {
  try {
    return validate_document_path(input);
  } catch (cause) {
    throw map_path_error(cause, operation);
  }
}

function normalize_witness(
  input: unknown,
  operation: LiveMapDocumentOperation,
): Readonly<{ quid: string }> {
  if (!is_plain_record(input) || !has_exact_keys(input, ["quid"]) || !is_persisted_quid(input.quid)) {
    throw document_error("INVALID_DOCUMENT_WITNESS", operation, "witness must contain one canonical persisted QUID");
  }
  return Object.freeze({ quid: input.quid });
}

function map_path_error(cause: unknown, operation: LiveMapDocumentOperation): LiveMapDocumentMutationError {
  if (!(cause instanceof LiveMapDocumentPathError)) {
    return document_error("INVALID_DOCUMENT_PATH", operation, "canonical path processing failed", cause);
  }
  if (cause.code === "MALFORMED_DOCUMENT_PATH") {
    return document_error("INVALID_DOCUMENT_PATH", operation, cause.message, cause);
  }
  if (cause.code === "INVALID_DOCUMENT_PATH_INDEX") {
    return document_error("INVALID_DOCUMENT_PATH_INDEX", operation, cause.message, cause);
  }
  if (cause.code === "DOCUMENT_PATH_PRIMITIVE_DESCENT") {
    return document_error("DOCUMENT_PATH_PRIMITIVE_DESCENT", operation, cause.message, cause);
  }
  if (cause.code === "DOCUMENT_PATH_OUT_OF_RANGE") {
    return document_error("DOCUMENT_PATH_OUT_OF_RANGE", operation, cause.message, cause);
  }
  return document_error("DOCUMENT_TARGET_NOT_FOUND", operation, cause.message, cause);
}

function document_error(
  code: LiveMapDocumentMutationError["code"],
  operation: LiveMapDocumentOperation,
  reason: string,
  cause?: unknown,
): LiveMapDocumentMutationError {
  return new LiveMapDocumentMutationError(code, operation, reason, cause === undefined ? undefined : { cause });
}

function has_exact_keys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function has_only_keys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function is_plain_record(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
