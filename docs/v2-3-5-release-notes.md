# 2.4.0 Release Notes

## Internal architecture and LiveTree stability release.

This release reorganizes the internal source tree around the intended `core`, `transform`, and `livetree` ownership boundaries while preserving the documented package export surface. It also collects recent LiveTree, SVG, and raw-node shape changes from the current development stretch.

### Package surface

- Bumped package version to `2.4.0`.
- Kept the primary public exports:
  - `hson-live`
  - `hson-live/hson`
  - `hson-live/diagnostics`
  - `hson-live/types`
- Renamed the internal test export:
  - from `hson-live/_tests`
  - to `hson-live/diagnostics/test-exports`

### Internal architecture

- Reorganized internal source ownership around:
  - `src/core` for HSON protocol primitives, node/value guards, constants, factories, invariants, native tag support, and shared protocol types.
  - `src/api/transform` for parsing, serialization, the constructor pipeline, tokenization, attr/style/string processing, and HTML/HSON/JSON conversion utilities.
  - `src/api/livetree` for LiveTree creation, mounted node behavior, managers, QUID handling, DOM-facing methods, and live tree utilities.
- Moved transform parsers and serializers under `src/api/transform`.
- Moved transform-owned utility folders under `src/api/transform/utils`.
- Moved LiveTree-owned creation, QUID, DOM/node utilities, and live tree behavior under `src/api/livetree`.
- Removed obsolete internal shim paths and dead constructor remnants.
- Moved the native HTML tag list into core protocol support.

### HsonNode internal shape

Raw HSON node fields now use dollar-prefixed internal names:

```ts
node.$_tag
node.$_content
node.$_attrs
node.$_meta
```

These replace the older internal field names:

```ts
node._tag
node._content
node._attrs
node._meta
```

### System tag values

Internal VSN tag values now use the `_hson_*` namespace:

```ts
node.$_tag === "_hson_elem" // new
```

This replaces the older `_-*` system tag spellings, such as:
```ts
node._tag === "_-elem" // old
```

Together, the raw-node field migration and VSN tag-name migration are the largest internal compatibility changes in this release. Code using public LiveTree or transform APIs should generally not need changes, but code touching raw HSON nodes directly will need to update both field access and system tag comparisons.

### `content.markup`

Added graph-backed markup serialization on `tree.content.markup`:

```ts
tree.content.markup.innerHTML
tree.content.markup.outerHTML
```

This is distinct from DOM-backed markup:

```ts
tree.content.markup.innerHTML // graph-backed; works detached
tree.dom.innerHTML            // DOM-backed; mounted only
```

This supports detached graph mutation and clone serialization.

### `content.deep()`

Added graph-backed descendant traversal:

```ts
tree.content.all()   // direct/effective children
tree.content.deep()  // all effective descendants, excluding self
```

`content.deep()` is the LiveTree-native equivalent of descendant element traversal. It skips primitive leaves and structural VSN wrappers and returns `TreeSelector`.

### `find.asSvg`

Added SVG narrowing on the find surface:

```ts
tree.find.asSvg.byId("svg-root")       // SvgLiveTree | undefined
tree.find.must.asSvg.byId("svg-root")  // SvgLiveTree
```

This avoids cast-heavy SVG lookup patterns around SVG helpers and create APIs.

### `cloneBranch()` type preservation

Improved `cloneBranch()` type preservation, especially for SVG LiveTrees:

```ts
const svg = tree.find.must.asSvg.byId("svg-root");
const clone = svg.cloneBranch(); // SvgLiveTree
```

### SVG create and bbox stabilization

Recent SVG work stabilized `SvgLiveTree` usability, SVG create helpers, and mounted-only bbox semantics:

```ts
svg.svg.bbox()
svg.svg.must.bbox()
```

### DOM/document helper surface

Document hit-testing and tree conversion helpers are now part of the exercised LiveTree surface:

```ts
tree.dom.doc.elementsFromPoint(...)
tree.dom.doc.treeAtPoint(...)
tree.dom.doc.treesFromPoint(...)
```

### Listener surface

Window pointer tooling now uses the LiveTree listener surface:

```ts
tree.listen.window.passive().onPointerMove(...)
```

### Verification

- `npm run check` passes.
- `npm run build` passes.
- LiveDemo tests pass: **1022 / 1022**.

### Notes

This release is not intended to change normal public API behavior, but the internal source layout, raw-node field names, and internal VSN tag names changed substantially. Deep/internal imports and direct raw-node access should be treated as unstable.