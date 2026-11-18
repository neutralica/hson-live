// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { hsonTransform } from "../src/api/transform/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";

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

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.representation-sha-worker",
  title: "Representation SHA-256 actual Worker parity",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["serialization", "sha256", "worker", "runtime-parity", "public-api", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("transform.representation-sha-worker");
let checks = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {

  testEvents.case_begin(name, name);
  try {
    await run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
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

await check("Hson preserves isolated surrogate member names and order across UTF-8", async () => {
  const forward = hsonTransform.fromHson("<'\\uD800' 1 '\\uD801' 1>");
  const reverse = hsonTransform.fromHson("<'\\uD801' 1 '\\uD800' 1>");
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const forwardNode = forward.toNode();
  const reverseNode = reverse.toNode();
  assert.equal(canonical_hson_graph_equal(forwardNode, reverseNode), false);

  for (const [first, second] of [
    [forward.toHson(), reverse.toHson()],
    [forward.toHson().noBreak(), reverse.toHson().noBreak()],
  ]) {
    for (const [output, expected] of [[first, forwardNode], [second, reverseNode]] as const) {
      const serialized = output.serialize();
      const utf8 = decoder.decode(encoder.encode(serialized));
      assert.equal(canonical_hson_graph_equal(expected, hsonTransform.fromHson(serialized).toNode()), true);
      assert.equal(canonical_hson_graph_equal(expected, hsonTransform.fromHson(utf8).toNode()), true);
    }
    assert.notEqual(await first.sha256(), await second.sha256());
  }
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
