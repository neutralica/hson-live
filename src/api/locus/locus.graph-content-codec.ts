import { assert_invariants } from "../../core/assert-invariants.js";
import { scan_hson_node_quids } from "../../core/hson-node-quid.js";
import { is_Node } from "../../core/node-guards.js";
import type { HsonNode, Primitive } from "../../core/types.js";
import type { LiveMapDocumentContent } from "../../types/livemap.types.js";
import type { LocusEncodedGraphContent } from "../../types/locus.types.js";
import {
  decode_exact_hson_value,
  encode_exact_hson_value,
} from "../livemap/livemap.document.view-state-codec.js";
import { ViewStateSnapshotCodecError } from "../livemap/livemap.document.view-state-codec.error.js";

const FORMAT = "hson-graph" as const;

export type LocusGraphContentCodecErrorCode =
  | "LOCUS_GRAPH_CONTENT_FORMAT_UNKNOWN"
  | "LOCUS_GRAPH_CONTENT_ENVELOPE_INVALID"
  | "LOCUS_GRAPH_CONTENT_PAYLOAD_INVALID"
  | "LOCUS_GRAPH_CONTENT_GRAPH_INVALID";

export class LocusGraphContentCodecError extends Error {
  public constructor(
    public readonly code: LocusGraphContentCodecErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LocusGraphContentCodecError";
  }
}

export function encode_locus_graph_content(
  content: LiveMapDocumentContent,
): LocusEncodedGraphContent {
  validate_content(content);
  try {
    return Object.freeze({
      format: FORMAT,
      payload: encode_exact_hson_value(content),
    });
  } catch (cause) {
    throw graph_error(
      "LOCUS_GRAPH_CONTENT_PAYLOAD_INVALID",
      "Locus graph content could not be encoded.",
      cause,
    );
  }
}

export function decode_locus_graph_content(
  encoded: unknown,
): LiveMapDocumentContent {
  const record = exact_record(encoded);
  if (record.format !== FORMAT) {
    throw graph_error(
      "LOCUS_GRAPH_CONTENT_FORMAT_UNKNOWN",
      "Locus graph content format is unknown.",
    );
  }
  require_exact_keys(record, ["format", "payload"]);
  if (typeof record.payload !== "string") {
    throw graph_error(
      "LOCUS_GRAPH_CONTENT_ENVELOPE_INVALID",
      "Locus graph content payload is malformed.",
    );
  }
  let content: HsonNode | Primitive;
  try {
    content = decode_exact_hson_value(record.payload);
  } catch (cause) {
    const message = cause instanceof ViewStateSnapshotCodecError
      ? "Locus graph content Hson is malformed."
      : "Locus graph content could not be decoded.";
    throw graph_error("LOCUS_GRAPH_CONTENT_PAYLOAD_INVALID", message, cause);
  }
  validate_content(content);
  return content;
}

export function is_locus_encoded_graph_content(
  value: unknown,
): value is LocusEncodedGraphContent {
  try {
    decode_locus_graph_content(value);
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
      "LOCUS_GRAPH_CONTENT_GRAPH_INVALID",
      "Locus graph content primitive is invalid.",
    );
  }
  try {
    assert_invariants(content, "locus graph-content codec");
    scan_hson_node_quids(content);
  } catch (cause) {
    throw graph_error(
      "LOCUS_GRAPH_CONTENT_GRAPH_INVALID",
      "Locus graph content is not canonical.",
      cause,
    );
  }
}

function exact_record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw graph_error(
      "LOCUS_GRAPH_CONTENT_ENVELOPE_INVALID",
      "Locus graph content envelope is malformed.",
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw graph_error(
      "LOCUS_GRAPH_CONTENT_ENVELOPE_INVALID",
      "Locus graph content envelope is malformed.",
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function require_exact_keys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || !keys.every((key) => expected.includes(key))) {
    throw graph_error(
      "LOCUS_GRAPH_CONTENT_ENVELOPE_INVALID",
      "Locus graph content envelope contains missing or unexpected fields.",
    );
  }
}

function graph_error(
  code: LocusGraphContentCodecErrorCode,
  message: string,
  cause?: unknown,
): LocusGraphContentCodecError {
  return new LocusGraphContentCodecError(code, message, cause);
}
