import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { load_persistent_locus_hosted_aggregate_internal as load } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
const input = JSON.parse(readFileSync(0, "utf8")), adapter = new MemoryCheckpointAdapter();
for (const [id, state] of input.states) adapter.states.set(id, state);
for (const [id, chunk] of input.chunks) adapter.chunks.set(id, chunk);
for (const [id, manifest] of input.manifests) adapter.manifests.set(id, manifest);
const restored = await load(input.logicalMapId, { persistence: adapter }); assert.ok(restored);
try {
  const a = owner(restored.map), id = a.libraries()[0]!, quid = a.documentOverlay(id).quidAtPath(validate_document_path([0,0,0]));
  const page = restored.map.lib("page"); assert.equal(page.mode, "document");
  if (page.mode !== "document") throw Error("document");
  assert.equal(page.document.attrs.get({ kind: "path", path: validate_document_path([0,0,0]) }, "title"), "accepted");
  assert.ok(quid && page.css.snapshot().includes(quid)); assert.notEqual(quid, input.sender);
  assert.equal(a.identityEpoch().issued().has(input.sender), false); assert.equal(a.documentScopes(id), undefined);
  process.stdout.write("fresh flat tail restored");
} finally { restored.dispose(); }
