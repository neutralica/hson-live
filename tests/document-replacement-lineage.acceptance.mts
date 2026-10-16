import assert from "node:assert/strict";
import { document_replacement_boundary_cases } from "./fixtures/document-replacement-boundary-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-replacement-lineage", title: "Replacement identity and public authoring boundaries",
  category: "LiveMap", runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "replacement", "identity", "admission", "worker"]),
});
const events = create_test_event_emitter("livemap.document-replacement-lineage");
let cases = 0;
document_replacement_boundary_cases((name, run) => {
  events.case_begin(name, name);
  try { run(); cases++; events.case_end(name, "pass"); }
  catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; }
});
const worker = repository_typescript_worker(new URL("./fixtures/document-replacement-boundary.worker.mts", import.meta.url));
try {
  const result = await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(new Error(`Replacement Worker exited ${code}`)));
  });
  assert.deepEqual(result, { cases });
} finally { await worker.terminate(); }
events.terminal("pass");
console.log(`Replacement boundaries passed (${cases} Node and ${cases} Worker groups).`);
