import assert from "node:assert/strict";
import { parentPort } from "node:worker_threads";
import { locus_submission_ownership_cases } from "./locus-submission-ownership-cases.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus-submission-ownership-worker", title: "Locus submission ownership in a Worker",
  category: "Locus", runtime: "node", tags: Object.freeze(["data", "mutation", "order", "worker"]),
});
assert.equal(typeof document, "undefined"); assert.equal(typeof window, "undefined");
const passed: string[] = [];
await locus_submission_ownership_cases(async (name, run) => { await run(); passed.push(name); });
parentPort?.postMessage(passed);
