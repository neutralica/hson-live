# LiveMap API reference

LiveMap is one registry with one global revision and named data, document, and governed Parts Libraries. A registry with one library uses the same API as a registry with many. Import the `/livemap` ESM namespace for a lean browser bundle:

```ts
import { Hson } from "hson-live/hson";
import * as hsonLiveMap from "hson-live/livemap";

const StateSchema = Hson.schema`<type "data" content <count "number">>`;
const PageSchema = Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" content "empty">]>>]>>`;

const map = hsonLiveMap.fromLibraries({
  state: { data: { count: 0 }, schema: StateSchema },
  page: { document: "<main/>", schema: PageSchema },
});
```

`data` accepts a JSON value or JSON source string. `document` accepts authored Hson source text or a canonical Hson node, with optional textual `stylesheet`. `parts` accepts keyed Part definitions and forbids a supplemental `schema` or Library stylesheet; its data-object storage is intrinsically governed. Exactly one discriminator is required. Each library has a governing Hson Schema in the matching family. Omitting `schema` selects `ANY_DATA` or `ANY_DOCUMENT`; admission validates the initial state. Retained-session client replicas are established through `hsonLiveMap.echo.create(...)`.

Library configuration source and Schema values are selected once at public admission. Supported configuration getters are evaluated once; subsequent preparation uses that stable selection. A selected raw document graph is privately admitted before ownership, so later configuration or caller-graph changes cannot replace the admitted source. Configuration getters do not permit getters in HsonNode semantic storage.

Raw document nodes are observed through their own data-property descriptors before copying, owner projection, or identity preparation. Missing relationships, empty `$_attrs` or `$_meta` bags, present-undefined optional bags, sparse or decorated content arrays, inherited/accessor semantic fields, cycles, and invalid child roles reject; admission does not repair them. Raw data graphs used by internal library construction likewise require complete data values and physical II order matching their index metadata. JSON and Hson text inputs retain their representation-specific construction paths.

Runtime ordinary attributes retain string, finite number, boolean, and null values; raw nonfinite numbers, undefined, and object values reject. Existing raw and structured style storage remains distinct, including lawful empty style maps and typed leaf field presence.

Public raw document graphs and staged graph content cannot introduce generated QUID claims. Structural qualification does not confer identity authority: existing private owner, capture, epoch, overlay, and replay proofs remain required. Insert/replace requests qualify raw content in the resolved receiving role before candidate editing. Rejected requests and library additions leave retained state, revision, identity accounting, and observers unchanged. Accepted raw input is privately copied without freezing or mutating its caller.

Public staged graph instructions require own enumerable data fields, including their discriminants, targets, paths and content selections. Admission captures a private instruction and qualifies raw content before copying can discard malformed storage. Later changes to the caller instruction do not change its selected operation or receiver. Private replay and capture authority remain separate from this public boundary.

`hsonLiveMap.create()` creates a fully initialized map with no application libraries at revision 0. `hsonLiveMap.fromLibraries({})` has the same empty-registry semantics. An empty map can be captured, cut, and restored; family selector calls such as `map.doc(name)` return `undefined` until admission.

`ANY_DATA` and `ANY_DOCUMENT` are ordinary Hson Schemas for the full data and document families. They are exported from `hson-live` and `hson-live/hson`. The equivalent authored forms are `<type "data">` and `<type "document">`.

## Complete governed Documents

Every admitted Document Library retains one complete `html` page with one `head`
and one `body`. Authored admission expands Parts, requires one resulting ordinary
element, and conservatively completes the page before governing Schema validation.
For example, `<main/>` becomes `<html <head/> <body <main/>/>/>`; a `head` or `body`
root is retained in its corresponding position. An authored `html` root receives
missing structure only when placement is unambiguous. Empty, text-only, multiple-root,
duplicate-structure, ambiguous, and browser-incompatible candidates reject before
publication. `ANY_DOCUMENT` does not bypass these Library requirements.

Logical document paths start at the completed `html`: `[]` selects `html`, `[0]`
selects `head`, `[1]` selects `body`, and `[1, 0]` selects `main` in the example.
Low-level `document.*` path targets traverse physical graph carriers instead:
that same `main` is at `[0, 0, 1, 0, 0]`.

Final mutation candidates must remain complete and browser-compatible. Authored
whole-root replacement uses completion; exact snapshot installation, restore,
and replay validate canonical state without completing historical fragment roots.
An empty registry remains valid; an empty Document Library does not.

Detached canonical Documents may contain text or multiple roots. Part definitions
and structural Document arguments also remain detached until composed into their
receiving context. Their admission or Schema certification does not establish a
complete governed page. See [detached Document representations](../transform/api-transform.md#authored-source-and-canonical-document).

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

Individual Library names and governed Part member names cannot contain `/`. Ordinary Data keys, document content, and path values may contain `/`. Part selectors accept separate `lib="components" at="panel"` or qualified `at="components/panel"`; see [Part coordinates](../contracts/styled-part-composition.md).

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

Data library roots may be objects, arrays, strings, finite numbers, booleans, or null. A string passed as `data` is literal string Data: use `data: "hello"`. Other supported JavaScript values and authenticated `HsonDataValue` carriers use exact admission. JSON or Hson source requires explicit `Hson.data.fromSource(source)`. Primitive roots expose scalar handles, with no object or array mutation capabilities. The root mode is fixed at construction; a whole-root mutation that changes its kind fails before commit.

Document libraries expose `document.content`, `document.attrs`, `document.flags`, `document.byQuid`, logical `at(path)` locations, `q(name)`, commits, and `render()`. Document identity is local to the runtime; portable addresses and requests use paths.

`page.q(name)` returns an identity-following `LiveMapDocumentQuadLocation`, or `undefined` for an unknown or retired authored QUAD. Lookup issues no identity and publishes nothing. Movement and valid replacement lineage retain the target; retirement, disposal, epoch replacement and changes to its owning hosted authority identity terminate the handle. Portable restoration requires fresh handles. Part selections support `page.q("nav")?.q("buttonOne")` with independent child disposal. Direct bindings take precedence; otherwise only unnamed occurrence boundaries are transparent, and ambiguous matches return `undefined`. Element bindings supply no child namespace. Relative `.at()` retains the anchor’s namespace. Data Libraries have no `.q`; see the [document QUAD location contract](../contracts/document-q-location.md) for the exact lifetime and relative-path rules.

Document definitions accept `stylesheet?: string | CssMap` at construction and dynamic admission. Strings remain opaque CSS source. Structured maps use the established CssMap grammar: root declarations and relative selectors target `:root`, and `@:name` targets resolve through the receiving Document's authored QUAD namespace. Normalization, selector/media validation, target resolution, and complete Document qualification precede publication. Declaration order, typed units, custom properties, pseudos, and undefined-deletion behavior are retained. Part occurrence scoping is unchanged.

Local Locus seeds accept structured root/relative and `@:name` styles and preserve outer stylesheet override precedence. Initializers carry required authored QUAD/path evidence (`quads`, empty when absent), covered by their fingerprint and validated against the complete graph. Existing scoped Part records remain separate occurrence namespaces. Both initial and later receiving installation allocate fresh runtime identity; old initializer records lacking correspondence evidence reject.

Every document library also owns a managed stylesheet. The root library handle exposes `page.css`; data libraries and `page.at(path)` locations do not. `page.css` is already document-wide, so it has no `.global`. It follows the global rule vocabulary: `sel`, `rule`, `scope`, `media`, `supports`, `layer`, `var`, `drop`, `clearAll`, `has`, `list`, `get`, `atProperty`, and `keyframes`. `stylesheet(cssText): void` replaces the managed stylesheet with one opaque text contribution. Rule handles support `set`, `setProp`, `setMany`, `remove`, `clear`, and `drop`. `snapshot()` returns retained CSS text for inspection. Raw stylesheet text preserves its source formatting; structured declarations use deterministic CSS projection.

```ts
const page = map.doc.must("page");
page.css.sel("body").set.margin("0");
page.css.sel("#home-screen").set.display("grid");
const html = map.doc.must("page").render();
```

Changed CSS transitions advance the map revision once; no-ops leave it unchanged.
Raw `stylesheet()` text is not parsed, normalized, or split into addressable rules.
Empty and comment-only strings remain text contributions; `clearAll()` removes all
managed contributions. Raw CSS has no extracted rule keys, declarations, keyframes,
or interpreted subject identities. CSS syntax, imports, nesting, and duplicate
declarations remain browser concerns. The complete page still rejects text that
cannot survive HTML style transport, including parser-significant `</style` RAWTEXT.

Structured rules, groups, properties, and keyframes retain their own validation,
addressing, ordering, and portable subject-correspondence contracts. Capture,
replay, checkpoints, and SSR retain both structured records and exact raw text.
See [the CSS reference](../livetree/api-css-manager.md#managed-stylesheet-ownership)
and [CSS subject correspondence](../contracts/css-identity-translation.md).

Direct local `page.css` writes currently reject on scoped Part Documents. Use the
staged writer for those local changes:

```ts
map.batch(writer => {
  writer.doc.must("page").css.stylesheet("body { margin: 0; }");
});
```

Hosted changes use the Locus document authority or `tree.async.css.global`.
Document definitions accept initial textual `stylesheet`; structured `css` is an
authoring field of whole Part members. See [Part CSS](../contracts/styled-part-composition.md#occurrence-css)
for the distinction between selector scoping and contribution ownership.

```ts
state.at(["count"]).set(1);
page.document.attrs.set({ kind: "path", path: [0, 0, 1, 0, 0] }, "title", "Ready"); // main
```

Changed accepted mutations advance `map.rev` once and publish one map-wide commit with named library operations. Failed mutations leave canonical state and revision unchanged. `map.commits.observe(listener)` observes accepted registry commits. Selected document libraries also expose document commit observations for Mirror and local document consumers.

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

`map.doc.must("page").render()` returns `BrowserRealizationHtml` directly from that document root and stylesheet at one coherent position. It reads no unrelated library and reconstructs no map. Data libraries have no rendering capability. It renders the complete page already validated at admission and at each accepted transition; it does not complete a fragment at render time.

Managed CSS renders as ordered `<style data-hson-managed-document-css="managed">`
carriers after authored head children. There may be multiple carriers; an empty raw
text contribution produces an empty carrier, while no contributions produce none.
Authored `<style>` nodes remain graph content. Cuts capture HTML and CSS at one
semantic position. [Continuation](../document-continuation.md) verifies the exact
carrier sequence and text, and adopts the existing page. The document Library
remains the semantic CSS owner; `tree.css.global` reads that state. Hosted synchronous
writes are fenced. Rules authored through `tree.css` remain runtime-local in a
separate style host.

`map.cut({ data?, documents?, html? })` transfers selected application state for supported flat documents. The `data` selection includes governed Parts collections because they retain data-object storage; the local SSR text encoder currently rejects transfers selecting them. Scoped documents reject this public local cut, even though their document `render()` supports first paint. Omitted `data` or `documents` selects all application libraries of that family; `[]` selects none. Omitted `html` returns exactly `{ libs }`. Requested HTML returns exactly `{ libs, html, document }`, with the HTML derived from the transferred document root and CSS. The HTML document must already be selected under `documents`; it is never silently added. Unknown names, duplicates, wrong families, internal names, and invalid HTML membership are rejected.

Cut types reject known construction-time names in the wrong family and provably missing literal HTML membership. Runtime-added names and dynamic `string` selections use the same runtime admission checks without requiring a broader map type. A literal HTML name retains its literal result type.

`libs` is a self-contained `LiveMapSnapshot` with only the selected library contracts and roots, consistent registry and Schema digests, CSS, and one source revision. It contains no local HTML selection field or generated QUIDs. The reserved interaction Library travels with every cut. Its Descriptors are filtered to the selected Documents, and its root is empty when the cut selects no Documents. Empty application selections are valid. `install_libraries_snapshot(libs)` reconstructs the selected topology in a fresh runtime. Snapshot consumers use the 64 MiB aggregate byte bound while retaining the depth-256 and 100,000-node limits; ordinary exact-value operations keep their own limits.

`session.now(...)` continues to produce an authorized hosted projection and HTML for one session.

Mirror binds a selected document library: `hsonMirror(map.doc.must("page"))`. Echo and Locus govern registry maps, including one-library maps. Each document library renders its own state; the map remains the aggregate authority.

## Public boundaries

The `hson-live/livemap` subpath exports independent ESM bindings for `create`, `fromLibraries`, `echo`, and `locus`, along with current LiveMap and library types, snapshot installation, and structured errors. `hsonLiveMap.echo.create(...)` establishes an endpoint or retained-session replica; `hsonLiveMap.locus.create(...)`, `.resume(...)`, and `.checkpoint(...)` govern authority. The root `hsonLiveMap` and `hson.liveMap` convenience values remain broader imports. No solo data or document constructor, solo bootstrap, or standalone document map type is available. Transform owns format parsing and HTML ingress; LiveTree owns browser tree operations; Locus owns hosted authority.

## Authored Part construction

An admitted Part name is permanently bound to its complete definition for the
lifetime of its authoritative owner. Parts Libraries may admit new, distinct
names atomically; existing members and their nested values cannot be replaced,
edited, renamed, deleted, or cleared. Equal replacement and batches that restore
the original final value also reject. Data and Document Libraries retain their
ordinary editing behavior. Snapshot/checkpoint restoration preserves the admitted
baseline, and durable resume rejects conflicting deployment definitions.

Authored document Libraries consume `<hson-part lib="parts" at="member"/>` during
admission and ordinary connector graph insertion/replacement. Collections remain
inert data; the Library stores only realized canonical content. Connector QUADs
transfer to replacement roots, inline scalar inputs substitute `%{name}` values,
and each Part's CSS contribution is owned by its occurrence root. Structured CSS is
selector-scoped; raw stylesheet text is opaque and unscoped. Removal retires owned
contributions atomically. Capture, restore, rendering and graft consume realized
state without source collections. The exact parameter, CSS, source-retention and
hosted boundaries are in [the Part contract](../contracts/styled-part-composition.md).
