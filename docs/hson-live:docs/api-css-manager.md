#### hson-live / hson.terminalgothic.com

# LiveTree CSS APIs
Updated: 2026-07-13

This document covers the current style and stylesheet APIs:

- `LiveTree.style` - inline style stored on the HSON node.
- `LiveTree.css` - QUID-scoped stylesheet rules.
- `TreeSelector.style` and `TreeSelector.css` - broadcast proxies.
- `CssManager.api()` - global stylesheet facade.
- Shared `StyleSetter`, style getters, CSS variables, selector blocks,
  at-rule facades, `@property`, keyframes, and animations.

---

## StyleSetter

`StyleSetter` is the shared write surface used by inline style handles,
QUID-scoped CSS handles, selector handles, and global rule handles.

```ts
handle.set.backgroundColor("red");
handle.set["background-color"]("red");
handle.set.var("accent", "hotpink");
handle.setProp("background-color", "red");
handle.setMany({ opacity: 0.5, "--phase": 1 });
handle.remove("opacity");
handle.clear();
```

The setter normalizes property keys, renders values, and delegates the actual
write to the backend.

### Accepted Values

`CssValue` is:

```ts
string | number | boolean | null | undefined | { value: string | number; unit?: string }
```

Rules for an individual setter call:

- `null` and `undefined` mean remove.
- Strings are trimmed.
- Numbers and booleans are stringified.
- `{ value, unit }` renders as `${value}${unit ?? ""}`.
- Empty strings remove properties in `CssManager` QUID rules and global rules.

`setMany()` has one important difference: entries whose value is `null` or
`undefined` are skipped, not removed. Use `remove(prop)` for an explicit bulk
update deletion.

The low-level exported `render_css_value()` treats `{ unit: "_" }` as unitless,
but the shared public `StyleSetter` renderer currently emits the underscore
literally. Do not use `_` as a public unit shorthand until those paths are
unified; omit `unit` for a unitless value.

### Key Normalization

Accepted keys include:

- camelCase: `backgroundColor`
- kebab-case: `background-color`
- custom properties: `--accent`
- `set.var("accent", value)`, `set.var("-accent", value)`, or
  `set.var("--accent", value)`

Normal properties are emitted as CSS property names. Custom properties preserve
their `--name` spelling.

---

## Style Getters

Style-like handles also expose a getter surface and a bulk read:

```ts
handle.get.property("background-color");
handle.get.backgroundColor();
handle.get["background-color"]();
handle.get["--accent"]();
handle.get.vars(["accent", "--phase"]);
handle.getMany();
```

Reads return the handle's stored/internal value, not browser-computed style.
Use `tree.dom.computed()` or `tree.dom.computedProp(name)` for computed browser
style.

CSS variable helpers are exposed separately:

```ts
handle.var.name("accent");      // "--accent"
handle.var.key("accent");       // "var(--accent)"
handle.var.set("accent", "red");
handle.var.value("accent");
```

---

## Inline Style: `tree.style`

`LiveTree.style` writes to inline style state on the node, currently through
`node.$_attrs.style`, and mirrors to the mounted DOM element when one exists.

```ts
tree.style.set.display("grid");
tree.style.setMany({
  gap: "1rem",
  "--accent": "hotpink",
});
tree.style.remove("gap");
tree.style.clear();
```

Inline style differences:

- No stylesheet rule is created.
- Pseudo blocks such as `_hover` and `__before` are ignored because inline
  styles cannot represent pseudo selectors.
- `style.get.*` reads inline style state, not QUID CSS, global CSS, or computed
  browser style.
- In browser runtimes, proxy typing/key lists are based on
  `document.documentElement.style`; in non-DOM runtimes a small fallback list is
  used.

---

## QUID-Scoped CSS: `tree.css`

`LiveTree.css` writes stylesheet rules scoped to the tree's QUID:

```css
[data-_quid="..."] { opacity: 0.5; }
```

Usage:

```ts
tree.css.set.opacity(0.5);
tree.css.setMany({
  transform: "translateX(10px)",
  "--phase": 1,
});
tree.css.remove("opacity");
tree.css.clear();
```

`tree.css` exposes:

```ts
tree.css.set
tree.css.setProp(prop, value)
tree.css.setMany(map)
tree.css.remove(prop)
tree.css.clear()
tree.css.get
tree.css.getMany()
tree.css.var
tree.css.selector(pattern)
tree.css.media(query)
tree.css.supports(cond)
tree.css.layer(layerName)
tree.css.atProperty
tree.css.keyframes
tree.css.anim
tree.css.devSnapshot()
```

For multi-QUID handles, reads are consensus reads. If any selected QUID is
missing the property, or selected QUIDs disagree, the read returns `undefined`.
`getMany()` returns only properties that exist and agree across all selected
QUIDs.

QUID writes are checked with `CSS.supports()` when that browser API exists;
unsupported declarations are warned and skipped. Inline-style and global-rule
backends do not apply the same preflight filter, so this is not a uniform
validation contract across all style surfaces.

---

## Pseudo Blocks

Stylesheet-backed handles support pseudo blocks in `setMany()`:

```ts
tree.css.setMany({
  color: "black",
  _hover: {
    color: "red",
  },
  __before: {
    display: "block",
  },
});
```

Supported pseudo keys:

```ts
_hover
_active
_focus
_focusWithin
_focusVisible
_visited
_checked
_disabled
__before
__after
```

They render as selector siblings such as `:hover`, `:focus-visible`,
`::before`, and `::after`. For `__before` and `__after`, stylesheet-backed
global/selector paths add `content: ""` when omitted.

Pseudo blocks are not applied by `tree.style`.

---

## Selector Blocks

`tree.css.selector(pattern)` returns a stylesheet-backed `StyleHandle` scoped
relative to the QUID selector.

```ts
tree.css.selector(":hover").set.opacity(1);
tree.css.selector("& > .label").set.color("red");
tree.css.selector("& .icon").setMany({
  transform: "scale(1.1)",
});
```

Patterns are resolved against the bound QUID selector. `&` represents the
current QUID selector. Selector handles support the normal setter/getter/var
surface and pseudo blocks.

`setMany()` on QUID-scoped CSS also accepts nested selector keys that start with
`&`:

```ts
tree.css.setMany({
  "& > .label": {
    color: "red",
  },
});
```

---

## At-Rule Facades

QUID-scoped CSS handles support scoped facades:

```ts
tree.css.media({ maxWidth: 700 }).set.display("none");
tree.css.supports({ "backdrop-filter": "blur(4px)" }).set.backdropFilter("blur(4px)");
tree.css.layer("components").set.zIndex(1);
```

These return CSS handles with the same surface as `tree.css`, but generated
rules render inside the corresponding at-rule. Facades can be chained:

```ts
tree.css
  .media("(max-width: 700px)")
  .supports("(display: grid)")
  .selector("& > .label")
  .set.display("grid");
```

Media input may be a string or an object:

```ts
tree.css.media("(max-width: 700px)");
tree.css.media({ maxWidth: 700, orientation: "portrait" });
```

Supports input may be a string or a declaration-test object:

```ts
tree.css.supports("(display: grid)");
tree.css.supports({ display: "grid" });
```

---

## CssManager

`CssManager` is the singleton stylesheet engine behind QUID CSS, global rules,
`@property`, and keyframes.

Preferred public global entry:

```ts
const css = CssManager.api();
```

Lower-level engine entry:

```ts
const manager = CssManager.invoke();
```

`invoke()` is mainly for internal plumbing, diagnostics, direct QUID methods,
and tests.

The manager renders into one managed style host when a DOM is available:

```html
<hson-_style id="css-manager">
  <style id="_hson"></style>
</hson-_style>
```

Scheduling:

- In browser-like runtimes with `requestAnimationFrame`, writes are batched.
- Without a DOM render loop, writes flush immediately for deterministic tests.
- `syncNow()` forces an immediate flush if state is dirty.
- `snapshot()` / `renderCss()` provide QUID rules plus `@property` and
  keyframes text for inspection. They do not include global rules, even though
  the managed DOM stylesheet does.
- `debug_hardReset()` clears QUID rules, `@property`, keyframes, scheduling
  state, and the managed style element. The current implementation does not
  clear the separate `GlobalCss` singleton, so global rules can survive this
  reset.

Lower-level QUID methods include:

```ts
manager.setForQuid(quid, propCanon, value)
manager.setManyForQuid(quid, decls)
manager.unsetForQuid(quid, propCanon)
manager.clearQuid(quid)
manager.clearAll()
manager.getForQuid(quid, propCanon)
manager.getAllForQuid(quid)
manager.hasAnyRules(quid)
manager.animForQuids(quids)
manager.releaseOwnedCssForQuid(quid)
manager.setOwnedKeyframesForQuid(quid, input)
```

`manager.clearAll()` clears only QUID-scoped rules. It does not clear global
rules, `@property`, or keyframes.

---

## Global CSS

`CssManager.api()` returns the global CSS facade plus shared `atProperty` and
`keyframes` managers.

```ts
const css = CssManager.api();

css.sel("body").set.margin("0");
css.rule("app-shell", ".app").set.display("grid");
css.media({ maxWidth: 700 }).sel(".app").set.display("block");
css.supports({ display: "grid" }).sel(".grid").set.display("grid");
css.layer("base").sel(":root").set.colorScheme("dark");
```

Global facade surface:

```ts
css.rule(ruleKey, selector)
css.sel(selector)
css.drop(ruleKey)
css.dropByPrefix(prefix)
css.clearAll()
css.scope(scopeName, atRule)
css.media(query)
css.supports(cond)
css.layer(layerName)
css.var
css.has(ruleKey)
css.list()
css.get(ruleKey)
css.renderAll()
css.dispose()
```

`scope(scopeName, atRule)` currently uses only `atRule`; `scopeName` is accepted
but ignored. Prefer the named `media`, `supports`, and `layer` helpers when they
fit the rule.

Rule handles are `StyleSetter<void>` plus:

```ts
handle.ruleKey
handle.selector
handle.drop()
```

Rules render with deterministic property ordering. Empty rules are dropped.

### Global Variables

The global variable facade writes to `:root`.

```ts
css.var.name("accent");       // "--accent"
css.var.key("accent");        // "var(--accent)"
css.var.set("accent", "red");
css.var.value("accent");
css.var.remove("accent");
css.var.list();
css.var.clear();
```

---

## `@property`

`tree.css.atProperty` and `CssManager.api().atProperty` expose the same shared
registration manager.

```ts
tree.css.atProperty.register({
  name: "--phase",
  syn: "<number>",
  inh: false,
  init: "0",
});

tree.css.atProperty.register(["--angle", "<angle>", "0deg"]);
tree.css.atProperty.registerMany([
  ["--x", "<length>", "0px"],
  { name: "--color", syn: "<color>", inh: true, init: "red" },
]);
```

Surface:

```ts
register(input)
registerMany(inputs)
unregister(name)
has(name)
get(name)
renderOne(name)
renderAll()
```

Input fields use the compact current names:

- `name` - custom property name, e.g. `--phase`
- `syn` - syntax, e.g. `<number>`
- `inh` - whether the property inherits
- `init` - initial value

---

## Keyframes

`tree.css.keyframes` and `CssManager.api().keyframes` expose the shared
keyframes manager.

Object input:

```ts
tree.css.keyframes.set({
  name: "fade",
  steps: {
    from: { opacity: "0" },
    to: { opacity: "1" },
  },
});
```

Tuple input:

```ts
tree.css.keyframes.set({
  name: "spin",
  steps: [
    ["0%", { transform: "rotate(0deg)" }],
    ["100%", { transform: "rotate(360deg)" }],
  ],
});
```

Surface:

```ts
set(input)
setOwned(owner, input)
setMany(inputs)
delete(name)
releaseOwner(owner)
listOwned(owner)
has(name)
get(name)
renderOne(name)
renderAll()
```

Keyframes render globally as `@keyframes`. Owned keyframes are associated with
an owner id, usually a QUID, so teardown can release generated CSS for a node or
subtree.

A keyframe name has at most one effective owner. Claiming the same name for a
new owner transfers ownership; calling durable `set()` or `setMany()` for that
name removes generated ownership. Releasing an owner deletes the names still
owned by it.

---

## Animations

`tree.css.anim` returns a `CssAnimHandle` bound to the tree's QUID. It applies
animation-related CSS declarations through the QUID-scoped CSS manager.

```ts
tree.css.anim.begin({
  name: "fade",
  duration: "300ms",
  timingFunction: "ease-out",
});

tree.css.anim.restartName("fade");
tree.css.anim.pause();
tree.css.anim.resume();
tree.css.anim.end();
```

Surface:

```ts
begin(spec)
restart(spec)
beginName(name)
restartName(name)
end(mode?)
setPlayState("running" | "paused")
pause()
resume()
```

`end(mode)` accepts:

```ts
"name-only" | "clear-all"
```

`duration` is required and must be non-empty for `begin(spec)` and
`restart(spec)`. The name-only helpers set only the animation name and rely on
other declarations for duration/timing.

---

## TreeSelector Broadcasts

Selections expose broadcast proxies:

```ts
selector.style.setMany({ opacity: 0.5 });
selector.css.setMany({ pointerEvents: "none" });
selector.data.set("state", "disabled");
selector.listen.onClick(handler);
```

The proxy forwards top-level method calls to each selected tree. Empty
selections return no-op proxies. Nested manager surfaces are not recursively
broadcast.

---

## Inline vs QUID CSS

| Surface | Storage | Supports pseudos/selectors | Read source |
| --- | --- | --- | --- |
| `tree.style` | `node.$_attrs.style` and DOM inline style | no | inline style state |
| `tree.css` | managed stylesheet, QUID selector | yes | CssManager rule state |
| `tree.css.selector(...)` | managed global rule keyed by resolved selector | yes | rendered rule state |
| `CssManager.api().sel(...)` | managed global rule | yes | rendered rule state |

Use `tree.style` for inline attributes that should serialize with the node. Use
`tree.css` for stylesheet rules, pseudo states, selectors, media/supports/layer
rules, keyframes, and animations.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
