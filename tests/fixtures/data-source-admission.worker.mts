import assert from "node:assert/strict";
import { parentPort } from "node:worker_threads";
import { data_source_admission_cases } from "./data-source-admission-cases.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "data-source-admission-worker",
  title: "Unified JSON and Hson Data admission in a Worker",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["data", "admission", "exactness", "worker"]),
});

assert.equal(typeof document, "undefined");
assert.equal(typeof window, "undefined");
const passed: string[] = [];
data_source_admission_cases((name, run) => { run(); passed.push(name); });
parentPort?.postMessage(passed);
