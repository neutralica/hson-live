# Locus API

`Locus` governs one application library registry and separate system state. The registry may grow while the authority runs. A hosted client obtains an authorized session projection before receiving framework state.

```ts
import { hsonLiveMap } from "hson-live/livemap";

const locus = hsonLiveMap.locus.create({
  shared: [{ name: "page", definition: { document: "<main/>" } }],
  authorizeProjection: () => ({ libraries: ["page"] }),
});
const page = locus.lib("page");
const authorityRev = locus.rev;
```

## HTTP binding

`bind_locus_http(locus, { endpoint: "/_hson" })` returns a Web
`Request`/`Response` binding with `handle(request, trustedContext)` and
`dispose()`. Register `POST /_hson` and `POST /_hson/sync` in the application
host and pass the principal established by its authentication policy:

```ts
import { bind_locus_http } from "hson-live/locus";

const http = bind_locus_http(locus, { endpoint: "/_hson" });
const requests = ["/_hson", "/_hson/sync"].map((path) => ({
  method: "POST",
  path,
  handle: (request: Request, context: LiveHostApplicationContext) =>
    http.handle(request, { principalId: context.principal.id }),
}));
```

The application supplies the authenticated context and owns origin/CSRF and
cross-origin policy. The binder checks a current attachment capability and
exact principal continuity on every attached request. It uses the same Locus
session, action, status, recovery, projection, and publication authority as
`bind_locus_websocket`; no physical HTTP connection identifies a session.
The bearer capability is private runtime-local attachment authorization,
separate from the retained session credential. Dispose the binding with its
application or Locus host.
The HTTP endpoint must be direct: the Echo adapter rejects redirects for
session, finite, synchronization, and heartbeat requests. The binder keeps one
current response stream per attachment and fences establishment already in
progress when disposed. Its idle lease is refreshed by admitted requests and
stream opens; expiry releases the logical attachment under ordinary retained
session grace rules.

The construction definition groups libraries by ownership. Private and shared entries carry a `definition` and become Locus authority state. Local entries carry an `initializer` and remain outside authority state. A document entry in any group may carry `css: string` containing a complete authored stylesheet; data entries cannot carry CSS. Initial CSS is parsed and admitted with the document at revision zero, without a separate CSS transition. All three groups are optional. Shared eligibility remains separate from authorization; a selected HTML document must be an authorized shared document. `defaultProjection` is only a default request and still passes authorization.

`await locus.addLibraries({ private: [...], shared: [...] })` admits one atomic private/shared authority batch. Document entries may carry initial `css: string` in that same topology transition. At least one library is required, and names must be unique. The current API has no dynamic client-local admission operation. A shared classification makes a name eligible but never changes an existing session grant.

`await locus.lib("page").css.stylesheet(cssText)` parses and replaces the complete document stylesheet in one governed CSS transition; an empty string clears it. `await locus.lib("page").css(operation)` remains available for granular canonical CSS mutations. Both forms use the same document CSS state. `hsonLiveMap.locus.resume` accepts the same authored CSS declaration for an initial authority; when durable state exists, its persisted canonical stylesheet is restored instead.

`locus.lib(name)` provides synchronous authoritative reads, including selected roots, snapshots, paths, Schema and CSS reads, rendering, watches, and document commits. A terminal write returns `Promise<void>` and enters the Locus authority queue. `await locus.stage(writer => { ... })` instead collects several synchronous staged writes into one atomic authority decision; its writer has `writer.lib(name)`. Async stage callbacks are rejected. `locus.commits.observe(...)` observes map commits, while `locus.activity` and session events remain separate event domains.

Initial canonical interactions may be supplied as `interactions: [descriptor, ...]` in the Locus definition. Locus enables the interaction system before descriptor transitions and before it claims the map. The same option applies to durable resume.

`await session.update({ libraries: ["page", "newPage"] })` reauthorizes a retained scope against current topology with the ordinary `authorizeProjection` callback. A connected session uses its attachment's current trusted context. A server-created session can use its creation context; an ordinary disconnected connection-created session requires current trusted context as the second argument, for example `{ principalId: "alice" }`. Principal continuity is enforced. Requests select libraries and system features; read and write grants come from the authorizer. Successful changes advance the session contract sequence and digest without creating an authority revision. Removed library handles become stale; a later grant produces new handles.

`await hsonLiveMap.locus.resume({ private, shared, local, persistence, logicalMapId })` restores a durable authority when present, or establishes the declared initial authority durably when absent. `logicalMapId` is required and must remain stable across restarts. It returns an ordinary `Locus` that continues to gate every accepted authority change through durable append. Source definitions govern original libraries and local initializers. Durable Locus records retain the ownership of runtime-added private/shared libraries, so resume does not require source shadow declarations. Application code may read private state through `locus.lib(name)` on the server and remains responsible for arbitrary HTML or `Response` values it writes itself.

A resumed durable authority gives reconnecting clients a projected snapshot for cursors at or before its loaded revision. This reestablishes client identity after restart even when durable authority revision and incarnation are unchanged.

## Persistence

`hsonLiveMap.locus.checkpoint(locus)` compacts an already durable authority. It captures current LiveMap state and runtime-added ownership at one authority point, writes checkpoint chunks and a manifest, activates the manifest, then prunes covered tail commits. It does not export a transferable state bundle, advance the revision, alter sessions, or need to run after every commit. A fresh Locus has no durable backing to compact.

The active manifest names ordered, bounded chunks for every application Library root, every complete Schema, and separate system state. The checkpoint metadata carries accumulated runtime-added private/shared ownership; source-defined original ownership remains in the source definition. Chunks contain semantic state with no generated QUID, identity epoch, or issued ledger. Checkpoint chunks are server-side storage records and must not be sent to clients.

Each encoded chunk is at most 1 MiB. A manifest is at most 16 MiB and describes at most 65,536 chunks. A large root spans multiple chunks; checkpoint encoding and restore do not construct a complete 64 MiB snapshot blob or require one root to fit the old 4 MiB exact-value default. These are practical storage bounds, not an unlimited authority-size guarantee. Explicit `captureHosted()` still produces a bounded monolithic artifact for its separate purpose.

The adapter stores each chunk and candidate manifest durably and exactly before `activateCheckpoint` atomically compares and swaps the active checkpoint identity. It must make `load` observe one active manifest and its ordered durable tail. `appendCommit` retains its revision-fenced, once-only Z1 contract. `pruneCommitsThrough` must verify that the named manifest is active and may then delete only records through its revision. A crash before activation leaves the old checkpoint and tail authoritative. A crash after activation and before pruning leaves redundant covered records, which restore ignores after validating their fence. Later revisions accepted while chunks are written remain in the tail. Orphaned staged chunks have no effect on restore. Storage providers can enumerate their own checkpoint keys and collect chunks absent from the active manifest in bounded batches after activation; cleanup is outside the authority decision.

An activation error is reconciled by reading the exact active checkpoint identity. If that read cannot establish the outcome, Locus closes the authority until reload. Missing or corrupt active chunks fail restore closed. Checkpoints use one current chunked manifest shape. Durable tail records remain `hson-locus-durable-aggregate-record` and carry `hson-livemap-durable-commit` semantic transitions plus Locus ownership additions for topology commits. Client projection snapshots, hosted live wire, and SSR formats are unchanged.

## Hosted cut and client state

`locus.cut(...)` captures the complete authoritative state, including private libraries. It is a server-side full-authority cut. A retained session represents one authorized client scope and produces a distinct authorized cut:

```ts
const session = await locus.session.create(
  { libraries: ["page", "state"], systemFeatures: ["interactions"] },
  { connection: { principalId: "alice" } },
);
const state = session.now();                 // { format, sessionBinding, libs, local, initializerDigest }
const response = session.now({ html: "page" }); // plus { html, document }
const credential = session.credential;
```

Creation requires no transport. One `libraries` request axis names shared authority libraries and local definitions. Shared inclusion requires read authorization; local inclusion requires authorization to deliver its seed. `writableDocuments` applies only to shared authority documents. Sessions are resumable by default; `{ resumable: false }` creates a session with no reattachment credential. Deliver the credential separately to the client. Neither current state nor HTML carries bearer authority.

`session.now()` captures shared current authority state in `libs` and authorized local definitions in `local`, with a separate `initializerDigest`. Its non-bearer `sessionBinding` identifies the retained session that produced it; Echo verifies that binding against the separately supplied credential. A client establishes one replica with `await hsonLiveMap.echo.create({ now, credential: session.credential!, transport })`. HTML is optional and must explicitly select an included shared document; local documents are never chosen for hosted SSR. Unknown, private, unselected, local, and data-library HTML selections reject without identifying hidden state.

The capability is stable through resumable disconnect, reattachment, and scope updates. Every operation validates with its owning manager. Revocation, expiry, goodbye, ephemeral release, or disposal makes cutting unavailable; a concurrent lifecycle or contract change fences the result. `session.revoke()` withdraws authority. `locus.session.get(id)` obtains the same capability for a connection-created session; IDs remain protocol routing keys. `locus.session.debug()`, `onChange(...)`, and `dispose()` manage aggregate session facilities.

The application owns the HTML shell, routing, headers, CSP, asset tags, and carrier placement. `new Response(now.html)` is valid when no browser continuation is needed. When continuation is needed, encode the whole `now` value so the text carrier preserves local definitions as well as `libs`. Local `LiveMap.cut()` SSR uses the distinct `libraries` payload family.

Echo creates missing local libraries from verified definitions in the same composed map. Existing local libraries win: scope retention, removal, re-add, replay, and reconcile do not overwrite them. Scope removal only stops future seed delivery. Local Schema and CSS operations behave as local LiveMap operations; shared Schema and CSS remain managed. Complete client loss cannot be repaired by Locus, so applications must persist evolving local state when that matters.

The current WebSocket adapter uses the `hson-locus-hosted-aggregate-message` wire envelope. Hidden runtime additions emit progress with no private topology. A session expansion emits a separate `projection-change` at the current authority revision. On reattachment, retained revisions replay under the client's prior contract; when replay is unsafe, reconcile derives the current authorized shared view through the same scope/capture machinery as `session.now()`. It updates only the shared partition before queued live traffic. Local state, unchanged authority handles, and unrelated Mirror/LiveTree resources survive.

Local `map.cut({ data?, documents?, html? })` produces selected transferable `libs` and optional coherent HTML. A selected document library renders itself with `render()`. Local one-library LiveMap constructors remain supported.

See [authorized client projections](./authorized-client-projection.md), [SSR composition](../ssr-composition.md), and [Echo API](../echo/api-echo.md).

## Graph-content roles

`hson-graph` represents exact runtime graph content, including local identity
metadata. `hson-graph-portable` represents hosted action content: its encoder omits
generated identities, and its decoder rejects identity claims before admission.
Neither form implies a durable or cross-runtime QUID address. Their format identities
are distinct because their admission rules differ; they have no numbered generations.
