# LiveMap registries

`hsonLiveMap.fromLibraries(...)` creates one LiveMap authority with initial named libraries at revision 0. A one-library LiveMap uses the same API. Local code may admit more libraries later with `map.addLibraries(...)`.

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

Attach the map through the normal Locus API. No hosted-specific map constructor or transaction DSL is required.

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
      await context.mutate((draft) => {
        draft.lib("state").at(["count"]).set(1);
        draft.lib("colors").at(["primary"]).set("green");
      });
    },
  },
});
```

One `context.mutate(...)` call stages all selected-Library writes as one atomic action. Each Library keeps its own HsonSchema; initial state, server action preparation, client replay, reconciliation, and durable restart validate those Schemas.

For a client, `await hsonEcho.init({ now, credential, transport })` admits the
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
shared synchronization. `hsonEcho.init(...)` has no receiving-runtime local
library input.

Actions use the same retry-safe client request identity, action status, authorization evidence, and resumable session semantics for a one-library registry Locus. A Library name is target evidence within the validated payload; it does not scope sessions, dedupe records, status, ordering, or revision authority. Application actions and named document actions enter one FIFO and complete against the aggregate revision.

`create_persistent_locus({ map, logicalMapId, persistence })` supports a growing authority registry. Calling that same ordinary constructor after a restart with the same `logicalMapId` reconstructs persisted application and authority state before the Locus is used. The deployment must supply the ownership catalog for every restored authority library because hosted policy and local initializer definitions are not persisted. The new process starts a fresh generated-QUID runtime epoch. Issued-QUID nonreuse is enforced within each living epoch.

Hosted authority topology grows through explicit `locus.lib.add(...)` admissions; authorized projection changes update client-visible topology. Public Library removal, replacement, and rename remain unsupported, as do a default Library and cross-Library QUID transfer. Locus and Echo each own local generated QUID identity, so equal subjects may have different QUIDs. A projected named document Library may be bound through Mirror; supported hosted LiveTree authoring becomes visible only after Locus acceptance and aggregate Echo replay.
