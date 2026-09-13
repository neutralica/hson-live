import assert from "node:assert/strict";
import {
  Hson,
  decode_ssr_bootstrap,
  encode_ssr_bootstrap,
  hsonLiveMap,
  hsonLocus,
  install_libraries_snapshot,
  install_locus_libraries_snapshot,
  render_document,
  render_hosted_document,
  SsrBootstrapEncodingError,
  type HsonSchema,
} from "../src/index.ts";
import { install_locus_snapshot } from "../src/api/locus/locus.bootstrap.ts";
import { encode_view_state_snapshot } from "../src/api/livemap/livemap.document.view-state-codec.ts";

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
const expectCode = (value: string, code: SsrBootstrapEncodingError["code"]): void => {
  assert.throws(() => decode_ssr_bootstrap(value), (cause) => cause instanceof SsrBootstrapEncodingError
    && cause.phase === "decode" && cause.code === code && !cause.message.includes(value));
};

const style = Object.create(null) as Record<string, unknown>;
for (const [name, value] of [
  ["constructor", ""], ["prototype", "line\r\n雪"], ["10", -0], ["2", { value: 2, unit: undefined }],
] as const) Object.defineProperty(style, name, { value, enumerable: true, writable: true, configurable: true });
const localMap = hsonLiveMap.fromNode({
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
const localBootstrap = localMap.capture();
const encodedLocal = encode_ssr_bootstrap(localBootstrap);
assert.match(encodedLocal, /^[A-Za-z0-9_-]+$/);
assert.equal(encodedLocal.includes("="), false);
assert.equal(encode_ssr_bootstrap(localBootstrap), encodedLocal);
const decodedLocal = decode_ssr_bootstrap(encodedLocal);
assert.equal(decodedLocal.kind, "document");
if (decodedLocal.kind !== "document") throw new Error("Wrong local kind.");
assert.deepEqual(decodedLocal.bootstrap, localBootstrap);
const localInstalled = hsonLiveMap.fromNode(decodedLocal.bootstrap.root);
if (localInstalled.mode !== "document") throw new Error("Decoded local map must be a document.");
localInstalled.restore(decodedLocal.bootstrap, { identity: "preserve-metadata" });
assert.deepEqual(localInstalled.capture(), localBootstrap);
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

const adversarial = "</script><script><!-- --> < > & \\\" ' \u2028\u2029";
const hostedMap = hsonLiveMap.fromNode({
  $_tag: "_hson_root",
  $_content: [{ $_tag: "main", $_content: [{ $_tag: "_hson_elem", $_content: [{ $_tag: "_hson_str", $_content: [adversarial] }] }] }],
});
if (hostedMap.mode !== "document") throw new Error("Hosted fixture must be a document map.");
const locus = hsonLocus.create({ map: hostedMap, logicalMapId: "map-</script>", incarnationId: "incarnation-雪", sessions: {} });
const hostedBootstrap = render_hosted_document({ authority: locus }).bootstrap;
const encodedHosted = encode_ssr_bootstrap(hostedBootstrap);
const reorderedHostedBootstrap: typeof hostedBootstrap = {
  hson: hostedBootstrap.hson,
  mode: hostedBootstrap.mode,
  rev: hostedBootstrap.rev,
  incarnationId: hostedBootstrap.incarnationId,
  logicalMapId: hostedBootstrap.logicalMapId,
};
assert.equal(encode_ssr_bootstrap(reorderedHostedBootstrap), encodedHosted);
assert.match(encodedHosted, /^[A-Za-z0-9_-]+$/);
const decodedHosted = decode_ssr_bootstrap(encodedHosted);
assert.equal(decodedHosted.kind, "hosted-document");
if (decodedHosted.kind !== "hosted-document") throw new Error("Wrong hosted kind.");
assert.deepEqual(decodedHosted.bootstrap, hostedBootstrap);
assert.deepEqual(install_locus_snapshot(decodedHosted.bootstrap).map.capture().root, hostedMap.capture().root);

const DataSchema: HsonSchema = Hson`<type "data" content <value "number">>`;
const DocumentSchema: HsonSchema = Hson`<type "document" tag "main" content "empty">`;
const inputs = Object.create(null) as Record<string, { data: { value: number }; schema: HsonSchema } | { document: string; schema: HsonSchema }>;
for (const name of ["__proto__", "constructor", "prototype", "10", "2"]) {
  Object.defineProperty(inputs, name, { value: name === "prototype" ? { document: "<main/>", schema: DocumentSchema } : { data: { value: name === "10" ? -0 : 2 }, schema: DataSchema }, enumerable: true });
}
const librariesMap = hsonLiveMap.fromLibraries(inputs);
const librariesBootstrap = render_document({ map: librariesMap, document: "prototype" }).bootstrap;
const encodedLibraries = encode_ssr_bootstrap(librariesBootstrap);
const decodedLibraries = decode_ssr_bootstrap(encodedLibraries);
assert.equal(decodedLibraries.kind, "libraries");
if (decodedLibraries.kind !== "libraries") throw new Error("Wrong Libraries kind.");
assert.deepEqual(decodedLibraries.bootstrap, librariesBootstrap);
assert.deepEqual(install_libraries_snapshot(decodedLibraries.bootstrap).map.capture(), librariesBootstrap);
assert.deepEqual(decodedLibraries.bootstrap.registry.libraries.map((entry) => entry.name), librariesBootstrap.registry.libraries.map((entry) => entry.name));

const librariesLocus = hsonLocus.create({ map: librariesMap, logicalMapId: "aggregate-map", incarnationId: "aggregate-incarnation", sessions: {} });
const hostedLibrariesBootstrap = render_hosted_document({ authority: librariesLocus, document: "prototype" }).bootstrap;
const encodedHostedLibraries = encode_ssr_bootstrap(hostedLibrariesBootstrap);
const decodedHostedLibraries = decode_ssr_bootstrap(encodedHostedLibraries);
assert.equal(decodedHostedLibraries.kind, "hosted-libraries");
if (decodedHostedLibraries.kind !== "hosted-libraries") throw new Error("Wrong hosted Libraries kind.");
assert.deepEqual(decodedHostedLibraries.bootstrap, hostedLibrariesBootstrap);
assert.deepEqual(install_locus_libraries_snapshot(decodedHostedLibraries.bootstrap).map.capture(), librariesBootstrap);
assert.equal(({} as Record<string, unknown>).polluted, undefined);
assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"), false);

const canonicalJson = decodeText(encodedLocal);
const parsed = JSON.parse(canonicalJson) as Record<string, unknown>;
expectCode(encodeText(` {${canonicalJson.slice(1)}`), "SSR_BOOTSTRAP_NON_CANONICAL");
expectCode(encodeText(JSON.stringify({ kind: parsed.kind, format: parsed.format, version: parsed.version, payload: parsed.payload })), "SSR_BOOTSTRAP_NON_CANONICAL");
expectCode(encodeText(canonicalJson.replace('"format"', '"\\u0066ormat"')), "SSR_BOOTSTRAP_NON_CANONICAL");
expectCode(encodeText(canonicalJson.replace('"version":1', '"version":1e0')), "SSR_BOOTSTRAP_NON_CANONICAL");
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
expectCode(encodeText(JSON.stringify({ ...parsed, version: 2 })), "SSR_BOOTSTRAP_VERSION_UNSUPPORTED");
expectCode(encodeText(JSON.stringify({ ...parsed, kind: "wrong" })), "SSR_BOOTSTRAP_KIND_UNSUPPORTED");
const { payload: _missing, ...missing } = parsed;
expectCode(encodeText(JSON.stringify(missing)), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
expectCode(encodeText(JSON.stringify({ ...parsed, extra: true })), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
expectCode(encodeText(JSON.stringify({ ...parsed, payload: [] })), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
expectCode(encodeText(canonicalJson.replace('"viewStateFormat"', '"__proto__":{"polluted":true},"viewStateFormat"')), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
expectCode(encodedLocal.slice(0, -4), "SSR_BOOTSTRAP_MALFORMED");
assert.throws(() => decode_ssr_bootstrap(encodedLocal, { maxEncodedBytes: encodedLocal.length - 1 }),
  (cause) => cause instanceof SsrBootstrapEncodingError && cause.code === "SSR_BOOTSTRAP_TOO_LARGE");
assert.throws(() => encode_ssr_bootstrap(localBootstrap, { maxEncodedBytes: encodedLocal.length - 1 }),
  (cause) => cause instanceof SsrBootstrapEncodingError && cause.phase === "encode" && cause.code === "SSR_BOOTSTRAP_TOO_LARGE");
assert.throws(() => encode_ssr_bootstrap(localBootstrap, { maxEncodedBytes: 0 }),
  (cause) => cause instanceof SsrBootstrapEncodingError && cause.phase === "encode" && cause.code === "SSR_BOOTSTRAP_INPUT_INVALID");

const malformedExact = structuredClone(parsed) as { payload: { viewStatePayload: string } };
malformedExact.payload.viewStatePayload = "<malformed>";
expectCode(encodeText(JSON.stringify(malformedExact)), "SSR_BOOTSTRAP_PAYLOAD_INVALID");
assert.throws(() => encode_view_state_snapshot({
  kind: "hson-document", mode: "document", rev: 0,
  root: { $_tag: "_hson_root", $_content: [{ $_tag: "main", $_attrs: { title: undefined }, $_content: [] }] },
}), /invalid/i);

process.stdout.write("SSR bootstrap codec acceptance passed.\n");
