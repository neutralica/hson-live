import assert from "node:assert/strict";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";

const testEvents = create_test_event_emitter("canonical-interactions-worker");
const caseId = "hidden interaction recovery and exact authoritative dispatch work in an actual Worker";
testEvents.case_begin(caseId, caseId);
try {
  const result = await new Promise<Readonly<{ equal: boolean; order: readonly string[]; negativeZero: boolean }>>((resolve, reject) => {
    const worker = repository_typescript_worker(new URL("./fixtures/canonical-interactions.worker.mts", import.meta.url));
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => { if (code !== 0) reject(new Error(`Canonical interaction Worker exited with code ${code}.`)); });
  });
  assert.deepEqual(result, { equal: true, order: ["10", "2", "__proto__"], negativeZero: true });
  testEvents.case_end(caseId, "pass");
  testEvents.terminal("pass");
} catch (error) {
  testEvents.diagnostic(caseId, "assertion", error instanceof Error ? error.message : "Check failed.");
  testEvents.case_end(caseId, "fail");
  testEvents.terminal("fail");
  throw error;
}
