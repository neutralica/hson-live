# Authorized hosted client projection

LiveMap owns a fixed library registry. Locus governs that complete registry and separate system state. A one-library registry uses the same hosted path as a larger registry. Every application library has exactly one `client-public` or `server-private` exposure entry. Exposure makes a library eligible for a client projection; the session request and `authorizeProjection` decide what the session receives. With no authorizer, read, system-feature, and built-in document-write grants are empty.

```ts
const locus = hsonLocus.create({
  map,
  exposure: [
    { library: "page", exposure: "client-public" },
    { library: "credentials", exposure: "server-private" },
  ],
  authorizeProjection: () => ({ libraries: ["page"], writableDocuments: [] }),
});
```

A session stores one normalized projection and digest. Credential reattachment reuses it; a different scope requires a new session. `locus.revokeSession(sessionId)` fences an existing session. An optional `defaultProjection` is a default request and passes through the same authorization. A selected HTML document must be an included, authorized document library. Failures do not identify hidden libraries.

The `AuthorityProjectionSnapshot` contains only selected public library contracts and QUID-free roots, the chosen HTML document, permitted system features, and write grants. Its revision is the authority position used by Echo's `authorityRev`. `hsonLiveMap.fromClientSnapshot({ authority, localLibraries })` composes separately declared client-local libraries. The composed map has its own `map.rev`; local mutations do not advance `authorityRev`. Generated QUIDs stay in their runtime.

Every accepted authority revision yields one session-specific projected commit or progress event. A mixed transition remains atomic for its visible effects. Invisible revisions yield progress at the original authority revision. Echo validates continuity for live publication, retained replay, recovery tails, and snapshot fallback. A fallback installs the projected authority part and preserves client-local libraries and resources. Mirror follows the composed LiveMap's local transitions.

`locus.cut(sessionId, document?)` captures authorized HTML and projection data from one authority revision. It requires an active session and a permitted selected document. `render_hosted_document({ authority: locus, sessionId })` uses the same cut. Hosted SSR carries the projected snapshot; `continue_hosted_document` admits matching DOM and waits for Echo recovery. An application can return the cut's HTML alone when no browser continuation is needed.

The active formats identify distinct contracts: `hson-authority-projection-snapshot-v1` for projected state, `hson-locus-live-projected-client-commit-v2` and `hson-locus-live-projected-client-wire-v2` for live effects, `hson-locus-hosted-aggregate-message-v4` for the hosted socket, and `hson-ssr-bootstrap` version 3 for projected hosted SSR. Local SSR uses its separate version 2 contract. Unsupported old formats reject.

Durable persistence stores complete server authority state without generated QUIDs or exposure policy. Its current checkpoint is the chunked `hson-locus-durable-aggregate-checkpoint-v2` manifest with durable records and tail. It is never a client projection or SSR payload. Client-local libraries remain local.
