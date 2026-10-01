# Locus overview

Locus owns one private/shared authority registry plus separate system state and deployment-defined local initializers. Authority topology can grow through `locus.stage.addLibraries({ private, shared })`; local definitions remain construction-time-only. A one-library authority uses the same session, authorization, socket, current-state, and live publication machinery as a larger registry.

At session creation, Locus normalizes an authorized composition from the catalog, request, and read authorizer. Each grant is an exact set of shared names and local initializer names. `session.now()` materializes shared current state and authorized local initializers separately. Retained synchronization installs missed shared topology in place; when replay is unsafe, reconcile updates only the shared partition. Local state is initialized when absent and thereafter preserved.

`session.now({ html: document })` binds HTML and shared authority state to one authority revision. Only a selected permitted shared document renders into HTML. The application may send HTML alone or place the whole `now` composition in an SSR carrier.

Echo manages shared and local libraries inside one composed client LiveMap. Local roots, Schemas, CSS, and interaction descriptors are client-owned after initialization. Descriptor ownership follows the subject Library inside one canonical interaction root; `kind: "browser" | "locus"` chooses only the dispatch branch. The authority cursor and client `map.rev` are separate clocks, so local edits do not change Locus sync position.

Locus persistence and server-side authority access remain complete. The framework does not inspect arbitrary application HTML or JSON, so application code must avoid manually copying private values into a permitted document or response.

For a persistent transition, Locus prepares authority semantics, retained history, and projected live synchronization output before it calls the durable append. Evolving local state never enters this path. The append is the authority decision; transport failure detaches the connection for later synchronization.

For the constructor and current-composition contract see [Locus API](./api-locus.md). For policy and format details see [authorized client projection](./authorized-client-projection.md). For deployment ownership see [LiveHost](../livehost/overview.md).
