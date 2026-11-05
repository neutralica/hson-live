import assert from "node:assert/strict";
import { livemap_graph_mutation_cases } from "./fixtures/livemap-graph-mutations-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap-graph-mutations", title: "Graph-authoritative Data mutation planning",
  category: "LiveMap", runtime: "node", tags: Object.freeze(["data", "mutations", "order", "ownership", "worker"]),
});
const events = create_test_event_emitter("livemap-graph-mutations");
const passed: string[] = [];
await livemap_graph_mutation_cases(async (name, run) => {
  events.case_begin(name, name);
  try { await run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", String(error).slice(0, 1_000));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  passed.push(name); process.stdout.write("ok " + passed.length + " - " + name + "\n");
});
const workerCases = await new Promise<unknown>((resolve, reject) => {
  const worker = repository_typescript_worker(new URL("./fixtures/livemap-graph-mutations.worker.mts", import.meta.url));
  let result: unknown;
  worker.once("message", value => { result = value; });
  worker.once("error", reject);
  worker.once("exit", code => {
    if (code !== 0) reject(new Error(`Graph mutation Worker exited with code ${code}.`)); else resolve(result);
  });
});
events.case_begin("worker-parity", "Node and Worker execute the same graph mutation cases");
assert.deepEqual(workerCases, passed);
events.case_end("worker-parity", "pass"); events.terminal("pass");
process.stdout.write("1.." + (passed.length + 1) + "\n");
