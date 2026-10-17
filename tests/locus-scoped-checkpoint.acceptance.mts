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
  id: "locus.scoped-checkpoint", title: "Scoped checkpoints and durable recovery B1/B2/H0a",
  category: "Locus", runtime: "node", tags: Object.freeze(["quad", "scope", "checkpoint", "authority", "worker", "css", "restart"]),
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
console.log(`Scoped checkpoints passed (${cases} Node and ${cases} Worker groups, plus cross-Worker chunk restoration).`);

// The terminated producer's exact persisted bytes cross both an actual Worker
// and a fresh process; neither receives source runtime identities or objects.
const { scoped_tail_fixture } = await import("./fixtures/locus-scoped-tail-cases.mts");
const { spawn } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
const { h0a_tail_fixture } = await import("./fixtures/locus-scoped-h0a-cases.mts");
for (const fixture of [scoped_tail_fixture, h0a_tail_fixture]) {
  const durable = await fixture();
  const persisted = { state: durable.state, chunks: [...durable.adapter.chunks], expected: durable.expected, sourceIds: durable.sourceIds };
  const restartEntry = new URL("./fixtures/locus-scoped-tail.restart.mts", import.meta.url);
  const tailWorker = repository_typescript_worker(restartEntry, { workerData: persisted });
  try {
    const result = await new Promise((resolve, reject) => {
      tailWorker.once("message", resolve); tailWorker.once("error", reject);
      tailWorker.once("exit", code => reject(Error(`Scoped tail Worker exited ${code}`)));
    });
    assert.equal(result, "scoped-tail-restart-ok");
  } finally { await tailWorker.terminate(); }
  const child = spawn(process.execPath, ["--import=tsx", fileURLToPath(restartEntry)], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", piece => { stdout += String(piece); }); child.stderr.on("data", piece => { stderr += String(piece); });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  child.stdin.end(JSON.stringify(persisted));
  assert.equal(await exited, 0, stderr); assert.equal(stdout.trim(), "scoped-tail-restart-ok");
}
console.log("B2 and H0a persisted tails passed cross-Worker and fresh-process restart, authorization, Echo reconstruction and subsequent replay.");

events.terminal("pass");
