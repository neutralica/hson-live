# LiveHost API reference

LiveHost is the transport-independent authority for one hosted LiveMap. It owns
action execution, ordered publication, recovery planning, connection/session
state, and optional document persistence. The package does not provide a
WebSocket server; applications adapt a socket to `LiveHostSocketLike`.

All imports in this reference are package exports:

```ts
import {
  create_livehost,
  create_livehost_client,
  create_persistent_livehost,
  create_livehost_persistent_store,
  hson,
} from "hson-live";

import type {
  LiveHostPersistenceAdapter,
  LiveHostSocketLike,
} from "hson-live";
```

`hson.liveHost.create`, `.client`, and `.registry` are aliases for the principal
factory functions. Public types are also exported by `hson-live/types`.

## Stability boundary

- **Public:** `create_livehost`, `create_livehost_client`,
  `create_livehost_store`/`create_livehost_registry`,
  `create_persistent_livehost`, `create_livehost_persistent_store`, the protocol
  encode/decode functions, and their exported types.
- **Experimental but callable:** document-mode recovery negotiation, exclusive
  authority, persistence, tracing, and the lower-level stream/recovery helpers.
- **Diagnostic:** `.debug()` methods, trace sinks, and `hson.liveHost.debug`.
- **Internal:** staged-authority gates, session manager implementation, graph
  identity indexes, and protocol implementation helpers not exported at a
  package entrypoint.
- **Deferred:** projected-data persistence and a complete SSR/hydration product.

## Core model

A host contains a canonical map and a canonical stream. Changed map commits are
published in one incarnation-specific order:

```ts
type LiveHostCanonicalCommit = Readonly<{
  logicalMapId: string;
  incarnationId: string;
  mode: "data-object" | "data-array" | "element" | "fragment";
  prevRev: number;
  rev: number;
  ops: readonly LiveHostCanonicalOp[];
}>;
```

Four channels must not be confused:

1. The LiveMap is persistent canonical state.
2. Changed commits form the bounded canonical history.
3. `event` messages are transient and connection-scoped; they are not commits.
4. Action request/result messages are command traffic. An action may return a
   result without changing state.

Data maps use projected `set`, `delete`, `replace`, and `splice` operations.
Document maps use graph operations such as `set-attr`, `insert-content`, and
`move-content`. Clients apply only the operation domain matching their map mode.

### JSON framing and HSON graph payloads

LiveHost messages remain JSON text. Metadata and projected-data operations
remain JSON-domain fields. Canonical document content uses this explicit
boundary instead of the incidental JSON object layout of `HsonNode`:

```ts
type LiveHostEncodedGraphContent = Readonly<{
  format: "hson-graph";
  formatVersion: 1;
  payload: string;
}>;
```

It is used for node- or primitive-bearing commit fields, hosted document
content actions, retained history, recovery tails, and persistence. Malformed
HSON, unsupported versions, extra fields, invalid structure, and duplicate
persisted QUIDs are rejected before mutation. Complete-map `view-state`
snapshots remain separate because they also own exact mode and revision and
support empty-fragment restoration.

## `create_livehost(options?)`

**Stable for data hosts; experimental for document/exclusive modes.**

The factory is synchronous. Supply either `state` or an existing `map`, not both.
Omitting both creates a projected object map from `{}`.

```ts
type Actions = {
  increment: { by: number };
};

const host = create_livehost<{ count: number }, Actions>({
  state: { count: 0 },
  actions: {
    async increment(ctx, payload) {
      await ctx.mutate((draft) =>
        draft.at(["count"]).update((count) => count + payload.by),
      );
      return ctx.map.snap(["count"]);
    },
  },
});
```

Important options:

- `state`: initial projected JSON state.
- `map`: an existing data or document LiveMap.
- `actions`: partial action-handler map.
- `schema`: host-level validators/decoders for state and action payloads.
- `authorizeAction(context)`: sync or async authorization hook.
- `authority`: `"shared"` (default) or `"exclusive"`.
- `sessionId`: fixed ID or factory for legacy connection hellos.
- `logicalMapId`, `incarnationId`: canonical recovery identity.
- `history`: `{ maxCommits?, maxBytes? }`; defaults are 1,024 commits and
  4 MiB encoded history.
- `recovery`: `{ maxTailCommits?, maxTailBytes? }`; defaults are 256 commits and
  1 MiB captured while a recovery attempt completes.
- `sessions`: resumable-session configuration. `graceMs` defaults to 30 seconds.
- `actionDedupe`: request retention configuration. Defaults are 1,024 terminal
  records, 4 MiB, five minutes, and 1,024 expired tombstones.
- `trace`: a synchronous, locally isolated trace sink.

The result exposes:

```ts
host.map;
host.stream;
host.recovery;
host.sessions;
host.actionRequests;
host.seq;
host.schema;
host.dispatch_action(message);
host.connect(socket);
host.dispose();
```

In `"shared"` mode `host.map` is the original mutable map. In `"exclusive"`
mode it is a read/observe facade and mutations must use `host.mutate(...)` or an
action's `ctx.mutate(...)`. A map cannot simultaneously have conflicting shared
and exclusive host authorities.

## Actions

Action payload names and payload types come from the `TActions` generic.
Handlers receive `(context, payload, message)` and return JSON, `void`, or a
promise of either.

`LiveHostActionContextForMap` provides:

- `map`: current readable map (restricted in exclusive mode);
- `mutate(callback)`: serialized staged mutation, returning a commit;
- `seq`: current legacy protocol sequence;
- `origin`: direct or resumable-session origin;
- `emit_event(name, payload)`: sends a transient event to the originating
  attached session and returns whether delivery occurred.

`authorizeAction` runs before execution of an action arriving through an
attached session. Its context contains the action name, cloned/frozen payload,
session information, and canonical map identity. A false result produces
`LIVEHOST_ACTION_FORBIDDEN`; a thrown/rejected policy produces
`LIVEHOST_ACTION_AUTHORIZATION_FAILED`. Direct `dispatch_action` has direct
origin and is not a session-authorization boundary.

Direct invocation uses a real protocol-shaped request:

```ts
const response = await host.dispatch_action({
  type: "action",
  id: "attempt-1",
  requestId: "request-1",
  clientId: "example-client",
  name: "increment",
  payload: { by: 2 },
});

if (response.type === "ack") {
  console.log(response.result, response.completionRev);
}
```

Known actions returning without mutation are successful no-ops:
`completionRev` stays at the current revision and no canonical commit is
published. Changed mutations are accepted and published before the terminal
action outcome is cached.

Retry safety is keyed by logical `clientId` plus `requestId`. A concurrent
duplicate joins the pending execution; a retained duplicate receives the cached
outcome. Reusing an ID with conflicting action content is rejected. `id`/
`attemptId` identify a delivery attempt, not the logical command.

Document hosts additionally recognize the built-in typed action names
`document.attrs.*` and `document.content.*`; the client `action()` overloads
expose their payload types.

## Commits, revisions, and publication

Only changed LiveMap commits enter the canonical stream. A changed commit has
`rev === prevRev + 1`; a no-op LiveMap commit has no ops and does not advance the
revision. The host validates identity, mode, operation shape, continuity, and
the post-mutation state schema before publication.

`host.stream.on_commit(listener)` observes changed canonical commits and returns
an idempotent disposer. `headRev` is synchronous. History offers:

```ts
host.stream.history.can_replay(fromRev, throughRev?);
host.stream.history.replay_after(fromRev, throughRev?);
host.stream.history.debug();
```

Consumers ignore exact duplicate revisions, but a revision gap is not silently
applied. Recovery is required. A revision ahead of authority is rejected.

The older `hello`/`patch`/`sync` sequence channel remains public for projected
subscriptions. Canonical `rev` is the recovery and persistence ordering key;
`seq` is the connection protocol sequence and is not a substitute for `rev`.

## Snapshots, replay, and recovery

The transport-independent planner accepts:

```ts
const plan = host.recovery.plan({
  logicalMapId: host.stream.logicalMapId,
  incarnationId: host.stream.incarnationId,
  lastAppliedRev: 0,
});
```

Outcomes are:

- `current`: the requested revision is already the head;
- `replay`: bounded history contains every commit after the cursor;
- `snapshot`: no usable revision, incarnation mismatch, or evicted history;
- `reject`: invalid target/request or a revision ahead of authority.

For `current`, `replay`, and `snapshot`, call `plan.complete(observer?)`. The
completion contains the cut revision plus commits that arrived while the body
was consumed. Always call `plan.dispose()` if an attempt is abandoned.

The default snapshot envelope is:

```ts
type LiveHostSnapshotEnvelope = Readonly<{
  logicalMapId: string;
  incarnationId: string;
  rev: number;
  mode: "data-object" | "data-array" | "element" | "fragment";
  hson: string;
}>;
```

Document connections may advertise `viewStateVersions: [1]`; the host then
negotiates the validated JSON-safe view-state encoding. HSON remains mandatory
capability and fallback. Malformed snapshots, wrong identity/mode, unsupported
encoding, replay conflicts, gaps, and tail overflow fail recovery rather than
partially installing state.

`create_livehost_client({ socket, map, recovery })` owns the connection-side
state machine. `client.recovery.recover()` resumes from its configured cursor,
installs a snapshot when required, applies body/tail/live commits, ignores exact
duplicates, and reports gaps. `on_change` observes installed commits/snapshots.

## Sessions and projected subscriptions

`host.connect(socket)` registers one transport and returns a callable
`LiveHostConnection` disposer with `emit_event`. Closing/disposal removes
listeners and transient connection state.

Resumable sessions use `session-create`, `session-attach`, and
`session-goodbye`. Credentials are opaque strings. Reattachment increments a
connection epoch and fences an older attachment. A disconnected session retains
subscriptions during its grace period, then expires; goodbye revokes it
immediately. Inspect with `host.sessions.debug()` and `on_change`.

For data maps, client `subscribe(path)` registers a projected path. The host
immediately sends a `sync` with the current cloned value and sends later `sync`
messages for overlapping commits. `unsubscribe(path)` stops that path.
Subscriptions survive an eligible session reattachment and are cleared by
expiry, goodbye, or host disposal. Document maps intentionally do not expose
projected subscriptions; use canonical recovery/commit observation.

## Transport boundary

```ts
type LiveHostSocketLike = Readonly<{
  send(message: string): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (message: string) => void): (() => void) | void;
  onClose(listener: () => void): (() => void) | void;
}>;
```

Messages are JSON text and protocol payloads are JSON-safe. LiveHost owns
decoding, validation, action routing, subscription state, recovery, and outgoing
ordering. An adapter owns the actual WebSocket/in-memory channel, backpressure,
authentication before attachment, and platform lifecycle.

The abstraction works with in-memory test transports, Node WebSocket wrappers,
and Worker/Cloudflare socket wrappers. No package-exported adapter is supplied.
The host core does not import Node WebSocket APIs. Protocol decoders return
`LiveHostResult`; they do not throw for malformed envelopes. There is no
top-level numeric protocol-version field; recovery snapshot encodings carry
their own format version.

## Persistence

**Experimental; document modes only; exclusive authority required.**

```ts
interface LiveHostPersistenceAdapter {
  load(logicalMapId: string): Promise<LiveHostPersistedMapState | undefined>;
  appendCommit(record: LiveHostPersistedCommit): Promise<void>;
  replaceCheckpoint(record: LiveHostPersistedCheckpoint): Promise<void>;
}
```

`create_persistent_livehost` first durably replaces the exact initial
view-state-v1 checkpoint. Each later graph commit is prepared, durably appended,
then made visible; append failure prevents acceptance/publication. Exact repeated
appends for the same map/incarnation/revision must be idempotent and conflicting
repeats must reject. `checkpoint()` atomically replaces the checkpoint and
removes commits through its revision.

```ts
const document = hson.liveMap.fromTrustedHtml("<main>Hello</main>");
const persistent = await create_persistent_livehost({
  authority: "exclusive",
  map: document,
  logicalMapId: "home",
  persistence: adapter,
});

await persistent.checkpoint();
```

`create_livehost_persistent_store(adapter)` can create, load, unload, list, and
connect named document authorities. Load validates checkpoint and commits,
restores the exact revision, and replays a contiguous canonical tail. Unload
disposes the host and waits for exclusive work to close; it does not delete
backend data. Projected-data persistence is explicitly reserved and rejected.

## SSR and server execution

LiveHost and projected/document LiveMap authority operations are DOM-free.
They can be created, read, mutated, captured, and recovered in Node or a Worker.
HTML construction is parser-based and does not require a browser DOM when the
input is a string; passing browser `Element` objects is naturally browser-only.

For one-shot rendering, no socket, subscription, or session is required:

```ts
const host = create_livehost({
  state: { title: "Server title", items: ["a", "b"] },
});

const renderState = host.map.capture(); // detached value plus exact revision
const json = JSON.stringify(renderState);
host.dispose();
```

`map.snap()` gives a synchronous cloned projected value; `capture()` couples it
to `rev`. Document maps use `root()`/`capture()`. Persistent-host creation and
loading are asynchronous; ordinary host construction and reads are synchronous.
An SSR renderer remains outside LiveHost.

A hydration payload should preserve logical/incarnation identity and revision,
then use canonical recovery rather than assuming the server snapshot is still
current. How LiveTree HTML hydration consumes that payload is unresolved.
Request-scoped hosts should be disposed. Shared process/Worker authorities may
outlive requests but require application lifecycle management. Worker adapters
must arrange durable-object/event-lifetime concerns; Node adapters must arrange
socket server and shutdown behavior.

## Errors and validation

Wire errors use `{ message, code?, path?, cause? }`. Important implemented code
families include:

- malformed message and JSON-safe validation errors from protocol decoders;
- `LIVEHOST_UNKNOWN_ACTION`, `LIVEHOST_ACTION_FORBIDDEN`,
  `LIVEHOST_ACTION_AUTHORIZATION_FAILED`, `LIVEHOST_SCHEMA_INVALID_PAYLOAD`,
  action request/deduplication codes, and normalized handler failures;
- recovery reject/runtime codes, including invalid target/request,
  `REVISION_AHEAD_OF_AUTHORITY`, gaps, overflow, incompatible snapshots, and
  unavailable document recovery;
- session credential, expiry, fencing, attachment, and goodbye codes;
- `LIVEHOST_PROJECTED_SUBSCRIPTION_UNSUPPORTED` for document maps;
- schema state/payload failures;
- persistence errors exposed by `LiveHostPersistenceError`, including exclusive
  authority, unsupported map kind, initial checkpoint, append, checkpoint, and
  invalid persisted state failures.

Socket `send`/listener failures are isolated where publication can continue;
action, recovery, and persistence failures return or throw according to their
public signature. Consult the exported error unions instead of string-matching
messages.

## Known limitations and deferred surfaces

- Persistence supports document maps only and has no bundled backend.
- No real WebSocket/Cloudflare adapter is package-exported.
- Document projected subscriptions are unsupported.
- History and action outcomes are bounded in memory.
- Events are not replayed or persisted.
- SSR rendering, HTML hydration, and request-framework integration are not
  implemented by LiveHost.
- Debug constructors and diagnostics are callable but are not the preferred
  application entrypoints.
