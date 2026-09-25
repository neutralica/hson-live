// readme-v2.md 16SEP2026

# Hson / hson-live v3.4 

---

## H.S.O.N. - Hypertext Structured Object Notation

`Hson` is a "glue format": a notation capable of modelling both JSON and HTML fluently by modeling the tree graph structure shared by both.

By parsing to `Hson` as an intermediary step, JSON can be rendered as HTML and vice-versa. This suggests new ways of building the web, and is the core insight that powers hson-live.

## hson-live

`hson-live` is a TypeScript library for authoring "live" interactive web content. It is a full-stack reactive framework built on the `Hson` notation and its capabilities. 

**This project is experimental. It is working architectural research, not a finished product.**

---


## Hson - syntax

JSON and HTML occupy different domains, but both describe hierarchical structure.

JSON expresses structure through objects, arrays, keys, and values:

```json
{
  "profile": {
    "name": "Ada",
    "active": true
  }
}
```

The equivalent data can be expressed in Hson:

```hson
<profile <
  name "Ada"
  active true
>>
```

HTML expresses structure through elements, attributes, and ordered content:

```html
<article class="note">
  <h1>Hello</h1>
  <p>A document represented as a graph.</p>
</article>
```

The same markup structure can be expressed in Hson:

```hson
<article class="note"
  <h1 "Hello"/>
  <p "A document represented as a graph."/>
/>
```

Both forms parse into the same canonical node model.

This allows data and markup to pass through one explicit intermediate representation rather than treating HTML as an opaque string inside JSON, or JSON as an incidental script payload inside HTML.

Hson can represent:

• JSON objects and arrays
• strings, numbers, booleans, and null
• HTML, XML, and SVG elements
• element attributes and eligible element metadata
• ordered and mixed markup content
• documents with zero, one, or many top-level nodes
• namespaces and structural wrapper nodes
• stable markup identity for live document nodes

Round trips are deterministic within each transformation contract.

---


## hson-live - subsystems

`hson-live`'s connected subsystems create and operate on `Hson` graphs as both data and markup, uniting two formerly non-interchangeable notations in one ecosystem. 

• `hson.transform` - creates `Hson` graphs from JSON, HTML, XML, and SVG. Its transformer circuit is stable: normalized user data performs repeated round trips across formats without drift or distortion.
• `hson.liveTree` - `Hson` -> DOM rendering pipeline. LiveTree maintains or tracks a canonical node graph containing `Hson` markup, then projects the document as HTML to the DOM. Mutation to the canonical `Hson` graph updates in realtime. 
• `hson.liveMap` - a versatile application state machine that maintains the canonical `Hson` graph and controls mutation. LiveMap manages node graph mutation validated against TypeScript-compatible schema and tracks revision history, pushing changes to subscribers via commits.
 • `hson.liveHost` - the application/runtime boundary. LiveHost registers applications, dispatches exact request and connection routes, and provides the hosting contract. LiveHost Node is the implementation of the generic LiveHost, responsible for HTTP/WebSocket ingress, security/resource policy, transport adaptation, and process lifecycle.
• `Locus` - a server-side canonical LiveMap authority. Locus governs one authoritative LiveMap/state domain and synchronizes replicas across client sessions. Locus decides and sequences graph mutation, coordinates persistence and authorization, retains accepted cacnonical history, and synchronizes client replicas (-> Echo).
• `Echo` - a subjugated client endpoint; Echo is an unopinionated coordinator of commits from Locus to a client-side LiveMap replica. It tracks authoritative server-side state, sends client mutation intent to Locus, receives state changes back in the form of commits, and keeps its subordinate replica synchronized.

`hson-live` is flexible by design; its subsystems can be fully deployed, or composed modularly to fit various use cases. It fully supports no-js modes as a progressive default. 

---


## hson.transform / hsonTransform

The transformation layer parses supported source formats into canonical Hson nodes and serializes those nodes into other supported representations.

```ts
import { hson } from "hson-live";

const source = hson.fromJson({
  message: "hello",
  visible: true,
});

const node = source.toNode();

const text = hson
  .fromNode(node)
  .toHson()
  .serialize();
```

`toNode()` is a local graph view. It may contain generated runtime QUIDs after
identity is acquired. Public `fromNode()` admits only graphs without those
claims; use a portable output format to transfer application state.

The transformation system handles cases that are commonly awkward at format boundaries, including:

- mixed text and element content;
- JSON arrays and object ordering;
- boolean and structured attributes;
- HTML void elements;
- SVG and XML namespaces;
- ordered document content;
- canonical metadata;
- runtime-local node identity.

The graph produced by the transformation layer is used by LiveMap, LiveTree, and Locus.

---



## hson.liveTree / hsonLiveTree

LiveTree turns Hson into browser DOM, rendering Hson markup as live documents. It queries document.body and parses it, then replaces its contents with an identical projection from the Hson graph that follows mutations in synchronously.

```ts
const body = hson.liveTree.queryBody().graft();

const message = body
  .create
  .div()
  .text
  .set("hello")
  .css
  .setMany({
    padding: "1rem",
    fontWeight: "700",
  });

message.listen.onClick(() => {
  message
    .text
    .set("goodbye")
    .css
    .set
    .backgroundColor("pink");
});
```

As a standalone subsystem, LiveTree provides synchronous graph-backed interfaces for:

- element creation and structural editing;
- text and attributes;
- forms and datasets;
- events and listener ownership;
- inline and QUID-scoped CSS;
- custom properties;
- selectors and conditional CSS;
- keyframes and animation control;
- SVG;
- canvas;
- DOM geometry and inspection;
- deterministic detach, transfer, removal, and cleanup.

LiveTree does not require a virtual DOM synchronization pass. Mutating the graph updates its DOM projection directly.

If bound, LiveTree nodes are tracked via a QUID attribute, ensuring stable identity even when relocated. QUIDs support lookup and graph continuity, and enable locally scoped CSS without Shadow DOM or a class name system.

LiveTree's CSS remains recognizably CSS. Dynamic property values can be created within application code based on state changes, and ownership and lifetime become explicit. LiveTree supports and manages rules, keyframes, properties, listeners, and other node-owned resources, releasing them when their owning branch is terminally removed. 

---


## hson.liveMap / hsonLiveMap

LiveMap provides mutable, revisioned application state over canonical Hson graphs. It supports both data and document state, including multiple named data/document libraries coordinated under one LiveMap controlling atomic mutation, observation, Schema governance, capture/recovery, and canonical commit history.

`hsonLiveMap.create()` creates an empty, fully initialized registry at revision 0. Its capture can be restored, and rendering requires a document library. `hsonLiveMap.fromLibraries({})` creates the same empty state. `map.lib.add(...)` admits libraries later.

`ANY_DATA` and `ANY_DOCUMENT` are ordinary broad Schemas, equivalent to `<type "data">` and `<type "document">`. Data libraries admit object, array, string, number, boolean, and null roots. A string data input is JSON source text, so use `data: '"hello"'` for a string root.

Every library enters LiveMap with a name and Schema. Select a data library to read or change its state:

```ts
const StateSchema = Hson.schema`<type "data" content <count "number" items <array "string">>>`;
const map = hson.liveMap.fromLibraries({
  state: {
    data: { count: 0, items: ["one", "two"] },
    schema: StateSchema,
  },
});
const state = map.lib("state");

state.at(["count"]).update(
  value => Number(value) + 1,
);

state.at(["items"]).asArray()?.push("three");

console.log(state.snap());
```

Document libraries provide document paths and operations. LiveMap owns local rendering:

```ts
const PageSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "p" content "string">>>`;
const map = hson.liveMap.fromLibraries({
  page: { document: `<main <p "hello"/>/>`, schema: PageSchema },
});
const paragraph = map.lib("page").at([0]);
console.log(paragraph.snap());
const html = map.render(); // one document library makes selection unambiguous
```

Each document library also owns an initially empty portable stylesheet. Its root-only `page.css` facade writes document-wide selector rules, scopes, variables, `@property`, and keyframes through LiveMap's revisioned commit stream. `page.css.stylesheet("body { margin: 0; }")` parses and appends complete CSS source as one atomic transition; it accepts supported rules and scopes, `@property`, and keyframes. It rejects unsupported at-rules such as `@import`, and never fetches them. For example, `map.lib("page").css.sel("body").set.margin("0")` changes one map revision; `map.render("page")` includes the resulting CSS in a managed `<style>` inside an explicit `<html><head>`. `page.css.snapshot()` returns canonical CSS text for inspection, without source formatting or comments. Data libraries and document path handles have no `.css`; `page.css` has no `.global`. Hosted projection, SSR, Echo replay, fallback, and restart carry this stylesheet with the owning document library. The library's exposure and session grant govern CSS visibility; QUID CSS remains runtime-local.

Standalone LiveTree runtimes accept the same stylesheet grammar through `tree.css.global.stylesheet(cssText)`. That call appends to the runtime's existing global CSS and follows LiveTree synchronization; it does not create a LiveMap revision. The node-scoped `tree.css` surface has no `stylesheet()` method.

Path handles are fixed logical coordinates that re-resolve against the current map revision. They support detached snapshots, observation, feeds, subscriptions, and mutation without exposing mutable references into the graph itself. Data locations additionally expose object and array capabilities; document locations expose authored content, attributes, text, and item operations.

LiveMap validates changes against TypeScript-compatible HsonSchema. Candidate mutations are validated before commit; generated Schema proof types allow certified state to retain corresponding TypeScript evidence at application boundaries.

Validated changes are applied atomically. Individual or batched mutations advance the map by one revision and publish one canonical commit.

The complete library registry can be captured and restored at one map revision. Hosted recovery uses registry-aware authority primitives.

LiveMap coordinates logical path addressing with QUID registration to preserve identity continuity across structural graph changes.

Selected data libraries expose explicit path handles for structural property and index traversal.

---


## LiveMap - LiveTree Integration

LiveTree bindings connect document presentation to LiveMap state.

```ts
const StateSchema = Hson.schema`<type "data" content <count "number">>`;
const map = hson.liveMap.fromLibraries({
  state: { data: { count: 0 }, schema: StateSchema },
});
const state = map.lib("state");

const body = hson.liveTree.queryBody().graft();

const button = body
  .create
  .button();

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

For broader graph coordination, `hson.mirror` synchronizes a LiveTree runtime with a LiveMap document authority, turning canonical Hson document state into live, interactive, continuously synchronized web content.

---


## LiveHost

LiveHost is the generic hosting boundary for Hson applications. It can carry an application from server-side routing and authority through to synchronized browser state and live document updates, without requiring another server framework.

It registers applications, dispatches HTTP requests and long-lived connections to exact routes, carries principal/admission context, exposes readiness and lifecycle control, and can host applications with or without Locus authority.

```text
ordinary application:  request -> LiveHost -> application -> Response
hosted authority:      request/connection -> LiveHost -> application -> Locus
```

Applications remain responsible for their own routes, domain topology, authority selection, actions, authorization policy, persistence, SSR, and response content. LiveHost supplies the common runtime machinery around those choices rather than defining application semantics itself.

The current **LiveHost Node runtime** provides HTTP and WebSocket ingress, Web `Request`/`Response` adaptation, origin and proxy policy, resource limits, heartbeat and backpressure handling, health reporting, graceful shutdown, and optional bounded Locus residency through `create_livehost_locus_registry()`.

Combined with Hson SSR, Echo, Mirror, and LiveTree, a LiveHost application may render useful HTML on the server and continue it in the browser as synchronized, reactive content. Progressive enhancement follows from the same composition rather than requiring a separate client application model.

---


## Connecting the Live Stack

Hson's live subsystems are connected and mediated by three focused components: `Mirror`, `Locus`, and `Echo`.

Mirror keeps LiveMap document state and LiveTree realization in sync. Locus governs an authoritative server-side LiveMap. Echo connects remote clients to that authority and maintains an exact replica LiveMap on the client.

Together they connect local runtime state, hosted authority, and browser realization without introducing a second application-state model.

---


## Locus

A server-side Locus authority governs one LiveMap for a hosted application, ordering accepted changes into a single canonical commit history.

Locus provides:

• typed and validated actions;
• action authorization;
• canonical commit ordering;
• bounded history;
• resumable sessions;
• path subscriptions;
• transient connection events;
• duplicate action-request handling;
• snapshots and replay;
• revision-gap detection;
• recovery after disconnect;
• document-state persistence contracts;
• session-projected bootstrap contribution; and
• activity and quiescence observation.

The authority itself remains transport-independent. Locus communicates through a small transport-agnostic interface, and does not depend directly on Node, browser, or Cloudflare networking APIs.

Platform-specific adapters connect Locus to real transports, including browser WebSockets and Node infrastructure; other runtimes can supply the same boundary without changing authority semantics.

Applications retain domain ownership: they define actions and side effects, authorization policy, event meaning, authority topology and acquisition keys, retention policy, and cross-Locus workflows. Locus supplies the common authority, ordering, session, history, and recovery machinery within those application-defined boundaries.

Remote clients with JavaScript enabled may participate through Echo, the corresponding browser endpoint.

---


## Echo

Echo is the hosted client counterpart to Locus.

It connects a remote endpoint to a Locus authority, manages sessions and recovery, and can optionally govern a complete client-side LiveMap replica that follows the accepted authority stream.

An endpoint-only Echo can issue actions and participate in hosted sessions without maintaining local canonical state. A replica-bearing Echo additionally installs and recovers a subordinate LiveMap, allowing streamed authoritative commits to converge into local application state.

```text
Locus
  ↓
authoritative LiveMap
  ↓
ordered application/system effects and progress
  ↓
Echo
  ↓
replica LiveMap
```

Echo does not create competing authority or reconcile peer state. The Locus commit history remains canonical; Echo tracks and recovers toward that history. Locus and Echo own independent generated-QUID namespaces. Current network content is QUID-free, while paths and replacement lineage carry portable continuity.

Browser transports are supplied separately, allowing Echo to remain focused on hosted participation rather than network implementation.

---

A hosted application can deliver a full QUID-free snapshot of authoritative application and system state with its initial response, then continue that state live through Echo. Incremental replay preserves Echo-local identity through observed effects. Snapshot fallback establishes a fresh Echo-local identity epoch. Authority restart persistence preserves durable state and revision while establishing a fresh Locus generated-QUID epoch.

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
import { Hson, type HsonData, type HsonDocument, type SchemaType } from "hson-live/hson";
import { hsonTransform } from "hson-live/transform";
import { hsonLiveMap } from "hson-live/livemap";
import { hsonLiveTree } from "hson-live/livetree";
import { hsonMirror } from "hson-live/mirror";
import { create_locus } from "hson-live/locus";
import { create_echo } from "hson-live/echo";
import { render_document } from "hson-live/ssr";
import { start_node_application_host } from "hson-live/livehost/node";
```

Hson values are canonical primitive strings classified by their authoring tag. A Schema is an immutable compiled object:

```ts
const canonical = Hson.canonical`<main/>`;
const data: HsonData = Hson.data`<count 1>`;
const document: HsonDocument = Hson.document`<main/><aside/>`;
export const CounterSchema = Hson.schema`<type "data" content <count "number">>`;
export type Counter = SchemaType<typeof CounterSchema>;
const proved: HsonData<typeof CounterSchema> = Hson.data`<count 1>`;
const dynamic = CounterSchema.certify(data);
const portableDefinition = CounterSchema.toHson(); // HsonSchemaData string
```

The `hson-schema` CLI generates Schema-specific evidence and validates direct authored assignments such as `proved`. Ordinary TypeScript alone keeps a tag's result unproved. Use `Hson.document.fromNode` and `Hson.document.toNode` to cross the exact document graph boundary. Admit application state with `hsonLiveMap.fromLibraries({ name: { data, schema } })` or `{ name: { document, schema } }`.

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
