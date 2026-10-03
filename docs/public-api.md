# Refined public API map

`hson-live` is a set of cooperating capabilities, not a framework lifecycle.
Use only the pieces an application needs. A standalone `LiveTree`, a local
`LiveMap`, a `Mirror` binding, and local document continuation are all valid
without a Locus, Echo, or LiveHost.

The package root (`hson-live`) is the normal application and high-level
composition surface. Import specialist capabilities from the subpath that owns
them: `/hson` for core graph/value types and authoring, `/transform` for
conversion, `/livemap`, `/livetree`, `/mirror`, `/echo`, `/locus`, `/ssr`,
and `/livehost` for their respective advanced APIs. `/locus/node` and
`/livehost/node` are Node-specific. Diagnostics are intentionally on
`/diagnostics` (and its named diagnostics entrypoints), not the root.

`hson-live/types` and `hson-live/diagnostics/test-exports` are retired. Do not
replace either with deep imports: removal from the root does not remove a
specialist capability from its owning public subpath.

## Roles, without a mandatory sequence

- **Hson authoring and Transform** create and convert the canonical Hson graph.
  `Hson.canonical`, `.data`, and `.document` author classified canonical strings; `Hson.schema` compiles an immutable Schema object; `hsonTransform` is the DOM-free converter.
  Choose `fromTrustedHtml` only for input already trusted by the application;
  `fromUntrustedHtml` is the explicit sanitizing ingress. There is no output
  sanitizer and no `sanitizeBEWARE`.
- **HsonData** is a canonical primitive string with exact semantic data for data values and action
  payloads. Use `Hson.data.entries(data)` for exact ordered inspection and `Hson.data.materialize(data)`
  only when a detached ordinary JavaScript view is wanted.
- **HsonDocument** is a canonical primitive string in document context. It can be converted to a detached graph and round-trips zero, one, or many top-level items;
  it carries no LiveMap authority or browser realization behavior.
- **Hson Schema** validates canonical authored data/graphs. Generated Schema evidence supplies `SchemaType<typeof Schema>` and Schema-specific Hson string proofs.
- **LiveMap and Libraries** own local canonical state. `hsonLiveMap.create` and
  `fromLibraries` construct bare state. `hsonLiveMap.locus` constructs an
  authoritative governor; `hsonLiveMap.echo` constructs a replica governor or
  an endpoint-only participant. A Libraries map is one named aggregate
  authority, not one authority per library.
- **LiveTree** owns a live browser projection and can be used by itself.
  Styling is `tree.style`, `tree.css`, and `tree.css.global`; synchronization
  is automatic—there is no public `syncNow`. `tree.content` is a returned
  `ContentManager` capability, not an implementation applications construct.
- **Mirror** binds a document LiveMap to a LiveTree. It owns its binding, not
  the source map; dispose it when the binding is no longer wanted.
- **Locus and Echo** are optional hosted authority and replica/session layers.
  Locus orders and authorizes authority work; Echo carries a replica through
  session and synchronization. Transport closure, semantic session termination, and
  terminal disposal are distinct application lifecycle decisions.
- **LiveHost** is the runtime-neutral application component created by
  `hsonLiveHost.create`; `LiveHostRuntime` is a bound runtime lifecycle handle.
- **Canonical interactions** persist portable event intent; they are not a
  replacement for ordinary imperative listeners.
- **SSR composition and continuation** render one captured cut, encode it for
  delivery if needed, then install/restore and continue an already exact DOM.

## Nine normal paths

All imports below are public package imports. Snippets marked *compile-only*
show application-owned inputs as `declare`d values; the companion fixture
type-checks their imports and calls. Existing acceptance tests named below are
runtime/browser evidence, not proof that every documentation line executed.

### 1. Transform only — deterministic local conversion

```ts
import { hsonTransform } from "hson-live/transform";

const canonical = hsonTransform.fromUntrustedHtml(userHtml).toHson().serialize();
const transportHtml = hsonTransform.fromHson(canonical).toHtml().serialize();
```

The Transform facade also has `fromTrustedHtml`, `fromJson`, `fromHson`,
`fromBinary`, and `fromNode`. This path has no LiveMap or browser dependency.
`TransformOutput` is the public output type. Runtime coverage: Transform and
trust-ingress acceptance tests.

### 2. Local LiveMap — state without hosting

```ts
import { hsonLiveMap } from "hson-live/livemap";
import { Hson } from "hson-live/hson";

const StateSchema = Hson.schema`<type "data" content <count "number">>`;
const map = hsonLiveMap.fromLibraries({ state: { data: { count: 0 }, schema: StateSchema } });
map.lib("state").at(["count"]).set(1);
const count = map.lib("state").at(["count"]).snap();
```

For exact data rather than a materialized object, use `map.lib("state").data()`; action
handlers receive `HsonData | undefined`, so inspect it or call
`payload === undefined ? undefined : Hson.data.materialize(payload)` instead of assuming application properties are on the
payload object. Runtime coverage: LiveMap mutation and HsonData acceptance
tests.

### 3. Standalone LiveTree — a browser tree without state authority

```ts
import { hsonLiveTree } from "hson-live/livetree";
import { hsonTransform } from "hson-live/transform";

const tree = hsonLiveTree.fromNode(
  hsonTransform.fromTrustedHtml("<main><p>Ready</p></main>").toNode(),
);
tree.attrs.set("data-ready", "yes");
tree.css.set.color("rebeccapurple");
```

LiveTree callbacks registered through `tree.listen` are imperative runtime
callbacks. They are appropriate when portable/recoverable event intent is not
needed. Runtime coverage: LiveTree listener and CSS public-API acceptance
tests.

### 4. LiveMap + Mirror — local document projection

```ts
import { hsonLiveMap } from "hson-live/livemap";
import { reflect_document } from "hson-live/mirror";
import { hsonTransform } from "hson-live/transform";
import { Hson } from "hson-live/hson";

const PageSchema = Hson.schema`<type "document" tag "main" content "empty">`;
const map = hsonLiveMap.fromLibraries({
  page: { document: hsonTransform.fromTrustedHtml("<main/>").toNode(), schema: PageSchema },
});
const binding = reflect_document(map.lib("page"));
binding.dispose();
```

Mirror does not dispose `map`. Its health/status concerns projection; it is
not the same promise as Echo revision convergence.

### 5. Hosted library-registry authority and replica

```ts
import { hsonLiveMap } from "hson-live/livemap";
import { Hson } from "hson-live";

const PageSchema = Hson.schema`<type "document" tag "main" content "empty">`;
const authority = hsonLiveMap.locus.create({
  shared: [{ name: "page", definition: { document: "<main/>", schema: PageSchema } }],
  authorizeProjection: () => ({ libraries: ["page"] }),
});
const session = await authority.session.create({ libraries: ["page"] });
const transport = hsonLiveMap.echo.transport.websocket({ url: "wss://example.test/echo" });
const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport });
```

The same Echo creation surface accepts `hsonLiveMap.echo.transport.http({ endpoint:
"/_hson" })`. An application can host it with `bind_locus_http` from
`hson-live/locus`, passing authenticated request context for each finite
operation and continuing synchronization request. WebSocket and HTTP share
the semantic Locus authority; HTTP/1 and HTTP/2 use one HTTP adapter. HTTP/3
is an architectural fit for ordered response streams, not a tested runtime.

LiveMap owns bare and local state. Locus owns authoritative state, and Echo owns composed replica/client state. A hosted application supplies grouped `private`, `shared`, and `local` definitions. Private/shared definitions establish Locus authority; local initializers remain outside authority state. Document entries accept initial `css: string`. `locus.addLibraries({ private, shared })` admits runtime authority batches with optional document CSS text. `locus.lib("page").css.stylesheet(cssText)` replaces a complete governed document stylesheet; `.css(operation)` applies a granular canonical CSS mutation. `locus.cut(...)` captures full authority state; `session.now(...)` captures only an authorized client scope. `hsonLiveMap.locus.resume({ ...definition, persistence, logicalMapId })` restores or establishes durable authority, and `hsonLiveMap.locus.checkpoint(locus)` compacts its durable history when needed. `session.update(request, context?)` expands or contracts a retained grant through the ordinary authorizer. Echo reconciles shared state while preserving client-owned local roots, Schemas, CSS, handles, and Mirror continuity. `echo.rev` tracks composed client state; `echo.sync.appliedRev` tracks processed authority revisions.

### 7. Local rendering, selective transfer, and continuation

```ts
import { decode_ssr_bootstrap, encode_ssr_bootstrap } from "hson-live/ssr";

const html = documentMap.lib("page").render();
const stateOnly = documentMap.cut();
const rendered = documentMap.cut({ data: ["state"], documents: ["page"], html: "page" });
const encoded = encode_ssr_bootstrap(rendered.libs);
const decoded = decode_ssr_bootstrap(encoded);
```

A document library renders itself as `BrowserRealizationHtml`. A map cuts selected
transferable state: omitted data/document axes include every application library
of that family, and `[]` includes none. State-only cuts return `{ libs }`; HTML
cuts return `{ libs, html, document }`. HTML must name an already selected document.
The registry contains only selected contracts and roots, with applicable interaction
storage filtered by selected documents. Data-only, document-only, mixed, and empty
state selections are valid.

Use `install_libraries_snapshot(decoded.bootstrap)` to reconstruct the selected
local topology, then `continue_document` with an explicit existing root Element.
Put an application-root carrier outside that continued root with no surrounding
whitespace in its encoded text; full-document state delivery is out-of-band.
Return a standard Web `Response`; storage, routes, cache policy, and security
remain application-owned. Hosted cuts retain their existing session contract.

### 8. Hosted SSR — authorized current state and continuation

```ts
import { encode_ssr_bootstrap, continue_hosted_document } from "hson-live";

const session = await authority.session.create({ libraries: ["page"] });
const now = session.now({ html: "page" });
const encoded = encode_ssr_bootstrap(now);
// Deliver now.html and encoded in the application-owned response.
// In the browser, decode the projected state if its carrier required text.
const continuation = await continue_hosted_document({ now, credential, transport, root });
await continuation.tree.async.attrs.set("data-ready", "yes");
continuation.dispose();
```

`session.now({ html: document })` requires an active authorized session.
The selected document must be a shared document in that session's projection.
The HTML and `AuthorityProjectionSnapshot` share one authority revision. The
structured result keeps `libs` and `local` distinct and carries a separate
initializer digest. Deliver `session.credential` separately. Hosted continuation
constructs one managed replica, adopts matching shared DOM, then completes Echo sync,
and exposes `continuation.mirror` for projection health. Its disposer releases
its Mirror and interaction arrangements without disposing Echo.

### 9. Canonical interactions — portable intent plus runtime behavior

```ts
import { activate_interactions, add_interaction } from "hson-live";

add_interaction(libraries, descriptor);
const dispose = activate_interactions({
  map: libraries,
  tree,
  local: { reveal: (event, subject, args) => show(subject, args.materialize()) },
  dispatch: async (key, payload) => { await echo.action(key, payload); },
});
dispose();
```

Supply the executable behavior at its owning runtime, describe event binding
and symbolic behavior/data canonically, activate on the intended tree, then
dispose activation resources when appropriate. `kind: "browser"` invokes the
activation-side behavior table; `kind: "locus"` invokes the dispatcher. Subject
Library ownership, independently of kind, decides whether Locus or the client
owns canonical descriptor state. The runtime behavior table grants no Locus
action authorization. Descriptors
do not serialize callbacks, auto-generate registrations, mint subject identity,
or intrinsically require Echo. Runtime coverage: canonical-interactions tests.

## Representation and delivery vocabulary

The **canonical Hson graph** is in-memory semantic structure. **Serialized
Hson** and branded `HsonCanonical` are authored/transport text forms. Hson
`.toHtml()` is Hson transport HTML, not parser-compatible SSR output.
`BrowserRealizationHtml` comes from document-library rendering and local or hosted
HTML cuts. A semantic bootstrap
is a captured map/authority state; `EncodedSsrBootstrap` is its deterministic
delivery encoding. Snapshot transferability is not built-in durable persistence.
HTML and continuation data must come from the same captured cut; Libraries SSR also
returns the selected document name and it must travel with that result.

For detailed contracts, see the linked subsystem references: Transform,
LiveMap, LiveTree, Mirror, Locus, canonical interactions, SSR composition,
and document continuation.

## LiveDemo / hson-demo2 migration checklist

- Replace retired `hson-live/types` imports with `/hson` core types and owning
  specialist subpaths; keep normal composition imports at the package root.
- Treat action payload/result values as `HsonData`: check presence, use
  `Hson.data.entries(value)` for exact semantics or `Hson.data.materialize(value)` for a detached JS view.
- Construct hosted Locus from grouped private/shared/local definitions; a one-library application uses the same path. Runtime authority admissions use `locus.addLibraries({ private, shared })`. Use `hsonLiveMap.locus.resume` for durable authority and keep the adapter server-side.
- Admit documents through `hsonLiveMap.fromLibraries({ page: { document, schema } })`;
  use `map.lib("page").render()` for local HTML and path document requests for mutation.
- Use `TransformOutput`, `SsrBootstrapCodecError`, `tree.style`/`tree.css` or
  `tree.css.global` and `tree.css.snapshot()`. Remove `sanitizeBEWARE`, `ensureQuid`, `syncNow`, and
  independent `ContentManager` construction assumptions.
