import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { load_persistent_locus_hosted_aggregate_internal as load, checkpoint_libraries_equal } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";

const input = JSON.parse(readFileSync(0, "utf8")), adapter = new MemoryCheckpointAdapter();
for (const [id, state] of input.states) adapter.states.set(id, state);
for (const [id, chunk] of input.chunks) adapter.chunks.set(id, chunk);
for (const [id, manifest] of input.manifests) adapter.manifests.set(id, manifest);
const restored = await load(input.logicalMapId, { persistence: adapter, scopedDocuments: true });
assert.ok(restored);
try {
  const a = owner(restored.map), actual = a.captureSemanticCheckpoint();
  assert.equal(actual.revision, input.expected.revision);
  assert.deepEqual(actual.authority, input.expected.authority);
  assert.deepEqual(actual.registry, input.expected.registry);
  assert.ok(checkpoint_libraries_equal(actual.libraries, input.expected.libraries));
  assert.deepEqual(adapter.state(input.logicalMapId)?.commits, input.tail);
  for (const quid of enumerate_livemap_issued_quids(a.identityEpoch().issued())) assert.ok(!input.sender.includes(quid));
  process.stdout.write("flat transaction restored");
} finally { restored.dispose(); }
