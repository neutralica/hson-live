# LiveMap API reference

LiveMap is one registry with one global revision and named data, document, and governed Parts Libraries. A registry with one library uses the same API as a registry with many. Import the `/livemap` ESM namespace for a lean browser bundle:

```ts
import { Hson } from "hson-live/hson";
import * as hsonLiveMap from "hson-live/livemap";

const StateSchema = Hson.schema`<type "data" content <count "number">>`;
const PageSchema = Hson.schema`<type "document" tag "main" content "empty">`;

const map = hsonLiveMap.fromLibraries({
  state: { data: { count: 0 }, schema: StateSchema },
  page: { document: "<main/>", schema: PageSchema },
});
```

`data` accepts a JSON value or JSON source string. `document` accepts authored Hson source text or a canonical Hson node, with optional textual `stylesheet`. `parts` accepts keyed Part definitions and forbids a supplemental `schema` or Library stylesheet; its data-object storage is intrinsically governed. Exactly one discriminator is required. Each library has a governing Hson Schema in the matching family. Omitting `schema` selects `ANY_DATA` or `ANY_DOCUMENT`; admission validates the initial state. Retained-session client replicas are established through `hsonLiveMap.echo.create(...)`.

Library configuration source and Schema values are selected once at public admission. Supported configuration getters are evaluated once; subsequent preparation uses that stable selection. A selected raw document graph is privately admitted before ownership, so later configuration or caller-graph changes cannot replace the admitted source. Configuration getters do not permit getters in HsonNode semantic storage.

Raw document nodes are observed through their own data-property descriptors before copying, owner projection, or identity preparation. Missing relationships, empty `$_attrs` or `$_meta` bags, present-undefined optional bags, sparse or decorated content arrays, inherited/accessor semantic fields, cycles, and invalid child roles reject; admission does not repair them. Raw data graphs used by internal library construction likewise require complete data values and physical II order matching their index metadata. JSON and Hson text inputs retain their representation-specific construction paths.

Document ownership accepts an empty ROOT and multiple ordered text/element items. A qualified source ELEM carrier is projected into the retained document ROOT using the existing owner convention. This does not make caller ROOT or bare branches portable Transform values. Runtime ordinary attributes retain string, finite number, boolean, and null values; raw nonfinite numbers, undefined, and object values reject. Existing raw and structured style storage remains distinct, including lawful empty style maps and typed leaf field presence.

Public raw document graphs and staged graph content cannot introduce generated QUID claims. Structural qualification does not confer identity authority: existing private owner, capture, epoch, overlay, and replay proofs remain required. Insert/replace requests qualify raw content in the resolved receiving role before candidate editing. Rejected requests and library additions leave retained state, revision, identity accounting, and observers unchanged. Accepted raw input is privately copied without freezing or mutating its caller.

Public staged graph instructions require own enumerable data fields, including their discriminants, targets, paths and content selections. Admission captures a private instruction and qualifies raw content before copying can discard malformed storage. Later changes to the caller instruction do not change its selected operation or receiver. Private replay and capture authority remain separate from this public boundary.

`hsonLiveMap.create()` creates a fully initialized map with no application libraries at revision 0. `hsonLiveMap.fromLibraries({})` has the same empty-registry semantics. An empty map can be captured, cut, and restored; family selector calls such as `map.doc(name)` return `undefined` until admission.

`ANY_DATA` and `ANY_DOCUMENT` are ordinary Hson Schemas for the full data and document families. They are exported from `hson-live` and `hson-live/hson`. The equivalent authored forms are `<type "data">` and `<type "document">`.

An empty document Library uses the existing graph-native initializer:

```ts
const map = hsonLiveMap.fromLibraries({
  page: {
    document: { $_tag: "_hson_root", $_content: [] },
    schema: Hson.schema`<type "document" content <repeat <tag "item" content "empty">>>`,
  },
});
```

The root stays addressable, item `[0]` is absent, and insertion can add the first item when its Schema permits it. Capture, restore, and replay carry this state structurally. `document: ""` rejects as invalid authored source. Empty runtime roots cannot produce a public `HsonDocument` or `HsonCanonical` string; selected empty-page rendering also rejects. An empty-capable document Schema governs runtime graph state independently of textual certification.

## Local runtime admission

```ts
const map = hsonLiveMap.create();
const admission = map.addLibraries({
  page: { document: Hson.document`<main "Hello"/>` },
  state: { data: { count: 0 }, schema: StateSchema },
});

const page = admission.libraries.page;
page.render();
const commit = admission.commit;
```

`map.addLibraries(definitions)` accepts one keyed batch synchronously and returns a `LiveMapLibraryAdmission<D>` receipt: `{ commit, libraries }`. `admission.commit` is the `LiveMapCommit`; `admission.libraries` contains typed handles for the newly admitted literal names. Each entry states exactly one of `data`, `document`, or `parts`. The whole batch is validated before installation. One accepted nonempty batch advances `map.rev` once and publishes one map commit containing a portable `library-add` operation with the ordered names, modes, Schemas, and roots. A failed batch leaves state, identity accounting, revision, and observers unchanged. `map.addLibraries({})` returns a receipt with an unchanged commit and publishes nothing. `fromLibraries(...)` uses the same input grammar but establishes initial state at revision 0.

A hosted Locus exposes `locus.admit(definitions)`, which returns `Promise<void>` and resolves without a receipt after governed admission. Locus requires a nonempty batch and has no `addLibraries` method. Select newly admitted hosted libraries through `locus.data`, `locus.doc`, or `locus.parts`, using callable lookup or `.must(...)` for runtime-added names.

Construction-time names keep their family evidence. Use `.data`, `.doc`, or `.parts` for both known and runtime-added names. Callable lookup returns `undefined` for absence, a wrong family, or a mismatched optional Schema argument. `.must(name, schema?)` requires a match; known safe names also support property access. Selectors and retained Library references stay valid across unrelated admissions. Function/Object property names use callable lookup; selectors are not enumerable Library inventories.

## Selection and reads

```ts
const state = map.data.must("state");
const page = map.doc.must("page");

state.snap();
state.at(["count"]).snap();
page.root();
page.at([]).snap();
```

`map.data.must(name)`, `map.doc.must(name)`, and `map.parts.must(name)` select the required family. Data paths use string object keys and numeric array indexes. Document paths use numeric positions in the canonical document. Reads return detached values or mediated location handles; they do not expose a mutable canonical node.

Data locations offer `set`, `replace`, `delete`, `update`, observation, and shape-specific object or array methods. An object handle's `.object` namespace can `setKey` or `setMany` to create Schema-permitted keys, `renameKey`, and delete keys. An array handle's `.array` namespace can insert, remove, move, and replace items. Optional or union-shaped locations require a runtime refinement such as `present()`, `asObject()`, or `asArray()` before shape-specific operations.

Data library roots may be objects, arrays, strings, finite numbers, booleans, or null. A string passed as `data` is parsed as JSON source text: use `data: '"hello"'` for a string value. Primitive roots expose scalar handles, with no object or array mutation capabilities. The root mode is fixed at construction; a whole-root mutation that changes its kind fails before commit.

Document libraries expose `document.content`, `document.attrs`, `document.flags`, `document.byQuid`, logical `at(path)` locations, `q(name)`, commits, and `render()`. Document identity is local to the runtime; portable addresses and requests use paths.

`page.q(name)` returns an identity-following `LiveMapDocumentQuadLocation`, or `undefined` for an unknown or retired authored QUAD. Lookup issues no identity and publishes nothing. Movement and valid replacement lineage retain the target; retirement, disposal, epoch replacement and changes to its owning hosted authority identity terminate the handle. Portable restoration requires fresh handles. Data Libraries have no `.q`; see the [document QUAD location contract](../contracts/document-q-location.md) for the exact lifetime and relative-path rules.

Every document library also owns a managed stylesheet. The root library handle exposes `page.css`; data libraries and `page.at(path)` locations do not. `page.css` is already document-wide, so it has no `.global`. It follows the global rule vocabulary: `sel`, `rule`, `scope`, `media`, `supports`, `layer`, `var`, `drop`, `clearAll`, `has`, `list`, `get`, `atProperty`, and `keyframes`. `stylesheet(cssText): void` parses a complete CSS stylesheet and replaces the managed stylesheet in one transition. Rule handles support `set`, `setProp`, `setMany`, `remove`, `clear`, and `drop`. `snapshot()` returns deterministic CSS text for inspection; cosmetic source formatting is not archived. Significant escape whitespace and component-value comments that protect token boundaries survive.

```ts
const page = map.doc.must("page");
page.css.sel("body").set.margin("0");
page.css.sel("#home-screen").set.display("grid");
const html = map.doc.must("page").render();
```

Each accepted CSS call is a map-wide semantic transition. No-op calls leave `map.rev` unchanged. Multi-declaration, registry batches, and stylesheet text ingress validate and commit atomically. `stylesheet()` returns `void`; empty or comment-only text clears the managed stylesheet if it is nonempty. Parsed rules receive stable `stylesheet:1`, `stylesheet:2`, and subsequent keys within each replacement, visible through `list()` and addressable through `get()` and `drop()`. This prefix is reserved from `rule(key, selector)` so author-named rules cannot collide. Duplicate selectors within one stylesheet remain separate ordered rules, and parsed declarations retain authored order, including shorthand/longhand order. `clearAll()` clears all managed CSS, including parsed rules, properties, and keyframes. Unsupported constructs such as `@import`, unknown at-rules, layer statements, duplicate declarations, CSS nesting, and CSS that cannot safely enter a managed HTML `<style>` produce a `DocumentStylesheetError` without a map transition. Raw stylesheet declarations use native CSS property identifiers: ASCII case and CSS escapes normalize without JavaScript camelCase conversion. For example, `CoLoR` and `c\6f lor` become `color`, while native `marginTop` stays the unknown native property `margintop`; it does not activate `margin-top`. Custom-property names remain case-sensitive. Structured setter keys retain their existing camelCase and alias convenience.

Keyframe steps sort by numeric position with stable ties: `from` equals `0%`, `to` equals `100%`, and equivalent percentage spellings retain authored precedence. Raw repeated exact selectors, comma-separated offsets and duplicate keyframe names still reject. Structured tuple authoring retains its last-write behavior for an exact repeated selector.

Parsed wrapper occurrences are nested entries in the portable stylesheet's `order`: `{ kind: "group", header, entries }`. Rules retain their full textual scope path for addressing, while the order tree determines occurrence membership. Equal anonymous headers never identify or merge occurrences. A rule update retains membership; dropping a member leaves the wrapper, including an empty layer, at its original position. Recreating a dropped rule appends its new scope occurrence. Clear and stylesheet replacement remove prior groups. Empty layer blocks are supported because they can establish layer order. Structured per-rule scope APIs keep their existing behavior; they do not create a shared group transaction.

Capture, replay, accepted hosted operations, checkpoints and SSR carry the complete order tree, declaration pairs and stable keyframe steps. Decoding validates membership and rejects malformed, cyclic or unsupported group records. Physical child CSS text is never line-indented inside wrappers; escaped-newline strings remain intact. Selector-generated keys use the preserved CSS selector spelling, including significant terminal escapes, throughout lookup and deletion. Portable arrays require dense undecorated own data elements, with no getters or source method overrides. Rendering follows structural occurrences directly; it does not infer grouping by joining equal scope strings. This is semantic stylesheet state, not original-source archival or legacy snapshot repair. Runtime subject selectors use local QUIDs; full captures translate them through portable correspondence and restoration rebinds them. Authenticated flat and scoped hosted effects carry subject correspondence through Echo replay and durable tails; raw portable subject CSS is not independent identity authority. See [CSS subject correspondence](../contracts/css-identity-translation.md) and [continuation](../document-continuation.md). Document definitions accept initial textual `stylesheet` in local and flat Locus admission. Structured `css` belongs only to whole Part members, alongside their separate textual `stylesheet`.

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

`capture()` returns a detached `LiveMapSnapshot` of the complete ordered registry at one revision for supported flat documents. Public local capture/cut and `locus.cut()` currently reject scoped Part documents; authorized `session.now()`, Echo, and durable checkpoints have a separate coordinated scoped path. It includes Schema sources and digests, exact encoded roots, and each document library's portable stylesheet record, including the explicit empty record. Data libraries have no CSS field. It omits generated QUIDs, identity epochs, and issued ledgers. `restore(snapshot)` requires the map's current library topology and rejects incompatible snapshots before mutation. `install_libraries_snapshot(snapshot)` creates a separate local map from a portable snapshot. On an unmanaged local map, `map.replay(commit)` applies one portable `library-add` or CSS commit at its recorded base revision. Public topology replay rejects on an Echo client-composed map; Echo applies projected topology through its internal managed path. The local snapshot shape changed in Phase A2; older pre-A2 development snapshots are not read.

Internal document capture retains runtime provenance for identity admission and observation. Public document libraries expose detached `root()` reads and rendering; transferable selections belong to the map.

## Local rendering and hosting

```ts
const html = map.doc.must("page").render();
const all = map.cut(); // { libs }, both application families
const dataOnly = map.cut({ documents: [] });
const documentOnly = map.cut({ data: [], documents: ["page"] });
const { html: ssrHtml, libs, document } = map.cut({ documents: ["page"], html: "page" });
const hosted = session.now({ html: "page" });
```

`map.doc.must("page").render()` returns `BrowserRealizationHtml` directly from that document root and stylesheet at one coherent position. It reads no unrelated library and reconstructs no map. Data libraries have no rendering capability. Browser realization preserves authored fragments and full document structure; a canonical document can still fail parser compatibility checks.

For an explicit `<html><head>...<body>...` document, nonempty `page.css` is realized as one marked `<style data-hson-managed-document-css="managed">` after authored head children. Authored `<style>` nodes remain document graph content and retain their source order. Empty managed CSS emits no derived style. Nonempty managed CSS on a fragment root is rejected, as is CSS containing parser-significant `</style` RAWTEXT or other nontransportable text. The managed style works on first contact without client JavaScript. Local and hosted cuts capture HTML and CSS from one semantic position. Continuation verifies and adopts the exact style element; Echo commits and recovery converge that same realization. The document Library remains the semantic CSS owner; `tree.css.global` reads its state. Hosted synchronous writes are fenced; hosted authoring uses `tree.async.css.global` or Locus document actions. Rules authored through `tree.css` remain runtime-local in a later separate style host. Projection expansion, contraction, replay, fallback, and durable restart carry or remove CSS with the owning document Library.

`map.cut({ data?, documents?, html? })` transfers selected application state for supported flat documents. The `data` selection includes governed Parts collections because they retain data-object storage; the local SSR text encoder currently rejects transfers selecting them. Scoped documents reject this public local cut, even though their document `render()` supports first paint. Omitted `data` or `documents` selects all application libraries of that family; `[]` selects none. Omitted `html` returns exactly `{ libs }`. Requested HTML returns exactly `{ libs, html, document }`, with the HTML derived from the transferred document root and CSS. The HTML document must already be selected under `documents`; it is never silently added. Unknown names, duplicates, wrong families, internal names, and invalid HTML membership are rejected.

Cut types reject known construction-time names in the wrong family and provably missing literal HTML membership. Runtime-added names and dynamic `string` selections use the same runtime admission checks without requiring a broader map type. A literal HTML name retains its literal result type.

`libs` is a self-contained `LiveMapSnapshot` with only the selected library contracts and roots, consistent registry and Schema digests, CSS, and one source revision. It contains no local HTML selection field or generated QUIDs. Canonical interaction storage follows the selected document set automatically: omitted-document descriptors are removed, an enabled source retains an empty slot when no documents are selected, and an absent source stays absent. Empty application selections are valid. `install_libraries_snapshot(libs)` reconstructs the selected topology in a fresh runtime. Snapshot consumers use the 64 MiB aggregate byte bound while retaining the depth-256 and 100,000-node limits; ordinary exact-value operations keep their own limits.

`session.now(...)` continues to produce an authorized hosted projection and HTML for one session.

Mirror binds a selected document library: `hsonMirror(map.doc.must("page"))`. Echo and Locus govern registry maps, including one-library maps. Each document library renders its own state; the map remains the aggregate authority.

## Public boundaries

The `hson-live/livemap` subpath exports independent ESM bindings for `create`, `fromLibraries`, `echo`, and `locus`, along with current LiveMap and library types, snapshot installation, and structured errors. `hsonLiveMap.echo.create(...)` establishes an endpoint or retained-session replica; `hsonLiveMap.locus.create(...)`, `.resume(...)`, and `.checkpoint(...)` govern authority. The root `hsonLiveMap` and `hson.liveMap` convenience values remain broader imports. No solo data or document constructor, solo bootstrap, or standalone document map type is available. Transform owns format parsing and HTML ingress; LiveTree owns browser tree operations; Locus owns hosted authority.

## Authored Part construction

Authored document Libraries consume `<hson-part lib="parts" at="member"/>` during
admission and ordinary connector graph insertion/replacement. Collections remain
inert data; the Library stores only realized canonical content. Connector QUADs
transfer to replacement roots, inline scalar inputs substitute `%{name}` values,
and each Part's CSS is scoped to and owned by its occurrence root. Removal retires
that owned CSS atomically. Capture, restore, rendering and graft consume realized
state without source collections. The exact parameter, CSS, source-retention and
hosted boundaries are in [the Part contract](../contracts/styled-part-composition.md).
