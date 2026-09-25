import { parentPort } from "node:worker_threads";
import { Hson, decode_ssr_bootstrap, encode_ssr_bootstrap, hsonLiveMap, render_document, type HsonSchema } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { parse_hson_exact_runtime } from "../../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../../src/internal/exact-runtime-node-admission.ts";

const StateSchema: HsonSchema = Hson.schema`<type "data" content <count "number">>`;
const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "p" content "string">]>>`;
const map = admit_exact_runtime_livemap_libraries({
  state: { data: { count: 4 }, schema: StateSchema },
  page: { document: parse_hson_exact_runtime('<main <p @000009711 "worker"/>/>', { allowTopLevelDocumentText: true }), schema: PageSchema },
});
const result = render_document({ map });
const encoded = encode_ssr_bootstrap(result.bootstrap);
const installed = install_libraries_snapshot(result.bootstrap).map;
const state = installed.lib("state");
if (state.mode === "document") throw new Error("Expected installed data Library.");
parentPort?.postMessage(Object.freeze({
  html: result.html,
  document: result.document,
  bootstrap: result.bootstrap,
  encoded,
  decoded: decode_ssr_bootstrap(encoded),
  revision: installed.rev,
  state: state.snap(),
  page: installed.lib("page").root(),
  hasDocument: "document" in globalThis,
}));
