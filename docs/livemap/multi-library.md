# LiveMap registries

`hsonLiveMap.fromLibraries(...)` creates one LiveMap authority with a fixed, statically named set of libraries. A one-library LiveMap uses the same API. The same map can remain local or attach to Locus.

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

There is no default Library on a multi-map, no public topology lifecycle (`add`, `remove`, `replace`, or `rename`), and no alternate hosted solo topology. QUID allocation remains map-wide within the underlying authority, but raw QUIDs do not route mutation requests across Libraries and identities cannot be transferred between Libraries. `root` and `snap` are selected-Library operations.

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
  exposure: [
    { library: "state", exposure: "client-public" },
    { library: "colors", exposure: "client-public" },
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

One `context.mutate(...)` call stages all selected-Library writes as one atomic action. Each Library keeps its own HsonSchema; initial state, server action preparation, client replay, recovery, and durable restart validate those Schemas.

For a client, `fromClientSnapshot({ authority, localLibraries })` composes the visible authority registry with client application declarations into one fixed LiveMap. Each local declaration uses the same `data` or `document` and `schema` fields as `fromLibraries`. A name already present in the visible authority registry is rejected. Client-local declarations are outside the authority projection and its digest. They cannot reveal excluded authority Library names or state. An action-only session with no projected or local Libraries uses endpoint-only Echo without a LiveMap.

Pass the composed map to the normal `hsonEcho.create({ map, socket, recovery })` entry. Echo manages authority-projected Libraries only. Ordinary code may mutate client-local Libraries, including documents used by Mirror, without a Locus request. Direct public mutation of projected Libraries remains gated. One transaction cannot write both ownership classes, and automatic write links cannot cross them. `map.rev` counts accepted graph transitions in this client runtime. Echo separately tracks the highest contiguous authority revision as its recovery and completion cursor. An authority progress event advances that cursor without a graph commit, `map.rev` change, value observation, or Mirror work. Authority effects and local mutations each produce local graph transitions, so the two revision numbers need not match.

Connect the transport, establish a semantic session, then recover. Connection loss does not destroy the composed map: client-local roots, handles, and Mirror resources remain usable while disconnected and through compatible session reattachment. Retained authority replay applies incrementally. Snapshot fallback replaces only projected roots, retires unproven projected subject identity, and preserves local roots and their runtime identity in the same map epoch. A different projection topology needs a new composed map. Client-local state currently lasts for the browser runtime; reload or runtime death initializes it again from application declarations.

Actions use the same retry-safe client request identity, action status, authorization evidence, and resumable session semantics for a one-library registry Locus. A Library name is target evidence within the validated payload; it does not scope sessions, dedupe records, status, ordering, or revision authority. Application actions and named document actions enter one FIFO and complete against the aggregate revision.

`create_persistent_locus({ map, logicalMapId, persistence })` supports the same fixed registry. Calling that same ordinary constructor after a restart with the same `logicalMapId` reconstructs persisted application and authority state before the Locus is exposed. The new process starts a fresh generated-QUID runtime epoch. Issued-QUID nonreuse is enforced within each living epoch.

Static topology is the hosted contract: dynamic Library lifecycle, a default Library, and cross-Library QUID transfer are intentionally unsupported. Locus and Echo each own local generated QUID identity, so equal subjects may have different QUIDs. A projected named document Library may be bound through Mirror; supported hosted LiveTree authoring becomes visible only after Locus acceptance and aggregate Echo replay. A client-local document Mirror responds directly to local transitions.
