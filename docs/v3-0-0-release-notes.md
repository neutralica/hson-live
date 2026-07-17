# HSON Live 3.0

HSON Live 3.0 expands the library from a live document graph into a
broader state, projection, and hosting system.

This release introduces LiveMap as a canonical structured-state API,
LiveHost as an authority and synchronization layer, and LiveInspector
as a retained semantic projection for inspecting live state. LiveTree
continues to provide the mutable document and DOM surface beneath these
new systems.

Version 3 is a major release because it adds substantial new public API
surface and establishes architectural contracts that future reflection,
hosting, and tooling work will build upon.

## Highlights

- LiveMap provides typed, path-addressable live JSON state.
- LiveHost provides canonical authority, ordered commits, actions,
  sessions, replay, and snapshot recovery.
- LiveInspector provides a lazy, retained, identity-preserving view of
  LiveMap state.
- LiveTree remains the document and browser projection layer.
- Schema validation, batching, subscriptions, linking, proxies, and
  node-level access are integrated into the LiveMap model.
- The fixture corpus now exercises more than two thousand semantic
  guarantees across transforms, LiveTree, LiveMap, LiveHost, and
  LiveInspector.


  ## LiveMap

LiveMap introduces canonical, mutable structured state backed by the
HSON node graph.

### Path-based state access

LiveMap projects JSON-compatible state through canonical paths composed
of string object keys and numeric array positions.

Core operations include:

- `get`, `has`, `set`, `update`, `delete`, and `replace`
- path handles through `at(path)`
- immutable snapshots through `snap()`
- physical HSON node access through `node(path)`
- root and nested handles with consistent path semantics

`set` performs strict endpoint updates, while `replace` performs
destructive replacement of the selected endpoint or root.

### Object and array operations

Object helpers provide key creation, deletion, renaming, clearing, and
multi-key updates.

Array helpers provide insertion, removal, replacement, movement, and
append operations while retaining canonical index semantics.

### Commits and batching

Mutations produce semantic commit envelopes containing ordered `set`,
`delete`, and `replace` operations.

The mutation pipeline performs:

1. input normalization
2. schema preview
3. preflight application
4. canonical mutation
5. feed and subscription delivery
6. commit publication

Batching stages multiple writes and publishes them as one coherent
commit.

### Schema

LiveMap includes a composable schema system supporting:

- object and exact-object schemas
- optional and nullable values
- readonly values
- literal and choice constraints
- arrays and tuple-like item definitions
- property and record schemas
- lazy schema resolution
- custom validation
- structured issue paths

Schema validation participates in mutation preflight so rejected writes
do not partially alter canonical state.

### Subscriptions and feeds

LiveMap supports:

- full commit subscriptions
- path subscriptions
- selected-value subscriptions
- diff-oriented subscriptions
- disposable listener ownership

Subscriber snapshots are isolated from canonical mutable state.

### Proxy API

`map.proxy()` provides a path-oriented proxy surface for concise state
access while preserving the same mutation and validation contracts as
the explicit LiveMap API.

### Linking

LiveMaps and path handles can be linked so canonical changes propagate
between related state regions.

Linking supports:

- child propagation from linked parents
- endpoint replacement
- child deletion
- creation of missing target children where the parent exists
- disposable link ownership

### Physical node access

The node API exposes the underlying HSON structure for advanced
operations involving attributes, children, insertion, removal,
replacement, and movement.

Node-level changes intentionally bypass projected schema, feeds, and
subscriptions and are therefore an expert escape hatch rather than the
ordinary state API.

## LiveHost

LiveHost introduces a single-authority hosting model for LiveMap-backed
state.

A host owns the canonical value, revision order, action execution,
authorization boundary, replay history, snapshots, and connected
sessions.

### Canonical revisions

Hosted state changes are distributed as ordered commit envelopes:

```ts
interface CommitEnvelope {
  prevRev: number;
  rev: number;
  ops: readonly LiveMapOperation[];
}
```

Clients apply revisions in order, ignore duplicates, and detect gaps.

A client that cannot resume continuously can recover through replay or
a canonical snapshot.

### Snapshots and resume

Snapshot envelopes pair a canonical value with its revision:

interface SnapshotEnvelope {
  rev: number;
  value: JsonValue;
}

Clients may reconnect using their last confirmed revision. The host
replays retained commits where possible and falls back to a snapshot
when necessary.

### Domain actions

LiveHost supports named, typed domain actions.

The host:

* validates action requests
* authorizes the connected session
* executes the registered handler
* applies resulting state changes canonically
* returns a classified result to the requesting connection
* may emit connection-scoped transient events

Actions provide a controlled alternative to allowing clients to mutate
hosted state directly.

### Sessions and subscriptions

Connected sessions can subscribe to selected state paths.

Subscriptions publish an immediate current value and later publish
changes affecting the subscribed region.

Session ownership controls cleanup of subscriptions, pending requests,
and connection-local resources.

### Events versus state

LiveHost distinguishes durable state from transient events.

State is revisioned, replayable, and snapshot-backed. Events are
connection-scoped or ephemeral and are not included in replay history.

### Transport boundary

The hosting layer uses a socket-like transport abstraction rather than
depending directly on one networking implementation.

Protocol envelopes remain JSON-compatible and are validated at the
host boundary. The design leaves room for versioned decoders, alternate
transports, persistence, and distributed host registries.


## LiveInspector
LiveInspector provides a semantic, navigable projection of LiveMap
state into LiveTree.

### Lazy materialization
Collapsed state is not eagerly expanded into view branches. Direct
children are materialized only when their parent is expanded.
This allows large maps and arrays to remain inexpensive when inspected
at shallow depth.

### Retained identity
Inspector branches retain their LiveTree identity across compatible
updates.
This includes:
- primitive value updates
- primitive-to-structural replacement
- sibling updates
- keyed array movement
- keyed insertion and deletion
- compatible whole-source replacement
- collapse and re-expansion

### Array identity
Arrays may use an application-provided key function.
Keyed arrays preserve branch identity according to application identity
rather than current position. Unkeyed arrays use an explicitly
positional fallback and report that limitation through diagnostics.

### Selection and expansion
Selection follows surviving keyed items across movement. When a
selected branch is removed, selection moves to the nearest surviving
parent.
Compatible source replacement preserves surviving selection and
expansion state.

### Schema and serialization
Inspector details can expose effective LiveMap schema information and
current validation status.
Representable values may be serialized through the existing HSON
transform pipeline as JSON, HSON, canonical nodes, or markup where the
source structure permits it.

### Renderer specialization
Applications may register semantic renderers for selected values.
Renderer handles expose read-only state rather than mutation methods.
Renderer updates reuse local resources while the specialization remains
applicable and dispose those resources exactly once when it no longer
matches.
Renderer and observer failures are classified, diagnosed, and prevented
from corrupting inspector state.

### Diagnostics and profiling
Inspector diagnostics expose:
- branch creation, reuse, movement, and removal
- visible and retained branch counts
- positional versus keyed array behavior
- source replacement preservation
- serialization requests
- observer and renderer failures
- listener ownership
- source materialization activity

## Continuity: LiveTree and transforms
LiveTree remains the mutable document graph and browser-facing
projection layer.
Version 3 retains the existing transform and LiveTree foundations,
including:
- reversible HSON, JSON, HTML/XML, and SVG conversion
- canonical HSON nodes
- DOM grafting and querying
- identity through QUIDs
- text, attribute, data, form, CSS, SVG, and canvas APIs
- typed creation helpers
- deterministic serialization

LiveMap and LiveHost do not replace these systems. They extend the
architecture upward:

```text
LiveHost  — authority, sessions, replay, transport
LiveMap   — canonical application state and semantic commits
LiveTree  — canonical document and browser projection
HSON      — shared structural notation and node model
```

## Architectural direction
HSON Live 3 establishes the intended separation of responsibilities:
- HSON is the canonical structural representation.
- LiveMap owns canonical application state.
- LiveTree owns document and view identity.
- LiveHost owns hosted authority and revision order.
- Reflection maintains correspondence between state and view graphs.
The system does not attempt to force application state and document
state into one undifferentiated object. Instead, it maintains one
canonical graph within each responsibility and uses thin, retained
projections between them.

Compatibility


## Compatibility
Version 3 adds major public API surfaces and may require updates where
applications depended on experimental LiveMap, LiveHost, or
LiveInspector contracts from prerelease development.
The canonical HSON node model and `_hson_*` virtual structural node
naming remain the basis for current documentation and future work.

## Verification
The release is covered by more than 2,000 fixtures spanning:
- transforms and canonical serialization
- LiveTree document and DOM behavior
- LiveMap mutation and schema contracts
- batching, subscriptions, proxy access, linking, and node internals
- LiveHost actions, revision ordering, replay, snapshots, and sessions
- LiveInspector projection, identity, replacement, lifecycle, and
  performance behavior
The hosted demonstration runner is maintained separately from the
library fixture corpus. Release certification should use a confirmed
fresh fixture execution rather than a recovered hosted report.
