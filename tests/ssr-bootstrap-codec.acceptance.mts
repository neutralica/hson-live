import { test_public_exposure } from "./helpers/hosted-exposure.mts";
import assert from "node:assert/strict";
import {
  Hson,
  decode_ssr_bootstrap,
  encode_ssr_bootstrap,
  hsonLiveMap,
  hsonLocus,
  render_document,
  render_hosted_document,
  SsrBootstrapCodecError,
  type HsonSchema,
} from "../src/index.ts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";
import { encode_view_state_snapshot } from "../src/api/livemap/livemap.document.view-state-codec.ts";
import { make_classified_livemap } from "../src/api/livemap/livemap.core.ts";

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
    && cause.phase === "decode" && cause.code === code && !cause.message.includes(value));
};
const expectReject = (value: string): void => {
  assert.throws(() => decode_ssr_bootstrap(value), (cause) => cause instanceof SsrBootstrapCodecError
    && cause.phase === "decode" && !cause.message.includes(value));
};

const style = Object.create(null) as Record<string, unknown>;
for (const [name, value] of [
  ["constructor", ""], ["prototype", "line\r\n雪"], ["10", -0], ["2", { value: 2, unit: undefined }],
] as const) Object.defineProperty(style, name, { value, enumerable: true, writable: true, configurable: true });
const localMap = make_classified_livemap({
  $_tag: "_hson_root",
  $_content: [{
    $_tag: "main",
    $_attrs: { style: style as never },
    $_content: [{ $_tag: "_hson_elem", $_content: [
      { $_tag: "_hson_str", $_content: ["text\ud800\udc00\ud800X\udfff"] },
      { $_tag: "span", $_meta: { quid: "000009901" }, $_content: [] },
    ] }],
  }],
});
if (localMap.mode !== "document") throw new Error("Local fixture must be a document map.");
const localBootstrap = localMap.capture({ identity: "strip" });
const encodedLocal = encode_ssr_bootstrap(localBootstrap);
assert.equal(decodeText(encodedLocal).includes("000009901"), false);
assert.equal(decodeText(encode_ssr_bootstrap(localMap.capture())).includes("000009901"), false);
assert.match(encodedLocal, /^[A-Za-z0-9_-]+$/);
assert.equal(encodedLocal.includes("="), false);
assert.equal(encode_ssr_bootstrap(localBootstrap), encodedLocal);
const decodedLocal = decode_ssr_bootstrap(encodedLocal);
assert.equal(decodedLocal.kind, "document");
if (decodedLocal.kind !== "document") throw new Error("Wrong local kind.");
assert.deepEqual(decodedLocal.bootstrap, localBootstrap);
const localInstalled = make_classified_livemap(decodedLocal.bootstrap.root);
if (localInstalled.mode !== "document") throw new Error("Decoded local map must be a document.");
localInstalled.restore(decodedLocal.bootstrap, { identity: "strip" });
assert.deepEqual(localInstalled.capture({ identity: "strip" }), localBootstrap);
const decodedRootElement = decodedLocal.bootstrap.root.$_content[0];
if (typeof decodedRootElement !== "object" || decodedRootElement === null) throw new Error("Decoded root element is missing.");
const decodedStyle = decodedRootElement.$_attrs?.style as Record<string, unknown>;
const typed = decodedStyle["2"] as Record<string, unknown>;
assert.equal(Object.hasOwn(typed, "unit"), true);
assert.equal(typed.unit, undefined);
assert.equal(Object.is(decodedStyle["10"], -0), true);
const decodedElementWrapper = decodedRootElement.$_content[0];
if (typeof decodedElementWrapper !== "object" || decodedElementWrapper === null) throw new Error("Decoded element wrapper is missing.");
assert.equal((decodedElementWrapper.$_content[0] as { $_content: unknown[] }).$_content[0], "text\ud800\udc00\ud800X\udfff");

// The version-two hosted document family is retired; local version-two vectors remain valid.
const legacyHosted = { logicalMapId: "wire-map", incarnationId: "wire-incarnation", rev: 0,
  mode: "document" as const, format: "hson-client-snapshot-v1" as const, payload: '<main/>' };
// @ts-expect-error Retired complete hosted document state is not an encoder input.
assert.throws(() => encode_ssr_bootstrap(legacyHosted),
  (cause) => cause instanceof SsrBootstrapCodecError && cause.code === "SSR_BOOTSTRAP_INPUT_INVALID");
expectCode(encodeText(JSON.stringify({ format: "hson-ssr-bootstrap", version: 2, kind: "hosted-document",
  payload: { logicalMapId: "wire-map", incarnationId: "wire-incarnation", revision: 0,
    mode: "document", snapshotFormat: "hson-client-snapshot-v1", snapshotPayload: "<main/>" } })),
  "SSR_BOOTSTRAP_KIND_UNSUPPORTED");

const DataSchema: HsonSchema = Hson.schema`<type "data" content <value "number">>`;
const DocumentSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "empty">`;
const inputs = Object.create(null) as Record<string, { data: { value: number }; schema: HsonSchema } | { document: string; schema: HsonSchema }>;
for (const name of ["__proto__", "constructor", "prototype", "10", "2"]) {
  Object.defineProperty(inputs, name, { value: name === "prototype" ? { document: "<main/>", schema: DocumentSchema } : { data: { value: name === "10" ? -0 : 2 }, schema: DataSchema }, enumerable: true });
}
const librariesMap = hsonLiveMap.fromLibraries(inputs);
const librariesBootstrap = render_document({ map: librariesMap, document: "prototype" }).bootstrap;
const encodedLibraries = encode_ssr_bootstrap(librariesBootstrap);
const localLibrariesWire = JSON.parse(decodeText(encodedLibraries)) as { payload: Record<string, unknown> };
assert.equal(Object.hasOwn(localLibrariesWire.payload, "identityEpoch"), false);
assert.equal(Object.hasOwn(localLibrariesWire.payload, "issuedQuids"), false);
expectCode(encodeText(JSON.stringify({ ...localLibrariesWire, payload: { ...localLibrariesWire.payload, identityEpoch: 0, issuedQuids: [] } })), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
const decodedLibraries = decode_ssr_bootstrap(encodedLibraries);
assert.equal(decodedLibraries.kind, "libraries");
if (decodedLibraries.kind !== "libraries") throw new Error("Wrong Libraries kind.");
assert.deepEqual(decodedLibraries.bootstrap, librariesBootstrap);
assert.deepEqual(install_libraries_snapshot(decodedLibraries.bootstrap).map.capture(), librariesBootstrap);
assert.deepEqual(decodedLibraries.bootstrap.registry.libraries.map((entry) => entry.name), librariesBootstrap.registry.libraries.map((entry) => entry.name));

// Legacy hosted Libraries bootstrap is likewise unavailable for encoding.
const legacyHostedLibraries = { ...librariesBootstrap, format: "hson-portable-aggregate-snapshot-v1" as const,
  authority: { logicalMapId: "aggregate-map", incarnationId: "aggregate-incarnation" } };
// @ts-expect-error Retired complete hosted Libraries state is not an encoder input.
assert.throws(() => encode_ssr_bootstrap(legacyHostedLibraries),
  (cause) => cause instanceof SsrBootstrapCodecError && cause.code === "SSR_BOOTSTRAP_INPUT_INVALID");

assert.equal(({} as Record<string, unknown>).polluted, undefined);
assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"), false);

const canonicalJson = decodeText(encodedLocal);
const parsed = JSON.parse(canonicalJson) as Record<string, unknown>;
expectCode(encodeText(` {${canonicalJson.slice(1)}`), "SSR_BOOTSTRAP_NON_CANONICAL");
expectCode(encodeText(JSON.stringify({ kind: parsed.kind, format: parsed.format, version: parsed.version, payload: parsed.payload })), "SSR_BOOTSTRAP_NON_CANONICAL");
expectCode(encodeText(canonicalJson.replace('"format"', '"\\u0066ormat"')), "SSR_BOOTSTRAP_NON_CANONICAL");
expectCode(encodeText(canonicalJson.replace('"version":2', '"version":2e0')), "SSR_BOOTSTRAP_NON_CANONICAL");
expectCode(encodeText(canonicalJson.replace('{', '{"format":"duplicate",')), "SSR_BOOTSTRAP_MALFORMED");
expectCode(encodedLocal + "=", "SSR_BOOTSTRAP_MALFORMED");
const standardBase64 = encodedLocal.replace(/-/g, "+").replace(/_/g, "/");
assert.notEqual(standardBase64, encodedLocal);
expectCode(standardBase64, "SSR_BOOTSTRAP_MALFORMED");
expectCode(encodedLocal + " ", "SSR_BOOTSTRAP_MALFORMED");
expectCode("A", "SSR_BOOTSTRAP_MALFORMED");
expectCode("+w", "SSR_BOOTSTRAP_MALFORMED");
expectCode(base64url(new Uint8Array([0xff])), "SSR_BOOTSTRAP_MALFORMED");
expectCode(base64url(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8.encode(canonicalJson)])), "SSR_BOOTSTRAP_NON_CANONICAL");
expectCode(encodeText("{"), "SSR_BOOTSTRAP_MALFORMED");
expectCode(encodeText(JSON.stringify({ ...parsed, format: "wrong" })), "SSR_BOOTSTRAP_FORMAT_UNSUPPORTED");
expectCode(encodeText(JSON.stringify({ ...parsed, version: 3 })), "SSR_BOOTSTRAP_VERSION_UNSUPPORTED");
expectCode(encodeText(JSON.stringify({ ...parsed, kind: "wrong" })), "SSR_BOOTSTRAP_KIND_UNSUPPORTED");
const { payload: _missing, ...missing } = parsed;
expectCode(encodeText(JSON.stringify(missing)), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
expectCode(encodeText(JSON.stringify({ ...parsed, extra: true })), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
expectCode(encodeText(JSON.stringify({ ...parsed, payload: [] })), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
expectCode(encodeText(canonicalJson.replace('"viewStateFormat"', '"__proto__":{"polluted":true},"viewStateFormat"')), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
expectCode(encodedLocal.slice(0, -4), "SSR_BOOTSTRAP_MALFORMED");
for (const index of [0, 7, Math.floor(encodedLocal.length / 2), encodedLocal.length - 1]) {
  expectReject(`${encodedLocal.slice(0, index)}!${encodedLocal.slice(index + 1)}`);
}
assert.equal(({} as Record<string, unknown>).polluted, undefined);
assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"), false);
assert.throws(() => decode_ssr_bootstrap(encodedLocal, { maxEncodedBytes: encodedLocal.length - 1 }),
  (cause) => cause instanceof SsrBootstrapCodecError && cause.code === "SSR_BOOTSTRAP_TOO_LARGE");
assert.throws(() => encode_ssr_bootstrap(localBootstrap, { maxEncodedBytes: encodedLocal.length - 1 }),
  (cause) => cause instanceof SsrBootstrapCodecError && cause.phase === "encode" && cause.code === "SSR_BOOTSTRAP_TOO_LARGE");
assert.throws(() => encode_ssr_bootstrap(localBootstrap, { maxEncodedBytes: 0 }),
  (cause) => cause instanceof SsrBootstrapCodecError && cause.phase === "encode" && cause.code === "SSR_BOOTSTRAP_INPUT_INVALID");

const malformedExact = structuredClone(parsed) as { payload: { viewStatePayload: string } };
malformedExact.payload.viewStatePayload = "<malformed>";
expectCode(encodeText(JSON.stringify(malformedExact)), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
assert.throws(() => encode_view_state_snapshot({
  kind: "hson-document", mode: "document", rev: 0,
  root: { $_tag: "_hson_root", $_content: [{ $_tag: "main", $_attrs: { title: undefined }, $_content: [] }] },
}), /invalid/i);

process.stdout.write("SSR bootstrap codec acceptance passed.\n");
