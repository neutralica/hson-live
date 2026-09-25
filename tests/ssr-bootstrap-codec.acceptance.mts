import assert from "node:assert/strict";
import {
  Hson, decode_ssr_bootstrap, encode_ssr_bootstrap, hsonLiveMap,
  SsrBootstrapCodecError, render_document,
} from "../src/index.ts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const utf8 = new TextEncoder();
const base64url = (bytes: Uint8Array): string => {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!; const b = bytes[index + 1]; const c = bytes[index + 2];
    output += alphabet[a >>> 2]! + alphabet[((a & 3) << 4) | ((b ?? 0) >>> 4)]!;
    if (b !== undefined) output += alphabet[((b & 15) << 2) | ((c ?? 0) >>> 6)]!;
    if (c !== undefined) output += alphabet[c & 63]!;
  }
  return output;
};
const encodeText = (value: string): string => base64url(utf8.encode(value));
const decodeText = (value: string): string => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 4) {
    const a = alphabet.indexOf(value[index]!); const b = alphabet.indexOf(value[index + 1]!);
    const c = index + 2 < value.length ? alphabet.indexOf(value[index + 2]!) : 0;
    const d = index + 3 < value.length ? alphabet.indexOf(value[index + 3]!) : 0;
    bytes.push((a << 2) | (b >>> 4));
    if (index + 2 < value.length) bytes.push(((b & 15) << 4) | (c >>> 2));
    if (index + 3 < value.length) bytes.push(((c & 3) << 6) | d);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
};
const expectCode = (value: string, code: SsrBootstrapCodecError["code"]): void => {
  assert.throws(() => decode_ssr_bootstrap(value), (cause) => cause instanceof SsrBootstrapCodecError
    && cause.phase === "decode" && cause.code === code);
};

const DataSchema = Hson.schema`<type "data" content <value "number">>`;
const PageSchema = Hson.schema`<type "document" tag "main" content "string">`;
const map = hsonLiveMap.fromLibraries({
  state: { data: { value: -0 }, schema: DataSchema },
  page: { document: `<main "ready"/>`, schema: PageSchema },
});
const bootstrap = render_document({ map, document: "page" }).bootstrap;
const encoded = encode_ssr_bootstrap(bootstrap);
assert.match(encoded, /^[A-Za-z0-9_-]+$/);
assert.equal(encoded.includes("="), false);
assert.equal(encode_ssr_bootstrap(bootstrap), encoded);
const decoded = decode_ssr_bootstrap(encoded);
assert.equal(decoded.kind, "libraries");
if (decoded.kind !== "libraries") throw new Error("Expected Libraries bootstrap.");
assert.deepEqual(decoded.bootstrap, bootstrap);
assert.deepEqual(install_libraries_snapshot(decoded.bootstrap).map.capture(), bootstrap);
assert.equal(decoded.bootstrap.revision, 0);
assert.equal(decoded.bootstrap.libraries.length, 2);
const installedState = install_libraries_snapshot(decoded.bootstrap).map.lib("state");
if (installedState.mode === "document") throw new Error("Expected data library.");
assert.equal(Object.is((installedState.snap() as { value: number }).value, -0), true);

const canonicalJson = decodeText(encoded);
const parsed = JSON.parse(canonicalJson) as Record<string, unknown>;
assert.equal(canonicalJson.includes("identityEpoch"), false);
assert.equal(canonicalJson.includes("issuedQuids"), false);
expectCode(encodeText(` ${canonicalJson}`), "SSR_BOOTSTRAP_NON_CANONICAL");
expectCode(encodeText(canonicalJson.replace('"format"', '"\\u0066ormat"')), "SSR_BOOTSTRAP_NON_CANONICAL");
expectCode(encodeText(canonicalJson.replace('{', '{"format":"duplicate",')), "SSR_BOOTSTRAP_MALFORMED");
expectCode(encoded + "=", "SSR_BOOTSTRAP_MALFORMED");
expectCode(encoded + " ", "SSR_BOOTSTRAP_MALFORMED");
expectCode("A", "SSR_BOOTSTRAP_MALFORMED");
expectCode(base64url(new Uint8Array([0xff])), "SSR_BOOTSTRAP_MALFORMED");
expectCode(encodeText("{"), "SSR_BOOTSTRAP_MALFORMED");
expectCode(encodeText(JSON.stringify({ ...parsed, format: "wrong" })), "SSR_BOOTSTRAP_FORMAT_UNSUPPORTED");
expectCode(encodeText(JSON.stringify({ ...parsed, version: 4 })), "SSR_BOOTSTRAP_VERSION_UNSUPPORTED");
expectCode(encodeText(JSON.stringify({ ...parsed, kind: "wrong" })), "SSR_BOOTSTRAP_KIND_UNSUPPORTED");
const { payload: _missing, ...missing } = parsed;
expectCode(encodeText(JSON.stringify(missing)), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
expectCode(encodeText(JSON.stringify({ ...parsed, extra: true })), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
expectCode(encodeText(JSON.stringify({ ...parsed, payload: [] })), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
assert.throws(() => decode_ssr_bootstrap(encoded, { maxEncodedBytes: encoded.length - 1 }),
  (cause) => cause instanceof SsrBootstrapCodecError && cause.code === "SSR_BOOTSTRAP_TOO_LARGE");
assert.throws(() => encode_ssr_bootstrap(bootstrap, { maxEncodedBytes: encoded.length - 1 }),
  (cause) => cause instanceof SsrBootstrapCodecError && cause.code === "SSR_BOOTSTRAP_TOO_LARGE");

// Removed solo and complete-hosted formats cannot be encoded as local SSR state.
const oldSolo = { kind: "hson-document", mode: "document", rev: 0, root: map.lib("page").root() };
// @ts-expect-error Solo document captures are not SSR bootstrap input.
assert.throws(() => encode_ssr_bootstrap(oldSolo), (cause) => cause instanceof SsrBootstrapCodecError && cause.code === "SSR_BOOTSTRAP_INPUT_INVALID");

process.stdout.write("SSR bootstrap codec acceptance passed.\n");
