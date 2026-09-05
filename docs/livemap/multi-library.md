# Multi-library LiveMap

`hsonLiveMap.fromLibraries(...)` creates one LiveMap authority with a fixed, statically named set of Libraries. It is intentionally distinct from `fromJson`, `fromHson`, and `fromNode`, so ordinary object-shaped application data is never mistaken for a registry. The same map can remain local or attach directly to the ordinary Locus path.

```ts
const map = hsonLiveMap.fromLibraries({
  state: { data: { count: 0 }, schema: StateSchema },
  colors: { data: { primary: "blue" }, schema: ColorsSchema },
  page: { document: "<main/>", schema: PageSchema },
});

map.lib("colors").at(["primary"]).set("green");
```

Each entry has exactly one ingress field:

- `data` accepts the existing `fromJson` material: a JSON value or JSON source text.
- `document` accepts existing `fromHson`/`fromNode` material: Hson source text or a canonical Hson node.

Every Library requires `schema`. Initial material is validated during construction. The Hson Schema generator augments the schema declaration with its generated `SchemaType`, so a generated `ColorsSchema` automatically supplies the selected data and Handle types; callers do not pass a duplicate type parameter.

`map.lib(name)` accepts only the literal names in the static registry. A selected data Library has `root()`, `snap()`, `at(path)`, and `schema.get()`. Its Handle paths are relative to that Library, so nested Handle operations never repeat the library name. A selected document Library retains its normal document, capture, and schema APIs. `hsonReflect(map.lib("page"))` binds one named document Library and stays attached across unrelated global revisions and recovery replacement.

Multi-library mutations return `LiveMapMultiLibraryCommit`. It holds one map-wide `prevRev`/`rev` transition and one ordered `operations` array. Every operation is `{ library, operation }`; the library name is public and the engine's opaque library identity is never exposed. A hosted Locus retains that same one global revision and ordered commit stream.

There is no default Library on a multi-map, no public topology lifecycle (`add`, `remove`, `replace`, or `rename`), and no solo-to-multi migration/export API in this release. QUID allocation remains map-wide within the underlying authority: a raw QUID routes to its owning document Library, and identities cannot be transferred between Libraries. `root` and `snap` are selected-Library operations; no aggregate multi-map capture format is exposed.

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

For a client, create the same fixed topology with `fromLibraries(...)`, then use the normal `hsonEcho.create({ map, socket, recovery })` entry. This is the same public Echo family used for a solo map; library count does not create a different client type. Connect the transport, explicitly establish a semantic session, then explicitly recover. Bootstrap and snapshot recovery replace that one mirror in place, so selected Handles and a named-document Reflect binding remain valid. Recovery uses one global cursor and selects current, retained replay, or an aggregate replacement snapshot plus tail. Observe replica changes through LiveMap commit observation; Echo has no library-qualified subscription surface.

Actions use the same retry-safe client request identity, action status, authorization evidence, and resumable session semantics as a solo Locus. A Library name is target evidence within the validated payload; it does not scope sessions, dedupe records, status, ordering, or revision authority. Application actions and named document actions enter one FIFO and complete against the aggregate revision.

`create_persistent_locus({ map, logicalMapId, persistence })` supports the same fixed registry. Calling that same ordinary constructor after a restart with the same `logicalMapId` reconstructs persisted state before the Locus is exposed. Its persistence adapter stores opaque authoritative records; checkpointing and restart reconstruction preserve the map-wide issued-QUID ledger, including retired identities, so ABA reuse remains rejected.

Static topology is the hosted contract: dynamic Library lifecycle, a default Library, cross-Library QUID transfer, and solo-to-multi in-place migration are intentionally unsupported. One Echo reproduces the exact authoritative registry—names, order, modes, Schemas, identity, and one global revision. Local-only state belongs in a separate local LiveMap. A named document Library may be bound through Reflect; supported LiveTree authoring becomes visible only after Locus acceptance and aggregate Echo replay.
