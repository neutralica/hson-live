# Locus API

`Locus` governs one application library registry and separate system state. The registry may grow while the authority runs. A hosted client obtains an authorized session projection before receiving framework state.

```ts
import { create_locus } from "hson-live/locus";
import { hsonLiveMap } from "hson-live/livemap";

const map = hsonLiveMap.fromLibraries({
  page: { document: "<main/>" },
});
const locus = create_locus({
  map,
  libraries: [{ name: "page", ownership: "shared" }],
  authorizeProjection: () => ({ libraries: ["page"] }),
});
```

The construction catalog classifies every application definition as `private`, `shared`, or `local`. Private and shared libraries must already exist in `locus.map`; local entries instead carry a detached initializer and never enter that authority map. Shared eligibility remains separate from authorization. A selected HTML document must be an authorized shared document. `defaultProjection`, when configured, is only a default request and still passes authorization.

After construction, admit an atomic authority batch with `await locus.lib.add(definitions, { ownership })`. Ownership is a per-name `private | shared` object; omitted own entries default to `private`. Runtime local-definition admission is deliberately not part of this API in this release. Direct `map.addLibraries` on the managed authority remains fenced. A shared classification only makes a name eligible; it never changes an existing session grant.

`await session.update({ libraries: ["page", "newPage"] })` reauthorizes a retained scope against current topology with the ordinary `authorizeProjection` callback. A connected session uses its attachment's current trusted context. A server-created session can use its creation context; an ordinary disconnected connection-created session requires current trusted context as the second argument, for example `{ principalId: "alice" }`. Principal continuity is enforced. Requests select libraries and system features; read and write grants come from the authorizer. Successful changes advance the session contract sequence and digest without creating an authority revision. Removed library handles become stale; a later grant produces new handles.

`create_persistent_locus` uses the same catalog. Durable authority checkpoints contain private/shared current state and never evolving client-owned local state. Ownership and local initializer definitions remain deployment configuration in this release. Application code may read `locus.map` and private state for server work, and remains responsible for arbitrary HTML or `Response` values it writes itself.

A restored persistent runtime gives reconnecting clients a projected snapshot for cursors at or before its loaded revision. This reestablishes client identity after restart even when durable authority revision and incarnation are unchanged.

## Persistence

`create_persistent_locus` and `locus.checkpoint()` write complete authority state in the internal `hson-locus-durable-aggregate-checkpoint` format. One active manifest names ordered, bounded chunks for every application Library root, every complete Schema, and the separate system-state root. The chunks contain semantic state with no generated QUID, identity epoch, issued ledger, or client ownership catalog. A deployment supplies and validates the catalog again after restart. Checkpoint chunks are server-side storage records and must not be sent to clients.

Each encoded chunk is at most 1 MiB. A manifest is at most 16 MiB and describes at most 65,536 chunks. A large root spans multiple chunks; checkpoint encoding and restore do not construct a complete 64 MiB snapshot blob or require one root to fit the old 4 MiB exact-value default. These are practical storage bounds, not an unlimited authority-size guarantee. Explicit `captureHosted()` still produces a bounded monolithic artifact for its separate purpose.

The adapter stores each chunk and candidate manifest durably and exactly before `activateCheckpoint` atomically compares and swaps the active checkpoint identity. It must make `load` observe one active manifest and its ordered durable tail. `appendCommit` retains its revision-fenced, once-only Z1 contract. `pruneCommitsThrough` must verify that the named manifest is active and may then delete only records through its revision. A crash before activation leaves the old checkpoint and tail authoritative. A crash after activation and before pruning leaves redundant covered records, which restore ignores after validating their fence. Later revisions accepted while chunks are written remain in the tail. Orphaned staged chunks have no effect on restore. Storage providers can enumerate their own checkpoint keys and collect chunks absent from the active manifest in bounded batches after activation; cleanup is outside the authority decision.

An activation error is reconciled by reading the exact active checkpoint identity. If that read cannot establish the outcome, Locus closes the authority until reload. Missing or corrupt active chunks fail restore closed. Checkpoints use one current chunked manifest shape. Durable tail records remain `hson-locus-durable-aggregate-record` and carry `hson-livemap-durable-commit` semantic transitions. Client projection snapshots, hosted live wire, and SSR formats are unchanged.

## Hosted cut and client state

`locus.map` is the complete authoritative LiveMap, including private libraries. Use `locus.map.cut(...)` for authority state. A retained session represents one authorized client scope:

```ts
const session = await locus.session.create(
  { libraries: ["page", "state"], systemFeatures: ["interactions"] },
  { connection: { principalId: "alice" } },
);
const state = session.now();                 // { format, libs, local, initializerDigest }
const response = session.now({ html: "page" }); // plus { html, document }
const credential = session.credential;
```

Creation requires no transport. One `libraries` request axis names shared authority libraries and local definitions. Shared inclusion requires read authorization; local inclusion requires authorization to deliver its seed. `writableDocuments` applies only to shared authority documents. Sessions are resumable by default; `{ resumable: false }` creates a session with no reattachment credential. Deliver the credential separately to the client. Neither current state nor HTML carries bearer authority.

`session.now()` captures shared current authority state in `libs` and authorized local definitions in `local`, with a separate `initializerDigest`. A client establishes one replica with `await hsonEcho.init({ now, credential: session.credential!, socket })`. HTML is optional and must explicitly select an included shared document; local documents are never chosen for hosted SSR. Unknown, private, unselected, local, and data-library HTML selections reject without identifying hidden state.

The capability is stable through resumable disconnect, reattachment, and scope updates. Every operation validates with its owning manager. Revocation, expiry, goodbye, ephemeral release, or disposal makes cutting unavailable; a concurrent lifecycle or contract change fences the result. `session.revoke()` withdraws authority. `locus.session.get(id)` obtains the same capability for a connection-created session; IDs remain protocol routing keys. `locus.session.debug()`, `onChange(...)`, and `dispose()` manage aggregate session facilities.

The application owns the HTML shell, routing, headers, CSP, asset tags, and carrier placement. `new Response(now.html)` is valid when no browser continuation is needed. When continuation is needed, encode the whole `now` value so the text carrier preserves local definitions as well as `libs`. Local `LiveMap.cut()` SSR uses the distinct `libraries` payload family.

Echo creates missing local libraries from verified definitions in the same composed map. Existing local libraries win: scope retention, removal, re-add, replay, and reconcile do not overwrite them. Scope removal only stops future seed delivery. Local Schema and CSS operations behave as local LiveMap operations; shared Schema and CSS remain managed. Complete client loss cannot be repaired by Locus, so applications must persist evolving local state when that matters.

The active hosted socket is `hson-locus-hosted-aggregate-message`. Hidden runtime additions emit progress with no private topology. A session expansion emits a separate `projection-change` at the current authority revision. On reattachment, retained revisions replay under the client's prior contract; when replay is unsafe, reconcile derives the current authorized shared view through the same scope/capture machinery as `session.now()`. It updates only the shared partition before queued live traffic. Local state, unchanged authority handles, and unrelated Mirror/LiveTree resources survive.

Local `map.cut({ data?, documents?, html? })` produces selected transferable `libs` and optional coherent HTML. A selected document library renders itself with `render()`. Local one-library LiveMap constructors remain supported.

See [authorized client projections](./authorized-client-projection.md), [SSR composition](../ssr-composition.md), and [Echo API](../echo/api-echo.md).

## Graph-content roles

`hson-graph` represents exact runtime graph content, including local identity
metadata. `hson-graph-portable` represents hosted action content: its encoder omits
generated identities, and its decoder rejects identity claims before admission.
Neither form implies a durable or cross-runtime QUID address. Their format identities
are distinct because their admission rules differ; they have no numbered generations.
