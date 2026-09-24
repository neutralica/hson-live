# SSR cuts and continuation

## Local rendering

`map.cut()` and `render_document({ map })` are local structural APIs. The caller
owns the whole local map. They capture once, render the detached selected
document, and return local continuation data. A Libraries map may infer its sole
document; multiple local documents require a name. Local SSR uses
`hson-ssr-bootstrap` version 2 (`document` or `libraries`). This local contract
has no hosted projection policy.

## Session-projected hosted rendering

A multi-library Locus stores an immutable effective projection when its session
is authorized. Server application code uses the session ID to obtain one cut:

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

The projected hosted carrier is `hson-ssr-bootstrap` version 3 with kind
`hosted-projection`. Its payload is an admitted
`hson-authority-projection-snapshot-v1`. The encoder and decoder reject the
older complete hosted `hosted-document` and `hosted-libraries` version 2
families. Local version 2 remains distinct. The live projected commit/wire v2
and hosted socket v4 formats are unchanged.

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
