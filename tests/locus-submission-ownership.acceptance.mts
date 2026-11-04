import assert from "node:assert/strict";
import { locus_submission_ownership_cases } from "./fixtures/locus-submission-ownership-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus-submission-ownership", title: "Deterministic Locus submission ownership and direct Schema evaluation",
  category: "Locus", runtime: "node", tags: Object.freeze(["data", "mutation", "order", "ownership", "atomicity", "worker"]),
});
const events = create_test_event_emitter("locus-submission-ownership");
const passed: string[] = [];
await locus_submission_ownership_cases(async (name, run) => {
  events.case_begin(name, name);
  try { await run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", String(error).slice(0, 1_000));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  passed.push(name); process.stdout.write("ok " + passed.length + " - " + name + "\n");
});
const workerCases = await new Promise<unknown>((resolve, reject) => {
  const worker = repository_typescript_worker(new URL("./fixtures/locus-submission-ownership.worker.mts", import.meta.url));
  let result: unknown;
  worker.once("message", value => { result = value; });
  worker.once("error", reject);
  worker.once("exit", code => {
    if (code !== 0) reject(new Error(`Locus ownership Worker exited with code ${code}.`)); else resolve(result);
  });
});
events.case_begin("worker-parity", "Node and Worker execute the same submission ownership cases");
assert.deepEqual(workerCases, passed);
events.case_end("worker-parity", "pass"); events.terminal("pass");
process.stdout.write("1.." + (passed.length + 1) + "\n");
