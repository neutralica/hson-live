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

## Session-projected hosted rendering

A multi-library Locus stores the current effective projection for each authorized
session. An explicit `locus.sessions.updateProjection` may expand it. Server application code uses the session ID to obtain one cut:

```ts
const cut = locus.cut(sessionId);
const encoded = encode_ssr_bootstrap(cut.data);
return new Response(cut.html, { headers: { "content-type": "text/html; charset=utf-8" } });
```

`cut.html` and `cut.data` come from one coherent authority capture at
`cut.revision`. `cut.data` is an `AuthorityProjectionSnapshot` with the same
`revision` and `projectionDigest` as the cut. It contains the projected
authority half only. Browser-owned client-local libraries are declared and
composed separately with `hsonLiveMap.fromClientSnapshot({ authority:
decoded.bootstrap, localLibraries })`. That construction starts at the normal
local `map.rev`; Echo's `authorityRev` starts at the authority snapshot
revision. The client does not use a server QUID to continue the DOM.

A zero-argument hosted cut has no session and fails. A session without a
selected `htmlDocument` cannot render unless the server explicitly names a
document included in that same effective projection. There is no first-document
or all-public default. Private, unselected, and wrong-kind selections return a
generic unavailable-document error. Only the selected document renders into
HTML; other included projected libraries remain state only.

`render_hosted_document({ authority: locus, sessionId })` is a wrapper around
that same cut. A bare authority or recovery planner is not a hosted render
source. The selected document root is decoded from the detached projected
snapshot, so later authority mutations do not alter an existing cut.

The projected hosted carrier is `hson-ssr-bootstrap` with kind
`hosted-projection`. Its payload is an admitted
`hson-authority-projection-snapshot`. Local continuation uses the distinct `libraries` payload family. The projected
commit, projected wire, and hosted socket each retain their own unversioned format
identity. Bootstrap envelopes contain `format`, `kind`, and `payload`.

An application can send `cut.html` alone. If it sends a state carrier, it must
place the encoding of **that cut's** `data` beside the HTML. The application
owns the document shell, routing, asset tags, static CSS, headers, CSP, carrier
placement, deployment adapter, and cache policy. A non-JavaScript script data
block can hold the base64url carrier outside the canonical document root. The
carrier is data, not executable code. `BrowserRealizationHtml` marks framework
parser-compatible rendering; it does not claim sanitization or authentication.

The framework omits server-private and unselected authority libraries from its
own projected HTML, carrier, live replication, replay, and recovery paths.
Application code can still deliberately copy private values into an authorized
document or an arbitrary `Response`; the framework cannot prevent that.

## Release status

The session cut and projected SSR codec are implemented, including Node and
Worker parity. Multi-library hosted continuation supplies the decoded projected
authority snapshot to `continue_hosted_document`. Before DOM adoption, it checks
the projection digest, authority binding, projected library roots, selected
document, and authority revision against the composed client map and Echo
cursor. The retired one-map capture and Node HTTP bootstrap helper are no longer public. The active hosted socket and continuation use the session-projected library registry.
