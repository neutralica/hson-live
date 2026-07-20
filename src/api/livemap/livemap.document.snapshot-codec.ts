import { assert_invariants } from "../../core/assert-invariants.js";
import { is_Node } from "../../core/node-guards.js";
import type { HsonAttrs, HsonMeta, HsonNode, JsonValue, Primitive } from "../../core/types.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { parse_json } from "../transform/parsers/parse-json.js";
import { json_value_from_node } from "../transform/serializers/serialize-json.js";
import { serialize_hson } from "../transform/serializers/serialize-hson.js";
import type { DocumentLiveMapCapture, DocumentLiveMapMode } from "../../types/livemap.types.js";
import { classify_live_root_mode } from "./livemap.document.js";
import {
  index_livemap_document_elements,
  LiveMapDocumentIdentityError,
} from "./livemap.document.identity.js";
import {
  CanonicalDocumentSnapshotCodecError,
  type CanonicalDocumentSnapshotCodecErrorCode,
} from "./livemap.document.snapshot-codec.error.js";

const FORMAT = "canonical-hson" as const;
const FORMAT_VERSION = 1 as const;
const CAPTURE_KIND = "hson-document" as const;
const CAPTURE_VERSION = 1 as const;

const DEFAULT_MAX_PAYLOAD_BYTES = 4 * 1_024 * 1_024;
const DEFAULT_MAX_DEPTH = 256;
const DEFAULT_MAX_NODES = 100_000;
const textEncoder = new TextEncoder();

/** @internal */
export type CanonicalDocumentSnapshotEncoding = Readonly<{
  format: typeof FORMAT;
  formatVersion: typeof FORMAT_VERSION;
  payload: string;
}>;

/** @internal Internal limits; overrides exist for focused boundary testing only. */
export type CanonicalDocumentSnapshotCodecOptions = Readonly<{
  maxPayloadBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
}>;

type CodecLimits = Readonly<{
  maxPayloadBytes: number;
  maxDepth: number;
  maxNodes: number;
}>;

type CodecEntry = Readonly<{
  key: string;
  value: CodecValue;
}>;

type CodecBag =
  | Readonly<{ presence: "absent" }>
  | Readonly<{ presence: "present"; entries: readonly CodecEntry[] }>;

type CodecValue =
  | Readonly<{ type: "node"; tag: string; attrs: CodecBag; meta: CodecBag; content: readonly CodecValue[] }>
  | Readonly<{ type: "string"; value: string }>
  | Readonly<{ type: "number"; value: number }>
  | Readonly<{ type: "boolean"; value: boolean }>
  | Readonly<{ type: "null" }>
  | Readonly<{ type: "array"; items: readonly CodecValue[] }>
  | Readonly<{ type: "record"; entries: readonly CodecEntry[] }>;

type CodecPayload = Readonly<{
  captureKind: typeof CAPTURE_KIND;
  captureVersion: typeof CAPTURE_VERSION;
  mode: DocumentLiveMapMode;
  revision: number;
  root: CodecValue;
}>;

type Budget = {
  nodes: number;
};

/** @internal Encode one validated document capture as deterministic compact HSON data. */
export function encode_canonical_document_snapshot(
  capture: DocumentLiveMapCapture,
  options?: CanonicalDocumentSnapshotCodecOptions,
): CanonicalDocumentSnapshotEncoding {
  validate_capture_header(capture);
  const limits = codec_limits(options);
  validate_canonical_document(capture.root, capture.mode);

  const budget: Budget = { nodes: 0 };
  const payloadValue: CodecPayload = {
    captureKind: CAPTURE_KIND,
    captureVersion: CAPTURE_VERSION,
    mode: capture.mode,
    revision: capture.rev,
    root: encode_value(capture.root, 1, budget, limits),
  };

  let payload: string;
  try {
    payload = serialize_hson(parse_json(codec_json_value(payloadValue)), { noBreak: true });
  } catch (cause) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
      "Canonical snapshot representation could not be serialized.",
      cause,
    );
  }
  assert_payload_size(payload, limits);
  return Object.freeze({ format: FORMAT, formatVersion: FORMAT_VERSION, payload });
}

/** @internal Decode one canonical compact HSON payload into a detached document capture. */
export function decode_canonical_document_snapshot(
  encoded: CanonicalDocumentSnapshotEncoding,
  options?: CanonicalDocumentSnapshotCodecOptions,
): DocumentLiveMapCapture {
  validate_encoding_wrapper(encoded);
  const limits = codec_limits(options);
  assert_payload_size(encoded.payload, limits);

  let parsedNode: HsonNode;
  try {
    parsedNode = parse_hson(encoded.payload);
  } catch (cause) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_SYNTAX_INVALID",
      "Canonical snapshot payload is not valid HSON.",
      cause,
    );
  }

  let representation: JsonValue;
  try {
    representation = json_value_from_node(parsedNode);
  } catch (cause) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
      "Canonical snapshot payload does not contain a valid codec representation.",
      cause,
    );
  }

  const payload = decode_payload(representation, limits);
  const capture: DocumentLiveMapCapture = Object.freeze({
    kind: CAPTURE_KIND,
    version: CAPTURE_VERSION,
    mode: payload.mode,
    rev: payload.revision,
    root: payload.root,
  });
  validate_canonical_document(capture.root, capture.mode);

  const canonical = encode_canonical_document_snapshot(capture, limits);
  if (canonical.payload !== encoded.payload) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_ROUND_TRIP_MISMATCH",
      "Canonical snapshot payload is not the deterministic version 1 representation.",
    );
  }
  return capture;
}

function encode_value(
  value: unknown,
  depth: number,
  budget: Budget,
  limits: CodecLimits,
): CodecValue {
  assert_depth(depth, limits);
  if (is_Node(value)) {
    budget.nodes += 1;
    if (budget.nodes > limits.maxNodes) {
      throw codec_error(
        "CANONICAL_SNAPSHOT_NODE_LIMIT",
        "Canonical snapshot graph exceeds the node-count limit.",
      );
    }
    return {
      type: "node",
      tag: value.$_tag,
      attrs: encode_bag(value, "$_attrs", value.$_attrs, depth + 1, budget, limits),
      meta: encode_bag(value, "$_meta", value.$_meta, depth + 1, budget, limits),
      content: value.$_content.map((item) => encode_value(item, depth + 1, budget, limits)),
    };
  }
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw codec_error(
        "CANONICAL_SNAPSHOT_NON_FINITE_NUMBER",
        "Canonical snapshot contains a non-finite number.",
      );
    }
    return { type: "number", value };
  }
  if (typeof value === "boolean") return { type: "boolean", value };
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    return { type: "array", items: value.map((item) => encode_value(item, depth + 1, budget, limits)) };
  }
  if (is_plain_record(value)) {
    return { type: "record", entries: encode_entries(value, depth + 1, budget, limits) };
  }
  throw codec_error(
    "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
    "Canonical snapshot contains an unsupported value.",
  );
}

function encode_bag(
  owner: HsonNode,
  key: "$_attrs" | "$_meta",
  value: HsonAttrs | HsonMeta | undefined,
  depth: number,
  budget: Budget,
  limits: CodecLimits,
): CodecBag {
  if (!Object.hasOwn(owner, key)) return { presence: "absent" };
  if (!is_plain_record(value)) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_GRAPH_INVALID",
      "Canonical snapshot graph contains an invalid field bag.",
    );
  }
  assert_depth(depth, limits);
  return { presence: "present", entries: encode_entries(value, depth + 1, budget, limits) };
}

function encode_entries(
  value: Readonly<Record<string, unknown>>,
  depth: number,
  budget: Budget,
  limits: CodecLimits,
): readonly CodecEntry[] {
  assert_depth(depth, limits);
  return Object.keys(value).sort().map((key) => ({
    key,
    value: encode_value(value[key], depth + 1, budget, limits),
  }));
}

function decode_payload(value: JsonValue, limits: CodecLimits): Readonly<{
  mode: DocumentLiveMapMode;
  revision: number;
  root: HsonNode;
}> {
  const record = exact_record(value, ["captureKind", "captureVersion", "mode", "revision", "root"]);
  if (record.captureKind !== CAPTURE_KIND || record.captureVersion !== CAPTURE_VERSION) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
      "Canonical snapshot payload declares an unsupported capture representation.",
    );
  }
  const mode = decode_mode(record.mode);
  if (!Number.isInteger(record.revision) || typeof record.revision !== "number" || record.revision < 0) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
      "Canonical snapshot payload has an invalid revision.",
    );
  }
  const budget: Budget = { nodes: 0 };
  const root = decode_value(record.root, 1, budget, limits);
  if (!is_Node(root)) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
      "Canonical snapshot payload root is not a node.",
    );
  }
  return { mode, revision: record.revision, root };
}

function decode_value(
  input: unknown,
  depth: number,
  budget: Budget,
  limits: CodecLimits,
): unknown {
  assert_depth(depth, limits);
  const tagged = require_record(input);
  const type = tagged.type;
  if (type === "null") {
    require_exact_keys(tagged, ["type"]);
    return null;
  }
  if (type === "string") {
    require_exact_keys(tagged, ["type", "value"]);
    if (typeof tagged.value !== "string") throw invalid_representation();
    return tagged.value;
  }
  if (type === "number") {
    require_exact_keys(tagged, ["type", "value"]);
    if (typeof tagged.value !== "number") throw invalid_representation();
    if (!Number.isFinite(tagged.value)) {
      throw codec_error(
        "CANONICAL_SNAPSHOT_NON_FINITE_NUMBER",
        "Canonical snapshot contains a non-finite number.",
      );
    }
    return tagged.value;
  }
  if (type === "boolean") {
    require_exact_keys(tagged, ["type", "value"]);
    if (typeof tagged.value !== "boolean") throw invalid_representation();
    return tagged.value;
  }
  if (type === "array") {
    require_exact_keys(tagged, ["type", "items"]);
    if (!Array.isArray(tagged.items)) throw invalid_representation();
    return tagged.items.map((item) => decode_value(item, depth + 1, budget, limits));
  }
  if (type === "record") {
    require_exact_keys(tagged, ["type", "entries"]);
    return decode_entries(tagged.entries, depth + 1, budget, limits);
  }
  if (type === "node") {
    require_exact_keys(tagged, ["type", "tag", "attrs", "meta", "content"]);
    if (typeof tagged.tag !== "string" || !Array.isArray(tagged.content)) throw invalid_representation();
    budget.nodes += 1;
    if (budget.nodes > limits.maxNodes) {
      throw codec_error(
        "CANONICAL_SNAPSHOT_NODE_LIMIT",
        "Canonical snapshot graph exceeds the node-count limit.",
      );
    }
    const attrs = decode_bag(tagged.attrs, "attrs", depth + 1, budget, limits);
    const meta = decode_bag(tagged.meta, "meta", depth + 1, budget, limits);
    const content = tagged.content.map((item) => decode_value(item, depth + 1, budget, limits));
    const output: HsonNode = { $_tag: tagged.tag, $_content: content as HsonNode["$_content"] };
    if (attrs !== undefined) output.$_attrs = decode_attrs(attrs);
    if (meta !== undefined) output.$_meta = decode_meta(meta);
    return output;
  }
  throw invalid_representation();
}

function decode_bag(
  input: unknown,
  kind: "attrs" | "meta",
  depth: number,
  budget: Budget,
  limits: CodecLimits,
): Record<string, unknown> | undefined {
  assert_depth(depth, limits);
  const bag = require_record(input);
  if (bag.presence === "absent") {
    require_exact_keys(bag, ["presence"]);
    return undefined;
  }
  if (bag.presence !== "present") throw invalid_representation();
  require_exact_keys(bag, ["presence", "entries"]);
  const decoded = decode_entries(bag.entries, depth + 1, budget, limits);
  if (kind === "attrs") return decoded;
  return decoded;
}

function decode_entries(
  input: unknown,
  depth: number,
  budget: Budget,
  limits: CodecLimits,
): Record<string, unknown> {
  assert_depth(depth, limits);
  if (!Array.isArray(input)) throw invalid_representation();
  const output: Record<string, unknown> = {};
  let previous: string | undefined;
  for (const item of input) {
    const entry = exact_record(item, ["key", "value"]);
    if (typeof entry.key !== "string" || (previous !== undefined && entry.key <= previous)) {
      throw invalid_representation();
    }
    previous = entry.key;
    output[entry.key] = decode_value(entry.value, depth + 1, budget, limits);
  }
  return output;
}

function decode_attrs(value: Record<string, unknown>): HsonAttrs {
  const attrs: HsonAttrs = {};
  for (const [key, item] of Object.entries(value)) {
    if (is_primitive(item)) {
      attrs[key] = item;
      continue;
    }
    if (key === "style" && is_style_record(item, new WeakSet<object>())) {
      attrs.style = item;
      continue;
    }
    throw invalid_representation();
  }
  return attrs;
}

function decode_meta(value: Record<string, unknown>): HsonMeta {
  const meta: HsonMeta = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") throw invalid_representation();
    meta[key] = item;
  }
  return meta;
}

function validate_capture_header(capture: DocumentLiveMapCapture): void {
  if (!is_plain_record(capture)
    || capture.kind !== CAPTURE_KIND
    || capture.version !== CAPTURE_VERSION
    || !is_Node(capture.root)) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
      "Canonical snapshot capture has an invalid document representation.",
    );
  }
  decode_mode(capture.mode);
  if (!Number.isInteger(capture.rev) || capture.rev < 0) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
      "Canonical snapshot capture has an invalid revision.",
    );
  }
}

function validate_canonical_document(root: HsonNode, expectedMode: DocumentLiveMapMode): void {
  try {
    assert_invariants(root, "canonical document snapshot codec");
  } catch (cause) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_GRAPH_INVALID",
      "Canonical snapshot graph is invalid.",
      cause,
    );
  }

  let mode;
  try {
    mode = classify_live_root_mode(root);
  } catch (cause) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_GRAPH_INVALID",
      "Canonical snapshot graph cannot be classified.",
      cause,
    );
  }
  if (mode !== expectedMode) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_MODE_MISMATCH",
      "Canonical snapshot document mode does not match its graph.",
    );
  }
  try {
    index_livemap_document_elements(root);
  } catch (cause) {
    const code: CanonicalDocumentSnapshotCodecErrorCode = cause instanceof LiveMapDocumentIdentityError
      ? "CANONICAL_SNAPSHOT_IDENTITY_INVALID"
      : "CANONICAL_SNAPSHOT_GRAPH_INVALID";
    throw codec_error(code, "Canonical snapshot document identity is invalid.", cause);
  }
}

function validate_encoding_wrapper(encoded: CanonicalDocumentSnapshotEncoding): void {
  if (!is_plain_record(encoded) || encoded.format !== FORMAT) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_FORMAT_UNKNOWN",
      "Canonical snapshot format is unknown.",
    );
  }
  if (encoded.formatVersion !== FORMAT_VERSION) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_VERSION_UNSUPPORTED",
      "Canonical snapshot format version is unsupported.",
    );
  }
  require_exact_keys(encoded, ["format", "formatVersion", "payload"]);
  if (typeof encoded.payload !== "string") throw invalid_representation();
}

function decode_mode(value: unknown): DocumentLiveMapMode {
  if (value === "element" || value === "fragment") return value;
  throw codec_error(
    "CANONICAL_SNAPSHOT_MODE_MISMATCH",
    "Canonical snapshot mode is not a supported document mode.",
  );
}

function codec_limits(options?: CanonicalDocumentSnapshotCodecOptions): CodecLimits {
  return {
    maxPayloadBytes: bounded_option(options?.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES),
    maxDepth: bounded_option(options?.maxDepth, DEFAULT_MAX_DEPTH),
    maxNodes: bounded_option(options?.maxNodes, DEFAULT_MAX_NODES),
  };
}

function bounded_option(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (Number.isInteger(value) && value >= 0) return value;
  throw codec_error(
    "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
    "Canonical snapshot codec limit is invalid.",
  );
}

function assert_payload_size(payload: string, limits: CodecLimits): void {
  if (textEncoder.encode(payload).byteLength > limits.maxPayloadBytes) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_PAYLOAD_TOO_LARGE",
      "Canonical snapshot payload exceeds the UTF-8 byte limit.",
    );
  }
}

function assert_depth(depth: number, limits: CodecLimits): void {
  if (depth > limits.maxDepth) {
    throw codec_error(
      "CANONICAL_SNAPSHOT_DEPTH_LIMIT",
      "Canonical snapshot graph exceeds the depth limit.",
    );
  }
}

function codec_json_value(value: CodecPayload): JsonValue {
  return value as JsonValue;
}

function exact_record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = require_record(value);
  require_exact_keys(record, keys);
  return record;
}

function require_record(value: unknown): Record<string, unknown> {
  if (!is_plain_record(value)) throw invalid_representation();
  return value;
}

function require_exact_keys(record: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))) {
    throw invalid_representation();
  }
}

function is_plain_record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function is_primitive(value: unknown): value is Primitive {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || typeof value === "number";
}

function is_style_record(value: unknown, ancestors: WeakSet<object>): value is HsonAttrs["style"] {
  if (!is_plain_record(value) || ancestors.has(value)) return false;
  ancestors.add(value);
  for (const item of Object.values(value)) {
    if (is_primitive(item)) continue;
    if (!is_style_record(item, ancestors)) {
      ancestors.delete(value);
      return false;
    }
  }
  ancestors.delete(value);
  return true;
}

function invalid_representation(): CanonicalDocumentSnapshotCodecError {
  return codec_error(
    "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
    "Canonical snapshot payload has an invalid representation.",
  );
}

function codec_error(
  code: CanonicalDocumentSnapshotCodecErrorCode,
  message: string,
  cause?: unknown,
): CanonicalDocumentSnapshotCodecError {
  return new CanonicalDocumentSnapshotCodecError(code, message, cause);
}
