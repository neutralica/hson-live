# LiveMap registries

`hsonLiveMap.fromLibraries(...)` creates one standalone LiveMap with initial named libraries at revision 0. A one-library LiveMap uses the same API. Local code may admit more libraries later with `map.addLibraries(...)`.

```ts
const map = hsonLiveMap.fromLibraries({
  state: { data: { count: 0 }, schema: StateSchema },
  colors: { data: { primary: "blue" }, schema: ColorsSchema },
  page: { document: "<main/>", schema: PageSchema },
});

map.lib("colors").at(["primary"]).set("green");
map.lib("state").at([]).setKey("ready", true);
```

Each entry has exactly one ingress field:

- `data` accepts a JSON value or JSON source text.
- `document` accepts Hson source text or a canonical Hson node.

`schema` may be omitted. A data library then uses `ANY_DATA`; a document library uses `ANY_DOCUMENT`. Initial material is validated during construction or runtime admission. An explicit Schema retains its generated type evidence, so `SchemaType<typeof ColorsSchema>` supplies the selected data and handle types; callers do not pass a duplicate type parameter.

An unmanaged local family-top library may be tightened later with
`map.lib("name").schema.use(Schema)`. The complete existing root is validated
before installation. One real attachment advances the map once and emits one
portable `library-schema-use` operation; the same canonical Schema is a no-op,
and a different specific contract cannot replace the installed contract.
Direct calls are deliberately fenced on Locus-managed and projected client
maps until hosted authority support is added.

`map.lib(name)` preserves precise typing for construction-time names. Runtime-added names use a dynamic data/document facade and are checked against the living registry. Its document CSS capability is guarded by the selected library's actual mode. Other kind-specific operations require a `mode` check. A selected data Library has `root()`, `snap()`,
`at(path)`, and `schema.get()`; a selected document Library has document-wide
observation/identity operations plus logical `at(path)` locations. No second
`.data` or `.document` selection is required. Handle paths are relative to that
Library, so nested operations never repeat the library name.

For generated Schema evidence, `library.at(path)` derives its capability set
from the existing path-value resolver. Object operations (`setKey`, `setMany`,
`renameKey`, and related reads), array operations (`push`, `splice`, `insert`,
`move`, and related reads), and scalar replacement appear directly on the
appropriate handle. Optional, union-shaped, broad, or ungoverned endpoints use
`present()`, `asObject()`, `asArray()`, or `asScalar()`. Runtime-refined
capabilities re-check the current occupant on every operation, so a retained
array refinement cannot mutate an endpoint that has since become an object.

Document element locations expose `attrs`, `flags`, insertion, and movement;
text/content locations do not expose those element-only capabilities.
`hsonMirror(map.lib("page"))` binds one named document Library and stays
attached across unrelated global revisions and reconcile replacement.

Multi-library mutations return `LiveMapCommit`. It holds one map-wide `prevRev`/`rev` transition and one ordered `operations` array. Every operation is `{ library, operation }`; the library name is public and the engine's opaque library identity is never exposed. A local `addLibraries(...)` batch contributes one `library-add` operation with ordered definitions and advances revision once. A hosted Locus retains one global revision and complete authority commit history as its registry grows. Echo receives one ordered client stream in which a revision has either a graph commit or generic progress without a graph effect.

An ordinary selected write installs immediately and synchronously. To describe several writes as one map transition, use `map.batch(callback)`:

```ts
const commit = map.batch(batch => {
  batch.lib("state").at(["count"]).set(1);
  batch.lib("colors").at(["primary"]).replace("green");
});
```

The callback is synchronous and its setters return `void`; the outer call returns one `LiveMapCommit`. The writes are ordered, final affected Library candidates are Schema-validated, and failure installs none of them. Reads through `map` during the callback see the installed state. Batch handles expire when the callback exits. Nested batches and direct writes on the same map during a batch are rejected. `batch` is callback-only; ordinary `map.lib(...).at(...).set(...)` remains the single-write form. `set` keeps its selected graph meaning in both contexts, including its shallow object patch behavior; `replace` remains exact replacement.

There is no default Library on a multi-map and no public removal, replacement, or rename operation. `map.addLibraries(...)` changes local topology; `locus.lib.add(...)` admits hosted authority topology through its durable gate and ownership policy. QUID allocation remains map-wide within the underlying authority, but raw QUIDs do not route mutation requests across Libraries and identities cannot be transferred between Libraries. `root` and `snap` are selected-Library operations.

`map.capture()` synchronously returns one detached `LiveMapSnapshot`.
It contains the complete ordered registry, QUID-free public and hidden roots,
exact Schema sources and digests, root codecs, registry digest, and one global
revision. It contains no generated identity epoch or issued-QUID ledger.
Later source mutation cannot change the snapshot. `install_libraries_snapshot`
validates every Library before publishing anything and installs the complete cut
into a fresh local runtime/capability domain. The receiving map owns fresh
generated identity and does not inherit source QUID claims or issued history.

## Hosted use

Advanced composition can supply an existing map through the same Locus constructor. Ordinary Locus construction supplies definitions in its catalog and lets Locus create the map.

```ts
const locus = hsonLocus.create({
  map,
  libraries: [
    { name: "state", ownership: "shared" },
    { name: "colors", ownership: "shared" },
  ],
  authorizeProjection: () => ({ libraries: ["state", "colors"] }),
  actions: {
    async "theme.all"(context) {
      context.stage.lib("state").at(["count"]).set(1);
      context.stage.lib("colors").at(["primary"]).set("green");
    },
  },
});
```

An action handler may await application work, then use `context.stage` for synchronous writes into that action's one candidate. The action returns before authority preparation, durable admission where configured, installation, and publication. Each Library keeps its own HsonSchema; initial state, server action preparation, client replay, reconciliation, and durable restart validate those Schemas.

Outside an action, use the callable `locus.stage` for authoritative writes:

```ts
await locus.stage.lib("state").at(["count"]).set(1);

await locus.stage(stage => {
  stage.lib("state").at(["count"]).set(2);
  stage.lib("colors").at(["primary"]).set("blue");
});
```

A direct terminal setter returns `Promise<void>` for one authority transition. The grouped callback stages synchronously, and its outer call returns `Promise<void>` after the same authority admission path. Stage callbacks must be synchronous; await external work before entering one. Nested or direct stages invoked during an active stage callback are rejected. `locus.map` remains the actual managed LiveMap for reads, cuts, rendering, and observers; its direct mutation routes, including `map.batch`, are fenced while Locus owns it.

Staged scopes are write-oriented. They offer selected `set`, `replace`, and `delete`, bounded document location/content/attribute operations, portable document graph operations, stylesheet operations, and canonical interaction helpers. They do not expose candidate-backed reads, `update`, or read-dependent shape helpers. Reads through `map` or `locus.map` during authoring see committed state, not earlier staged writes. Stage handles expire when the callback exits.

For a client, `await hsonEcho.create({ now, credential, transport })` admits the
authorized current session composition and returns an attached, caught-up
replica. `now.libs` contains the visible shared authority registry and its
contracts; `now.local` contains authorized local initializers. Excluded
authority Library names and state remain unavailable. An action-only session
with no projected application Libraries uses endpoint-only Echo without a LiveMap.

Echo manages the authority-projected Libraries. Direct public mutation of
projected Libraries remains gated. `map.rev` counts accepted graph transitions
in this client runtime. Echo separately tracks the highest contiguous authority
revision as its synchronization and completion cursor. An authority progress event
advances that cursor without a graph commit, `map.rev` change, value
observation, or Mirror work.

Connection loss does not destroy the replica map or its bound Mirror resources.
After reconnecting transport, awaiting `echo.session.reattach()` synchronizes
the replica. Live projection expansion and contraction update authority-owned
libraries in that same map. Retained replay installs missed topology before
later writes; reconcile synchronizes the current authorized shared authority
projection in place. Authorized local initializers are installed only when the
named local instance is absent; later local state is client-owned and survives
shared synchronization. `hsonEcho.create(...)` has no receiving-runtime local
library input.

Actions use the same retry-safe client request identity, action status, authorization evidence, and resumable session semantics for a one-library registry Locus. A Library name is target evidence within the validated payload; it does not scope sessions, dedupe records, status, ordering, or revision authority. Application actions and named document actions enter one FIFO and complete against the aggregate revision.

`await hsonLocus.create({ libraries, logicalMapId, persistence })` supports a growing authority registry. Calling that same ordinary constructor after a restart with the same `logicalMapId` reconstructs persisted application and authority state before the Locus is used. The deployment must supply the ownership catalog for every restored authority library because hosted policy and local initializer definitions are not persisted. The new process starts a fresh generated-QUID runtime epoch. Issued-QUID nonreuse is enforced within each living epoch.

Hosted authority topology grows through explicit `locus.lib.add(...)` admissions; authorized projection changes update client-visible topology. Public Library removal, replacement, and rename remain unsupported, as do a default Library and cross-Library QUID transfer. Locus and Echo each own local generated QUID identity, so equal subjects may have different QUIDs. A projected named document Library may be bound through Mirror; supported hosted LiveTree authoring becomes visible only after Locus acceptance and aggregate Echo replay.
