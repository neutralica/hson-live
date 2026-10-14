import assert from "node:assert/strict";
import { part_collection_cases } from "./fixtures/livemap-part-collections-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "livemap.part-collections", title: "Governed Part collection ingress and egress",
  category: "LiveMap", runtime: "node", tags: Object.freeze(["livemap", "composition", "quad", "css", "worker", "atomicity"]) });
const events = create_test_event_emitter("livemap.part-collections");
let cases = 0;
await part_collection_cases(async (name, run) => {
  events.case_begin(name, name);
  try { await run(); cases++; events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
});
const worker = repository_typescript_worker(new URL("./fixtures/livemap-part-collections.worker.mts", import.meta.url));
try {
  const result = await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(Error(`Part collection Worker exited ${code}`)));
  });
  assert.deepEqual(result, { cases, isMainThread: false, hasDocument: false });
} finally { await worker.terminate(); }
events.terminal("pass");
console.log(`Part collections passed (${cases} Node and ${cases} actual Worker groups).`);
