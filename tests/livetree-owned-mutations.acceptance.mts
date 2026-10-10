// @hson-live-external-test
import assert from "node:assert/strict";
import { owned_mutation_cases } from "./fixtures/livetree-owned-mutation-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "livetree.owned-mutations", title: "Canonical owned mutations and structural occurrences", category: "LiveTree", runtime: "node", tags: Object.freeze(["ownership", "mutation", "worker", "externally-discoverable"]) });
const events = create_test_event_emitter("livetree.owned-mutations"); let cases = 0;
owned_mutation_cases((name, run) => { events.case_begin(name, name); try { run(); cases++; events.case_end(name, "pass"); } catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; } });
const worker = repository_typescript_worker(new URL("./fixtures/livetree-owned-mutation.worker.mts", import.meta.url));
try { const result = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); worker.once("exit", code => reject(new Error(`Worker exited ${code}`))); }); assert.deepEqual(result, { cases }); }
finally { await worker.terminate(); }
events.terminal("pass"); console.log(`Owned mutation acceptance passed (${cases} Node and ${cases} Worker cases).`);
