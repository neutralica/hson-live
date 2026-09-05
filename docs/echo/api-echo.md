# Echo API reference

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
LiveTree ⇅ Reflect ⇅ replica LiveMap ⇅ Echo ⇅ Locus ⇅ Locus LiveMap
                                   Echo ⇅ Locus
```

Echo serializes supported Reflect requests, lowers each at queue head against
the latest accepted replica, sends an existing built-in document action, and
does not lower the next request until the replica reaches `completionRev`.
Rejection changes neither map nor projection and does not fail Reflect.

Echo does not perform optimistic mutation, authorization, application policy,
or generic data proposals. Hosted data changes continue through
application-defined Locus actions. An accepted QUID remains readable after
replay; synchronous QUID demand for an unquidded Echo-bound node is rejected.

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
`incarnationId`. Receipt of that result does not claim local replica or Reflect
convergence.

Echo exposes its actual Schema-bound `LiveMap`, not a duplicate read-only map
hierarchy. Direct public mutation rejects with the managed-mutation authority
error; only accepted canonical replay mutates an Echo-governed map.

Replica state observation belongs to LiveMap commit/sub/feed/watch facilities.
Echo has no topology-aware `subscribe`/`unsubscribe`, public `seq`, or
`onEvent` surface.

Bootstrap continuation is `create_locus_bootstrap_echo(...)`. Its
`LocusBootstrapEcho.echo` owns the live continuation and
`connectAndRecover()` connects and installs the authoritative recovery cut.
