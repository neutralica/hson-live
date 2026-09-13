# Same-cut SSR composition

`hson-live/ssr` provides the synchronous, environment-neutral composition
boundary for one document map:

```ts
import { render_document, render_hosted_document } from "hson-live/ssr";

const local = render_document({ map });
const hosted = render_hosted_document({ authority });
```

Each call returns exactly `{ html, bootstrap }`. These two fields are one
semantic pair: store, cache, and deliver them together. A delivery system that
serves the bootstrap separately must serve the bootstrap from the returned
pair; it must not recapture a newer map or authority state. Applications remain
responsible for principal-specific content and cache policy.

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

## Domain and delivery limits

The first composition API accepts one `DocumentLiveMap` or one one-map
`LocusBootstrapAuthority`. Aggregate/multi-library state, document selectors,
hidden interactions, and aggregate fences are not accepted. Aggregate snapshot
and installation exposure is a later phase. The selected canonical document
must contain exactly one ordinary Element root: either an application root or
the sole full-document `<html>` root.

SSR uses the parser-compatible browser-realization domain. Canonical state can
be valid and direct-DOM-projectable yet still fail SSR; for example, canonical
`p > div` is rejected rather than repaired, normalized, or serialized through
Hson transport HTML. `DocumentSsrError` attributes failures to `select`,
`capture`, `bootstrap`, or `realize` and preserves the lower-level `cause`.

The API does not choose inline versus separate delivery. It deliberately does
not encode bootstrap JSON, emit script tags, escape `</script>`, manage CSP or
Trusted Types, choose response charsets, create HTTP responses, or depend on
LiveHost. Those are separate safe-embedding and delivery-layer concerns.

The `/ssr` module has no DOM, Node HTTP, filesystem, `Buffer`, `process`, or
Node-crypto dependency and is suitable for Node and Worker environments.
