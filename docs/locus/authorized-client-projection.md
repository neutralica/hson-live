# Authorized hosted client projection

LiveMap owns a library registry that may grow at runtime. Locus governs the complete registry and separate system state. A one-library registry uses the same hosted path as a larger registry. Every application library has exactly one `client-public` or `server-private` exposure entry. Exposure makes a library eligible for a client projection; the session request and `authorizeProjection` decide what the session receives. With no authorizer, read, system-feature, and built-in document-write grants are empty.

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

A session stores one normalized effective projection, digest, and sequence. Credential reattachment uses the current contract. `locus.sessions.updateProjection(sessionId, request)` can expand or contract an attached grant using current connection context; a disconnected resumable session requires an explicit trusted context in the third argument. Existing grants name an exact set; future public names do not enter them automatically. An optional `defaultProjection` is a default request and passes through the same authorization. A selected HTML document must be an included, authorized document library. A grant may contain no application libraries. Failures do not identify hidden libraries.

The `AuthorityProjectionSnapshot` contains only selected public library contracts and QUID-free roots, the chosen HTML document, permitted system features, and write grants. Its revision is the authority position used by Echo's `authorityRev`. `hsonLiveMap.fromClientSnapshot({ authority, localLibraries })` composes separately declared client-local libraries. The composed map has its own `map.rev`; local mutations do not advance `authorityRev`. Generated QUIDs stay in their runtime.

Every accepted authority revision yields one session-specific projected commit or progress event. A mixed transition remains atomic for its visible effects. Invisible revisions yield progress at the original authority revision. Retained `library-add` has the same filtered portable topology form as live projection; later writes follow its authority revision. A disconnected expansion replays missed revisions under the prior exact grant, then sends a `projection-change` with current newly granted roots at the recovery cut. Echo applies that change before queued live traffic in the existing composed LiveMap. A contraction sends the current authorized projection as a session contract change, removing only revoked authority-owned libraries. When replay is unavailable, a current projected snapshot reconciles authority-owned topology and state before the queued tail. Unchanged handles and local libraries remain valid; revoked handles remain stale even after a later regrant. Hidden topology remains absent, and a client-local name collision fences installation.

Hosted commit and progress frames carry the effective session projection sequence and digest. Echo checks both before applying semantic state. Projection changes use their own sequence and never fabricate an authority revision. A projected snapshot fallback advances the authority cursor to its captured authority position; client `map.rev` changes only when its semantic state changes.

`locus.cut(sessionId, document?)` captures authorized HTML and projection data from one authority revision. It requires an active session and a permitted selected document. `render_hosted_document({ authority: locus, sessionId })` uses the same cut. Hosted SSR carries the projected snapshot; `continue_hosted_document` admits matching DOM and waits for Echo recovery. An application can return the cut's HTML alone when no browser continuation is needed.

The active formats identify distinct contracts: `hson-authority-projection-snapshot-v1` for projected state, `hson-locus-live-projected-client-commit-v3` and `hson-locus-live-projected-client-wire-v3` for live and retained effects, `hson-locus-hosted-aggregate-message-v7` for the hosted socket, and `hson-ssr-bootstrap` version 3 for projected hosted SSR. Local SSR uses its separate version 2 contract. Unsupported old formats reject.

Durable persistence stores complete server authority state without generated QUIDs or exposure policy. Its current checkpoint is the chunked `hson-locus-durable-aggregate-checkpoint-v2` manifest with durable records and tail. It is never a client projection or SSR payload. Client-local libraries remain local.
