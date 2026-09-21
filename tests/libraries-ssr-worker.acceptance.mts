import assert from "node:assert/strict";
import { Hson, encode_ssr_bootstrap, hsonLiveMap, render_document, type HsonSchema } from "../src/index.ts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";

const StateSchema: HsonSchema = Hson.schema`<type "data" content <count "number">>`;
const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "p" content "string">]>>`;
const map = hsonLiveMap.fromLibraries({
  state: { data: { count: 4 }, schema: StateSchema },
  page: { document: '<main <p @000009711 "worker"/>/>', schema: PageSchema },
});
const node = render_document({ map });
const installed = install_libraries_snapshot(node.bootstrap).map;
const state = installed.lib("state");
if (state.mode === "document") throw new Error("Expected installed data Library.");
const worker = await new Promise<any>((resolve, reject) => {
  const instance = repository_typescript_worker(new URL("./fixtures/libraries-ssr.worker.mts", import.meta.url));
  instance.once("message", resolve);
  instance.once("error", reject);
  instance.once("exit", (code) => { if (code !== 0) reject(new Error(`Libraries SSR Worker exited with code ${code}.`)); });
});

assert.equal(worker.hasDocument, false);
assert.equal(worker.html, node.html);
assert.equal(worker.document, node.document);
assert.deepEqual(worker.bootstrap, node.bootstrap);
assert.deepEqual(worker.cut, map.cut());
assert.equal(worker.encoded, encode_ssr_bootstrap(node.bootstrap));
assert.deepEqual(worker.decoded, { kind: "libraries", bootstrap: node.bootstrap });
assert.equal(worker.revision, installed.rev);
assert.deepEqual(worker.state, state.snap());
assert.deepEqual(worker.page, installed.lib("page").root());
process.stdout.write("Libraries SSR Node/Worker parity acceptance passed.\n");
