# Local multi-library LiveMap

`hsonLiveMap.fromLibraries(...)` creates one local LiveMap authority with a fixed, statically named set of Libraries. It is intentionally distinct from `fromJson`, `fromHson`, and `fromNode`, so ordinary object-shaped application data is never mistaken for a registry.

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

`map.lib(name)` accepts only the literal names in the static registry. A selected data Library has `root()`, `snap()`, `at(path)`, and `schema.get()`. Its Handle paths are relative to that Library, so nested Handle operations never repeat the library name. A selected document Library currently exposes `mode`, `root()`, and `schema.get()` only. Its document mutation/controller facade remains a solo-only capability for now.

Multi-library mutations return `LiveMapMultiLibraryCommit`. It holds one map-wide `prevRev`/`rev` transition and one ordered `operations` array. Every operation is `{ library, operation }`; the library name is public and the engine's opaque library identity is never exposed. The type already represents a future atomic operation sequence across several Libraries, although this slice does not add a public cross-library transaction API.

There is no default Library on a multi-map, no public topology lifecycle (`add`, `remove`, `replace`, or `rename`), and no solo-to-multi migration/export API in this release. QUID allocation remains map-wide within the underlying authority. `root` and `snap` are selected-Library operations; no aggregate multi-map capture format is exposed.

Multi-library maps are local-only. Current Locus/hosted attachment rejects them before it claims management with a clear unsupported error. Existing solo LiveMap and single-library Locus behavior are unchanged.
