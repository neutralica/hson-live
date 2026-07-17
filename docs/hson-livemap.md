#### hson-live / hson.terminalgothic.com

<!-- 
LiveMap is the local state and mutation layer for hson-live. It provides a deterministic structured-state projection over an underlying HSON graph. Callers use ordinary projected paths such as ["user", "name"] rather than physical HSON wrapper paths, while the underlying graph preserves the structural information needed for HSON representation, serialization, validation, and projection.

LiveMap mutations pass through a coordinated commit pipeline. A requested operation is resolved against a canonical projected path, checked for valid input, normalized into write intent, validated against a candidate projected root, preflighted against a cloned HSON graph, applied to the live graph only after validation succeeds, recorded as one or more semantic operations, assigned a revision when state changes, and delivered to overlapping subscribers.

Each successful projected mutation produces a data-shaped commit. A commit records its previous revision, resulting revision, changed status, and semantic operations such as set, replace, delete, or splice. These commits do not contain DOM nodes, LiveTree objects, handles, proxies, or closures, making them suitable for replay, debugging, transport, and hosted authority.

LiveMap schemas combine TypeScript-inferred state structure with runtime validation. The same schema can guide TypeScript-facing APIs and validate live graph state before accepting mutations. If a proposed operation would violate expected value type, node kind, array behavior, required object structure, or document constraints, LiveMap can reject the operation before changing the authoritative graph.

LiveMap also provides path handles, feeds, proxies, object and array helpers, snapshots, capture/apply/replay operations, and explicit bindings to LiveTree. These features allow the graph to drive local views, DOM projections, inspectors, editors, and LiveHost replication through ordered commits and snapshots.

LiveMap snapshots are local revisioned state captures. Hosted snapshot transport, recovery policy, and client coordination are LiveHost concerns.
 -->


# LiveMap
Updated: 2026-07-17

LiveMap presents a mutable HSON graph as structured projected application state.
It is designed to make the same graph useful in three roles:

- canonical structured HSON storage;
- ordinary object, array, and primitive application state; and
- a source of explicit, replayable changes for views and hosted authority.

The implemented local-state core includes projected paths, atomic mutations,
commits, revisions, feeds, schema validation, path handles, proxies,
array/object helpers, links, and capture/apply/replay.

LiveHost now builds on those facilities with authoritative hosted state,
ordered commits, snapshots, recovery, reconnect behavior, deduplication, and
multi-client coordination. Further roadmap work includes identity-aware
reconciliation, deterministic lifecycle scopes, richer derived views,
persistence, authorization, and broader operational hardening.

This document describes LiveMap's implemented semantics, architectural
boundaries, and roadmap direction without presenting planned behavior as
current API. The complete implemented callable surface is documented in
`api-livemap.md`.

---

## Status vocabulary

The following terms are used deliberately:

- **Implemented** means the behavior exists in the current source.
- **Contract direction** means repository contracts define the intended
  semantics and the current implementation substantially follows them.
- **Roadmap** means the design is coherent with the current architecture but is
  not yet a callable or complete public guarantee.

Roadmap material describes the intended completed system. Applications must use
`api-livemap.md`, rather than this design discussion, to determine what can be
called today.

---

## One graph, two views

Every LiveMap owns a canonical HSON node graph with one retained root node.

```ts
const map = hson.liveMap.fromJson({
  user: { name: "Ada" },
  tags: ["author", "maintainer"],
});

map.snap();                    // complete projected JSON value
map.snap(["user", "name"]);  // "Ada"
map.root();                    // live HsonNode root
```

The projected path `["user", "name"]` crosses whatever `_hson_obj`, property,
and primitive VSN wrappers are required by the HSON graph. Callers do not need
to encode those wrappers in a `LivePath`.

This separation is fundamental:

- projected operations express state meaning;
- HSON wrappers preserve structural representation; and
- raw node operations remain available for deliberately physical graph work.

The projected reader converts the current node payload into detached JSON
values. Mutating a returned object or array does not mutate the map. In
contrast, `root()` intentionally returns the live graph, and `node(path)` can
mutate it directly; those are low-level escape hatches.

---

## Paths are locations

A `LivePath` is an array of string object keys and non-negative integer array
indexes:

```ts
type LivePath = readonly (string | number)[];
```

Examples:

```ts
[]                    // projected root
["user"]              // object property
["items", 3, "name"] // array index followed by object property
```

Paths are exact and unambiguous. They do not split dots, coerce strings to
numbers, contain wildcards, or use raw HSON node positions.

A path identifies a current location, not a persistent value identity. A
cached handle for `["items", 2]` continues to address index 2 after a splice; it
does not follow the item that previously occupied that position.

This distinction supports two different future references:

- location handles follow projected paths; and
- identity references follow graph nodes.

The first is implemented. Full identity-oriented node references and
identity-preserving keyed reconciliation remain roadmap work.

---

## The mutation pipeline

Implemented projected mutations pass through one coordinated pipeline:

1. validate the public path and JSON input;
2. normalize the request into write intent;
3. project a complete candidate root for schema validation;
4. preflight the writes against a cloned HSON graph;
5. mutate the live authoritative graph;
6. create one normalized commit;
7. advance the revision when the commit changed state; and
8. synchronously notify overlapping feeds from the committed graph.

A batch is synchronous and local to one LiveMap. It does not remain open across
`await`, coordinate several maps, or reserve a hosted revision while
asynchronous work completes.

Schema or editor failure occurs before the live graph is changed. Explicit
`batch()` groups multiple synchronous writes into one preflight and one commit,
so a failing write prevents the entire batch from being applied.

Raw operations through `root()` or `node(path)` do not use this pipeline. They
do not validate schemas, advance revisions, create commits, or notify feeds.

---

## Constructive set and exact replacement

LiveMap makes object patching explicit without making every set a deep merge.

`set(path, value)` requires the endpoint to exist. At an existing object
endpoint, an object value expands into shallow child writes and preserves
unspecified siblings:

```ts
map.set(["user"], { name: "Grace" });
// existing user.role survives
```

Primitives, arrays, and `null` are assigned as endpoint values. If an existing
endpoint is not an object, setting an object replaces that endpoint rather than
patching a non-object.

`setMany(path, values)` is the explicit shallow object operation. It requires
an existing object at `path`, can create the supplied child keys, and preserves
other keys.

`replace(path, value)` is destructive endpoint replacement. `replace(value)`
replaces the projected root while overwriting the owned root node in place, so
the Core and its existing path handles remain attached.

`delete(path)` removes an existing projected property. Array structure is
changed through semantic splice/array helpers rather than direct index delete.
The empty path is not deletable.

There is no implicit missing-parent construction. New object children are
created through `setMany` or `handle.object.setKey` after their parent object
already exists.

---

## Semantic operations and commits

Every successful projected mutation returns a `LiveMapCommit`:

```ts
type LiveMapCommit = Readonly<{
  changed: boolean;
  prevRev: number;
  rev: number;
  ops: readonly LiveMapOp[];
}>;
```

Public operations are `set`, `replace`, `delete`, and `splice`. Each records its
projected path and previous/next value. Splice additionally records its start,
removed values, and inserted values.

One method call can produce several operations. Object-valued `set`,
`setMany`, `batch`, and replay are the common examples. A feed subscriber is
still called at most once for that commit and receives all matching operations.

Structural JSON equality determines whether a write changed state. Object key
insertion order is ignored by Core equality; array order remains significant.
A no-op commit has no operations and consumes no revision.

Commits are data-shaped for replay and transport. They do not contain map,
handle, Proxy, DOM, or LiveTree objects.

---

## Revisions, capture, apply, and replay

Revisions impose a local total order on changed commits:

```text
changed commit: rev = prevRev + 1
no-op commit:   rev = prevRev
```

`capture()` returns the projected root and its revision. `apply()` performs a
conditional root replacement only when its `prevRev` still matches the map.
`replay()` conditionally re-applies normalized operation records and verifies
both their declared previous values and computed next values before mutation.

These operations form the implemented local foundation for LiveHost:

- captures provide snapshot envelopes;
- commits provide ordered semantic deltas;
- revision checks detect stale bases; and
- replay conflict checks prevent applying an incompatible history.

These LiveMap operations do not themselves define transport, persistence,
retry policy, authorization, conflict merging, or multi-writer consensus.
Those responsibilities belong outside LiveMap. LiveHost now implements the
authoritative transport, recovery, retry, deduplication, and session-facing
parts of that boundary, while persistence and authorization remain separate
concerns.

A revision is meaningful only within the history and authority domain that
issued it. Revision 12 in one LiveMap or host session is not interchangeable
with revision 12 in another.

---

## Feeds and subscription views

Feeds subscribe to path overlap, not merely exact path equality. A change at
`["user", "name"]` overlaps feeds at `[]`, `["user"]`, and
`["user", "name"]`, but not `["user", "role"]`.

The event contains:

- the subscriber's path;
- the first matching operation;
- every matching operation from the commit;
- the complete commit; and
- the final projected value at the subscriber's path.

The `sub` surface builds store-style views over feeds:

- every changed root event;
- root before/after differences;
- selected values; and
- one projected path with before/after values.

All current notification is synchronous after graph mutation. Disposal is a
returned idempotent function. General lifecycle scopes that own groups of
subscriptions, bindings, timers, and keyed child resources are roadmap work,
although the repository lifecycle contract already describes their intended
semantics.

---

## Handles and proxies

`map.at(path)` returns a stable path-oriented handle. Core caches handles by
path, so repeated calls for the same canonical path return the same handle
object. The handle reads the current value at that location and exposes scoped
mutations, feeds, object helpers, array helpers, and one-way linking.

`map.proxy()` is an ergonomic path builder:

```ts
const state = map.proxy();

state.user.name.$_.snap();
state.user.name.$_.set("Grace");
state.tags[0].$_.replace("writer");
```

Property access only builds a path. `$_` exits the Proxy and returns the normal
path handle. Direct assignment and JavaScript `delete` are rejected so Proxy
syntax cannot bypass validation or commit generation.

The Proxy does not make paths into object references or add transparent
reactivity. It is syntax over the same location semantics as `at(path)`.

---

## Schemas

LiveMap schemas combine runtime validation with inferred TypeScript state
types. A schema is attached only after the current projected root validates.
Each later projected commit validates the complete candidate root before live
mutation.

```ts
const UserState = hson.liveMap.schema.define((s) => ({
  user: s.exact({
    name: s.string,
    role: s.literal("author", "editor"),
  }),
  tags: s.string.array,
}));

const typed = map.schema.use(UserState);
```

The builder currently supports primitives, literals, choices, tagged choices,
lazy recursion, refinements, arrays, tuples, records, ordinary objects, exact
objects, partial objects, and deep-partial objects. Tokens can be optional or
nullable.

Schema validation governs projected JSON state. It does not validate direct raw
HSON node edits. The current `readonly` schema modifier is recorded in schema
rules but is not enforced as a mutation prohibition; treating it as access
control is roadmap behavior.

---

## LiveTree projection

LiveMap owns state; LiveTree owns a mutable presentation graph and optional DOM
projection. The current public bridge is explicit on LiveTree:

```ts
tree.bind.text(map, ["user", "name"]);
tree.bind.attr(map, ["user", "role"], "data-role");
tree.bind.css(map, ["theme", "color"], (color) => ({
  color: String(color ?? ""),
}));
```

Bindings apply the current value and subscribe to later changes until disposed.
They do not make LiveTree and LiveMap the same graph, and they do not currently
provide automatic keyed list reconciliation.

The completed design can build on the same boundary with:

- keyed child scopes;
- identity-aware list movement;
- deterministic disposal on removal/replacement;
- reusable schema-derived controls; and
- scheduled/coalesced derived render passes.

Those facilities are consistent with the present architecture but remain
roadmap rather than current LiveMap API.

---

## Links, authority, and replication

Implemented one-way links forward selected local changes from one LiveMap to
another. They are intentionally narrow: no initial synchronization, no
bidirectional loop protection, no transforms, and no conflict resolution.

The implemented distributed model is authoritative rather than peer-to-peer.
LiveHost establishes a single accepted revision order, and clients recover,
mirror, and propose changes against that authority. Actions and conditional
proposals cross the authority boundary, while snapshots and ordered commits
return from it.

LiveHost does not turn LiveMap into a CRDT or provide automatic divergent-history
merging.

This preserves a clean separation:

- LiveMap defines local state and semantic changes;
- LiveHost defines authority, sessions, transport, and resume policy; and
- LiveTree defines presentation and DOM behavior.

CRDT behavior, multi-master consensus, and automatic divergent-history merging
are not goals of the initial architecture.

---

## Stored state and derived state

LiveMap stores authoritative projected state and emits semantic changes to that
state. Consumers may derive display values, filtered collections, validation
messages, or presentation graphs from snapshots and feeds, but those derived
values are not implicitly inserted back into the map.

LiveMap does not currently provide a general computed-value dependency graph.
Derived views remain explicit consumers of snapshots, feeds, schemas, or
application-level selectors.

---

## Identity direction

The current `LiveMapPathHandle.quid` identifies the handle object through an
experimental runtime registry. It is not stored in projected JSON, is not the
QUID of the HSON value currently at that path, and does not turn the handle into
an identity-following reference.

The idealized system distinguishes:

- a path, which follows location;
- a node QUID, which follows a particular graph node while that identity is
  alive;
- an application key, which identifies a domain item within a declared scope;
  and
- a host/session identifier, which belongs to replication lifecycle.

These identifiers must never be silently substituted for one another. A future
identity-oriented reference should become absent when its node disappears,
rather than falling back to the old path.

---

## Current limitations that affect the model

The following current behaviors should not be mistaken for idealized
guarantees:

- Object-root `fromJson` construction is seeded through `replace()` and
  currently begins at revision 1, while other construction paths begin at 0.
- `root()` and `node(path)` expose live physical graph mutation outside schema,
  commit, revision, and feed accounting.
- Feed listener exceptions are not isolated. State and revision have already
  committed when listeners run, and a thrown listener can escape the mutation
  call and interrupt delivery to later listeners.
- The lower-level `link_livemap` implementation does not currently propagate a
  standalone semantic `splice` operation; handle-level `linkTo` forwards the
  resulting scoped value.
- Schema `readonly` is descriptive today, not enforced write protection.
- Experimental QUID helpers track object owners, not persistent graph identity
  across snapshots or processes.

These are documented implementation boundaries, not requirements of the
completed architecture.

---

## Non-goals

LiveMap is not intended to provide:

- transparent mutation through ordinary JavaScript assignment;
- peer-to-peer conflict-free replication;
- automatic persistence or authorization;
- implicit deep reactivity over arbitrary objects;
- automatic identity-preserving DOM reconciliation; or
- unrestricted raw graph mutation with commit accounting.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
