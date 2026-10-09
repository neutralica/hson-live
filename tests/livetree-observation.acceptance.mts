// @hson-live-external-test
import assert from "node:assert/strict";
import { observation_cases } from "./fixtures/livetree-observation-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.observation", title: "Detached readonly LiveTree graph observations", category: "LiveTree", runtime: "node",
  tags: Object.freeze(["observation", "identity", "lifecycle", "worker", "externally-discoverable"]),
});
const events = create_test_event_emitter("livetree.observation");
let cases = 0;
observation_cases((name, run) => {
  events.case_begin(name, name);
  try { run(); cases++; events.case_end(name, "pass"); console.log(`ok ${cases} - ${name}`); }
  catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; }
});
const name = "actual source-loaded Worker observes exact detached runtime storage";
events.case_begin(name, name);
const worker = repository_typescript_worker(new URL("./fixtures/livetree-observation.worker.mts", import.meta.url));
try {
  const result = await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(new Error(`Worker exited ${code} before reporting`)));
  });
  assert.deepEqual(result, { observationWorker: "pass", cases }); events.case_end(name, "pass");
} catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; }
finally { await worker.terminate(); }
events.terminal("pass");
console.log(`LiveTree observation acceptance passed (${cases} Node cases and ${cases} Worker cases).`);
