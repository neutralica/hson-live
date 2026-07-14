
// livemap-host-authority.md

# LiveHost Authority Contract
## Status
This document defines the initial authority and synchronization model for LiveHost.
The model is deliberately narrow.
LiveHost is a transport-independent authority and session layer. WebSocket is an adapter, not the architecture.
## Authority model
Each synchronized LiveMap has one authoritative host.
The host owns:
- canonical state;
- canonical revision order;
- accepted commits;
- action execution;
- replay history while retained;
- snapshot fallback;
- client session state.
Clients mirror authoritative state.
Clients do not independently establish canonical revision history.
## Single-writer doctrine
The initial protocol is single-authority.
Clients may submit:
- actions;
- conditional mutation requests;
- replayable operation proposals;
- subscription requests;
- resume requests.
The host accepts or rejects them.
Only host-accepted changes become canonical commits.
The protocol does not initially support:
- multi-master writes;
- peer-to-peer merge;
- CRDT semantics;
- automatic divergent-history reconciliation.
## Canonical ordering
Canonical commits are totally ordered by host revision.
For every changed authoritative commit:
```ts
commit.rev === commit.prevRev + 1
```
Clients must apply commits in order.

A client must not apply revision N + 1 before revision N.

Duplicate delivery must not create duplicate state changes.

Out-of-order or missing revisions require replay or resynchronization.

Actions

Domain actions are the preferred application boundary for remote behavior.

Conceptually:

host.action("tests.run", handler);
host.action("rename-user", handler);

An action:

* has a stable name;
* receives validated serializable input;
* executes against host authority;
* may produce one or more authoritative commits;
* returns an acknowledgment or rejection.

Actions provide natural points for:

* authorization;
* validation;
* domain logging;
* versioning;
* rate limiting;
* application-specific errors.

Arbitrary remote mutation may exist, but should not replace domain actions where domain intent matters.

Client proposals

A conditional client mutation proposal must include the revision on which it is based.

The host may reject proposals because they are:

* malformed;
* stale;
* inconsistent with current state;
* schema-invalid;
* unauthorized;
* unsupported by the current protocol version.

The client must not treat local proposal success as canonical success until acknowledged by the host.

Optimistic behavior

The initial protocol does not require optimistic local application.

A client may wait for the authoritative commit before updating mirrored state.

If optimistic application is later supported, it must define:

* proposal identity;
* acknowledgment matching;
* rollback;
* canonical commit replacement;
* conflict behavior;
* feed behavior during speculative state.

Optimism must not be added implicitly.

Snapshots

A host snapshot represents complete authoritative projected state at a specific revision.

Conceptually:

type SnapshotEnvelope<TValue> = Readonly<{
  rev: number;
  value: TValue;
}>;

A client may use a snapshot to initialize or resynchronize its mirror.

Snapshot application must be atomic.

Identity consequences of snapshot application must follow the identity contract.

Commits

A host commit envelope carries normalized serializable mutation records.

Conceptually:

type CommitEnvelope = Readonly<{
  prevRev: number;
  rev: number;
  ops: readonly LiveMapOp[];
}>;

Transport envelopes must not include implementation objects such as:

* LiveMap instances;
* handles;
* Proxies;
* closures;
* LiveTree instances;
* DOM nodes.

Transport safety

All protocol values must survive encode/decode without semantic loss.

Transport validation must occur before revision or state-conflict handling.

Malformed messages must fail as protocol or replay-input errors, not as incidental runtime exceptions.

The protocol must explicitly resolve any use of undefined, because ordinary JSON object serialization omits undefined-valued properties.

Resume

A reconnecting client may request continuation from its last confirmed revision.

Conceptually:

{
  kind: "resume",
  fromRev: 42
}

The host may respond with:

* ordered commits after revision 42;
* a complete snapshot when replay history is unavailable;
* rejection when the session or protocol is invalid.

Resume replay is an optimization.

The snapshot remains the fallback source of truth.

Replay retention

The host may retain a bounded commit history.

Retention policy is an implementation and deployment concern, but observable behavior must be clear:

* replay available;
* replay unavailable, snapshot required;
* session expired;
* protocol version incompatible.

Clients must not assume indefinite log retention.

Sessions

A session groups one client’s host-side resources.

A session may own:

* connection state;
* subscriptions;
* acknowledged revision;
* action requests;
* cancellation handles;
* authentication context;
* disposal scope.

Session identity is distinct from graph identity and user identity.

Subscriptions

A client may subscribe to:

* complete map updates;
* selected paths;
* named host channels;
* domain-specific event streams.

Subscription delivery must respect canonical commit order.

Subscription disposal must be deterministic.

A disconnected or disposed session must not continue receiving updates.

Rejection

Host rejection is explicit data, not transport failure.

A rejection should identify:

* request or action identity;
* stable error code;
* safe diagnostic reason;
* current authoritative revision where relevant;
* whether retry, replay, or resynchronization is appropriate.

Internal stack traces and implementation objects must not become protocol payloads by default.

Protocol versioning

Protocol messages must have an explicit version strategy before compatibility matters.

Versioning may be attached to:

* the connection handshake;
* individual envelopes;
* schema identifiers;
* action namespaces.

Unknown message kinds or unsupported versions must be rejected deliberately.

Transport independence

LiveHost core behavior must be testable with an in-memory socket-like adapter.

WebSocket support must implement the same host/client contract.

Transport adapters may handle:

* framing;
* encoding;
* connection state;
* backpressure;
* network errors.

They must not redefine authority, revision, or replay semantics.

Security boundary

The host treats client messages as untrusted runtime input.

The host must validate:

* envelope shape;
* operation shape;
* action name;
* action payload;
* revision fields;
* schema compatibility;
* authorization.

TypeScript types are not runtime validation.

Non-goals

The initial LiveHost contract does not provide:

* peer-to-peer synchronization;
* multi-master merging;
* transparent offline editing;
* conflict-free replicated data types;
* unbounded durable event sourcing;
* arbitrary remote code execution;
* automatic schema migration.

Required invariants

Tests must continue to prove:

* the host is the sole canonical revision authority;
* accepted commits are totally ordered;
* malformed input is rejected before state handling;
* stale proposals do not mutate authority;
* duplicate or out-of-order delivery does not corrupt mirrors;
* resume replays ordered commits when available;
* snapshot fallback restores canonical state;
* disposed sessions release subscriptions and resources;
* WebSocket and in-memory adapters obey the same protocol contract.

---
