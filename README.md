// readme.md 28SEP2026

# Hson / hson-live v3.5

---

## H.S.O.N. - Hypertext Structured Object Notation

`Hson` is a "glue format": a notation capable of expressing both JSON and HTML fluently by modeling the tree graph structure shared by both.

By parsing to `Hson` as an intermediary step, JSON can be rendered as HTML and vice-versa. This suggests new ways of building the web, and is the core insight that powers hson-live.

## hson-live

`hson-live` a full-stack TypeScript environment for creating "live" web content, built on the `Hson` notation and its capabilities. 

**This project is experimental. It is working architectural research, not a finished product.**

---


## Hson - syntax

JSON and HTML occupy different domains but describe similar structural hierarchies. Hson expresses both.

JSON expresses structure through objects, arrays, keys, and values:

```json
{
  "profile": {
    "name": "Ada",
    "active": true,
    "permissions": [
      "admin",
      "owner"
    ]
  }
}
```

Its equivalent can be represented in Hson:

```hson
<
  profile <
    name "Ada"
    active true
    permissions «
      "admin",
      "owner",
    »
  >
>
```

HTML expresses structure through elements, attributes, and ordered content:

```html
<article class="note">
  <h1>Hello</h1>
  <p>A document represented as a graph.</p>
</article>
```

Hson represents this as:

```hson
<article class="note"
  <h1 "Hello"/>
  <p "A document represented as a graph."/>
/>
```

Both formats parse into the same HsonNode model.

Hson faithfully represents JSON objects, arrays, and typed values, including non-Finite values and -0. At admission, JSON is normalized and member key order preserved within the HSON graph. 

HTML's browser- and context-dependent parsing rules present a moving target for accurate representation. Hson requires XML compatibility, but will attempt to normalize non-compliant HTML to its structurally equivalent XML representation before admittance.

Some HTML edge cases are not supported for security or other ambiguity reasons. In particular, empty `<script>` tags are permitted when carrying `src` attributes, but not inline logic.

Invalid content is rejected rather than silently repaired. After admission and normalization, content remains structurally equivalent even across repeated round-trip transformations.

---


## hson-live - subsystems

`hson-live`'s connected subsystems create and operate on `Hson` graphs as both data and markup, uniting two formerly non-interchangeable notations in one ecosystem. 

- `hson.transform` - creates `Hson` graphs from JSON, HTML, XML, and SVG. Its transformer circuit is stable: normalized user data performs repeated round-trips across formats without drift or distortion.
- `hson.liveTree` - DOM rendering and interaction management. LiveTree projects a `Hson` document to the browser and provides an API surface for event listeners and styling. Mutations to its canonical `Hson` graph are reflected to the DOM in realtime. 
- `hson.liveMap` - a state machine that holds application data and documents in `Hson`. LiveMap controls `Hson` graph mutation, validates changes against TypeScript-compatible schema, and tracks revision history, streaming changes to subscribers.
 - `hson.liveHost` - application/runtime boundary: LiveHost provides the hosting contract, registers applications, and dispatches request and connection routes. LiveHost is responsible for HTTP/WebSocket ingress, security/resource policy, transport adaptation, and process lifecycle.
- `hson.locus` - governs one authoritative server-side LiveMap and synchronizes replicas across client sessions. Locus decides and sequences graph mutation, coordinates persistence and authorization, retains accepted cacnonical history, and synchronizes client replicas (-> Echo).
- `hson.echo` - client-side endpoint; Echo is an unopinionated coordinator of commits from Locus to a client-side LiveMap replica. It tracks authoritative server-side state, sends client mutation intent, and receives state changes back in the form of commits, keeping its replica synchronized.

`hson-live` is flexible by design; its subsystems can be fully deployed, or composed modularly to fit various use cases.

---


## Transform

The transformation layer parses input to canonical `Hson` nodes and serializes those nodes into other representations.

```ts
import { hson } from "hson-live";

const source = {
  message: "hello",
  visible: true,
};

const node = hson.fromJson(source).toNode();

const output = hson.fromNode(node).toHson().serialize();

output === source // true
```

The transformation system handles cases that are commonly awkward at format boundaries, including:

- mixed text and element content
- JSON arrays and object member ordering
- boolean and structured attributes
- HTML void elements
- SVG and XML namespaces
- ordered document content
- canonical metadata;
- persisted node identity.

`hson-live`'s transformation layer provides the node graphs used by its other subsystems.

---



## LiveTree

LiveTree renders Hson as live markup in browser DOM. It queries document.body and parses its contents into a Hson graph, then replaces the DOM with an identical projection from the gra. Mutations made to the underlying Hson graph are reflected to the DOM in realtime.

```ts
const body = hson.liveTree.queryBody().graft();

const message = body
  .create.div()
  .text.set("hello")
  .css.setMany({
    padding: "1rem",
    fontWeight: "700",
  });

message.listen.onClick(() => {
  message
    .text.set("goodbye")
    .css.set.backgroundColor("pink");
});
```

LiveTree is suitable as a standalone runtime for CSR or WPA use cases. Its API provides synchronous graph-backed management of:

- element creation and structural editing
- text and attributes
- forms and datasets
- events and listener ownership
- inline and QUID-scoped CSS
- custom properties
- selectors and conditional CSS
- keyframes and animation control
- SVG
- canvas
- DOM geometry and inspection
- deterministic detach, transfer, removal, and cleanup

LiveTree tracks node references via a QUID attribute that supports graph lookup and continuity, ensuring stable identity even when relocated. QUIDs also enable locally scoped CSS without Shadow DOM or a bespoke class name system.

LiveTree's CSS remains recognizably CSS, with a few extra benefits. Properties can be created with dynamic values directly from JS data, and selector lifecycle is explicitly managed: keyframes, animation, rules, listeners, and other node-owned resources are released when their owning branch is terminally removed. 

---


## LiveMap

LiveMap is a state machine that governs and edits Hson data and document graphs. It controls observation, mutation, Schema validation, snapshot/recovery, and revision history.

For data maps, ordinary state can be created from JSON and addressed directly:

```ts
const map = hson.liveMap.fromJson({
  count: 2,
  items: ["one", "two"],
});

map.at(["count"]).update(
  value => Number(value) + 1,
);

map.at(["items"]).array.push("three");

console.log(map.snap());
```

Document maps expose HTML-specific content and attribute operations:

```ts
const document = hson.liveMap.fromHson(
  `<main <section <p "Hello"/>/>/>`,
);

const paragraph = document.at([0, 0]);

console.log(paragraph.snap());

paragraph.attrs.set("name", "intro");
paragraph.text.set("Goodbye");
```

LiveMap paths are structural coordinates that resolve against the current map revision. Path handles support snapshots, observation, feeds, subscriptions, and mutation without exposing direct references to the graph itself. Data locations expose object and array capabilities; document locations expose structure, text, and attribute operations.

LiveMap validates changes against TypeScript-compatible HsonSchema before commit. Generated types allow state to derive TypeScript evidence from Schema.

Validated changes are applied atomically. Individual or batched mutations advance the map by one revision and publish one canonical commit.

State can be captured, restored, replayed, and recovered through revision-aware primitives used by both local and hosted compositions.

LiveMap coordinates logical path addressing with QUID registration to preserve identity continuity across structural graph changes.

An optional proxy surface provides traversal capabilities through structural property/index traversal; `map.at(...)` remains the explicit path-oriented form.

---


## LiveMap - LiveTree Integration

Bindings connect LiveTree presentation to LiveMap state.

```ts
const state = hson.liveMap.fromJson({
  count: 0,
});

const body = hson.liveTree.queryBody().graft();

const button = body
  .create.button();

const stopBinding = button.bind.text(
  state.at(["count"]),
  value => `count: ${String(value)}`,
);

button.listen.onClick(() => {
  state.at(["count"]).update(
    value => Number(value) + 1,
  );
});
```

For broader graph coordination, `hsonMirror` synchronizes a LiveTree runtime with a LiveMap document authority, turning canonical Hson document state into live, interactive, continuously synchronized web content.

---


## LiveHost

LiveHost is the hosting boundary for Hson applications. It can carry an application from server-side routing and authority through to synchronized browser state and live document updates without requiring another server framework.

LiveHost registers and hosts applications, dispatches HTTP requests and long-lived connections to exact routes, carries principal/admission context, and exposes readiness and lifecycle control.

```text
ordinary application:  request -> LiveHost -> application -> Response
hosted authority:      request/connection -> LiveHost -> application -> Locus
```

Applications remain responsible for their own routes, domain topology, authority selection, actions, authorization policy, persistence, SSR, and response content. LiveHost supplies the common runtime machinery around those choices rather than defining application semantics itself.

The  **LiveHost Node runtime** provides HTTP and WebSocket ingress, Web `Request`/`Response` adaptation, origin and proxy policy, resource limits, heartbeat and backpressure handling, health reporting, graceful shutdown, and optional bounded Locus residency through `create_livehost_locus_registry()`.

Combined with Hson SSR, Echo, Reflect, and LiveTree, a LiveHost application may render useful HTML on the server and continue it in the browser as synchronized, reactive content. Progressive enhancement follows from the same composition rather than requiring a separate client application model.

---


## Connecting the Live Stack

Hson's live subsystems are connected and mediated by three focused components: `Mirror`, `Locus`, and `Echo`.

Mirror keeps LiveMap document state and LiveTree realization in sync. Locus governs an authoritative server-side LiveMap. Echo connects remote clients to that authority and maintains an exact replica LiveMap on the client.

Together they connect local runtime state, hosted authority, and browser realization without introducing a second application-state model.

---


## Locus

A server-side Locus authority governs one LiveMap for a hosted application, ordering accepted changes into a single canonical commit history.

Locus provides:

- typed and validated actions;
- action authorization;
- canonical commit ordering;
- bounded history;
- resumable sessions;
- path subscriptions;
- transient connection events;
- duplicate action-request handling;
- snapshots and replay;
- revision-gap detection;
- recovery after disconnect;
- document-state persistence contracts;
- one-map bootstrap contribution; and
- activity and quiescence observation.

The authority itself remains transport-independent. Locus communicates through a small transport-agnostic interface, and does not depend directly on Node, browser, or Cloudflare networking APIs.

Platform-specific adapters connect Locus to real transports, including browser WebSockets and Node infrastructure; other runtimes can supply the same boundary without changing authority semantics.

Applications retain domain ownership: they define actions and side effects, authorization policy, event meaning, authority topology and acquisition keys, retention policy, and cross-Locus workflows. Locus supplies the common authority, ordering, session, history, and recovery machinery within those application-defined boundaries.

Remote clients with JavaScript enabled may participate through Echo, the corresponding browser endpoint.

---


## Echo

Echo is the hosted client counterpart to Locus.

It connects a remote endpoint to a Locus authority, manages sessions and recovery, and can optionally govern an exact client-side LiveMap replica that follows the accepted canonical commit stream.

An endpoint-only Echo can issue actions and participate in hosted sessions without maintaining local canonical state. A replica-bearing Echo additionally installs and recovers a subordinate LiveMap, allowing streamed authoritative commits to converge into local application state.

```text
Locus
  ↓
authoritative LiveMap
  ↓
ordered accepted commits
  ↓
Echo
  ↓
replica LiveMap
```

Echo does not create competing authority or reconcile peer state. The Locus commit history remains canonical; Echo tracks and recovers toward that history.

Browser transports are supplied separately, allowing Echo to remain focused on hosted participation rather than network implementation.

---

A hosted application can deliver an exact snapshot of authoritative state with its initial response, then continue that same state live through Echo. If the authority changes while the client is connecting or disconnected, Locus and Echo recover the missing history or replace the replica from a newer snapshot.

Together, Locus and Echo allow one server-side LiveMap to remain the canonical source of truth while remote clients maintain synchronized local replicas and live browser realizations.

---


## Mirror

Mirror connects a document LiveMap with a LiveTree runtime, keeping canonical document state and its live realization in sync.

Accepted LiveMap changes are reflected into LiveTree, while semantic LiveTree edits flow back through the same state model.

```text
LiveMap
   ↕
Mirror
   ↕
LiveTree
```

In the browser, this allows canonical Hson document state to remain live as DOM content changes, without introducing a second application-state model.

---


## VS Code extension

The Hson VS Code extension provides syntax highlighting, diagnostics, and Schema-aware authoring support for Hson in the editor. It understands standalone `.hson` files, supported TypeScript authoring forms, and fenced `hson` blocks in Markdown.

Highlighting follows normal VS Code theme behavior, with a small amount of Hson-specific flair. 

The Hson extension can validate against HsonSchema as Hson is being written, and surface mistakes such as invalid structure, literals, or document content before runtime. The same Schema information also supports generated TypeScript declarations, keeping editor feedback aligned with the project’s normal build and check tooling.

The Hson extension provides commands for single-use Schema validation and type generation, as well as a constantly running `watch` mode. 


---

 
## Status

hson-live is experimental and pre-stable. Core systems including Transform, Schema, LiveMap, LiveTree, Mirror, Locus, Echo, SSR/continuation, and LiveHost have substantial automated coverage, but public APIs may still change as the architecture is exercised through real applications.

The project currently favors single-authority hosted state rather than CRDT/offline merge, and distributed multi-process authority coordination remains outside the current model.

Use `fromUntrustedHtml` for untrusted HTML input. `fromTrustedHtml` deliberately bypasses sanitization and must only receive trusted source.

LiveHost Node provides explicit production policy surfaces for origins, identity/admission, authorization, proxy trust, connection limits, heartbeat, and backpressure. Applications remain responsible for their own security policy and deployment environment.

Evaluate API stability and operational requirements before using hson-live for security-critical or public production systems.

---


## Installation and imports

Install `hson-live` and use the root package for ordinary application composition:

```sh
npm install hson-live
```

```ts
import { Hson, hson } from "hson-live";
```

Major subsystems are also available from focused entrypoints:

```ts
import { Hson, HsonData, HsonDocument } from "hson-live/hson";
import { hsonTransform } from "hson-live/transform";
import { hsonLiveMap } from "hson-live/livemap";
import { hsonLiveTree } from "hson-live/livetree";
import { hsonMirror } from "hson-live/mirror";
import { create_locus } from "hson-live/locus";
import { create_echo } from "hson-live/echo";
import { render_document } from "hson-live/ssr";
import { start_node_application_host } from "hson-live/livehost/node";
```

Schema authoring uses the Hson entrypoint and the `hson-schema` CLI for generated TypeScript proof types and static validation:

```ts
import { Hson, type HsonSchema } from "hson-live/hson";
```

```sh
hson-schema generate --project tsconfig.json
hson-schema watch --project tsconfig.json
hson-schema check --project tsconfig.json
```

Use subsystem entrypoints when working directly with lower-level APIs. Node-specific entrypoints such as `hson-live/livehost/node` and `hson-live/locus/node` belong in Node runtimes, not browser or Worker bundles.

The built package exports are the supported integration boundary; consumers should not import from `hson-live/src`.

For development of `hson-live` itself:

```sh
npm install
npm run check
npm run build
npm run check:entrypoints
```

---


## Documentation

Current documentation includes:

- [Hson syntax](docs/hson-syntax.md) and the [Transform API](docs/transform/api-transform.md);
- the [LiveMap API](docs/livemap/api-livemap.md);
- the [LiveTree API](docs/livetree/api-livetree.md);
- Mirror and document continuation;
- the [Locus API](docs/locus/api-locus.md) and [authority overview](docs/locus/overview.md);
- [SSR composition](docs/ssr-composition.md); and
- the [LiveHost / LiveHost Node runtime overview](docs/livehost/overview.md).

More specialized contracts, diagnostics, release notes, and design material live under `docs/`.

Repository: [github.com/neutralica/hson-live](https://github.com/neutralica/hson-live)

---


## License

hson-live is licensed under the PolyForm Strict License 1.0.0. Noncommercial use is permitted under its terms; redistribution, modification, derivative works, and commercial use are not licensed.

See `LICENSE` for the full terms.

---


© 2026 terminal_gothic. All rights reserved except as granted under the PolyForm Strict License 1.0.0.