import assert from "node:assert/strict";
import { scoped_checkpoint_cases } from "./fixtures/locus-scoped-checkpoint-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";
import { scoped_initial_fixture } from "./fixtures/echo-scoped-initial-state-cases.mts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";
import { write_semantic_checkpoint, checkpoint_libraries_equal } from "../src/api/locus/locus.aggregate.persistence.ts";
import { enumerate_livemap_issued_quids } from "../src/api/livemap/livemap.identity-epoch.ts";
import type { LiveMapSemanticCheckpoint } from "../src/api/livemap/livemap.internal.ts";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.scoped-checkpoint", title: "Scoped semantic checkpoints B1",
  category: "Locus", runtime: "node", tags: Object.freeze(["quad", "scope", "checkpoint", "authority", "worker", "css"]),
});
const events = create_test_event_emitter("locus.scoped-checkpoint");
let cases = 0;
await scoped_checkpoint_cases(async (name, run) => {
  events.case_begin(name, name);
  try { await run(); cases++; events.case_end(name, "pass"); console.log(`ok - ${name}`); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
});
const source = await scoped_initial_fixture(), adapter = new MemoryCheckpointAdapter();
const checkpoint = source.a.captureSemanticCheckpoint(), sourceQuids = new Set(enumerate_livemap_issued_quids(source.a.identityEpoch().issued()));
try { await write_semantic_checkpoint(checkpoint, adapter); } finally { source.l.dispose(); }
const worker = repository_typescript_worker(new URL("./fixtures/locus-scoped-checkpoint.worker.mts", import.meta.url), {
  workerData: { state: adapter.state(checkpoint.authority.logicalMapId), chunks: [...adapter.chunks] },
});
try {
  const result = await new Promise<{ count: number; checkpoint: LiveMapSemanticCheckpoint; quids: readonly string[] }>((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(Error(`Scoped checkpoint Worker exited ${code}`)));
  });
  assert.equal(result.count, cases);
  assert.ok(checkpoint_libraries_equal(checkpoint.libraries, result.checkpoint.libraries));
  assert.deepEqual(result.checkpoint.registry, checkpoint.registry);
  assert.deepEqual(result.checkpoint.authority, checkpoint.authority);
  assert.equal(result.checkpoint.revision, checkpoint.revision);
  for (const quid of result.quids) assert.ok(!sourceQuids.has(quid));
} finally { await worker.terminate(); }
events.terminal("pass");
console.log(`Scoped checkpoints passed (${cases} Node and ${cases} Worker groups, plus cross-Worker chunk restoration).`);
