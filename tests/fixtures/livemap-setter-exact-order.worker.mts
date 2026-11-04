import assert from "node:assert/strict";
import { parentPort } from "node:worker_threads";
import { livemap_setter_exact_order_cases } from "./livemap-setter-exact-order-cases.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap-setter-exact-order-worker", title: "Exact LiveMap setters in a Worker",
  category: "LiveMap", runtime: "node", tags: Object.freeze(["data", "mutation", "order", "worker"]),
});
assert.equal(typeof document, "undefined"); assert.equal(typeof window, "undefined");
const passed: string[] = [];
await livemap_setter_exact_order_cases(async (name, run) => { await run(); passed.push(name); });
parentPort?.postMessage(passed);
