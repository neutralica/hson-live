import { encode_ssr_bootstrap, decode_ssr_bootstrap, encode_base64url, decode_base64url, base64url_equals } from "../ssr/ssr-bootstrap.js";
import type { LocusSessionNow } from "../../types/locus.core.types.js";

// Delivery is bounded below the ordinary composition character cap, on both sides.
export const MAX_IGNITION_BYTES = 3_000_000;
export const SCOUT_LOADER_ATTRIBUTE = "data-hson-scout-loader";

export function ignition_path(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048
    || !/^\/(?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\/)*[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/.test(value)) {
    throw new TypeError("Scout requires an unambiguous origin-relative HTTP path.");
  }
  return value;
}

function credential(value: unknown): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 512 || /[^\x21-\x7e]/.test(value)) {
    throw new TypeError("Scout session credential is malformed.");
  }
  return value;
}

function selected(now: LocusSessionNow, document: unknown): string {
  if (typeof document !== "string" || !now.libs.libraries.some(entry => entry.name === document && entry.mode === "document")) {
    throw new TypeError("Scout requires a selected authorized Document.");
  }
  return document;
}

/** Private wire contract: canonical JSON, strict UTF-8 and unpadded base64url. */
export function encode_ignition(now: LocusSessionNow, document: string, token: string, endpoint: string): string {
  const record = { version: 1, state: encode_ssr_bootstrap(now, { maxEncodedBytes: 2_200_000 }),
    document: selected(now, document), credential: credential(token), endpoint: ignition_path(endpoint) };
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  if (Math.ceil(bytes.length * 4 / 3) > MAX_IGNITION_BYTES) throw new RangeError("Scout ignition exceeds the delivery limit.");
  return encode_base64url(bytes);
}

export function decode_ignition(payload: string | undefined): Readonly<{ now: LocusSessionNow; document: string; credential: string; endpoint: string }> {
  if (typeof payload !== "string" || payload.length > MAX_IGNITION_BYTES || payload.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(payload)) {
    throw new TypeError("Scout ignition encoding is invalid or exceeds the delivery limit.");
  }
  const bytes = decode_base64url(payload);
  if (!base64url_equals(bytes, payload) || bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new TypeError("Noncanonical Scout encoding.");
  const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || !("version" in value) || value.version !== 1 || !("state" in value) || typeof value.state !== "string"
    || !("document" in value) || !("credential" in value) || !("endpoint" in value)) throw new TypeError("Invalid Scout ignition record.");
  const token = credential(value.credential), endpoint = ignition_path(value.endpoint);
  // Exact canonical text rejects duplicate, unknown, reordered and escaped fields.
  if (json !== JSON.stringify({ version: 1, state: value.state, document: value.document, credential: token, endpoint })) {
    throw new TypeError("Noncanonical Scout ignition record.");
  }
  const decoded = decode_ssr_bootstrap(value.state, { maxEncodedBytes: 2_200_000 });
  if (decoded.kind !== "hosted-projection") throw new TypeError("Scout requires hosted state.");
  return Object.freeze({ now: decoded.bootstrap, document: selected(decoded.bootstrap, value.document), credential: token, endpoint });
}
