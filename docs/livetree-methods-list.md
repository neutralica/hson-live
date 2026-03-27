#### hson-live 2.0.26 / terminalgothic.com

# hson.livetree 
# LiveTree & API
[ last updated:  2026-03-07 ] 

## Overview

LiveTree is a mutable handle to a HsonNode and its surrounding graph. LiveTree provides type-safe traversal, DOM synchronization, styling, data, events, and node creation/mutation both on-and-off DOM (Node/test/runtime-agnostic). A LiveTree always represents one node and operates relative to a host root.

---

## Construction

`new LiveTree(input: HsonNode | LiveTree)`

- If constructed from a HsonNode, that node becomes both the reference node and host root.
- If constructed from another LiveTree, the new instance points at the same node and adopts the same host root.

---

## Identity and Core Accessors

- `node: HsonNode`
Returns the resolved node. Throws if the reference cannot be resolved.
- `quid: string`
Stable identity token for the node.
- `hostRootNode(): HsonNode`
Returns the current host root.
- `adoptRoots(root: HsonNode): this`
Rebinds host root (advanced/internal usage).

---

## DOM Access

- `dom: LiveTreeDom`
Lazily created DOM helper API for this node.
### Methods:
- `el(): Element | undefined`
- `html(): HTMLElement | undefined` (runtime also provides `html.must(): HTMLElement`)
- `matches(sel: string): boolean`
- `contains(other: LiveTree): boolean`
- `closest(sel: string): LiveTree | undefined` with `closest.must(sel, label?)`
- `parent(): LiveTree | undefined` with `parent.must(label?)`
- `asDomElement(): Element | undefined` Returns the underlying DOM element if it exists (undefined when not mounted).

---

## Tree Mutation

- `append(branch: LiveTree, index?: number): LiveTree`
Appends children from another branch under this node. Mirrors to DOM when present.
- `empty(): LiveTree`
Removes all content from this node.
- `removeChildren(): number`
Removes direct node children (ignores primitives). Returns count removed.
- `removeSelf(): number`
Removes this node from its parent (HSON + DOM). Returns `1` or `0`.
- `cloneBranch(): LiveTree`
Deep-clones subtree with new QUIDs; returns a detached branch.

---

## Querying

- `find(q: string | HsonQuery): LiveTree | undefined`
- `find.byId(id: string): LiveTree | undefined`
- `find.byAttrs(attr: string, value: string): LiveTree | undefined`
- `find.byFlags(flag: string): LiveTree | undefined`
- `find.byTag(tag: string): LiveTree | undefined`
- `find.must(...)` and `.must.*` variants
- `findAll(q: FindQueryMany): TreeSelector`
- `findAll.id(...) / byAttribute(...) / byFlag(...) / byTag(...)`
- `findAll.must(...)` and `.must.*` variants

`TreeSelector` supports iteration and broadcast APIs (see below).

---

## Creation Helpers

- `create: LiveTreeCreateHelper`
Bound creation helper for appending new nodes under this tree.

#### Examples:
- `create.prepend()`
- `create.at(index)`
- `create.tags(tags: string[], index?)`
- `create.<tag>(index?)`
Supported tags are defined by the LiveTree create helper (see `livetree-methods-list.md`).

---

## Content and Text

### ContentManager

- `content.count(): number`
- `content.at(ix: number): LiveTree | undefined`
- `content.first(): LiveTree | undefined`
- `content.all(): readonly LiveTree[]`
- `content.mustOnly(opts?: { warn?: boolean }): LiveTree`

Content operations only consider node children (primitives are skipped). `_elem` wrappers are unwrapped.

### Text API

- `text.set(value: Primitive): LiveTree`
Replaces only `_str/_val` leaves (keeps element children).
- `text.add(value: Primitive): LiveTree`
Appends a new text leaf.
- `text.insert(index: number, value: Primitive): LiveTree`
Inserts a text leaf at VSN bucket index.
- `text.overwrite(value: Primitive): LiveTree`
Replaces all content with one text leaf (DOM `textContent`).
- `text.get(): string`
Concatenated text of `_str/_val` leaves.

### Form Helpers

- `setFormValue(value: string, opts?: { silent?: boolean; strict?: boolean }): LiveTree`
- `getFormValue(): string`

---

## Attributes and Flags (Updated)

LiveTree no longer exposes `getAttr` / `setAttrs` directly. Use `attr` and `flag` handles.

### `attr: AttrHandle`

- `attr.get(name: string): Primitive | undefined`
- `attr.has(name: string): boolean`
Present semantics based on stored value; not a strict key-exists check.
- `attr.set(name: string, value: Primitive | null | false): LiveTree` `null`, `undefined`, or `false` remove the attribute. `true` sets a boolean-present attribute (`key="key"`). Numbers are stringified. For `style`, string values are parsed into a structured map and mirrored to DOM.
- `attr.setMany(map: Record<string, Primitive | null | false>): LiveTree`
Applies each entry with the same semantics as `attr.set`.
- `attr.drop(name: string): LiveTree`
Removes an attribute.

### `flag: FlagHandle`

- `flag.has(name: string): boolean`
- `flag.set(...names: string[]): LiveTree`
Sets boolean-present attributes (same semantics as `attr.set(name, true)`).
- `flag.clear(...names: string[]): LiveTree`
Clears boolean-present attributes (same semantics as remove).

---

## DataManager (dataset)

`data: DataManager` manages `data-*` attributes.

- `data.set(key: string, value: Primitive | undefined): LiveTree`
`key` is normalized with camel-to-kebab and prefixed with `data-`.
`null` or `undefined` removes the attribute.
- `data.setMany(map: Record<string, Primitive | undefined>): LiveTree`
Batch set/remove using the same rules as `data.set`.
- `data.get(key: string): Primitive | undefined`
Reads `data-${key}` as-is. (No camel-to-kebab normalization on read.)

Notes:
- Values are stored as strings, matching HTML attribute behavior.

---

## ID and Class APIs (Updated)

### `id: IdApi`

- `id.get(): string | undefined`
- `id.set(id: string): LiveTree`
- `id.clear(): LiveTree`

### `classlist: ClassApi`

- `classlist.get(): string | undefined`
Raw `class` attribute (undefined if empty).
- `classlist.has(name: string): boolean`
- `classlist.set(cls: string | string[]): LiveTree`
- `classlist.add(...names: string[]): LiveTree`
- `classlist.remove(...names: string[]): LiveTree`
- `classlist.toggle(name: string, force?: boolean): LiveTree`
- `classlist.clear(): LiveTree`

---

## Styling (Abridged)

### Inline Style

- `style: StyleHandle`
Implements `StyleSetter` API for inline styles.
Common methods: `setProp`, `setMany`, `remove`, `clear`, and proxy `set.*`.
Also exposes `style.get.property(prop)` and `style.get.var(name)`.

### QUID-Scoped CSS

- `css: CssHandle`
Implements the same `StyleSetter` API for QUID-scoped stylesheet rules.
Supports keyframes, animations, and `@property` registration.

See `css-manager-api.md` for full details.

---

## Events

- `listen: ListenerBuilder`
Fluent, typed DOM event registration (mouse, pointer, keyboard, focus, animation, transition, clipboard, custom, etc.).
Supports options (`once`, `passive`, `capture`) and modifiers (`preventDefault`, `stopProp`, etc.).

- `events: TreeEvents`
 Internal, non-DOM event bus:
- `events.on(type, handler): () => void`
- `events.once(type, handler): () => void`
- `events.emit(type, payload?): void`

---

## TreeSelector (from `findAll`)

Returned by `findAll(...)`.

- `toArray(): LiveTree[]`
- `count(): number`
- `first(): LiveTree | undefined`
- `forEach(fn)`
- `map(fn)`
- `filter(fn): TreeSelector`
- `removeSelf(): number` (alias `remove()`)

Broadcast proxies (apply to all selected nodes):

- `listen`, `style`, `css`, `data`

---

## Notes

- LiveTree is DOM-optional. All DOM-facing APIs no-op safely when not mounted.
- Attributes are normalized to lowercase internally.
- For precise tag creation and full CSS/animation APIs, consult `livetree-methods-list.md` and `css-manager-api.md`.

© 2026 terminal_gothic LLC. All rights reserved except as granted under the Public Parity License 7.0