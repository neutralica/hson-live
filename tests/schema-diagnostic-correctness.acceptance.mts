import assert from "node:assert/strict";
import { run_schema_diagnostic_cases } from "./fixtures/schema-diagnostics.fixture.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "schema-diagnostic-correctness", title: "Schema diagnostic correctness",
  category: "Schema", runtime: "node", tags: Object.freeze(["schema", "diagnostics", "canonical-schema", "worker"]),
});
const events = create_test_event_emitter(HSON_LIVE_TEST_METADATA.id);
for (const runtime of ["Node", "Worker"]) {
  events.case_begin(runtime, `${runtime} canonical, runtime and static issue fidelity`);
  try {
    if (runtime === "Node") run_schema_diagnostic_cases();
    else await new Promise<void>((resolve, reject) => {
      const worker = repository_typescript_worker(new URL("./fixtures/schema-diagnostics.worker.mts", import.meta.url));
      let passed = false;
      worker.once("message", value => { passed = value === "passed"; });
      worker.once("error", reject);
      worker.once("exit", code => { try { assert.equal(code, 0); assert.ok(passed); resolve(); } catch (error) { reject(error); } });
    });
    events.case_end(runtime, "pass");
  } catch (error) { events.diagnostic(runtime, "assertion", String(error)); events.case_end(runtime, "fail"); events.terminal("fail"); throw error; }
}
events.terminal("pass");
