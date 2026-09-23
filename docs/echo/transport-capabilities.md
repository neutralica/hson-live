# Echo transport capabilities

Hosted solo and aggregate Echo use the same internal transport-neutral model.
Their hosted boundary separates finite authority operations from ordered
downstream synchronization and binds both to one semantic authority/session.
The currently supported public hosted adapter is WebSocket, which implements
both capabilities through one physical connection.

## Finite operations

Finite operations include configured actions, retries, retained action-status
queries, built-in document actions, and finite session-control exchanges. A
logical action retains its `clientId` and `requestId`; each delivery attempt has
its own `attemptId`. Locus remains responsible for validation, authorization,
deduplication, canonical mutation, request ownership, and terminal results.

Submitting an operation and delivering its typed outcome are independent
internal capabilities. An outcome does not semantically depend on arriving
through the physical attachment that submitted its request.

## Ordered synchronization

Synchronization begins or resumes from replica revision and fence evidence and delivers a
typed recovery plan, current/replay/snapshot material, recovery tail, caught-up
boundary, and ordered live authority publications. Each authority revision in
the Echo client stream carries either a graph commit or generic progress with
no graph effect. Client commits contain portable application and system effects;
replacement lineage expresses surviving subjects. Neither client graph content
nor snapshots carry generated Locus QUIDs. Action `HsonData` is not used as a
replacement commit format.

Locus installs live observation before recovery transfer completes. Revisions
accepted across that cut are retained as tail or pending-live output, so the
internal seam does not turn recovery into a separate fetch followed by a later
subscription.

Aggregate registry digest, selected-library identity, topology evidence, and
global recovery ordering are layered over this synchronization lifecycle. They
do not define a second transport attachment. Aggregate WebSocket envelope
shape, format tags, exact `resultData` encoding, and frame byte limits remain
adapter concerns.

## Authority/session binding

Finite operations and synchronization share one internal authority binding:
the host-supplied principal, semantic Locus session, logical map, incarnation,
and attachment epoch. The semantic session may survive replacement of a
physical transport attachment. The attachment epoch fences stale attachments.
An Echo `clientId` remains logical request-lineage identity and is not a
security principal.

Recovery is semantic; reconnect is transport lifecycle. Authority settlement
is likewise distinct from Echo replica convergence. AsyncLiveTree continues to
wait for the accepted operation's `completionRev`, delivered later through
ordered authority synchronization, and Mirror/DOM realization remains a
separate convergence boundary.

Generated QUID acquisition is local to the Echo or Locus runtime. It creates
neither an authority revision nor an application commit. Retained historical
identity-only authority commits are represented as generic progress in the
client stream. Incremental replay retains Echo-local identities through each
observed effect. Snapshot fallback converges state and revision with a fresh
Echo-local identity epoch, fencing old subject handles. Authority history and
persistence still read exact runtime identity internally until Phase 5.

## Current scope

The reusable Echo composition seam accepts finite-operation and synchronization
capabilities independently, provided they carry the same private semantic
binding. The capability seam is internal. It is not a transport registry, enum,
or public plugin API. Public `EchoOptions.socket`, browser/Node socket adapters,
and HTTP-bootstrap-plus-WebSocket-continuation behavior remain supported.
WebSocket is still the only public hosted continuation adapter. No HTTP or
streamed transport is implemented by this factoring, and public mixed-transport
composition is not promised.
