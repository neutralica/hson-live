# Locus overview

Locus owns one fixed application library registry plus separate system state. A registry with one library uses exactly the same session, authorization, socket, cut, live publication, and recovery machinery as a larger registry. There is no solo hosted Locus or sessionless one-map client replication protocol.

The server may hold private and public libraries. At session creation, Locus normalizes an authorized, immutable effective projection from explicit exposure policy, the requested projection, and the read authorizer. Every nominal framework-generated client artifact uses that stored projection: initial bootstrap, live commits and progress, retained replay, recovery tail, snapshot fallback, hosted HTML, and SSR state. A change in policy requires session revocation rather than silently widening or narrowing an existing session.

`locus.cut(sessionId, document?)` binds HTML and `AuthorityProjectionSnapshot` to one authority revision and projection digest. Only the selected permitted document renders into HTML. The application may send HTML alone or place the cut's projected state in an SSR carrier. The application continues to own routing, shell, CSS, headers, CSP, and arbitrary responses.

Echo manages authority-projected libraries inside one composed client LiveMap; client-local libraries are declared and mutated locally. The authority cursor and client `map.rev` are separate clocks. Browser continuation adopts structurally matching DOM without server QUID provenance. Mirror installs after successful adoption.

Locus persistence and server-side authority access remain complete. The framework does not inspect arbitrary application HTML or JSON, so application code must avoid manually copying private values into a permitted document or response.

For a persistent transition, Locus prepares authority semantics, retained history, and the projected live and recovery event for every resumable session before it calls the durable append. The append is the authority decision; runtime installation then completes under a reservation that fences local identity acquisition and new session creation. An ordinary rejected candidate leaves runtime, history, and durability unchanged. A clean append rejection guarantees no record was written. An adapter must signal an uncertain write-then-error outcome explicitly; Locus then stops serving that authority until it is restored. Actual transport sends occur after acceptance, and their failure detaches the connection for recovery.

For the constructor and cut contract see [Locus API](./api-locus.md). For policy and format details see [authorized client projection](./authorized-client-projection.md). For deployment ownership see [LiveHost](../livehost/overview.md).
