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

The implemented local-state core includes projected paths, atomic mutations, commits, revisions, feeds, schema validation, path handles, proxies, array/object helpers, links, and capture/apply/replay.

LiveHost now builds on those facilities with authoritative hosted state, ordered commits, snapshots, recovery, reconnect behavior, deduplication, and multi-client coordination. Further roadmap work includes identity-aware reconciliation, deterministic lifecycle scopes, richer derived views, persistence, authorization, and broader operational hardening.

This document describes LiveMap's implemented semantics, architectural boundaries, and roadmap direction without presenting planned behavior as current API. The complete implemented callable surface is documented in `api-livemap.md`.

---

## Status vocabulary

The following terms are used deliberately:

- **Implemented** means the behavior exists in the current source.
- **Contract direction** means repository contracts define the intended semantics and the current implementation substantially follows them.
- **Roadmap** means the design is coherent with the current architecture but is not yet a callable or complete public guarantee.

Roadmap material describes the intended completed system. Applications must use `api-livemap.md`, rather than this design discussion, to determine what can be called today.

---

## One graph, two views

Every LiveMap owns a detached canonical HSON node graph. Construction clones and validates caller-owned input before selecting a data or document façade.

```ts
const map = hson.liveMap.fromJson({
  user: { name: "Ada" },
  tags: ["author", "maintainer"],
});

map.snap();                    // complete projected JSON value
map.snap(["user", "name"]);  // "Ada"
map.root();                    // detached canonical HsonNode clone
```

The projected path `["user", "name"]` crosses whatever `_hson_obj`, property, and primitive VSN wrappers are required by the HSON graph. Callers do not need to encode those wrappers in a `LivePath`.

This separation is fundamental for data maps:

- projected operations express state meaning;
- HSON wrappers preserve structural representation; and
- canonical graph ownership remains private to the LiveMap.

The projected reader converts the current node payload into detached JSON values. `root()` likewise returns a detached structural clone of the canonical graph. Public callers never receive a live mutable alias to the canonical graph.
The former `debug.node(...)` escape hatch is removed and has no public raw-node
replacement.

For projected-data maps, the HSON graph remains the sole authoritative state.
LiveMap uses a private immutable ordered carrier only while admitting values,
planning and comparing mutations, validating schemas, and encoding exact
transport. It does not keep a synchronized JavaScript-object shadow of the
graph.

JavaScript ingress accepts strings, booleans, `null`, finite primitive numbers,
plain or null-prototype objects, and dense ordinary arrays. Own properties must
be enumerable string-keyed data properties. Accessors, symbols, nonenumerable
properties, custom prototypes, boxed values, exotic built-ins, sparse arrays,
explicit `undefined`, cycles, and array extras reject. Repeated acyclic
references are copied structurally. Ordinary accessors reject without executing
their getter or setter. Proxies are unsupported and reflective admission may
execute traps because JavaScript provides no reliable general proxy detector.

Dangerous names such as `__proto__`, `constructor`, and `prototype` remain own
data. Public reads are fresh ordinary JavaScript objects and arrays; they cannot
mutate the graph or another read. Canonical and object-helper ordered reads
preserve graph order, while a plain object snapshot necessarily follows
JavaScript integer-key enumeration. Such a snapshot is not exact ordered
persistence, and re-ingress may adopt that observable order.

Document roots are classified separately as `element` or `fragment` and do not expose the projected data surface. `element.node()`, `document.root()`, and `document.content()` return detached canonical values. Revision-coupled capture is discriminated by `kind: "hson-document"` and `version: 2`; version-1 captures reject explicitly as unsupported. Document maps support same-mode `install`, exact-revision `restore`, graph `replay`, commit observation, and canonical document mutation. Attribute and content operations live under `map.document`, for example `map.document.attrs.set(target, name, value)` and `map.document.content.replace(target, index, replacement)`. There are no `setAttrs`-style methods and no projected data methods on document maps.

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

Paths are exact and unambiguous. They do not split dots, coerce strings to numbers, contain wildcards, or use raw HSON node positions.

A path identifies a current location, not a persistent value identity. A cached handle for `["items", 2]` continues to address index 2 after a splice; it does not follow the item that previously occupied that position.

This distinction supports two different future references:

- location handles follow projected paths; and
- identity references follow graph nodes.

The first is implemented. Full identity-oriented node references and identity-preserving keyed reconciliation remain roadmap work.

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

Mutating a detached value from `snap()`, `root()`, capture, watch, or feed observation has no effect on the map. Canonical mutation always passes through the LiveMap admission pipeline.

---

## Constructive set and exact replacement

LiveMap makes object patching explicit without making every set a deep merge.

`set(path, value)` requires the endpoint to exist. At an existing object endpoint, an object value expands into shallow child writes and preserves unspecified siblings:

```ts
map.set(["user"], { name: "Grace" });
// existing user.role survives
```

Primitives, arrays, and `null` are assigned as endpoint values. If an existing endpoint is not an object, setting an object replaces that endpoint rather than patching a non-object.

`setMany(path, values)` is the explicit shallow object operation. It requires an existing object at `path`, can create the supplied child keys, and preserves other keys.

`replace(path, value)` is destructive endpoint replacement. `replace(value)` replaces the projected root while overwriting the owned root node in place, so the Core and its existing path handles remain attached.

`delete(path)` removes an existing projected property. Array structure is changed through semantic splice/array helpers rather than direct index delete. The empty path is not deletable.

There is no implicit missing-parent construction. New object children are created through `setMany` or `handle.object.setKey` after their parent object already exists.

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

Public operations are `set`, `replace`, `delete`, and `splice`. Each records its projected path and previous/next value. Splice additionally records its start, removed values, and inserted values.

One method call can produce several operations. Object-valued `set`, `setMany`, `batch`, and replay are the common examples. A feed subscriber is still called at most once for that commit and receives all matching operations.

Projected-value equality is ordered and uses JavaScript SameValue semantics.
Object-property order and array order are semantic, and `0` differs from `-0`.
Missing and present values are distinct. Selector-result comparison remains a
separate `Object.is` or caller-supplied-comparator contract. A no-op commit has
no operations and consumes no revision.

Commits are data-shaped for replay and transport. They do not contain map, handle, Proxy, DOM, or LiveTree objects.

---

## Revisions, capture, apply, and replay

Revisions impose a local total order on changed commits:

```text
changed commit: rev = prevRev + 1
no-op commit:   rev = prevRev
```

Normal construction establishes initial state at revision 0 without producing an instantiation commit. Revision therefore counts committed transitions on the current map instance rather than construction steps.

On data maps, `capture()` returns a detached compatibility projection, the
revision, and an exact versioned structural-JSON payload. The exact payload
preserves property order, dangerous keys, and negative zero without crossing a
plain-object intermediary. `apply()` performs a conditional root replacement
only when its `prevRev` still matches the map. `replay()` conditionally
re-applies normalized operation records and verifies both their declared
previous values and computed next values before mutation. Exact fields take
precedence; malformed exact data rejects without falling back to a legacy
value/op shape. Legacy shapes remain readable but lossy, with no removal release
currently assigned.

These operations form the implemented local foundation for LiveHost:

- captures provide snapshot envelopes;
- commits provide ordered semantic deltas;
- revision checks detect stale bases; and
- replay conflict checks prevent applying an incompatible history.

Document maps instead return a detached canonical HSON capture preserving ordered content, attrs, metadata, and persisted element QUIDs. Their local `install(capture, { expectedRev? })` transition validates and clones a same-mode capture with optional sparse persisted identity before atomically swapping root and QUID index. It advances the target's revision once and does not adopt the source `capture.rev`. The resulting commit contains one `{ domain: "graph", op: "replace-root" }` operation. `restore(capture)` replaces canonical state at the capture's exact revision, and `replay(commit)` validates and applies one canonical graph commit. Document maps do not expose the projected data-map `apply` method.

Incremental document operations use a shared discriminated path-or-QUID target. Numeric document paths traverse physical canonical `$_content`; they are not projected JSON paths or DOM child indexes. Persisted-QUID targets resolve only through the current map's sparse index. Attribute mutation is restricted to ordinary elements and cannot edit `hson:*` metadata. Every `data-*` name is an ordinary application attribute. Content replacement swaps one existing slot, clones caller input, validates the complete candidate graph and sparse identity, and atomically replaces owned root/index state. Its commit operations are `set-attr`, `remove-attr`, and `replace-content`, never `replace-root`.

These LiveMap operations do not themselves define transport, persistence, retry policy, authorization, conflict merging, or multi-writer consensus. Those responsibilities belong outside LiveMap. LiveHost now implements the authoritative transport, recovery, retry, deduplication, and session-facing parts of that boundary, while persistence and authorization remain separate concerns.

A revision is meaningful only within the history and authority domain that issued it. Revision 12 in one LiveMap or host session is not interchangeable with revision 12 in another.

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

All current notification is synchronous after graph mutation. Disposal is a returned idempotent function. General lifecycle scopes that own groups of subscriptions, bindings, timers, and keyed child resources are roadmap work, although the repository lifecycle contract already describes their intended semantics.

---

## Handles and proxies

`map.at(path)` returns a stable path-oriented handle. Core caches handles by path, so repeated calls for the same canonical path return the same handle object. The handle reads the current value at that location and exposes scoped mutations, feeds, object helpers, array helpers, and one-way linking.

`map.proxy()` is an ergonomic path builder:

```ts
const state = map.proxy();

state.user.name.$_.snap();
state.user.name.$_.set("Grace");
state.tags[0].$_.replace("writer");
```

Property access only builds a path. `$_` exits the Proxy and returns the normal path handle. Direct assignment and JavaScript `delete` are rejected so Proxy syntax cannot bypass validation or commit generation.

The Proxy does not make paths into object references or add transparent reactivity. It is syntax over the same location semantics as `at(path)`.

---

## Schemas

`hson.liveMap.schema.define(s => expression)` is the only schema authoring
boundary. The callback receives one frozen toolkit; the reusable result is a
distinct immutable schema value that can compose inside later definitions.

```ts
const Seat = hson.liveMap.schema.define((s) => s.exact({
  connected: s.boolean,
}));

const State = hson.liveMap.schema.define((s) => s.exact({
  left: Seat,
  right: Seat,
}));

const typedState = projectedMap.schema.use(State);
```

Projected constructors include `unknown`, `string`, `number`, `boolean`,
`null`, `literal`, `pick`, `tagged`, `lazy`, `refine`, `array`, `tuple`,
`record`, `object`, `exact`, `partial`, and `deepPartial`. The retained postfix
modifiers are `optional` and `nullable`; both also work on compatible defined
projected schemas. Arrays use the single `s.array(item)` spelling.

Projected callbacks return an explicit expression. Use `s.object({...})` for an
open object and `s.exact({...})` for a closed object; returning a raw object from
the callback is not schema syntax. Declared open-object properties keep their
precise inferred types. An undeclared string key is typed as a recursively
projected string, number, boolean, null, readonly array, or readonly object,
plus `undefined` when the key is absent. `partial` and `deepPartial` take an
explicit object expression or a compatible defined object schema.

The same toolkit defines document contracts with direct known-tag builders:

```ts
const Label = hson.liveMap.schema.define((s) => s.span(s.string));
const Button = hson.liveMap.schema.define((s) => s.button(Label));
const Toolbar = hson.liveMap.schema.define((s) => s.div(Button, Button));

const candidate = hson.liveMap.fromHson(`<div><button><span>Save</span></button><button><span>Open</span></button></div>`);
if (candidate.mode === "element") {
  const typed = candidate.schema.use(Toolbar);
  typed.at([0, 0, 0]).snap(); // string
}
```

`string`, `unknown`, `tuple`, and `pick` retain every truthful projected and
document capability until an enclosing expression selects one. Invalid mixes,
such as `s.exact({ child: s.div() })` or `s.div(s.number)`, are rejected.
`repeat(item)` is a document layout for zero or more siblings. A top-level
`tuple(...)` is one multi-root fragment layout.

Tag calls with no children leave descendants broad. Explicit items form one
closed ordered layout, while one layout argument supplies the complete content.
Use `s.div(s.tuple())` for an exact-empty `div`; use `s.tuple()` for an empty
fragment layout. Known HTML and SVG names come from the same canonical catalog
as `LiveTree.create`.

The same child grammar covers any element and arbitrary tags:

```ts
const AnyTextElement = hson.liveMap.schema.define((s) => s.tag(s.string));
const Widget = hson.liveMap.schema.define((s) => s.tag.widget(s.string));
const Hyphenated = hson.liveMap.schema.define((s) => s.tag["my-widget"](s.string));

const name: string = getRuntimeTagName();
const Dynamic = hson.liveMap.schema.define((s) => s.tag[name](s.string));
```

`s.tag(...)` means an ordinary element whose tag is unconstrained;
`s.tag.foo(...)` and `s.tag["my-widget"](...)` record an exact runtime tag.
Dynamic names are captured when `define` evaluates. TypeScript conservatively
represents an arbitrary/unregistered custom tag name as `string`, while keeping
its child/layout evidence exact. Direct known-tag builders such as `s.div(...)`
retain literal tag evidence.

Schema attachment validates synchronously and permanently governs the same
owner through aliases, mutation, restore, replay, and staged authority. Reusing
the identical schema is idempotent; replacement is unsupported. Successful
attachment records governance without replacing the canonical graph, changing
revision, or publishing an event. Exact fixed paths, relative paths, proxies, mutation
inputs, watches, and LiveTree bindings all consume the retained schema evidence;
repeated or otherwise dynamic reads include `undefined`, but `undefined` never
becomes a writable document value.

---

## LiveTree projection

LiveMap owns state; LiveTree owns a mutable presentation graph and optional DOM projection. The current public bridge is explicit on LiveTree:

```ts
tree.bind.text(map.at(["user", "name"]));
tree.bind.attr(map.at(["user", "role"]), "data-role");
tree.bind.css(map.at(["theme", "color"]), (color) => ({
  color: String(color ?? ""),
}));
```

`map.at(path)` is the source endpoint. Bindings apply the current location value
and subscribe to later changes until disposed. They do not make LiveTree and
LiveMap the same graph, and they do not currently provide automatic keyed list
reconciliation.

The completed design can build on the same boundary with:

- keyed child scopes;
- identity-aware list movement;
- deterministic disposal on removal/replacement;
- reusable schema-derived controls; and
- scheduled/coalesced derived render passes.

Those facilities are consistent with the present architecture but remain roadmap rather than current LiveMap API.

---

## Links, authority, and replication

Implemented one-way links forward selected local changes from one LiveMap to another. They are intentionally narrow: no initial synchronization, no bidirectional loop protection, no transforms, and no conflict resolution.

The implemented distributed model is authoritative rather than peer-to-peer. LiveHost establishes a single accepted revision order, and clients recover, mirror, and propose changes against that authority. Actions and conditional proposals cross the authority boundary, while snapshots and ordered commits return from it.

LiveHost does not turn LiveMap into a CRDT or provide automatic divergent-history merging.

This preserves a clean separation:

- LiveMap defines local state and semantic changes;
- LiveHost defines authority, sessions, transport, and revision-based recovery; and
- LiveTree defines presentation and DOM behavior.

CRDT behavior, multi-master consensus, and automatic divergent-history merging are not goals of the initial architecture.

---

## Stored state and derived state

LiveMap stores authoritative projected state and emits semantic changes to that state. Consumers may derive display values, filtered collections, validation messages, or presentation graphs from snapshots and feeds, but those derived values are not implicitly inserted back into the map.

LiveMap does not currently provide a general computed-value dependency graph. Derived views remain explicit consumers of snapshots, feeds, schemas, or application-level selectors.

---

## Identity direction

A LiveMap path handle is identified operationally by its owning LiveMap and canonical path. It is map-local, positional, not serialized, and has no public identifier. Repeated access to the same path on one map returns the same cached handle object.

The system distinguishes:

- a path, which follows location;
- a node QUID, which follows a particular graph node while that identity is alive;
- an application key, which identifies a domain item within a declared scope; and
- a host/session identifier, which belongs to replication lifecycle.

Document-map persisted `$_meta.quid` identity is sparse and indexed within the document map. Existing valid QUIDs are preserved, ordinary elements without QUIDs remain positional and unquidded, and duplicate present QUIDs are rejected. Construction, reads, capture, and installation never mint identity.

These identifiers must never be silently substituted for one another. A future identity-oriented reference should become absent when its node disappears, rather than falling back to the old path.

---

## Current limitations that affect the model

- Normal construction establishes initial state directly at revision 0 and emits no commit. The first changed atomic transition advances 0 to 1; unchanged operations consume no revision.
- LiveMap owns its canonical graph from construction onward. Public value, graph, capture, watch, and feed observations are detached; locations and proxies are mediated owner/path capabilities.
- Feed listener exceptions are not isolated. State and revision have already committed when listeners run, and a thrown listener can escape the mutation call and interrupt delivery to later listeners.
- The lower-level `link_livemap` implementation does not currently propagate a standalone semantic `splice` operation; handle-level `linkTo` forwards the resulting scoped value.
- QUID metadata may persist through controlled exact snapshots and processes, but serialized QUID bytes alone do not prove membership in the current live epoch.


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
