import assert from "node:assert/strict";
import { encode_ssr_bootstrap } from "../src/index.ts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { hosted_cut_fixture } from "./helpers/hosted-cut-fixture.mts";

const node = await hosted_cut_fixture();
const worker = await new Promise<ReturnType<typeof hosted_cut_fixture>>((resolve, reject) => {
  const instance = repository_typescript_worker(new URL("./fixtures/hosted-cut-6e.worker.mts", import.meta.url));
  instance.once("message", resolve);
  instance.once("error", reject);
  instance.once("exit", (code) => { if (code !== 0) reject(new Error(`Hosted cut Worker exited with code ${code}.`)); });
});
assert.equal(node.hasDocument, false);
assert.equal(worker.hasDocument, false);
const parityBinding = "0".repeat(32);
assert.notEqual(worker.cut.sessionBinding, node.cut.sessionBinding);
assert.deepEqual({ ...worker.cut, sessionBinding: parityBinding }, { ...node.cut, sessionBinding: parityBinding });
assert.equal(encode_ssr_bootstrap({ ...worker.cut, sessionBinding: parityBinding }),
  encode_ssr_bootstrap({ ...node.cut, sessionBinding: parityBinding }));
assert.deepEqual({ ...worker.decoded, bootstrap: { ...worker.decoded.bootstrap, sessionBinding: parityBinding } },
  { ...node.decoded, bootstrap: { ...node.decoded.bootstrap, sessionBinding: parityBinding } });
assert.equal(worker.cut.libs.revision, 0);
assert.deepEqual(Object.keys(worker.cut).sort(), ["document", "format", "html", "initializerDigest", "libs", "local", "sessionBinding"]);
assert.ok(worker.cut.html.includes("WORKER_PERMITTED_SENTINEL"));
assert.ok(worker.encoded.includes("WORKER_PRIVATE_SENTINEL") === false);
assert.ok(JSON.stringify(worker).includes("WORKER_PRIVATE_SENTINEL") === false);
console.log("Step 6E Node/Worker projected hosted cut parity passed.");
