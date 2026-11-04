import assert from "node:assert/strict";
import { data_source_admission_cases } from "./fixtures/data-source-admission-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "data-source-admission",
  title: "Unified JSON and Hson Data source admission",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["data", "admission", "exactness", "reserved-names", "worker"]),
});

const events = create_test_event_emitter("data-source-admission");
const passed: string[] = [];
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", String(error).slice(0, 1_000));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  passed.push(name);
  process.stdout.write("ok " + passed.length + " - " + name + "\n");
}

data_source_admission_cases(check);
const workerCases = await new Promise<unknown>((resolve, reject) => {
  const worker = repository_typescript_worker(new URL("./fixtures/data-source-admission.worker.mts", import.meta.url));
  let result: unknown;
  worker.once("message", value => { result = value; });
  worker.once("error", reject);
  worker.once("exit", code => {
    if (code !== 0) reject(new Error(`Data source admission Worker exited with code ${code}.`));
    else resolve(result);
  });
});
const nodeCases = [...passed];
check("Node and Worker execute the same admission and graph-ownership checks", () => {
  assert.deepEqual(workerCases, nodeCases);
});
events.terminal("pass");
process.stdout.write("1.." + passed.length + "\n");
