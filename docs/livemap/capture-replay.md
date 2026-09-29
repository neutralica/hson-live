# LiveMap capture, restore, and recovery

The public portable capture is a complete registry snapshot. One-library registries use the same format as larger registries.

```ts
const snapshot = map.capture();
map.restore(snapshot);

const { map: separateRuntime } = install_libraries_snapshot(snapshot);
```

`LiveMapSnapshot` has format `"hson-livemap-libraries-snapshot"`, one global `revision`, an ordered registry with Schema sources and digests, a registry digest, and exact encoded roots for every library. Capture detaches its content from later mutation. It omits generated QUIDs, local identity epochs, and issued-QUID ledgers. Restoring or installing validates the entire registry and its roots before publishing a replacement; no partial library state becomes visible.

Local captures may contain zero application libraries, including a completely empty registry. Hosted Locus admits runtime libraries through its durable authority gate; action-only client sessions use endpoint-only Echo.

`restore` applies a complete local snapshot only when its library topology matches the map's current topology. It rejects incompatible topology before mutation. `install_libraries_snapshot` creates a separate local map and a fresh runtime identity domain. Portable data never claims process-local QUID continuity. Document identity capture and its local provenance remain internal. Public document inspection uses `root()`.

`map.addLibraries(...)` produces a portable local `library-add` commit. `map.replay(commit)` can apply that topology commit to another local map at the recorded preceding revision. The operation carries names, modes, Schemas, and initial roots without generated QUIDs. Hosted Locus/Echo topology delivery uses the same registry model through its managed authority path.

Changed local mutations produce map-wide commits with named library operations and a single revision transition. Hosted replay and durable recovery operate through internal authority facilities and exact registry or projected cuts; application code does not replay a solo-map capture. Locus persists semantic, QUID-free state and reconstructs a fresh generated identity epoch after process restart.

Local rendering uses `map.lib("page").render()`. `map.cut({ data?, documents?, html? })` transfers a self-contained selected registry in `libs`, optionally with coherent `html` and `document`. Omitted families include all application libraries of that family; empty arrays include none. HTML requires an already selected document. Interactions follow selected documents automatically. State-only, data-only, document-only, mixed, and empty selections reconstruct through the same local installer. Hosted SSR uses the authorized `locus.cut(sessionId, document?)` projection and HTML.

For the full registry shape and selection rules, see [LiveMap API](./api-livemap.md) and [registry details](./multi-library.md).
