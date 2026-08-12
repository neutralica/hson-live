// readme.md / 29JUL2026

# hson-live

### HSON — a unified notation for HTML and JSON

`hson-live` is a TypeScript system for representing data, documents, browser interfaces, and hosted application state through one canonical node graph.

HSON—Hypertext Structured Object Notation—is the underlying notation. It models the tree structure shared by JSON and markup without reducing either one to the other.

`hson-live` builds four connected systems on that model:

- **hson.transform** converts between HSON, JSON, HTML, XML, SVG, and canonical HSON nodes.
- **LiveMap** operates on HSON as local application state.
- **LiveTree** projects HSON into live browser documents.
- **LiveHost** maintains authoritative HSON state across clients and server runtimes.

The library is experimental. It is working architectural research, not a finished general-purpose web framework.

---

## HSON

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

The equivalent data can be expressed in HSON:

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

The same markup structure can be expressed in HSON:

```hson
<article class="note"
  <h1 "Hello"/>
  <p "A document represented as a graph."/>
/>
```

Both forms parse into the same canonical node model.

This allows data and markup to pass through one explicit intermediate representation rather than treating HTML as an opaque string inside JSON, or JSON as an incidental script payload inside HTML.

HSON can represent:

- JSON objects and arrays;
- strings, numbers, booleans, and null;
- HTML, XML, and SVG elements;
- element attributes and eligible element metadata;
- ordered and mixed markup content;
- document fragments;
- namespaces and structural wrapper nodes;
- stable identity for eligible live document nodes.

Round trips are deterministic within each supported transformation contract.
Authored HSON object members do not carry metadata; eligible element metadata
retains its separate element-mode contract.

---

## One graph, four systems

The four hson-live subsystems are separate interfaces over the same structural model.

They are not intended as unrelated miniature libraries. Together they describe a path from serialized source, through local state and browser projection, to authoritative hosted state.

```text
HSON / JSON / HTML / SVG / XML
                ↓
         canonical HSON graph
                ↓
      LiveMap state and history
                ↓
       LiveTree DOM projection

or:

         canonical LiveHost
                ↓
      ordered revision stream
                ↓
        client LiveMap mirror
                ↓
         LiveTree projection
```

---

## hson.transform

The transformation layer parses supported source formats into canonical HSON nodes and serializes those nodes into other supported representations.

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

The transformation system handles cases that are commonly awkward at format boundaries, including:

- mixed text and element content;
- JSON arrays and object ordering;
- boolean and structured attributes;
- HTML void elements;
- SVG and XML namespaces;
- document fragments;
- canonical metadata;
- persisted node identity.

HSON is not only an interchange format. The same graph produced by the transformation layer is used by LiveMap, LiveTree, and LiveHost.

---

## LiveMap

LiveMap operates on an HSON graph as application state.

For projected data maps, it presents ordinary JSON-shaped state through explicit paths:

```ts
const map = hson.liveMap.fromJson({
  count: 0,
  items: ["one", "two"],
});

map.at(["count"]).update(
  value => Number(value) + 1,
);

map.at(["items"]).array.push("three");

console.log(map.snap());
```

`map.at(...)` is the common passive-location operation for both projected and
document maps. Projected paths traverse logical JSON object members and array
indexes. Document paths contain numeric indexes into ordered authored content:

```ts
const document = hson.liveMap.fromHson(`<main <section <p "hello"/>/>/>`);

if (document.mode === "element") {
  const paragraph = document.at([0, 0]);
  console.log(paragraph.snap());
}
```

Document locations are fixed logical coordinates that re-resolve against the
current map revision. They are passive, return detached reads, and do not count
the internal `_hson_elem` carrier. Specialized attribute and content mutations
remain under `map.document.attrs` and `map.document.content`. Physical document
paths remain the low-level coordinates used by those canonical operations.

Document locations can discover the first exact canonical `id` match in their
current logical subtree:

```ts
if (document.mode === "element" || document.mode === "fragment") {
  const button = document.at([]).id("submit");
  console.log(button?.snap());
}
```

This searches canonical HSON rather than the DOM. The scoped element itself may
match; otherwise descendants are visited in canonical preorder, with the first
match winning. The result is an ordinary passive, fixed-coordinate location.
If the matched element later moves, call `id(...)` again to discover its current
location—the previously returned location continues to represent its old
logical coordinate.

Existing logical content items can also be replaced or deleted through their
locations:

```ts
if (document.mode === "element" || document.mode === "fragment") {
  document.at([0]).replace(replacementContent);
  document.at([1]).delete();

  document.proxy()[0].$_.replace(replacementContent);
  document.proxy()[1].$_.delete();
}
```

These operations mutate the current occupant of a fixed logical coordinate.
After deletion, later content shifts into that coordinate; the location does not
follow the removed subject. The document root location `at([])` cannot be
replaced or deleted this way. Ordered insertion and movement remain under
`map.document.content`.

The existing proxy surface follows the same document coordinates:

```ts
if (document.mode === "element") {
  const paragraph = document.proxy()[0][0].$_;
  const submit = document.proxy().$_.id("submit");
  console.log(paragraph.snap());
  console.log(submit?.snap());
}
```

Numeric proxy properties traverse logical document content, and `$_` exits to
the passive location at that coordinate. Internal carriers remain hidden.
Document facets and mutation operators are not exposed through the proxy;
specialized mutations remain under the existing document APIs.

LiveMap provides:

- object and array state;
- canonical document maps;
- projected path handles and passive logical document locations;
- atomic `set`, `replace`, `delete`, and `splice` operations;
- synchronous batches;
- revisioned commits;
- subscriptions and path feeds;
- runtime schema validation;
- capture, restore, replay, and recovery primitives;
- one-way graph links;
- document operations addressed by path or QUID.

Changed mutations advance the map by exactly one revision and publish one normalized commit. No-op mutations do not advance revision.

Reads return detached values rather than mutable references into the live graph. Writes are preflighted and applied atomically.

At a high level, LiveMap occupies the role usually assigned to JSON application state, while retaining access to the canonical HSON structure beneath that projection.

---

## LiveTree

LiveTree turns HSON into live browser documents.

The HSON graph is the mutable source of truth. The DOM is its projection.

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

LiveTree provides graph-backed interfaces for:

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

Eligible live nodes receive stable QUID identity. QUIDs support lookup, graph continuity, and locally scoped CSS without requiring Shadow DOM or generated class names.

CSS remains CSS, but its ownership and lifetime become explicit. Rules, keyframes, properties, listeners, and other node-owned resources are released when their owning branch is terminally removed.

Detached branches retain their identity and runtime state so they can be transferred and reattached without rebuilding an equivalent element.

---

## LiveMap and LiveTree

LiveTree bindings connect document presentation to LiveMap state.

```ts
const state = hson.liveMap.fromJson({
  count: 0,
});

const body = hson.liveTree.queryBody().graft();

const button = body
  .create
  .button();

const stopBinding = button.bind.text(
  state,
  ["count"],
  value => `count: ${String(value)}`,
);

button.listen.onClick(() => {
  state.at(["count"]).update(
    value => Number(value) + 1,
  );
});
```

A binding reads the current value immediately and subscribes to later changes.

The state graph and document graph retain distinct responsibilities, but their relationship is explicit. LiveMap remains authoritative, and the reflector updates the view from observed commits.

For broader graph reflection, `hson.reflect` provides an optional binding that borrows LiveMap authority and coordinates a LiveTree runtime.

---

## LiveHost

LiveHost manages canonical application state in an authoritative server-side runtime.

A LiveHost authority owns one LiveMap and its ordered commit history. Clients do not independently simulate the same application and exchange events afterward. They maintain revisioned mirrors of one canonical state and follow the same accepted commit stream.

LiveHost provides:

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
- browser and Node WebSocket adapters;
- a reusable Node HTTP/WebSocket host;
- application routing and isolation;
- origin, authentication, and authority-authorization hooks;
- transport limits, liveness, and backpressure handling.

The core authority remains transport-independent. It accepts a small socket-like interface and does not depend on Node, browsers, or Cloudflare APIs.

Platform adapters connect real sockets to that boundary.

### HTTP bootstrap and WebSocket continuation

LiveHost can capture an exact canonical authority state at revision `R` and deliver it as a versioned HSON bootstrap response.

The browser installs that state and enters the ordinary WebSocket recovery path from the same authority identity and revision:

```text
HTTP bootstrap at revision R
        ↓
browser installs exact state R
        ↓
WebSocket connects to the authority
        ↓
current | replay | replacement snapshot
        ↓
ordered live commits
```

State may change between the HTTP response and the WebSocket connection. This does not create a separate synchronization problem: the existing recovery system replays the missing commits or installs a newer snapshot when history is no longer available.

The bootstrap path establishes server-to-browser state continuity. It does not yet constitute LiveTree HTML adoption or a complete SSR product.

---

## What hson-live is exploring

The library is built around several concrete propositions:

### Data and markup can share one explicit structural model

JSON and HTML need not become the same language. They can nevertheless be represented by one graph without treating either as an opaque payload belonging to the other.

### Serialization can remain central after state becomes live

A live graph does not have to become an unserializable runtime object. HSON remains inspectable and transferable across parsing, state mutation, browser projection, hosting, snapshots, and recovery.

### State and view can share a source without being the same object

LiveMap and LiveTree retain different responsibilities. When connected deliberately, the reflector observes canonical LiveMap commits and synchronizes the LiveTree view without granting it equal authority.

### A hosted application can be a revisioned graph rather than a collection of client-side simulations

LiveHost accepts actions, mutates one authority, and publishes one ordered history. Clients recover from canonical identity and revision rather than relying on timing or best-effort event replay.

### Infrastructure should be inspectable

The public LiveDemo environment exposes demos, diagnostics, test inventories, and real transport checks. Claims made by the library are intended to be exercised rather than presented only as examples.

---

## Status

hson-live 3.x is experimental and pre-stable.

The transformation system, LiveMap, LiveTree, and LiveHost all have substantial automated coverage, but public and experimental APIs may still change as the architecture is tested under broader use.

Current limitations include:

- in-memory Node authorities use a single-process ownership model;
- distributed authority coordination is not implemented;
- projected-data persistence is not currently provided;
- document persistence remains experimental;
- LiveHost is not a CRDT and does not provide offline merge;
- HTTP HSON bootstrap is implemented, but LiveTree HTML adoption is not;
- framework-specific SSR integrations are not provided;
- the library has not been presented as a security-certified runtime.

Use `fromUntrustedHtml` for untrusted HTML input. `fromTrustedHtml` deliberately bypasses sanitization and must only receive trusted source.

The official Node host includes explicit production policy surfaces for origins, authentication, authorization, proxy trust, connection limits, heartbeat, and backpressure. Applications remain responsible for their actual identity and access policies.

Evaluate the current limitations and API stability before using hson-live for security-critical or public production systems.

---

## Installation

```bash
npm install hson-live
```

The official Node hosting entrypoint currently targets:

```text
Node >=22.12.0 <25
```

Browser and Worker-facing parts of the package do not import the Node host.

---

## Imports and environment boundaries

The root package is the umbrella entrypoint:

```ts
import { hson } from "hson-live";
import type { LiveMap } from "hson-live/livemap";
import type { LiveTree } from "hson-live/livetree";
import type { LiveHost } from "hson-live/livehost";
```

LiveHost’s environment-neutral network surface is available from:

```ts
import {
  create_livehost,
  create_livehost_client,
} from "hson-live/livehost";
```

The official Node-only host and socket integration are available from:

```ts
import {
  start_node_application_host,
  create_node_livehost_socket,
} from "hson-live/livehost/node";
```

Do not import `hson-live/livehost/node` into browser or Worker bundles.

Public diagnostic launchers are available from:

```ts
import {
  // public diagnostic exports
} from "hson-live/diagnostics";
```

The package’s built exports are the supported integration boundary. Consumers should not import from `hson-live/src`.

---

## Development

hson-live is written in strict TypeScript.

```bash
npm install
npm run check
npm run build
npm run check:entrypoints
```

The exact repository scripts are the source of truth for compilation, entrypoint checks, diagnostics, and package validation.

---

## Documentation

The `docs/` directory contains architecture and API references for:

- HSON syntax and transformation;
- LiveMap;
- LiveTree;
- LiveHost;
- CSS and animation management;
- diagnostics and package entrypoints.

Repository:

[github.com/neutralica/hson-live](https://github.com/neutralica/hson-live)

---

## LiveDemo

[terminalgothic.com/hson](https://terminalgothic.com/hson)

LiveDemo is the public test and development environment for hson-live and the first application built entirely with it.

It contains:

- interactive subsystem demos;
- transformation tools;
- architecture experiments;
- browser and Node integration checks;
- regression suites;
- externally executed package diagnostics;
- working examples of LiveMap, LiveTree, and LiveHost.

The test inventory is generated from the current repositories rather than fixed in this README.

LiveDemo’s visual design is intentionally brutalist.

---

## License

hson-live is licensed under the Public Parity License 7.0.

See `LICENSE` for details.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0.
