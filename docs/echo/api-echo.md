# Echo API reference

Echo's internal operation and synchronization architecture is described in
[Transport capabilities](./transport-capabilities.md). The public hosted
adapter remains WebSocket.

Echo is semantic hosted-client participation in one Locus authority domain.
There is one public `Echo` type family with two capability-sensitive
construction forms:

```ts
import { create_echo, hsonEcho, type Echo, type EchoOptions } from "hson-live/echo";

const endpoint = create_echo({ socket });
const replica = create_echo({ socket, map, recovery });
```

`hsonEcho.create`, `hson.echo.create`, and `create_echo` have the same
construction behavior. An endpoint-only Echo exposes `clientId`, `session`,
`connect`, `disconnect`, `dispose`, `action`, `retryAction`, and `actionStatus`.
It does not construct or expose a LiveMap and has no recovery capability.

A replica-bearing Echo requires both an explicit `map` and recovery
configuration. It exposes the same endpoint capabilities plus that exact map
and `recovery`. Echo claims exclusive management of the supplied map, but the
presence of `.map` is not proof that it is caught up: exactness is established
by recovery state. Local-only state belongs in a separate local LiveMap.

Library count is a LiveMap topology concern, not an Echo kind. Supplying a
fixed-library map preserves its exact library and Schema types through the
same `Echo` family and reproduces the complete authoritative registry under
one global revision.

```text
LiveTree ⇅ Mirror ⇅ replica LiveMap ⇅ Echo ⇅ Locus ⇅ Locus LiveMap
                                   Echo ⇅ Locus
```

Echo serializes supported Mirror requests, lowers each at queue head against
the latest accepted replica, sends an existing built-in document action, and
does not lower the next request until the replica reaches `completionRev`.
Rejection changes neither map nor projection and does not fail Mirror.

For hosted `replace-content` authoring, Echo derives operation-relative
source/destination path lineage from its own local replacement intent. Locus
applies that correspondence to Locus-local identities; the generated QUIDs of
the two runtimes do not define the portable replacement lifetime. Exact-QUID
graph content and witnesses remain in the temporary Phase 4A stream as an
oracle and will be removed in Phase 4C.

Echo does not perform optimistic mutation, authorization, application policy,
or generic data proposals. Hosted data changes continue through
application-defined Locus actions. A client-local QUID remains readable after
replay while its subject survives. An unquidded Echo-bound node may acquire a
client-local QUID through its
LiveMap and Mirror. That demand does not contact Locus, advance `map.rev`, or
publish an application commit.

Transport connection, semantic session establishment, and replica recovery
are separate lifecycle layers. `connect()` installs listeners on the supplied
transport; it does not create or reattach a session and does not recover a
replica. Use `echo.session.create()` or `echo.session.reattach(...)` before
`action`, `retryAction`, `actionStatus`, or replica recovery. Successful
session establishment records `echo.session.logicalMapId` and
`echo.session.incarnationId`.

`disconnect()` detaches transport listeners and settles uncertain endpoint
operations without ending the session, releasing map management, or closing a
caller-owned socket. The Echo may reconnect. `echo.dispose()` is terminal and,
for a replica-bearing Echo, releases exclusive management.

An action's `completionRev` is the authoritative stream head at terminal
settlement, interpreted with the current session's `logicalMapId` and
`incarnationId`. Receipt of that result does not claim local replica or Mirror
convergence. Echo processes one ordered authority stream: a graph commit applies
an application effect, while generic progress advances the processed authority
position without graph or DOM work. `map.rev` is the processed authority
position. A completion waiter settles only after Echo has processed every
revision through `completionRev`, including progress-only revisions.

Configured actions preserve full canonical Hson data fidelity in both
directions. `Echo.action(name, payload)` accepts strictly admissible ordinary
JavaScript data or an existing `HsonData`; absence remains distinct from present
null. Echo admits the payload once and retains that immutable exact snapshot, so
caller mutation cannot affect retries. Handlers and authorizers receive
`HsonData` as the authoritative payload and may explicitly call
`Hson.data.materialize(payload)` when an ordinary view is sufficient. A top-level
string action argument is interpreted as canonical Hson data text; wrap an
ordinary JavaScript string with `Hson.data.from(text)` first. Successful results are
also `HsonData`, including retained status and cached retries; handlers may
return ordinary admissible data or `HsonData`, while void remains no result.

The action fingerprint and transport use the same deterministic exact-data
encoding. Therefore `0` differs from `-0`, object member order is semantic,
integer-like authored order is retained, and valid own names such as
`__proto__`, `constructor`, and `prototype` are safe. Unsupported runtime values
reject instead of being normalized by JSON serialization. The outer protocol
remains JSON-framed, but action data is carried as canonical structural text;
the semantic contract is transport-neutral and does not depend on WebSocket.

Custom schema decoders inspect the exact admitted value. Their successful output
is strictly re-admitted, and that transformed `HsonData` is the single value
seen by authorization and execution. Hson Schema action validators evaluate the
underlying exact data carrier directly.

Echo exposes its actual Schema-bound `LiveMap`, not a duplicate read-only map
hierarchy. Direct public mutation rejects with the managed-mutation authority
error; only accepted canonical replay mutates an Echo-governed map.

Replica graph changes are observed through LiveMap commit/sub/feed/watch
facilities. Progress-only authority advancement emits no application commit or
value/mutation observation; internal authority-position observers support Echo
convergence and Mirror revision ordering.
`EchoRecovery` has no `onChange` observation member. Echo has no topology-aware
`subscribe`/`unsubscribe`, public `seq`, or `onEvent` surface.

Bootstrap continuation is `create_locus_bootstrap_echo(...)`. Its
`LocusBootstrapEcho.echo` owns the live continuation and
`connectAndRecover()` connects and installs the authoritative recovery cut.
