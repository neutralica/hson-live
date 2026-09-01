# Locus API reference

Locus makes one `LiveMap` authority authoritative. That authority is either one solo data/document map or one fixed multi-library map. It owns ordered mutation,
actions, authorization, sessions, recovery, publication, and optional document
persistence. Applications compose zero or more Loci; the Node application host
is a separate runtime boundary.

## Package boundaries

```ts
import {
  hsonLocus,
  create_locus,
  create_persistent_locus,
  capture_locus_bootstrap,
  encode_locus_bootstrap,
  decode_locus_bootstrap,
  install_locus_bootstrap,
  create_browser_locus_socket,
  encode_locus_graph_content,
  decode_locus_graph_content,
  is_locus_encoded_graph_content,
} from "hson-live/locus";

import { hsonEcho, create_echo, create_locus_bootstrap_echo } from "hson-live/echo";

import {
  create_node_locus_socket,
  handle_node_locus_bootstrap_request,
} from "hson-live/locus/node";

import { start_node_application_host } from "hson-live/livehost/node";
```

`hson-live/livehost` is the platform-neutral application/runtime contract and
exports the bounded `LiveHostLocusRegistry` service. The basic and persistent
multi-Locus stores remain internal application utilities. None of these
services is a member of `hsonLocus` or `hson.locus`.

The Locus facade has exactly three members:

```ts
hsonLocus.create;
hsonLocus.protocol;
hsonLocus.debug;
```

The umbrella facade exposes the same object as `hson.locus`. Echo is separate:
`hsonEcho.create`, `hson.echo.create`, and `create_echo` have the same behavior.
`hsonLocus.client` does not exist.

## Core construction

The canonical authority type is `Locus<TMap, TActions>`.

```ts
const locus = create_locus({
  state: { count: 0 },
  actions: {
    async increment(context) {
      await context.mutate((draft) => draft.set(["count"], 1));
    },
  },
});
```

`LocusOptions<TMap, TActions>` accepts an existing authoritative map. The
public type named `ProjectedLocusOptions<TState, TActions>` creates a data map
from state; “projected” here is the established identifier, not the prose name
for the data side. A Locus owns one canonical stream identified by
`logicalMapId` and `incarnationId`; neither is its route selector or a client
identity.

### Fixed multi-library construction

`hsonLocus.create({ map })` also accepts the public result of
`hsonLiveMap.fromLibraries(...)`. The map keeps its literal Library names and
per-Library HsonSchemas. Actions use the same `context.mutate(...)` model, with
`draft.lib("name")` selecting the Library for that one atomic global action.
There is still one revision cursor and one ordered commit stream, not a stream
per Library. The normal `hsonEcho.create({ map, socket, recovery })` route
bootstraps and recovers one complete same-topology mirror; data subscriptions
are library-qualified. Named document Libraries work with `hsonReflect` across
live updates and in-place replacement recovery.

Fixed multi-library construction reuses the ordinary action authority options:
`schema.actions`, `authorizeAction`, `sessionId`, `sessions`, and
`actionDedupe`. Its Locus exposes the same `sessions` and `actionRequests`
inspectors. Its Echo exposes the ordinary `clientId`, `session`, `action`,
`retryAction`, and `actionStatus` vocabulary; request identity and session
credentials cover the complete fixed registry rather than an individual
Library.

## Client and protocol

`create_echo` creates an Echo over `LocusSocketLike`. Echo exclusively governs
one exact client LiveMap replica. Public mutation of that replica is fenced;
bootstrap, restore, recovery, and accepted canonical replay are its state-changing paths. The
protocol codec functions are:

```ts
encode_locus_message(message);
decode_locus_message(text);
decode_locus_server_message(text);
```

Message discriminators such as `action`, `recover`, `commit`, and
`session-create` remain semantic message kinds. A hello message admits exactly
`type` and an optional `clientId`; every other field rejects through ordinary
exact-shape validation.

The core depends only on `LocusSocketLike`: text `send`, close, message
subscription, and close subscription. `create_browser_locus_socket` adapts the
browser WebSocket API and exposes `ready`, status, and idempotent disposal. It
accepts text messages only. `create_node_locus_socket` provides the Node
adapter from `hson-live/locus/node`; transports frame the protocol but do not
change authority, revision, or recovery semantics.

Raw-QUID request targeting remains supported for current document actions.
The authority lowers those requests to path-authoritative canonical commits.
Legacy QUID-only canonical commits reject.

## Canonical history and recovery

Changed commits advance the authoritative map revision once. Clients apply
commits in order, ignore exact duplicates, and reject gaps or conflicting
overlap. `make_locus_canonical_stream` and `make_locus_recovery_planner` expose
the lower-level current/replay/snapshot machinery.

Recovery identity uses `LocusLogicalMapId` and `LocusIncarnationId`. Client
identity uses `LocusClientId`. Transport routing uses the distinct public
`LocusSelector` type.

The canonical stream retains a bounded commit history by count and encoded
bytes. Recovery planning selects `current`, ordered `replay`, replacement
`snapshot`, or `reject` from the authority incarnation, requested cursor, and
retained history. Sessions may be reattached where policy permits, but session
continuity is not state-recovery identity and does not replace the canonical
revision cursor.

## Bootstrap

The current outer bootstrap is unversioned:

```ts
type LocusBootstrap = Readonly<{
  format: "hson-locus-bootstrap";
  locusSelector: string;
  logicalMapId: string;
  incarnationId: string;
  mode: "data-object" | "data-array" | "document";
  rev: number;
  state: { format: "hson"; payload: string };
  continuation: {
    transport: "websocket";
    endpoint: string;
    capabilities: { hsonSnapshots: true };
  };
}>;
```

Its discriminator is `hson-locus-bootstrap` and its media type is
`application/vnd.hson-live.locus-bootstrap+hson`. There is no outer version
constant, version parameter, or `formatVersion` field. The selector field is
`locusSelector`; the old `authoritySelector` shape rejects.

The Node HTTP helper is exported from `hson-live/locus/node`. Successful HTTP
capture and WebSocket continuation must resolve the same application-owned
Locus. The route query is `?locus=`; `?livehost=` is not an alias.

Locus supplies the authoritative snapshot/cut. Application/runtime code
supplies routing and delivery continuation, and one assembler produces the
single bootstrap artifact.

`install_locus_bootstrap` remains a Locus artifact operation.
`create_locus_bootstrap_echo` is exported by `hson-live/echo`; it returns a
`LocusBootstrapEcho` whose live endpoint property is `echo` and whose single
continuation operation is `connectAndRecover()`.

## Persistence

`create_persistent_locus` supports document maps and fixed multi-library maps. It uses a
`LocusPersistenceAdapter`, appends each changed commit before visibility, and
supports exact checkpoint replacement. Data persistence remains
reserved and rejects.

The adapter has three asynchronous operations:

```ts
interface LocusPersistenceAdapter {
  load(logicalMapId): Promise<LocusPersistedMapState | undefined>;
  appendCommit(record: LocusPersistedCommit): Promise<void>;
  replaceCheckpoint(record: LocusPersistedCheckpoint): Promise<void>;
}
```

Document checkpoints contain `logicalMapId`, `incarnationId`,
`mapKind: "document"`, `mode`, `rev`, and a
`{ format: "view-state", payload }` snapshot. Neither checkpoint nor snapshot
has a numeric version field. Exact repeated commit appends must be idempotent;
conflicting repeats must reject. Checkpoint replacement is atomic and removes
commits through its revision. Loaded state is validated and replayed before it
becomes an ordinary in-memory authority.

`PersistentLocus.checkpoint()` enters the same ordered authority queue,
captures the exact current revision, replaces the durable checkpoint, and
trims its covered tail. It does not mutate the map or publish a client commit.

For a fixed multi-library map, the adapter stores opaque aggregate records.
Calling `create_persistent_locus({ map, logicalMapId, persistence })` again
after restart reconstructs the fixed registry through that same production
recovery boundary. Dynamic Library topology and cross-Library QUID transfer
remain unsupported.

## Graph-content codec

Canonical document commit operations use a separate exact graph-content
transport for inserted or replacement content:

```ts
type LocusEncodedGraphContent = Readonly<{
  format: "hson-graph";
  payload: string;
}>;

const encoded = encode_locus_graph_content(content);
const decoded = decode_locus_graph_content(encoded);
```

The payload is deterministic compact Hson data representing one finite Hson
primitive or canonical Hson node. Encoding and decoding validate graph
invariants and QUID syntax. The decoder requires an exact two-field envelope,
rejects an unknown format or malformed/noncanonical payload, and returns
classified `LocusGraphContentCodecError` failures. There is no numeric version
field or legacy decoder. `is_locus_encoded_graph_content(value)` is the
nonthrowing predicate over that same complete admission check.

## Tracing and errors

One-map error classes and observable codes use `Locus*Error` and `LOCUS_*`.
One-map trace events use subsystem `locus`. Generic `LiveTrace*` collector,
sink, and event vocabulary remains neutral. Genuine Node application-host
runtime constants and errors retain their host naming.

## Node split

`hson-live/locus/node` contains only the one-map Node socket and bootstrap HTTP
adapters. `hson-live/livehost/node` contains the Node application-host/runtime
surface: registration, routing, security policy, limits, health, and shutdown.
Neither subpath re-exports the other family.
