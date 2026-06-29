#### hson-live / hson.terminalgothic.com

# LiveTree Method and Helper List
Updated: 2026-06-29

This is a quick inventory of the current public LiveTree-facing surface. For
behavior notes, see `hson-livetree-api.md` and `css-manager-api.md`.

---

## Public Constructors

### Transform Pipeline

```ts
hson.fromUntrustedHtml(input)
hson.fromTrustedHtml(input)
hson.fromJson(input)
hson.fromHson(input)
hson.fromNode(node)
```

These return the transform output builder:

```ts
.sanitizeBEWARE()
.toHtml()
.toJson()
.toHson()
```

After `toHtml()`, `toJson()`, or `toHson()`:

```ts
.spaced()
.noBreak()
.withOptions(options)
.serialize()
.parse()
```

Current limitation: formatting options are exposed but not consistently honored
by all serializers.

### LiveTree Facade

```ts
hson.liveTree.fromUntrustedHtml(input)
hson.liveTree.fromTrustedHtml(input)
hson.liveTree.fromJson(input)
hson.liveTree.fromHson(input)
hson.liveTree.fromNode(node)
hson.liveTree.queryDom(selector).graft()
hson.liveTree.queryBody().graft()
hson.liveTree.create
```

Use `queryDom`, not `queryDOM`.

---

## Core LiveTree

```ts
tree.node
tree.quid
tree.hostRootNode()
tree.adoptRoots(root)
tree.append(branch, index?)
tree.empty()
tree.removeChildren()
tree.removeSelf()
tree.cloneBranch()
```

---

## DOM Helper

```ts
tree.dom.el()
tree.dom.htmlEl()
tree.dom.innerHtml
tree.dom.outerHtml
tree.dom.isConnected()
tree.dom.matches(sel)
tree.dom.contains(other)
tree.dom.contains.node(node)
tree.dom.contains.target(target)
tree.dom.contains.tree(other)
tree.dom.rect()
tree.dom.closest(sel)
tree.dom.parent()
tree.dom.computed()
tree.dom.computedProp(name)
tree.dom.clientRects()
tree.dom.scrollSize()
tree.dom.clientSize()
tree.dom.treeFromEl(el, label?)
tree.dom.doc
```

Document helper:

```ts
tree.dom.doc?.elementAtPoint(x, y)
tree.dom.doc?.elementsFromPoint(x, y)
tree.dom.doc?.treeAtPoint(x, y)
tree.dom.doc?.treesFromPoint(x, y)
```

Strict DOM helper:

```ts
tree.dom.must.el(label?)
tree.dom.must.htmlEl(label?)
tree.dom.must.innerHtml
tree.dom.must.outerHtml
tree.dom.must.rect(label?)
tree.dom.must.closest(sel, label?)
tree.dom.must.parent(label?)
tree.dom.must.treeFromEl(el, label?)
tree.dom.must.computed(label?)
tree.dom.must.computedProp(name, label?)
tree.dom.must.clientRects(label?)
tree.dom.must.scrollSize(label?)
tree.dom.must.clientSize(label?)
tree.dom.must.doc
```

---

## Querying

### `find`

```ts
tree.find(query)
tree.find.byId(id)
tree.find.byQuid(quid)
tree.find.byAttribute(attr, value)
tree.find.byFlag(flag)
tree.find.byClass(className)
tree.find.byData(key, value)
tree.find.byTag(tag)
```

Strict variants:

```ts
tree.find.must(query, label?)
tree.find.must.byId(id)
tree.find.must.byQuid(quid)
tree.find.must.byAttribute(attr, value)
tree.find.must.byFlag(flag)
tree.find.must.byClass(className)
tree.find.must.byData(key, value)
tree.find.must.byTag(tag)
```

SVG-narrowing variants:

```ts
tree.find.asSvg(query)
tree.find.asSvg.byId(id)
tree.find.asSvg.byQuid(quid)
tree.find.asSvg.byAttribute(attr, value)
tree.find.asSvg.byFlag(flag)
tree.find.asSvg.byClass(className)
tree.find.asSvg.byData(key, value)
tree.find.asSvg.byTag(tag)

tree.find.must.asSvg(query, label?)
tree.find.must.asSvg.byId(id)
tree.find.must.asSvg.byQuid(quid)
tree.find.must.asSvg.byAttribute(attr, value)
tree.find.must.asSvg.byFlag(flag)
tree.find.must.asSvg.byClass(className)
tree.find.must.asSvg.byData(key, value)
tree.find.must.asSvg.byTag(tag)
```

### `findAll`

```ts
tree.findAll(query)
tree.findAll([queryA, queryB])
tree.findAll.id(idOrIds)
tree.findAll.byId(id)
tree.findAll.byIds(...ids)
tree.findAll.byAttribute(attr, value)
tree.findAll.byAttr(attr, value)
tree.findAll.byAttrs(attr, value)
tree.findAll.byFlag(flag)
tree.findAll.byFlags(flag)
tree.findAll.byClass(className)
tree.findAll.byData(key, value)
tree.findAll.byTag(tag)
```

Strict variants:

```ts
tree.findAll.must(query, label?)
tree.findAll.must.id(idOrIds)
tree.findAll.must.byId(id)
tree.findAll.must.byIds(...ids)
tree.findAll.must.byAttribute(attr, value)
tree.findAll.must.byAttr(attr, value)
tree.findAll.must.byAttrs(attr, value)
tree.findAll.must.byFlag(flag)
tree.findAll.must.byFlags(flag)
tree.findAll.must.byClass(className)
tree.findAll.must.byData(key, value)
tree.findAll.must.byTag(tag)
```

Structural query shape:

```ts
type HsonQuery = {
  tag?: string;
  attrs?: Partial<HsonAttrs>;
  meta?: Partial<HsonMeta>;
  text?: string | RegExp;
};
```

---

## TreeSelector

```ts
selector.array()
selector.length
selector.first()
selector.last()
selector.at(ix)
selector.each(fn)
selector.map(fn)
selector.filter(fn)
selector.removeAt(ix)
selector.removeAll()
```

Broadcast manager proxies:

```ts
selector.listen
selector.style
selector.css
selector.data
```

---

## Creation

Detached:

```ts
hson.liveTree.create.tag(tag, source?)
hson.liveTree.create.tags(tags)
hson.liveTree.create.prepend()
hson.liveTree.create.at(index)
hson.liveTree.create.div(source?)
hson.liveTree.create.svg(source?)
hson.liveTree.create.canvas(source?)
```

Bound to a tree:

```ts
tree.create.tag(tag, source?)
tree.create.tags(tags)
tree.create.prepend()
tree.create.at(index)
tree.create.div(source?)
tree.create.svg(source?)
tree.create.canvas(source?)
```

The helper also exposes direct HTML tag helpers and direct SVG tag helpers.
In SVG scope, child creation uses SVG namespace semantics.

---

## Content

```ts
tree.content.count()
tree.content.at(ix)
tree.content.first()
tree.content.all()
tree.content.deep()
tree.content.mustOnly(opts?)
tree.content.markup.innerHTML
tree.content.markup.outerHTML
```

Content helpers operate on effective element children. They skip primitive
leaves, skip VSN leaves, and unwrap structural VSN containers.

---

## Text and Form

Text:

```ts
tree.text.set(value)
tree.text.add(value)
tree.text.insert(ix, value)
tree.text.overwrite(value)
tree.text.get()
```

Form:

```ts
tree.form.setValue(value, opts?)
tree.form.getValue()
tree.form.setChecked(value, opts?)
tree.form.getChecked()
tree.form.setSelected(value, opts?)
tree.form.getSelected()
```

Form options:

```ts
type SetNodeFormOpts = {
  silent?: boolean;
  strict?: boolean;
};
```

---

## Attributes

```ts
tree.attr.get(name)
tree.attr.has(name)
tree.attr.set(name, value)
tree.attr.setMany(map)
tree.attr.drop(name)
```

Flags:

```ts
tree.flag.has(name)
tree.flag.set(...names)
tree.flag.clear(...names)
```

Dataset:

```ts
tree.data.set(key, value)
tree.data.setMany(map)
tree.data.get(key)
tree.data.drop(key)
```

ID:

```ts
tree.id.get()
tree.id.set(id)
tree.id.clear()
```

Class:

```ts
tree.classlist.get()
tree.classlist.has(name)
tree.classlist.set(cls)
tree.classlist.add(...names)
tree.classlist.remove(...names)
tree.classlist.toggle(name, force?)
tree.classlist.clear()
```

---

## Inline Style

```ts
tree.style.set.backgroundColor(value)
tree.style.set["background-color"](value)
tree.style.set.var(name, value)
tree.style.setProp(prop, value)
tree.style.setMany(map)
tree.style.remove(prop)
tree.style.clear()
tree.style.get.property(prop)
tree.style.get.backgroundColor()
tree.style.get["background-color"]()
tree.style.get["--var-name"]()
tree.style.get.vars(names)
tree.style.getMany()
tree.style.var.name(name)
tree.style.var.key(name)
tree.style.var.set(name, value)
tree.style.var.value(name)
```

---

## QUID-Scoped CSS

```ts
tree.css.set.backgroundColor(value)
tree.css.set["background-color"](value)
tree.css.set.var(name, value)
tree.css.setProp(prop, value)
tree.css.setMany(map)
tree.css.remove(prop)
tree.css.clear()
tree.css.get.property(prop)
tree.css.getMany()
tree.css.var.name(name)
tree.css.var.key(name)
tree.css.var.set(name, value)
tree.css.var.value(name)
tree.css.selector(pattern)
tree.css.media(query)
tree.css.supports(cond)
tree.css.layer(layerName)
tree.css.devSnapshot()
```

CSS sub-managers:

```ts
tree.css.atProperty.register(input)
tree.css.atProperty.registerMany(inputs)
tree.css.atProperty.unregister(name)
tree.css.atProperty.has(name)
tree.css.atProperty.get(name)
tree.css.atProperty.renderOne(name)
tree.css.atProperty.renderAll()

tree.css.keyframes.set(input)
tree.css.keyframes.setOwned(owner, input)
tree.css.keyframes.setMany(inputs)
tree.css.keyframes.delete(name)
tree.css.keyframes.releaseOwner(owner)
tree.css.keyframes.listOwned(owner)
tree.css.keyframes.has(name)
tree.css.keyframes.get(name)
tree.css.keyframes.renderOne(name)
tree.css.keyframes.renderAll()

tree.css.anim.begin(spec)
tree.css.anim.restart(spec)
tree.css.anim.beginName(name)
tree.css.anim.restartName(name)
tree.css.anim.end(mode?)
tree.css.anim.setPlayState(state)
tree.css.anim.pause()
tree.css.anim.resume()
```

---

## Events

Base listener calls:

```ts
tree.listen.on(type, handler)
tree.listen.onCustom(type, handler)
tree.listen.onCustomDetail(type, handler)
```

Targets:

```ts
tree.listen.element
tree.listen.document
tree.listen.window
tree.listen.toDocument()
tree.listen.toWindow()
```

Options and modifiers:

```ts
tree.listen.once()
tree.listen.passive()
tree.listen.capture()
tree.listen.strict(policy?)
tree.listen.preventDefault()
tree.listen.stopProp()
tree.listen.stopImmediateProp()
tree.listen.stopAll()
tree.listen.clearStops()
```

Convenience event methods:

```ts
tree.listen.onInput(fn)
tree.listen.onChange(fn)
tree.listen.onSubmit(fn)
tree.listen.onClick(fn)
tree.listen.onDblClick(fn)
tree.listen.onContextMenu(fn)
tree.listen.onMouseMove(fn)
tree.listen.onMouseDown(fn)
tree.listen.onMouseUp(fn)
tree.listen.onMouseEnter(fn)
tree.listen.onMouseLeave(fn)
tree.listen.onPointerDown(fn)
tree.listen.onPointerMove(fn)
tree.listen.onPointerUp(fn)
tree.listen.onPointerEnter(fn)
tree.listen.onPointerLeave(fn)
tree.listen.onPointerCancel(fn)
tree.listen.onTouchStart(fn)
tree.listen.onTouchMove(fn)
tree.listen.onTouchEnd(fn)
tree.listen.onTouchCancel(fn)
tree.listen.onWheel(fn)
tree.listen.onScroll(fn)
tree.listen.onKeyDown(fn)
tree.listen.onKeyUp(fn)
tree.listen.onFocus(fn)
tree.listen.onBlur(fn)
tree.listen.onFocusIn(fn)
tree.listen.onFocusOut(fn)
tree.listen.onDragStart(fn)
tree.listen.onDragOver(fn)
tree.listen.onDrop(fn)
tree.listen.onDragEnd(fn)
tree.listen.onAnimationStart(fn)
tree.listen.onAnimationIteration(fn)
tree.listen.onAnimationEnd(fn)
tree.listen.onAnimationCancel(fn)
tree.listen.onTransitionStart(fn)
tree.listen.onTransitionEnd(fn)
tree.listen.onTransitionCancel(fn)
tree.listen.onTransitionRun(fn)
tree.listen.onCopy(fn)
tree.listen.onCut(fn)
tree.listen.onPaste(fn)
```

Listener return value:

```ts
sub.off()
sub.count
sub.ok
```

Tree-local event bus:

```ts
tree.events.on(type, handler)
tree.events.once(type, handler)
tree.events.emit(type, payload?)
```

---

## SVG

```ts
tree.svg.inScope()
tree.svg.viewBox.get()
tree.svg.viewBox.set(value)
tree.svg.viewBox.set(x, y, w, h)
tree.svg.viewBox.clear()
tree.svg.preserveAspectRatio.get()
tree.svg.preserveAspectRatio.set(value)
tree.svg.preserveAspectRatio.none()
tree.svg.preserveAspectRatio.clear()
tree.svg.d.get()
tree.svg.d.set(value)
tree.svg.d.clear()
tree.svg.fill.get()
tree.svg.fill.set(value)
tree.svg.fill.none()
tree.svg.fill.clear()
tree.svg.stroke.get()
tree.svg.stroke.set(value)
tree.svg.stroke.clear()
tree.svg.strokeWidth.get()
tree.svg.strokeWidth.set(value)
tree.svg.strokeWidth.clear()
tree.svg.vectorEffect.get()
tree.svg.vectorEffect.set(value)
tree.svg.vectorEffect.nonScalingStroke()
tree.svg.vectorEffect.clear()
tree.svg.bbox()
tree.svg.must.bbox(label?)
```

---

## Canvas

```ts
tree.canvas.inScope()
tree.canvas.el()
tree.canvas.ctx2d(settings?)
tree.canvas.pointer(ev)
tree.canvas.width.get()
tree.canvas.width.set(value)
tree.canvas.width.clear()
tree.canvas.height.get()
tree.canvas.height.set(value)
tree.canvas.height.clear()
tree.canvas.size.get()
tree.canvas.size.set(width, height)
tree.canvas.size.clear()
tree.canvas.display.size(opts?)
tree.canvas.display.match(opts?)
tree.canvas.display.match.watch(opts?)
tree.canvas.clear()
tree.canvas.clear(x, y, w, h)
tree.canvas.plot(fn, settings?)
tree.canvas.must.el(label?)
tree.canvas.must.ctx2d(settings?, label?)
tree.canvas.must.pointer(ev, label?)
tree.canvas.must.plot(fn, settings?, label?)
```

---

## Current Internal Node Shape

```ts
type HsonNode = {
  $_tag: string;
  $_content: (HsonNode | Primitive)[];
  $_attrs?: HsonAttrs;
  $_meta?: HsonMeta;
};
```

VSN tag values remain strings such as `_hson_root`, `_hson_elem`, `_hson_obj`, `_hson_arr`,
`_hson_ii`, `_hson_str`, and `_hson_val`.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
