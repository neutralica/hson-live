import { parentPort } from "node:worker_threads";
import { hsonLiveMap } from "../../src/api/livemap/index.ts";
import { render_document } from "../../src/api/ssr/index.ts";

const map = hsonLiveMap.fromHson(`<main <p @000005301 "a" "" "worker"/>/>`);
if (map.mode !== "document") throw new Error("Worker SSR fixture requires a document map.");
const result = render_document({ map });
parentPort?.postMessage(Object.freeze({
  html: result.html,
  bootstrap: result.bootstrap,
  hasDocument: "document" in globalThis,
}));
