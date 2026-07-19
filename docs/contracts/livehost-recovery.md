# LiveHost Recovery Contract

Status: proposed contract for LiveHost reconnect, resume, replay, and snapshot recovery.

This document defines the architectural rules for recovering a client mirror after transport loss. It intentionally separates state synchronization from transport connection management, session management, and action execution.

The first implementation target is one complete authoritative LiveMap stream per client mirror.

## 1. Scope

This contract covers:

- authoritative LiveMap state;
- LiveMap stream identity;
- canonical revision ordering;
- bounded commit history;
- replay after reconnect;
- snapshot fallback;
- recovery races;
- client gap and duplicate handling;
- the separation between state recovery, sessions, and action deduplication.

This contract does not yet define:

- partial or filtered LiveMap mirrors;
- collaborative merge or multi-master authority;
- optimistic client mutation;
- durable persistence requirements;
- checkpoint storage policy;
- compression;
- cross-host replication;
- identity-preserving snapshot reconciliation;
- exact wire JSON shapes.

## 2. Authority

Each synchronized LiveMap has exactly one authoritative writer at a time.

The host owns:

- the authoritative LiveMap value;
- the authoritative revision stream;
- commit publication;
- snapshot capture;
- recovery decisions;
- stream incarnation identity.

Clients own mirrors only. A client mirror must not be treated as an independent source of truth.

Client-side writes that are not submitted through an explicit host action or mutation proposal are outside the synchronized state contract and invalidate recovery correctness.

## 3. Stream identity

A synchronized state stream is identified by three distinct values.

### 3.1 Logical map ID

The logical map ID identifies the application resource.

Examples:

- a document;
- a hosted test run;
- a dashboard;
- a simulation;
- a shared editor state.

Recreating a resource under the same logical name does not imply continuity.

### 3.2 Incarnation ID

The incarnation ID identifies one continuous authoritative history of the logical map.

It must change when:

- the authoritative map is recreated without preserving its prior revision lineage;
- the revision counter resets;
- persisted state is restored incompatibly;
- the host cannot prove continuity with the prior history.

It may remain the same across process restart only when the deployment restores:

- authoritative state;
- authoritative revision;
- the same logical stream lineage.

An incarnation ID is opaque and host-generated.

### 3.3 Authoritative revision

The authoritative revision is `LiveMap.rev`.

It is the only state-ordering cursor.

The following are not state revisions:

- transport message order;
- WebSocket frame count;
- session sequence;
- action completion sequence;
- action request ID;
- hosted-test run ID;
- browser client ID.

Whenever a revision is interpreted, the incarnation ID must also be known.

## 4. Canonical commit stream

Every changed authoritative LiveMap commit advances the authoritative revision exactly once.

A canonical commit carries, semantically:

- incarnation ID;
- previous authoritative revision;
- next authoritative revision;
- immutable semantic operations.

For a valid changed commit:

- `rev === prevRev + 1`;
- operations are non-empty;
- the commit is detached from later mutation;
- absence and `undefined` are represented unambiguously on the wire.

Unchanged writes do not:

- advance revision;
- enter commit history;
- emit canonical commit messages.

All authoritative mutations must publish through the same canonical stream, including:

- action-handler mutations;
- direct host-owned map mutations;
- mutations committed before a later action error;
- batched mutations.

An action result is not the mechanism by which state changes become visible.

## 5. Commit history

The host retains a bounded canonical commit ring.

The ring must be bounded by at least:

- encoded byte size;
- commit count.

A deployment may additionally bound by age.

The ring exposes enough immutable metadata to answer:

- first retained revision;
- last retained revision;
- current encoded bytes;
- current incarnation;
- whether every commit in a requested revision interval is present contiguously.

Replay eligibility must be proven from contiguous coverage.

The host must never infer replay coverage merely because a requested revision is newer than the oldest retained entry.

Retaining every commit indefinitely is not required by this contract.

## 6. Snapshot contract

A snapshot is complete authoritative state at exactly one declared revision.

A snapshot contains, semantically:

- logical map ID;
- incarnation ID;
- authoritative revision;
- complete projected value;
- compatibility/schema identity where required.

The current recovery wire envelope is:

```ts
type LiveHostSnapshotEnvelope = Readonly<{
  logicalMapId: string;
  incarnationId: string;
  rev: number;
  hson: string;
}>;
```

The outer JSON message discriminates this body as `recovery-snapshot`.
`hson` is canonical compact HSON produced from the atomically captured
projected `JsonValue`; identity and revision remain ordinary envelope fields.
The JSON-encoded envelope size, including JSON escaping of the HSON string, is
the value used by recovery envelope byte validation.

This is projected-state transport, not graph-native recovery. Parsing the HSON
reconstructs a `JsonValue` and then a replacement LiveMap, so authoritative
source-node QUID identity is not preserved. Replay commits retain their existing
operation encoding.

Snapshot capture must be atomic.

The value and declared revision must describe the same authoritative instant.

A client must never observe a partially installed snapshot.

For large snapshots, transport may use multiple frames, but those frames constitute one logical snapshot transaction. The client stages, validates, and installs it atomically.

Snapshot replacement is the correctness fallback whenever replay cannot be proven safe.

The protocol decoder validates only the exact envelope shape and primitive
field types. HSON syntax is validated while the client stages snapshot
installation: a malformed envelope is a protocol decode failure, while a valid
envelope containing malformed HSON is an invalid recovery snapshot. Neither
failure may replace the current mirror or advance its cursor.

The host must be capable of generating a current snapshot on demand. Cached snapshots and periodic checkpoints are optional optimizations, not initial protocol requirements.

## 7. Recovery request

A recovering client may declare:

- logical map ID;
- incarnation ID, when known;
- last atomically applied authoritative revision, when it possesses the exact corresponding mirror state.

A revision claim is valid only if the client still possesses the complete mirror state for that revision.

Persisting a revision number without persisting its corresponding mirror does not create resumable state.

A refreshed client with an empty mirror must request a snapshot, even if it remembers a prior revision number.

## 8. Recovery decision

Let `H` be the host's authoritative revision at the recovery cut.

The host chooses one of four outcomes.

### 8.1 Already current

When:

- incarnation matches;
- client has exact mirror state at revision `H`.

No state payload is needed before live streaming resumes.

### 8.2 Replay

When:

- incarnation matches;
- client revision `N` is less than `H`;
- every commit `N + 1` through `H` is retained contiguously;
- replay is operationally preferable to a snapshot.

The host sends commits in strict revision order.

### 8.3 Snapshot

A snapshot is required when:

- the client has no usable revision;
- incarnation differs but the logical resource still exists;
- the requested revision is ahead of the authoritative head;
- commit coverage is incomplete;
- replay would be materially larger or slower than snapshot recovery;
- the client reports replay conflict or corrupt state;
- the server cannot otherwise prove safe continuation.

Snapshot replacement resets the client to the host's declared incarnation and revision.

### 8.4 Gone or rejected

Recovery is rejected when:

- the logical resource no longer exists and no replacement should be created;
- authorization fails;
- application or schema compatibility fails;
- the requested target is invalid;
- recovery would silently attach the client to a different resource.

A missing stream must not be silently recreated under the same incarnation.

## 9. Recovery cut and live-tail barrier

Recovery must establish a fixed head revision `H`.

The host must prevent gaps between recovery state and later live commits.

For each recovering connection:

1. establish recovery head `H`;
2. pin immutable replay commits through `H`, or capture a snapshot at `H`;
3. queue canonical commits created after `H`;
4. deliver replay or snapshot through `H`;
5. signal that recovery through `H` is complete;
6. deliver queued commits beginning at `H + 1`;
7. continue the live stream.

A snapshot captured at revision `H` must never be labeled with a later revision.

Commits created during snapshot serialization must not be lost or folded into the snapshot without updating the declared cut.

## 10. Client authoritative cursor

The client tracks an explicit authoritative cursor:

- current incarnation ID;
- `lastAppliedRev`.

This cursor is separate from the client mirror's local `LiveMap.rev`.

The mirror's local revision may differ because:

- mirror construction has its own local revision behavior;
- snapshot installation may use replacement operations;
- recovery may rebuild a new mirror.

LiveHost validates canonical wire continuity using the authoritative cursor, not the mirror's local revision counter.

## 11. Client commit application

For a commit from the current incarnation:

### Duplicate or old commit

When `commit.rev <= lastAppliedRev`:

- do not apply it;
- treat it as an already-observed duplicate.

### Next contiguous commit

When:

- `commit.prevRev === lastAppliedRev`;
- `commit.rev === lastAppliedRev + 1`.

Validate and apply atomically, then advance `lastAppliedRev`.

### Gap

When `commit.prevRev > lastAppliedRev`:

- stop normal commit application;
- request recovery;
- do not guess or buffer indefinitely.

### Overlap or malformed transition

When:

- `commit.prevRev < lastAppliedRev < commit.rev`;
- revision delta is invalid;
- payload validation fails;
- replay conflicts with current mirror state.

Preserve the last valid mirror and request snapshot recovery.

A client must not silently skip an unknown commit.

## 12. Session and transport separation

A transport connection is one physical WebSocket attachment.

A LiveHost session may survive transport loss, but session survival is not required for state recovery.

State recovery must work with:

- a reattached prior session; or
- a newly created session connected to the same logical map incarnation.

A session is not:

- the LiveMap;
- the map incarnation;
- the browser client;
- the transport connection.

Session recovery may preserve:

- authorization context;
- transient subscriptions;
- request outcomes;
- flow-control acknowledgments.

Loss of a session must not imply loss of authoritative state.

Connection fencing and session reattachment are later implementation concerns and must not redefine the state recovery rules in this document.

## 13. Action deduplication

Commit deduplication prevents duplicate state application.

It does not prevent duplicate action execution.

Actions that may be retried across reconnect require stable request IDs.

The intended action policy is:

- the client creates the request ID before first send;
- the host scopes deduplication by application, logical map, incarnation, client identity, and request ID;
- the host records pending and terminal request state;
- a duplicate pending request joins or observes the same work;
- a duplicate completed request receives the cached outcome;
- reusing the same request ID with a different action fingerprint is rejected.

Action results should include the authoritative revision observed at completion.

A client may wait until its mirror reaches that revision before presenting the action as visible in state.

Action deduplication will be implemented separately from initial stream recovery.

Exactly-once external side effects require durable dedupe records coordinated with those effects. This contract does not claim exactly-once behavior across loss of both state and dedupe storage.

## 14. Full-map v1 boundary

The first recovery protocol synchronizes one complete LiveMap mirror per state stream.

Path subscriptions and partial projections must not share the full-map revision cursor unless they define their own explicit projection identity and recovery semantics.

For v1:

- one stream means one complete authoritative LiveMap value;
- replay operations apply to that complete mirror;
- snapshot replaces that complete mirror.

Large independent state regions may be modeled as distinct logical LiveMaps.

Partial and filtered mirrors are deferred.

## 15. Durable state versus transient events

State required after reconnect belongs in LiveMap state.

Transient events are explicitly non-recoverable.

Appropriate transient events include:

- animation hints;
- presence pings;
- disposable notifications;
- nonessential diagnostics.

Events must not be the sole source of:

- authoritative progress;
- completed work;
- current status;
- durable results;
- values required to reconstruct the application.

Hosted-test reports must remain understandable when every transient event is missed.

## 16. Hosted-test application

Hosted tests are a proving application for the generic protocol.

The authoritative hosted-test report is a LiveMap.

While a client is disconnected, the host may continue updating:

- run status;
- suite summaries;
- case summaries;
- timings;
- diagnostics;
- terminal result.

On reconnect:

- recent clients replay retained report commits;
- clients outside the ring receive a report snapshot;
- completed reports recover to the same terminal state;
- destroyed or expired runs return `gone`.

Hosted tests must not define a separate reconnect protocol once generic LiveHost recovery is available.

## 17. Slow consumers and backpressure

The host must never silently discard canonical commits for an active client.

Outbound connection queues must be bounded.

When a client cannot keep up:

- the host may disconnect it with a resumable reason;
- the client reconnects through normal replay or snapshot recovery.

Silent commit dropping is forbidden.

Commit-ring retention and per-connection outbound buffering are separate limits.

## 18. Compatibility

Recovery begins only after compatibility checks succeed.

Compatibility may include:

- protocol version;
- application ID/version;
- map/schema identity;
- encoding version;
- authentication and authorization.

Exact negotiation fields are deferred, but the protocol must not apply state before compatibility is established.

## 19. Errors

Recovery errors must be stable and classifiable.

At minimum distinguish:

- invalid target;
- unauthorized;
- incompatible protocol/application/schema;
- map gone;
- incarnation mismatch requiring reset;
- revision ahead of host;
- commit gap;
- malformed commit;
- replay conflict;
- snapshot validation failure;
- slow consumer;
- session fenced or expired.

Errors should state whether the client may:

- retry the same recovery request;
- request a snapshot;
- create a new session;
- attach to a replacement incarnation;
- stop permanently.

## 20. Required diagnostics

The host should expose immutable diagnostics sufficient to test and inspect:

- logical map ID;
- incarnation ID;
- authoritative head revision;
- first and last retained commit revision;
- retained commit count;
- retained encoded bytes;
- active recovering connections;
- queued post-cut commit count per connection;
- recovery decisions by type;
- replayed commit count;
- snapshots generated;
- snapshot fallbacks;
- detected gaps and conflicts.

Mutable internal history must not be publicly exposed.

## 21. Implementation sequence

The intended implementation order is:

### Patch 1: stream identity and canonical history

Add:

- logical map ID;
- incarnation ID;
- canonical immutable wire-safe commit publication;
- bounded byte/count commit ring;
- contiguous coverage queries;
- history diagnostics.

Do not add client reconnect yet.

### Patch 2: snapshot and recovery planning

Add:

- atomic snapshot envelope;
- replay-or-snapshot decision;
- recovery cut;
- queued live tail;
- recovery completion boundary.

### Patch 3: client recovery

Add:

- authoritative client cursor;
- duplicate and gap handling;
- atomic snapshot installation;
- reconnect using a new session;
- real WebSocket interruption tests.

### Patch 4: session reattachment

Add:

- resumable session credentials;
- connection fencing;
- transient subscription restoration policy;
- graceful expiry.

### Patch 5: action deduplication

Add:

- stable request IDs;
- request fingerprinting;
- pending/completed dedupe records;
- retry and status behavior;
- completion revision.

### Patch 6: hosted-test migration

Replace hosted-test-specific initial/commit recovery behavior with the generic LiveHost recovery protocol.

## 22. Non-negotiable invariants

Future patches must preserve all of the following:

1. `LiveMap.rev` is the sole state-ordering cursor.
2. Revision interpretation always includes incarnation identity.
3. Replay requires proven contiguous commit coverage.
4. Snapshot is the correctness fallback.
5. Snapshot projected state and revision describe the same authoritative instant.
6. Recovery queues all commits after its fixed cut.
7. Client mirror local revision is not the authoritative cursor.
8. Duplicate commits do not duplicate mutations.
9. Gaps trigger recovery, never guessing.
10. Transport connection order is not state order.
11. Session identity is not map identity.
12. Durable application facts live in state, not only events.
13. Action deduplication is separate from commit deduplication.
14. A client may claim revision `N` only when it possesses the exact mirror state for `N`.
15. Recreating or resetting a map requires a new incarnation unless continuity is restored and proven.
16. Canonical commits are never silently dropped for an active client.
17. v1 recovery synchronizes complete LiveMap mirrors only.

## 23. Deferred decisions

The following do not block the first recovery implementation and remain deliberately open:

- broader protocol-version negotiation beyond the current recovery envelope;
- default commit-ring byte/count limits;
- whether replay is chosen using a replay-bytes versus snapshot-bytes threshold;
- snapshot checksum algorithm;
- snapshot chunk size;
- durable persistence adapter;
- checkpoint cadence;
- session expiration duration;
- whether a second session attachment replaces or rejects the first before connection fencing lands;
- compression;
- optimistic local writes;
- partial projection protocol;
- identity-preserving snapshots;
- collaborative merge policy.

These must not be resolved implicitly inside unrelated implementation patches.


## ADDENDUM

Revision ahead of authority

When a client presents revision N and the authoritative head is H, with N > H for the same incarnation:

* return REVISION_AHEAD_OF_AUTHORITY;
* do not replay;
* do not snapshot backward within the same incarnation;
* do not automatically remint the incarnation as part of ordinary recovery;
* require an explicit authority/reset decision before a new incarnation is created;
* an explicit client request to discard its local claim may then accept a snapshot, but that is a reset, not continuation.

Atomic recovery cut

Selecting recovery head H and registering the connection’s post-cut queue must be atomic relative to canonical commit ingestion.

No commit may occur between:

* establishment of H;
* activation of tail capture;

without being included either in the recovery material through H or in the queued tail after H.

Canonical ingestion and publication

For every canonical commit:

1. validate revision continuity and payload;
2. detach/freeze the commit;
3. append it to canonical history;
4. enqueue it for ordered external publication;
5. deliver it to recovery queues and live subscribers in authoritative order.

External consumers must not depend on incidental LiveMap feed-listener order.

Reentrant mutations must still publish:

* revision R;
* then revision R + 1;

even when R + 1 is created during publication of R.

Recovery-tail overflow

Each recovering connection has a bounded post-cut queue.

If that queue exceeds its limit before recovery completes:

* abort the current recovery attempt;
* do not emit caught_up for the abandoned cut;
* do not omit queued commits;
* either disconnect with a resumable overflow error or restart recovery at a newer cut.

The implementation must not finish an old snapshot while silently dropping part of its live tail.

Minor definitions worth pinning

* firstRetainedCommitRev means the first retained commit’s rev.
* earliestResumableBaseRev means that commit’s prevRev.
* An empty history proves replay only when the client is already at the current head.
* Payload validation occurs before duplicate/old-revision classification.
* Only mutations entering through the LiveMap commit pipeline are authoritative.
* Raw graph mutation that bypasses commits is outside LiveHost synchronization guarantees.
* Destroying a stream fences or terminates active attachments and makes later routing return gone.
* caught_up(H) means recovery material through H is installed; later queued commits may already exist.
* History byte accounting uses the actual wire encoding or a documented conservative upper bound.
