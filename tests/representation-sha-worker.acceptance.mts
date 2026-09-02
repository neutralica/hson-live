// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { hsonTransform } from "../src/api/transform/index.ts";

const LAUNCHER = "transform.representation-sha-worker";
const SOURCE = '{"note":"café","values":[-0,"\\ud800"]}';

type TextResult = Readonly<{ serialized: string; production: string; native: string }>;
type BinaryResult = Readonly<{ serialized: Uint8Array; production: string; native: string }>;
type WorkerResult = Readonly<{
  hson: TextResult;
  json: TextResult;
  html: TextResult;
  binary: BinaryResult;
}>;

let checks = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function runWorker(): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = repository_typescript_worker(
      new URL("./fixtures/representation-sha.worker.mts", import.meta.url),
      { workerData: { source: SOURCE } },
    );
    worker.once("message", (value: WorkerResult) => resolve(value));
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`representation SHA Worker exited with code ${code}`));
    });
  });
}

const worker = await runWorker();
const node = hsonTransform.fromJson(SOURCE);

async function assertTextLane(
  observed: TextResult,
  nodeRepresentation: Readonly<{ serialize(): string; sha256(): Promise<string> }>,
): Promise<void> {
  assert.equal(observed.serialized, nodeRepresentation.serialize());
  assert.equal(observed.production, observed.native);
  assert.equal(observed.production, await nodeRepresentation.sha256());
}

await check("actual Worker Hson bytes and native SHA match Node", () => {
  return assertTextLane(worker.hson, node.toHson());
});

await check("actual Worker JSON bytes and native SHA match Node", () => {
  return assertTextLane(worker.json, node.toJson());
});

await check("actual Worker HTML bytes and native SHA match Node", () => {
  return assertTextLane(worker.html, node.toHtml());
});

await check("actual Worker Binary bytes and native SHA match Node", async () => {
  const nodeRepresentation = node.toBinary();
  assert.deepEqual(worker.binary.serialized, nodeRepresentation.serialize());
  assert.equal(worker.binary.production, worker.binary.native);
  assert.equal(worker.binary.production, await nodeRepresentation.sha256());
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion(LAUNCHER, checks, checks, 0);
