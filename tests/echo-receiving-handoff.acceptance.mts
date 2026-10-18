import assert from "node:assert/strict";
import { receiving_handoff_cases } from "./fixtures/echo-receiving-handoff-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.receiving-handoff", title: "Original SSR to receiving Echo handoff",
  category: "Echo", runtime: "node", tags: Object.freeze(["quad", "scope", "authority", "worker", "projection", "css"]),
});
const events = create_test_event_emitter("echo.receiving-handoff");
let cases = 0;
await receiving_handoff_cases(async (name, run) => {
  events.case_begin(name, name);
  try { await run(); cases++; events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
});
const worker = repository_typescript_worker(new URL("./fixtures/echo-receiving-handoff.worker.mts", import.meta.url));
try {
  const count = await new Promise<number>((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(Error(`Receiving handoff Worker exited ${code}`)));
  });
  assert.equal(count, cases);
} finally { await worker.terminate(); }
events.terminal("pass");
console.log(`Receiving handoff passed (${cases} Node and ${cases} Worker groups).`);
