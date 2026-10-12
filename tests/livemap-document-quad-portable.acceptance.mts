import assert from "node:assert/strict";
import { portable_quad_cases } from "./fixtures/livemap-document-quad-portable-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-quad-portable", title: "Portable authored QUAD Library correspondence",
  category: "LiveMap", runtime: "node",
  tags: Object.freeze(["quad", "identity", "portable", "snapshot", "checkpoint", "locus", "echo", "worker"]),
});
const events = create_test_event_emitter("livemap.document-quad-portable");
let cases = 0;
await portable_quad_cases(async (name, run) => {
  events.case_begin(name, name);
  try { await run(); cases++; events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error; }
});
const worker = repository_typescript_worker(new URL("./fixtures/livemap-document-quad-portable.worker.mts", import.meta.url));
try {
  const result = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(new Error(`Portable QUAD Worker exited ${code}`))); });
  assert.deepEqual(result, { cases });
} finally { await worker.terminate(); }
events.terminal("pass");
console.log(`Portable QUAD passed (${cases} Node and ${cases} Worker groups).`);
