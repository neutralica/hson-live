import { parentPort } from "node:worker_threads";
import { hsonLiveMap } from "../../src/api/livemap/index.ts";
import { decode_ssr_bootstrap, encode_ssr_bootstrap, render_document } from "../../src/api/ssr/index.ts";

const map = hsonLiveMap.fromHson(`<main <p @000005301 "a" "" "worker"/>/>`);
if (map.mode !== "document") throw new Error("Worker SSR fixture requires a document map.");
const result = render_document({ map });
const emptyMap = hsonLiveMap.fromHson("");
if (emptyMap.mode !== "document") throw new Error("Worker empty fixture requires a document map.");
let emptySsrRejected = false;
try {
  render_document({ map: emptyMap });
} catch (cause) {
  emptySsrRejected = cause instanceof Error
    && cause.cause instanceof Error
    && /exactly one ordinary canonical document root/.test(cause.cause.message);
}
const encoded = encode_ssr_bootstrap(result.bootstrap);
const largeBootstrap = Object.freeze({
  logicalMapId: "worker-large-map",
  incarnationId: "worker-large-incarnation",
  rev: 0,
  mode: "document" as const,
  hson: "worker-large:" + "x".repeat(2 * 1_024 * 1_024),
});
const largeEncoded = encode_ssr_bootstrap(largeBootstrap);
parentPort?.postMessage(Object.freeze({
  html: result.html,
  bootstrap: result.bootstrap,
  encoded,
  decoded: decode_ssr_bootstrap(encoded),
  largeEncoded,
  largeDecoded: decode_ssr_bootstrap(largeEncoded),
  emptyRoot: emptyMap.root(),
  emptySsrRejected,
  hasDocument: "document" in globalThis,
}));
