import assert from "node:assert/strict";
import { document_quad_cases } from "./fixtures/livemap-document-quad-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-quad", title: "Private authored document QUAD bindings",
  category: "LiveMap", runtime: "node",
  tags: Object.freeze(["document", "quad", "identity", "worker", "admission", "lifecycle", "portability"]),
});
const events = create_test_event_emitter("livemap.document-quad");
let cases = 0;
document_quad_cases((name, run) => {
  events.case_begin(name, name);
  try { run(); cases++; events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
});
const worker = repository_typescript_worker(new URL("./fixtures/livemap-document-quad.worker.mts", import.meta.url));
try {
  const result = await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(new Error(`QUAD Worker exited ${code}`)));
  });
  assert.deepEqual(result, { cases });
} finally { await worker.terminate(); }
events.terminal("pass");
console.log(`Document QUAD passed (${cases} Node and ${cases} Worker groups).`);
