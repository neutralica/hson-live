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
 • `hson.liveHost` - the application/runtime boundary. LiveHost registers applications, dispatches exact request and connection routes, and provides the hosting contract. Node LiveHost is the implementation of the generic LiveHost, responsible for HTTP/WebSocket ingress, security/resource policy, transport adaptation, and process lifecycle. 
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

The transformation system handles cases that are commonly awkward at format boundaries, including:

- mixed text and element content;
- JSON arrays and object ordering;
- boolean and structured attributes;
- HTML void elements;
- SVG and XML namespaces;
- ordered document content;
- canonical metadata;
- persisted node identity.

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
## hson.liveMap / hsonLiveMap
Yes, your instinct is justified. This has crossed from **README overview** into **LiveMap reference documentation**.

There is nothing inherently wrong with a long README, especially for a library, but the question is proportionality. If LiveMap is one of five or six major subsystems, this section is spending far too much of the reader's attention budget on secondary mechanics.

The giveaway is that it explains things like:

- `watch` versus `feed`;
- restore notification semantics;
- `id()` subtree lookup;
- proxy coordinate equivalence;
- internal VSN hiding;
- exact meanings of `insert`, `move`, `replace`, and `delete`;
- attrs not extending `location.path()`;
- QUID targeting policy.

Those are all worthwhile facts. They're just not what somebody needs in order to answer:

> What is LiveMap, and how do I basically use it?

For the README, I think LiveMap needs to establish about five ideas:

1. **What it is:** mutable, revisioned canonical Hson application state.
2. **The two modes:** data and document.
3. **The basic addressing model:** `map.at(path)`.
4. **The basic mutation model:** reads are detached; mutations commit atomically and advance revision when changed.
5. **Why it matters in the wider system:** it is the canonical state layer used by Reflect/Locus/etc.

Then perhaps one short data example and one short document example.

Something around this density feels much more README-shaped:

```md
## hson.liveMap / hsonLiveMap

LiveMap provides mutable, revisioned application state over canonical Hson
graphs. It supports both data and document maps, using `map.at(...)` as the
common path interface.

Data paths traverse object members and array indexes:

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

Document paths traverse ordered authored content:

```ts
const document = hson.liveMap.fromHson(
  `<main <section <p "hello"/>/>/>`,
);

if (document.mode === "document") {
  const paragraph = document.at([0, 0]);

  console.log(paragraph.snap());

  paragraph.replace(replacement);
}
```

Paths are fixed logical coordinates and reads return detached values rather
than mutable references into the graph. Changed mutations are applied
atomically, advance the map by one revision, and publish one canonical commit.

LiveMap also provides batching, subscriptions, Schema governance and validation, capture and restore, replay/recovery primitives, document attrs/content operations, and sparse QUID continuity where identity evidence is required.

See the LiveMap documentation for detailed path, mutation, subscription,
document, proxy, capture, and recovery APIs.

