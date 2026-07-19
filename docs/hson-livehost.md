#### hson-live / hson.terminalgothic.com


<!-- 
LiveHost is the authority, session, and synchronization layer for shared LiveMap state. It allows an HSON-backed graph to move beyond local application memory by placing an authority boundary around the graph. A host owns canonical state, accepts domain actions or graph-operation proposals, validates them, applies accepted changes, assigns authoritative ordering, and publishes ordered updates to remote mirrors across a transport boundary.

In the intended model, each shared map has one authoritative host. Clients may mirror state, subscribe to paths or channels, request work, and propose changes, but they do not independently declare canonical history. This single-authority model reduces state divergence by routing accepted changes through one graph owner and one revision sequence.

LiveHost favors domain actions as the primary remote boundary. Instead of allowing arbitrary remote path writes, a client can submit an intent such as document.rename. The host action handler can validate input, authorize the caller, enforce invariants, update the authoritative LiveMap, record domain meaning, and return a safe result. Lower-level graph mutation proposals may also be supported for editors and developer tools, but such proposals remain non-canonical until accepted by the host.

The natural authoritative unit is a LiveMap commit. A commit advances the graph revision, contains one or more graph operations, and can be transmitted, replayed, deduplicated, or replaced by a snapshot when replay history is unavailable. Reconnecting clients may present their last confirmed revision; the host may then replay retained commits or send a current snapshot.

LiveHost distinguishes durable state from transient events. State changes belong in commits or snapshots because a mirror must recover them after reconnecting. Events are used for ephemeral signals such as progress, presence, diagnostics, or connection-local notifications.

The transport layer is intentionally narrow. WebSockets, worker ports, process IPC, in-memory test sockets, or other adapters can carry the same JSON-shaped protocol. Transport adapters may manage framing and network errors, but they do not redefine authority, revision ordering, validation, replay, or acceptance. 
-->


# LiveHost
**Status: WIP technical direction**

Updated: 2026-07-13

LiveHost is hson-live's proposed authority, session, and synchronization layer
for shared LiveMap state. It is the part of the architecture that allows an
HSON-backed state graph to become more than local application memory: one host
can own canonical state, accept domain actions, publish ordered changes, and
keep remote mirrors, subscribed projections, and client-side caches 
synchronized across transport boundaries.

A useful current vertical slice already exists. It includes an authoritative
LiveMap, typed action handlers, socket-like host and client endpoints, path
subscriptions, connection-scoped events, an in-memory host registry, and
bounded sync replay helpers. The completed design described here goes further
than that implementation.

This document is intentionally forward-looking. It describes what LiveHost is
being built to become, while distinguishing current behavior from contract
direction and roadmap. The exact callable surface that exists today—including
its limitations—is documented in `api-livehost-tentative.md`.

---

## Status vocabulary

- **Implemented** means the behavior exists in the current source.
- **Contract direction** means a repository contract states the intended
  semantics and the implementation provides at least part of the foundation.
- **Roadmap** means the capability is a credible extension of the present
  architecture but is not yet a current API guarantee.

The architecture below is stated confidently where its direction is settled.
Roadmap statements are not promises that a particular method name, wire shape,
or persistence strategy will survive unchanged.

---

## The central idea: authority over a live graph

LiveMap makes an HSON graph addressable as revisioned projected state; LiveHost adds
an authority boundary around that state.

In the intended model, each shared map has one authoritative host. That host
owns:

- canonical projected state;
- the accepted order of changes;
- action execution;
- schema and authorization decisions;
- retained replay history;
- snapshot fallback; and
- resources associated with connected or resumable sessions.

Clients mirror host state. They can request work, subscribe to state, and
propose changes where a protocol permits it, but they do not independently
declare a competing canonical history.

This single-authority model is contract direction. The current implementation
already centralizes actions and state in one host, but its `seq` counter is an
action-response sequence rather than the authoritative LiveMap revision. A
completed protocol must make canonical ordering and its relationship to map
commits explicit.

---

## Why domain actions are the primary boundary

Remote code should usually express intent, not perform arbitrary path writes:

```ts
type DocumentState = {
  documents: Record<string, { title: string }>;
};

type DocumentActions = {
  "document.rename": {
    id: string;
    document: { title: string };
  };
};

const host = hson.liveHost.create<DocumentState, DocumentActions>({
  state: { documents: {} },
  actions: {
    "document.rename": (ctx, input) => {
      ctx.map.at(["documents"]).object.setKey(input.id, input.document);
      return { renamed: input.id };
    },
  },
});
```

An action name can become a durable application boundary. It gives the host a
place to validate input, authorize the caller, enforce invariants, record domain
meaning, rate-limit work, version behavior, and return a safe result.

Typed asynchronous action handlers and payload decoders are implemented. The
current handler receives the authoritative LiveMap and can emit a
connection-scoped event. Authorization context, cancellation, action
deduplication, durable domain logging, and transactional rollback across an
entire async handler are roadmap concerns.

A narrow opt-in structured-tracing pilot is also implemented for the current
action lifecycle. It observes accepted envelopes, session authority, lookup,
payload validation, handler execution, revision boundaries, response dispatch,
and subscription publication through a caller-supplied local sink. Events are
redacted, are never protocol data or replay history, and sink failures are
semantically isolated. Bounded collector and explicit console adapters are
exported from `hson-live/diagnostics`. This is diagnostics infrastructure, not
the future authorization system or a distributed tracing platform.

Each accepted host-side processing attempt receives a dedicated host-generated
trace ID. Client action attempt IDs and logical request IDs are not reused as
trace identity. A retry therefore creates a distinct local trace even when
deduplication joins pending work or returns a cached result without running the
handler again.

Conditional low-level mutation proposals may also be useful, especially for
generic editors or developer tools. Contract direction requires such a proposal
to name the revision on which it was based and remain non-canonical until the
host accepts it. That proposal protocol is not implemented today.

---

## Canonical commits and ordering

The natural authoritative unit is a LiveMap commit:

```ts
type CommitEnvelope = Readonly<{
  prevRev: number;
  rev: number;
  ops: readonly LiveMapOp[];
}>;
```

A changed commit advances the authoritative revision once. Clients apply
commits in order; duplicates do not create duplicate changes; a gap or stale
base triggers replay or snapshot recovery.

This is contract direction, supported locally by LiveMap's commit, capture,
apply, and replay operations. The current LiveHost wire path instead sends
complete values for subscribed paths after a successful action. It also defines
a patch message type, but the host does not emit patches and the client does not
apply their operations yet.

The completed design should make the LiveMap revision the state-ordering fact.
Request IDs, action acknowledgments, session sequence numbers, and transport
frame order may still exist, but none should be silently substituted for the
canonical state revision.

---

## Snapshots, replay, and resume

A recovery snapshot is complete projected state at a known authoritative
revision. The current JSON message envelope carries compact HSON text:

```ts
type LiveHostSnapshotEnvelope = Readonly<{
  logicalMapId: string;
  incarnationId: string;
  rev: number;
  hson: string;
}>;
```

The host obtains a projected `JsonValue` from the atomic LiveMap capture and
serializes it as canonical compact HSON. The client parses that HSON, projects
it back to `JsonValue`, constructs and schema-validates a staged LiveMap, and
only then replaces the active mirror. Malformed HSON is an invalid recovery
snapshot. Commit and replay operation payloads remain in their existing format.

This encoding does not make recovery graph-native: it transports projected
JSON-compatible state and does not preserve the authoritative source graph's
QUID identity.

A reconnecting client can present its last confirmed revision. If the host
still retains every later commit, it can replay them in order. If history is
unavailable, the host sends a current snapshot. Snapshot replacement remains
the source-of-truth fallback rather than an exceptional failure.

The current implementation contains a bounded in-memory log of `sync` messages
and accepts `lastSeq` during hello. It always sends a current snapshot and may
then replay retained sync deliveries. This is useful scaffolding, not yet the
completed revision-resume algorithm: the log stores delivered path values, can
contain duplicate entries for different sessions, and is not a canonical
commit log.

Roadmap work includes:

- retained ordered commit envelopes;
- explicit replay-available and snapshot-required responses;
- duplicate and gap detection on clients;
- durable or pluggable retention where applications require it;
- protocol/schema compatibility checks; and
- tested resumption without state regression.

---

## Sessions and subscriptions

A session is the host-side lifetime of one client relationship. It is distinct
from a user identity, a transport connection, a host registry key, and an HSON
node identity.

Implemented sessions own subscribed LivePaths and a send function. A client can
subscribe or unsubscribe, and a subscription immediately publishes the
current value at that path. Later successful connected actions cause all
subscribed values to be sent again.

The completed session model may also own:

- authentication and authorization context;
- the last acknowledged revision;
- pending requests and cancellation;
- named channels or event streams;
- backpressure queues;
- resumable disconnect state;
- resource quotas and timers; and
- deterministic disposal scopes.

Subscriptions should preserve canonical order and cease delivery after
disposal. Path subscriptions are a useful baseline; root commits, selected
subtrees, named channels, queries, and domain event streams are plausible
extensions. They must not obscure which data is canonical state and which is a
transient event.

---

## State and events are different

Authoritative state survives in snapshots and commits. An event is a transient
notification such as progress, presence, a diagnostic, or a connection-local
signal:

```ts
ctx.emit_event("job.progress", { completed: 12, total: 20 });
```

Connection-scoped JSON events are implemented. They are delivered immediately,
have no sequence field, are not recorded in the resume log, and are not
replayed. That behavior is appropriate for ephemeral signals but not for facts
that a reconnecting client must recover.

The design rule is simple: if missing the information would make the mirror
incorrect, it belongs in authoritative state or an explicitly durable stream,
not only in an event.

---

## Transport independence

LiveHost depends on a small socket-like interface:

```ts
type LiveHostSocketLike = Readonly<{
  send(message: string): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (message: string) => void): (() => void) | void;
  onClose(listener: () => void): (() => void) | void;
}>;
```

This makes the authority model independent of WebSocket. An in-memory pair can
exercise the same host/client logic as a network adapter. WebSocket, worker
ports, process IPC, embedded runtimes, and test harnesses can all adapt to the
same boundary.

Transport adapters may own framing, connection state, backpressure, and network
errors. They must not redefine revision ordering, acceptance, replay, or
authority.

Protocol framing remains JSON-shaped. Recovery snapshot state is a compact HSON
string inside that JSON envelope; its logical map identity, incarnation, and
revision remain ordinary JSON fields. A completed protocol still needs an
explicit version strategy and strict runtime decoders for every client and
server envelope.

---

## Validation and security

The host must treat all client input as untrusted even when both endpoints use
the same TypeScript types.

Implemented validation checks JSON parsing, known client message kinds, action
IDs and names, JSON action payloads, and optional action payload decoders. Event
encoding and decoding are stricter than the other current server messages.

The completed boundary should validate, before state handling:

- exact envelope structure and protocol version;
- path segments and operation records;
- revisions and request identifiers;
- action payload and result schemas;
- state schema compatibility;
- authentication and authorization;
- resource and message-size limits; and
- safe public error information.

TypeScript types are developer tooling, not security validation. Internal
objects, closures, stack traces, LiveMap handles, LiveTree instances, and DOM
nodes must never become protocol payloads.

The current `LiveHostSchema` is preliminary. It validates action payloads at
dispatch, but its state validator does not attach a LiveMap schema or enforce
subsequent map mutations. Initial state rejection also is not yet surfaced as a
construction failure. Applications should not treat it as a security boundary.

---

## Registries, routing, and deployment

The implemented in-memory registry associates a string ID with a LiveHost and
can route a socket-like connection to it. This is enough for local composition,
tests, and a simple multi-document server.

The larger deployment model can grow around that small abstraction:

- create or load a host by stable application key;
- attach persistence and commit retention;
- route authorized clients to the correct authority;
- suspend or evict inactive hosts;
- migrate authority deliberately;
- observe health and resource usage; and
- recover from process failure without inventing a second writer.

Those are roadmap capabilities. The current registry is process-local, does not
persist hosts, does not dispose connections when an entry is deleted, and has no
authentication or eviction policy.

---

## LiveMap, LiveTree, and LiveHost together

The three layers have deliberately different responsibilities:

- **LiveMap** defines projected state, mutations, commits, validation, and local
  subscriptions.
- **LiveHost** defines authority, remote actions, sessions, transport, resume,
  and accepted ordering.
- **LiveTree** defines presentation graphs, DOM projection, and explicit
  bindings from state into views.

A client-side LiveMap can therefore be the mirrored model consumed by ordinary
LiveTree bindings. Host transport does not need to know about DOM, CSS, or view
objects, and presentation does not need to understand socket framing.

This separation makes several compelling applications plausible: shared
documents, remote controls, live test execution, synchronized inspectors,
collaborative authoring, server-owned simulations, streamed analysis, and
reconnectable long-running work. Each can use domain actions and state schemas
without weakening the single-authority core.

Because LiveHost operates on LiveMap commits rather than framework-specific component messages, the same authoritative graph can drive DOM projections, inspectors, editors, serialized HSON, JSON views, and other clients without requiring each projection to maintain an independent state model.

---

## Identity across the host boundary

Paths describe locations. QUIDs may eventually describe graph identity, but a
local QUID is not globally meaningful merely because it can be serialized.

The host protocol must explicitly decide whether an identity is:

- local to one process;
- scoped to one session;
- stable within one graph;
- preserved across snapshots;
- persisted across host restarts; or
- visible on the wire.

Current LiveHost synchronization remains projected-state transport. Recovery
snapshots use HSON as the textual encoding of a captured projected value, but do
not preserve HSON graph identity across snapshot replacement. Identity-aware
reconciliation is roadmap work and must be coordinated with LiveMap's eventual
safe canonical-node snapshot/install boundary.

---

---

## Goals

The initial LiveHost design is focused: a clear authority boundary around LiveMap that
transports serializable intent and safely orders state, and gives remote clients
a deterministic way to mirror, resume, and interact with a live HSON-backed
system. 

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
