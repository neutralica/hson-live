import assert from "node:assert/strict";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { hosted_cut_fixture } from "./helpers/hosted-cut-fixture.mts";

const node = hosted_cut_fixture();
const worker = await new Promise<ReturnType<typeof hosted_cut_fixture>>((resolve, reject) => {
  const instance = repository_typescript_worker(new URL("./fixtures/hosted-cut-6e.worker.mts", import.meta.url));
  instance.once("message", resolve);
  instance.once("error", reject);
  instance.once("exit", (code) => { if (code !== 0) reject(new Error(`Hosted cut Worker exited with code ${code}.`)); });
});
assert.equal(node.hasDocument, false);
assert.equal(worker.hasDocument, false);
assert.deepEqual(worker.cut, node.cut);
assert.equal(worker.encoded, node.encoded);
assert.deepEqual(worker.decoded, node.decoded);
assert.equal(worker.cut.data.revision, worker.cut.revision);
assert.equal(worker.cut.data.projectionDigest, worker.cut.projectionDigest);
assert.ok(worker.cut.html.includes("WORKER_PERMITTED_SENTINEL"));
assert.ok(worker.encoded.includes("WORKER_PRIVATE_SENTINEL") === false);
assert.ok(JSON.stringify(worker).includes("WORKER_PRIVATE_SENTINEL") === false);
console.log("Step 6E Node/Worker projected hosted cut parity passed.");
