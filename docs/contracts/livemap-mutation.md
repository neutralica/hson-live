// livemap-mutation.md

# LiveMap Mutation Contract
## Status
This document defines the normative mutation semantics of LiveMap.
It describes projected state mutation through LiveMap. It does not define arbitrary physical HSON graph surgery.
## Concepts
LiveMap exposes projected JSON-like state backed by an HSON graph.
A projected mutation:
1. receives a normalized path and operation;
2. projects the complete candidate result;
3. validates the candidate against any attached schema;
4. preflights the operation against a detached graph;
5. mutates the authoritative graph;
6. emits one normalized commit;
7. advances the map revision only when state changed.
A mutation either commits completely or has no observable effect.

The canonical HSON graph is authoritative. An immutable ordered projected-value
carrier is private transient machinery used for admission, planning, equality,
schema validation, propagation, and exact transport; it is not stored as a
second synchronized state model.

JavaScript values enter through one descriptor-aware snapshot pass. Supported
values are strings, booleans, `null`, finite primitive numbers, ordinary plain
or null-prototype objects, and dense ordinary arrays. Objects admit only
enumerable own string-keyed data properties. Arrays admit only a data property
for every index and their built-in `length`. Accessors, symbol/nonenumerable
properties, custom prototypes, boxed or exotic values, holes, explicit
`undefined`, array extras, and cycles reject. Repeated acyclic references copy
structurally. Arbitrary proxies are unsupported and reflective inspection may
execute traps.
## Mutation domain
Projected mutations include:
- `set`
- `setMany`
- `replace`
- `delete`
- `splice`
- `batch`
- `apply`
- `replay`
Projected mutations participate in:
- schema validation;
- editor preflight;
- commit generation;
- revision accounting;
- feeds and subscriptions;
- LiveHost synchronization.
Low-level physical node mutation is outside this contract unless it is explicitly converted into projected operations and committed through LiveMap.
## Paths
Every operation targets a canonical `LivePath`.
A path identifies a projected location, not a persistent identity.
Paths are arrays of valid path segments. String path syntaxes are not canonical mutation inputs.
The empty path `[]` identifies the projected root.
## `set`
`set(path, value)` performs constructive assignment.
For primitive and array endpoints, `set` ordinarily assigns the supplied value at the path.
For object values, `set` may construct or update child state rather than requiring exact endpoint replacement.
Callers must not assume that an object-valued `set` always produces one public operation.
Use `replace` when exact endpoint replacement is required.
## `setMany`
`setMany(path, values)` performs explicit child assignments beneath a path.
Its meaning is equivalent to a batch of deliberate child writes.
It is not an alias for exact object replacement.
## `replace`
`replace(path, value)` performs exact assignment at the endpoint.
The previous endpoint value is replaced by the supplied value.
`replace([], value)` replaces the projected root.
Use `replace` when the complete endpoint value is authoritative.
## `delete`
`delete(path)` removes the projected value at the path.
A committed delete operation records:
- `kind: "delete"`
- `path`
- `prev`
- `next: undefined`
Deleting a value that does not produce a state change must result in a no-op commit.
The root deletion policy must remain explicit in implementation and tests. It must not be inferred from non-root delete behavior.
## `splice`
`splice(path, start, deleteCount, ...items)` performs a semantic array splice.
A committed splice operation records:
- `kind: "splice"`
- `path`
- `start`
- `removed`
- `inserted`
- `prev`
- `next`
Array helpers that are naturally splice operations should preserve splice semantics.
Examples include:
- push;
- unshift;
- pop;
- shift;
- insertion;
- removal;
- replacement of an array range.
Whole-array transformations may remain exact `set` or `replace` operations when no narrower semantic operation accurately represents them.
## `batch`
`batch(callback)` collects multiple writes into one atomic mutation.
A batch:
- validates the complete candidate state;
- mutates the live graph only after all operations pass;
- produces one commit;
- advances the revision at most once;
- emits subscriptions from the final committed state.
A failure in any operation invalidates the entire batch.
No earlier operation in the batch may remain applied after a later failure.
## Commits
A `LiveMapCommit` has the form:
```ts
type LiveMapCommit = Readonly<{
  changed: boolean;
  prevRev: number;
  rev: number;
  ops: readonly LiveMapOp[];
}>;
```
A changed commit:

* has changed === true;
* has one or more normalized operations;
* has prevRev equal to the map revision before mutation;
* has rev === prevRev + 1.

A no-op commit:

* has changed === false;
* has no applied operations;
* has rev === prevRev;
* does not advance the map revision.

A rejected mutation produces no commit.

Revisions

A new map begins at revision 0.

The current revision is exposed as:

map.rev

Revision advancement is tied to committed state change, not method invocation.

The following do not consume a revision:

* no-op writes;
* malformed replay input;
* stale apply or replay attempts;
* replay conflicts;
* schema failures;
* editor failures;
* aborted batches.

A multi-operation batch or replay advances the revision once.

capture

capture() returns detached projected state, exact structural transport, and the
revision at which it was observed.

type LiveMapCapture<TValue> = Readonly<{
  rev: number;
  value: TValue;
  format: "structural-json";
  formatVersion: 1;
  payload: string;
}>;

A capture must remain stable after later map mutations.

`value` is a compatibility JavaScript projection. `payload` is the exact
ordered representation and preserves `-0`. Any presence of exact transport
fields selects exact decoding; malformed exact data rejects and never falls
back to `value`. Legacy `{ rev, value }` captures remain readable but are lossy,
and no removal release is currently assigned.

A capture is observed state. It is not itself a mutation request.

## Canonical document operations

Document-mode LiveMaps use a separate canonical path domain. `LiveMapDocumentPath` is a validated, detached, readonly numeric array of finite, non-negative safe-integer `$_content` indexes. It never admits projected object keys.

Root interpretation is exact:

- element mode `[]` addresses the one public top-level ordinary element;
- fragment mode `[]` addresses the owned `_hson_elem` cluster;
- each segment descends through the current HSON node's `$_content`; and
- descent through a primitive or beyond content is a structured conflict.

Canonical graph commits stage operations in ordinal order:

```text
ordinal 0 -> graph at commit.prevRev
ordinal i -> graph after ordinals 0..i-1
```

Paths and content indexes are interpreted at their own ordinal. They are never silently rebased against `prevRev`.

Live calls accept `LiveMapDocumentRequestTarget` (`path` or compatibility `quid`). Stored graph operations use only `LiveMapDocumentCommitTarget` (`path` plus an optional non-routing QUID witness). QUID requests are resolved and lowered synchronously before commit construction. A witness can detect an active different QUID at the routed endpoint but cannot route, repair an invalid path, or prove epoch provenance.

### Document operation matrix

| Operation | Path target and index domain | Staged structural effect | No-op and conflict rules |
|---|---|---|---|
| `set-attr` | Ordinary element path; canonical public name/value | No path changes | Exact existing value is a no-op; wrong node kind, protected name, invalid value, path, or witness conflicts. |
| `remove-attr` | Ordinary element path; canonical public name | No path changes | Missing attribute is a no-op; the same target/name conflicts apply. |
| `replace-attrs` | Ordinary element path; complete canonical public bag | No path changes | Exact bag equality is a no-op; malformed/protected bags and target conflicts reject. |
| `insert-content` | HSON-node parent path; index `0..length` at its ordinal | New subtree occupies `index`; siblings at and after it shift `+1` | Invalid insertion index/content, identity admission, mode change, path, or witness conflicts reject. |
| `replace-content` | HSON-node parent path; existing index | Old subtree at the slot is retired; siblings retain paths; replacement owns the slot | Exact canonical replacement is a no-op; invalid slot/content, identity, mode, path, or witness conflicts reject. |
| `remove-content` | HSON-node parent path; existing index | Removed subtree retires; later siblings shift `-1` | A missing slot conflicts; a resulting document-mode change conflicts. |
| `move-content` | HSON-node parent path; existing `from` and `to` | Moved subtree and descendants move to final index `to`; intervening siblings shift once | `from === to` is a no-op; malformed/out-of-range indexes conflict. |
| `ensure-quid` | Eligible ordinary-element path; system-generated recorded QUID | Adds canonical `$_meta.quid` without structural path change | Existing same QUID is an operation-level no-op; malformed, colliding, ineligible, or different-existing claims reject. Replay never allocates. |
| `replace-root` | No target; same document mode | Every old path retires and the supplied canonical root becomes authoritative | Exact root equality is a no-op at install; in replay it must be the sole operation and mode must match. |

`move-content.to` is the final position after removal, not a pre-removal insertion boundary. Thus moving `1 -> 3` in `[a,b,c,d]` yields `[a,c,d,b]`, while `3 -> 1` yields `[a,d,b,c]`.

Mutation, replay, and reflection consume the same path-authoritative operation semantics. The neutral document-path module owns validation, resolution, ordering, equality, prefix, append/parent, deterministic encoding, and insertion/deletion/replacement/move/root path transforms. It contains no QUID behavior.

`ensure-quid` is produced only by the internal LiveMap authority in response to
an owner-authorized continuity facility, including exact linked identity demand.
No public LiveMap method requests it, and callers cannot select the QUID.
Document commits use the numeric document commit target; projected commits use
`{ kind: "path", path: LivePath, projected: true }`. Both are path-authoritative,
and neither accepts a raw-QUID route. Candidate generation is outside replay and
outside the canonical operation reducer. One changed registration advances the
ordinary revision once and publishes through ordinary canonical commit and
history observers; reuse publishes nothing. Projected value feeds, links, and
stores publish nothing for metadata-only registration because their values are
unchanged. The operation is
additive in current exact LiveHost graph transport because it preserves the
established graph discriminants, path target, and recorded scalar value without
changing the envelope version. Replay validates the recorded value and never
allocates.

Identity acquisition accepts a path-only target even though active ordinary
document mutations retain path-or-QUID request compatibility. This fence keeps
raw QUID bytes from becoming handle constructors. Ineligible primitives and
structural carriers, malformed paths, and graph/overlay disagreement reject
before publication. Projected eligibility is restricted to the semantic
`_hson_obj` or `_hson_arr` reached by the supplied user path; property and
array-item wrappers are never registration targets.

### Same-epoch identity non-reuse

Graph staging carries an immutable issued-QUID ledger alongside the sparse
active overlay. A new `ensure-quid` admission enters both; retirement changes
only the active overlay. Each later operation in a batch sees QUIDs issued by
earlier ordinals even if a later ordinal retires them. Allocation retries an
issued candidate, while replay and incoming QUID-bearing content reject retired
same-epoch reuse without allocating. Active collision and retired issued reuse
remain distinct structured conflicts.

Failure publishes neither graph, revision, active overlay, issued ledger,
history, observation, nor handle state. Whole-root new-epoch admission instead
validates and seeds a fresh ledger from active metadata. Exact same-epoch
capture restoration retains the living monotonic ledger; it cannot roll state
back to the capture-time issued population.

### Projected rename and move intent

Projected object rename and array move are canonical semantic operations rather
than broad endpoint replacements:

| Operation | Domain | Exact effect | No-op and conflict rules |
|---|---|---|---|
| `rename` | Existing ordered object at `path`; own string `from`; string `to` | The source subtree is relabeled at its former position. An existing destination entry retires at its former position. Descendants retain their suffixes. | Missing source and invalid keys reject. `from === to` is a no-op only after source validation. |
| `move` | Existing dense array at `path`; nonnegative safe `from` and `to` valid in the staged array | The source subtree occupies final post-removal index `to`; intervening siblings shift once. Descendants retain their suffixes. | Invalid, negative, unsafe, or out-of-range indexes reject. `from === to` is a no-op. |

Both operations carry exact ordered `prev` and `next` witnesses in commits and
exact structural transport. Replay checks the staged `prev`, applies the semantic
operation directly in carrier space, and verifies `next`. Newly produced history
never collapses either operation to `set`, `replace`, or inferred structural
equality. No QUID is minted. Unit 11 transforms sparse identity paths directly
from `path`, `from`, and `to` without guessing from shape.

Rename rewrites the moved source prefix, preserves descendant suffixes, and
retires claims below a displaced destination. Move applies the final post-removal
index, follows descendants, and shifts intervening siblings exactly once.
Splice shifts surviving later claims and retires removed ranges. Delete, set,
and replace retire claims at or below the displaced target, including
structurally equal explicit replacement. Descendant leaf mutation does not
retire an identified ancestor container. These are metadata/path effects only;
ordinary mutation never allocates a QUID.

apply

apply({ prevRev, value }) conditionally replaces the projected root.

The operation succeeds only when:

prevRev === map.rev

A successful changed apply:

* performs a root replace;
* passes through schema and editor preflight;
* produces one commit;
* advances the revision once.

An unchanged apply returns a no-op commit.

A stale apply throws LiveMapRevError.

replay

replay({ prevRev, ops }) applies semantic operation records conditionally.

Replay validation occurs in this order:

1. validate the replay envelope;
2. validate every operation structurally;
3. validate the expected revision;
4. compare every declared prev with detached candidate state;
5. project every operation against the detached candidate;
6. compare every declared next with the computed result;
7. perform schema and graph preflight;
8. mutate once;
9. emit one commit.

Replay failure categories are distinct:

* INVALID_REPLAY
    * malformed envelope or operation record;
* STALE_REV
    * valid replay based on an old revision;
* REPLAY_CONFLICT
    * valid replay inconsistent with current or computed state;
* SCHEMA_VALIDATION
    * structurally valid replay rejected by schema.

Replay is atomic across all operations.

Equality

Generic projected equality is ordered structural SameValue equality.

Object-property order and array order are semantic. Existing object properties
retain their position, new properties append in admitted order, and complete
replacement adopts the admitted order. `0` and `-0` are different. Missing is
different from every present value. Equality never normalizes or repairs a
candidate while comparing it.

Detached plain JavaScript objects follow the host language's integer-key
enumeration order. They are not used to reconstruct exact canonical order;
exact capture/replay uses the structural payload instead.

Defensive copying

Public commits, captures, and replay preparation must not retain mutable references supplied by callers.

Mutating an input path, object, array, prev, next, removed, or inserted value after a successful mutation must not alter:

* committed state;
* stored operation records;
* later feed events.

Projected public objects are fresh ordinary objects built with own data
properties, including `__proto__`, `constructor`, and `prototype`. Mutating a
public result cannot alter canonical state, commits, later reads, or another
listener result.

Schema behavior

Schema validation examines the complete projected candidate state.

Schema failure:

* occurs before live graph mutation;
* consumes no revision;
* emits no feed event;
* leaves the map unchanged.

Schema concerns shape and validity. It does not redefine mutation semantics.

Schema validates the same admitted projected-value domain. Optional means a
property may be missing; a present `undefined` value is invalid. Schema literals
are detached at definition and compared with ordered SameValue equality. Custom
refinements intentionally execute on fresh detached public materializations.

Feed behavior

A changed commit may emit feed events after mutation.

A subscriber is notified at most once per commit.

For a subscriber path:

* event.op is the first overlapping operation;
* event.ops contains all overlapping operations;
* event.value is read from the final committed state;
* event.commit carries the complete revisioned commit.

No-op and rejected mutations emit no feed event.

Non-goals

This contract does not define:

* physical HSON node surgery;
* peer-to-peer merging;
* CRDT behavior;
* automatic stale-write rebasing;
* partial batch success;
* arbitrary distributed conflict resolution;
* DOM or LiveTree reconciliation.

Required invariants

Tests must continue to prove:

* schema preview and graph application remain equivalent;
* every failure mode is atomic;
* revisions advance only on changed commits;
* replay errors preserve their precedence;
* operation records are detached and transport-safe;
* semantic splice operations remain semantic;
* feed events reflect the final committed state.

---
