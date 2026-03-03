# LiveTree - complete API list

## Core

### Basic methods
- `.append(branch: LiveTree, index?: number): LiveTree` 
-- appends branch children into this node (unwraps `_elem`, mirrors DOM). // this does not render
--- testing dash count indentation
---- testing again
----- this may not render // (it does)
- `.empty(): LiveTree` 
-- removes all children (deep detach) but keeps this node.
- `.removeChildren(): number` 
-- removes only direct *node* children; returns count.
- `.removeSelf(): number` 
-- removes this node from DOM + HSON; returns `1` or `0`.

### Finder
- `.find(q: string | HsonQuery): LiveTree | undefined` 
-- returns first matching descendant.
- `.find.byId(id: string): LiveTree | undefined` - shortcut `{ attrs: { id } }`.
- `.find.byAttrs(attr: string, value: string): LiveTree | undefined` - shortcut by attribute match.
- `.find.byFlags(flag: string): LiveTree | undefined` - shortcut for boolean-present attribute.
- `.find.byTag(tag: string): LiveTree | undefined` - shortcut by tag match.
- `.find.must(q: string | HsonQuery, label?: string): LiveTree` - like `.find` but throws if missing.
- `.find.must.byId(id: string): LiveTree` - must-variant helper.
- `.find.must.byAttrs(attr: string, value: string): LiveTree` - must-variant helper.
- `.find.must.byFlags(flag: string): LiveTree` - must-variant helper.
- `.find.must.byTag(tag: string): LiveTree` - must-variant helper.
- `.findAll(q: FindQueryMany): TreeSelector` - all matches for one or many queries (union).
- `.findAll.id(ids: string | readonly string[]): TreeSelector` - union of id matches.
- `.findAll.byAttribute(attr: string, value: string): TreeSelector` - attribute match.
- `.findAll.byFlag(flag: string): TreeSelector` - flag match.
- `.findAll.byTag(tag: string): TreeSelector` - tag match.
- `.findAll.must(q: FindQueryMany, label?: string): TreeSelector` - throws if empty.
- `.findAll.must.id(ids: string | readonly string[]): TreeSelector` - must-variant helper.
- `.findAll.must.byAttribute(attr: string, value: string): TreeSelector` - must-variant helper.
- `.findAll.must.byFlag(flag: string): TreeSelector` - must-variant helper.
- `.findAll.must.byTag(tag: string): TreeSelector` - must-variant helper.

### Node creation
- `.cloneBranch(): LiveTree` - deep-clones subtree with new QUIDs; returns detached branch.
- `.create` - creation helper namespace bound to this tree.
- `.create.prepend(): LiveTreeCreateHelper` - sets next create call to insert at index `0`.
- `.create.at(index: number): LiveTreeCreateHelper` - sets next create call to insert at `index`.
- `.create.tags(tags: string[], index?: number): TreeSelector` - creates one child per tag, returns selector of all new children.
- `.create.<tag>(index?: number): LiveTree` - creates one child of `<tag>` and returns its `LiveTree`.
- `.create.<tag>` supported tags: `html, head, title, base, link, meta, style, body, header, nav, main, section, article, aside, footer, address, h1, h2, h3, h4, h5, h6, p, hr, pre, blockquote, ol, ul, li, dl, dt, dd, figure, figcaption, div, a, em, strong, small, s, cite, q, dfn, abbr, data, time, code, var, samp, kbd, sub, sup, i, b, u, mark, ruby, rt, rp, bdi, bdo, span, br, wbr, ins, del, img, iframe, embed, object, param, video, audio, source, track, picture, table, caption, colgroup, col, tbody, thead, tfoot, tr, td, th, form, label, input, button, select, datalist, optgroup, option, textarea, output, progress, meter, fieldset, legend, details, summary, dialog, script, noscript, template, canvas, menu, menuitem, center, font`.

### ContentManager
- `.content` - content manager namespace (node children only, primitives skipped).
- `.content.count(): number` - count of `_content` items, after unwrapping from _elem or other _VSNs.
- `.content.at(ix: number): LiveTree | undefined` - node child at index (undefined if primitive/absent).
- `.content.first(): LiveTree | undefined` - first node child.
- `.content.all(): readonly LiveTree[]` - all node children after unwrapping any _VSNs.
- `.content.mustOnly(opts?: { warn?: boolean }): LiveTree` - expects exactly one node child or throws (warns by default). Unwraps any _VSNs and returns first non-VSN node

### TextManager
- `.text` - namespace for text leaf operations.
- `.text.set(value: Primitive): LiveTree` - replaces only `_str/_val` leaves (keeps element children).
- `.text.add(value: Primitive): LiveTree` - appends a new text leaf.
- `.text.insert(index: number, value: Primitive): LiveTree` - inserts a text leaf at VSN bucket index.
- `.text.overwrite(value: Primitive): LiveTree` - replaces *all* content with one text leaf (DOM `textContent`).
- `.text.get(): string` - concatenated text of `_str/_val` leaves.
- `.setFormValue(value: string, opts?: { silent?: boolean; strict?: boolean }): LiveTree` - sets form value and mirrors to DOM when present.
- `.getFormValue(): string` - reads current form value (DOM preferred).

### AttrManager
- `.attr.get(name: string): Primitive | undefined` - read attribute from HSON.
- `.attr.set(name: string, value: string | boolean | null): LiveTree` - set one attribute (null/false remove).
- `.attr.setMany(map: Record<string, string | boolean | null>): LiveTree` - set many attributes.
- `.attr.drop(name: string): LiveTree` - remove an attribute.
- `.flag.set(...names: string[]): LiveTree` - set boolean-present attributes.
- `.flag.clear(...names: string[]): LiveTree` - clear boolean-present attributes.

### StyleManager, StyleSetter, CssManager
- `.style` - inline style handle.
- `.style.set.<prop>(value) / .style.set["prop"](value) / .style.set.var("--x", value): LiveTree` - proxy sugar for single-property set.
- `.style.setProp(prop: string, value: CssValue): LiveTree` - set/remove one inline style.
- `.style.setMany(map: CssMap): LiveTree` - set many inline styles (pseudo blocks are ignored for inline).
- `.style.remove(prop: string): LiveTree` - remove one inline style.
- `.style.clear(): LiveTree` - clear all inline styles.
- `.style.get.property(prop: string): string | undefined` - read stored inline style value.
- `.style.get.var(name: string): string | undefined` - read stored CSS var (`--x` or `x`).
- `.css` - QUID-scoped stylesheet handle.
- `.css.set.<prop>(value) / .css.set["prop"](value) / .css.set.var("--x", value): LiveTree` - proxy sugar for rule set.
- `.css.setProp(prop: string, value: CssValue): LiveTree` - set/remove one rule property.
- `.css.setMany(map: CssMap): LiveTree` - set many; supports pseudo blocks `_hover`, `_active`, `_focus`, `_focusWithin`, `_focusVisible`, `_visited`, `_checked`, `_disabled`, `__before`, `__after` (auto `content: ""` for before/after if missing).
- `.css.remove(prop: string): LiveTree` - remove one rule property.
- `.css.clear(): LiveTree` - clear all rules for this QUID.
- `.css.get.property(prop: string): string | undefined` - read stored rule value (consensus across quids if multi).
- `.css.get.var(name: string): string | undefined` - read stored CSS var.
- `.css.atProperty.register(input: PropertyInput): void` - register a `@property`.
- `.css.atProperty.registerMany(inputs: readonly PropertyInput[]): void` - batch register.
- `.css.atProperty.unregister(name: `--${string}`): void` - remove registration.
- `.css.atProperty.has(name: `--${string}`): boolean` - check registration.
- `.css.atProperty.get(name: `--${string}`): PropertyRegistration | undefined` - read registration.
- `.css.atProperty.renderOne(name: `--${string}`): string` - render one `@property` block.
- `.css.atProperty.renderAll(): string` - render all `@property` blocks.
- `.css.keyframes.set(input: KeyframesInput): void` - register/replace `@keyframes`.
- `.css.keyframes.setMany(inputs: readonly KeyframesInput[]): void` - batch register.
- `.css.keyframes.delete(name: string): void` - remove keyframes.
- `.css.keyframes.has(name: string): boolean` - check existence.
- `.css.keyframes.get(name: string): KeyframesDef | undefined` - get canonical definition.
- `.css.keyframes.renderOne(name: string): string` - render one `@keyframes`.
- `.css.keyframes.renderAll(): string` - render all keyframes.
- `.css.anim.begin(spec: AnimSpec): LiveTree` - start animation with full spec.
- `.css.anim.restart(spec: AnimSpec): LiveTree` - restart animation with spec.
- `.css.anim.beginName(name: string): LiveTree` - start by name only.
- `.css.anim.restartName(name: string): LiveTree` - restart by name only.
- `.css.anim.end(mode?: "name-only" | "clear-all"): LiveTree` - stop/clear animation.
- `.css.anim.setPlayState(state: "running" | "paused"): LiveTree` - set play state.
- `.css.anim.pause(): LiveTree` - pause animation.
- `.css.anim.resume(): LiveTree` - resume animation.

### Data[set]Manager
- `.data` - `data-*` helper namespace.
- `.data.set(key: string, value: Primitive | undefined): LiveTree` - set/remove `data-*` (camel→kebab).
- `.data.setMany(map: Record<string, Primitive | undefined>): LiveTree` - batch set/remove.
- `.data.get(key: string): Primitive | undefined` - reads `data-${key}` (no camel→kebab here).

#### id api
- `.id` - `id` attribute helper namespace.
- `.id.get(): string | undefined` - read `id`.
- `.id.set(id: string): LiveTree` - set `id`.
- `.id.clear(): LiveTree` - remove `id`.

#### class api
- `.classlist` - `class` attribute helper namespace.
- `.classlist.get(): string | undefined` - raw `class` attribute.
- `.classlist.has(name: string): boolean` - contains class.
- `.classlist.set(cls: string | string[]): LiveTree` - replace classes (empty clears).
- `.classlist.add(...names: string[]): LiveTree` - add classes.
- `.classlist.remove(...names: string[]): LiveTree` - remove classes.
- `.classlist.toggle(name: string, force?: boolean): LiveTree` - toggle class.
- `.classlist.clear(): LiveTree` - remove `class` attribute.

#### dom api
- `.dom` - DOM adapter namespace.
- `.dom.el(): Element | undefined` - mapped DOM element.
- `.dom.html(): HTMLElement | undefined` - mapped HTMLElement (runtime also adds `.dom.html.must(): HTMLElement`).
- `.dom.matches(sel: string): boolean` - element `matches()` if present.
- `.dom.contains(other: LiveTree): boolean` - element `contains()` other’s element.
- `.dom.closest(sel: string): LiveTree | undefined` - closest ancestor that belongs to this tree.
- `.dom.closest.must(sel: string, label?: string): LiveTree` - throws if no match.
- `.dom.parent(): LiveTree | undefined` - parent element as LiveTree.
- `.dom.parent.must(label?: string): LiveTree` - throws if no parent.

#### event listener management
- `.listen` - event listener builder (DOM-backed).
- `.listen.on<K extends keyof HTMLElementEventMap>(type: K, handler): ListenerSub` - attach typed DOM listener.
- `.listen.onInput / onChange / onSubmit`: ListenerSub - form events.
- `.listen.onClick / onDblClick / onContextMenu / onMouseMove / onMouseDown / onMouseUp / onMouseEnter / onMouseLeave`: ListenerSub - mouse events.
- `.listen.onPointerDown / onPointerMove / onPointerUp / onPointerEnter / onPointerLeave / onPointerCancel`: ListenerSub - pointer events.
- `.listen.onTouchStart / onTouchMove / onTouchEnd / onTouchCancel`: ListenerSub - touch events.
- `.listen.onWheel / onScroll`: ListenerSub - wheel/scroll.
- `.listen.onKeyDown / onKeyUp`: ListenerSub - keyboard.
- `.listen.onFocus / onBlur / onFocusIn / onFocusOut`: ListenerSub - focus events.
- `.listen.onDragStart / onDragOver / onDrop / onDragEnd`: ListenerSub - drag events.
- `.listen.onAnimationStart / onAnimationIteration / onAnimationEnd / onAnimationCancel`: ListenerSub - CSS animation lifecycle.
- `.listen.onTransitionStart / onTransitionEnd / onTransitionCancel / onTransitionRun`: ListenerSub - CSS transition lifecycle.
- `.listen.onCopy / onCut / onPaste`: ListenerSub - clipboard.
- `.listen.onCustom(type: string, handler): ListenerSub` - custom event.
- `.listen.onCustomDetail<D>(type: string, handler: (ev: CustomEvent<D>) => void): ListenerSub` - custom event with typed detail.
- `.listen.once(): ListenerBuilder` - set `{ once: true }` for next attach.
- `.listen.passive(): ListenerBuilder` - set `{ passive: true }` for next attach.
- `.listen.capture(): ListenerBuilder` - set `{ capture: true }` for next attach.
- `.listen.toWindow(): ListenerBuilder` - target window for next attach.
- `.listen.toDocument(): ListenerBuilder` - target document for next attach.
- `.listen.strict(policy?: "ignore" | "warn" | "throw"): ListenerBuilder` - missing-target policy.
- `.listen.preventDefault(): ListenerBuilder` - wrap handler to `preventDefault()` (if not passive).
- `.listen.stopProp(): ListenerBuilder` - wrap handler to `stopPropagation()`.
- `.listen.stopImmediateProp(): ListenerBuilder` - wrap handler to `stopImmediatePropagation()`.
- `.listen.stopAll(): ListenerBuilder` - enables prevent+stop+stopImmediate.
- `.listen.clearStops(): ListenerBuilder` - clears prevent/stop flags.
- `.listen` event methods return `ListenerSub` with `.off(): void`, `.count: number`, `.ok: boolean`.

#### events management
- `.events` - internal event bus.
- `.events.on(type: string, handler: (payload: unknown) => void): () => void` - subscribe; returns off.
- `.events.once(type: string, handler: (payload: unknown) => void): () => void` - one-shot.
- `.events.emit(type: string, payload?: unknown): void` - publish.

- `.quid: string` - stable QUID of the node.
- `.node: HsonNode` - underlying node (throws if ref can’t resolve).
- `.hostRootNode(): HsonNode` - historic root for this tree.
- `.asDomElement(): Element | undefined` - direct DOM element lookup.
- `.adoptRoots(root: HsonNode): this` - rebind host root (internal/advanced).

## TreeSelector (returned by `.findAll(...)`)
- `.toArray(): LiveTree[]` - materialize selection.
- `.count(): number` - selection size.
- `.first(): LiveTree | undefined` - first selected tree.
- `.forEach(fn): void` - iterate selection.
- `.map(fn): T[]` - map selection.
- `.filter(fn): TreeSelector` - filter selection.
- `.removeSelf(): number` - remove each selected node; returns count.
- `.remove(): number` - alias of `.removeSelf()`.
- `.listen` - broadcast `LiveTree.listen` to all items (returns last `ListenerSub`).
- `.style` - broadcast `LiveTree.style` to all items.
- `.css` - broadcast `LiveTree.css` to all items.
- `.data` - broadcast `LiveTree.data` to all items.
