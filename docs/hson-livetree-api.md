#### hson-live / hson.terminalgothic.com

# hson.liveTree API
Updated: 2026-06-29

LiveTree is a mutable handle to one `HsonNode` inside a host graph. It provides
structured traversal, mutation, DOM projection, styling, attributes, data,
events, text/form helpers, SVG helpers, and canvas helpers. A LiveTree can be
used detached from the DOM; DOM-facing helpers return `undefined`, `false`, or
no-op safely when there is no mounted element, except for explicit `must`
helpers.

Current internal node fields are `$_tag`, `$_content`, `$_attrs`, and
`$_meta`. VSN tag values such as `_hson_elem`, `_hson_arr`, and `_hson_str` remain tag
strings in `node.$_tag`.

---

## Construction

Primary public construction happens through `hson.liveTree`.

### Detached Branches

```ts
const fromHtml = hson.liveTree.fromTrustedHtml("<section></section>");
const fromSafeHtml = hson.liveTree.fromUntrustedHtml(userHtml);
const fromJson = hson.liveTree.fromJson({ title: "Hello" });
const fromHson = hson.liveTree.fromHson("<card>Text</card>");
const fromNode = hson.liveTree.fromNode(node);
```

The `from*` methods return detached `LiveTree` branches. They do not graft or
mutate the live DOM. Wrapper nodes such as `_hson_root` and `_hson_elem` are unwrapped
so the returned branch points at one concrete root node.

### Grafting Existing DOM

```ts
const app = hson.liveTree.queryDom("#app").graft();
const body = hson.liveTree.queryBody().graft();
```

`queryDom(selector).graft()` and `queryBody().graft()` parse an existing DOM
subtree, replace it with a managed LiveTree projection, and return the
controlling LiveTree.

Use `queryDom`, not `queryDOM`, on this public facade.

### Detached Tag Creation

```ts
const div = hson.liveTree.create.div();
const icon = hson.liveTree.create.svg(`<svg viewBox="0 0 10 10"></svg>`);
const input = hson.liveTree.create.input();
```

`hson.liveTree.create` creates detached HTML or SVG branches directly. It
supports HTML tag helpers, SVG tag helpers, `tag(name, source?)`,
`tags(names)`, `prepend()`, and `at(index)`.

---

## Identity

- `node: HsonNode` - resolves and returns the backing node; throws if the node
  reference is broken.
- `quid: string` - stable identity token for the node.
- `hostRootNode(): HsonNode` - returns the host root for this tree context.
- `adoptRoots(root: HsonNode): this` - rebinds the host-root context.

---

## DOM Access

`dom: LiveTreeDom` is a lazy DOM helper bound to the tree's mounted element.

Soft reads:

- `dom.el(): Element | undefined`
- `dom.htmlEl(): HTMLElement | undefined`
- `dom.innerHtml: string | undefined`
- `dom.outerHtml: string | undefined`
- `dom.isConnected(): boolean`
- `dom.matches(sel: string): boolean`
- `dom.contains(other: LiveTree): boolean`
- `dom.contains.node(node: Node): boolean`
- `dom.contains.target(target: EventTarget | null): boolean`
- `dom.contains.tree(other: LiveTree): boolean`
- `dom.rect(): DOMRect | undefined`
- `dom.closest(sel: string): LiveTree | undefined`
- `dom.parent(): LiveTree | undefined`
- `dom.computed(): CSSStyleDeclaration | undefined`
- `dom.computedProp(name: string): string | undefined`
- `dom.clientRects(): DOMRectList | undefined`
- `dom.scrollSize(): { width: number; height: number } | undefined`
- `dom.clientSize(): { width: number; height: number } | undefined`
- `dom.treeFromEl(el: Element, label?: string): LiveTree | undefined`
- `dom.doc?.elementAtPoint(x, y): Element | undefined`
- `dom.doc?.elementsFromPoint(x, y): Element[]`
- `dom.doc?.treeAtPoint(x, y): LiveTree | undefined`
- `dom.doc?.treesFromPoint(x, y): TreeSelector`

Strict reads live under `dom.must`:

- `dom.must.el(label?)`
- `dom.must.htmlEl(label?)`
- `dom.must.innerHtml`
- `dom.must.outerHtml`
- `dom.must.rect(label?)`
- `dom.must.closest(sel, label?)`
- `dom.must.parent(label?)`
- `dom.must.treeFromEl(el, label?)`
- `dom.must.computed(label?)`
- `dom.must.computedProp(name, label?)`
- `dom.must.clientRects(label?)`
- `dom.must.scrollSize(label?)`
- `dom.must.clientSize(label?)`
- `dom.must.doc`

---

## Tree Mutation

- `append(branch, index?): this` - appends a detached or existing branch under
  this node. DOM is mirrored when mounted.
- `empty(): this` - removes all content from this node.
- `removeChildren(): number` - removes direct node children and returns the
  number removed.
- `removeSelf(): number` - removes this node from its parent graph and DOM;
  returns `1` when removed or `0` when already detached.
- `cloneBranch(): this` - deep-clones the subtree with fresh QUID identity and
  returns a detached branch.

---

## Querying

`find` returns the first matching descendant or `undefined`.

```ts
tree.find("button")
tree.find({ tag: "button", attrs: { type: "submit" } })
tree.find.byId("save")
tree.find.byQuid(quid)
tree.find.byAttribute("role", "tab")
tree.find.byFlag("disabled")
tree.find.byClass("active")
tree.find.byData("state", "open")
tree.find.byTag("button")
```

`find.must(...)` and the matching `find.must.by*` helpers throw when no match
exists. `find.asSvg(...)` and `find.must.asSvg(...)` return SVG-scoped matches.

`findAll` returns a `TreeSelector`.

```ts
tree.findAll("button")
tree.findAll([{ tag: "button" }, { attrs: { role: "tab" } }])
tree.findAll.id("save")
tree.findAll.id(["save", "cancel"])
tree.findAll.byId("save")
tree.findAll.byIds("save", "cancel")
tree.findAll.byAttribute("role", "tab")
tree.findAll.byAttr("role", "tab")
tree.findAll.byAttrs("role", "tab")
tree.findAll.byFlag("disabled")
tree.findAll.byFlags("disabled")
tree.findAll.byClass("active")
tree.findAll.byData("state", "open")
tree.findAll.byTag("button")
```

`findAll.must(...)` and the matching `findAll.must.*` helpers throw when the
selection is empty.

---

## TreeSelector

`TreeSelector` is returned by `findAll(...)` and multi-create calls.

- `array(): LiveTree[]`
- `length: number`
- `first(): LiveTree | undefined`
- `last(): LiveTree | undefined`
- `at(ix: number): LiveTree | undefined`
- `each(fn): void`
- `map(fn): T[]`
- `filter(fn): TreeSelector`
- `removeAt(ix): boolean`
- `removeAll(): number`

Broadcast proxies apply manager calls to every selected tree:

- `selector.listen`
- `selector.style`
- `selector.css`
- `selector.data`

Empty selections return no-op broadcast proxies.

---

## Creation Helpers

Every tree exposes a namespace-aware creation helper:

```ts
tree.create.div()
tree.create.div("<div class='card'></div>")
tree.create.tag("article")
tree.create.tags(["header", "main", "footer"])
tree.create.prepend().span()
tree.create.at(2).button()
tree.create.svg(`<svg viewBox="0 0 10 10"></svg>`)
tree.create.canvas()
```

In HTML scope, `create` exposes HTML tag helpers plus `svg(...)` and
`canvas(...)`. In SVG scope, it exposes SVG tag helpers appropriate to that
namespace. Source strings are trusted markup.

---

## Content and Text

### `content: ContentManager`

The content manager exposes an effective element-child view. It skips primitive
leaves, hides VSN leaves such as `_hson_str` and `_hson_val`, and unwraps structural VSN
containers such as `_hson_root`, `_hson_elem`, `_hson_obj`, `_hson_arr`, and `_hson_ii`.

- `content.count(): number`
- `content.at(ix): LiveTree | undefined`
- `content.first(): LiveTree | undefined`
- `content.all(): readonly LiveTree[]`
- `content.deep(): readonly LiveTree[]`
- `content.mustOnly(opts?: { warn?: boolean }): LiveTree`
- `content.markup.innerHTML: string`
- `content.markup.outerHTML: string`

`content.markup` is serialized from the HSON graph and works for detached
branches.

### `text: LiveTextApi`

- `text.set(value): this` - replaces existing text/value leaves while keeping
  element children.
- `text.add(value): this` - appends a text leaf.
- `text.insert(index, value): this` - inserts a text leaf at a VSN bucket index.
- `text.overwrite(value): this` - replaces all content with one text leaf.
- `text.get(): string` - returns concatenated text/value leaf content.

### `form: LiveFormApi`

- `form.setValue(value, opts?): this`
- `form.getValue(): string`
- `form.setChecked(value, opts?): this`
- `form.getChecked(): boolean`
- `form.setSelected(value, opts?): this`
- `form.getSelected(): string | readonly string[]`

Form writers store canonical attrs and mirror to DOM when mounted. Missing DOM
is normally tolerated; pass `{ strict: true }` or `{ silent: false }` to throw.

---

## Attributes, Flags, Data, ID, Class

### `attr: AttrHandle`

- `attr.get(name): Primitive | undefined`
- `attr.has(name): boolean`
- `attr.set(name, value): this`
- `attr.setMany(map): this`
- `attr.drop(name): this`

`null` or `undefined` removes an attribute. Boolean-present attributes can also
be managed through `flag`.

### `flag: FlagHandle`

- `flag.has(name): boolean`
- `flag.set(...names): this`
- `flag.clear(...names): this`

### `data: DataApi`

- `data.set(key, value): this`
- `data.setMany(map): this`
- `data.get(key): Primitive | undefined`
- `data.drop(key): this`

Dataset keys are normalized to `data-*` attributes. Values are stored as strings
when present; `null` and `undefined` remove the attribute.

### `id: IdApi`

- `id.get(): string | undefined`
- `id.set(id): this`
- `id.clear(): this`

### `classlist: ClassApi`

- `classlist.get(): string | undefined`
- `classlist.has(name): boolean`
- `classlist.set(cls: string | string[]): this`
- `classlist.add(...names): this`
- `classlist.remove(...names): this`
- `classlist.toggle(name, force?): this`
- `classlist.clear(): this`

---

## Styling

### `style: StyleHandle`

Inline style helper. It uses the shared `StyleSetter` surface and writes to the
node's `$_attrs.style` representation, mirroring to DOM when mounted.

Common calls:

```ts
tree.style.set.backgroundColor("red");
tree.style.setProp("margin-top", "1rem");
tree.style.setMany({ opacity: 0.8, "--phase": 1 });
tree.style.remove("opacity");
tree.style.clear();
tree.style.get.property("background-color");
tree.style.getMany();
tree.style.var.set("phase", 1);
```

### `css: CssTreeHandle`

QUID-scoped stylesheet helper. It uses the same setter/getter shape as
`style`, but writes CSS rules scoped to `[data-_quid="..."]`.

Additional `css` namespaces:

- `css.selector(pattern)` - scoped selector rule handle.
- `css.media(query)` - QUID-scoped rules inside `@media`.
- `css.supports(cond)` - QUID-scoped rules inside `@supports`.
- `css.layer(name)` - QUID-scoped rules inside `@layer`.
- `css.atProperty` - shared `@property` registration manager.
- `css.keyframes` - shared keyframes manager.
- `css.anim` - animation control handle for this QUID.
- `css.devSnapshot()` - rendered CSS snapshot for debugging.

See `css-manager-api.md` for details.

---

## Events

### `listen: ListenerBuilder`

Fluent DOM event-listener builder. It attaches immediately when an `on*` method
is called.

Targets:

- `listen.element`
- `listen.document`
- `listen.window`
- `listen.toDocument()`
- `listen.toWindow()`

Options/modifiers:

- `once()`
- `passive()`
- `capture()`
- `strict(policy?)`
- `preventDefault()`
- `stopProp()`
- `stopImmediateProp()`
- `stopAll()`
- `clearStops()`

Event helpers include input, mouse, pointer, touch, wheel/scroll, keyboard,
focus, drag/drop, animation, transition, clipboard, and custom events:

- `listen.on(type, handler)`
- `listen.onCustom(type, handler)`
- `listen.onCustomDetail(type, handler)`

Calls return `ListenerSub`:

- `off(): void`
- `count: number`
- `ok: boolean`

### `events: TreeEvents`

Tree-local non-DOM event bus:

- `events.on(type, handler): () => void`
- `events.once(type, handler): () => void`
- `events.emit(type, payload?): void`

---

## SVG

`svg: SvgApi` is available on every LiveTree and is meaningful when
`svg.inScope()` is true.

- `svg.inScope(): boolean`
- `svg.viewBox.get() / set(...) / clear()`
- `svg.preserveAspectRatio.get() / set(...) / none() / clear()`
- `svg.d.get() / set(...) / clear()`
- `svg.fill.get() / set(...) / none() / clear()`
- `svg.stroke.get() / set(...) / clear()`
- `svg.strokeWidth.get() / set(...) / clear()`
- `svg.vectorEffect.get() / set(...) / nonScalingStroke() / clear()`
- `svg.bbox(): SvgBox | undefined`
- `svg.must.bbox(label?): SvgBox`

---

## Canvas

`canvas: CanvasApi` is available on every LiveTree and is meaningful for
`<canvas>` nodes.

- `canvas.inScope(): boolean`
- `canvas.el(): HTMLCanvasElement | undefined`
- `canvas.ctx2d(settings?): CanvasRenderingContext2D | undefined`
- `canvas.pointer(ev): CanvasPoint | undefined`
- `canvas.width.get() / set(value) / clear()`
- `canvas.height.get() / set(value) / clear()`
- `canvas.size.get() / set(width, height) / clear()`
- `canvas.display.size(opts?)`
- `canvas.display.match(opts?)`
- `canvas.display.match.watch(opts?)`
- `canvas.clear()` or `canvas.clear(x, y, w, h)`
- `canvas.plot(fn, settings?)`
- `canvas.must.el(label?)`
- `canvas.must.ctx2d(settings?, label?)`
- `canvas.must.pointer(ev, label?)`
- `canvas.must.plot(fn, settings?, label?)`

---

## Notes

- LiveTree methods and getters live on the prototype.
- Getter namespaces such as `id`, `classlist`, `style`, `css`, `content`,
  `form`, `svg`, and `canvas` are intentional public API.
- DOM helpers are soft by default; use explicit `must` helpers when failure
  should be exceptional.
- Attribute names are normalized through the attribute helpers.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
