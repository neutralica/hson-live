import { parentPort } from "node:worker_threads";
import { hsonLiveMap } from "../../src/api/livemap/index.ts";
import { Hson } from "../../src/hson-authoring.ts";
import { decode_ssr_bootstrap, encode_ssr_bootstrap } from "../../src/api/ssr/index.ts";

const map = hsonLiveMap.fromLibraries({ page: { document: `<main <p "worker"/>/>`, schema: Hson.schema`<type "document" tag "main" content <sequence [<tag "p" content "string">]>>` } });
const result = map.cut({ html: "page" });
const emptyMap = hsonLiveMap.fromLibraries({ page: { document: { $_tag: "_hson_root", $_content: [] }, schema: Hson.schema`<type "document" content <sequence []>>` } });
let emptySsrRejected = false;
try {
  emptyMap.cut({ html: "page" });
} catch (cause) {
  emptySsrRejected = cause instanceof Error
    && cause.cause instanceof Error
    && /exactly one ordinary canonical document root/.test(cause.cause.message);
}
const encoded = encode_ssr_bootstrap(result.libs);
const largeMap = hsonLiveMap.fromLibraries({ page: { document: `<main "worker-large:${"x".repeat(5 * 1_024 * 1_024)}"/>`, schema: Hson.schema`<type "document" tag "main" content "string">` } });
const largeLibs = largeMap.cut({ html: "page" }).libs;
const largeEncoded = encode_ssr_bootstrap(largeLibs);
parentPort?.postMessage(Object.freeze({
  html: result.html,
  libs: result.libs,
  encoded,
  decoded: decode_ssr_bootstrap(encoded),
  largeEncoded,
  largeDecoded: decode_ssr_bootstrap(largeEncoded),
  emptyRoot: emptyMap.lib("page").root(),
  emptySsrRejected,
  hasDocument: "document" in globalThis,
}));
