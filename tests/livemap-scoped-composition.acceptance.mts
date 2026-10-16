import { scoped_library_cases } from "./fixtures/livemap-scoped-library-cases.mts";
import { scoped_portable_cases, scoped_portable_fixture_capture, scoped_portable_roundtrip } from "./fixtures/livemap-scoped-portable-cases.mts";
import { document_scoped_libraries_semantically_equal, type PortableDocumentScopedLibrary } from "../src/api/livemap/livemap.document.scoped-portable.ts";
import assert from "node:assert/strict";
import { scoped_composition_cases } from "./fixtures/livemap-scoped-composition-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.scoped-composition", title: "Private scoped Library composition, reconciliation and portable restoration",
  category: "LiveMap", runtime: "node",
  tags: Object.freeze(["quad", "scope", "identity", "composition", "mutation", "worker", "admission", "css", "portable"]),
});
const events = create_test_event_emitter("livemap.scoped-composition");
let cases = 0;
[scoped_composition_cases, scoped_library_cases, scoped_portable_cases].forEach(suite => suite((name, run) => {
  events.case_begin(name, name);
  try { run(); cases++; events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
}));
const portable = scoped_portable_fixture_capture();
const worker = repository_typescript_worker(new URL("./fixtures/livemap-scoped-composition.worker.mts", import.meta.url), { workerData: { portable } });
try {
  const result = await new Promise<{ cases: number; portable: PortableDocumentScopedLibrary }>((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(new Error(`Scoped QUAD Worker exited ${code}`)));
  });
  assert.equal(result.cases, cases);
  assert.ok(document_scoped_libraries_semantically_equal(portable, result.portable));
  assert.notDeepEqual(portable.scopes.subjects, result.portable.scopes.subjects);
  const returned = scoped_portable_roundtrip(result.portable);
  assert.ok(document_scoped_libraries_semantically_equal(portable, returned));
  assert.notDeepEqual(result.portable.scopes.subjects, returned.scopes.subjects);
} finally { await worker.terminate(); }
events.terminal("pass");
console.log(`Scoped composition passed (${cases} Node and ${cases} Worker groups).`);
