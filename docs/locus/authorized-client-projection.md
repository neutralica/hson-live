# Hosted client projection configuration (Step 6A)

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

A default projection is only a **default request** and still passes exposure and authorization. With no configured default, session creation without a request has an empty requested projection. A future zero-argument hosted cut must fail without an explicit default; it must never infer all authority libraries or all `client-public` libraries. No projected cut is implemented in Step 6A.

**Security release gate:** Step 6A stores policy and immutable session scope, but current hosted bootstrap, commits, recovery, Echo construction, and cut/SSR output still use the complete authority representation. Do not use the current hosted client path as a private-state egress boundary. Selective client codec and publication work in later Step 6 subphases must replace every such path before `server-private` is enforced on client bytes.

## Mirror authority projection snapshot (Step 6B)

Mirror now has a versioned `hson-authority-projection-snapshot-v1` contract. It is derived from one atomic complete authority capture and the session's already-normalized effective projection. Its library list contains only selected, authorized, `client-public` contracts and their QUID-free roots. Excluded names, Schemas, roots, original registry positions, the complete registry digest, policy, and runtime identity are absent from the serialized value. The optional selected HTML document, system-feature selection, and built-in document-write grants remain bound to the Step 6A projection digest. An enabled interactions feature carries the current descriptors whose subjects are included authority document libraries; disabled interactions have `system: null`, while enabled interactions with no visible descriptors carry an empty state.

The snapshot's `revision` is the Locus authority position for Echo's `authorityRev`. A newly composed client LiveMap starts with its own `map.rev` under normal local initialization. `hsonLiveMap.fromClientSnapshot({ authority, localLibraries })` accepts the projected authority snapshot, validates it in full, and composes client-local declarations separately. A projection with zero authority libraries is valid when local declarations supply a LiveMap. With neither projected nor local libraries, use endpoint-only Echo.

The framework excludes hidden authority state; application-authored sensitive text placed in an included Schema, root, interaction argument, or behavior/action key is part of the permitted payload and cannot be inferred as secret by Mirror.

**Security release gate remained incomplete at Step 6B.** Hosted bootstrap, live publication, replay, snapshot fallback transport, and hosted cut/SSR still used their previous complete-authority client representations. Step 6C migrates ordinary live publication below. Authority persistence and exact runtime capture remain complete and exposure-neutral.

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

The live Locus publication path now projects each accepted authority revision separately for each attached session, using that session's immutable effective projection. Every revision yields exactly one event at the original authority position: a projected commit when there is a visible effect, or progress when there is none. Hidden application effects are omitted; mixed commits retain all visible effects in one atomic commit. Different sessions can therefore receive different events for the same revision. No complete registry positions, excluded names, or generated QUIDs are sent in a projected live commit. Locus checks each active session's encoded live frame against its wire bound before accepting the revision.

Interaction replication uses the projected **resulting** state. Locus projects the before and after interaction roots and emits one replacement of the visible state only when they differ. A hidden descriptor change alone yields progress. The projector accepts a complete authority transition and its before and after cuts, so retained replay can reuse the same semantic boundary in a later phase. Complete authority history and durable persistence remain projection-neutral.

Echo validates live commit and progress continuity against `authorityRev`. A projected commit installs one local LiveMap transition and advances `map.rev` according to local state changes. Progress advances `authorityRev` and completion waiters without graph work or a `map.rev` increment on a composed client map. Client-local mutations advance only `map.rev`; they cannot satisfy authority completion or create authority-stream gaps. Mirror follows local transitions.

The new live payloads use `hson-locus-live-projected-client-commit-v2` inside `hson-locus-live-projected-client-wire-v2`. The older `hson-hosted-client-commit-v1` and `hson-locus-hosted-client-commit-v1` retain their complete-authority recovery meaning. The hosted socket envelope remains `hson-locus-hosted-aggregate-message-v3`, and Echo-to-Locus authoring/graph-op formats are unchanged. `hson-authority-projection-snapshot-v1` and SSR bootstrap version 2 are unchanged.

**Security release gate remains incomplete.** Hosted bootstrap, retained-history replay, recovery tail, snapshot fallback transport, and hosted cut/SSR still use complete-authority client representations. The old QUID-bearing recovery probe is unchanged. Action results and application errors are application-controlled egress outside the replicated-state projector. Do not use the overall hosted client path as a private-state boundary until the remaining paths are migrated.

The old complete client snapshot is still used by hosted session bootstrap/recovery, replay fallback, and SSR. The new `fromClientSnapshot` construction seam accepts the projection-only contract; the old complete format remains inside the legacy transport machinery until those egress paths are migrated. Local `map.cut()` remains a structural API, not an authorization boundary.
