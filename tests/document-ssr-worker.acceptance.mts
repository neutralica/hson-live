import assert from "node:assert/strict";
import { hsonLiveMap } from "../src/api/livemap/index.ts";
import { encode_ssr_bootstrap, render_document } from "../src/api/ssr/index.ts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";

const map = hsonLiveMap.fromNode(parse_hson_exact_runtime(`<main <p @000005301 "a" "" "worker"/>/>`, { allowTopLevelDocumentText: true }));
if (map.mode !== "document") throw new Error("Node SSR fixture requires a document map.");
const node = render_document({ map });
const largeBootstrap = Object.freeze({
  logicalMapId: "worker-large-map",
  incarnationId: "worker-large-incarnation",
  rev: 0,
  mode: "document" as const,
  hson: "worker-large:" + "x".repeat(2 * 1_024 * 1_024),
});
const worker = await new Promise<Readonly<{
  html: string;
  bootstrap: unknown;
  cut: unknown;
  encoded: string;
  decoded: unknown;
  largeEncoded: string;
  largeDecoded: unknown;
  emptyRoot: unknown;
  emptySsrRejected: boolean;
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
assert.deepEqual(worker.cut, map.cut());
assert.equal(worker.encoded, encode_ssr_bootstrap(node.bootstrap));
assert.deepEqual(worker.decoded, { kind: "document", bootstrap: node.bootstrap });
assert.equal(worker.largeEncoded, encode_ssr_bootstrap(largeBootstrap));
assert.deepEqual(worker.largeDecoded, { kind: "hosted-document", bootstrap: largeBootstrap });
assert.deepEqual(worker.emptyRoot, { $_tag: "_hson_root", $_content: [] });
assert.equal(worker.emptySsrRejected, true);
process.stdout.write("Document SSR Worker parity acceptance passed.\n");
