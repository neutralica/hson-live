import assert from 'node:assert/strict';
import { hsonLiveMap } from '../../src/index.ts';
import { internal_livemap_aggregate_authority as authority } from '../../src/api/livemap/livemap.internal.ts';
import { prepare_hosted_livemap_library_add_internal as prepare } from '../../src/api/livemap/livemap.libraries.ts';

// Original independent-review reproducer, with relative imports, a callable
// wrapper and type narrowing for the permanent test gate.
export function review_admission_management() {
  const results: boolean[] = [];
  for (const replacementWork of [false, true]) {
    const map = hsonLiveMap.fromLibraries({
      parts: { parts: { leaf: { kind: 'document', document: '<button @:root/>' } } },
      initial: { data: 0 },
    });
    const a = authority(map), owner = {}, replacement = {};
    a.claimManagement(owner);
    const inputs = {
      get page() {
        a.releaseManagement(owner);
        if (replacementWork) {
          a.claimManagement(replacement);
          const inner = prepare(map, replacement, { inner: { data: 7 } });
          a.accept(inner.transition, 'isolate', inner.afterInstall);
          a.releaseManagement(replacement);
        }
        a.claimManagement(owner);
        return { document: '<main @:root <hson-part lib="parts" at="leaf"/>/>' };
      },
    };
    let rejected = false;
    try {
      const outer = prepare(map, owner, inputs);
      a.accept(outer.transition, 'isolate', outer.afterInstall);
    } catch { rejected = true; }
    finally { a.releaseManagement(owner); }
    console.log({ replacementWork, rejected, revision: map.rev,
      libraries: a.hostedRegistry().libraries.map(entry => entry.name) });
    // Both iterations must reject the obsolete grant. Independently accepted
    // replacement work must remain visible at revision 1.
    if (replacementWork) {
      const inner = map.data.must('inner'); assert.ok('snap' in inner); assert.equal(inner.snap(), 7);
    }
    results.push(rejected && map.rev === (replacementWork ? 1 : 0));
  }
  assert.deepEqual(results, [true, true], 'admission survived revocation of its entry management grant');
}
