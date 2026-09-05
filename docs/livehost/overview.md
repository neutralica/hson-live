# LiveHost architecture and runtime boundary

This is the current architectural reference for LiveMap, Locus, applications,
LiveHost, and the Node runtime.

## Ownership and cardinality

| Layer | Owns | Cardinality |
|---|---|---|
| LiveMap | Canonical graph state, revision, mutation, schema enforcement, capture/apply/replay, paths, and graph equality | May exist without a Locus |
| Locus | Exclusive authority over one LiveMap, FIFO mutation admission, canonical history, recovery, sessions, actions, one-map persistence and synchronization, bootstrap state, and activity | Exactly one LiveMap |
| Echo | Semantic hosted client endpoint and request/session lifecycle, optionally governing an explicit exact-replica LiveMap | Endpoint-only or one solo/fixed-library replica capability |
| Reflect | LiveTree ↔ LiveMap bridge; delegates supported hosted authoring through Echo without owning transport policy | One binding |
| Application | Domain meaning, custom actions and side effects, authorization policy, event semantics, topology, acquisition-key meaning, retention policy, and cross-Locus workflows | Zero or more Loci |
| LiveHost | Application registration and dispatch, generic application context, principal evidence, readiness/disposal, runtime adaptation boundaries, and the optional bounded Locus registry | Zero or more applications |
| Node LiveHost | HTTP and WebSocket ingress, Web Request/Response adaptation, origin and proxy policy, limits, heartbeat/backpressure, `/healthz`, and network/process shutdown | One concrete runtime implementation |

LiveMap is state. Locus is authority over one state domain. An application owns
meaning and topology. LiveHost hosts applications. Node supplies the physical
runtime adapter.

For hosted documents, the client path is
`LiveTree → Reflect → Echo → Locus → authoritative LiveMap`, followed by
`Echo replay → Reflect → LiveTree / DOM` convergence. LiveHost routes and
hosts the application/Locus; it does not own Echo.

## Zero-Locus and optional-Locus applications

A LiveHost application does not require a Locus:

```text
request -> LiveHost -> application -> Response
```

No empty authority list, dummy connection callback, registry, or Locus
configuration is required.

When an application uses authoritative state, composition remains
application-owned:

```text
request or connection
  -> LiveHost
  -> application
  -> application interprets its domain selector or key
  -> application acquires or selects a Locus
  -> Locus
```

LiveHost routes exact request and connection paths to applications. It does not
interpret `?locus=` as a universal topology system. A query parameter remains
visible on the Web `Request`; the application decides whether it is a room,
document, report, tenant, or other domain selector.

## Public packages

```ts
import { create_locus } from "hson-live/locus";
import { create_node_locus_socket } from "hson-live/locus/node";
import { create_livehost_locus_registry } from "hson-live/livehost";
import { start_node_application_host } from "hson-live/livehost/node";
```

- `hson-live/locus` is the platform-neutral one-map authority API.
- `hson-live/locus/node` contains one-Locus Node socket and bootstrap adapters.
- `hson-live/livehost` contains platform-neutral application/runtime contracts
  and the bounded registry service.
- `hson-live/livehost/node` is the concrete Node application-host runtime and
  security boundary.

The generic LiveHost package has no concrete `create_livehost()` factory. Node
is currently the concrete runtime implementation. The four package surfaces do
not provide historical one-map LiveHost aliases.

## Requests and responses

A `LiveHostRequestRoute` matches one exact method and path. Its handler receives
the original Web `Request`, including its query, plus a
`LiveHostApplicationContext`, and returns a Web `Response`. Response bodies may
stream.

The Node runtime converts Node ingress to a Web `Request` and streams the Web
`Response` incrementally. It preserves response-header semantics, including
repeated `Set-Cookie`, and owns physical body errors, disconnects, and
backpressure. Those Node mechanics are not generic LiveHost API.

## Long-lived connections

`LiveHostConnection` is a deliberately small generic transport. It sends and
receives only `string | Uint8Array`, reports closure, and can close the
connection. It is not a Node WebSocket object, a Locus protocol, binary Hson,
or a general socket framework.

Node adapts physical WebSocket transport to this interface. Applications own
connection meaning and may choose to connect one to a Locus.

## Authentication and authorization

The layering is:

```text
Node/runtime ingress -> establishes authentication and security evidence
LiveHost             -> transports LiveHostPrincipal in generic context
application          -> defines domain authorization policy
Locus                -> enforces application-supplied policy for Locus-origin actions
```

Direct/internal Locus dispatch retains its certified bypass behavior. This
boundary does not define users, roles, login, cookies, or an authentication
framework.

## Bounded Locus registry

`LiveHostLocusRegistry` is an optional generic service. It provides
application-defined string-key acquisition, same-key creation coalescing,
leases, bounded residency, activity-aware eviction, idle policy, and disposal.
The application owns key meaning, creation, topology, limits, retention policy,
and whether to use the registry. A registry acquisition key is not inherently
`logicalMapId`.

`automaticSweep` controls scheduling ownership only:

- omitted or `true`: the registry schedules periodic idle sweeps;
- `false`: the registry performs no automatic scheduling, and the application
  or runtime may decide when to call `evict()`;
- `automaticSweep: false` with `sweepIntervalMs` is invalid.

Capacity, creation coalescing, leases, activity blocking, residency, explicit
eviction, and disposal are unchanged by that option.

The basic multi-Locus store is an internal/application utility. The persistent
multi-Locus store is also internal application composition. Neither constructor
is advertised as public API. The bounded registry is the one public generic
LiveHost service.

## Identity and bootstrap

The following identities are distinct:

- `LocusClientId`: client and action-deduplication identity;
- `LocusLogicalMapId` / `logicalMapId`: stable logical map and persistence identity;
- `LocusIncarnationId` / `incarnationId`: one continuous authoritative incarnation;
- `LocusSelector`: application routing/continuation selector for one Locus;
- registry acquisition key: application-defined residency key.

There is no generic `LocusId`.

Locus supplies the authoritative snapshot and recovery cut for bootstrap.
Application/runtime code supplies routing and delivery continuation. One
assembler produces one `LocusBootstrap` artifact with format
`"hson-locus-bootstrap"`, media type
`application/vnd.hson-live.locus-bootstrap+hson`, and selector field
`locusSelector`. The current artifact has no version field and accepts no old
bootstrap form.

Current representations follow one evolving pre-epoch contract. Unsupported
generations are rejected; there is no compatibility ladder unless separately
approved.
