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

## Hosted session cuts

`locus.map` contains complete authority state. `locus.session` owns retained client sessions; each returned capability represents one authorized scope.

```ts
const session = await locus.session.create(
  { libraries: ["state", "page"] },
  { connection: { principalId: "alice" } },
);
const cut = session.cut({ html: "page" });
const encoded = encode_ssr_bootstrap(cut.libs);
const credential = session.credential; // deliver separately for Echo reattachment
```

Server-first creation uses real exposure and authorization filtering and needs no browser transport. A resumable session retains its logical scope and capability through disconnect and reattachment. `session.update(...)` reauthorizes changes; `session.revoke()` withdraws authority. Terminal sessions and manager disposal fence subsequent cuts.

`session.cut()` returns only `{ libs }`. Supplying `html` returns `{ libs, html, document }` and must name an included document library. It neither includes another library nor changes the retained contract. HTML uses the captured root and CSS, including legal roots larger than the generic 4 MiB codec default. There is no implicit HTML document selection.

Hosted `libs` is an admitted `hson-authority-projection-snapshot`, with authority/recovery identity and authorized system/write contract metadata. Encode it using the SSR codec's `hosted-projection` family. Local `map.cut().libs` uses the distinct `libraries` family. Credentials are absent from both transferred state and HTML and must be handed off independently.

The browser composes `hsonLiveMap.fromClientSnapshot({ authority: decoded.bootstrap, localLibraries })`, creates Echo with the separate credential, and adopts the document through `continue_hosted_document`. Multiple documents require an explicit stable document handle. Continuation checks contract identity, authority revision and binding, captured roots, and Echo's cursor before adopting DOM and waiting for recovery.

The application owns its shell, routing, asset tags, headers, CSP, and carrier placement. Encode this cut's `libs` beside this cut's HTML. Framework privacy filtering protects library scope; the application still controls the contents it authors into permitted libraries and arbitrary responses.
