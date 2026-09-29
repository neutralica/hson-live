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

A retained session stores one normalized effective projection, digest, and sequence. Create one with `await locus.session.create({ libraries: ["page"] }, { connection: { principalId: "alice" } })`, without a socket. Request membership, application ownership, client-public exposure, and read authorization must all hold. Broader unrequested grants do not enter the scope. With no authorizer, read, write, and system grants remain empty.

`session.update(request, context?)` reruns authorization for scope changes. Connected sessions use their current connection context; server-created sessions retain their creation context, and disconnected connection-created sessions require current trusted context. Principal continuity remains enforced. Future public libraries do not automatically enter an existing grant. `defaultProjection` is only a default request, subject to the same authorization.

`session.cut()` returns `{ libs }`; `session.cut({ html: "page" })` returns `{ libs, html, document }`. `libs` contains only included public contracts, QUID-free roots, captured document CSS, authority revision/identity, permitted system state, and writable-document grants. The HTML selection belongs only to this output operation and must already be in scope. Deliver `session.credential` separately for later Echo reattachment. Transferred state alone grants no session or write authority.

`await hsonEcho.replicate({ cut, credential, socket })` admits the authorized authority projection and synchronizes its replica. Echo's authority cursor starts at the snapshot's authority revision and advances through current, replay, or snapshot recovery. Generated QUIDs stay in their runtime. Client-local library ownership remains under review separately from replica establishment.

Every accepted authority revision yields one session-specific projected commit or progress event. A mixed transition remains atomic for its visible effects. Invisible revisions yield progress at the original authority revision. Retained `library-add` has the same filtered portable topology form as live projection; later writes follow its authority revision. A disconnected expansion replays missed revisions under the prior exact grant, then sends a `projection-change` with current newly granted roots at the recovery cut. Echo applies that change before queued live traffic in the existing composed LiveMap. A contraction sends the current authorized projection as a session contract change, removing only revoked authority-owned libraries. When replay is unavailable, a current projected snapshot reconciles authority-owned topology and state before the queued tail. Unchanged handles and local libraries remain valid; revoked handles remain stale even after a later regrant. Hidden topology remains absent, and a client-local name collision fences installation.

Hosted commit and progress frames carry the effective session projection sequence and digest. Echo checks both before applying semantic state. Projection changes use their own sequence and never fabricate an authority revision. A projected snapshot fallback advances the authority cursor to its captured authority position; client `map.rev` changes only when its semantic state changes.

Hosted continuation receives that cut's admitted `libs`, an Echo replica, and the explicit document handle being adopted. Multiple documents require explicit selection. It checks authority, contract, roots, and revision, then waits for recovery. The application owns its response shell and state-carrier placement.

The active formats identify distinct contracts: `hson-authority-projection-snapshot` for projected state, `hson-locus-live-projected-client-commit` and `hson-locus-live-projected-client-wire` for live and retained effects, `hson-locus-hosted-aggregate-message` for the hosted socket, and `hson-ssr-bootstrap` for projected hosted SSR. Local SSR uses the distinct `libraries` payload family. Unknown format identities and malformed payloads reject.

Durable persistence stores complete server authority state without generated QUIDs or exposure policy. Its current checkpoint is the chunked `hson-locus-durable-aggregate-checkpoint` manifest with durable records and tail. It is never a client projection or SSR payload. Client-local libraries remain local.
