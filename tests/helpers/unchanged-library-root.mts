import assert from "node:assert/strict";
import type { HsonNode } from "../../src/core/types.js";
import type { InternalLiveMapAggregateAuthority } from "../../src/api/livemap/livemap.internal.js";
import type { LiveMapLibraryIdentity } from "../../src/api/livemap/livemap.library.js";
import { PART_COLLECTION_VALIDATION } from "../../src/api/livemap/livemap.parts.js";

/** Parts expose detached observations; ordinary Libraries retain raw internal reference checks. */
export function assert_unchanged_library_root(authority: InternalLiveMapAggregateAuthority,
  identity: LiveMapLibraryIdentity, expected: HsonNode): void {
  const index = authority.libraries().indexOf(identity);
  const binding = authority.hostedRegistry().libraries.filter(entry => entry.scope === undefined)[index];
  assert.ok(index >= 0 && binding !== undefined, "Library must remain installed");
  const observed = authority.root(identity);
  if (binding.validation === PART_COLLECTION_VALIDATION) {
    assert.deepEqual(observed, expected);
    assert.notEqual(observed, expected, "Part root observations must be detached");
  } else assert.equal(observed, expected);
}
