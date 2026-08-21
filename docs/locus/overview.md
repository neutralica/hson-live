
# Locus
Locus is hson-live’s authoritative hosting layer for shared live state and live documents.
It combines a `LiveMap` with ordered mutation authority, actions, authorization, sessions, recovery, persistence, and transport-facing publication. A hosted map remains the canonical application state; Locus determines how that state may change, how accepted changes are ordered, and how clients recover and continue from the same authority.
Locus is authoritative over every hosted `LiveMap`. Hosted canonical transitions pass through one host-owned FIFO; the original map and all retained mutation surfaces are fenced for the lifetime of that ownership. Document hosts may additionally use backend-agnostic durable persistence. In that configuration, every changed commit is appended durably before it becomes visible in memory or to connected clients.
Locus does not yet provide server-side HTML projection, DOM adoption, or LiveTree participation in the browser. Those systems are the next projection layer built on top of the authority, persistence, and recovery model described here.
---
## Place in hson-live
The principal hson-live layers have distinct responsibilities:


HSON
  reversible structured notation and canonical node model
LiveTree
  live structural and renderer-facing interaction with an HSON graph
LiveMap
  projected data or document state, mutation semantics, revisions, commits,
  subscriptions, links, schemas, capture, restore, and replay
Locus
  authority, ordering, actions, authorization, sessions, history,
  recovery, persistence, and client publication


A common authoritative document stack is:

persistent storage
        ↓
Locus
        ↓
DocumentLiveMap
        ↓
future server/client projection
        ↓
LiveTree, DOM, canvas, SVG, or another renderer

Locus does not replace LiveMap. LiveMap remains the graph reducer; Locus owns ordering, optional durability, accepted history, publication, and recovery.

⸻

Core model

A Locus owns a logical hosted map and coordinates changes to it.

At a high level:

client or server intent
→ authorization and action handling
→ authoritative mutation
→ canonical commit
→ ordered history
→ publication
→ client recovery or continuation

All public mutation is placed behind the host:

FIFO authority queue
→ detached preparation
→ asynchronous authority gate
→ acceptance with isolated LiveMap notification
→ explicit Host history ingestion
→ Host publication

The original map, retained handles, proxies, document helpers, schema mutation,
and restore/replay routes are dynamically fenced while host management is
active. LiveMap exposes no public raw canonical mutation surface.

Application code mutates through:

await host.mutate((draft) => {
  // Produce one authoritative LiveMap commit.
  return draft.set(["status"], "ready");
});

Actions mutate through the same queue by calling context.mutate(...).

Locus provides one ordered mutation boundary for:

* direct host mutations;
* action mutations;
* built-in document actions;
* managed linked mutations;
* persistent commit append;
* checkpoint barriers;
* destruction and management release.

See Authority⁠￼ for the complete transition and failure model.

⸻

Hosted map kinds

Locus builds on the two principal LiveMap modes.

Projected-data maps

A projected-data LiveMap exposes JSON-like paths and values while retaining canonical HSON internally.

Typical uses include:

* shared application state;
* domain records;
* action-driven state machines;
* synchronized collections;
* path subscriptions;
* linked maps.

Projected-data maps use the same strict hosted authority as document maps.

Durable persistence for projected-data hosts is intentionally deferred until hson-live has a stable exact projected checkpoint format.

Document maps

A DocumentLiveMap exposes the HSON document graph directly, including:

* elements and fragments;
* typed attributes;
* ordered content;
* structural identity;
* QUID metadata;
* exact document capture;
* privileged restore and replay.

Document maps are the basis for authoritative live documents and future server projection.

Document hosts may be persistent.

⸻

Staged mutation authority

LiveMap mutations internally use staged transitions.

Conceptually:

prepare detached candidate
→ accept exact transition
→ notify observers

Preparation validates and computes the complete candidate without changing authoritative state. Acceptance installs that exact prepared result and revision.

This distinction allows Locus to perform asynchronous work between preparation and acceptance without exposing a partially applied mutation.

For persistent hosts, the path becomes:

prepare exact transition
→ durably append exact commit
→ accept exact transition
→ accept with isolated LiveMap notification
→ ingest Host history
→ publish from that history

If durable append fails, acceptance never occurs.

The authoritative graph, revision, feeds, links, history, and clients remain unchanged.

⸻

Revisions and commits

Every changed authoritative mutation produces a canonical commit with an ordered revision transition.

Conceptually:

prevRev: N
rev: N + 1
ops: canonical operations

Revisions provide:

* total ordering within one host incarnation;
* duplicate detection;
* replay continuity;
* recovery planning;
* persistence-tail validation;
* client cursor tracking.

No-op transitions remain valid ordered requests, but they:

* do not advance the revision;
* do not create history;
* do not publish;
* do not call the persistence append gate.

A host incarnation identifies one continuous authoritative history. Persistent restore preserves the exact incarnation rather than manufacturing a new one after process restart or nonresident reload.

⸻

Actions

Locus actions convert validated client or server intent into authoritative work.

An action generally includes:

action name
+ request identity
+ payload
+ connection/session context
→ authorization
→ handler
→ zero or more queued mutations
→ result or controlled error

In action handlers:

* `context.map` is read-only;
* mutations use context.mutate(...);
* awaited and unawaited action mutations are tracked;
* acknowledgment waits until all tracked mutations settle;
* retained action contexts cannot mutate after completion.

One action may produce multiple accepted commits when it intentionally awaits several separate mutations. A single mutation callback produces at most one changed commit; several related writes should use the existing LiveMap batch boundary.

Authorization and action deduplication occur before authoritative mutation.

⸻

Sessions, connections, and publication

Locus separates authoritative map lifetime from individual client connections.

A connection participates through a session and receives only the messages appropriate to its recovery state and negotiated capabilities.

Client disconnect does not cancel host authority work. An accepted or durably appended mutation belongs to the host, not to the connection that initiated it.

Locus publication occurs only after authoritative acceptance and history ingestion.

Conceptually:

accepted commit
→ canonical history
→ eligible connected sessions
→ ordered publication

Transient connection events are distinct from authoritative state. They are not automatically replayed as part of map history.

⸻

Recovery

Clients may reconnect with knowledge of an earlier incarnation and revision.

The recovery planner chooses an appropriate path from the authoritative in-memory host state, such as:

replay-only

or:

snapshot
→ retained commit tail

or a complete reset when the client’s incarnation is incompatible.

Document clients may negotiate supported snapshot formats. Current document recovery can use:

* legacy HSON snapshots;
* exact view-state version 2 snapshots (version 1 rejects as unsupported);
* ordered canonical replay after the snapshot cut.

Both snapshot formats are durable structural captures. They preserve canonical
QUID metadata where present, but no serialized snapshot, `logicalMapId`,
`incarnationId`, or session credential proves the source map's local identity
epoch. A receiving mirror validates the claims into a new local sparse overlay;
old browser/runtime handles do not cross that boundary. The ordered tail remains
path-authoritative and can replay after an explicitly identity-free checkpoint.

Persistence format and client recovery format are intentionally separate.

A persistent host may store:

view-state checkpoint
+ canonical commit tail

while a particular client receives:

HSON snapshot

or:

view-state snapshot

followed by replay according to its negotiated capabilities.

The persistence adapter is never exposed as a client recovery source. Persisted state first reconstructs ordinary in-memory authority; clients then use the existing recovery planner.

⸻

Persistent document hosts

Backend-agnostic persistence is available for document hosts.

Creation uses:

const host = await create_persistent_locus({
    persistence: adapter,
  map,
});

Persistent construction stores an exact initial checkpoint before returning the host.

A persistent host guarantees:

changed commit is durably appended
before
its graph, revision, notifications, history, or client publication become visible

Persistence adapter

A persistence backend implements the narrow Locus contract:

interface LocusPersistenceAdapter {
  load(id): Promise<LocusPersistedMapState | undefined>;
  appendCommit(record): Promise<void>;
  replaceCheckpoint(record): Promise<void>;
}

The adapter is responsible for:

* idempotent exact commit append by logical map, incarnation, and revision;
* rejecting conflicting records at the same commit identity;
* validating expected revision continuity at the storage boundary;
* atomically replacing a checkpoint and trimming commits through that revision;
* returning one coherent checkpoint-plus-tail state on load.

Locus treats all loaded persistence material as untrusted and validates identity, map kind, mode, format, revision continuity, commit envelopes, replay success, and final revision before registration.

The persisted view-state checkpoint is exact durable metadata, not a persisted
live-epoch token. Loading after process restart creates a new document-map epoch,
admits preserved QUID strings as fresh local claims, and replays the canonical
path tail. This preserves structural and lookup continuity without claiming that
old process or browser objects survived.

Checkpoints

A persistent host exposes an explicit checkpoint barrier:

await host.checkpoint();

Checkpointing enters the same FIFO authority queue as mutations:

wait for earlier mutations
→ capture exact state at revision N
→ atomically replace checkpoint and trim through N
→ allow later mutations

Checkpointing does not mutate the map, advance its revision, or publish to clients.

Automatic checkpoint scheduling and production storage adapters are intentionally outside the current core.

Persistent stores

A persistent Locus store supports asynchronous creation, loading, unloading, and connection.

On a nonresident lookup:

registry miss
→ coalesced adapter load
→ persisted-state validation
→ checkpoint restore
→ ordered replay
→ host management activation
→ registry installation
→ ordinary client recovery

Concurrent loads for the same logical map share one in-flight operation and converge on one restored host.

⸻

Managed-map fencing

Hosting prevents mutation bypass through references obtained before hosting.

While a map is hosted, LiveMap dynamically fences public mutation routes, including:

* projected setters and deletion;
* update, apply, splice, and batches;
* object and array helpers;
* handles and proxies;
* document attributes and content;
* structural installation;
* first schema attachment;
* restore and replay;

LiveMap already owns a detached canonical graph before management begins, so
management activation does not clone merely to sever public aliases. Public raw
graph references do not exist.

Two Hosts cannot manage the same map. Ownership is released only after active authority work settles during host destruction or persistent-store unload.

⸻

Links

LiveMap links propagate accepted source changes to target maps.

An unmanaged target retains ordinary synchronous link behavior.

A target managed by a host registers an internal scheduler. After source acceptance, link propagation enqueues a separate target mutation through the target host’s authority FIFO.

This preserves:

* target authority;
* target revision ordering;
* persistence gating where supported;
* deadlock avoidance;
* separate source and target commits.

Source acceptance does not await or roll back because of later linked target work.

Persistent managed-link behavior is currently limited by persisted map-kind support: persistence supports document hosts, while current managed links primarily target projected-data maps.

⸻

Failure boundaries

Locus distinguishes several stages that must not be conflated.

Preparation failure

The candidate is rejected before acceptance. Authoritative state is unchanged, and the FIFO may continue.

Authority-gate failure

Asynchronous approval or durable append may reject before the durable boundary. The prepared transition is discarded, no mutation becomes visible, and the queue may continue.

Acceptance failure

After durable append succeeds, the exact transition is committed. An impossible realization failure terminally fences mutation, recovery, and connection service; persisted history is not rolled back or rewritten and reload realizes the durable record.

Notification failure

The state is already accepted. It is not rolled back.

Hosted authority uses isolated notification handling so observer failure remains distinct from authoritative rejection.

History-ingestion failure

The map remains accepted, but the host becomes terminally failed because publication and recovery can no longer safely claim a canonical accepted history.

Checkpoint failure

In-memory authority remains healthy. The previous durable checkpoint and tail remain authoritative, and checkpointing may be retried.

Persisted-load failure

No partial host is registered. Coalesced waiters fail together, the in-flight marker clears, and a later corrected load may retry.

⸻

Security boundary

Locus provides infrastructure for authoritative mutation, authorization, and controlled publication, but application security remains explicit.

The host must determine:

* which actions a connection may invoke;
* which payloads are valid;
* which map paths or document regions a connection may observe;
* which recovery representation is permitted;
* which transient events may be delivered;
* which server-only state must never enter snapshots, commits, traces, or errors.

Controlled Locus errors and traces avoid graph content, HSON payloads, attributes, CSS, view-state payloads, action payloads, and QUID content.

Future server projection will require an additional distinction between authoritative state and visible projection. Authorization to mutate a document will not automatically imply authorization to receive every part of that document.

⸻

Current public construction patterns

Nonpersistent host

const host = create_locus({
    map,
});
await host.mutate((draft) => {
  return draft.set(["status"], "ready");
});

All hosted mutation passes through this ordered authority queue.

Persistent document host

const host = await create_persistent_locus({
    persistence,
  map: documentMap,
});
await host.mutate((draft) => {
  return draft.attrs.set([], "data-state", "ready");
});
await host.checkpoint();

Use this constructor when authoritative document commits must become durable before visibility.

Multi-Locus persistent stores and authority registries remain internal pending
the future LiveHost boundary. They are not exported from `hson-live/locus`.

The exact callable surface is documented separately in the Locus API reference.

⸻

What Locus does not yet provide

The current Locus generation establishes the authority substrate for server-rendered and variably participating live documents, but does not yet implement that projection system.

Not yet canonicalized:

* DOM-free server LiveTree projection;
* HTML materialization with identity metadata;
* client adoption of existing DOM;
* portable hosted event bindings;
* revisioned render-operation streams;
* region-scoped participation levels;
* promotion from rendered regions to local graph participation;
* renderer-specific projections such as canvas or WebGL;
* server/client projection mismatch recovery;
* projection-specific authorization and visibility rules.

These are projection-layer concerns. They can now be explored without redesigning authoritative mutation, persistence, or client recovery.

⸻

Recommended documentation path

This overview introduces the complete system but does not replace focused chapters.

Continue with:

* Authority⁠￼ — staged, managed, and persistent mutation ordering;
* actions.md — action handlers, contexts, deduplication, and authorization;
* sessions-and-protocol.md — connections, sessions, envelopes, and publication;
* recovery.md — snapshots, replay, capabilities, incarnations, and cursors;
* persistence.md — adapter semantics, checkpoints, loading, validation, and failure handling;
* stores-and-lifecycle.md — registry ownership, creation, loading, unloading, and destruction;
* security.md — authority, visibility, sanitization, and projection boundaries.

Until those chapters exist, this overview is the canonical high-level account of Locus’s implemented architecture.

⸻

Summary

Locus turns a LiveMap into one ordered authority.

Its current architecture supports a strict FIFO authority, with an optional durable gate for document hosts.

The complete persistent document path is:

load checkpoint and commit tail
→ validate
→ restore exact DocumentLiveMap
→ resume Locus authority
→ prepare mutation
→ durably append commit
→ accept
→ ingest history
→ publish
→ recover clients through negotiated snapshots and replay

This establishes the server-side state, ordering, durability, and recovery foundation needed for the next phase: identity-preserving server projection and selectable client participation through LiveTree and other renderers.
