import assert from "node:assert/strict";
import { data_source_consumer_cases } from "./fixtures/data-source-consumers-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "data-source-consumers", title: "Public Data values and explicit bilingual source admission",
  category: "LiveMap", runtime: "node", tags: Object.freeze(["data", "admission", "parts", "schema", "actions", "interactions", "worker"]),
});
const events = create_test_event_emitter("data-source-consumers");
const passed: string[] = [];
await data_source_consumer_cases(async (name, run) => {
  events.case_begin(name, name);
  try { await run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", String(error).slice(0, 1_000));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  passed.push(name); process.stdout.write("ok " + passed.length + " - " + name + "\n");
});
const workerCases = await new Promise<unknown>((resolve, reject) => {
  const worker = repository_typescript_worker(new URL("./fixtures/data-source-consumers.worker.mts", import.meta.url));
  let result: unknown;
  worker.once("message", value => { result = value; });
  worker.once("error", reject);
  worker.once("exit", code => {
    if (code !== 0) reject(new Error(`Data source consumers Worker exited with code ${code}.`));
    else resolve(result);
  });
});
events.case_begin("worker-parity", "Node and Worker execute the same receiving-boundary cases");
assert.deepEqual(workerCases, passed);
events.case_end("worker-parity", "pass"); events.terminal("pass");
process.stdout.write("1.." + (passed.length + 1) + "\n");
