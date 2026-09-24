# Locus API

`Locus` governs one fixed application library registry and separate system state. The registry may contain one library or many; its cardinality does not change the hosted protocol. A hosted client obtains an authorized session projection before receiving framework state.

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

`create_persistent_locus` uses the same registry ontology. Durable authority checkpoints remain complete and server-side; exposure is not serialized into them. Application code may read `locus.map` and private state for server work, and remains responsible for arbitrary HTML or `Response` values it writes itself.

## Persistence

`create_persistent_locus` and `locus.checkpoint()` write complete authority state in the internal `hson-locus-durable-aggregate-checkpoint-v2` format. One active manifest names ordered, bounded chunks for every application Library root, every complete Schema, and the separate system-state root. The chunks contain semantic state with no generated QUID, identity epoch, issued ledger, or client exposure policy. A deployment supplies and validates exposure again after restart. Checkpoint chunks are server-side storage records and must not be sent to clients.

Each encoded chunk is at most 1 MiB. A manifest is at most 16 MiB and describes at most 65,536 chunks. A large root spans multiple chunks; checkpoint encoding and restore do not construct a complete 64 MiB snapshot blob or require one root to fit the old 4 MiB exact-value default. These are practical storage bounds, not an unlimited authority-size guarantee. Explicit `captureHosted()` still produces a bounded monolithic artifact for its separate purpose.

The adapter stores each chunk and candidate manifest durably and exactly before `activateCheckpoint` atomically compares and swaps the active checkpoint identity. It must make `load` observe one active manifest and its ordered durable tail. `appendCommit` retains its revision-fenced, once-only Z1 contract. `pruneCommitsThrough` must verify that the named manifest is active and may then delete only records through its revision. A crash before activation leaves the old checkpoint and tail authoritative. A crash after activation and before pruning leaves redundant covered records, which restore ignores after validating their fence. Later revisions accepted while chunks are written remain in the tail. Orphaned staged chunks have no effect on restore. Storage providers can enumerate their own checkpoint keys and collect chunks absent from the active manifest in bounded batches after activation; cleanup is outside the authority decision.

An activation error is reconciled by reading the exact active checkpoint identity. If that read cannot establish the outcome, Locus closes the authority until reload. Missing or corrupt active chunks fail restore closed. Old v1 checkpoints reject as unsupported; new checkpoints write only the current chunked v2 manifest. Durable tail records remain `hson-locus-durable-aggregate-record-v1` and carry `hson-livemap-durable-commit-v1` semantic transitions. Client projection snapshots, hosted live wire, and SSR formats are unchanged.

## Hosted cut and client state

After a session is established, `locus.cut(sessionId, document?)` produces an object-owned authorized cut. Its `html` and `data` (`AuthorityProjectionSnapshot`) come from one coherent authority revision and the session's stored immutable projection. It rejects a revoked session and any private, unselected, wrong-kind, or otherwise unauthorized document choice without naming hidden libraries. A zero-argument cut needs an authorized `htmlDocument`; no first-document fallback exists.

The application owns the HTML shell, routing, headers, CSP, asset tags, and bootstrap placement. `new Response(cut.html)` is valid when no browser continuation is needed. When continuation is needed, encode the projected state from that same cut with the hosted SSR bootstrap v3 `hosted-projection` contract. Local SSR still uses its separate version 2 contract.

The browser composes client-local libraries separately with the authority projection. Echo starts `authorityRev` from the authority snapshot revision; its `map.rev` follows ordinary local LiveMap revisions. Hosted continuation checks projection identity, authority binding and revision, then adopts matching DOM before installing Mirror. It does not compare server-generated QUIDs.

The active hosted socket is `hson-locus-hosted-aggregate-message-v4`. It projects bootstrap, live commits or progress, retained replay, recovery tail, and snapshot fallback for the stored session projection. Reattachment reuses that projection; revocation fences new cuts and transport work.

Ordinary local `map.cut()` and `libraries.cut(...)` remain structural APIs, not authorization boundaries. Local one-library LiveMap constructors remain supported.

See [authorized client projections](./authorized-client-projection.md), [SSR composition](../ssr-composition.md), and [Echo API](../echo/api-echo.md).
