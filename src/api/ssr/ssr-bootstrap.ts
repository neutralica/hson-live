import type {
  DocumentLiveMapCapture,
  HostedLiveMapLibrariesSnapshot,
  LiveMapLibrariesSnapshot,
  LiveMapRootMode,
} from "../../types/livemap.types.js";
import type { LocusSnapshotEnvelope } from "../../types/locus.representation.types.js";
import type { HsonSchema } from "../transform/transform.types.js";
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
const encoder = new TextEncoder();

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
    const encoded = encode_base64url(encoder.encode(json));
    if (encoded.length > maximum) throw error("encode", "SSR_BOOTSTRAP_TOO_LARGE", "SSR bootstrap exceeds the encoded-size limit.");
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
  if (encode_base64url(bytes) !== encoded) {
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
  let canonical: string;
  try {
    canonical = decoded.kind === "document"
      ? encode_ssr_bootstrap(decoded.bootstrap, { maxEncodedBytes: maximum })
      : decoded.kind === "hosted-document"
        ? encode_ssr_bootstrap(decoded.bootstrap, { maxEncodedBytes: maximum })
        : decoded.kind === "libraries"
          ? encode_ssr_bootstrap(decoded.bootstrap, { maxEncodedBytes: maximum })
          : encode_ssr_bootstrap(decoded.bootstrap, { maxEncodedBytes: maximum });
  }
  catch (cause) { throw error("decode", "SSR_BOOTSTRAP_PAYLOAD_INVALID", "SSR bootstrap payload is invalid.", cause); }
  if (canonical !== encoded) throw error("decode", "SSR_BOOTSTRAP_NON_CANONICAL", "SSR bootstrap encoding is not canonical.");
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
  if (value === null) return "null";
  if (typeof value === "string") return quote(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Wire number must be finite.");
    return Object.is(value, -0) ? "-0" : String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical_json).join(",")}]`;
  if (!is_record(value)) throw new TypeError("Wire value is unsupported.");
  return `{${Object.keys(value).map((key) => `${quote(key)}:${canonical_json(value[key])}`).join(",")}}`;
}

function quote(value: string): string {
  let output = `"`;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22) output += `\\"`;
    else if (code === 0x5c) output += `\\\\`;
    else if (code === 0x08) output += `\\b`;
    else if (code === 0x09) output += `\\t`;
    else if (code === 0x0a) output += `\\n`;
    else if (code === 0x0c) output += `\\f`;
    else if (code === 0x0d) output += `\\r`;
    else if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff && !(code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff))) {
      output += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      output += value[index];
      if (code >= 0xd800 && code <= 0xdbff) { index += 1; output += value[index]; }
    }
  }
  return `${output}"`;
}

function encode_base64url(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!; const b = bytes[index + 1]; const c = bytes[index + 2];
    parts.push(BASE64URL[a >>> 2]!, BASE64URL[((a & 3) << 4) | ((b ?? 0) >>> 4)]!);
    if (b !== undefined) parts.push(BASE64URL[((b & 15) << 2) | ((c ?? 0) >>> 6)]!);
    if (c !== undefined) parts.push(BASE64URL[c & 63]!);
  }
  return parts.join("");
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
