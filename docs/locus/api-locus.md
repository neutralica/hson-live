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

`await locus.sessions.updateProjection(sessionId, request)` reauthorizes an attached session against current topology using that connection's current context and the ordinary `authorizeProjection` callback. For a disconnected resumable session, pass a current trusted connection context as the third argument, for example `await locus.sessions.updateProjection(sessionId, { libraries: ["page", "newPage"] }, { principalId: "alice" })`; Locus checks principal continuity before authorization. Requests name the desired libraries and optional document, system features, and write scope. Grants remain exact sets of names: an addition to the authority does not expand an old grant. The same operation may expand, contract, or replace the effective grant. Successful changes advance a session projection sequence and digest without creating an authority revision. Revoked library handles become stale, and a later grant produces new current handles.

`create_persistent_locus` uses the same registry ontology. Durable authority checkpoints remain complete and server-side; exposure is not serialized into them. After restart the application supplies classifications for every restored library, including runtime additions. Application code may read `locus.map` and private state for server work, and remains responsible for arbitrary HTML or `Response` values it writes itself.

A restored persistent runtime gives reconnecting clients a projected snapshot for cursors at or before its loaded revision. This reestablishes client identity after restart even when durable authority revision and incarnation are unchanged.

## Persistence

`create_persistent_locus` and `locus.checkpoint()` write complete authority state in the internal `hson-locus-durable-aggregate-checkpoint-v2` format. One active manifest names ordered, bounded chunks for every application Library root, every complete Schema, and the separate system-state root. The chunks contain semantic state with no generated QUID, identity epoch, issued ledger, or client exposure policy. A deployment supplies and validates exposure again after restart. Checkpoint chunks are server-side storage records and must not be sent to clients.

Each encoded chunk is at most 1 MiB. A manifest is at most 16 MiB and describes at most 65,536 chunks. A large root spans multiple chunks; checkpoint encoding and restore do not construct a complete 64 MiB snapshot blob or require one root to fit the old 4 MiB exact-value default. These are practical storage bounds, not an unlimited authority-size guarantee. Explicit `captureHosted()` still produces a bounded monolithic artifact for its separate purpose.

The adapter stores each chunk and candidate manifest durably and exactly before `activateCheckpoint` atomically compares and swaps the active checkpoint identity. It must make `load` observe one active manifest and its ordered durable tail. `appendCommit` retains its revision-fenced, once-only Z1 contract. `pruneCommitsThrough` must verify that the named manifest is active and may then delete only records through its revision. A crash before activation leaves the old checkpoint and tail authoritative. A crash after activation and before pruning leaves redundant covered records, which restore ignores after validating their fence. Later revisions accepted while chunks are written remain in the tail. Orphaned staged chunks have no effect on restore. Storage providers can enumerate their own checkpoint keys and collect chunks absent from the active manifest in bounded batches after activation; cleanup is outside the authority decision.

An activation error is reconciled by reading the exact active checkpoint identity. If that read cannot establish the outcome, Locus closes the authority until reload. Missing or corrupt active chunks fail restore closed. Old v1 checkpoints reject as unsupported; new checkpoints write only the current chunked v2 manifest. Durable tail records remain `hson-locus-durable-aggregate-record-v1` and carry `hson-livemap-durable-commit-v1` semantic transitions. Client projection snapshots, hosted live wire, and SSR formats are unchanged.

## Hosted cut and client state

After a session is established, `locus.cut(sessionId, document?)` produces an object-owned authorized cut. Its `html` and `data` (`AuthorityProjectionSnapshot`) come from one coherent authority revision and the session's current effective projection. It rejects a revoked session and any private, unselected, wrong-kind, or otherwise unauthorized document choice without naming hidden libraries. A zero-argument cut needs an authorized `htmlDocument`; no first-document fallback exists.

The application owns the HTML shell, routing, headers, CSP, asset tags, and bootstrap placement. `new Response(cut.html)` is valid when no browser continuation is needed. When continuation is needed, encode the projected state from that same cut with the hosted SSR bootstrap v3 `hosted-projection` contract. Local SSR still uses its separate version 2 contract.

The browser composes client-local libraries separately with the authority projection. Echo starts `authorityRev` from the authority snapshot revision; its `map.rev` follows ordinary local LiveMap revisions. Hosted continuation checks projection identity, authority binding and revision, then adopts matching DOM before installing Mirror. It does not compare server-generated QUIDs.

The active hosted socket is `hson-locus-hosted-aggregate-message-v7`. Hidden runtime additions emit progress with no private topology. A session expansion emits a separate `projection-change` event at the current authority revision. Contraction reconciles the authority-owned projection in the same client map. On reattachment, retained revisions replay under the client's prior session contract, then a disconnected expansion installs its currently authorized state at the recovery cut before queued live traffic. If retained history is unavailable, Echo reconciles a current authorized snapshot into only the authority-owned portion of its existing map, then applies the queued tail. Client-local state, unchanged authority handles, and unrelated Mirror/LiveTree resources survive. A Locus process restart loses its in-memory replay window and uses this fallback path.

Local `render_document(...)` pairs browser-compatible HTML with a detached continuation bootstrap without an authorization boundary. Local one-library LiveMap constructors remain supported.

See [authorized client projections](./authorized-client-projection.md), [SSR composition](../ssr-composition.md), and [Echo API](../echo/api-echo.md).
