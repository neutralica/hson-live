# LiveMap registries

`hsonLiveMap.fromLibraries(...)` creates one standalone LiveMap with initial named libraries at revision 0. A one-library LiveMap uses the same API. Local code may admit more libraries later with `map.addLibraries(...)`.

```ts
const map = hsonLiveMap.fromLibraries({
  state: { data: { count: 0 }, schema: StateSchema },
  colors: { data: { primary: "blue" }, schema: ColorsSchema },
  page: { document: "<main/>", schema: PageSchema },
});

map.data.must("colors").at(["primary"]).set("green");
map.data.must("state").at([]).object.setKey("count", 1);
```

Each entry has exactly one family discriminator:

- `data` accepts a JSON value or JSON source text.
- `document` accepts authored Hson source text or a canonical Hson node, with optional textual `stylesheet`.
- `parts` accepts keyed Part definitions governed intrinsically; it forbids a supplemental `schema` and a Library-level `stylesheet`.

`schema` may be omitted. A data library then uses `ANY_DATA`; a document library uses `ANY_DOCUMENT`. Initial material is validated during construction or runtime admission. An explicit Schema retains its generated type evidence, so `JsonFromSchema<typeof ColorsSchema>` supplies the selected data and handle types; callers do not pass a duplicate type parameter.

An unmanaged local family-top library may be tightened later with
`map.data.must("name").schema.use(Schema)` or `map.doc.must("name").schema.use(Schema)`. The complete existing root is validated
before installation. One real attachment advances the map once and emits one
portable `library-schema-use` operation; the same canonical Schema is a no-op,
and a different specific contract cannot replace the installed contract.
Direct calls are deliberately fenced on Locus-managed and projected client
maps until hosted authority support is added.

The `map.data`, `map.doc`, and `map.parts` selectors preserve construction-time family evidence. `map.doc(name)` returns `undefined` for absence or a wrong family; `map.doc.must(name)` requires a match. An optional second Schema argument checks the installed Schema digest. Safe known names also support property access; use callable lookup for Function/Object names such as `must` or `constructor`. Runtime admission leaves the existing map and selectors intact. A selected data Library has `root()`, `snap()`,
`at(path)`, and `schema.get()`; a selected document Library has document-wide
observation/identity operations plus logical `at(path)` locations. No second
`.data` or `.document` selection is required. Handle paths are relative to that
Library, so nested operations never repeat the library name.

For generated Schema evidence, `library.at(path)` derives its capability set
from the existing path-value resolver. Object operations (`setKey`, `setMany`,
`renameKey`, and related reads) live under `.object`; array operations (`push`,
`splice`, `insert`, `move`, and related reads) live under `.array`. Endpoint
`set`, `replace`, and `delete` remain on the handle. Optional, union-shaped, broad, or ungoverned endpoints use
`present()`, `asObject()`, `asArray()`, or `asScalar()`. Runtime-refined
capabilities re-check the current occupant on every operation, so a retained
array refinement cannot mutate an endpoint that has since become an object.

Document element locations expose `attrs`, `flags`, insertion, and movement;
text/content locations do not expose those element-only capabilities.
`hsonMirror(map.doc.must("page"))` binds one named document Library and stays
attached across unrelated global revisions and reconcile replacement.

A `LiveMapCommit` holds one map-wide `prevRev`/`rev` transition and one ordered `operations` array. Ordinary content/CSS entries are `{ library, operation }`; topology and Schema entries use their tagged shapes. The library name is public and the engine's opaque library identity is never exposed.

Local `map.addLibraries(definitions)` synchronously returns a `LiveMapLibraryAdmission<D>` receipt: `{ commit, libraries }`. For a nonempty batch, `receipt.commit` is one `LiveMapCommit` containing one `library-add` operation and advancing revision once. `receipt.libraries` carries typed handles for the admitted literal names. An empty local batch returns a receipt with an unchanged commit and no admitted handles, and publishes nothing.

A hosted Locus retains one global revision and complete authority commit history as its registry grows. Echo receives one ordered client stream in which a revision has either a graph commit or generic progress without a graph effect.

An ordinary selected write installs immediately and synchronously. To describe several writes as one map transition, use `map.batch(callback)`:

```ts
const commit = map.batch(map => {
  map.data.must("state").at(["count"]).set(1);
  map.data.must("colors").at(["primary"]).replace("green");
});
```

The callback is synchronous and its setters return `void`; the outer call returns one `LiveMapCommit`. The writes are ordered, final affected Library candidates are Schema-validated, and failure installs none of them. Reads through `map` during the callback see the installed state. Batch handles expire when the callback exits. Nested batches and direct writes on the same map during a batch are rejected. `batch` is callback-only; ordinary `map.data.must(name).at(path).set(value)` remains the single-write form. `set` keeps its selected graph meaning in both contexts, including its shallow object patch behavior; `replace` remains exact replacement.

There is no default Library on a multi-map and no public removal, replacement, or rename operation. `map.addLibraries(...)` changes local topology. A hosted Locus exposes `locus.admit(definitions)`, returning `Promise<void>` through its durable gate and ownership policy; awaiting it yields no receipt. Locus requires a nonempty batch and has no `addLibraries` method. After admission, select hosted libraries through `locus.data`, `locus.doc`, or `locus.parts`, using callable lookup or `.must(...)` for runtime-added names. QUID allocation remains map-wide within the underlying authority, but raw QUIDs do not route mutation requests across Libraries and identities cannot be transferred between Libraries. `root` and `snap` are selected-Library operations.

`map.capture()` synchronously returns one detached `LiveMapSnapshot`.
For supported flat documents it contains the complete ordered registry, QUID-free public and hidden roots,
exact Schema sources and digests, root codecs, registry digest, and one global
revision. It contains no generated identity epoch or issued-QUID ledger.
Later source mutation cannot change the snapshot. `install_libraries_snapshot`
validates every Library before publishing anything and installs the complete cut
into a fresh local runtime/capability domain. The receiving map owns fresh
generated identity and does not inherit source QUID claims or issued history.

Public local `capture()`/`cut()` currently reject scoped Part documents.
Document `render()` supports scoped first paint, while authorized `session.now()`,
Echo synchronization and durable checkpoints support scoped transfer/recovery.
The local SSR text encoder rejects a selected governed Parts collection.

## Hosted use

Locus constructs its managed authoritative map from private and shared definitions. Local initializers remain outside that map.

```ts
const locus = hsonLiveMap.locus.create({
  state: { data: { count: 0 }, schema: StateSchema, access: "shared" },
  colors: { data: { primary: "blue" }, schema: ColorsSchema, access: "shared" },
}, {
  authorizeProjection: () => ({ libraries: ["state", "colors"] }),
  actions: {
    async "theme.all"(context) {
      context.stage.data.must("state").at(["count"]).set(1);
      context.stage.data.must("colors").at(["primary"]).set("green");
    },
  },
});
```

An action handler may await application work, then use `context.stage` for synchronous writes into that action's one candidate. The action returns before authority preparation, durable admission where configured, installation, and publication. Each Library keeps its own HsonSchema; initial state, server action preparation, client replay, reconciliation, and durable restart validate those Schemas.

Outside an action, use the callable `locus.stage` for authoritative writes:

```ts
await locus.data.must("state").at(["count"]).set(1);

await locus.stage(loc => {
  loc.data.must("state").at(["count"]).set(2);
  loc.data.must("colors").at(["primary"]).set("blue");
});
```

A direct terminal setter returns `Promise<void>` for one authority transition. The grouped callback stages synchronously, and its outer call returns `Promise<void>` after the same authority admission path. Stage callbacks must be synchronous; await external work before entering one. Nested or direct stages invoked during an active stage callback are rejected. Locus owns reads, cuts, rendering, and commit observation directly; its subordinate LiveMap remains private.

Staged scopes are write-oriented. They offer selected `set`, `replace`, and `delete`, bounded document location/content/attribute operations, portable document graph operations, stylesheet operations, and canonical interaction helpers. They support candidate-relative `.object` / `.array` commands and supported shape refinements, but expose no candidate snapshots, watches, or `update` callback. Reads through Locus family selectors during authoring see committed state, not earlier staged writes. Stage handles expire when the callback exits.

For a client, `await hsonLiveMap.echo.create({ now, credential, transport })` admits the
authorized current session composition and returns an attached, caught-up
replica. `now.libs` contains the visible shared authority registry and its
contracts; `now.local` contains authorized local initializers. Excluded
authority Library names and state remain unavailable. An action-only session
with no projected application Libraries uses endpoint-only Echo without a LiveMap.

Echo owns the composed replica. `echo.rev` counts changes to that composed
state in this client runtime. `echo.sync.appliedRev` is the latest contiguous
authority revision it processed. A progress-only authority revision advances
that cursor without a composed-state commit, `echo.rev` change, value
observation, or Mirror work. Local writes advance only `echo.rev`.

Connection loss does not destroy the replica map or its bound Mirror resources.
After reconnecting transport, awaiting `echo.session.reattach()` synchronizes
the replica. Live projection expansion and contraction update authority-owned
libraries in that same map. Retained replay installs missed topology before
later writes; reconcile synchronizes the current authorized shared authority
projection in place. Authorized local initializers are installed only when the
named local instance is absent; later local state is client-owned and survives
shared synchronization. `hsonLiveMap.echo.create(...)` has no receiving-runtime local
library input. Echo has no public dynamic local-topology admission API in this
pass. Authorized local initializers can arrive in later session grants and
install into an already-running Echo.

Actions use the same retry-safe client request identity, action status, authorization evidence, and resumable session semantics for a one-library registry Locus. A Library name is target evidence within the validated payload; it does not scope sessions, dedupe records, status, ordering, or revision authority. Application actions and named document actions enter one FIFO and complete against the aggregate revision.

`await hsonLiveMap.locus.resume(definitions, { local, logicalMapId, persistence })` restores an existing durable authority or establishes the declared initial authority durably. Source definitions govern original libraries and local initializers. Durable Locus state supplies ownership for libraries added at runtime, so the deployment does not redeclare them. The new process starts a fresh generated-QUID runtime epoch. Issued-QUID nonreuse is enforced within each living epoch. `hsonLiveMap.locus.checkpoint(locus)` compacts durable state when needed; accepted commits restore without a manual checkpoint.

Hosted authority topology grows through explicit `await locus.admit(definitions)` admissions; authorized projection changes update client-visible topology. The current local initializer catalog comes from Locus construction and may be granted later. Public Library removal, replacement, and rename remain unsupported, as do a default Library and cross-Library QUID transfer. Locus and Echo each own local generated QUID identity, so equal subjects may have different QUIDs. A projected named document Library may be bound through Mirror; supported hosted LiveTree authoring becomes visible only after Locus acceptance and aggregate Echo replay.
