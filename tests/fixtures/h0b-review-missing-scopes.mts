import assert from 'node:assert/strict';
import { hsonLiveMap } from '../../src/index.ts';
import { internal_livemap_aggregate_authority as authority } from '../../src/api/livemap/livemap.internal.ts';
import { create_persistent_locus_hosted_aggregate_internal as persist,
  load_persistent_locus_hosted_aggregate_internal as resume } from '../../src/api/locus/locus.aggregate.persistence.ts';
import { MemoryCheckpointAdapter } from '../helpers/memory-checkpoint-adapter.mts';

// Original independent-review reproducer, with relative imports, a callable
// wrapper and type-safe inspection/corruption for the permanent test gate.
export async function review_missing_scopes() {
  const parts = { parts: { leaf: { kind: 'document', document: '<section @:root <button @:button/>/>' } } } as const;
  const map = hsonLiveMap.fromLibraries({ parts }), adapter = new MemoryCheckpointAdapter();
  const locus = await persist({ map, persistence: adapter, scopedDocuments: true });
  await locus.add_libraries_internal({ page: {
    document: '<main @:root <hson-part @:slot lib="parts" at="leaf"/>/>',
  } }, undefined, [{ name: 'page', ownership: 'shared' }]);
  const logicalMapId = locus.logicalMapId;
  const stored = structuredClone(adapter.state(logicalMapId))!;
  assert.equal(authority(map).scopedDocumentState(authority(map).libraries()[1]!).scopes.occurrences.length, 1);
  locus.dispose();
  Reflect.deleteProperty(stored.commits[0]!.commit.topology!.operation.libraries[0]!, 'scopes');
  adapter.seed(logicalMapId, stored);
  let rejected = false;
  try {
    const restored = await resume(logicalMapId, { persistence: adapter, scopedDocuments: true });
    assert.ok(restored);
    try {
      const a = authority(restored.map);
      const page = restored.map.doc.must('page'); assert.equal(page.mode, 'document');
      if (page.mode !== 'document') throw Error('Expected a document');
      console.log({ accepted: true, revision: restored.rev,
        scopes: a.documentScopes(a.libraries()[1]!), slot: page.q('slot'),
        ownership: restored.runtimeOwnership });
    } finally { restored.dispose(); }
  } catch { rejected = true; }
  assert.equal(rejected, true, 'durable restoration accepted missing scoped topology evidence');
}
