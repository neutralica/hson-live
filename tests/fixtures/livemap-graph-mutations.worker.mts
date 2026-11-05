import assert from "node:assert/strict";
import { parentPort } from "node:worker_threads";
import { livemap_graph_mutation_cases } from "./livemap-graph-mutations-cases.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap-graph-mutations-worker", title: "Graph mutation planning in a Worker",
  category: "LiveMap", runtime: "node", tags: Object.freeze(["data", "mutations", "order", "worker"]),
});
assert.equal(typeof document, "undefined"); assert.equal(typeof window, "undefined");
const passed: string[] = [];
await livemap_graph_mutation_cases(async (name, run) => { await run(); passed.push(name); });
parentPort?.postMessage(passed);
