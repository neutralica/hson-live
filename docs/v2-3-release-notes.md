
## 2.3.0

### LiveTree API

+ Added native `.form` namespace for form/input helpers.
+ Replaced older direct form methods:
 • removed `setFormValue(...)`
 • removed `getFormValue()`
+ New form surface includes:
 • `form.setValue(...)`
 • `form.getValue()`
 • `form.getChecked()`
 • `form.setChecked(...)`
 • `form.getSelected()`
 • `form.setSelected(...)`
+ Form helpers now cover:
 • text/value-style form controls
 • checkbox/radio checked state
 • single select values
 • multi-select values
+ Form API follows the current LiveTree namespace pattern and returns the owning tree for chainable setters.
+ Added tests for form value, checked, and selected behavior.

### Data API

+ Refactored dataset/data handling away from a special manager-style class shape.
+ Data handling now behaves more like `id`, `classlist`, `attr`, and `flag`: a small attribute-backed helper surface.
+ `data-*` handling is now treated as an attribute wrapper rather than an independent node-graph abstraction.
+ Removed unnecessary type pressure around `DataTreeLike` / special tree constraints.
+ Improved compatibility between HTML and SVG-flavored LiveTree surfaces.
+ Dataset operations now route through the same underlying attribute implementation used elsewhere.

### LiveTree API typing / interface organization

+ Consolidated LiveTree public API surfaces into smaller interface groups.
+ Reduced duplicated declarations for shared node/identity/attribute/style surfaces.
+ Added/transferred JSDoc onto public LiveTree interface members.
+ Clarified internal vs public surfaces in the slimmed LiveTree class.
+ Standardized getter-backed namespaces such as:
 • `attr`
 • `flag`
 • `id`
 • `classlist`
 • `text`
 • `form`
 • `data`
 • `svg`
 • `canvas`
+ Added `make_text_api(...)`-style wrapper for text operations, bringing text in line with other namespace APIs.

### SVG API

+ Added/clarified `.svg` namespace helpers.
+ SVG helpers include:
 • `svg.inScope()`
 • `svg.viewBox.get/set/clear`
 • `svg.preserveAspectRatio.get/set/none/clear`
 • `svg.d.get/set/clear`
 • `svg.fill.get/set/none/clear`
 • `svg.stroke.get/set/clear`
 • `svg.strokeWidth.get/set/clear`
 • `svg.vectorEffect.get/set/nonScalingStroke/clear`
 • `svg.bbox()`
 • `svg.must.bbox(...)`
+ Preserved SVG attribute casing where required, including `viewBox` and `preserveAspectRatio`.
+ Kept SVG attribute helpers intentionally thin over `attr`.

### Canvas API

+ Added first native LiveTree canvas support.
+ `create.canvas()` now returns a canvas-scoped LiveTree surface.
+ Added `.canvas` namespace for canvas-specific access and helpers.
+ Canvas helpers include:
 • `canvas.inScope()`
 • `canvas.el()`
 • `canvas.ctx2d(...)`
 • `canvas.must.el(...)`
 • `canvas.must.ctx2d(...)`
+ Added backing bitmap helpers:
 • `canvas.width.get/set/clear`
 • `canvas.height.get/set/clear`
 • `canvas.size.get/set/clear`
+ Added display/layout helpers:
 • `canvas.display.size(...)`
 • `canvas.display.match(...)`
+ `canvas.display.match(...)` synchronizes the backing bitmap size to the mounted display size, with DPR support and optional 2D context scaling.
+ Added canvas clearing helpers:
 • `canvas.clear()`
 • `canvas.clear(x, y, w, h)`
+ Added native drawing bridge:
 • `canvas.plot((ctx, cvs) => { ... })`
 • `canvas.must.plot((ctx, cvs) => { ... })`
+ `canvas.plot(...)` is a safe no-op bridge when no mounted canvas/context is available.
+ `canvas.must.plot(...)` throws when a canvas/context is required but unavailable.
+ Canvas API intentionally avoids a drawing DSL; LiveTree provides safe access, sizing, chaining, and lifecycle-friendly bridges into native canvas methods.
+ [LiveDemo] Added canvas tests covering:
 • canvas scope detection
 • canvas creation
 • element/context access
 • width/height helpers
 • size helpers
 • display sizing
 • DPR-aware display matching
 • full and rectangular clear
 • safe `plot`
 • strict `must.plot`
 • non-canvas/no-mount boundaries

### CSS / styling

+ Expanded `css.setMany(...)` to support nested rule blocks.
+ `setMany(...)` now accepts selector keys inside CSS maps, allowing scoped child/descendant/pseudo-selector rules to be declared inline with the base style map.

```ts
tree.css.setMany({
  color: "blue",

  _hover: {
    color: "green",

    "> .info": {
      color: "gold",
    },
  },

  "> .badge": {
    color: "red",
  },
});
```


### Breaking changes

+ `setFormValue(...)` and `getFormValue()` were removed in favor of the `.form` namespace.
+ Code using old direct form helpers should migrate to:
 • `tree.form.setValue(...)`
 • `tree.form.getValue()`
+ Data API internals were refactored; public data behavior should remain attribute-backed and chainable, but type-level references to the old `DataManager` shape may need updating.
+ Canvas and SVG scoped tree helper typings were expanded; code depending on exact structural `LiveTree` type equivalence may need minor type updates.

### Tests (LiveDemo)

+ Expanded LiveTree test coverage significantly.
+ Added form namespace tests.
+ Added canvas namespace tests.
+ Added additional canvas stress/boundary fixtures.
+ Added generated JSON transform/fuzz fixtures.
+ Legacy and new LiveTree test suites were kept passing after API changes.
+ Current suite status during development included all known LiveTree and transform tests passing.


---