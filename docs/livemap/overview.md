# LiveMap

For a fixed collection of independently typed graphs, including ordinary hosted Locus use, see [multi-library LiveMap](./multi-library.md). Solo construction remains the default for one data or document graph.

LiveMap is hson-live’s revisioned graph-state layer.

It provides deterministic reads and writes over a canonical Hson graph while exposing that graph through one of two principal interfaces:

- a **data map**, which presents JSON-like values and paths;
- a **document map**, which presents the underlying Hson document structure.

LiveMap owns local state semantics: paths, mutations, schemas, commits, revisions, batches, subscriptions, feeds, links, proxies, node handles, snapshots, restore, and replay.

It does not require a server, transport, session, or persistent backend. A LiveMap may exist entirely within one process or browser.

When remote authority, actions, connections, one-map persistence, or client
recovery are required, a LiveMap may be governed by a Locus. Those concerns are
documented separately.

---

## Place in hson-live

The principal hson-live layers have different responsibilities:

```text
Hson
  canonical structured node model and reversible notation

LiveTree
  structural interaction with an Hson graph and its renderer-facing forms

LiveMap
  revisioned state, paths, mutations, schemas, commits, subscriptions,
  links, capture, restore, and replay

Locus
  hosted authority, actions, sessions, transport, persistence,
  and remote recovery
```

LiveMap sits between the canonical Hson graph and systems that consume or govern changing state.

Conceptually:

```text
Hson graph
    ↓
LiveMap
    ├── data
    ├── document structure
    ├── subscriptions
    ├── links
    ├── schemas
    └── canonical commits
```

A LiveMap does not store JSON beside Hson or maintain a separate document model. It owns one canonical graph and exposes an interface appropriate to the map kind.

For data maps, the implementation uses a private immutable ordered
carrier between JavaScript admission and canonical graph construction. The
carrier preserves exact object-entry order, dangerous names, and SameValue
number identity while mutations, schemas, equality, feeds, links, stores, and
exact transport do their work. It is transient; there is no synchronized shadow
state beside the canonical graph.

---

## Core model

A LiveMap combines:

```text
canonical Hson graph
+ map kind
+ path semantics
+ mutation contract
+ revision
+ commit stream
+ optional schema
+ optional observers and links
```

A successful changed mutation advances the map from one exact revision to the next and produces a canonical commit describing the accepted change.

Conceptually:

```text
state at revision N
→ mutation
→ validation and preparation
→ state at revision N + 1
→ canonical commit
→ notifications
```

A no-op may complete successfully without changing the graph, advancing the revision, or producing a commit.

LiveMap is deterministic at its public boundaries. Given the same compatible starting state and the same ordered canonical commits, replay produces the same data result and document structure.

### Data JavaScript boundary

Supported ingress consists of strings, booleans, `null`, finite primitive
numbers, plain/null-prototype objects, and dense ordinary arrays. Admission
snapshots own descriptors once. It rejects accessors, symbol or nonenumerable
properties, custom prototypes, boxed/exotic objects, holes, explicit
`undefined`, array extras, and cycles. Repeated acyclic references are copied
structurally. Ordinary getters and setters do not execute; proxies are
unsupported and their reflective traps may execute.

Public projections are fresh ordinary JavaScript objects and dense arrays.
`__proto__`, `constructor`, and `prototype` remain own data properties. A public
plain object follows JavaScript integer-key enumeration and is therefore not an
exact ordered persistence form. Canonical graph reads and object-handle
`keys`/`values`/`entries` retain semantic graph order.

Data equality is ordered SameValue equality: object and array order are
semantic, `0` differs from `-0`, and missing differs from every present value.
Selector results deliberately keep their separate `Object.is` or custom
comparator contract.

---

## One graph, two principal views

LiveMap supports two related but distinct ways of working with canonical Hson.

### data maps

A data map presents its graph as JSON-like application state.

For example:

```ts
{
  profile: {
    name: "Ada",
    active: true
  },
  tags: ["graph", "document"]
}
```

Application code addresses values through data paths:

```ts
["profile", "name"]
["profile", "active"]
["tags", 0]
```

The data interface hides the physical Hson representation used to preserve object keys, array items, primitive types, ordering, and identity.

This mode is suited to:

- application state;
- records and collections;
- settings;
- typed domain data;
- synchronized models;
- state consumed independently of a renderer.

### Document maps

A document map exposes the canonical Hson document graph itself.

It preserves distinctions that data JSON cannot express completely, including:

- element tags;
- attributes;
- mixed content;
- ordered child nodes;
- documents with multiple top-level nodes;
- text and primitive leaves;
- graph identity;
- QUID metadata;
- exact structural placement.

This mode is suited to:

- HTML-like and XML-like documents;
- SVG;
- renderer-facing graphs;
- editable structured documents;
- identity-preserving capture and restoration;
- current Echo/Reflect hosted projection and local renderer bridges.

Data and document maps share revision, commit, batching, observation, capture, and replay infrastructure, but they intentionally expose different mutation surfaces.

---

## Canonical Hson backing

Every LiveMap is backed by canonical Hson nodes.

The current canonical node shape is based on:

```ts
interface HsonNode {
  _tag: string;
  _content: Array<HsonNode | string | number | boolean | null>;
  _attrs?: HsonAttrs;
  _meta?: HsonMeta;
}
```

Reserved `_hson_*` structural node forms represent distinctions required for reversible JSON and document modeling.

A data value is therefore not the stored authority. It is a typed interpretation of the canonical graph.

Conceptually:

```text
data object
       ↕
canonical Hson graph
       ↕
document/node access
```

This permits LiveMap to preserve structural information while still presenting ordinary data-oriented APIs.

The projection boundary is deliberate:

- data paths describe application values;
- node access describes physical Hson structure;
- document maps expose the structure directly;
- commits use the canonical mutation vocabulary appropriate to the map.

---

## Map creation

A LiveMap may be created from data or from an existing canonical node graph.

Conceptually:

```ts
const map = liveMap.from({
  count: 0,
  items: []
});
```

or:

```ts
const documentMap = liveMap.fromNode(documentNode);
```

The exact public constructors and overloads are listed in the API reference.

Creation establishes:

- the canonical backing graph;
- the map kind;
- the initial data or document root;
- revision state;
- graph indexes and identities;
- any supplied schema or configuration.

Creation from trusted document input differs from parsing arbitrary markup. The LiveMap boundary assumes a canonical or validated Hson graph; format parsing and transformation belong to the Hson layer.

---

## Paths

Data LiveMaps use paths composed of strings and numbers:

```ts
type LiveMapPath = readonly (string | number)[];
```

String segments address object properties. Number segments address array positions.

Examples:

```ts
[]
["user"]
["user", "name"]
["items", 2]
["items", 2, "completed"]
```

The empty path refers to the data root.

Paths describe the data model rather than the physical wrapper nodes used by canonical Hson.

This distinction matters because a data array item may physically occupy an `_hson_*` structural node with metadata, while application code addresses it simply as:

```ts
["items", 2]
```

LiveMap resolves data paths into physical graph locations internally.

---

## Path utilities

Path handling is centralized so that reads, mutations, schemas, subscriptions, links, proxies, and validation agree on path meaning.

Canonical path behavior includes:

- root represented by `[]`;
- object keys represented by strings;
- array positions represented by nonnegative integers;
- deterministic parent and child relationships;
- safe path comparison;
- prefix and containment checks;
- stable path normalization;
- rejection of unsupported path segments.

A path is a value. Callers should not depend on mutable path arrays being retained by the map.

Where APIs return paths, those paths should be treated as snapshots of the relevant location.

---

## Reads

Data maps provide ordinary value reads through methods such as:

```ts
map.snap(path)
map.at(path).snap()
```

`snap(path)` and the path-handle `snap()` method return the data value at
the path. Missing locations return `undefined`; falsy and nullable values remain
distinct from absence. Object handles provide `hasKey(key)` when key membership
must be tested directly.

Examples:

```ts
map.snap(["profile", "name"]);
map.at(["profile"]).object.hasKey("nickname");
```

Reads do not mutate the graph or advance the revision.

Returned composite values are not direct mutable access to authoritative internals. LiveMap preserves ownership of its canonical graph and does not depend on callers refraining from mutating returned object references.

The exact cloning and snapshot guarantees of each getter are documented in the API reference.

---

## Root reads

The empty path addresses the entire data root:

```ts
map.snap();
```

Root reads are useful for:

- serialization;
- testing;
- deriving local snapshots;
- comparison;
- application initialization.

Repeated whole-root reads should not replace path-specific reads or subscriptions where only a small portion of state is needed.

---

## Canonical ownership

LiveMap owns its canonical Hson graph for its entire lifetime. `snap(path)`
returns detached application data, while `root()` returns a detached canonical
graph. Captures and observer values are likewise detached. Locations and proxies
are owner/path capabilities whose writes pass through LiveMap admission. No
supported public API returns a live mutable canonical node.

Structural tooling that genuinely needs canonical object identity lives behind
private implementation/test seams and is not an alternative public spelling of
Data mutation.

---

## Mutations

LiveMap provides strict mutation methods over data paths.

Core operations include:

```ts
set
update
delete
replace
setMany
```

Additional object, array, proxy, handle, and document operations build on the same mutation machinery.

A mutation either:

- succeeds with one accepted result;
- succeeds as a no-op;
- or fails without partially changing authoritative state.

Changed mutations produce canonical commits.

---

## `set`

`set(path, value)` writes a value at an existing compatible endpoint according to the map’s strict path semantics.

Conceptually:

```ts
map.set(["profile", "name"], "Grace");
```

At an object endpoint, a shallow child write may update one existing property without replacing unrelated siblings.

`set` is not the destructive whole-subtree operation. That distinction belongs to `replace`.

Strictness prevents misspelled or structurally invalid paths from silently manufacturing unintended graph shapes.

Where creation of missing keys is supported, LiveMap provides an explicit operation for that behavior.

---

## `setMany`

`setMany(path, values)` performs multiple shallow object-property writes at one object endpoint.

Conceptually:

```ts
map.setMany(["profile"], {
  name: "Grace",
  active: true
});
```

It may create missing child keys when the endpoint itself is a valid object.

The writes form one logical mutation boundary and therefore one changed commit.

`setMany` does not recursively merge arbitrary nested structures unless the API explicitly specifies that behavior.

---

## `update`

`update(path, updater)` derives a new value from the current data value.

Conceptually:

```ts
map.update(["count"], (count) => count + 1);
```

The updater runs against the value observed within the mutation’s prepared candidate.

It should be:

- synchronous;
- deterministic;
- free of external mutation;
- free of retained graph references.

An updater does not receive uncontrolled direct access to the authoritative graph.

If the updater produces an unchanged equivalent value, the mutation may resolve as a no-op.

---

## `delete`

`delete(path)` removes an existing data value according to strict endpoint semantics.

Conceptually:

```ts
map.delete(["profile", "nickname"]);
```

A strict delete fails for an invalid or missing target rather than silently claiming a change.

Object helper APIs may separately provide no-op-on-missing deletion behavior where that is useful for idempotent domain operations.

Deleting an array item changes subsequent data indexes and produces the corresponding canonical structural operation.

---

## `replace`

`replace(path, value)` destructively replaces an entire endpoint.

Conceptually:

```ts
map.replace(["profile"], {
  name: "Grace"
});
```

Unlike a shallow object write, replacement removes prior content not represented in the new value.

Root replacement uses the empty path:

```ts
map.replace([], nextRoot);
```

Replacement is explicit because it has broader identity and subscription consequences than setting one property.

For document maps, structural replacement must also preserve canonical root invariants and update graph indexes atomically.

---

## Object helpers

Data object endpoints provide higher-level helpers for common key operations.

These include operations conceptually equivalent to:

```ts
setKey
setMany
deleteKey
deleteMany
renameKey
clear
```

Their current semantics include:

- `setKey` may create a missing key;
- object `setMany` may create several keys;
- `deleteKey` may be a no-op when the key is absent;
- `deleteMany` may ignore absent requested keys;
- `renameKey` rejects when the source key is absent;
- `renameKey` replaces an existing destination while retaining the source entry's
  position and removing the old destination position;
- `renameKey(from, from)` is a no-op only after the source is proven present;
- `clear` replaces the object with an empty object.

These helpers are useful when idempotent object-domain commands are preferable to the strict generic path operations.

They still use canonical mutation, revision, and commit machinery.

---

## Array helpers

Data array endpoints provide structural operations such as:

```ts
push
remove
replace
move
```

Depending on the current public surface, array helpers may additionally include insertion or splice-like behavior.

Array operations must maintain:

- data order;
- canonical item wrappers;
- index metadata;
- path resolution;
- schema item constraints;
- subscription behavior;
- deterministic commits.

Conceptually:

```ts
map.array(["items"]).push(item);
map.array(["items"]).remove(2);
map.array(["items"]).move(4, 1);
```

A move is structurally different from deleting and recreating an item when graph identity can be preserved.

Array endpoint rewrites may internally use canonical replacement while preserving the public array-operation contract.

---

## Batches

A LiveMap batch groups several writes into one atomic mutation boundary.

Conceptually:

```ts
map.batch((batch) => {
  batch.set(["status"], "ready");
  batch.set(["updatedAt"], timestamp);
  batch.delete(["error"]);
});
```

A batch:

- stages all requested operations;
- validates the combined candidate;
- either accepts all changes or none;
- produces one commit envelope;
- advances the revision at most once;
- notifies after the combined state is accepted.

Intermediate batch states are not authoritative and are not published individually.

Batches are appropriate when several writes form one domain transition.

They should not be used merely to hide unrelated operations in one opaque commit.

---

## Staged transitions

LiveMap internally separates mutation preparation from acceptance.

Conceptually:

```text
normalize request
→ resolve paths and schema
→ prepare detached candidate
→ compute canonical commit
→ accept exact candidate
→ notify
```

Preparation operates against a detached graph candidate.

It may perform:

- path validation;
- endpoint resolution;
- schema preview;
- structural preflight;
- canonical operation generation;
- revision calculation;
- graph fingerprinting and identity checks.

Preparation does not:

- install the candidate;
- advance the authoritative revision;
- notify feeds or subscribers;
- trigger links;
- expose the candidate as current state.

Acceptance installs the exact prepared transition.

This boundary allows internal authority controllers to delay or reject acceptance without asking the mutation to run a second time.

For ordinary standalone LiveMap use, preparation and acceptance remain one synchronous public operation.

The staged authority controller is an internal integration surface rather than a general public transaction API.

---

## Candidate validity

A prepared transition belongs to:

- one LiveMap controller;
- one authoritative generation;
- one exact starting state;
- one expected revision;
- one prepared graph candidate.

Prepared candidates cannot safely be:

- accepted twice;
- transferred between maps;
- accepted after unrelated state changes;
- modified externally;
- retained indefinitely as free-standing drafts.

Authority generations and acceptance tokens prevent stale or foreign candidate installation.

Restore, replay, management changes, and accepted mutations invalidate candidates prepared against an earlier authoritative generation.

---

## Commits

Every changed mutation produces a canonical commit envelope.

Conceptually:

```ts
interface CommitEnvelope {
  changed: true;
  prevRev: number;
  rev: number;
  ops: readonly CommitOperation[];
}
```

Current canonical operation families include:

```text
set
delete
replace
```

Higher-level API calls normalize into canonical operation forms. Object rename
and array move are retained as semantic `rename` and `move` operations; they are
not reconstructed from equal before/after values.

For example:

- an object helper may produce one or more canonical sets or deletes;
- object `renameKey` produces one canonical rename;
- array `move` produces one canonical move using nonnegative safe final indexes;
- other array transformations may produce an endpoint replacement;
- a batch may contain several canonical operations;
- a document mutation may use the document-capable canonical representation.

Commits describe accepted semantic state transitions. Rename and move intent is
canonical because later sparse identity reconciliation must distinguish movement
from delete-plus-insert or replacement.

---

## Revisions

Each LiveMap owns a monotonically advancing revision within its current authoritative history.

For a changed commit:

```text
prevRev = current revision
rev = prevRev + 1
```

Revisions allow consumers to:

- order commits;
- detect duplicates;
- detect gaps;
- verify replay continuity;
- correlate snapshots with later changes;
- reject stale restoration or transition attempts.

A no-op does not advance the revision.

Revision alone does not establish identity across unrelated map histories. Exact reconstruction and remote systems may additionally use an incarnation or equivalent authority identity at a higher layer.

---

## Commit observation

LiveMap exposes accepted commits to observers.

An observer receives only state transitions that have crossed the acceptance boundary.

Conceptually:

```ts
const dispose = map.observe((commit) => {
  // commit describes an accepted revision transition
});
```

Observation is useful for:

- local history;
- diagnostics;
- synchronization adapters;
- persistence experiments;
- testing;
- secondary projections.

Observers do not authorize or veto mutations.

A failure in an observer occurs after acceptance and must not be interpreted as mutation rejection.

Where notification isolation is enabled, one listener’s failure does not prevent unrelated listeners from receiving the accepted change.

---

## Notification order

The exact notification sequence is defined by the implementation and API reference, but the architectural boundary is:

```text
accept state
→ expose new revision
→ notify accepted-state observers
```

A listener that reads the map during notification should observe the accepted state corresponding to the commit.

LiveMap does not expose partially installed graph or index state.

Reentrant mutation is supported only through the map’s defined notification scheduling and authority behavior. Callers should not assume every observer executes in an isolated task or microtask.

---

## Schemas

LiveMap governance accepts authored HsonSchema only:

```ts
import { Hson, type HsonSchema } from "hson-live";

const UserSchema: HsonSchema = Hson`
  <type "data" content <user <content <
    name "string"
    age <optional "number">
  >>>>
`;

const map = hson.liveMap.fromJson({ user: { name: "Ada" } });
map.schema.use(UserSchema);
```

The owner retains the identical HsonSchema through `map.schema.get()`.
Attachment validates the current canonical root, and governed mutation, restore,
and replay validate before publication. `Hson.certify` is the separate generic
dynamic certification entrance. Callback authoring and schema-path resolver
helpers are not part of the LiveMap API.
## Proxies

Data maps may expose a path-oriented proxy:

```ts
const proxy = map.proxy();
```

The proxy provides ergonomic property and index traversal while preserving LiveMap mutation semantics.

Conceptually:

```ts
proxy.user.name
proxy.items[0]
```

The `$_` property exits proxy traversal and returns the ordinary path handle,
which exposes explicit LiveMap operations.

The proxy is not a plain mutable object.

Property and index reads extend the represented path. Direct assignment,
JavaScript `delete`, and property definition throw; mutations must go through
the `$_` path handle.

Proxy behavior must preserve parity with the corresponding direct APIs:

- the same paths;
- the same schemas;
- the same errors;
- the same commits;
- the same revisions;
- the same no-op rules.

The direct path API remains the clearest reference surface. The proxy is an ergonomic projection over it.

---

## Proxy lifetime

A proxy represents a path into a changing map, not a permanently retained mutable object.

A retained proxy may continue resolving its path against current state, but callers should not assume the underlying physical node is unchanged after replacement, restore, or replay.

Where an endpoint has been deleted or changed to an incompatible type, proxy operations fail according to current path semantics.

Locus management may dynamically fence proxy mutations while leaving permitted reads available.

That management behavior belongs to Locus; the proxy itself remains a LiveMap feature.

---

## Handles

LiveMap provides handles for working with a particular data or physical endpoint.

A handle may offer focused methods for:

- identity;
- data value access;
- attributes;
- children;
- insertion;
- removal;
- replacement;
- movement;
- links;
- subscriptions.

Handles make repeated work at one path less verbose than passing the path into every method.

Conceptually:

```ts
const item = map.at(["items", 2]);

item.get();
item.set(nextValue);
item.delete();
```

The exact handle constructors and method groups are documented in the API reference.

Like proxies, handles remain governed by the current map state and management mode. They do not grant permanent mutation rights to a graph location.

---

## Node handles

The advanced node API exposes physical Hson operations.

Current node-handle capabilities include operations conceptually equivalent to:

```text
attrs
children
insert
remove
replace
move
```

These operations address canonical structure rather than data JSON semantics.

They are useful when:

- manipulating documents;
- preserving node identity;
- working with mixed content;
- interacting with LiveTree;
- building structural tooling;
- performing operations not expressible as data value writes.

Node-internal operations may intentionally bypass data schemas, feeds, and subscriptions.

That is not an accidental loophole. It is a distinct low-level API with a different contract.

Application code that requires data validation and observation should use the data mutation surface.

---

## Document maps

A `DocumentLiveMap` treats canonical Hson document structure as its public state model.

A document may contain:

- a canonical root;
- user element nodes;
- attributes;
- strings and typed primitives;
- ordered child content;
- structural metadata;
- QUID identity.

Document APIs operate in terms of nodes and document paths rather than pretending the document is ordinary JSON.

This preserves distinctions such as:

```html
<p>Hello <strong>world</strong>.</p>
```

where mixed text and element content cannot be represented faithfully as a conventional object without introducing a structural notation.

---

## Document roots

Document maps enforce canonical root invariants.

Root replacement and restoration must update as one atomic operation:

- root graph;
- node indexes;
- parent relationships;
- QUID registry;
- data or document root identity;
- revision state where applicable.

The public root must never point at a graph that disagrees with its indexes.

Document root replacement is therefore not implemented as casual assignment to an internal node field.

---

## Document identity

Canonical Hson nodes may carry QUID identity.

QUIDs support stable identity across:

- local structural movement;
- document capture;
- exact restoration;
- replay;
- Reflect-managed LiveTree / DOM projection;
- Echo replay from hosted Locus authority;
- renderer reconciliation.

Identity and location are distinct.

Moving a node changes its structural path while preserving its identity when the operation supports identity-preserving movement.

Replacing a node may create new identity even if the replacement has similar visible content.

Data paths alone are therefore not sufficient as durable document identities.

---

## Document attributes

Document node handles expose typed attribute operations.

Conceptually:

```ts
node.attrs.get("class");
node.attrs.set("data-state", "ready");
node.attrs.delete("hidden");
```

Attribute mutation preserves canonical attribute rules and produces document-aware accepted changes.

Attributes are distinct from:

- data object properties;
- node metadata;
- CSS state managed by LiveTree’s CSS facilities;
- browser DOM properties.

A document attribute API should not silently collapse these categories.

---

## Document content

Document content is ordered and may include both child nodes and primitive leaves.

Operations may include:

- reading children;
- inserting content;
- removing content;
- replacing content;
- moving children;
- replacing a node;
- editing text-bearing leaves.

Document operations preserve:

- child ordering;
- parent relationships;
- canonical node invariants;
- graph indexes;
- stable identity where applicable.

A document move is preferable to remove-plus-recreate when the same node should retain identity.

---

## Trusted document input

A document map may be created from a trusted canonical HTML-derived or Hson-derived node.

The word “trusted” is significant.

LiveMap does not by itself sanitize hostile HTML, CSS, URLs, scripts, attributes, or application-defined content.

Parsing establishes structure. It does not establish permission or safety.

Applications that project documents into browser or server HTML must define a separate security and sanitization boundary.

---

## Feeds

Feeds provide accepted mutation information to listeners interested in the map’s change stream.

A feed is broader than reading one path and narrower than governing map authority.

Feeds may support:

- commit observation;
- integration adapters;
- diagnostics;
- synchronization;
- instrumentation;
- secondary state derivation.

Feed callbacks should treat commit data as immutable.

A feed does not provide a writable draft and should not be used as a substitute for batching related writes.

---

## Subscriptions

Subscriptions observe relevant accepted state.

LiveMap supports several subscription styles, including concepts such as:

```text
sub
sub.diff
sub.sel
sub.path
```

These styles serve different needs.

### Value subscription

A general subscription receives current or accepted data state according to its contract.

### Diff subscription

A diff subscription focuses on changes between accepted states.

### Selector subscription

A selector derives a value and notifies when the selected result changes according to the selector’s comparison rules.

### Path subscription

A path subscription observes one data endpoint or subtree.

All subscription methods return disposers.

Conceptually:

```ts
const dispose = map.sub.path(["profile", "name"], (name) => {
  // React to accepted changes affecting this path.
});

dispose();
```

---

## Subscription snapshots

Subscription payloads are snapshots rather than mutable aliases into the authoritative graph.

This prevents a listener from changing map state by mutating a received object or array.

It also makes comparisons and asynchronous consumption safer.

Consumers should still avoid retaining arbitrarily large snapshots when a path or selector subscription can express the actual dependency.

---

## Subscription relevance

A path subscription may be affected by more than an operation targeting that exact path.

For example, a subscription at:

```ts
["items", 3]
```

may be affected by:

- replacement of `["items", 3]`;
- deletion of `["items", 3]`;
- replacement of `["items"]`;
- movement or removal of an earlier array item;
- replacement of the root;
- restore or replay.

Subscription relevance is determined from accepted structural effects, not only string equality between the subscribed path and an operation path.

---

## Selector subscriptions

A selector subscription computes derived state:

```ts
map.sub.sel(
  (state) => state.items.filter((item) => item.completed).length,
  (completedCount) => {
    // ...
  }
);
```

Selectors should be:

- deterministic;
- free of side effects;
- reasonably bounded in cost;
- independent of mutable retained references.

LiveMap may evaluate selectors after accepted changes that could affect their result.

Selectors are not schema validators and do not participate in mutation acceptance.

Selector-result comparison is intentionally not the generic data value
comparator. The default is `Object.is`; callers may provide a comparator for the
selector's own result domain.

---

## Immediate publication

Some subscription forms publish their current value immediately upon registration.

This allows consumers to initialize from the same mechanism they use for later changes.

The exact immediate-publication behavior of each subscription method is part of its API contract and should not be inferred across all observer types.

Commit observers and value subscriptions need not have identical initial behavior.

---

## Links

LiveMap links propagate accepted state from one map or path to another.

The principal linking surface includes concepts such as:

```ts
link_livemap(from, to);
handle.linkTo(target);
```

Links are useful for:

- mirrored values;
- derived map composition;
- parent-to-child propagation;
- keeping two local graphs aligned;
- connecting state domains without global subscriptions.

A link is based on accepted source changes.

It does not observe detached prepared candidates or invalid mutations.

---

## Link direction

A link has an explicit source and target.

Conceptually:

```text
source accepted change
→ resolve linked effect
→ mutate target
→ target commit
```

A one-way link does not imply reverse synchronization.

Bidirectional links require explicit design to avoid:

- loops;
- duplicate writes;
- conflicting transformations;
- unstable ordering.

Link creation should make direction and ownership clear.

---

## Link semantics

Current link behavior includes:

- child propagation from linked parent endpoints;
- endpoint replacement;
- linked child deletion;
- creation of a missing target child where the target parent exists;
- independent target mutation and commit behavior.

A linked target does not share the source graph by reference.

The target receives an ordinary mutation according to its own:

- path semantics;
- schema;
- revision;
- observers;
- downstream links.

This keeps map identities and histories distinct.

---

## Link cycles

Cycles require protection.

A source-to-target mutation may lead to another accepted mutation that could otherwise return to the original source.

Link implementations must distinguish propagated work sufficiently to avoid uncontrolled recursive loops or repeated equivalent commits.

Applications should still avoid building ambiguous cyclic ownership models.

A link is not a general constraint solver.

---

## Link failure

Source acceptance and target propagation are distinct stages.

A source mutation is not generally rolled back because a later linked target mutation fails.

This matters when the target:

- rejects a schema;
- no longer contains a required path;
- has been destroyed;
- is governed by a different authority system.

Applications needing all-or-nothing mutation across several maps require a higher-level transaction or a single shared authoritative map.

---

## Snapshots and capture

LiveMap can capture its current state for later inspection or reconstruction.

Different capture forms serve different purposes.

A data snapshot may preserve:

- data root value;
- revision metadata;
- map configuration required by the format.

The implemented data-map capture includes a detached canonical root and the
current `structural-json` payload. The payload is the exact ordered form used by
restore/apply/replay and propagation. Malformed current transport,
`formatVersion`, and old value/op shapes reject without fallback.

An exact document view-state may additionally preserve:

- canonical graph structure;
- QUID identity;
- document indexes;
- exact revision cut; and
- an explicit `format: "view-state"` discriminator.

A snapshot is a point-in-time representation. It does not automatically include all later commits.

---

## Capture formats

Capture formats are explicit and strictly discriminated. The current public
capture and view-state envelopes do not carry numeric version fields.

Possible forms include:

```text
data value
canonical Hson
document view-state
snapshot envelope with revision
```

These forms are not interchangeable.

For example:

- data JSON may reproduce visible data but not exact graph identity;
- Hson may preserve document structure but omit runtime indexing details;
- view-state may preserve exact recoverable document identity;
- a snapshot envelope may associate one of these forms with a revision.

Callers should select a format according to the fidelity they require.

---

## Installation

Installation replaces the current authoritative graph with a captured or reconstructed state through a controlled internal boundary.

A correct install must update atomically:

- root;
- indexes;
- parent links;
- QUID registry;
- map kind invariants;
- revision metadata;
- authority generation.

Installation is not equivalent to a normal user mutation.

It may be used by:

- creation;
- exact restore;
- replay setup;
- trusted reconstruction;
- host recovery.

Public application code should use ordinary mutations unless it is intentionally performing historical reconstruction.

---

## Restore

Restore reconstructs map state from a supported capture form.

Restore is privileged because it may install:

- an older or externally stored revision;
- an exact document graph;
- preserved QUID identities;
- a replacement root and indexes;
- history metadata not produced by a current mutation.

Restore must validate the capture before installation.

A failed restore must not leave the map partially reconstructed.

Restore invalidates prepared transitions created against the prior authoritative generation.

---

## Replay

Replay applies canonical commits in revision order.

Conceptually:

```text
restore snapshot at revision N
→ apply commit N → N + 1
→ apply commit N + 1 → N + 2
→ ...
→ reach exact final revision
```

Replay validates:

- commit shape;
- expected `prevRev`;
- next revision;
- canonical operation form;
- path compatibility;
- map-kind compatibility;
- successful deterministic application.

A gap, duplicate conflict, invalid operation, or unexpected revision fails reconstruction.

Replay is historical installation, not ordinary application intent.

It should not generate a second independent commit stream for the same historical operations.

---

## Capture and replay invariants

A valid snapshot-and-tail reconstruction should satisfy:

```text
restored snapshot state
+ ordered valid commit tail
=
original final state
```

For exact document reconstruction, it should also preserve:

- canonical node structure;
- QUID identity;
- child ordering;
- root invariants;
- final revision.

These invariants make LiveMap suitable as the local state engine beneath persistence and remote recovery systems without embedding those systems into LiveMap itself.

---

## Inspection and diagnostics

LiveMap inspection remains observational. `snap()`, `root()`, captures, document
reads, watch payloads, and feed values are detached from canonical ownership.
Schema resolution returns immutable evidence, commit observation returns
detached commit material, and locations or proxies retain only mediated
owner/path capabilities.

LiveMap does not expose canonical nodes, indexes, identity maps, or a debug
mutation route through supported entrypoints. The narrow canonical reader used
by LiveInspector and low-level tests is private implementation infrastructure.

---

## Errors

LiveMap distinguishes broad failure categories such as:

- invalid path;
- missing endpoint;
- incompatible endpoint kind;
- invalid array index;
- schema failure;
- readonly path;
- invalid document structure;
- stale prepared transition;
- invalid replay;
- management conflict;
- unsupported operation.

Errors should provide stable codes or structured issue information where application handling requires more than a message string.

Mutation errors occur before acceptance unless explicitly documented as notification errors.

A failed ordinary mutation leaves authoritative state and revision unchanged.

---

## No-op semantics

A successful no-op is different from a failed mutation.

Examples may include:

- setting a value to an equivalent current value;
- deleting an absent key through an idempotent object helper;
- renaming an absent key through a no-op helper;
- applying an empty batch;
- moving an item to its existing position.

A no-op generally reports:

```ts
{
  changed: false
}
```

and does not:

- advance revision;
- produce canonical operations;
- notify commit observers;
- trigger links;
- publish subscription changes.

The exact return shape is specified by the relevant API.

---

## Equality and change detection

LiveMap must decide whether a proposed value changes the canonical graph.

This is not always equivalent to JavaScript reference inequality.

For example:

```ts
map.set(["profile"], {
  name: "Ada"
});
```

may be a no-op if the existing data value is structurally equivalent and canonicalization would produce the same graph.

Change detection must respect:

- primitive equality;
- object keys and values;
- array order;
- canonical node structure;
- attributes;
- metadata relevant to identity;
- map-kind semantics.

Identity-preserving structural operations may still count as changes when location or order changes.

---

## Determinism

LiveMap’s mutation and replay contracts are designed to be deterministic.

Determinism requires:

- canonical path interpretation;
- stable object and array transformation;
- explicit operation ordering;
- synchronous mutation callbacks;
- canonical commit generation;
- explicit, validated capture formats;
- validated replay continuity.

Application-provided custom validators, updater callbacks, and transformations should not introduce time-dependent or environment-dependent behavior unless that value is explicitly supplied as mutation input.

For example, prefer:

```ts
const now = Date.now();

map.set(["updatedAt"], now);
```

over a replay operation that calls `Date.now()` internally.

Canonical commits record results, not nondeterministic procedures.

---

## Concurrency model

A standalone LiveMap exposes synchronous local mutation semantics.

JavaScript execution therefore serializes ordinary mutations within one event loop.

However, reentrancy can still occur through:

- observers;
- subscriptions;
- links;
- application callbacks.

Each accepted mutation receives its own revision boundary.

LiveMap does not by itself coordinate independent asynchronous writers across processes.

That is an authority concern supplied by Locus or another owner.

Applications should not hold a data read, await unrelated work, and then assume the path is unchanged before writing. Use `update`, a batch, or an external authority boundary appropriate to the problem.

---

## Ownership

A LiveMap owns its authoritative graph.

Callers may inspect or capture state, but ordinary public reads do not transfer graph ownership.

This prevents accidental mutation outside:

- schema validation;
- revision tracking;
- canonical commits;
- observers;
- links;
- indexes;
- identity management.

Advanced node APIs and privileged restore/install surfaces are explicit because they operate closer to this ownership boundary.

---

## Lifecycle

LiveMap observers, subscriptions, and links return disposers or handles that should be released when no longer needed.

A map may also have a destruction or disposal lifecycle depending on its construction and integration.

Disposal should:

- stop future notifications;
- release links;
- release retained listeners;
- prevent unsupported new work;
- preserve clear failure behavior for retained handles and proxies.

A map governed by another owner may have additional lifecycle restrictions imposed by that owner.

---

## Relationship to LiveTree

LiveMap and LiveTree operate over related Hson graphs but solve different problems.

LiveMap answers:

```text
What is the current state?
How may it change?
What revision is it?
What commit describes the change?
Who should be notified?
```

LiveTree answers:

```text
How do I interact with this graph structurally?
How is it projected into DOM, SVG, canvas, CSS, or another renderer?
How do renderer-facing handles and utilities behave?
```

For data application data, LiveMap may exist without LiveTree.

For a live document, a common local architecture is:

```text
DocumentLiveMap
→ accepted document changes
→ LiveTree projection or structural access
→ renderer
```

For a hosted document, Reflect binds LiveTree to an Echo-governed LiveMap.
Authoring is pessimistic: Echo queues semantic intent, Locus alone accepts the
canonical mutation, and only accepted replay changes the Echo LiveMap,
LiveTree, and DOM. Direct public mutation of an Echo LiveMap is rejected.

---

## Relationship to Locus

Locus governs a LiveMap when the application requires shared or remote authority.

LiveMap supplies:

- canonical graph state;
- reads and writes;
- staged transitions;
- revisions;
- commits;
- schemas;
- subscriptions;
- links;
- capture;
- restore;
- replay.

Locus supplies:

- hosted mutation ordering;
- mutation queues;
- actions;
- authorization;
- sessions;
- transport;
- history retention;
- client recovery;
- durable persistence;
- resident and nonresident host lifecycle.

A standalone LiveMap does not need to understand connections or storage.

A governed LiveMap has its public mutation surfaces dynamically fenced so all writes pass through the Locus's ordered authority.

Those management rules are described in the Locus documentation.

---

## What LiveMap is not

LiveMap is not:

- a plain mutable JavaScript object;
- a Redux-style reducer registry;
- a database;
- a socket protocol;
- a persistence backend;
- a DOM renderer;
- a component framework;
- a CRDT;
- a general distributed transaction system;
- an authorization system.

It may serve as the state substrate beneath systems providing some of those capabilities.

Its scope is the deterministic local graph and its accepted transitions.

---

## Current capability summary

LiveMap currently provides a broad local-state and document foundation.

### data

```text
get
has
set
setMany
update
delete
replace
object helpers
array helpers
batches
```

### Schema

```text
objects
exact objects
properties
records
optional
nullable
readonly
arrays
item schemas
fixed items
literals
choices
recursive schemas
custom validation
structured issues
```

### Access surfaces

```text
direct paths
handles
proxies
physical node access
document node handles
```

### Observation

```text
commit observation
feeds
value subscriptions
diff subscriptions
selector subscriptions
path subscriptions
```

### Composition

```text
map links
handle links
parent/child propagation
target endpoint creation where permitted
```

### History primitives

```text
revisions
canonical commits
capture
exact document view-state
restore
replay
```

### Document structure

```text
canonical roots
attributes
ordered children
insert
remove
replace
move
QUID identity
atomic graph/index installation
```

---

## Documentation boundaries

This overview describes LiveMap as an independent local graph-state engine.

The maintained focused documentation is:

- `api-livemap.md` — complete current callable surface, including data,
  documents, schemas, feeds, commits, links, and errors;
- `handle-proxy.md` — data paths, stable handles, and proxy access;
- `schema.md` — standalone canonical Hson validation;
- `capture-replay.md` — exact capture shapes, identity categories,
  installation, restoration, replay, and persistence boundaries;
- `../contracts/livemap-mutation.md` — mutation and canonical commit contract;
- `../contracts/livemap-identity.md` — QUID, path, epoch, and reflection
  identity contract; and
- `../contracts/livemap-lifecycle.md` — shared lifecycle and cleanup contract.

The exact callable surface belongs in the LiveMap API reference.

Remote actions, sessions, one-map persistence, and client recovery belong in the Locus documentation.

Server rendering, DOM adoption, render streams, and variable client participation belong in separate projection documentation once those systems are established.

---

## Design principles

Several principles unify the LiveMap architecture.

### One canonical graph

Data and document access derive from one canonical Hson graph rather than competing stores.

### Explicit map kinds

Data and documents share infrastructure without pretending their state models are identical.

### Strict core operations

Generic path mutations fail clearly when their endpoint assumptions are not met.

Idempotent convenience behavior is expressed through explicit helper APIs.

### Atomic acceptance

A changed mutation installs one complete valid candidate or nothing.

### Canonical commits

Accepted state transitions are represented through a small deterministic operation vocabulary.

### Revisioned history

Every changed accepted transition advances one ordered revision.

### Structured validation

Schemas resolve against canonical data paths and return machine-readable issues.

### Identity distinct from path

Document nodes may move without losing identity, and paths may change while QUIDs remain stable.

### Observation after acceptance

Feeds, subscriptions, and links react to accepted state rather than tentative drafts.

### Privileged reconstruction

Restore and replay are explicit historical operations rather than ordinary mutations disguised as setters.

### Layered authority

LiveMap defines local mutation truth. Locus may govern when and by whom those mutations are accepted.

---

## Summary

LiveMap is the deterministic mutable graph at the center of hson-live.

Its core model is:

```text
canonical Hson graph
→ data or document interface
→ strict atomic mutation
→ schema validation
→ staged candidate
→ accepted revision
→ canonical commit
→ subscriptions, feeds, and links
```

For application data, it provides JSON-like paths without surrendering canonical graph structure.

For live documents, it exposes ordered Hson nodes, attributes, content, identity, capture, restoration, and replay.

It can operate entirely on its own:

```text
application
↔ LiveMap
```

or serve as the state engine beneath other layers:

```text
Locus
→ LiveMap
→ LiveTree or another projection
```

LiveMap’s responsibility ends at the boundary of deterministic local state and accepted graph transitions. Authority across clients, persistent durability, transport, and server projection are built around that boundary rather than folded into it.
