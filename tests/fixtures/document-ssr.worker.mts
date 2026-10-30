import { scout_delivery_cases } from "../scout-delivery.cases.mts";
import { parentPort } from "node:worker_threads";
import { hsonLiveMap } from "../../src/api/livemap/index.ts";
import { Hson } from "../../src/hson-authoring.ts";
import { decode_ssr_bootstrap, encode_ssr_bootstrap } from "../../src/api/ssr/index.ts";

await scout_delivery_cases();

const map = hsonLiveMap.fromLibraries({ page: { document: `<main <p "worker"/>/>`, schema: Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" content <sequence [<tag "p" content "string">]>>]>>]>>` } });
const result = map.cut({ html: "page" });
let emptyAdmissionRejected = false;
try {
  hsonLiveMap.fromLibraries({ page: { document: { $_tag: "_hson_root", $_content: [] } } });
} catch (cause) {
  emptyAdmissionRejected = cause instanceof Error && /exactly one authored element/.test(cause.message);
}
const encoded = encode_ssr_bootstrap(result.libs);
const largeMap = hsonLiveMap.fromLibraries({ page: { document: `<main "worker-large:${"x".repeat(5 * 1_024 * 1_024)}"/>`, schema: Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" content "string">]>>]>>` } });
const largeLibs = largeMap.cut({ html: "page" }).libs;
const largeEncoded = encode_ssr_bootstrap(largeLibs);
parentPort?.postMessage(Object.freeze({
  html: result.html,
  libs: result.libs,
  encoded,
  decoded: decode_ssr_bootstrap(encoded),
  largeEncoded,
  largeDecoded: decode_ssr_bootstrap(largeEncoded),
  emptyAdmissionRejected,
  hasDocument: "document" in globalThis,
}));
