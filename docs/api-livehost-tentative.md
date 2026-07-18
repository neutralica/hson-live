#### hson-live / hson.terminalgothic.com

# LiveHost API
**Status: WIP / tentative API reference**

Updated: 2026-07-17

This document describes the current implemented LiveHost surface. LiveHost is
under active development: exported names and behaviors documented here exist
today, but the protocol is not yet a stable production synchronization
contract.

For the technical direction and explicitly roadmapped completed model, see
`hson-livehost.md`. This reference does not present planned behavior as current
API.

---

## Public entry points

The preferred facade is `hson.liveHost`:

```ts
hson.liveHost.create(options?)
hson.liveHost.client(options)
hson.liveHost.registry()
hson.liveHost.protocol.decode(message)
hson.liveHost.protocol.encode(message)
hson.liveHost.debug.resumeLog(options?)
hson.liveHost.debug.syncManager(map)
```

Package-root function exports are also available:

```ts
create_livehost(options?)
create_livehost_client(options)
create_livehost_store()
create_livehost_registry() // alias of create_livehost_store
decode_livehost_message(message)
decode_livehost_server_message(message)
encode_livehost_message(message)
make_livehost_resume_log(options?)
make_livehost_sync_manager(map)
```

The package root exports `LiveHostDisconnectedError` and
`LiveHostDuplicateActionIdError`. It also exports the principal LiveHost types
listed later in this document. More protocol-detail types are available through
the package's `hson-live/types` subpath.

There is no dedicated `hson-live/livehost` package subpath export.

---

## Result and error data

Several lower-level LiveHost methods return explicit result data:

```ts
type LiveHostResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: LiveHostError }>;

type LiveHostError = Readonly<{
  message: string;
  code?: string;
  path?: LivePath;
  cause?: unknown;
}>;
```

Protocol decoders and registry/sync operations use this shape rather than
throwing for their ordinary recognized failures. Transport callbacks, schema
functions, action-ID factories, map operations, and lower-level send functions
can still throw outside that result boundary.

Action protocol errors use the server-message shape documented below rather
than `LiveHostResult`.

---

## Creating an authoritative host

```ts
type CounterState = { count: number };
type CounterActions = { increment: { by: number } };

const host = hson.liveHost.create<CounterState, CounterActions>({
  state: { count: 0 },
  actions: {
    increment(ctx, payload) {
      ctx.map.set(["count"], ctx.map.at(["count"]).snap() + payload.by);
      return { count: ctx.map.at(["count"]).snap() };
    },
  },
});
```

Equivalent package-root form:

```ts
const host = create_livehost(options);
```

Signature:

```ts
create_livehost<TState, TActions>(
  options?: LiveHostOptions<TState, TActions>,
): LiveHost<TState, TActions>
```

Options:

```ts
type LiveHostOptions<TState, TActions> = Readonly<{
  state?: TState;
  actions?: Partial<LiveHostActions<TActions, TState>>;
  schema?: LiveHostSchema<TState, TActions>;
  sessionId?: string | (() => string);
}>;
```

`state` defaults to `{}`. The host constructs an internal LiveMap with
`hson.liveMap.fromJson`. Consequently, current LiveMap construction boundaries
also apply: object and array roots are reliable, object roots currently begin at
map revision 1, and top-level scalar roots can fail HSON transform invariants.
An explicit `null` state currently falls back to `{}`.

The returned host surface is:

```ts
host.map
host.stream
host.recovery
host.sessions
host.actionRequests
host.seq
host.schema
host.dispatch_action(message)
host.connect(socket)
host.dispose()
```

The host object is not frozen. `map` is the authoritative LiveMap instance.
`schema` is the same schema option supplied at construction. `seq` is a dynamic
getter.

### Host sequence

`host.seq` begins at 0 and increments once after each action handler completes
successfully. It does not currently equal `host.map.rev`:

- creating an object-root host normally gives the map revision 1 while host
  sequence remains 0;
- one action can create zero, one, or several LiveMap commits but advances host
  sequence once; and
- failed or unknown actions do not advance host sequence.

Treat `seq` as the current action-response/synchronization sequence, not as a
canonical LiveMap revision.

---

## Action typing

Action payload types are expressed as a record:

```ts
type Actions = {
  increment: { by: number };
  reset: undefined;
};

type State = {
  count: number;
};

const host = hson.liveHost.create<State, Actions>({
  state: { count: 0 },
  actions: {
    increment(ctx, payload) {
      ctx.map.set(["count"], ctx.map.at(["count"]).snap() + payload.by);
    },
    reset(ctx) {
      ctx.map.set(["count"], 0);
    },
  },
});
```

Every action payload must be a `JsonValue` or `undefined`. An action handler may
return a `JsonValue`, `void`, or a promise of either.

```ts
type LiveHostActionContext<TState> = Readonly<{
  map: LiveMap<TState>;
  seq: number;
  origin: LiveHostActionOrigin;
  emit_event(event: string, payload: JsonValue): boolean;
}>;

type LiveHostActionOrigin =
  | Readonly<{
      kind: "session";
      sessionId: LiveHostSessionId;
      epoch: LiveHostConnectionEpoch;
      resumable: boolean;
    }>
  | Readonly<{ kind: "direct" }>;
```

`ctx.seq` is the host sequence observed when the handler context is created. It
does not change inside that context when the action later succeeds.

`ctx.emit_event` is connection-scoped when an action arrived through
`host.connect`. It sends an event immediately and returns true while that
connection is active. For direct `host.dispatch_action`, it always returns
false.

`ctx.origin` is frozen invocation-time authority. An action received through a
LiveHost connection gets a `session` origin derived from the server-bound
session record and attachment epoch. Lazy sessions report `resumable: false`;
explicitly created and reattached sessions report `resumable: true`. Direct
`host.dispatch_action` receives `{ kind: "direct" }`, even if its message
contains a `clientId`.

`ctx.origin.sessionId` is trusted host identity. `message.clientId` is supplied
by the client for request correlation and action deduplication and is not an
authority identity. No action-message field can override `ctx.origin`.

For an async handler, the origin remains the immutable authority captured when
the handler was invoked. If the socket later detaches or is fenced, the already
started handler may continue and may still mutate the map. Its
`ctx.emit_event(...)` then returns false because event delivery checks current
connection authority. LiveHost does not cancel or roll back the handler.

Action handlers are awaited. The implementation does not serialize concurrent
async handlers; their map operations can interleave, and successful responses
receive sequence numbers in completion order.

---

## `host.dispatch_action(message)`

Directly executes one action without a connection:

```ts
const result = await host.dispatch_action({
  type: "action",
  id: "action-1",
  name: "increment",
  payload: { by: 2 },
});
```

It returns a server `ack` or `error` message; ordinary action failures are data,
not rejected promises.

Successful result:

```ts
{
  type: "ack",
  id: "action-1",
  ok: true,
  seq: 1,
  result?: JsonValue,
}
```

Unknown action:

```ts
{
  type: "error",
  id,
  ok: false,
  seq: host.seq,
  error: {
    code: "LIVEHOST_UNKNOWN_ACTION",
    message: string,
  },
}
```

Other current codes produced during dispatch:

- `LIVEHOST_SCHEMA_INVALID_PAYLOAD` for rejected action payloads;
- `LIVEHOST_ACTION_FAILED` when the handler throws or returns a non-JSON value.

A handler's returned value is checked for finite JSON-compatible data. A void
result omits the `result` property.

Handler mutations are not wrapped in an automatic LiveMap batch or rollback
boundary. If a handler mutates the map and then throws, those mutations remain
committed even though the response is an error and host sequence does not
advance.

Direct dispatch does not publish subscription sync messages because it has no
connection send cycle. Direct map changes likewise do not automatically invoke
the LiveHost sync manager.

---

## Preliminary schemas

```ts
type LiveHostSchema<TState, TActions> = Readonly<{
  state?: LiveHostValidator<TState> | LiveHostSchemaDecoder<TState>;
  actions?: {
    [Name in keyof TActions]?: {
      payload?: LiveHostValidator<TActions[Name]>
        | LiveHostSchemaDecoder<TActions[Name]>;
    };
  };
}>;
```

A validator is a type guard:

```ts
(value: unknown) => value is TValue
```

A decoder returns:

```ts
{ ok: true, value: TValue }
// or
{ ok: false, issues: readonly string[] }
```

Action payload schemas run immediately before their handlers. A type guard that
returns false produces the generic issue `Value failed LiveHost schema
validation.` A decoder's issues are joined with semicolons for the protocol
error message.

The state schema is invoked during host construction. When it rejects, construction falls back to the original supplied state. The state schema is not attached to `host.map` and does not validate
later mutations. Use an attached LiveMap schema separately when current runtime
state enforcement is required.

Schema functions that throw are not uniformly converted into schema result
data. This surface is preliminary and must not be treated as an authorization
or security boundary.

---

## Socket-like transport

```ts
type LiveHostSocketLike = Readonly<{
  send(message: string): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (message: string) => void): (() => void) | void;
  onClose(listener: () => void): (() => void) | void;
}>;
```

LiveHost sends and receives JSON strings. `onMessage` and `onClose` may return
cleanup functions. The Core invokes those cleanup functions when its connection
is disposed or the socket reports close.

Neither host nor client currently calls `socket.close()` from its own
`disconnect` function. Adapters own actual transport closure.

Callbacks, sends, and listener cleanup are not wrapped in error isolation.
Adapter exceptions can escape or interrupt LiveHost work.

---

## `host.connect(socket)`

```ts
const connection = host.connect(socket);

connection.emit_event("presence", { online: true });
connection(); // dispose
```

The returned `LiveHostConnection` is a callable, idempotent disposer with an
`emit_event` method. Disposal marks the connection inactive, removes its sync
session, and runs registered socket-listener cleanup functions in reverse order.

Each connection receives a session ID. With no `sessionId` option, the host
generates a process-local value using time and a module counter. A string option
reuses that string for every connection. A function option runs once per
connection.

Duplicate active session IDs cause a `LIVEHOST_DUPLICATE_SESSION` error message,
but current `connect` continues installing message/close listeners and returns a
connection object. Use a factory that produces unique active IDs.

### Incoming message handling

The host handles four client message kinds:

- `hello` sends a current snapshot and may replay retained sync messages;
- `action` dispatches an action, sends its response, then republishes all
  subscribed paths when the response is an acknowledgment;
- `subscribe` stores a path and immediately sends its current value;
- `unsubscribe` removes that exact path subscription.

Malformed decoded input produces a server error message at the current host
sequence. Errors from later path resolution or socket sends are not consistently
converted into protocol errors.

### Connection events

```ts
connection.emit_event("notice", { text: "Ready" });
```

The event is sent only while the connection is active. The public method returns
void even though the internal action-context form returns a boolean. Events are
not sequenced, retained, replayed, or broadcast to other sessions.

### Session lifecycle observation

`host.sessions` exposes diagnostics, lifecycle observation, and explicit
session-manager disposal:

```ts
host.sessions.debug()
host.sessions.on_change(listener)
host.sessions.dispose()
```

`on_change` returns an idempotent disposer. Listeners are observational:
listener exceptions are caught, do not interrupt a transition, and do not
prevent later listeners from receiving the event. Listeners registered after
manager disposal receive no replay and return an inert disposer.

```ts
type LiveHostSessionLifecycleEvent =
  | Readonly<{
      kind: "attached";
      session: LiveHostSessionDiagnostic;
      attachment: "created" | "reattached";
    }>
  | Readonly<{ kind: "detached"; session: LiveHostSessionDiagnostic }>
  | Readonly<{ kind: "expired"; session: LiveHostSessionDiagnostic }>
  | Readonly<{
      kind: "revoked";
      session: LiveHostSessionDiagnostic;
      reason: "goodbye" | "host_disposed";
    }>
  | Readonly<{
      kind: "fenced";
      sessionId: LiveHostSessionId;
      epoch: LiveHostConnectionEpoch;
    }>;
```

Events are emitted after their represented transition. Each `session` value is
a frozen diagnostic snapshot, and `host.sessions.debug()` called inside the
listener agrees with it. Initial lazy and explicit creation emits
`attached/created`. A resumable replacement first fences an old active
attachment, emitting `fenced` with its old epoch, then establishes the new
epoch and emits `attached/reattached`. Reattachment from a disconnected grace
period has no live attachment to fence, so it emits `attached/reattached` after
canceling expiry.

Normal transport loss emits `detached`. A non-resumable session expires
synchronously, so observers see `detached` immediately followed by `expired`.
A resumable session stays disconnected until reattachment or grace expiry;
grace expiry emits `expired`. Explicit goodbye emits `revoked/goodbye` and
cancels expiry. Manager or host disposal emits `revoked/host_disposed` for each
non-terminal live session and cancels its expiry timer. Rejected attachment
attempts emit no lifecycle success event.

### `host.dispose()`

`host.dispose()` is idempotent host-wide teardown. It marks the host disposed
before cleanup, makes existing connections inert, removes their LiveHost
message/close listeners, stops recovery channels, revokes live sessions with
`reason: "host_disposed"`, cancels session expiry and action-dedupe retention,
and releases connection references. Attached sessions receive the terminal
revocation without a shutdown-only `detached` event.

Disposal preserves `host.map`, `host.stream`, and readable session diagnostics.
It does not call `socket.close()`; the server or transport adapter continues to
own physical socket closure. A later adapter-owned socket close is safe.

After disposal, `host.dispatch_action(...)` returns a normal server error with
code `LIVEHOST_HOST_DISPOSED`. `host.connect(socket)` installs no listeners,
does not close the socket, and returns an inert idempotent connection disposer.
`host.sessions.on_change(...)` is inert and has no replay. Repeated disposal
does not repeat lifecycle events.

---

## Creating a client

```ts
const client = hson.liveHost.client<State, Actions>({
  socket,
  map: optionalExistingMap,
  clientId: "client-a",
  actionId: () => crypto.randomUUID(),
});
```

Equivalent root export:

```ts
create_livehost_client(options)
```

Options:

```ts
type LiveHostClientOptions<TState> = Readonly<{
  socket: LiveHostSocketLike;
  map?: LiveMap<TState>;
  clientId?: string;
  actionId?: () => string;
}>;
```

When `map` is omitted, the client creates `hson.liveMap.fromJson({})`. Generated
client IDs and action IDs are module-local incrementing strings (`lhc-*` and
`lha-*`). They are not durable, random, or globally unique.

The returned client is frozen and exposes:

```ts
client.map
client.seq
client.connect()
client.disconnect()
client.subscribe(path)
client.unsubscribe(path)
client.on_event(listener)
client.action(name, payload?)
```

`seq` is a dynamic getter. It begins at 0 and is replaced by the `seq` field of
each accepted hello, sync, patch, acknowledgment, or error message. The client
does not currently reject duplicates, regressions, or gaps.

---

## `client.connect()` and `client.disconnect()`

`connect()` installs socket message/close listeners, sends:

```ts
{
  type: "hello",
  clientId,
  lastSeq: client.seq,
}
```

and returns the `disconnect` function. Calling `connect` while already connected
returns that same function without reinstalling listeners or sending another
hello.

`disconnect()`:

- marks the client disconnected;
- runs registered socket-listener cleanup in reverse order; and
- rejects all pending action promises with `LiveHostDisconnectedError`.

It does not clear event listeners, reset sequence, replace the map, send an
unsubscribe message, or call `socket.close()`. It is safe to call repeatedly.

A socket close notification calls `disconnect()`.

---

## Client actions

```ts
const response = await client.action("increment", { by: 2 });

if (response.type === "ack") {
  response.result;
} else {
  response.error;
}
```

Payload is optional only when the action's declared payload type includes
`undefined`. The client generates an ID, stores a pending promise, and sends an
action message.

Acknowledgments and action-associated error messages both resolve the promise.
They do not reject it. Rejection is reserved for client-side lifecycle errors:

- `LiveHostDisconnectedError`, code `LIVEHOST_DISCONNECTED`, when action is
  requested while disconnected or the client disconnects before completion;
- `LiveHostDuplicateActionIdError`, code `LIVEHOST_DUPLICATE_ACTION_ID`, when
  the configured ID generator returns an ID already pending. The error includes
  `actionId`.

The host does not currently deduplicate repeated action IDs across delivered
messages. Client duplicate detection covers only its own pending map.

The host sends the acknowledgment before subscription sync messages. Therefore,
an action promise can resolve before the client's mirrored map receives the
resulting subscribed values.

---

## Client path subscriptions

```ts
client.subscribe(["documents", "active"]);
client.unsubscribe(["documents", "active"]);
```

These methods only send protocol messages. They return void, do not track local
subscription state, and do not provide a disposer. Calling them while
disconnected still calls `socket.send`.

The host stores subscriptions by `JSON.stringify(path)`. Re-subscribing the same
path replaces the stored copy and immediately sends its value again.
Unsubscribing an absent path is a successful no-op.

Current sync messages contain the complete current projected value at the
subscribed path. The client applies them with:

```ts
client.map.set(message.path, message.value)
```

This has important current limits:

- the path must already resolve in the client map;
- root path sync fails because LiveMap `set([])` is unsupported;
- `undefined` is not a JSON write value and is omitted by JSON serialization;
- object-valued sync uses shallow constructive set, so it does not remove stale
  client siblings; and
- malformed or invalid paths can throw during host resolution or client apply.

Path sync is ordered commit envelopes + snapshot fallback + client-side apply/replay


---

## Client events

```ts
const dispose = client.on_event((message) => {
  message.event;
  message.payload;
});
```

`on_event` registers a listener in a client-local set and returns an idempotent
disposer. Event listeners survive client disconnect/reconnect unless individually
disposed.

Each decoded event is synchronously delivered to a snapshot of the listener
set. Listener exceptions are not caught and can prevent later listeners from
running for that message.

---

## Server messages applied by the client

### Hello

```ts
{
  type: "hello",
  sessionId: string,
  seq: number,
  snapshot: TState,
}
```

The client assigns `seq` and exactly root-replaces its LiveMap with `snapshot`.
It does not retain the server `sessionId`.

### Sync

```ts
{
  type: "sync",
  seq: number,
  path: LivePath,
  value: JsonValue | undefined,
}
```

The client assigns `seq` and calls map `set` at the path, subject to the
selective-sync limits above.

### Patch

```ts
{
  type: "patch",
  seq: number,
  ops: readonly LiveMapOp[],
}
```

The type exists. The current client updates only its `seq`; it does not validate
or replay `ops`. The current host does not emit patch messages.

### Acknowledgment and error

Both assign client `seq`. When `id` matches a pending action, the message removes
and resolves that pending entry. Error messages without an ID are not exposed
through a general client error listener.

### Event

Events are delivered to `on_event` listeners without changing client sequence.

---

## Client protocol messages

### Hello

```ts
type LiveHostClientHelloMessage = Readonly<{
  type: "hello";
  clientId?: string;
  hostId?: string;
  lastSeq?: number;
}>;
```

The host currently ignores `clientId` and `hostId` after decoding. `lastSeq` is
used only for retained sync replay eligibility.

### Action

```ts
{
  type: "action",
  id: string,
  name: string,
  payload?: JsonValue,
}
```

### Subscribe and unsubscribe

```ts
{ type: "subscribe", path: LivePath }
{ type: "unsubscribe", path: LivePath }
```

---

## Protocol encoding and decoding

### `decode_livehost_message(message)`

Decodes a client-to-host JSON string and returns:

```ts
{ ok: true, value: LiveHostClientMessage }
// or
{ ok: false, error: LiveHostError }
```

It requires an object and recognizes hello, action, subscribe, and unsubscribe.
Action ID/name must be non-empty strings and a supplied payload must be JSON.

Hello fields are optional; invalid optional values are silently omitted. Client
messages may contain extra keys. Subscribe paths must be arrays whose parts are
strings or numbers, but the current decoder does not enforce LiveMap's
non-negative-integer numeric path rule.

Parse failures include the caught value in `error.cause`.

### `decode_livehost_server_message(message)`

Decodes a server-to-client string. Event messages are strict: they require
exactly `type`, `event`, and `payload`; the event must be non-empty and payload
must be JSON.

Hello, patch, sync, acknowledgment, and error messages are currently accepted
when the parsed value is an object with a recognized `type`. Their remaining
fields are not runtime validated by this decoder.

The high-level client silently ignores a string that this decoder rejects.

### `encode_livehost_message(message)`

Encodes a server message with `JSON.stringify`. It explicitly validates event
name and payload. Other server message shapes are not runtime validated before
encoding.

The high-level client encodes its own client messages directly with
`JSON.stringify`; there is no separately exported client-message encoder.

`hson.liveHost.protocol.decode` is `decode_livehost_message`, the client-message
decoder. `hson.liveHost.protocol.encode` is the server-message encoder. Use the
package-root `decode_livehost_server_message` for the other direction.

---

## Resume log

Available through:

```ts
hson.liveHost.debug.resumeLog(options?)
make_livehost_resume_log(options?)
```

Surface:

```ts
log.record_sync(message)
log.replay_after(seq)
log.can_replay_after(seq)
log.debug_entries()
```

`maxEntries` defaults to 100. It is truncated to an integer and clamped to at
least zero. Zero disables recording. The implementation does not reject
non-finite values; `NaN` can effectively defeat the bound.

Entries contain `seq`, `path`, and `value`. Paths and values are cloned when
recorded and again when read or replayed. `replay_after(seq)` returns sync
messages with sequence strictly greater than `seq`.

`can_replay_after(seq)` returns true when the log is empty or when `seq` is at
least one less than the oldest retained entry sequence. It does not compare the
request with a current host sequence or prove that every intervening canonical
commit exists.

The host records every sync message it sends through its normal sync path,
including initial subscription sync and one delivery per subscribed
session/path. The log can therefore contain repeated sequence values and
session-specific duplicates. Events, acknowledgments, errors, snapshots, and
LiveMap commits are not recorded.

On hello, the current host always sends the latest snapshot first. If
`can_replay_after(lastSeq)` is true, it then sends retained sync messages after
that sequence. Consumers must not interpret this helper as a completed
snapshot-or-commit resume protocol.

---

## Sync manager

Available through:

```ts
hson.liveHost.debug.syncManager(map)
make_livehost_sync_manager(map)
```

Surface:

```ts
sync.add_session(sessionId, send)
sync.remove_session(sessionId)
sync.subscribe(sessionId, path, seq)
sync.unsubscribe(sessionId, path)
sync.sync_session_path(sessionId, path, seq)
sync.sync_all(seq)
sync.debug_sessions()
```

`add_session` rejects a duplicate ID with code `LIVEHOST_DUPLICATE_SESSION`.
Operations that require an absent session return
`LIVEHOST_UNKNOWN_SESSION`. `remove_session` is a no-op for an unknown ID.

`subscribe` copies and stores the path, then immediately calls the session send
function with its current map value. `unsubscribe` removes the exact serialized
path key. `sync_session_path` sends one path without subscribing it. `sync_all`
synchronously sends every stored path for every session.

The manager does not subscribe to LiveMap feeds. Callers decide when to invoke
sync. It does not validate IDs, paths, sequences, or send functions beyond
TypeScript types, and send exceptions are not isolated.

`debug_sessions` returns new session records and copied path arrays. It does not
expose send functions.

---

## Host registry

```ts
const registry = hson.liveHost.registry();
// aliases:
create_livehost_store();
create_livehost_registry();
```

Surface:

```ts
registry.has(id)
registry.get(id)
registry.create(id, options?)
registry.set(id, host)
registry.delete(id)
registry.list()
registry.connect(id, socket)
```

The registry object is frozen and stores hosts in a process-local Map.

`create` constructs and inserts a host. `set` inserts an existing host. Neither
overwrites: an existing ID returns:

```ts
{
  ok: false,
  error: {
    code: "LIVEHOST_STORE_DUPLICATE_ID",
    message: string,
  },
}
```

`get` returns the live host reference or `undefined`. `delete` returns the Map
deletion boolean. Deletion does not disconnect sessions or dispose the host.
Registry ownership and host lifetime remain separate: applications that want
both operations must call `host.dispose(); registry.delete(id)`. Deleting first
also leaves an already-held host reference usable until it is explicitly
disposed.

`list` returns a new insertion-ordered array of frozen `{ id, host }` entries;
the host objects themselves remain live references.

`connect` delegates to the named host or returns
`LIVEHOST_STORE_UNKNOWN_ID`. Its declared success value is a disposer; the
runtime value is the host's callable connection and still carries
`emit_event`, though that extra method is not represented by the registry
return type.

---

## Principal package-root types

The main package entry currently re-exports:

```ts
LiveHost
LiveHostActionContext
LiveHostActionHandler
LiveHostActionId
LiveHostActionName
LiveHostActionPayloads
LiveHostActions
LiveHostClient
LiveHostClientActionFn
LiveHostClientActionResult
LiveHostClientHelloMessage
LiveHostClientMessage
LiveHostClientOptions
LiveHostConnection
LiveHostDisposer
LiveHostError
LiveHostEventListener
LiveHostId
LiveHostOptions
LiveHostResult
LiveHostSchema
LiveHostSchemaDecoder
LiveHostSchemaIssue
LiveHostSchemaResult
LiveHostSeq
LiveHostServerEventMessage
LiveHostServerMessage
LiveHostSocketLike
LiveHostStore
LiveHostStoreCreateOptions
LiveHostStoreEntry
LiveHostStoreId
LiveHostValidator
```

The `hson-live/types` subpath additionally exports protocol-detail types such as
individual hello, action, subscribe, patch, sync, acknowledgment, and error
messages; `LiveHostSessionId`; and `LiveHostActionSchema`.

Types exported directly from the lower-level resume and sync modules are not
currently package-root type exports.

---

## Current behavioral boundaries

- LiveHost is a WIP API
- Host sequence counts successful actions rather than canonical LiveMap
  revisions.
- Handler mutations can survive a failed response.
- Direct map mutations do not automatically synchronize sessions.
- Successful connected actions resend complete subscribed path values.
- Selective sync uses constructive `set`, so it is not exact for objects and
  cannot generally create missing paths or synchronize the root.
- Accepted graph changes are transmitted as ordered patch or commit envelopes and applied by clients in authoritative revision order.
- Resume stores path-value deliveries, not canonical commits, and replays after
  a current snapshot.
- Protocol validation is partial, especially for server messages.
- Clients detect duplicate, stale, or missing revisions and request replay or snapshot replacement.
- State schema rejection and subsequent state validation are not enforced.
- Session IDs, client IDs, and action IDs are process-local defaults.
- Events are transient and connection-scoped.
- The registry and logs are in-memory only.
- Host actions and graph proposals are validated against authentication, authorization, schema, revision, and resource constraints before acceptance.

LiveHost makes synchronization conflicts explicit, ordered, observable, and recoverable.


© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
