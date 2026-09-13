import assert from "node:assert/strict";
import { hsonLiveMap } from "../src/api/livemap/index.ts";
import { render_document } from "../src/api/ssr/index.ts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";

const map = hsonLiveMap.fromHson(`<main <p @000005301 "a" "" "worker"/>/>`);
if (map.mode !== "document") throw new Error("Node SSR fixture requires a document map.");
const node = render_document({ map });
const worker = await new Promise<Readonly<{
  html: string;
  bootstrap: unknown;
  hasDocument: boolean;
}>>((resolve, reject) => {
  const instance = repository_typescript_worker(new URL("./fixtures/document-ssr.worker.mts", import.meta.url));
  instance.once("message", resolve);
  instance.once("error", reject);
  instance.once("exit", (code) => {
    if (code !== 0) reject(new Error(`Document SSR Worker exited with code ${code}.`));
  });
});

assert.equal(worker.hasDocument, false);
assert.equal(worker.html, node.html);
assert.deepEqual(worker.bootstrap, node.bootstrap);
process.stdout.write("Document SSR Worker parity acceptance passed.\n");
