# Locus API reference

Locus makes exactly one `LiveMap` authoritative. It owns ordered mutation,
actions, authorization, sessions, recovery, publication, and optional document
persistence. Applications compose zero or more Loci; the Node application host
is a separate runtime boundary.

## Package boundaries

```ts
import {
  hsonLocus,
  create_locus,
  create_locus_client,
  create_persistent_locus,
  capture_locus_bootstrap,
  encode_locus_bootstrap,
  decode_locus_bootstrap,
  install_locus_bootstrap,
  create_locus_bootstrap_client,
  create_browser_locus_socket,
} from "hson-live/locus";

import {
  create_node_locus_socket,
  handle_node_locus_bootstrap_request,
} from "hson-live/locus/node";

import { start_node_application_host } from "hson-live/livehost/node";
```

There is no generic `hson-live/livehost` package root in the U10 boundary.
Multi-Locus store, persistent-store, and authority-registry implementations are
internal pending the future LiveHost API. They are not members of `hsonLocus`
or `hson.locus`.

The Locus facade has exactly four members:

```ts
hsonLocus.create;
hsonLocus.client;
hsonLocus.protocol;
hsonLocus.debug;
```

The umbrella facade exposes the same object as `hson.locus`.

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

`LocusOptions<TMap, TActions>` accepts an existing authoritative map.
`ProjectedLocusOptions<TState, TActions>` creates a projected data map from
state. A Locus owns one canonical stream identified by `logicalMapId` and
`incarnationId`; neither is its route selector or a client identity.

## Client and protocol

`create_locus_client` creates a mirror client over `LocusSocketLike`. The
protocol codec functions are:

```ts
encode_locus_message(message);
decode_locus_message(text);
decode_locus_server_message(text);
```

Message discriminators such as `action`, `recover`, `commit`, and
`session-create` remain semantic message kinds. A hello message may contain
`type` and an optional `clientId`; the removed `hostId` field rejects.

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

## Bootstrap

The current outer bootstrap is unversioned:

```ts
type LocusBootstrap = Readonly<{
  format: "hson-locus-bootstrap";
  locusSelector: string;
  logicalMapId: string;
  incarnationId: string;
  mode: "data-object" | "data-array" | "element" | "fragment";
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

## Persistence

`create_persistent_locus` is the document persistence constructor. It uses a
`LocusPersistenceAdapter`, appends each changed commit before visibility, and
supports exact checkpoint replacement. Projected-data persistence remains
reserved and rejects.

The multi-authority persistent store is intentionally not public in U10.

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
