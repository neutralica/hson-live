# Echo API reference

Echo's operation and synchronization architecture is described in
[Transport capabilities](./transport-capabilities.md). WebSocket and HTTP are
peer hosted adapters.

Echo is semantic hosted-client participation in one Locus authority domain.
There is one public `Echo` type family with two compositions:

```ts
import { hsonLiveMap } from "hson-live/livemap";

const endpointTransport = hsonLiveMap.echo.transport.websocket({ url: "wss://example.test/echo" });
const endpoint = hsonLiveMap.echo.create({ transport: endpointTransport });
const replicaTransport = hsonLiveMap.echo.transport.websocket({ url: "wss://example.test/echo" });
const replica = await hsonLiveMap.echo.create({ now: sessionNow, credential, transport: replicaTransport });

const httpTransport = hsonLiveMap.echo.transport.http({ endpoint: "/_hson" });
const httpEndpoint = hsonLiveMap.echo.create({ transport: httpTransport });
```

`hsonLiveMap.echo.create` and `hson.liveMap.echo.create` construct an endpoint-only Echo when given endpoint options. It exposes `clientId`, `session`,
`connect`, `disconnect`, `dispose`, `action`, `retryAction`, and `actionStatus`.
It does not construct or expose a LiveMap and has no synchronization state.

The same `create` functions accept retained-session `now` state, its separate credential,
and a transport. It admits the shared authority state and authorized local
initializers, constructs one composed client map, reattaches the session, and
completes `current`, `replay`, or `reconcile` synchronization before resolving.
The returned Echo exposes the endpoint capabilities plus `rev`, family selectors `data`, `doc`, and `parts`,
`cut(...)`, `commits.observe(...)`, and read-only `sync` state: `appliedRev`,
`status`, `failure`, `strategy`, and `debug()`. `strategy`
reports the latest completed recovery, including automatic same-attachment
stream replacement.
An initial transferred state is checked against authority content before
`current` can establish it; a stale or mismatched starting state is reconciled
from a current authorized view. Local initializer fingerprints are verified
against the retained session independently of the shared-state fingerprint.
Later reconnects retain verified replica continuity and synchronize automatically.

Library count is a topology concern, not an Echo kind. Echo composes authorized
shared projections and client-local initializers in one replica state. The
subordinate LiveMap remains internal. Echo orders authority effects with its
own synchronization cursor.

The clocks have different meanings:

| Clock | Meaning |
| --- | --- |
| `locus.rev` | Revision of complete authority state. |
| `echo.rev` | Revision of this Echo's composed client state. Local writes, visible projected commits, and composition-changing topology or reconciliation advance it. A new runtime starts a new composed clock. |
| `echo.sync.appliedRev` | Latest contiguous authority revision Echo has processed. Local writes leave it unchanged; progress-only authority revisions can advance it while `echo.rev` stays fixed. |

Echo does not maintain a reliable latest-known authority head. Interpret
`appliedRev` with the authority identity/incarnation and sync status.

```text
LiveTree ⇅ Mirror ⇅ Echo ⇅ Locus
                        authority state
```

Echo serializes supported Mirror requests, lowers each at queue head against
the latest accepted replica, sends an existing built-in document action, and
does not lower the next request until the replica reaches `completionRev`.
Rejection changes neither map nor projection and does not fail Mirror.

For hosted `replace-content` authoring, Echo derives operation-relative
source/destination path lineage from its own local replacement intent. Locus
applies that correspondence to Locus-local identities; the generated QUIDs of
the two runtimes do not define the portable replacement lifetime. Exact-QUID
graph content and witnesses are absent from the current client stream. Echo
uses only lineage to preserve its own subject identities during replacement.

Echo does not perform optimistic mutation, authorization, application policy,
or generic data proposals. Hosted data changes continue through
application-defined Locus actions. A client-local QUID remains readable after
replay while its subject survives. An unquidded Echo-bound node may acquire a
client-local QUID through its
LiveMap and Mirror. That demand does not contact Locus, advance `echo.rev`, or
publish an application commit.

Transport availability, retained-session attachment, and replica synchronization remain
separate layers. For a replica, `create()` performs all three before
returning. After a disconnect, `echo.connect()` automatically reattaches the
retained session and synchronizes through `caught_up`. `echo.session.reattach()`
can be awaited when the caller needs that completion boundary; repeated calls
during the same reconnect share its work. New replica actions and document authoring
require `caught_up` readiness. Status and retry of an existing stable action request
require an attached session and a usable finite-operation transport, even while
synchronization is recovering. Endpoint-only Echo retains explicit `connect()`
and session operations without a replica synchronization subsystem.

`disconnect()` detaches semantic observation and settles uncertain endpoint
operations without ending the session or releasing map management. The Echo may
reconnect. `echo.dispose()` is terminal and, for a replica-bearing Echo, releases
exclusive management and clears its retained client credential. The caller
separately calls `transport.dispose()` to close adapter-owned physical resources.
A retained client-composed LiveMap keeps its shared and client-local ownership
after session or Echo disposal. Full `map.restore()` applies to standalone
LiveMaps. Shared replica state uses managed projection recovery.
For HTTP, Echo disposal also stops attachment heartbeat and stream maintenance
for its permanently claimed transport. Transport disposal interrupts Echo's
attachment observation and settles in-flight requests conservatively.
Terminal transport disposal interrupts attachment observation and synchronization,
so Echo no longer reports an attached or caught-up state. One semantic transport
instance belongs to one Echo for its lifetime; create another transport for another Echo.
If session creation fails, `EchoSessionError.delivery` and `echo.session.failure.delivery`
distinguish `not-submitted` from `uncertain`. A later explicit `session.create()` is
a new creation attempt; it cannot recover a credential lost with an uncertain response.

An action's `completionRev` is the authoritative stream head at terminal
settlement, interpreted with the current session's `logicalMapId` and
`incarnationId`. Receipt of that result does not claim local replica or Mirror
convergence. Echo processes one ordered authority stream: a graph commit applies
an application effect, while generic progress advances the processed authority
position without graph or DOM work. For a replica, `echo.rev` is the local
composed replica-state revision. `echo.sync.appliedRev` is the latest contiguous
authority revision processed under Echo's current authority identity and
synchronization status. A
completion waiter settles only after Echo has processed every authority
revision through `completionRev`, including progress-only revisions. It does not
compare `completionRev` to `echo.rev`.

Configured actions preserve exact Data fidelity in both directions. `Echo.action(name, payload)` accepts supported ordinary JavaScript values or authenticated `HsonDataValue` carriers; absence remains distinct from present null. Ordinary strings are literal Data. Use `Hson.data.fromSource(source)` to admit serialized JSON/Hson explicitly.

Echo retains an immutable carrier in `call.request.payload`, so caller mutation cannot affect retries. Handlers, validators, and authorizers receive carriers; `payload.materialize()` provides a detached JavaScript view. Successful acknowledgments, retained status, and cached retries carry `HsonDataValue` results. Handlers may return ordinary supported values or genuine carriers; void remains no result.

The action fingerprint and transport use the same deterministic exact-data
encoding. Therefore `0` differs from `-0`, object member order is semantic,
integer-like authored order is retained, and valid own names such as
`__proto__`, `constructor`, and `prototype` are safe. Unsupported runtime values
reject instead of being normalized by JSON serialization. The outer protocol
remains JSON-framed, but action data is carried as canonical structural text;
the semantic contract is transport-neutral and does not depend on WebSocket.

Custom schema decoders inspect the exact admitted value. Their successful output
is strictly re-admitted, and that transformed `HsonDataValue` is the single value
seen by authorization and execution. Hson Schema action validators evaluate the
underlying exact data carrier directly.

`echo.data`, `echo.doc`, and `echo.parts` select source-discriminated Library handles.
For example, `echo.doc.must("page")` requires a document Library;
`echo.doc("page")` permits absence. Check `source` for `"client-local"` or
`"authority-projected"` before using ownership-specific writes.
Reads are synchronous. Client-local data, document, CSS, and Schema writes use
local synchronous LiveMap semantics. Projected data has no generic setter;
application-defined Locus actions handle data changes. Supported projected
document and CSS writes return promises, use Locus authorization, and wait for
the operation's authority completion revision. Projected Schema attachment is
unavailable. Echo has no public raw-map escape hatch or dynamic local-library
admission operation in this pass.

`echo.commits.observe(...)` reports composed-state commits; selected-library
watches and document commits remain available. `echo.cut(...)` is a coherent cut
of currently composed projected and local state. It is neither a full authority
cut nor a session authorization artifact. Progress-only authority advancement
emits no composed-state commit or value observation.
Retained synchronization applies projected library additions before later writes,
then reconciles any explicit disconnected grant expansion at the current cut.
When retained history is unavailable, a current projected snapshot reconciles
the authority-owned libraries in the existing map before queued live
traffic. Bound Mirror/LiveTree resources remain.
Hidden additions advance only `echo.sync.appliedRev`. A session projection
contraction removes revoked authority libraries and makes their old handles
stale, without changing authority revision.
`EchoSync` has no `onChange` observation member. Echo has no topology-aware
`subscribe`/`unsubscribe`, public `seq`, or `onEvent` surface.

Hosted SSR continuation accepts the session current-state materialization, credential, transport, and
existing DOM root. It prepares the managed replica, binds Mirror to the
adopted DOM, then completes synchronization through the same engine.

Document QUAD selections support recursive optional `.q(name)`, such as
`echo.doc.must("page").q("left")?.q("child")?.q("label")`. Client-local
children retain synchronous local writes. Projected children expose observations
only, recursively; the projected Library's ordinary `.at()` and Document commands
retain their existing server-authorized submission behavior. Lookup preserves
local precedence, named boundaries and unique unnamed transparency, returning
`undefined` for absence or ambiguity.

Each successful `.q()` child has an independent selection lifetime. Disposing a
parent leaves that child usable; `.at()` aliases share their anchor's disposal
family and navigation namespace. Echo owner disposal rejects dependent QUAD
observations (including `active` and `rev`), navigation and writes. Echo-local
root QUAD acquisition is fenced as well.
Local mutation capture checks the owner both before capture and before writing,
so reentrant owner disposal cannot publish the pending mutation. Selection
`dispose()` remains available for idempotent cleanup.

Disconnect changes readiness without automatically retiring selections. Authenticated
replay may preserve surviving occurrences. Full projected reconciliation can
retain the composed map epoch and local state while retiring projected selections
whose occurrence evidence is replaced, even with equal content. Fresh receiving
or reconstruction establishes fresh lifetimes. See the
[QUAD navigation contract](../contracts/document-q-location.md).

Shared libraries remain managed by Locus. Local libraries are initialized only
when absent and are thereafter client-owned: local root, Schema, and document
CSS changes stay local and survive replay, reconcile, scope removal, and re-add.
An already-running Echo can receive a later grant for a cataloged local
initializer. Installing that local topology may advance `echo.rev`; the session
contract change alone does not advance `locus.rev` or `echo.sync.appliedRev`.
If the entire client runtime and its application persistence are lost, evolved
local state is lost and a new replica starts from the currently authorized seed.
Canonical interaction descriptors use one composed system root. Subject Library
ownership partitions it: shared descriptors synchronize from Locus, while local
document descriptors are client-owned and survive replay, reconcile, and scope
changes. Local interaction capability does not require the shared `interactions`
feature; the projected registry digest and authority cursor exclude local state.
