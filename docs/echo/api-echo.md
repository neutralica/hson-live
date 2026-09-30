# Echo API reference

Echo's internal operation and synchronization architecture is described in
[Transport capabilities](./transport-capabilities.md). The public hosted
adapter remains WebSocket.

Echo is semantic hosted-client participation in one Locus authority domain.
There is one public `Echo` type family with two compositions:

```ts
import { create_echo, hsonEcho } from "hson-live/echo";

const endpoint = create_echo({ socket });
const replica = await hsonEcho.init({ now: sessionNow, credential, socket });
```

`hsonEcho.create`, `hson.echo.create`, and `create_echo` construct an endpoint-only Echo. It exposes `clientId`, `session`,
`connect`, `disconnect`, `dispose`, `action`, `retryAction`, and `actionStatus`.
It does not construct or expose a LiveMap and has no synchronization state.

`hsonEcho.init` accepts retained-session `now` state, its separate credential,
and a transport. It admits the shared authority state and authorized local
initializers, constructs one composed client map, reattaches the session, and
completes `current`, `replay`, or `reconcile` synchronization before resolving.
The returned Echo exposes the endpoint capabilities plus `map` and read-only
`sync` diagnostics: `status`, `failure`, `strategy`, and `debug()`.
An initial transferred state is checked against authority content before
`current` can establish it; a stale or mismatched starting state is reconciled
from a current authorized view. Local initializer fingerprints are verified
against the retained session independently of the shared-state fingerprint.
Later reconnects retain verified replica continuity and synchronize automatically.

Library count is a LiveMap topology concern, not an Echo kind. The replica map
contains the authorized libraries and contracts in the session current-state materialization. Echo orders
authority effects with its own cursor.

```text
LiveTree ⇅ Mirror ⇅ replica LiveMap ⇅ Echo ⇅ Locus ⇅ Locus LiveMap
                                   Echo ⇅ Locus
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
LiveMap and Mirror. That demand does not contact Locus, advance `map.rev`, or
publish an application commit.

Transport connection, retained-session attachment, and replica synchronization remain
separate internal layers. For a replica, `init()` performs all three before
returning. After a disconnect, `echo.connect()` automatically reattaches the
retained session and synchronizes through `caught_up`. `echo.session.reattach()`
can be awaited when the caller needs that completion boundary; repeated calls
during the same reconnect share its work. Replica actions and status operations
require `caught_up` readiness. Endpoint-only Echo retains explicit `connect()`
and session operations without a replica synchronization subsystem.

`disconnect()` detaches transport listeners and settles uncertain endpoint
operations without ending the session, releasing map management, or closing a
caller-owned socket. The Echo may reconnect. `echo.dispose()` is terminal and,
for a replica-bearing Echo, releases exclusive management and clears its retained
client credential.

An action's `completionRev` is the authoritative stream head at terminal
settlement, interpreted with the current session's `logicalMapId` and
`incarnationId`. Receipt of that result does not claim local replica or Mirror
convergence. Echo processes one ordered authority stream: a graph commit applies
an application effect, while generic progress advances the processed authority
position without graph or DOM work. For a replica, `map.rev` is the local
graph revision and Echo's internal authority cursor is the authority position. A
completion waiter settles only after Echo has processed every authority
revision through `completionRev`, including progress-only revisions.

Configured actions preserve full canonical Hson data fidelity in both
directions. `Echo.action(name, payload)` accepts strictly admissible ordinary
JavaScript data or an existing `HsonData`; absence remains distinct from present
null. Echo admits the payload once and retains that immutable exact snapshot, so
caller mutation cannot affect retries. Handlers and authorizers receive
`HsonData` as the authoritative payload and may explicitly call
`Hson.data.materialize(payload)` when an ordinary view is sufficient. A top-level
string action argument is interpreted as canonical Hson data text; wrap an
ordinary JavaScript string with `Hson.data.from(text)` first. Successful results are
also `HsonData`, including retained status and cached retries; handlers may
return ordinary admissible data or `HsonData`, while void remains no result.

The action fingerprint and transport use the same deterministic exact-data
encoding. Therefore `0` differs from `-0`, object member order is semantic,
integer-like authored order is retained, and valid own names such as
`__proto__`, `constructor`, and `prototype` are safe. Unsupported runtime values
reject instead of being normalized by JSON serialization. The outer protocol
remains JSON-framed, but action data is carried as canonical structural text;
the semantic contract is transport-neutral and does not depend on WebSocket.

Custom schema decoders inspect the exact admitted value. Their successful output
is strictly re-admitted, and that transformed `HsonData` is the single value
seen by authorization and execution. Hson Schema action validators evaluate the
underlying exact data carrier directly.

Echo exposes its actual Schema-bound `LiveMap`, not a duplicate read-only map
hierarchy. Direct public mutation rejects with the managed-mutation authority
error; only accepted canonical replay mutates an Echo-governed map.

Replica graph changes are observed through LiveMap commit/sub/feed/watch
facilities. Progress-only authority advancement emits no application commit or
value/mutation observation; internal authority-position observers support Echo
convergence and Mirror revision ordering.
Retained synchronization applies projected library additions before later writes,
then reconciles any explicit disconnected grant expansion at the current cut.
When retained history is unavailable, a current projected snapshot reconciles
the authority-owned libraries in the existing map before queued live
traffic. Bound Mirror/LiveTree resources remain.
Hidden additions advance only the authority cursor. A session projection
contraction removes revoked authority libraries and makes their old handles
stale, without changing authority revision.
`EchoSync` has no `onChange` observation member. Echo has no topology-aware
`subscribe`/`unsubscribe`, public `seq`, or `onEvent` surface.

Hosted SSR continuation accepts the session current-state materialization, credential, transport, and
existing DOM root. It prepares the managed replica, binds Mirror to the
adopted DOM, then completes synchronization through the same engine.

Shared libraries remain managed by Locus. Local libraries are initialized only
when absent and are thereafter client-owned: local root, Schema, and document
CSS changes stay local and survive replay, reconcile, scope removal, and re-add.
If the entire client runtime and its application persistence are lost, evolved
local state is lost and a new replica starts from the currently authorized seed.
Canonical interaction descriptors use one composed system root. Subject Library
ownership partitions it: shared descriptors synchronize from Locus, while local
document descriptors are client-owned and survive replay, reconcile, and scope
changes. Local interaction capability does not require the shared `interactions`
feature; the projected registry digest and authority cursor exclude local state.
