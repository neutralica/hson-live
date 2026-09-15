import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson-schema-any-worker",
  title: "Hson Schema any Worker parity",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "worker", "runtime-parity"]),
});

type WorkerResult = Readonly<{ certified: boolean; negativeZero: boolean; order: readonly string[]; exactOrder: readonly string[]; exactNegativeZero: boolean; safeProto: boolean; relationalAccepted: boolean; relationalRejected: boolean }>;

const testEvents = create_test_event_emitter("hson-schema-any-worker");
const caseId = "authored any uses canonical certification and governance in an actual Worker";
testEvents.case_begin(caseId, caseId);
try {
  const result = await new Promise<WorkerResult>((resolve, reject) => {
    const worker = repository_typescript_worker(new URL("./fixtures/hson-schema-any.worker.mts", import.meta.url));
    worker.once("message", (value: WorkerResult) => resolve(value));
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Hson Schema any Worker exited with code ${code}.`));
    });
  });
  assert.deepEqual(result, { certified: true, negativeZero: true, order: ["second", "first"], exactOrder: ["10", "2"], exactNegativeZero: true, safeProto: true, relationalAccepted: true, relationalRejected: true });
  testEvents.case_end(caseId, "pass");
  testEvents.terminal("pass");
} catch (error) {
  testEvents.diagnostic(caseId, "assertion", error instanceof Error ? error.message : "Check failed.");
  testEvents.case_end(caseId, "fail");
  testEvents.terminal("fail");
  throw error;
}
