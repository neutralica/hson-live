import { parentPort } from "node:worker_threads";
import { hsonLiveMap } from "../../src/api/livemap/index.ts";
import { decode_ssr_bootstrap, encode_ssr_bootstrap, render_document } from "../../src/api/ssr/index.ts";

const map = hsonLiveMap.fromHson(`<main <p @000005301 "a" "" "worker"/>/>`);
if (map.mode !== "document") throw new Error("Worker SSR fixture requires a document map.");
const result = render_document({ map });
const encoded = encode_ssr_bootstrap(result.bootstrap);
parentPort?.postMessage(Object.freeze({
  html: result.html,
  bootstrap: result.bootstrap,
  encoded,
  decoded: decode_ssr_bootstrap(encoded),
  hasDocument: "document" in globalThis,
}));
