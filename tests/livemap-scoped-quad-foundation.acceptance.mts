import assert from "node:assert/strict";
import { scoped_quad_foundation_cases } from "./fixtures/livemap-scoped-quad-foundation-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.scoped-quad-foundation", title: "Private scoped QUAD state and transport codec",
  category: "LiveMap", runtime: "node",
  tags: Object.freeze(["quad", "scope", "identity", "codec", "portable", "worker", "admission"]),
});
const events = create_test_event_emitter("livemap.scoped-quad-foundation");
let cases = 0;
scoped_quad_foundation_cases((name, run) => {
  events.case_begin(name, name);
  try { run(); cases++; events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
});
const worker = repository_typescript_worker(new URL("./fixtures/livemap-scoped-quad-foundation.worker.mts", import.meta.url));
try {
  const result = await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(new Error(`Scoped QUAD Worker exited ${code}`)));
  });
  assert.deepEqual(result, { cases });
} finally { await worker.terminate(); }
events.terminal("pass");
console.log(`Scoped QUAD foundation passed (${cases} Node and ${cases} Worker groups).`);
