# Same-cut SSR composition

`hson-live/ssr` provides the synchronous, environment-neutral composition
boundary for one document selected from either a solo map or fixed Libraries map:

```ts
import { render_document, render_hosted_document } from "hson-live/ssr";

const local = render_document({ map });
const hosted = render_hosted_document({ authority });
const libraries = render_document({ map: librariesMap, document: "page" });
const hostedLibraries = render_hosted_document({ authority: librariesLocus, document: "page" });
```

Solo calls return exactly `{ html, bootstrap }`. Libraries calls return exactly
`{ html, bootstrap, document }`. The Libraries result is one atomic triple:
`HTML(D,N)`, the complete aggregate bootstrap at `N`, and selected public name
`D`. Store, cache, and deliver those values together. A delivery system that
serves the bootstrap separately must serve the bootstrap from the returned
result; it must not recapture a newer map or authority state. For aggregate
SSR, preserve the returned selected public document name too: it selects the
document from the installed aggregate snapshot. Applications remain responsible
for principal-specific content and cache policy.

## The same-cut guarantee

`render_document` calls `map.capture()` once. It validates that detached
document capture, derives a browser-realization plan from `capture.root`, and
serializes the plan. The exact capture used for HTML is returned as
`bootstrap`. Neither HTML nor bootstrap construction rereads the map.

`render_hosted_document` asks the existing Locus recovery planner for one exact
transport-independent Hson snapshot. It decodes and realizes only that detached
snapshot and returns the original snapshot as `bootstrap`. It never reads an
authority map after snapshot capture and creates no Locus or Echo session,
socket, endpoint, selector, or connection.

Both functions are synchronous. A result represents the state captured by that
call, not a promise that it is permanently the newest authority state.

For Libraries, `map.capture()` captures one `LiveMapLibrariesSnapshot`
synchronously. Selection is resolved only against that captured ordered
registry, and the selected exact root is decoded from that snapshot. The source
map, selected facade, registry, hidden state, and ledger are never reread after
capture. Hosted composition captures the corresponding
`HostedLiveMapLibrariesSnapshot` once and verifies its logical-map/incarnation
fence. The hosted type adds only that semantic authority fence; neither snapshot
contains a session, socket, endpoint, route, selector, attachment epoch, or
transport metadata.

If exactly one public `mode: "document"` Library exists, `document` may be
omitted and its name is returned. Multiple public documents require an explicit
name. Zero documents, unknown names, data Libraries, and `scope:
"hson-internal"` Libraries fail with `DocumentSsrError.phase === "select"`.
Only the selected document is checked for browser-parser compatibility.

## Output meanings

`BrowserRealizationHtml` is a branded string that distinguishes parser-compatible
browser-realization output from Hson transport HTML such as `.toHtml()`. The
brand means only that the SSR composition path produced the value. It does not
mean sanitized, trusted, XSS-safe, CSP-safe, or authenticated, and it is not a
license to interpolate the value into an arbitrary string context.

The HTML contains only canonical browser realization and its derived Hson text
boundary comments. It does not contain runtime CSS infrastructure or a bootstrap
wrapper. Canonical QUID attributes and boundary markers come from the same
captured graph as the bootstrap; SSR never mints a QUID.

When the sole canonical root is `<html>`, serialization prepends
`<!doctype html>` and produces standards-mode full-document output. An
application-root result such as `<main>...</main>` must be delivered inside a
standards-mode document shell for the supported continuation contract. Doctype
is derived realization output, not canonical bootstrap state.

## Deterministic bootstrap encoding

The semantic result can be converted to one strict, environment-neutral wire
value without changing the render result:

```ts
import { decode_ssr_bootstrap, encode_ssr_bootstrap } from "hson-live/ssr";

const encoded = encode_ssr_bootstrap(result.bootstrap);
const decoded = decode_ssr_bootstrap(encoded);
```

The four wire kinds are `document`, `hosted-document`, `libraries`, and
`hosted-libraries`. The decoder returns `{ kind, bootstrap }`; it never adds a
kind field to the semantic bootstrap itself. Pass that bootstrap to the
existing matching installer or restore path. Decoding reconstructs detached
semantic state and does not install a map or recreate private same-epoch
capabilities.

`EncodedSsrBootstrap<TKind>` is a branded string. Its brand means only that
hson-live's encoder produced the deterministic representation for that family.
It does not mean trusted, authentic, authorized, encrypted, sanitized, fresh,
same-origin, or server-proven. Applications that require authenticity may sign
or store the encoded value through an external mechanism.

Version one is a compact canonical JSON envelope, UTF-8 encoded and then
converted to unpadded base64url. Its alphabet is only ASCII letters, digits,
`-`, and `_`. The decoder rejects malformed UTF-8, duplicate or unknown JSON
fields, unknown format or kind, unsupported versions, malformed payloads, and
any alternate representation that does not reproduce the input byte-for-byte
when canonically re-encoded. Arbitrary Library names and graph names remain
string values or ordered entry-array contents, including names such as
`__proto__` and `constructor`; they are not promoted to envelope object keys.

`SsrBootstrapCodecOptions` has one option, `maxEncodedBytes`. It must be a
positive safe integer. The default is 96 MiB and is checked before base64
decoding; the existing snapshot codecs, schemas, registries, roots, identity
ledgers, and installers retain their deeper semantic bounds and validation.
`SsrBootstrapEncodingError` reports `encode` or `decode` plus a compact code
without copying attacker-controlled payload text into its message.

The codec preserves the exact admitted semantic state: revisions, `-0`, array
and graph order, optional presence, lone UTF-16 surrogates, exact root payloads,
Schemas and digests, registry order, identity epoch, issued and retired QUIDs,
hidden Libraries, and the hosted logical-map/incarnation fence. It adds no
session, route, endpoint, selector, socket, HTTP, or transport metadata.

## Application-owned delivery

The standard Web `Response` is the delivery API. Applications may directly
return SSR HTML with their own shell, routing, storage, and header policy:

```ts
return new Response(ssr.html, {
  headers: {
    "content-type": "text/html; charset=utf-8",
  },
});
```

`hson-live` does not provide or require an SSR `Response` wrapper.

For an application-root continuation such as `<main>`, an application shell
may place the encoded text in an inert sibling data block outside the canonical
root that will be continued:

```html
<main>...</main><script type="application/vnd.hson-live.ssr-bootstrap">ENCODED_BOOTSTRAP</script>
```

The carrier remains delivery infrastructure, not canonical Hson realization.
Application code selects its carrier—no fixed ID or global selector is
required—reads its exact `.textContent`, and passes that exact string to
`decode_ssr_bootstrap`. The encoded payload must have no leading or trailing
formatting whitespace; the one-line example intentionally keeps it adjacent to
the script tags.

`application/vnd.hson-live.ssr-bootstrap` is the recommended project-specific
media type for either an encoded bootstrap resource or an inert carrier. It is
not claimed to be IANA-registered. The representation is base64url ASCII, so
no charset parameter is necessary.

Precisely: `EncodedSsrBootstrap` contains only ASCII letters, digits, `-`, and
`_`. When inserted verbatim as text content of a non-JavaScript `<script>` data
block, its own characters cannot contain an HTML script end tag or escape that
script-data payload. This is not a claim that the value is XSS-safe, trusted
HTML, CSP-safe, or sanitized. Placement and shell construction remain the
application's responsibility. The inert block does not execute bootstrap data;
executable loader code and external fetching remain governed by application
policy. The codec needs no HTML sink or Trusted Types API, and intentionally
provides no embedding helper.

For exact `documentElement` continuation, do not put a carrier inside the
canonical `<head>` or `<body>`. Deliver the encoded value through an external
immutable resource, a module-provided value, or another out-of-band application
channel. This keeps the canonical full document unchanged. An external resource
must return the exact bootstrap captured with that HTML, rather than recapturing
current authority state on GET. HTTP gzip/brotli is a separate delivery-layer
choice; the codec performs no compression and exposes no digest or
authentication field.

Caching is application-owned. This contract recommends no universal `public`,
`private`, `no-store`, or `immutable` header. An external encoded bootstrap may
be cached immutably only when its URL or key permanently identifies those exact
bytes and application authorization and privacy policy permits it.

`EncodedSsrBootstrap` is exact deterministic encoding, not authentication.
`BrowserRealizationHtml` is realization provenance, not trusted or sanitized
HTML. CSP, executable client-module policy, fetch-origin policy, and generic
security headers remain application concerns. Rendering and delivery create no
session in `hson-live`.

## Hosted browser installation

The semantic hosted result intentionally excludes delivery metadata:

```ts
import { install_locus_snapshot } from "hson-live/locus";

const installed = install_locus_snapshot(hosted.bootstrap);
const echo = create_echo({
  socket,
  map: installed.map,
  recovery: installed.recovery,
  session: {},
});

echo.connect();
await echo.session.create();
await continue_hosted_document({ echo, root });
```

Installation preserves logical map identity, incarnation, and last-applied
revision. Ordinary recovery then chooses current, replay, snapshot, or
incompatibility behavior. SSR adds no history pinning or recovery policy.
`LocusBootstrap`, `capture_locus_bootstrap`, and `install_locus_bootstrap`
remain the transport-bearing bootstrap API for existing callers.

The aggregate local and hosted flows use the sibling installers:

```ts
const localInstalled = install_libraries_snapshot(libraries.bootstrap);
const localDocument = localInstalled.map.lib(libraries.document);
continue_document({ map: localInstalled.map, document: localDocument, root });

const hostedInstalled = install_locus_libraries_snapshot(hostedLibraries.bootstrap);
const echo = create_echo({ socket, map: hostedInstalled.map, recovery: hostedInstalled.recovery });
echo.connect();
await echo.session.create();
await continue_hosted_document({
  echo,
  document: echo.map.lib(hostedLibraries.document),
  root,
});
```

Installation restores every public and hidden Library, exact Schema sources and
digests, ordered registry and digest, one global revision, numeric identity
epoch, and the full issued-QUID ledger including retired identities. Hidden
canonical interaction storage remains hidden and has no side payload. Local
installation creates fresh runtime capability objects without fabricating a
hosted identity. Hosted installation retains the logical/incarnation fence and
returns the ordinary aggregate Echo recovery cursor.

## Domain and delivery limits

The composition API accepts one `DocumentLiveMap`, one fixed
`LiveMapLibraries`, one one-map `LocusBootstrapAuthority`, or the current public
multi-library Locus authority. The selected canonical document
must contain exactly one ordinary Element root: either an application root or
the sole full-document `<html>` root.

SSR uses the parser-compatible browser-realization domain. Canonical state can
be valid and direct-DOM-projectable yet still fail SSR; for example, canonical
`p > div` is rejected rather than repaired, normalized, or serialized through
Hson transport HTML. `DocumentSsrError` attributes failures to `select`,
`capture`, `bootstrap`, or `realize` and preserves the lower-level `cause`.

The rendering API still does not choose inline versus separate delivery. The
encoding API emits only the context-independent base64url string: it does not
emit script tags, manage CSP or Trusted Types, choose response charsets, create
HTTP responses, or depend on LiveHost. SSR/bootstrap delivery also remains
independent of whether a later Echo connection uses WebSocket or another
semantic transport arrangement; connection endpoint metadata does not belong
in the semantic bootstrap.

The `/ssr` module has no DOM, Node HTTP, filesystem, `Buffer`, `process`, or
Node-crypto dependency and is suitable for Node and Worker environments.
