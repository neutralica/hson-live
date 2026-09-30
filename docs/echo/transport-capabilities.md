# Echo transport capabilities

Echo consumes one semantic transport object. Endpoint Echo needs finite
operations and attachment observation; replica Echo additionally needs an
ordered synchronization feed. The currently implemented concrete adapter is
`hsonEcho.transport.websocket({ url, WebSocketConstructor? })`. The same object
may serve either Echo composition, but one transport instance belongs to one Echo
for its lifetime. Echo owns its semantic lifecycle, while the
caller disposes the transport and its physical resources.

## Finite operations

`operations.submit(request)` returns a promise with one of three results:
`response` carries a typed authority outcome, including semantic rejection;
`not-submitted` means the adapter can prove the request never entered its
admission path; `uncertain` means it may have been admitted but its outcome was
lost. Encoding, size admission, and aborts before physical send are `not-submitted`;
an interruption after send is `uncertain`. Session creation is never retried
automatically after uncertainty because its credential may exist only in the
lost response. `EchoSessionError.delivery` and `echo.session.failure.delivery`
expose that distinction. An explicit later create is a new session attempt.
Actions keep a stable `clientId` and `requestId` across attempts, a fresh
`attemptId` per retry, and retained status/deduplication at Locus. Independent
finite requests need no global transport queue. Locus serializes authority
mutation.

## Attachment and synchronization

A retained session survives physical channel replacement. Its current logical
attachment is the authorized presence at one epoch; a newer epoch fences the
old attachment. Attachment notices report fencing, ending, and observation
interruption. Endpoint Echo needs those notices without a replica map.

A replica opens an ordered synchronization subscription. Opening establishes a
feed, not caught-up readiness. Echo verifies recovery ID, authority identity,
projection, and cursor continuity across current, replay, or reconcile material,
then a `caught_up` boundary and continuing live commit/progress publication.
Locus holds one current subscription sink per logical attachment. Replacing a
subscription ends the displaced subscriber exactly once and fences old output.
Opening accepts an optional abort signal; Echo aborts a pending open when
recovery is replaced or disposed. Established subscriptions retain `cancel()`.
Ending synchronization alone does not revoke the retained session. The physical
stream or socket lifetime is adapter-specific. If a feed is interrupted, the replica loses
caught-up readiness and can recover from its last applied authority cursor;
the retained session and admitted document `completionRev` waits survive.
Status and retry of the same logical action request remain available over the
finite-operation capability while sync recovers; new replica work remains gated.
Canonical publications are reliable and ordered. A slow consumer must interrupt
and recover rather than silently drop a revision.

The WebSocket adapter multiplexes operations, notices, and synchronization on
one physical WebSocket. A physical close interrupts each capability and the
stable client adapter can open another WebSocket for retained-session
reattachment. That shared physical fate is adapter policy, not an Echo or Locus
core requirement. The credential remains separate sensitive reattachment
material; `session.now()` contains transferable, non-secret state and no route,
transport, or attachment secret.
Terminal adapter disposal notifies attachment and sync consumers before closing
its resources; it does not dispose the Echo object itself.

## Later transports

HTTP/1 finite requests plus an open response stream, and HTTP/2 or HTTP/3
multiplexed requests plus an ordered response stream, can implement the same
semantic boundary. None is an Echo transport in Step 4A, and HTTP/3 has not
been runtime tested. Logical attachment identity is independent of TCP, HTTP/2,
or QUIC connection identity. Step 4B must add attachment-scoped authorization
for independent HTTP requests and the concrete HTTP adapters.

Open HTTP representation delivery can also be composed directly from Locus
publication and LiveHost streaming for applications without browser JavaScript;
they do not instantiate JavaScript Echo. Future ephemeral game traffic may use
an optional sibling stream or datagram subsystem. Echo canonical sync remains
reliable and ordered and has no datagram interface.
