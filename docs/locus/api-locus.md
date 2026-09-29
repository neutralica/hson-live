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
  exposure: [{ library: "page", exposure: "client-public" }],
  authorizeProjection: () => ({ libraries: ["page"] }),
});
```

Every application library needs one explicit `client-public` or `server-private` exposure entry. Public exposure makes a library eligible; the session projection and read authorizer determine what this particular client receives. A one-library registry is not implicitly selected or public. A selected HTML document must be an authorized document in the effective projection. `defaultProjection`, when configured, is a default *request* and still passes authorization.

After construction, admit an atomic batch with `await locus.lib.add(definitions, { exposure })`. Definitions have the same `data` or `document` and optional `schema` fields as `map.addLibraries`. Exposure is a per-name object, for example `{ page: "client-public", credentials: "server-private" }`; omitted own entries default to `server-private`. Locus captures the batch's names and exposure before queuing durable admission, so later changes to the caller's definitions object cannot admit an unclassified name. Direct `map.addLibraries` on the managed authority remains fenced. A public classification only makes a name eligible; it never changes an existing session grant.

`await session.update({ libraries: ["page", "newPage"] })` reauthorizes a retained scope against current topology with the ordinary `authorizeProjection` callback. A connected session uses its attachment's current trusted context. A server-created session can use its creation context; an ordinary disconnected connection-created session requires current trusted context as the second argument, for example `{ principalId: "alice" }`. Principal continuity is enforced. Requests select libraries and system features; read and write grants come from the authorizer. Successful changes advance the session contract sequence and digest without creating an authority revision. Removed library handles become stale; a later grant produces new handles.

`create_persistent_locus` uses the same registry ontology. Durable authority checkpoints remain complete and server-side; exposure is not serialized into them. After restart the application supplies classifications for every restored library, including runtime additions. Application code may read `locus.map` and private state for server work, and remains responsible for arbitrary HTML or `Response` values it writes itself.

A restored persistent runtime gives reconnecting clients a projected snapshot for cursors at or before its loaded revision. This reestablishes client identity after restart even when durable authority revision and incarnation are unchanged.

## Persistence

`create_persistent_locus` and `locus.checkpoint()` write complete authority state in the internal `hson-locus-durable-aggregate-checkpoint` format. One active manifest names ordered, bounded chunks for every application Library root, every complete Schema, and the separate system-state root. The chunks contain semantic state with no generated QUID, identity epoch, issued ledger, or client exposure policy. A deployment supplies and validates exposure again after restart. Checkpoint chunks are server-side storage records and must not be sent to clients.

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
const state = session.cut();                 // { libs }
const response = session.cut({ html: "page" }); // { libs, html, document }
const credential = session.credential;
```

Creation requires no transport. It uses the same request, exposure, read authorizer, and system/write grant pipeline as connection-created sessions. Sessions are resumable by default; `{ resumable: false }` creates a session with no reattachment credential. Deliver the credential separately to the client, then pass it to Echo's `session: { credential }` configuration. Neither ordinary `libs` nor HTML carries bearer authority.

`session.cut()` captures the complete current effective scope as `AuthorityProjectionSnapshot` in `libs`. Compose it with `hsonLiveMap.fromClientSnapshot({ authority: cut.libs, localLibraries: {} })`. HTML is optional and must explicitly select an already-included document. Unknown, private, unselected, and data-library selections reject without identifying hidden state. HTML uses the captured root and CSS from the same cut, within the 64 MiB aggregate snapshot bound; depth and node limits remain in force.

The capability is stable through resumable disconnect, reattachment, and scope updates. Every operation validates with its owning manager. Revocation, expiry, goodbye, ephemeral release, or disposal makes cutting unavailable; a concurrent lifecycle or contract change fences the result. `session.revoke()` withdraws authority. `locus.session.get(id)` obtains the same capability for a connection-created session; IDs remain protocol routing keys. `locus.session.debug()`, `onChange(...)`, and `dispose()` manage aggregate session facilities.

The application owns the HTML shell, routing, headers, CSP, asset tags, and bootstrap placement. `new Response(cut.html)` is valid when no browser continuation is needed. When continuation is needed, encode the `libs` from that same cut with the hosted SSR bootstrap `hosted-projection` contract. Local SSR uses the distinct `libraries` payload family.

The browser composes client-local libraries separately with the authority projection. Echo starts `authorityRev` from the authority snapshot revision; its `map.rev` follows ordinary local LiveMap revisions. Hosted continuation checks projection identity, authority binding and revision, then adopts matching DOM before installing Mirror. It does not compare server-generated QUIDs.

The active hosted socket is `hson-locus-hosted-aggregate-message`. Hidden runtime additions emit progress with no private topology. A session expansion emits a separate `projection-change` event at the current authority revision. Contraction reconciles the authority-owned projection in the same client map. On reattachment, retained revisions replay under the client's prior session contract, then a disconnected expansion installs its currently authorized state at the recovery cut before queued live traffic. If retained history is unavailable, Echo reconciles a current authorized snapshot into only the authority-owned portion of its existing map, then applies the queued tail. Client-local state, unchanged authority handles, and unrelated Mirror/LiveTree resources survive. A Locus process restart loses its in-memory replay window and uses this fallback path.

Local `map.cut({ data?, documents?, html? })` produces selected transferable `libs` and optional coherent HTML. A selected document library renders itself with `render()`. Local one-library LiveMap constructors remain supported.

See [authorized client projections](./authorized-client-projection.md), [SSR composition](../ssr-composition.md), and [Echo API](../echo/api-echo.md).

## Graph-content roles

`hson-graph` represents exact runtime graph content, including local identity
metadata. `hson-graph-portable` represents hosted action content: its encoder omits
generated identities, and its decoder rejects identity claims before admission.
Neither form implies a durable or cross-runtime QUID address. Their format identities
are distinct because their admission rules differ; they have no numbered generations.
