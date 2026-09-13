import type {
  DocumentLiveMapCapture,
  HostedLiveMapLibrariesSnapshot,
  LiveMapLibrariesSnapshot,
  LiveMapRootMode,
} from "../../types/livemap.types.js";
import type { LocusSnapshotEnvelope } from "../../types/locus.representation.types.js";
import type { HsonSchema } from "../transform/transform.types.js";
import { BoundedStringWriter } from "../../core/bounded-string-writer.js";
import { parse_ordered_json_text } from "../../core/exact-data-codec.js";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
} from "../livemap/livemap.document.view-state-codec.js";
import {
  assert_hosted_libraries_snapshot_shape,
  assert_libraries_snapshot_bound,
  assert_libraries_snapshot_shape,
} from "../livemap/livemap.hosted.js";
import { SsrBootstrapEncodingError } from "./ssr-bootstrap.error.js";
import type {
  DecodedSsrBootstrap,
  EncodedSsrBootstrap,
  SsrBootstrapCodecOptions,
  SsrBootstrapKind,
} from "./ssr-bootstrap.types.js";

const FORMAT = "hson-ssr-bootstrap" as const;
const VERSION = 1 as const;
const DEFAULT_MAX_ENCODED_BYTES = 96 * 1_024 * 1_024;
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_INPUT_CHUNK_BYTES = 24 * 1_024;
const encoder = new TextEncoder();
const asciiDecoder = new TextDecoder();

type HostedDocumentBootstrap = Extract<LocusSnapshotEnvelope, { hson: string }> & Readonly<{ mode: "document" }>;
type WireRegistryEntry = Readonly<{
  name: string;
  scope: null | "hson-internal";
  mode: LiveMapRootMode;
  schema: string;
  schemaDigest: string;
  rootCodec: "hson-exact-value";
}>;
type WireLibrary = Readonly<{
  name: string;
  mode: LiveMapRootMode;
  schema: string;
  schemaDigest: string;
  rootFormat: "hson-exact-value";
  rootPayload: string;
}>;
type LibrariesPayload = Readonly<{
  snapshotFormat: "hson-livemap-libraries-snapshot";
  revision: number;
  registryFormat: "hson-hosted-registry";
  registry: readonly WireRegistryEntry[];
  registryDigest: string;
  snapshotRegistryDigest: string;
  libraries: readonly WireLibrary[];
  identityEpoch: number;
  issuedQuids: readonly string[];
}>;

export function encode_ssr_bootstrap(
  bootstrap: DocumentLiveMapCapture<"document">,
  options?: SsrBootstrapCodecOptions,
): EncodedSsrBootstrap<"document">;
export function encode_ssr_bootstrap(
  bootstrap: HostedDocumentBootstrap,
  options?: SsrBootstrapCodecOptions,
): EncodedSsrBootstrap<"hosted-document">;
export function encode_ssr_bootstrap(
  bootstrap: HostedLiveMapLibrariesSnapshot,
  options?: SsrBootstrapCodecOptions,
): EncodedSsrBootstrap<"hosted-libraries">;
export function encode_ssr_bootstrap(
  bootstrap: LiveMapLibrariesSnapshot,
  options?: SsrBootstrapCodecOptions,
): EncodedSsrBootstrap<"libraries">;
export function encode_ssr_bootstrap(
  bootstrap: DocumentLiveMapCapture<"document"> | HostedDocumentBootstrap | LiveMapLibrariesSnapshot | HostedLiveMapLibrariesSnapshot,
  options?: SsrBootstrapCodecOptions,
): EncodedSsrBootstrap {
  const maximum = max_encoded_bytes(options, "encode");
  try {
    const normalized = normalize_bootstrap(bootstrap);
    const json = canonical_json({
      format: FORMAT,
      version: VERSION,
      kind: normalized.kind,
      payload: normalized.payload,
    });
    const bytes = encoder.encode(json);
    if (base64url_length(bytes.length) > maximum) throw error("encode", "SSR_BOOTSTRAP_TOO_LARGE", "SSR bootstrap exceeds the encoded-size limit.");
    const encoded = encode_base64url(bytes);
    return encoded as EncodedSsrBootstrap;
  } catch (cause) {
    if (cause instanceof SsrBootstrapEncodingError) throw cause;
    throw error("encode", "SSR_BOOTSTRAP_INPUT_INVALID", "SSR bootstrap input is invalid.", cause);
  }
}

export function decode_ssr_bootstrap<TKind extends SsrBootstrapKind>(
  encoded: EncodedSsrBootstrap<TKind>,
  options?: SsrBootstrapCodecOptions,
): Extract<DecodedSsrBootstrap, { kind: TKind }>;
export function decode_ssr_bootstrap(
  encoded: string,
  options?: SsrBootstrapCodecOptions,
): DecodedSsrBootstrap;
export function decode_ssr_bootstrap(
  encoded: string,
  options?: SsrBootstrapCodecOptions,
): DecodedSsrBootstrap {
  const maximum = max_encoded_bytes(options, "decode");
  if (typeof encoded !== "string") throw error("decode", "SSR_BOOTSTRAP_MALFORMED", "Encoded SSR bootstrap must be a string.");
  if (encoded.length > maximum) throw error("decode", "SSR_BOOTSTRAP_TOO_LARGE", "Encoded SSR bootstrap exceeds the size limit.");
  if (!/^[A-Za-z0-9_-]*$/.test(encoded) || encoded.includes("=") || encoded.length % 4 === 1) {
    throw error("decode", "SSR_BOOTSTRAP_MALFORMED", "Encoded SSR bootstrap is not strict unpadded base64url.");
  }

  let bytes: Uint8Array;
  let json: string;
  try {
    bytes = decode_base64url(encoded);
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw error("decode", "SSR_BOOTSTRAP_MALFORMED", "Encoded SSR bootstrap bytes are malformed.", cause);
  }
  if (!base64url_equals(bytes, encoded)) {
    throw error("decode", "SSR_BOOTSTRAP_NON_CANONICAL", "SSR bootstrap encoding is not canonical.");
  }

  try {
    parse_ordered_json_text(json);
  } catch (cause) {
    throw error("decode", "SSR_BOOTSTRAP_MALFORMED", "SSR bootstrap JSON is malformed or contains duplicate fields.", cause);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(json); }
  catch (cause) { throw error("decode", "SSR_BOOTSTRAP_MALFORMED", "SSR bootstrap JSON is malformed.", cause); }

  let envelope: Record<string, unknown>;
  try {
    envelope = record(parsed);
    exact_keys(envelope, ["format", "version", "kind", "payload"]);
  } catch (cause) {
    throw error("decode", "SSR_BOOTSTRAP_PAYLOAD_INVALID", "SSR bootstrap envelope fields are invalid.", cause);
  }
  if (envelope.format !== FORMAT) throw error("decode", "SSR_BOOTSTRAP_FORMAT_UNSUPPORTED", "SSR bootstrap format is unsupported.");
  if (envelope.version !== VERSION) throw error("decode", "SSR_BOOTSTRAP_VERSION_UNSUPPORTED", "SSR bootstrap version is unsupported.");
  if (!is_kind(envelope.kind)) throw error("decode", "SSR_BOOTSTRAP_KIND_UNSUPPORTED", "SSR bootstrap kind is unsupported.");

  let decoded: DecodedSsrBootstrap;
  try { decoded = decode_payload(envelope.kind, envelope.payload); }
  catch (cause) {
    if (cause instanceof SsrBootstrapEncodingError) throw cause;
    throw error("decode", "SSR_BOOTSTRAP_PAYLOAD_INVALID", "SSR bootstrap payload is invalid.", cause);
  }
  let canonical: boolean;
  try {
    const normalized = normalize_bootstrap(decoded.bootstrap);
    const comparison = compare_canonical_json({
      format: FORMAT,
      version: VERSION,
      kind: normalized.kind,
      payload: normalized.payload,
    }, bytes);
    if (base64url_length(comparison.utf8Bytes) > maximum) throw new TypeError("Canonical SSR bootstrap exceeds the encoded-size limit.");
    canonical = comparison.equal;
  }
  catch (cause) { throw error("decode", "SSR_BOOTSTRAP_PAYLOAD_INVALID", "SSR bootstrap payload is invalid.", cause); }
  if (!canonical) throw error("decode", "SSR_BOOTSTRAP_NON_CANONICAL", "SSR bootstrap encoding is not canonical.");
  return decoded;
}

function normalize_bootstrap(bootstrap: unknown): Readonly<{ kind: SsrBootstrapKind; payload: unknown }> {
  if (!is_record(bootstrap)) throw new TypeError("Bootstrap must be an object.");
  if (bootstrap.kind === "hson-document") {
    const viewState = encode_view_state_snapshot(bootstrap as DocumentLiveMapCapture<"document">);
    return { kind: "document", payload: { viewStateFormat: viewState.format, viewStatePayload: viewState.payload } };
  }
  if (bootstrap.format === "hson-livemap-libraries-snapshot") {
    if (Object.hasOwn(bootstrap, "authority")) {
      const hosted = bootstrap as HostedLiveMapLibrariesSnapshot;
      assert_hosted_libraries_snapshot_shape(hosted);
      assert_libraries_snapshot_bound(hosted);
      if (typeof hosted.authority.logicalMapId !== "string" || typeof hosted.authority.incarnationId !== "string") {
        throw new TypeError("Hosted Libraries authority is malformed.");
      }
      const payload = libraries_payload(hosted);
      return { kind: "hosted-libraries", payload: {
        logicalMapId: hosted.authority.logicalMapId,
        incarnationId: hosted.authority.incarnationId,
        ...payload,
      } };
    }
    const local = bootstrap as LiveMapLibrariesSnapshot;
    assert_libraries_snapshot_shape(local);
    assert_libraries_snapshot_bound(local);
    return { kind: "libraries", payload: libraries_payload(local) };
  }
  if (Object.hasOwn(bootstrap, "hson")) {
    exact_keys(bootstrap, ["logicalMapId", "incarnationId", "rev", "mode", "hson"]);
    if (typeof bootstrap.logicalMapId !== "string" || typeof bootstrap.incarnationId !== "string"
      || !safe_nonnegative_integer(bootstrap.rev) || bootstrap.mode !== "document" || typeof bootstrap.hson !== "string") {
      throw new TypeError("Hosted document bootstrap is malformed.");
    }
    return { kind: "hosted-document", payload: {
      logicalMapId: bootstrap.logicalMapId,
      incarnationId: bootstrap.incarnationId,
      revision: bootstrap.rev,
      mode: bootstrap.mode,
      hson: bootstrap.hson,
    } };
  }
  throw new TypeError("Bootstrap family is unsupported.");
}

function libraries_payload(snapshot: LiveMapLibrariesSnapshot): LibrariesPayload {
  if (snapshot.format !== "hson-livemap-libraries-snapshot" || snapshot.registry.format !== "hson-hosted-registry"
    || !safe_nonnegative_integer(snapshot.revision) || !safe_nonnegative_integer(snapshot.identity.epoch)
    || snapshot.identity.issuedQuids.some((value) => typeof value !== "string")) throw new TypeError("Libraries scalar fields are malformed.");
  return {
    snapshotFormat: snapshot.format,
    revision: snapshot.revision,
    registryFormat: snapshot.registry.format,
    registry: snapshot.registry.libraries.map((entry) => ({
      name: require_string(entry.name),
      scope: entry.scope ?? null,
      mode: require_mode(entry.mode),
      schema: require_string(entry.schema),
      schemaDigest: require_string(entry.schemaDigest),
      rootCodec: require_root_format(entry.rootCodec),
    })),
    registryDigest: require_string(snapshot.registry.digest),
    snapshotRegistryDigest: require_string(snapshot.registryDigest),
    libraries: snapshot.libraries.map((entry) => ({
      name: require_string(entry.name),
      mode: require_mode(entry.mode),
      schema: require_string(entry.schema),
      schemaDigest: require_string(entry.schemaDigest),
      rootFormat: require_root_format(entry.root.format),
      rootPayload: require_string(entry.root.payload),
    })),
    identityEpoch: snapshot.identity.epoch,
    issuedQuids: [...snapshot.identity.issuedQuids],
  };
}

function decode_payload(kind: SsrBootstrapKind, input: unknown): DecodedSsrBootstrap {
  if (kind === "document") {
    const payload = record(input); exact_keys(payload, ["viewStateFormat", "viewStatePayload"]);
    if (payload.viewStateFormat !== "view-state" || typeof payload.viewStatePayload !== "string") throw new TypeError("Document payload is malformed.");
    const bootstrap = decode_view_state_snapshot({ format: "view-state", payload: payload.viewStatePayload });
    if (bootstrap.mode !== "document") throw new TypeError("Document payload mode is malformed.");
    return Object.freeze({ kind, bootstrap: bootstrap as DocumentLiveMapCapture<"document"> });
  }
  if (kind === "hosted-document") {
    const payload = record(input); exact_keys(payload, ["logicalMapId", "incarnationId", "revision", "mode", "hson"]);
    if (typeof payload.logicalMapId !== "string" || typeof payload.incarnationId !== "string"
      || !safe_nonnegative_integer(payload.revision) || payload.mode !== "document" || typeof payload.hson !== "string") throw new TypeError("Hosted document payload is malformed.");
    const bootstrap: HostedDocumentBootstrap = Object.freeze({
      logicalMapId: payload.logicalMapId, incarnationId: payload.incarnationId,
      rev: payload.revision, mode: "document", hson: payload.hson,
    });
    return Object.freeze({ kind, bootstrap });
  }
  const hosted = kind === "hosted-libraries";
  const payload = record(input);
  exact_keys(payload, hosted
    ? ["logicalMapId", "incarnationId", "snapshotFormat", "revision", "registryFormat", "registry", "registryDigest", "snapshotRegistryDigest", "libraries", "identityEpoch", "issuedQuids"]
    : ["snapshotFormat", "revision", "registryFormat", "registry", "registryDigest", "snapshotRegistryDigest", "libraries", "identityEpoch", "issuedQuids"]);
  if (payload.snapshotFormat !== "hson-livemap-libraries-snapshot" || payload.registryFormat !== "hson-hosted-registry"
    || !safe_nonnegative_integer(payload.revision) || !safe_nonnegative_integer(payload.identityEpoch)
    || !Array.isArray(payload.registry) || !Array.isArray(payload.libraries) || !Array.isArray(payload.issuedQuids)
    || typeof payload.registryDigest !== "string" || typeof payload.snapshotRegistryDigest !== "string"
    || payload.issuedQuids.some((item) => typeof item !== "string")) throw new TypeError("Libraries payload is malformed.");
  const registryEntries = payload.registry.map(decode_registry_entry);
  const libraryEntries = payload.libraries.map(decode_library_entry);
  const local: LiveMapLibrariesSnapshot = Object.freeze({
    format: "hson-livemap-libraries-snapshot", revision: payload.revision,
    registry: Object.freeze({ format: "hson-hosted-registry", libraries: Object.freeze(registryEntries), digest: payload.registryDigest }),
    registryDigest: payload.snapshotRegistryDigest, libraries: Object.freeze(libraryEntries),
    identity: Object.freeze({ epoch: payload.identityEpoch, issuedQuids: Object.freeze([...payload.issuedQuids]) }),
  });
  if (!hosted) { assert_libraries_snapshot_shape(local); return Object.freeze({ kind, bootstrap: local }); }
  if (typeof payload.logicalMapId !== "string" || typeof payload.incarnationId !== "string") throw new TypeError("Hosted Libraries authority is malformed.");
  const bootstrap: HostedLiveMapLibrariesSnapshot = Object.freeze({
    ...local,
    authority: Object.freeze({ logicalMapId: payload.logicalMapId, incarnationId: payload.incarnationId }),
  });
  assert_hosted_libraries_snapshot_shape(bootstrap);
  return Object.freeze({ kind, bootstrap });
}

function decode_registry_entry(input: unknown): LiveMapLibrariesSnapshot["registry"]["libraries"][number] {
  const entry = record(input); exact_keys(entry, ["name", "scope", "mode", "schema", "schemaDigest", "rootCodec"]);
  if (typeof entry.name !== "string" || (entry.scope !== null && entry.scope !== "hson-internal")
    || !is_mode(entry.mode) || typeof entry.schema !== "string" || typeof entry.schemaDigest !== "string"
    || entry.rootCodec !== "hson-exact-value") throw new TypeError("Registry entry is malformed.");
  return Object.freeze(entry.scope === null
    ? { name: entry.name, mode: entry.mode, schema: decoded_schema(entry.schema), schemaDigest: entry.schemaDigest, rootCodec: entry.rootCodec }
    : { name: entry.name, scope: entry.scope, mode: entry.mode, schema: decoded_schema(entry.schema), schemaDigest: entry.schemaDigest, rootCodec: entry.rootCodec });
}

function decode_library_entry(input: unknown): LiveMapLibrariesSnapshot["libraries"][number] {
  const entry = record(input); exact_keys(entry, ["name", "mode", "schema", "schemaDigest", "rootFormat", "rootPayload"]);
  if (typeof entry.name !== "string" || !is_mode(entry.mode) || typeof entry.schema !== "string"
    || typeof entry.schemaDigest !== "string" || entry.rootFormat !== "hson-exact-value" || typeof entry.rootPayload !== "string") throw new TypeError("Library entry is malformed.");
  return Object.freeze({ name: entry.name, mode: entry.mode, schema: decoded_schema(entry.schema), schemaDigest: entry.schemaDigest,
    root: Object.freeze({ format: entry.rootFormat, payload: entry.rootPayload }) });
}

function canonical_json(value: unknown): string {
  const writer = new BoundedStringWriter();
  emit_canonical_json(value, (fragment) => writer.write(fragment));
  return writer.finish();
}

function emit_canonical_json(value: unknown, write: (fragment: string) => void): void {
  if (value === null) { write("null"); return; }
  if (typeof value === "string") { emit_quoted_string(value, write); return; }
  if (typeof value === "boolean") { write(value ? "true" : "false"); return; }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Wire number must be finite.");
    write(Object.is(value, -0) ? "-0" : String(value));
    return;
  }
  if (Array.isArray(value)) {
    write("[");
    for (let index = 0; index < value.length; index += 1) {
      if (index !== 0) write(",");
      emit_canonical_json(value[index], write);
    }
    write("]");
    return;
  }
  if (!is_record(value)) throw new TypeError("Wire value is unsupported.");
  write("{");
  const keys = Object.keys(value);
  for (let index = 0; index < keys.length; index += 1) {
    if (index !== 0) write(",");
    const key = keys[index]!;
    emit_quoted_string(key, write);
    write(":");
    emit_canonical_json(value[key], write);
  }
  write("}");
}

function emit_quoted_string(value: string, write: (fragment: string) => void): void {
  write(`"`);
  let spanStart = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    let escape: string | undefined;
    if (code === 0x22) escape = `\\"`;
    else if (code === 0x5c) escape = `\\\\`;
    else if (code === 0x08) escape = `\\b`;
    else if (code === 0x09) escape = `\\t`;
    else if (code === 0x0a) escape = `\\n`;
    else if (code === 0x0c) escape = `\\f`;
    else if (code === 0x0d) escape = `\\r`;
    else if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff
      && !(code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff))) {
      escape = `\\u${code.toString(16).padStart(4, "0")}`;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      index += 1;
    }
    if (escape !== undefined) {
      write(value.slice(spanStart, index));
      write(escape);
      spanStart = index + 1;
    }
  }
  write(value.slice(spanStart));
  write(`"`);
}

function encode_base64url(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += BASE64URL_INPUT_CHUNK_BYTES) {
    const end = Math.min(start + BASE64URL_INPUT_CHUNK_BYTES, bytes.length);
    const output = new Uint8Array(base64url_length(end - start));
    let offset = 0;
    for (let index = start; index < end; index += 3) {
      const a = bytes[index]!;
      const b = index + 1 < end ? bytes[index + 1]! : 0;
      const c = index + 2 < end ? bytes[index + 2]! : 0;
      output[offset++] = BASE64URL.charCodeAt(a >>> 2);
      output[offset++] = BASE64URL.charCodeAt(((a & 3) << 4) | (b >>> 4));
      if (index + 1 < end) output[offset++] = BASE64URL.charCodeAt(((b & 15) << 2) | (c >>> 6));
      if (index + 2 < end) output[offset++] = BASE64URL.charCodeAt(c & 63);
    }
    // This input quantum is divisible by three, so only the final chunk can
    // carry a remainder. Conversion is bounded and never spreads an array.
    chunks.push(asciiDecoder.decode(output));
  }
  return chunks.join("");
}

function base64url_equals(bytes: Uint8Array, expected: string): boolean {
  if (expected.length !== base64url_length(bytes.length)) return false;
  let offset = 0;
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = index + 1 < bytes.length ? bytes[index + 1]! : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2]! : 0;
    if (expected.charCodeAt(offset++) !== BASE64URL.charCodeAt(a >>> 2)
      || expected.charCodeAt(offset++) !== BASE64URL.charCodeAt(((a & 3) << 4) | (b >>> 4))) return false;
    if (index + 1 < bytes.length && expected.charCodeAt(offset++) !== BASE64URL.charCodeAt(((b & 15) << 2) | (c >>> 6))) return false;
    if (index + 2 < bytes.length && expected.charCodeAt(offset++) !== BASE64URL.charCodeAt(c & 63)) return false;
  }
  return true;
}

function base64url_length(byteLength: number): number {
  return Math.ceil(byteLength * 4 / 3);
}

function compare_canonical_json(value: unknown, expected: Uint8Array): Readonly<{ equal: boolean; utf8Bytes: number }> {
  let equal = true;
  let offset = 0;
  const writeByte = (byte: number): void => {
    if (equal && expected[offset] !== byte) equal = false;
    offset += 1;
  };
  emit_canonical_json(value, (fragment) => {
    for (let index = 0; index < fragment.length; index += 1) {
      const code = fragment.charCodeAt(index);
      if (code <= 0x7f) writeByte(code);
      else if (code <= 0x7ff) {
        writeByte(0xc0 | (code >>> 6));
        writeByte(0x80 | (code & 0x3f));
      } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < fragment.length
        && fragment.charCodeAt(index + 1) >= 0xdc00 && fragment.charCodeAt(index + 1) <= 0xdfff) {
        const point = 0x10000 + ((code - 0xd800) << 10) + (fragment.charCodeAt(index + 1) - 0xdc00);
        writeByte(0xf0 | (point >>> 18));
        writeByte(0x80 | ((point >>> 12) & 0x3f));
        writeByte(0x80 | ((point >>> 6) & 0x3f));
        writeByte(0x80 | (point & 0x3f));
        index += 1;
      } else {
        writeByte(0xe0 | (code >>> 12));
        writeByte(0x80 | ((code >>> 6) & 0x3f));
        writeByte(0x80 | (code & 0x3f));
      }
    }
  });
  return { equal: equal && offset === expected.length, utf8Bytes: offset };
}

function decode_base64url(value: string): Uint8Array {
  const length = Math.floor(value.length * 3 / 4);
  const output = new Uint8Array(length);
  let offset = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64URL.indexOf(value[index]!); const b = BASE64URL.indexOf(value[index + 1]!);
    const c = index + 2 < value.length ? BASE64URL.indexOf(value[index + 2]!) : 0;
    const d = index + 3 < value.length ? BASE64URL.indexOf(value[index + 3]!) : 0;
    output[offset++] = (a << 2) | (b >>> 4);
    if (offset < length + 1 && index + 2 < value.length) output[offset++] = ((b & 15) << 4) | (c >>> 2);
    if (index + 3 < value.length) output[offset++] = ((c & 3) << 6) | d;
  }
  return output;
}

function max_encoded_bytes(options: SsrBootstrapCodecOptions | undefined, phase: "encode" | "decode"): number {
  if (options === undefined) return DEFAULT_MAX_ENCODED_BYTES;
  if (!is_record(options) || Object.keys(options).some((key) => key !== "maxEncodedBytes")) {
    throw error(phase, "SSR_BOOTSTRAP_INPUT_INVALID", "SSR bootstrap codec options are invalid.");
  }
  const value = options.maxEncodedBytes;
  if (value === undefined) return DEFAULT_MAX_ENCODED_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) throw error(phase, "SSR_BOOTSTRAP_INPUT_INVALID", "maxEncodedBytes must be a positive safe integer.");
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!is_record(value)) throw new TypeError("Expected an object.");
  return value;
}
function is_record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exact_keys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) throw new TypeError("Object fields are not exact.");
}
function safe_nonnegative_integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function is_mode(value: unknown): value is LiveMapRootMode { return value === "document" || value === "data-object" || value === "data-array"; }
function require_mode(value: unknown): LiveMapRootMode { if (!is_mode(value)) throw new TypeError("Root mode is malformed."); return value; }
function require_string(value: unknown): string { if (typeof value !== "string") throw new TypeError("String field is malformed."); return value; }
function require_root_format(value: unknown): "hson-exact-value" { if (value !== "hson-exact-value") throw new TypeError("Root codec is malformed."); return value; }
function decoded_schema(value: string): HsonSchema { return value as HsonSchema; }
function is_kind(value: unknown): value is SsrBootstrapKind { return value === "document" || value === "hosted-document" || value === "libraries" || value === "hosted-libraries"; }
function error(phase: "encode" | "decode", code: ConstructorParameters<typeof SsrBootstrapEncodingError>[1], message: string, cause?: unknown): SsrBootstrapEncodingError {
  return new SsrBootstrapEncodingError(phase, code, message, cause);
}
