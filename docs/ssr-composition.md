# SSR cuts and continuation

## Local rendering

A document handle renders its own state with `map.lib("page").render()` and
returns `BrowserRealizationHtml`. It reads only that document and its CSS, preserves
fragments and authored document shells, and performs browser-parser checks.

For transferable local state, use a coherent selection:

```ts
const stateOnly = map.cut();
const dataOnly = map.cut({ documents: [] });
const documentOnly = map.cut({ data: [], documents: ["page"] });
const mixed = map.cut({ data: ["state"], documents: ["page"], html: "page" });
const encoded = encode_ssr_bootstrap(mixed.libs);
```

Omitted family selections include all application libraries in that family;
explicit empty arrays include none. Omitted HTML yields exactly `{ libs }`.
Requested HTML yields `{ libs, html, document }`; its document must already belong
to the document selection. HTML uses that cut's detached root and CSS. Unknown,
duplicate, internal, and wrong-family names are rejected.

The selected registry is self-contained, including Schemas, digests, portable
roots, CSS, and the source revision. Canonical interactions follow the selected
documents automatically, preserving enabled-empty storage without synthesizing
absent storage. `install_libraries_snapshot(libs)` reconstructs a fresh local map.
Local transfer uses `hson-ssr-bootstrap` with kind `libraries`. Snapshot root
consumers use the aggregate 64 MiB bound, with unchanged depth and node limits.

## Hosted session current state

`locus.map` contains complete authority state. `locus.session` owns retained client sessions; each returned capability represents one authorized scope.

```ts
const session = await locus.session.create(
  { libraries: ["state", "page"] },
  { connection: { principalId: "alice" } },
);
const now = session.now({ html: "page" });
const encoded = encode_ssr_bootstrap(now);
const credential = session.credential; // deliver separately for Echo reattachment
```

Server-first creation uses ownership and authorization filtering and needs no browser transport. A resumable session retains its logical scope and capability through disconnect and reattachment. `session.update(...)` reauthorizes changes; `session.revoke()` withdraws authority. Terminal sessions and manager disposal fence subsequent operations.

`session.now()` returns `{ format, libs, local, initializerDigest }`. Supplying `html` additionally returns `{ html, document }` and must name an included shared document library. Local document initializers are never selected as hosted output. HTML uses the captured shared root and CSS. There is no implicit selection.

Hosted `libs` is an admitted `hson-authority-projection-snapshot`; `local` is a distinct set of fingerprinted initializers. Encode the whole `now` object using the SSR codec's `hosted-projection` family so text carriers retain both. Local `map.cut().libs` uses the distinct `libraries` family. Credentials are absent and must be handed off independently.

The browser passes structured `now`, a separate credential, socket, and existing root to `continue_hosted_document`. The helper prepares Echo, initializes missing local libraries, adopts the explicit shared document, binds Mirror, and completes sync. The transfer codec remains optional when a carrier needs text.

The application owns its shell, routing, asset tags, headers, CSP, and carrier placement. Encode this `now` composition beside its HTML. Framework privacy filtering protects library scope; the application still controls the contents it authors into permitted libraries and arbitrary responses.
