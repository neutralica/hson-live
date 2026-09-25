import { parentPort } from "node:worker_threads";
import { hsonLiveMap } from "../../src/api/livemap/index.ts";
import { Hson } from "../../src/hson-authoring.ts";
import { decode_ssr_bootstrap, encode_ssr_bootstrap, render_document } from "../../src/api/ssr/index.ts";

const map = hsonLiveMap.fromLibraries({ page: { document: `<main <p "worker"/>/>`, schema: Hson.schema`<type "document" tag "main" content <sequence [<tag "p" content "string">]>>` } });
const result = render_document({ map });
const emptyMap = hsonLiveMap.fromLibraries({ page: { document: "", schema: Hson.schema`<type "document" content <sequence []>>` } });
let emptySsrRejected = false;
try {
  render_document({ map: emptyMap });
} catch (cause) {
  emptySsrRejected = cause instanceof Error
    && cause.cause instanceof Error
    && /exactly one ordinary canonical document root/.test(cause.cause.message);
}
const encoded = encode_ssr_bootstrap(result.bootstrap);
const largeMap = hsonLiveMap.fromLibraries({ page: { document: `<main "worker-large:${"x".repeat(2 * 1_024 * 1_024)}"/>`, schema: Hson.schema`<type "document" tag "main" content "string">` } });
const largeBootstrap = render_document({ map: largeMap }).bootstrap;
const largeEncoded = encode_ssr_bootstrap(largeBootstrap);
parentPort?.postMessage(Object.freeze({
  html: result.html,
  bootstrap: result.bootstrap,
  encoded,
  decoded: decode_ssr_bootstrap(encoded),
  largeEncoded,
  largeDecoded: decode_ssr_bootstrap(largeEncoded),
  emptyRoot: emptyMap.lib("page").root(),
  emptySsrRejected,
  hasDocument: "document" in globalThis,
}));
