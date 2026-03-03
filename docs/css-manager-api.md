// css-manager-api.md

# CSS APIs

This document covers the CssManager API (both QUID-scoped and global), differences between stylesheet-based CssManager vs the inline StyleManager, the shared StyleSetter surface, and KeyframesManager, AnimationManager, and (@)PropertyManager.

---

## StyleSetter

StyleSetter is the shared fluent write surface used by `LiveTree.style` (StyleManager), `LiveTree.css` (CssManager), and `GlobalCss` rule handles. It is stateless: it normalizes keys and values, then delegates writes to a backend adapter.

### Surface

* `set` Proxy surface that returns all valid CSS properties (`tree.style.set.backgroundColor("red")`).
* `set.var("--x", 10)` convenience setter for CSS variables.
* `setProp(prop: string, value: string)` write one property.
* `setMany(map)` write many properties in one call.
* `remove(prop: string)` remove one property.
* `clear()` clear all properties for the handle.
 
Methods usually return `this`, enabling chaining with other LiveTree methods.


### Key normalization

* setMany accepts only camelCase.
* `float` and `css-float` normalize to `cssFloat`.
* Keys are normalized to canonical CSSOM form before being applied to the backend, which varies per caller.


### Value normalization
`CssValue` is `string | number | boolean | null | undefined | { value, unit? }`.

* `null` or `undefined` means remove when used with `setProp`.
* Strings are trimmed; numbers and booleans are stringified.
* `{ value, unit }` renders as `${value}: ${unit}`.
* `setMany` skips `null` and `undefined`

### Pseudo blocks in `setMany()`
`setMany` can write route pseudoelement rule blocks. As pseudo-elements are not accepted in inline style attributes, only managers with access to the hson-_style stylesheet element (CssManager & GlobalCss) can manipulate them.
Supported keys are:
`_hover`, `_active`, `_focus`, `_focusWithin`, `_disabled`, `_before`, `_after`.

A pseudo block must be a plain object map of declarations, not a `{ value, unit }` object. Psuedoelements are only supported via get/setMany. 

#### Example:
```ts
// applies CSS rules scoped to tree's QUID via CssManager
tree.css.setMany({
  _hover: { 
    opacity: 1,
    background: "orange" },
});
```

this appears in the style element as
```ts
[data-_quid="dbb9b6ce017707c9"]:hover{background:orange;opacity:1;}
```

---

## CssManager

`CssManager` owns QUID-scoped stylesheet rules. It stores rule maps in memory and renders a
single `<style>` element in the current document:

`<hson-_style id="css-manager"><style id="_hson">...</style></hson-_style>`

Each QUID maps to a selector `[data-_quid="..."]`.

Using liveTree.css.setMany, CSS can be set locally, per-node.

### Primary entry points

* `LiveTree.css` returns a `CssHandle` bound to the node's QUID.
* `CssManager.invoke()` returns the singleton manager.

A `CssHandle` is `StyleSetter + get + atProperty + keyframes + anim`.

( **In the near future, `.css` may only return `StyleSetter + get + atProperty`, and keyframes + animation would be under the `.anim` namespace** )

### Setting CSS rules

Handle surface:

```ts
// Single-QUID handle
tree.css.set.backgroundColor("black");
tree.css.setMany({ opacity: 0.5, "--phase": 1 });
tree.css.remove("opacity");
tree.css.clear();
```

#### Manager methods (typically internal):

* `setForQuid(quid, propCanon, value)`
* `setManyForQuid(quid, decls)`
* `unsetForQuid(quid, propCanon)`
* `clearQuid(quid)`
* `clearAll()`
* `getForQuid(quid, propCanon)` returns the last written value
* `hasAnyRules(quid)` returns whether any rules exist

### Read semantics

`CssHandle.get.property(...)` reads the stored value, not computed style.

For multi-QUID handles, `get.property(...)` returns a consensus value:

* If any QUID is missing the property, the result is `undefined`.
* If values differ between QUIDs, the result is `undefined`.

### Value and key behavior

* Property keys are normalized to canonical CSSOM form when written.
* At render time, canonical keys are emitted as CSS property names
  (custom properties preserved, camelCase converted to kebab-case).
* `setForQuid` treats empty strings as delete and `null` or `undefined` as delete.

### Scheduling and rendering

* Mutations mark the manager as changed.
* In browsers, a single `requestAnimationFrame` flush batches updates.
* In Node/test environments, writes flush immediately.
* `syncNow()` forces an immediate flush if anything changed.
* `renderCss()` returns the combined CSS text for inspection.
* `debug_hardReset()` clears all CSS state and the managed style element.

## Sub-managers

* `atProperty` exposes the `@property` registration manager.
* `keyframes` exposes the keyframes manager.
* `animForQuids(...)` returns a `CssAnimHandle` wired to QUID scopes.
* `CssHandle.anim` is a pre-wired animation handle for the bound QUIDs.

At some point in the future, animation and keyframes may both be relocated under the `liveTree.anim` namespace

---

### PropertyManager

The `atProperty` manager owns `@property` registrations. It is intended for declaring custom
properties with type, syntax, and inheritance metadata so animations and transitions can
interpolate correctly.

#### Usage pattern:
```ts
const css = tree.css;
css.atProperty
  .set("--phase", { syntax: "<number>", inherits: false, initial: 0 })
  .set("--speed", { syntax: "<number>", inherits: true, initial: 1 });
```

#### Behavior notes:
* Writes are centralized in `CssManager`, not per-node.
* Changes are rendered into the same managed `<style>` element.
* You can treat registrations as global for the current document.

---

### KeyframesManager

The `.keyframes` manager owns named keyframe definitions.

#### Usage pattern:

```ts
const css = tree.css;
css.keyframes.set({
  name: "fade",
  steps: {
    "0%": { opacity: 0 },
    "100%": { opacity: 1 },
  },
});
```

#### Behavior notes:

* Definitions are stored in memory and rendered into the managed stylesheet.
* Updating a keyframe name replaces the prior definition.
* The manager only writes the keyframe blocks; it does not start animations.

Automated teardown and cleanup of keyframes is planned but not begun.


### AnimationManager

`CssHandle.anim` and `CssManager.animForQuids(...)` return a `CssAnimHandle` bound to one
or more QUIDs. It is a small control surface for applying, starting, or clearing animations
against those targets.

#### Typical usage:

```ts
const anim = tree.css.anim;
anim.begin({ name: "fade", duration: "300ms", easing: "ease-out" });
```

#### Behavior notes:

* Animation writes flow through `CssManager` and are scoped to the QUID selector(s).
* DOM element discovery for animation side effects uses the current document.

---

## Globals

Global rules are selector-based (not QUID-scoped) and can be rendered into the same
stylesheet when used through `CssManager.globals`.

Recommended entry:

```ts
const globals = CssManager.globals.invoke();
```

This returns the `GlobalCss.api(...)` surface wired to notify `CssManager` on change.

### GlobalCss API

`globals` (or `GlobalCss.api(...)`) exposes:

* `rule(ruleKey, selector)` returns a `GlobalRuleHandle`.
* `sel(selector)` returns a rule handle with a stable key `sel:<selector>`.
* `drop(ruleKey)` removes an entire rule.
* `clearAll()`, `has(ruleKey)`, `list()`, `get(ruleKey)`, `renderAll()`.
* `dispose()` unregisters the change listener (useful for tests).

`GlobalRuleHandle` is a `StyleSetter` plus:

* `ruleKey` and `selector`
* `drop()` to remove the rule

Rules are rendered with deterministic property ordering. Empty rules are dropped.

Automated rule teardown & cleanup is on the roadmap but not begun. 


---


## Pseudos in globals

`setMany` supports the same pseudo block keys as `StyleSetter` and will create sibling rules
like `selector:hover` or `selector::before`.

For `::before` and `::after`, `GlobalCss` will default to `content: ""` if it is not provided.

---

### StyleManager Differences

`LiveTree.style` uses the same `StyleSetter` surface but targets inline `style=""` on the element - `_attrs.style` on the HSON node.

Key differences from `LiveTree.css`:

* Inline only. Does not touch QUID-scoped rules or global rules.
* No pseudo blocks. `_hover` or `_before` maps in `style.setMany` are ignored.
* The `set` proxy is constrained by runtime keys. In browser runtimes it uses
  `document.documentElement.style` for the key list; in Node/tests it falls back to a small,
  fixed list.
* `style.get.*` reads from the serialized inline style attribute, not computed style.
  It will not reflect rules set through `CssManager` or `GlobalCss`.
