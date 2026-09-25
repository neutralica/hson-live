import assert from "node:assert/strict";
import { hsonLiveMap } from "../src/api/livemap/index.ts";
import { Hson } from "../src/hson-authoring.ts";
import { encode_ssr_bootstrap, render_document } from "../src/api/ssr/index.ts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";

const map = hsonLiveMap.fromLibraries({ page: { document: `<main <p "worker"/>/>`, schema: Hson.schema`<type "document" tag "main" content <sequence [<tag "p" content "string">]>>` } });
const node = render_document({ map });
const largeMap = hsonLiveMap.fromLibraries({ page: { document: `<main "worker-large:${"x".repeat(2 * 1_024 * 1_024)}"/>`, schema: Hson.schema`<type "document" tag "main" content "string">` } });
const largeBootstrap = render_document({ map: largeMap }).bootstrap;
const worker = await new Promise<Readonly<{
  html: string;
  bootstrap: unknown;
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
assert.doesNotMatch(worker.html, /hson:quid|000005301/);
assert.doesNotMatch(JSON.stringify(worker.bootstrap), /000005301|"quid"/);
assert.deepEqual(worker.bootstrap, node.bootstrap);
assert.equal(worker.encoded, encode_ssr_bootstrap(node.bootstrap));
assert.deepEqual(worker.decoded, { kind: "libraries", bootstrap: node.bootstrap });
assert.equal(worker.largeEncoded, encode_ssr_bootstrap(largeBootstrap));
assert.deepEqual(worker.largeDecoded, { kind: "libraries", bootstrap: largeBootstrap });
assert.deepEqual(worker.emptyRoot, { $_tag: "_hson_root", $_content: [] });
assert.equal(worker.emptySsrRejected, true);
process.stdout.write("Document SSR Worker parity acceptance passed.\n");
