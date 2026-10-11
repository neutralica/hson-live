import assert from "node:assert/strict";
import { lazy_css_cases } from "./fixtures/livetree-css-lazy-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.css-lazy", title: "LiveTree lazy global CSS identity demand", category: "LiveTree",
  runtime: "node", tags: Object.freeze(["css", "quid", "mirror", "worker", "lifecycle"]),
});
const events = create_test_event_emitter("livetree.css-lazy");
let cases = 0;
lazy_css_cases((name, run) => {
  events.case_begin(name, name);
  try { run(); cases++; events.case_end(name, "pass"); }
  catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; }
});
const worker = repository_typescript_worker(new URL("./fixtures/livetree-css-lazy.worker.mts", import.meta.url));
try {
  const result = await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(new Error(`Worker exited ${code}`)));
  });
  assert.deepEqual(result, { cases });
} finally { await worker.terminate(); }
events.terminal("pass");
console.log(`Lazy CSS identity passed (${cases} Node and ${cases} actual Worker groups).`);
