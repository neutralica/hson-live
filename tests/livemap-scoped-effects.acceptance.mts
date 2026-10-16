import assert from "node:assert/strict";
import { scoped_effect_cases, scoped_effect_fixture, scoped_effect_receive } from "./fixtures/livemap-scoped-effects-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";
import { document_scoped_libraries_semantically_equal, type PortableDocumentScopedLibrary } from "../src/api/livemap/livemap.document.scoped-portable.ts";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.scoped-effects", title: "Private incremental scoped document effects",
  category: "LiveMap", runtime: "node", tags: Object.freeze(["quad", "scope", "identity", "mutation", "worker", "css", "portable"]),
});
const events = create_test_event_emitter("livemap.scoped-effects");
let cases = 0;
scoped_effect_cases((name, run) => {
  events.case_begin(name, name);
  try { run(); cases++; events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
});
const input = scoped_effect_fixture();
const worker = repository_typescript_worker(new URL("./fixtures/livemap-scoped-effects.worker.mts", import.meta.url), { workerData: input });
try {
  const result = await new Promise<{ cases: number; final: PortableDocumentScopedLibrary; outgoing: ReturnType<typeof scoped_effect_fixture> }>((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject); worker.once("exit", code => reject(Error(`Scoped effects Worker exited ${code}`)));
  });
  assert.equal(result.cases, cases); assert.ok(document_scoped_libraries_semantically_equal(input.final, result.final));
  assert.notDeepEqual(input.final.scopes.subjects, result.final.scopes.subjects);
  scoped_effect_receive(result.outgoing);
} finally { await worker.terminate(); }
events.terminal("pass");
console.log(`Scoped effects passed (${cases} Node and ${cases} Worker groups; incremental transfer in both directions).`);
