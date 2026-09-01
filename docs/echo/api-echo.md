# Echo API reference

Echo is the client-side endpoint for one Locus authority domain.

```ts
import { create_echo, hsonEcho, type Echo, type EchoOptions } from "hson-live/echo";

const echo = create_echo({ socket, map, recovery });
```

`hsonEcho.create`, `hson.echo.create`, and `create_echo` are the same
construction behavior. Echo claims exclusive management of its LiveMap. The
map is an exact complete replica. A multi-library Echo reproduces the complete
authoritative registry and global revision; local-only state belongs in a
separate local LiveMap.

```text
LiveTree ⇅ Reflect ⇅ Echo LiveMap ⇅ Echo ⇅ Locus ⇅ Locus LiveMap
```

Echo serializes supported Reflect requests, lowers each at queue head against
the latest accepted replica, sends an existing built-in document action, and
does not lower the next request until the replica reaches `completionRev`.
Rejection changes neither map nor projection and does not fail Reflect.

Echo does not perform optimistic mutation, authorization, application policy,
or generic data proposals. Hosted data changes continue through
application-defined Locus actions. An accepted QUID remains readable after
replay; synchronous QUID demand for an unquidded Echo-bound node is rejected.

`echo.dispose()` is terminal for solo and multi-library Echo endpoints and
releases exclusive management. Endpoint callbacks use camelCase:
`onEvent`, `retryAction`, `actionStatus`, and recovery `onChange`.

Echo exposes its actual Schema-bound `LiveMap`, not a duplicate read-only map
hierarchy. Direct public mutation rejects with the managed-mutation authority
error; only accepted canonical replay mutates an Echo-governed map.

Bootstrap continuation is `create_locus_bootstrap_echo(...)`. Its
`LocusBootstrapEcho.echo` owns the live continuation and
`connectAndRecover()` connects and installs the authoritative recovery cut.
