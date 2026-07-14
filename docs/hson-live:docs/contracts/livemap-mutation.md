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

capture() returns detached projected state with the revision at which it was observed.

type LiveMapCapture<TValue> = Readonly<{
  rev: number;
  value: TValue;
}>;

A capture must remain stable after later map mutations.

A capture is observed state. It is not itself a mutation request.

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

Projected JSON equality is structural.

Object key insertion order is not semantically meaningful.

These values are equal:

{ a: 1, b: 2 }
{ b: 2, a: 1 }

Array order is meaningful.

Primitive equality follows JSON value semantics.

Defensive copying

Public commits, captures, and replay preparation must not retain mutable references supplied by callers.

Mutating an input path, object, array, prev, next, removed, or inserted value after a successful mutation must not alter:

* committed state;
* stored operation records;
* later feed events.

Schema behavior

Schema validation examines the complete projected candidate state.

Schema failure:

* occurs before live graph mutation;
* consumes no revision;
* emits no feed event;
* leaves the map unchanged.

Schema concerns shape and validity. It does not redefine mutation semantics.

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
