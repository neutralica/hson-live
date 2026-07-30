import { assert_invariants } from "../../core/assert-invariants.js";
import { ELEM_TAG, ROOT_TAG } from "../../core/constants.js";
import { is_Node } from "../../core/node-guards.js";
import type { HsonNode, Primitive } from "../../core/types.js";
import type { LiveMapDocumentContent } from "../../types/livemap.types.js";
import type { LiveHostEncodedGraphContent } from "../../types/livehost.types.js";
import {
  decode_exact_hson_value,
  encode_exact_hson_value,
} from "../livemap/livemap.document.view-state-codec.js";
import { index_livemap_document_elements } from "../livemap/livemap.document.identity.js";
import { ViewStateSnapshotCodecError } from "../livemap/livemap.document.view-state-codec.error.js";

const FORMAT = "hson-graph" as const;
const FORMAT_VERSION = 2 as const;

export type LiveHostGraphContentCodecErrorCode =
  | "LIVEHOST_GRAPH_CONTENT_FORMAT_UNKNOWN"
  | "LIVEHOST_GRAPH_CONTENT_VERSION_UNSUPPORTED"
  | "LIVEHOST_GRAPH_CONTENT_ENVELOPE_INVALID"
  | "LIVEHOST_GRAPH_CONTENT_PAYLOAD_INVALID"
  | "LIVEHOST_GRAPH_CONTENT_GRAPH_INVALID";

export class LiveHostGraphContentCodecError extends Error {
  public constructor(
    public readonly code: LiveHostGraphContentCodecErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LiveHostGraphContentCodecError";
  }
}

export function encode_livehost_graph_content(
  content: LiveMapDocumentContent,
): LiveHostEncodedGraphContent {
  validate_content(content);
  try {
    return Object.freeze({
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      payload: encode_exact_hson_value(content),
    });
  } catch (cause) {
    throw graph_error(
      "LIVEHOST_GRAPH_CONTENT_PAYLOAD_INVALID",
      "LiveHost graph content could not be encoded.",
      cause,
    );
  }
}

export function decode_livehost_graph_content(
  encoded: unknown,
): LiveMapDocumentContent {
  const record = exact_record(encoded);
  if (record.format !== FORMAT) {
    throw graph_error(
      "LIVEHOST_GRAPH_CONTENT_FORMAT_UNKNOWN",
      "LiveHost graph content format is unknown.",
    );
  }
  if (record.formatVersion !== FORMAT_VERSION) {
    throw graph_error(
      "LIVEHOST_GRAPH_CONTENT_VERSION_UNSUPPORTED",
      "LiveHost graph content format version is unsupported.",
    );
  }
  require_exact_keys(record, ["format", "formatVersion", "payload"]);
  if (typeof record.payload !== "string") {
    throw graph_error(
      "LIVEHOST_GRAPH_CONTENT_ENVELOPE_INVALID",
      "LiveHost graph content payload is malformed.",
    );
  }
  let content: HsonNode | Primitive;
  try {
    content = decode_exact_hson_value(record.payload);
  } catch (cause) {
    const message = cause instanceof ViewStateSnapshotCodecError
      ? "LiveHost graph content HSON is malformed."
      : "LiveHost graph content could not be decoded.";
    throw graph_error("LIVEHOST_GRAPH_CONTENT_PAYLOAD_INVALID", message, cause);
  }
  validate_content(content);
  return content;
}

export function is_livehost_encoded_graph_content(
  value: unknown,
): value is LiveHostEncodedGraphContent {
  try {
    decode_livehost_graph_content(value);
    return true;
  } catch {
    return false;
  }
}

function validate_content(content: HsonNode | Primitive): void {
  if (!is_Node(content)) {
    if (content === null || typeof content === "string" || typeof content === "boolean"
      || (typeof content === "number" && Number.isFinite(content))) return;
    throw graph_error(
      "LIVEHOST_GRAPH_CONTENT_GRAPH_INVALID",
      "LiveHost graph content primitive is invalid.",
    );
  }
  const validationRoot: HsonNode = content.$_tag === ROOT_TAG
    ? content
    : {
      $_tag: ROOT_TAG,
      $_content: [{
        $_tag: ELEM_TAG,
        $_content: [{ $_tag: "livehost-content", $_content: [content] }],
      }],
    };
  try {
    assert_invariants(validationRoot, "livehost graph-content codec");
    index_livemap_document_elements(validationRoot);
  } catch (cause) {
    throw graph_error(
      "LIVEHOST_GRAPH_CONTENT_GRAPH_INVALID",
      "LiveHost graph content is not canonical.",
      cause,
    );
  }
}

function exact_record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw graph_error(
      "LIVEHOST_GRAPH_CONTENT_ENVELOPE_INVALID",
      "LiveHost graph content envelope is malformed.",
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw graph_error(
      "LIVEHOST_GRAPH_CONTENT_ENVELOPE_INVALID",
      "LiveHost graph content envelope is malformed.",
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function require_exact_keys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || !keys.every((key) => expected.includes(key))) {
    throw graph_error(
      "LIVEHOST_GRAPH_CONTENT_ENVELOPE_INVALID",
      "LiveHost graph content envelope contains missing or unexpected fields.",
    );
  }
}

function graph_error(
  code: LiveHostGraphContentCodecErrorCode,
  message: string,
  cause?: unknown,
): LiveHostGraphContentCodecError {
  return new LiveHostGraphContentCodecError(code, message, cause);
}
