import assert from "node:assert/strict";
import { managed_stylesheet_cases } from "./fixtures/managed-stylesheet-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "css.managed-stylesheet-fidelity", title: "Managed stylesheet source semantic fidelity", category: "LiveTree", runtime: "node", tags: Object.freeze(["css", "worker", "semantic-fidelity", "layers"]) });
const events = create_test_event_emitter("css.managed-stylesheet-fidelity"); let cases = 0;
managed_stylesheet_cases((name, run) => { events.case_begin(name, name); try { run(); cases++; events.case_end(name, "pass"); } catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; } });
const worker = repository_typescript_worker(new URL("./fixtures/managed-stylesheet.worker.mts", import.meta.url));
try { const result = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); worker.once("exit", code => reject(new Error(`Worker exited ${code}`))); }); assert.deepEqual(result, { cases }); }
finally { await worker.terminate(); }
events.terminal("pass"); console.log(`Managed stylesheet fidelity passed (${cases} Node and ${cases} Worker groups).`);
