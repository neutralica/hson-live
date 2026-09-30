# Authorized hosted client projection

Locus owns a single current authority map containing private and shared libraries, plus a deployment catalog of canonical local initializers. Local definitions are not installed in `locus.map`, committed, checkpointed, or replayed. The session request and `authorizeProjection` decide which shared state and local initializers may be delivered. With no authorizer, all grants are empty.

```ts
const locus = hsonLocus.create({
  map,
  libraries: [
    { name: "page", ownership: "shared" },
    { name: "credentials", ownership: "private" },
    { name: "ui", ownership: "local", initializer: { data: { open: false }, schema: UiSchema } },
  ],
  authorizeProjection: () => ({ libraries: ["page"], writableDocuments: [] }),
});
```

A retained session stores one normalized effective composition, digest, and sequence. Request membership, ownership, and read authorization must all hold. A local grant authorizes seed delivery only; it never creates server write authority.

`session.update(request, context?)` reruns authorization for scope changes. Connected sessions use their current connection context; server-created sessions retain their creation context, and disconnected connection-created sessions require current trusted context. Principal continuity remains enforced. Future public libraries do not automatically enter an existing grant. `defaultProjection` is only a default request, subject to the same authorization.

`session.now()` returns `{ format, sessionBinding, libs, local, initializerDigest }`; the HTML form additionally returns `{ html, document }`. `sessionBinding` is a non-bearer retained-session provenance value verified against the separately delivered `session.credential`. `libs` remains exclusively current shared authority state. `local` contains immutable canonical QUID-free initializers with Schema, root, validated document CSS, and content fingerprints. HTML must name an in-scope shared document.

`await hsonEcho.init({ now, credential, socket })` structurally admits both partitions, verifies shared content and the initializer set against the retained session, creates missing local libraries, and synchronizes shared state through `current`, `replay`, or `reconcile`. Existing local state is preserved. Echo exposes this automatic process through read-only `echo.sync` diagnostics.

Every accepted authority revision yields one session-specific projected commit or progress event. Reconcile derives the same current shared session view used by `session.now()` and updates only the shared partition in place. A scope update can add an authorized local initializer; Echo verifies and installs it once when absent. Retaining, removing, or re-adding the name preserves an existing client-owned instance. A changed compatible seed affects only new or missing instances; an incompatible mode or Schema fails clearly instead of migrating state.

Hosted commit and progress frames carry the effective session projection sequence and digest. Echo checks both before applying semantic state. Projection changes use their own sequence and never fabricate an authority revision. Reconcile advances the authority cursor to its captured position; client `map.rev` changes only when semantic client state changes.

Hosted continuation receives the admitted `now` composition, credential, socket, and explicit shared document being adopted. It initializes local definitions without treating them as the SSR document, adopts the shared DOM, binds Mirror, and completes sync. Local canonical interaction descriptors are deliberately deferred; the enabled interaction domain remains projected shared authority state.

The active formats identify distinct contracts: `hson-authority-projection-snapshot` for projected state, `hson-locus-live-projected-client-commit` and `hson-locus-live-projected-client-wire` for live and retained effects, `hson-locus-hosted-aggregate-message` for the hosted socket, and `hson-ssr-bootstrap` for projected hosted SSR. Local SSR uses the distinct `libraries` payload family. Unknown format identities and malformed payloads reject.

Durable persistence stores complete private/shared authority state without generated QUIDs or ownership policy. Local initializer definitions remain deployment configuration and evolving local state remains client-owned.
