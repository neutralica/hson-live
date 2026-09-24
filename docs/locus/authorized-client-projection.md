# Hosted client projection configuration

Current status: hosted bootstrap, live publication, retained replay, recovery tail, snapshot fallback, cut, and SSR carrier all use one immutable session projection. The historical one-map hosted socket is retired; a one-library application uses the same fixed library-registry Locus.

Hosted Locus configuration classifies **every authority-owned application library** exactly once:

- `server-private`: never eligible for a framework client projection.
- `client-public`: eligible for projection, but not automatically included or authorized.

The classification is deployment policy supplied to Locus. It is absent from Hson roots, Schemas, LiveMap snapshots, and durable authority checkpoints. Transactional system state, currently interactions, is not an application library and receives no exposure entry. Future client-local libraries are also outside this authority exposure policy.

```ts
const locus = hsonLocus.create({
  map,
  exposure: [
    { library: "page", exposure: "client-public" },
    { library: "presentation", exposure: "client-public" },
    { library: "credentials", exposure: "server-private" },
  ],
  defaultProjection: {
    libraries: ["presentation"],
    htmlDocument: "page",
    systemFeatures: ["interactions"],
  },
  authorizeProjection: ({ connection, requested }) => ({
    libraries: connection?.principalId === "viewer" ? ["page", "presentation"] : [],
    systemFeatures: connection?.principalId === "viewer" ? ["interactions"] : [],
    writableDocuments: [],
  }),
});
```

The request uses one `libraries` set, optional `htmlDocument`, and optional `systemFeatures`. Selecting `htmlDocument` automatically requests that document library before security normalization. It must be a known, `client-public`, authorized document; otherwise session creation fails with one generic projection error. A request for another unavailable library simply yields no included library, without telling a client whether it was unknown, server-private, or unauthorized.

The effective session projection is the requested authority-library set intersected with `client-public` exposure and the principal's read grants. The read authorizer is separate from `authorizeAction`. With no `authorizeProjection` hook, read, system-feature, and built-in document-write grants are empty. An application that permits anonymous reads must grant them explicitly. Built-in document-write grants are a separate subset of included document libraries and do not follow from visibility.

An effective projection may contain zero authority libraries. Locus stores its normalized, frozen client contract and digest on the session; credential reattachment reuses that scope. A different scope requires a new session. The application can revoke a session with `locus.revokeSession(sessionId)` when policy changes; revocation fences its attachment rather than changing its registry in place. The digest covers included authority-library contracts, selected HTML document, features, write grants, and authority binding. It excludes roots, revisions, excluded libraries, runtime identity, and future client-local definitions.

A default projection is only a **default request** and still passes exposure and authorization. With no configured default, session creation without a request has an empty requested projection. The hosted cut requires a session ID, and a cut without an authorized selected HTML document fails unless a permitted document is supplied explicitly. It never infers all authority libraries or all `client-public` libraries.

**Step 6A historical status:** This phase stored policy and immutable session scope. Steps 6B–6E subsequently migrated all nominal hosted client egress.

## Mirror authority projection snapshot (Step 6B)

Mirror now has a versioned `hson-authority-projection-snapshot-v1` contract. It is derived from one atomic complete authority capture and the session's already-normalized effective projection. Its library list contains only selected, authorized, `client-public` contracts and their QUID-free roots. Excluded names, Schemas, roots, original registry positions, the complete registry digest, policy, and runtime identity are absent from the serialized value. The optional selected HTML document, system-feature selection, and built-in document-write grants remain bound to the Step 6A projection digest. An enabled interactions feature carries the current descriptors whose subjects are included authority document libraries; disabled interactions have `system: null`, while enabled interactions with no visible descriptors carry an empty state.

The snapshot's `revision` is the Locus authority position for Echo's `authorityRev`. A newly composed client LiveMap starts with its own `map.rev` under normal local initialization. `hsonLiveMap.fromClientSnapshot({ authority, localLibraries })` accepts the projected authority snapshot, validates it in full, and composes client-local declarations separately. A projection with zero authority libraries is valid when local declarations supply a LiveMap. With neither projected nor local libraries, use endpoint-only Echo.

The framework excludes hidden authority state; application-authored sensitive text placed in an included Schema, root, interaction argument, or behavior/action key is part of the permitted payload and cannot be inferred as secret by Mirror.

**Step 6B historical status:** At that point hosted bootstrap, live publication, replay, fallback, and hosted cut/SSR still used complete authority client representations. Steps 6C–6D migrated replication below. Authority persistence and exact runtime capture remain complete and exposure-neutral.

### Format and egress inventory

| Format or path | Step 6B status |
| --- | --- |
| `hson-authority-projection-snapshot-v1` | New projection-only contract and codec. |
| `hson-livemap-client-snapshot-v1` | Existing complete-registry recovery and hosted cut representation; its meaning was not changed. Later egress migration must cut this client-facing use. |
| `hson-hosted-client-commit-v1` and `hson-locus-hosted-client-commit-v1` | Existing complete-registry replay and recovery-tail effects; ordinary live publication now uses the Step 6C v2 formats. |
| `hson-locus-hosted-aggregate-message-v3` | Existing hosted socket envelope; unchanged by Step 6C. |
| `hson-ssr-bootstrap` version 2 | Existing hosted SSR bootstrap; later hosted cut/SSR migration. |
| Authority aggregate snapshots, exact runtime capture, and durable checkpoints | Authority-internal and complete by design; unchanged. |

## Live authority revision projection (Step 6C)

The live Locus publication path now projects each accepted authority revision separately for each session, using that session's immutable effective projection. Every revision yields exactly one event at the original authority position: a projected commit when there is a visible effect, or progress when there is none. Hidden application effects are omitted; mixed commits retain all visible effects in one atomic commit. Different sessions can therefore receive different events for the same revision. No complete registry positions, excluded names, or generated QUIDs are sent in a projected live commit. Before acceptance, Locus checks the live and recovery framing for every still-resumable session, including disconnected and recovering sessions. A known oversized event for any such session rejects the whole authority candidate. Revoked or expired sessions are excluded from the next roster; a revocation after a roster cut does not invalidate that candidate.

Interaction replication uses the projected **resulting** state. Locus projects the before and after interaction roots and emits one replacement of the visible state only when they differ. A hidden descriptor change alone yields progress. The projector accepts a complete authority transition and its before and after cuts; Step 6D reuses that semantic boundary for retained replay. Complete authority history and durable persistence remain projection-neutral.

Echo validates live commit and progress continuity against `authorityRev`. A projected commit installs one local LiveMap transition and advances `map.rev` according to local state changes. Progress advances `authorityRev` and completion waiters without graph work or a `map.rev` increment on a composed client map. Client-local mutations advance only `map.rev`; they cannot satisfy authority completion or create authority-stream gaps. Mirror follows local transitions.

The new live payloads use `hson-locus-live-projected-client-commit-v2` inside `hson-locus-live-projected-client-wire-v2`. At Step 6C, the older complete commit v1 formats still served recovery and the hosted socket envelope was v3. Step 6D retired that recovery use and bumped the envelope to v4. Echo-to-Locus authoring/graph-op formats and SSR bootstrap version 2 remain unchanged.

**Step 6C historical status:** Bootstrap, recovery, and hosted cut/SSR had not yet migrated. Step 6D now projects bootstrap and recovery. Action results and application errors remain application-controlled egress outside the replicated-state projector.

The preceding Step 6C status describes that release only. Step 6D supersedes its
bootstrap and recovery status below. Local `map.cut()` remains a structural API,
not an authorization boundary.

## Projected bootstrap and recovery (Step 6D)

The effective projection is stored on the session at creation. Bootstrap takes
one atomic authority cut and sends `hson-authority-projection-snapshot-v1` for
that stored projection. Echo validates the snapshot before constructing or
restoring its composed LiveMap. Its authority cursor starts at the snapshot
revision; the client map starts at its ordinary local revision. Client-local
definitions, handles, QUIDs, subscriptions, and Mirror resources belong to the
composed client map and are independent of authority state.

Recovery requests carry Echo's authority cursor and the projection digest,
along with the authority incarnation and projected registry digest. Reattachment
reuses the session's stored projection; it does not authorize a new one. A
projection mismatch is fenced. Every retained authority revision is passed
through the same Step 6C projector as live publication. Visible revisions
become projected commits at their original revision; invisible revisions become
progress. Retained interaction replay uses the recorded before and after system
roots, so hidden interaction changes do not appear in the wire payload.

When history is insufficient, Locus sends a fresh projected snapshot under the
same session scope. Echo installs only the authority-projected part of its
composed map. The local map identity epoch and client-local resources survive.
Projected bootstrap, fallback, cut, and hosted SSR capture the session's selected
application roots directly from one authority revision. Excluded roots are not
encoded for these artifacts. The 64 MiB projected snapshot bound applies to the
projected artifact itself; an included root may exceed the generic exact codec's
4 MiB default only while that artifact stays within its bound. Complete server
capture and persistent checkpoint/compaction still have separate monolithic
resource limits; large persistent checkpoint support remains future work.
The successful install advances Echo's authority cursor to the snapshot
revision; any later tail revisions are projected and processed in order.
`map.rev` remains the local graph revision and may differ. Generated authority
QUIDs never cross bootstrap or recovery transport. Completion at revision C
becomes ready only after Echo has successfully processed authority through C.

The hosted socket envelope is `hson-locus-hosted-aggregate-message-v4` because
recovery cursor, plan, and caught-up messages now bind the projection digest.
Projected commits retain the Step 6C v2 payload contract. The complete client
snapshot and commit v1 formats remain in authority-internal durable restore and
legacy SSR/cut machinery, but are no longer accepted as hosted replication
bootstrap or recovery egress. Durable authority state remains complete,
exposure-neutral, and QUID-free as required by its own persistence contract.

At the end of Step 6D, hosted cut and SSR were the remaining projected egress
work. Step 6E's session cut and hosted SSR version 3 are described below.

### Current format disposition

| Format | Step 6D use |
| --- | --- |
| `hson-authority-projection-snapshot-v1` | Active bootstrap and fallback client egress. |
| `hson-locus-live-projected-client-commit-v2` / `hson-locus-live-projected-client-wire-v2` | Active live, replay, and tail client egress. |
| `hson-livemap-client-snapshot-v1` | Internal composition adapter and later hosted cut/SSR migration; retired from hosted replication egress. |
| `hson-hosted-client-commit-v1` | Internal LiveMap replay adapter and durable conversion; retired from hosted replication egress. |
| `hson-locus-hosted-client-commit-v1` | Authority-internal legacy aggregate helper; retired from hosted socket egress. |
| `hson-locus-hosted-aggregate-message-v4` | Active hosted socket envelope. v3 is retired. |
| `hson-ssr-bootstrap` version 2 | Local SSR only; hosted v2 kinds are retired. |

## Session cut and projected SSR carrier (Step 6E work in progress)

The multi-library `locus.cut(sessionId, document?)` uses the stored effective
projection for that session and captures authority once. The returned
`{ html, data, document, revision, projectionDigest }` holds authorized HTML and
an `AuthorityProjectionSnapshot` from the same revision. The renderer receives
only the selected projected document root. An existing cut remains stable when
authority advances. A revoked session cannot begin another cut.

`render_hosted_document({ authority: locus, sessionId })` delegates to that cut.
Encoded projected SSR uses `hson-ssr-bootstrap` version 3 and kind
`hosted-projection`; version 2 remains for local SSR only. The legacy complete
hosted version-2 kinds reject during encoding and decoding. Browser
composition installs client-local declarations separately, starts `map.rev`
locally, and initializes Echo's authority cursor from the projected snapshot
revision. HTML-only responses remain valid. Framework-generated browser HTML
and portable projected state contain no server runtime QUIDs.

The public raw one-map capture and Node HTTP bootstrap helper are retired.
Multi-library `continue_hosted_document` requires the decoded projected
snapshot and checks its digest, authority binding, selected document, and
revision before adopting DOM. The historical one-map Locus socket protocol is
retired. One-library hosted applications use the library-registry Locus and the
same projected socket. The nominal framework Step 6 client-egress gate is
closed; arbitrary application-authored Responses remain the application's
responsibility.
