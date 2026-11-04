import assert from "node:assert/strict";
import { parentPort } from "node:worker_threads";
import { data_source_consumer_cases } from "./data-source-consumers-cases.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "data-source-consumers-worker", title: "Bilingual Data consumers in a Worker",
  category: "LiveMap", runtime: "node", tags: Object.freeze(["data", "admission", "worker"]),
});
assert.equal(typeof document, "undefined"); assert.equal(typeof window, "undefined");
const passed: string[] = [];
await data_source_consumer_cases(async (name, run) => { await run(); passed.push(name); });
parentPort?.postMessage(passed);
