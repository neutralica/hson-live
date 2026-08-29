#### hson-live / hson.terminalgothic.com

<!-- 
LiveTree is the browser projection and interaction layer of hson-live. It provides a mutable, identity-bearing handle over an Hson node graph, allowing the same graph node to participate in traversal, mutation, DOM projection, styling, event handling, SVG/canvas access, and LiveMap binding.

A LiveTree is not a second tree model. It is a live handle to an Hson node within a host graph. Mutations update the backing graph first, and when the node is mounted, DOM-aware managers mirror those changes into the rendered document. Detached branches remain useful without DOM attachment: they can still be traversed, mutated, serialized, styled, cloned, and later grafted or projected.

LiveTree preserves node identity through QUIDs. A QUID associates an Hson node with its managed DOM element and graph-scoped CSS state, allowing targeted projection, styling, lookup, cleanup, and controlled cloning. This identity model supports graph-backed rendering without requiring the DOM itself to be the source of truth.

LiveTree exposes practical authoring surfaces for content, text, attributes, flags, data attributes, IDs, class lists, inline style, managed CSS, forms, DOM reads, event listeners, SVG, and canvas. These APIs allow developers to work with document behavior through graph-aware operations rather than scattered DOM queries, string-based style manipulation, and unrelated event/state systems.

LiveTree also binds presentation to LiveMap state. A tree can subscribe to LiveMap paths and project values into text, attributes, inline styles, or custom callbacks. This allows LiveMap’s validated, revisioned graph state to drive live DOM presentation while keeping state management, transport, and rendering concerns separated.

In the broader architecture, LiveTree is the view/projection layer: Hson defines the graph representation, LiveMap defines validated mutation and revisioned state, Locus defines one-map authority and synchronization, applications own meaning and topology, LiveHost hosts applications, and LiveTree turns graph state into interactive browser presentation.
 -->

# LiveTree
Updated: 2026-07-13

LiveTree is the mutable, identity-bearing view of an Hson node graph. It joins three concerns that otherwise remain separate in hson-live:

- the canonical `HsonNode` graph;
- an optional DOM projection of that graph; and
- node-scoped services such as traversal, mutation, binding, styling, events,
  SVG, and canvas access.

This document explains the model and its boundaries. The complete callable surface is in `api-livetree.md`; transform construction is in `api-transform.md`; stylesheet behavior is in `api-css-manager.md`.

---

## The handle and the graph

A `LiveTree` is a handle to one node in a host graph, not a second tree model. Its `node` getter resolves the backing `HsonNode`, while `quid` provides the node's stable live identity. Child handles share the same host-root context.

The current node shape is:

```ts
type HsonNode = {
  $_tag: string;
  $_content: (HsonNode | Primitive)[];
  $_attrs: HsonAttrs;
  $_meta: HsonMeta;
};
```

The `$_*` names are node fields. Virtual structural node (VSN) tags remain ordinary tag strings such as `_hson_root`, `_hson_elem`, `_hson_obj`, `_hson_arr`, `_hson_ii`, `_hson_str`, and `_hson_val` in `node.$_tag`.

LiveTree mutations update this graph first. When a corresponding DOM element is mounted, DOM-aware managers mirror the change. Detached branches therefore retain traversal, serialization, content, attribute, and styling state even when DOM-only reads are unavailable.

---

## Construction modes

### Detached branches

```ts
const html = hson.liveTree.fromTrustedHtml("<section></section>");
const safe = hson.liveTree.fromUntrustedHtml(userHtml);
const json = hson.liveTree.fromJson({ title: "Hello" });
const hsonBranch = hson.liveTree.fromHson('<card "Text"/>');
const existing = hson.liveTree.fromNode(node);
```

These constructors do not mutate the document. The constructor unwraps an `_hson_root` only when its sole child is an `_hson_elem`; JSON/object/array sources can intentionally remain rooted at `_hson_root`.

`fromNode` uses the supplied graph rather than cloning it. Use
`cloneBranch()` when a deep detached copy with fresh QUIDs is required.

### Grafted DOM

```ts
const app = hson.liveTree.queryDom("#app").graft();
const body = hson.liveTree.queryBody().graft();
```

Grafting parses the selected DOM subtree, replaces it with a managed projection, and returns the controlling LiveTree. The public LiveTree facade spells the method `queryDom`, not `queryDOM`. The selected Element itself is the managed source root.

When an HTML source constructor receives an `Element`, it snapshots that element as the source root, including its attributes, metadata, and descendants. It does not reinterpret the input as child-only `innerHTML`. Untrusted input passes through its sanitizer, but syntactic Hson metadata candidates remain subject to the canonical metadata registry afterward. Valid supplied root and descendant QUIDs are preserved as cold graph identity; malformed or unknown metadata rejects.

### Detached creation

`hson.liveTree.create` creates detached HTML or SVG branches. Every LiveTree also has a namespace-aware `create` helper that inserts under that tree. HTML scope exposes HTML tag helpers plus `svg()` and `canvas()`; SVG scope uses SVG namespace semantics.

---

## Identity and projection

QUIDs connect an Hson node to its managed DOM and CSS state. They are internal live identity, serialized in managed HTML as `hson:quid` when needed for DOM lookup and stylesheet scoping.

Identity is stable through movement, detach, and reattachment, but it is not a security credential or a byte-for-byte source preservation guarantee:

- supplied valid QUIDs are preserved in cold canonical graphs; duplicate valid values may coexist cold under the established Transform contract;
- when a graph becomes live, active uniqueness and ownership are enforced atomically without partial registry claims;
- detach retains identity and reattachment keeps the same QUID;
- `cloneBranch()` issues fresh QUIDs;
- terminal destruction releases active QUID ownership but retains the bytes in
  the runtime's issued ledger;
- ordinary admission cannot reuse retired bytes in that runtime; the same bytes
  may be admitted in a fresh runtime lifetime;
- `.noQuid()` filters output only and does not mutate the source graph, release ownership, or change lifecycle state;
- parse/serialize cycles may normalize source spelling and structure; and
- ordinary transform APIs are graph conversions, not LiveTree identity persistence APIs.

QUID is graph identity, not trust, authorization, authentication, or execution capability. Sanitization and active identity ownership are separate boundaries.
A raw QUID resolves only while its claim is active. After terminal removal it
remains absent and cannot retarget to unrelated content in the same runtime.

`hostRootNode()` exposes the graph root used by a handle. `adoptRoots(root)` rebinds that context and is mainly relevant when attaching or moving branches.

---

## Traversal views

LiveTree exposes two related traversal models.

`find` and `findAll` search raw Hson nodes, including the current node itself. Their string query syntax is a deliberately small selector subset, not the browser's full CSS selector engine. Structural queries can match `tag`, `attrs`, `meta`, and text. Array queries are evaluated independently and their results are concatenated, so overlapping queries can produce duplicate handles. `byClass` compares the complete stored `class` attribute; it is not a class-token membership test.

`content` presents an effective element-child view. It skips primitive and VSN leaf nodes and unwraps structural VSN containers. This is generally the useful view for UI composition, while `node.$_content` is the exact graph view.

`findAll` and `content.all()` return a `TreeSelector`. A selector supports collection operations and broadcasts the top-level `listen`, `style`, `css`, and `data` calls. Broadcast is shallow: nested manager surfaces are not recursively proxied. For example, use `selector.css.setMany(...)`; do not assume every arbitrarily deep `selector.css.*` chain broadcasts.

---

## Mutation and synchronization

`append`, `empty`, `detachContents`, `detach`, `remove`, and `cloneBranch` are the canonical structural operations. `empty` and `remove` are terminal for the content/subtree they target. `detachContents` and `detach` preserve identity and retain the same mapped DOM projection off-document for later reattachment. Appending an already attached branch is rejected; explicit detach/attach is the reparenting protocol.

Terminal disposal recursively releases QUID registry ownership and persisted `hson:quid`, removes listeners and QUID-scoped CSS, drains registered disposables, drops node-element mappings, and marks every node disposed. Only `isDisposed` and repeated `remove()` are safe lifecycle surfaces afterward; meaningful reads and mutations throw the stable `LiveTreeDisposedError`.

Browser-owned `documentElement`, `head`, and `body` roots are protected from detach and removal. Ordinary application roots are not. `removeSelf` is a deprecated alias for terminal `remove`; `removeChildren` is a deprecated specialized semantic-element filter. Use the canonical lifecycle and content APIs in new code.

Manager namespaces specialize common mutations:

- `content` exposes effective children and serialized markup;
- `text` edits text/value leaves;
- `form` synchronizes canonical value/checked/selected state;
- `attrs`, `flags`, `data`, `id`, and `classlist` edit attributes;
- `style` edits serializable inline style; and
- `css` edits QUID-scoped managed stylesheet state.

LiveTree `attrs` retains the complete canonical attr bag: `false`, `null`, zero, the empty string, and flag-form same-name strings are stored and remain present. `undefined` is rejected by `attrs.set`; explicit removal uses `attrs.drop`, `attrs.dropMany`, or `attrs.clear`. The `flags` helper is a semantic view over that same bag: a member is a flag exactly when its value equals its canonical name. Consequently, `attrs.set("selected", "selected")` makes `flags.has("selected")` true.

---

## LiveMap bindings

`tree.bind` connects LiveTree presentation state to LiveMap values. Bindings subscribe to a LiveMap path, apply the current value immediately, and continue to apply later feed events until disposed.

The binding groups are:

- `bind.path` / `bind.paths` for custom callbacks;
- `bind.text` / `bind.textPaths` for text projection;
- `bind.attr` / `bind.attrs` / `bind.attrsPaths` for attributes; and
- `bind.css` / `bind.cssPaths` for inline style projection.

Every binding call returns a disposer function. Multi-path bindings subscribe to each listed path and the returned disposer removes all of those subscriptions. See `api-livetree.md` for signatures and path/value rules.

---

## DOM, events, SVG, and canvas

`tree.dom` resolves the mounted element lazily. Ordinary methods such as `el()`, `rect()`, `closest()`, and computed-style reads return `undefined` or a safe false value when unavailable. The parallel `dom.must` surface throws when the requested DOM state is required.

`listen` attaches DOM event listeners to the element, document, or window and returns subscriptions with `off()`. `events` is a separate tree-local event bus and does not dispatch DOM events.

`svg` and `canvas` are present on every LiveTree, with `inScope()` indicating
whether the current node supports that specialized API. Their DOM-dependent reads follow the same soft/default and explicit-`must` split.

---

## Styling architecture

`tree.style` stores inline declarations on the Hson node and mirrors them to a mounted element. Those declarations travel with HTML serialization.

`tree.css` stores rules in the CSS manager under the node's QUID selector. It supports pseudo states, relative selectors, at-rule scopes, registered custom properties, keyframes, and animation control. This CSS is live managed state; it is not an inline attribute and is not part of ordinary Hson/HTML transform serialization.

See `api-css-manager.md` for ownership, global-rule, rendering, and reset details.

---

## Trust boundary

LiveTree preserves the transform API's source distinction:

- `fromUntrustedHtml` sanitizes external HTML and rejects external SVG;
- `fromTrustedHtml` accepts raw trusted HTML/SVG;
- JSON, Hson, and node sources are data paths and are not sanitized.

Sanitization is not a general validator for arbitrary Hson graphs. Use the untrusted HTML path for user- or third-party-authored markup.

---

## Prototype contract

LiveTree methods and getters, including `append`, `empty`, `find`, and `findAll`, live on the `LiveTree` prototype. Instances retain only their node/runtime state; constructing another tree does not create another set of method functions.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
