# LiveMap API reference

LiveMap is one registry with one global revision and named data and document libraries. A registry with one library uses the same API as a registry with many. `hsonLiveMap` and `hson.liveMap` are the same DOM-free construction facade.

```ts
import { Hson, hsonLiveMap } from "hson-live";

const StateSchema = Hson.schema`<type "data" content <count "number">>`;
const PageSchema = Hson.schema`<type "document" tag "main" content "empty">`;

const map = hsonLiveMap.fromLibraries({
  state: { data: { count: 0 }, schema: StateSchema },
  page: { document: "<main/>", schema: PageSchema },
});
```

`data` accepts a JSON value or JSON source string. `document` accepts Hson source text or a canonical Hson node. Each library has a governing Hson Schema in the matching family. Omitting `schema` selects `ANY_DATA` or `ANY_DOCUMENT`; admission validates the initial state. The public facade also provides `fromClientSnapshot(...)` for a client composition with an authority projection.

`hsonLiveMap.create()` creates a fully initialized map with no application libraries at revision 0. `hsonLiveMap.fromLibraries({})` has the same empty-registry semantics. An empty map can be captured and restored; `lib(name)` reports an unknown library and `render()` reports that no document is available until admission.

`ANY_DATA` and `ANY_DOCUMENT` are ordinary Hson Schemas for the full data and document families. They are exported from `hson-live` and `hson-live/hson`. The equivalent authored forms are `<type "data">` and `<type "document">`.

## Local runtime admission

```ts
const map = hsonLiveMap.create();
const commit = map.lib.add({
  page: { document: Hson.document`<main "Hello"/>` },
  state: { data: { count: 0 }, schema: StateSchema },
});

map.render("page");
```

`lib.add(definitions: LiveMapDefinitions): LiveMapCommit` accepts one keyed batch. Each entry must state `data` or `document`; there is no inferred kind. The whole batch is validated before installation. One accepted batch advances `map.rev` once and publishes one map commit containing a portable `library-add` operation with the ordered names, modes, Schemas, and roots. A failed batch leaves state, identity accounting, revision, and observers unchanged. `lib.add({})` returns an unchanged commit and publishes nothing. `fromLibraries(...)` uses the same input grammar but establishes initial state at revision 0.

Known construction-time names keep their precise selected types. A name learned at runtime selects a safe data/document handle union; inspect `mode` before kind-specific operations. Unknown names fail at runtime.

## Selection and reads

```ts
const state = map.lib("state");
const page = map.lib("page");

state.snap();
state.at(["count"]).snap();
page.root();
page.at([]).snap();
```

`lib(name)` selects a library. Data paths use string object keys and numeric array indexes. Document paths use numeric positions in the canonical document. Reads return detached values or mediated location handles; they do not expose a mutable canonical node.

Data locations offer `set`, `replace`, `delete`, `update`, observation, and shape-specific object or array methods. An object handle can `setKey` or `setMany` to create Schema-permitted keys, `renameKey`, and delete keys. An array handle can insert, remove, move, and replace items. Optional or union-shaped locations require a runtime refinement such as `present()`, `asObject()`, or `asArray()` before shape-specific operations.

Data library roots may be objects, arrays, strings, finite numbers, booleans, or null. A string passed as `data` is parsed as JSON source text: use `data: '"hello"'` for a string value. Primitive roots expose scalar handles, with no object or array mutation capabilities. The root mode is fixed at construction; a whole-root mutation that changes its kind fails before commit.

Document libraries expose `document.content`, `document.attrs`, `document.flags`, `document.byQuid`, logical `at(path)` locations, commits, and document capture. Document identity is local to the runtime; portable addresses and requests use paths.

```ts
state.at(["count"]).set(1);
page.document.attrs.set({ kind: "path", path: [0] }, "title", "Ready");
```

Accepted mutations advance `map.rev` once and publish one map-wide commit with named library operations. Failed mutations leave canonical state and revision unchanged. `map.commits.observe(listener)` observes accepted registry commits. Selected document libraries also expose document commit observations for Mirror and local document consumers.

## Capture and restore

```ts
const snapshot = map.capture();
map.restore(snapshot);
```

`capture()` returns a detached `LiveMapSnapshot` of the complete ordered registry at one revision. It includes Schema sources and digests and exact encoded roots. It omits generated QUIDs, identity epochs, and issued ledgers. `restore(snapshot)` validates and replaces the complete local topology, including restoring an earlier topology; removed or replaced library handles become stale. `install_libraries_snapshot(snapshot)` creates a separate local map from a portable snapshot. `map.replay(commit)` applies one portable local `library-add` commit at its recorded base revision.

The selected document library's `capture()` supports local document-specific identity categories. It is a library observation, not a separate LiveMap authority. The map-wide snapshot is the portable registry reconstruction surface.

## Local rendering and hosting

```ts
const html = map.render("page");
const { html: ssrHtml, bootstrap } = render_document({ map, document: "page" });
const hosted = locus.cut(sessionId, "page");
```

`map.render(document?)` returns browser-realization HTML directly. It infers the name only when the registry contains exactly one document library. A missing document or an ambiguous selection fails clearly. A data library cannot be rendered as a document.

`render_document(...)` composes coherent local HTML and a continuation bootstrap from one state cut. `locus.cut(...)` produces an authorized hosted projection and HTML for one session. Local LiveMap has no `cut()` method.

Mirror binds a selected document library: `hsonMirror(map.lib("page"))`. Echo and Locus govern registry maps, including one-library maps. Libraries are not independent renderers or authorities.

## Public boundaries

The `hson-live/livemap` subpath exports the registry construction facade, current LiveMap and library types, snapshot installation, and structured errors. No solo data or document constructor, solo bootstrap, or standalone document map type is available. Transform owns format parsing and HTML ingress; LiveTree owns browser tree operations; Locus owns hosted authority.
