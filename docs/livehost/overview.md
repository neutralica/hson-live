# LiveHost architecture and runtime boundary

This is the current architectural reference for LiveMap, Locus, applications,
LiveHost, and the LiveHost Node runtime.

## Ownership and cardinality

| Layer | Owns | Cardinality |
|---|---|---|
| LiveMap | Canonical graph state, revision, mutation, schema enforcement, capture/apply/replay, paths, and graph equality | May exist without a Locus |
| Locus | Private/shared authority state, local initializer definitions, mutation admission, history, sessions, actions, persistence, and projected synchronization | One authority registry plus one definition catalog |
| Echo | Semantic hosted client endpoint and request/session lifecycle, optionally managing one composed projected LiveMap | Endpoint-only or one authority-projected registry replica |
| Mirror | LiveTree ↔ LiveMap bridge; delegates supported hosted authoring through Echo without owning transport policy | One binding |
| Application | Domain meaning, custom actions and side effects, authorization policy, event semantics, topology, acquisition-key meaning, retention policy, and cross-Locus workflows | Zero or more Loci |
| LiveHost | Runtime-neutral application identity, request and connection routes, readiness/disposal, and progressive authoring | One application component |
| LiveHostRuntime | Bound application registration, dispatch, and lifecycle | Zero or more applications |
| LiveHost Node | HTTP and WebSocket ingress, Web Request/Response adaptation, origin and proxy policy, limits, heartbeat/backpressure, `/healthz`, and network/process shutdown | One concrete runtime implementation of `LiveHostRuntime` |

LiveMap is state, with Locus and Echo as its authoritative and replica governors.
LiveTree realizes state in a browser, and Mirror connects LiveMap to LiveTree.
An application owns meaning and topology. `LiveHost` describes one runtime-neutral
application component; LiveHost Node binds components into a `LiveHostRuntime`.

For hosted documents, the client path is
`LiveTree → Mirror → Echo → Locus → authoritative library registry`, followed by
`Echo replay → Mirror → LiveTree / DOM` convergence. LiveHost routes and
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
import { hsonLiveMap } from "hson-live/livemap";
import { bind_node_locus_websocket } from "hson-live/locus/node";
import { hsonLiveHost, create_livehost_locus_registry } from "hson-live/livehost";
import { start_node_application_host } from "hson-live/livehost/node";
```

- `hson-live/locus` is the platform-neutral registry authority API.
- `hson-live/locus/node` contains the concrete Node WebSocket binder for session-projected Locus.
- `hson-live/livehost` contains platform-neutral application contracts,
  pre-bind authoring helpers, and the bounded registry service.
- `hson-live/livehost/node` is the concrete Node application-host runtime and
  security boundary.

`hsonLiveHost.create()` authors a `LiveHost` component; it does not bind a network runtime.
Node is currently the concrete runtime implementation. The four package
surfaces do not provide historical one-map LiveHost aliases.

## Application authoring

The raw application and request descriptor remain first-class:

```ts
import { hsonLiveHost, type LiveHostApplication } from "hson-live/livehost";

const application: LiveHostApplication = {
  name: "deck",
  requests: [
    { method: "POST", path: "/save", handle: async (request) =>
      new Response(await request.text(), { status: 201 }) },
  ],
  dispose() {},
};
```

Created hosts also construct request descriptors. A single path and handler
returns one descriptor; grouped tuples return an ordered plain array:

```ts
const host = hsonLiveHost.create({ name: "deck" });
const page = host.GET("/", home.render);
const pages = host.GET(
  ["/", home.render],
  ["/slides/1", slide01.render],
);

const declarative: LiveHostApplication = {
  name: "deck",
  requests: pages,
  dispose() {},
};
```

`POST`, `PUT`, and `DELETE` have the same forms. A method call adds its route
to that host. A marked document `render` callable is invoked for
each request and delivered as a `Response` with
`Content-Type: text/html; charset=utf-8`. Later document and stylesheet edits
appear in later responses. Pass `render` directly: a new wrapper function does
not carry its hidden producer marker. Ordinary raw handlers still return a `Response` or
`Promise<Response>`; arbitrary strings are not interpreted as HTML.

For progressive authoring, `create` makes a new application with an empty
request array and a no-op disposer when omitted:

```ts
const host = hsonLiveHost.create({ name: "deck" });
host.GET("/", home.render);
host.POST("/save", async (request) =>
  new Response(await request.text(), { status: 201 }));
host.GET(["/slides/1", slide01.render], ["/slides/2", slide02.render]);
host.add({ method: "OPTIONS", path: "/custom", handle: () => new Response() });

const authoredApplication: LiveHostApplication = host;
```

`host.add` accepts one or several ordinary raw request descriptors, including
custom methods. `create(rawApplication)` copies the input request array while
retaining its descriptor objects, then appends later routes in call order. It
preserves supplied connection, readiness, and disposal behavior. All forms
compose into the same raw LiveHost application model.

Complete progressive construction before passing the application to a runtime.
The current Node host scans its routes once at startup; later additions to the
authoring array do not update live dispatch. Existing startup registration
remains responsible for names, paths, and duplicate-route validation.

## Requests and responses

A `LiveHostRequestRoute` matches one exact method and path. Its handler receives
the original Web `Request`, including its query, plus a
`LiveHostApplicationContext`, and returns a Web `Response`. Response bodies may
stream.

The LiveHost Node runtime converts Node ingress to a Web `Request` and streams
the Web `Response` incrementally. It preserves response-header semantics,
including repeated `Set-Cookie`, and owns physical body errors, disconnects,
and backpressure. Those Node mechanics are not generic LiveHost API.

## SSR delivery relationship

SSR composition remains application-owned and uses the existing generic route
and `Response` machinery:

```text
application / LiveHost route
  -> map.cut / session.now
  -> encode_ssr_bootstrap
  -> standard Response
```

LiveHost consumes these artifacts through ordinary application routes; it has
no special SSR API. The application owns shell construction, carrier selection,
out-of-band bootstrap delivery, same-cut association, caching, and security
policy. The later Echo connection may use WebSocket or another semantic
transport arrangement; SSR/bootstrap delivery neither selects that transport
nor carries connection endpoint metadata.

## Long-lived connections

`LiveHostConnection` is a deliberately small generic transport. It sends and
receives only `string | Uint8Array`, reports closure, and can close the
connection. It is not a Node WebSocket object, a Locus protocol, binary Hson,
or a general socket framework.

LiveHost Node adapts physical WebSocket transport to this interface.
Applications own connection meaning and may choose to connect one to a Locus.

For HTTP Echo, applications register ordinary `POST` request routes and call
`bind_locus_http(...).handle(request, { principalId: context.principal.id })`
after LiveHost authentication. The binder uses one continuing Web `Response`
for ordered replica synchronization or endpoint control observation, alongside
independent finite operation requests. LiveHost only writes the Web response
with normal backpressure; it does not interpret Echo or Locus messages.
An application serving no-JavaScript streamed HTML can use a different response
representation and need not construct JavaScript Echo. Scout exists as optional
application/page-response continuation ignition; LiveHost does not emit it.

## Authentication and authorization

The layering is:

```text
LiveHost Node ingress -> establishes authentication and security evidence
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

Locus supplies a session-projected `AuthorityProjectionSnapshot` from one coherent authority cut. Application/runtime code supplies routing, HTML shell, carrier placement, and delivery. Hosted SSR uses `hson-ssr-bootstrap` with `hosted-projection`; local SSR uses the distinct `libraries` payload family. The active hosted socket envelope is `hson-locus-hosted-aggregate-message`. All are QUID-free and bound to the session projection. Malformed hosted payloads are rejected. Authority persistence remains complete and server-side.
