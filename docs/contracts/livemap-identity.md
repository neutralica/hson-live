// identity.md

# Path and Identity Contract
## Status
This document defines the distinction between projected location and persistent graph identity.
The distinction is fundamental to LiveMap, LiveTree, reconciliation, and LiveHost.
## Core rule
A path identifies a location.
A QUID identifies a graph node.
These are not interchangeable.
## Paths
A `LivePath` describes where a projected value is currently located.
Examples:

```ts
["user", "name"]
["items", 3]
[]
```

A path may continue to exist while the value or graph node at that path changes.

A path may become invalid when:

* an object key is deleted;
* an array is shortened;
* a subtree is replaced;
* the projected shape changes.

A path does not promise to follow a value after it moves.

Path handles

A path-oriented handle follows a location.

For example:

const handle = map.path(["items", 2]);

The handle refers to the projected location ["items", 2].

If array items move, the handle continues to refer to index 2. It does not automatically follow the item that previously occupied index 2.

A cached path handle may therefore observe a different node or value after:

* splice;
* move;
* replacement;
* deletion followed by insertion;
* root application or replay.

This is expected behavior.

QUID identity

A QUID identifies a specific HSON graph node.

QUID identity may survive location changes when the same physical graph node is moved or reattached without replacement.

QUID identity does not survive replacement by a different graph node merely because the projected value is equal.

A QUID is not a projected path.

Identity-oriented references

A future identity-oriented reference should have semantics distinct from path handles.

Conceptually:

type NodeRef = {
  readonly quid: string;
};

An identity reference follows the node associated with the QUID, subject to lifecycle and graph ownership.

It may become detached or invalid when:

* the node is deleted;
* the node is replaced;
* its graph is disposed;
* the reference crosses an unsupported authority boundary.

An identity reference must not silently fall back to the old path when its node disappears.

Replacement

Exact replacement creates a new endpoint value.

Unless implementation explicitly preserves physical node identity, replacement must be treated as identity replacement.

Equal projected data does not imply equal graph identity.

Arrays

Array indices are locations.

They are not item identities.

For keyed reconciliation, item identity must come from an explicit source such as:

* a stable user-provided key;
* a schema-recognized identity key;
* a QUID;
* another declared identity extractor.

Index-based identity is acceptable only when position itself is the intended identity.

Moves

A move and a delete-plus-insert may produce similar projected arrays while having different identity consequences.

Semantic reconciliation may preserve identity across a move.

Snapshot-only reconciliation may be unable to distinguish a move from replacement.

When operation intent is available, reconciliation should prefer it.

Keyed binding

A keyed LiveTree binding must declare how keys are derived.

The binding must not ambiguously combine:

* current path;
* current array index;
* QUID;
* user key.

A key extractor must produce a stable identity within the binding scope.

Duplicate keys are invalid unless the binding explicitly defines otherwise.

Path rebasing

Nested bindings may need to rebase paths after array or object changes.

Rebasing a path changes location tracking. It does not establish identity.

A binding that follows identity must resolve the current path from its identity source rather than assuming its original path remains valid.

Host synchronization

LiveHost messages should transmit paths and operation records where location semantics are intended.

QUIDs may be transmitted when graph identity is part of the protocol.

A client must not assume that a local QUID is globally meaningful unless the host contract explicitly establishes shared QUID identity.

The authority determines whether QUIDs are:

* session-local;
* graph-global;
* stable across snapshots;
* stable across persistence;
* transport-visible.

Snapshots and identity

A snapshot represents projected value state.

A projected JSON snapshot does not necessarily preserve graph identity.

Applying or resynchronizing from a snapshot may recreate graph nodes with new QUIDs.

Any guarantee that identity survives snapshot replacement must be explicit and tested.

Handle invalidation

Handles and references must define their invalidation behavior.

A path handle may remain valid as a location handle even when its previous value is gone.

A QUID reference should report that its node is absent or detached.

Neither should silently reinterpret itself as the other.

Non-goals

This contract does not yet define:

* persistent database identity;
* cross-process QUID allocation;
* identity migration across schema versions;
* automatic item-key inference;
* weak-reference or garbage-collection behavior;
* peer-generated global identifiers.

Required invariants

Tests must continue to prove:

* path handles follow locations;
* identity references follow nodes;
* replacement does not accidentally preserve identity;
* moves preserve identity only when promised;
* duplicate keyed identities are handled deterministically;
* snapshot resynchronization states its identity consequences;
* disposal invalidates identity-bound resources predictably.

---
