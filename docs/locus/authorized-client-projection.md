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
