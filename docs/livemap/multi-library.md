# Multi-library LiveMap

`hsonLiveMap.fromLibraries(...)` creates one LiveMap authority with a fixed, statically named set of Libraries. It is intentionally distinct from `fromJson`, `fromHson`, and `fromNode`, so ordinary object-shaped application data is never mistaken for a registry. The same map can remain local or attach directly to the ordinary Locus path.

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

- `data` accepts the existing `fromJson` material: a JSON value or JSON source text.
- `document` accepts existing `fromHson`/`fromNode` material: Hson source text or a canonical Hson node.

Every Library requires `schema`. Initial material is validated during construction. The Hson Schema generator augments each Schema declaration with private evidence, so `SchemaType<typeof ColorsSchema>` supplies the selected data and handle types; callers do not pass a duplicate type parameter.

`map.lib(name)` accepts only the literal names in the static registry and is the
semantic narrowing boundary. A selected data Library has `root()`, `snap()`,
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
attached across unrelated global revisions and recovery replacement.

Multi-library mutations return `LiveMapMultiLibraryCommit`. It holds one map-wide `prevRev`/`rev` transition and one ordered `operations` array. Every operation is `{ library, operation }`; the library name is public and the engine's opaque library identity is never exposed. A hosted Locus retains one global revision and complete authority commit history. Echo receives one ordered client stream in which a revision has either a graph commit or generic progress without a graph effect.

There is no default Library on a multi-map, no public topology lifecycle (`add`, `remove`, `replace`, or `rename`), and no solo-to-multi migration/export API in this release. QUID allocation remains map-wide within the underlying authority, but raw QUIDs do not route mutation requests across Libraries and identities cannot be transferred between Libraries. `root` and `snap` are selected-Library operations.

`map.capture()` synchronously returns one detached `LiveMapLibrariesSnapshot`.
It contains the complete ordered registry, public and hidden roots, exact Schema
sources and digests, root codecs, registry digest, one global revision, numeric
identity epoch, and the complete issued-QUID ledger including retired QUIDs.
Later source mutation cannot change the snapshot. `install_libraries_snapshot`
validates every Library before publishing anything and installs the complete cut
into a fresh local runtime/capability domain. It preserves durable aggregate
identity history without inventing logical hosted identity or transport state.

## Hosted use

Attach the map through the normal Locus API. No hosted-specific map constructor or transaction DSL is required.

```ts
const locus = hsonLocus.create({
  map,
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

One `context.mutate(...)` call stages all selected-Library writes as one atomic action. Each Library keeps its own HsonSchema; initial state, server action preparation, client replay, recovery, and durable restart validate those Schemas.

For a client, create the same fixed topology with `fromLibraries(...)`, then use the normal `hsonEcho.create({ map, socket, recovery })` entry. This is the same public Echo family used for a solo map; library count does not create a different client type. Connect the transport, explicitly establish a semantic session, then explicitly recover. Bootstrap and snapshot recovery replace that one replica in place, so selected Handles and a named-document Mirror binding remain valid. Recovery uses one global cursor and selects current, retained replay, or an aggregate replacement snapshot plus tail. Observe replica graph changes through LiveMap commit observation; progress-only authority advancement updates `map.rev` and internal ordering without publishing an application commit. Echo has no library-qualified subscription surface.

Actions use the same retry-safe client request identity, action status, authorization evidence, and resumable session semantics as a solo Locus. A Library name is target evidence within the validated payload; it does not scope sessions, dedupe records, status, ordering, or revision authority. Application actions and named document actions enter one FIFO and complete against the aggregate revision.

`create_persistent_locus({ map, logicalMapId, persistence })` supports the same fixed registry. Calling that same ordinary constructor after a restart with the same `logicalMapId` reconstructs persisted state before the Locus is exposed. Its persistence adapter stores opaque authoritative records; checkpointing and restart reconstruction preserve the map-wide issued-QUID ledger, including retired identities, so ABA reuse remains rejected.

Static topology is the hosted contract: dynamic Library lifecycle, a default Library, cross-Library QUID transfer, and solo-to-multi in-place migration are intentionally unsupported. One Echo reproduces the authoritative application registry—names, order, modes, Schemas, and one global revision. Locus and Echo each own local generated QUID identity, so equal subjects may have different QUIDs. Local-only application state belongs in a separate local LiveMap. A named document Library may be bound through Mirror; supported LiveTree authoring becomes visible only after Locus acceptance and aggregate Echo replay.
