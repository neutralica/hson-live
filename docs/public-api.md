# Refined public API map

`hson-live` is a set of cooperating capabilities, not a framework lifecycle.
Use only the pieces an application needs. A standalone `LiveTree`, a local
`LiveMap`, a `Reflect` binding, and local document continuation are all valid
without a Locus, Echo, or LiveHost.

The package root (`hson-live`) is the normal application and high-level
composition surface. Import specialist capabilities from the subpath that owns
them: `/hson` for core graph/value types and authoring, `/transform` for
conversion, `/livemap`, `/livetree`, `/reflect`, `/echo`, `/locus`, `/ssr`,
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
- **LiveMap and Libraries** own local canonical state. A Libraries map is one
  named aggregate authority, not one authority per library.
- **LiveTree** owns a live browser projection and can be used by itself.
  Styling is `tree.style`, `tree.css`, and `CssManager.api()`; synchronization
  is automatic—there is no public `syncNow`. `tree.content` is a returned
  `ContentManager` capability, not an implementation applications construct.
- **Reflect** binds a document LiveMap to a LiveTree. It owns its binding, not
  the source map; dispose it when the binding is no longer wanted.
- **Locus and Echo** are optional hosted authority and replica/session layers.
  Locus orders and authorizes authority work; Echo carries a replica through
  session and recovery. Transport closure, semantic session termination, and
  terminal disposal are distinct application lifecycle decisions.
- **LiveHost** is optional server application/authority hosting infrastructure.
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

const map = hsonLiveMap.fromJson({ count: 0 });
map.set(["count"], 1);
const count = map.snap(["count"]);
```

For exact data rather than a materialized object, use `map.data(path?)`; action
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

### 4. LiveMap + Reflect — local document projection

```ts
import { hsonLiveMap } from "hson-live/livemap";
import { reflect_document } from "hson-live/mirror";
import { hsonTransform } from "hson-live/transform";

const map = hsonLiveMap.fromNode(hsonTransform.fromTrustedHtml("<main/>").toNode());
if (map.mode === "document") {
  const binding = reflect_document(map);
  // Mutate through the document-map API, then later release only this binding.
  binding.dispose();
}
```

Reflect does not dispose `map`. Its health/status concerns projection; it is
not the same promise as Echo revision convergence.

### 5. Hosted one-map document — authority, replica, recovery

```ts
import { create_locus } from "hson-live/locus";
import { create_echo } from "hson-live/echo";
import { hsonLiveMap } from "hson-live/livemap";

const authority = create_locus({ map: documentMap, actions: { save(ctx, payload) {
  if (payload) Hson.data.entries(payload); // exact HsonData, not a plain object
  return ctx;
} } });
const echo = create_echo({ socket, map: replicaMap, recovery: { logicalMapId: "document" } });
```

`documentMap`, `replicaMap`, and `socket` are application-owned setup. A Locus
action is registered by the application; Echo connects and recovers through
its documented session APIs. Document acquisition is path-based; there is no
raw-QUID request target or application-visible `ensureQuid`. `DataLocusOptions`
is the type for state-created data authorities, and persisted data kind is
`"data"`; neither claim adds durable persistence by itself. *Compile-only;
runtime coverage:* Locus document/recovery and Echo acceptance tests.

`LocusSocketLike` carries encoded text frames, while ordinary Echo owns client
message encoding. Specialist protocol peers import the four directional
codecs, including `encode_locus_client_message`, from `hson-live/locus`; exact
action `payloadData` is not produced by the canonical `HsonData` string.

### 6. Hosted Libraries — one aggregate, named targets

```ts
import { hsonLiveMap } from "hson-live/livemap";
import { create_locus } from "hson-live/locus";

const libraries = hsonLiveMap.fromLibraries({
  page: { document: "<main/>" },
  settings: { data: { theme: "dark" } },
});
const authority = create_locus({ map: libraries, actions: {} });
```

`draft.lib("page")` or `draft.lib("settings")` selects a named target during
one atomic authoritative action. This is one aggregate revision and recovery
authority. Runtime coverage: hosted multi-library acceptance tests.

### 7. Local SSR — cut, deliver, restore, continue

```ts
import { decode_ssr_bootstrap, encode_ssr_bootstrap } from "hson-live/ssr";

const cut = documentMap.cut();
const encoded = encode_ssr_bootstrap(cut.data);
const decoded = decode_ssr_bootstrap(encoded);
```

`cut.html` is `BrowserRealizationHtml`, not `Hson.toHtml()` transport
HTML. Use the matching public installer/restore path for `decoded.bootstrap`,
then `continue_document` with an explicit existing root Element. Put an
application-root carrier outside that continued root with no surrounding
whitespace in its encoded text; full-document bootstrap is out-of-band. Return
a standard Web `Response`; storage, routes, cache policy, and security remain
application-owned. Runtime coverage: SSR codec and document-SSR acceptance
tests.

For a fixed Library registry, use `libraries.cut("page")`; if it contains
exactly one public document Library, `libraries.cut()` infers its name. The
result includes `document`, selected-document `html`, and `data` for the
complete Libraries snapshot, including its data Libraries. Data LiveMaps and
data-only Loci have no `cut()` method. `render_document({ map })` remains the
lower-level functional equivalent and returns the payload as `bootstrap`.

### 8. Hosted SSR — adopt before recovery, then author

```ts
import { continue_hosted_document } from "hson-live";

const cut = authority.cut();
// Install this captured bootstrap, create the replica Echo, then:
const continuation = await continue_hosted_document({ echo, root });
await continuation.tree.async.attrs.set("data-ready", "yes");
continuation.dispose();
```

A document Locus has `cut()`; a Libraries Locus has `cut(document?)` with the
same selection rule as local Libraries. Both return `{ html, data }` (and
`document` for Libraries). `render_hosted_document({ authority })` remains the
lower-level functional equivalent with a `bootstrap` field.

The captured cut is installed and the existing DOM is adopted before ordinary
Echo recovery. Continuation borrows Echo—it does not disconnect or dispose it.
Its disposer releases its Reflect/interaction arrangements while leaving the
returned tree and DOM intact. Exact admission makes no writes; later legitimate
recovery may still change the DOM. AsyncLiveTree completion is not a blanket
guarantee of successful DOM realization; inspect Reflect health separately.
Runtime coverage: hosted continuation and SSR acceptance tests.

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
dispose activation resources when appropriate. Local behavior tables are fixed
runtime capabilities; they do not grant Locus ordering, authorization, or
recovery. Locus-registered actions are the authoritative counterpart. Descriptors
do not serialize callbacks, auto-generate registrations, mint subject identity,
or intrinsically require Echo. Runtime coverage: canonical-interactions tests.

## Representation and delivery vocabulary

The **canonical Hson graph** is in-memory semantic structure. **Serialized
Hson** and branded `HsonCanonical` are authored/transport text forms. Hson
`.toHtml()` is Hson transport HTML, not parser-compatible SSR output.
`BrowserRealizationHtml` comes only from SSR composition. A semantic bootstrap
is a captured map/authority state; `EncodedSsrBootstrap` is its deterministic
delivery encoding. Snapshot transferability is not built-in durable persistence.
HTML and continuation data must come from the same captured cut; Libraries SSR also
returns the selected document name and it must travel with that result.

For detailed contracts, see the linked subsystem references: Transform,
LiveMap, LiveTree, Reflect, Locus, canonical interactions, SSR composition,
and document continuation.

## LiveDemo / hson-demo2 migration checklist

- Replace retired `hson-live/types` imports with `/hson` core types and owning
  specialist subpaths; keep normal composition imports at the package root.
- Treat action payload/result values as `HsonData`: check presence, use
  `Hson.data.entries(value)` for exact semantics or `Hson.data.materialize(value)` for a detached JS view.
- Use camelCase Locus/Echo APIs and `DataLocusOptions`; use persistence kind
  `"data"` only where existing persistence integration is actually supplied.
- Replace LiveMap HTML shortcuts with explicit trusted/untrusted Transform then
  `hsonLiveMap.fromNode`; use path document requests, not raw QUID targeting.
- Use `TransformOutput`, `SsrBootstrapCodecError`, `tree.style`/`tree.css` or
  `CssManager.api()`. Remove `sanitizeBEWARE`, `ensureQuid`, `syncNow`, and
  independent `ContentManager` construction assumptions.
