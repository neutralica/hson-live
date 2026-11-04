import assert from "node:assert/strict";
import { parentPort } from "node:worker_threads";
import { livemap_graph_read_cases } from "./livemap-graph-reads-cases.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap-graph-reads-worker", title: "Graph reads in a Worker",
  category: "LiveMap", runtime: "node", tags: Object.freeze(["data", "reads", "order", "worker"]),
});
assert.equal(typeof document, "undefined"); assert.equal(typeof window, "undefined");
const passed: string[] = [];
await livemap_graph_read_cases(async (name, run) => { await run(); passed.push(name); });
parentPort?.postMessage(passed);
