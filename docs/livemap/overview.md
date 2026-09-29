# LiveMap

LiveMap owns one revisioned registry of named canonical Hson libraries. The registry is the state machine, whether it contains one library or many. Each library is either data or document state and has a governing Hson Schema.

The registry may contain zero libraries. `hsonLiveMap.create()` and `hsonLiveMap.fromLibraries({})` create a complete empty runtime at revision 0. It supports capture, restore, and observers. Rendering requires a document library. `map.addLibraries(...)` admits local libraries later as one revisioned batch.

```ts
import { Hson, hsonLiveMap } from "hson-live";

const PageSchema = Hson.schema`<type "document" tag "main" content "empty">`;
const map = hsonLiveMap.fromLibraries({
  page: { document: "<main/>", schema: PageSchema },
});

const html = map.lib("page").render();
```

The one-library example is an ordinary registry. `map.lib("page")` selects its document library for canonical reads and writes. The map retains the global revision, commit stream, capture, restore, and selective cut operations.

## Ownership

```text
LiveMap registry
  ├── one global revision and commit stream
  ├── complete capture and restore
  ├── local HTML rendering
  └── named libraries
       ├── data: canonical values and typed paths
       └── document: canonical content, attributes, identity, and paths
```

All accepted writes pass through the registry's atomic validation and commit boundary. Each changed transition advances one global revision and names the affected library in its commit. A failure leaves the prior canonical state and revision intact. Schema validation applies at initial admission, mutation, replay, and reconstruction.

Library handles identify and access one selected root. They do not form separate authorities or renderers. A data library offers `snap()` and typed `at(path)` handles with scalar, object, and array operations. A document library offers canonical `root()`, logical `at(path)` locations, document content and attribute operations, QUID lookup, and document-specific observation.

Paths are portable coordinates: data paths contain object keys and array indexes; document paths contain numeric content indexes. Generated QUIDs are runtime-scoped continuity evidence. They are not durable application addresses. Public portable captures omit generated QUIDs and every portable admission surface rejects QUID claims from another runtime.

## Construction

`hsonLiveMap.fromLibraries({ name: { data, schema? } })` admits data from a JSON value or JSON source text. `hsonLiveMap.fromLibraries({ name: { document, schema? } })` admits document Hson source text or a canonical Hson node. `map.addLibraries(...)` accepts the same definition shape after construction. Omitting Schema uses `ANY_DATA` or `ANY_DOCUMENT`. The `data` or `document` field remains explicit.

Data roots may be objects, arrays, strings, numbers, booleans, or null. For a string root, pass JSON source text such as `data: '"hello"'`. `ANY_DATA` and `ANY_DOCUMENT` are reusable broad Schemas for the complete valid data and document families.

On an unmanaged local map, a library admitted with an implicit or explicit
family-top Schema can later be tightened once:

```ts
map.lib("page").schema.use(PageSchema);
```

The current complete root validates before the contract changes. A successful
attachment is one map revision and portable commit; canonical equality is an
unchanged no-op. The installed specific Schema is fixed thereafter. Managed
Locus authorities and projected Echo maps reject this direct operation in the
current local-only phase.

```ts
const StateSchema = Hson.schema`<type "data" content <count "number">>`;
const PageSchema = Hson.schema`<type "document" tag "main" content "empty">`;

const map = hsonLiveMap.fromLibraries({
  state: { data: { count: 0 }, schema: StateSchema },
  page: { document: "<main/>", schema: PageSchema },
});

map.lib("state").at(["count"]).set(1);
map.lib("page").document.attrs.set({ kind: "path", path: [0] }, "title", "Ready");
```

The data boundary accepts finite numbers, strings, booleans, null, ordinary objects, and dense arrays. It rejects unsupported prototypes, accessors, symbol or nonenumerable properties, holes, explicit undefined, and cycles. Canonical state preserves object-entry order and SameValue number distinctions, including `-0`. Public composite reads are detached.

Document state is a canonical Hson graph with ordered content, tags, attributes, and local identity. Its Schema declares the admitted document shape. Transform is the owner of format conversion, including trusted or untrusted HTML parsing before document admission.

## Mutation and observation

The selected data library exposes handles via `at(path)`. A handle can read, watch, or feed its endpoint and can apply the operations valid for its current shape. `set` is strict at an existing endpoint; `replace` changes an entire endpoint; object `setKey` and `setMany` can create Schema-permitted members. Array moves preserve order and, where applicable, local identity. Optional or union endpoints require presence or shape refinement before shape-specific methods.

Document libraries expose `document.content`, `document.attrs`, `document.flags`, and logical document locations. Mutations use path request targets and are validated before publication. Mirror can bind a selected document library and follow its accepted commits into LiveTree and browser state.

`map.commits.observe(listener)` observes map-wide accepted transitions. Each transition carries one global revision and named library operations. Reads, no-ops, and failed writes do not publish a changed commit. A selected document library also has a document commit observer for document consumers. Listener failures are isolated after acceptance, every listener still receives a fair attempt, and failures are sent to the platform uncaught-error reporter (`reportError`, with an asynchronous uncaught fallback on older runtimes).

## Capture and rendering

`map.capture()` returns a detached complete `LiveMapSnapshot` of the registry, Schemas, and encoded roots at one revision. `map.restore(snapshot)` validates a compatible full registry before replacement. `install_libraries_snapshot(snapshot)` creates a fresh local runtime from a portable capture. The snapshot is QUID-free; a new runtime establishes its own identity epoch and issued ledger.

`map.lib("page").render()` returns browser-compatible HTML for that document and its managed CSS. It preserves authored structure and fragments without synthesizing a shell, and reads no unrelated libraries.

`map.cut({ data?, documents?, html? })` transfers coherent selected state in `libs`. Omitted families select all application libraries; `[]` selects none. No HTML selection returns `{ libs }`; naming a selected document returns `{ libs, html, document }` from the same detached state. The subset registry includes its Schemas, digests, roots, CSS and source revision. Internal interactions follow selected documents automatically. Local continuation reconstructs the subset with `install_libraries_snapshot(libs)`. Hosted projection belongs to Locus: `locus.cut(sessionId, document?)` returns authorized projected state and HTML, and hosted continuation uses Echo's governed replica.

## Other layers

- **Hson and Transform** define canonical values, Schemas, format conversion, and HTML ingress.
- **LiveTree** manages browser tree operations and renderer-facing handles.
- **Mirror** reflects a selected document library into LiveTree.
- **Locus** manages hosted ordering, authorization, sessions, persistence, and recovery for a registry map.
- **Echo** receives and applies an authorized projection on a client registry.

LiveMap itself remains usable entirely within one process or browser. Hosting does not change the registry model; a hosted one-library map is still one named library in the same state machine.

See [the API reference](./api-livemap.md), [registry details](./multi-library.md), [Schema guidance](./schema.md), and [capture and recovery](./capture-replay.md).
