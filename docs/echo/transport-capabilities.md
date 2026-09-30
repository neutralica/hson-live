# Echo transport capabilities

Echo consumes one semantic transport object. An endpoint needs finite operations
and attachment observation. A replica also needs one ordered synchronization
feed. `hsonEcho.transport.websocket({ url, WebSocketConstructor? })` and
`hsonEcho.transport.http({ endpoint, fetch?, credentials? })` are peer concrete
adapters for that boundary. One transport instance belongs to one Echo for its
lifetime. The caller disposes the transport after disposing Echo.

## Finite operations

`operations.submit(request)` returns `response` for a typed authority outcome,
including semantic rejection. It returns `not-submitted` only when the adapter
can prove no authority submission occurred, and `uncertain` when admission may
have occurred but the response was lost. An already aborted signal or failed
local encoding proves non-submission. A generic Fetch network failure does not.
Echo never automatically repeats an uncertain session create, because its
credential may exist only in a lost response. Action retries preserve the
stable `clientId` and `requestId`, use a fresh `attemptId`, and consult Locus's
shared deduplication and status authority.
After Fetch begins, an HTTP status code alone cannot prove non-submission:
host or intermediary errors, redirect rejection, and invalid response content
type remain uncertain. Finite semantic replies require `Content-Type:
application/json`; synchronization replies require
`Content-Type: application/x-ndjson`. Optional MIME parameters are accepted.

HTTP uses `POST {endpoint}` with one exact semantic JSON request and response.
Session create and attach need the retained credential only for attach. The
successful response carries a new attachment capability in the
`x-hson-attachment` response header. Attached finite requests carry it in that
same request header. The HTTP adapter stores it privately; Echo session state,
`session.now()`, LiveMap state, Hson transfer, and URLs never contain it.
Every HTTP transport Fetch rejects redirects, including same-origin redirects.
The endpoint must be direct. The adapter never intentionally forwards an
attachment capability or credential-bearing body through a redirect.
`POST {endpoint}/sync` opens either a `recover` feed or an endpoint-only
`{"type":"observe"}` control feed. Both use the same attachment capability.
HTTP rejects other methods and paths without Locus admission. Finite and stream
responses set `Cache-Control: no-store`; the stream has
`Content-Type: application/x-ndjson` and `X-Content-Type-Options: nosniff`.

## Attachment and synchronization

A retained session, its logical attachment epoch, a synchronization
subscription, and a physical connection are distinct. WebSocket carries all
three semantic capabilities on one socket. HTTP uses independent finite
requests and one continuing response for observation or replica recovery and
live publication. A replica stream carries attachment notices and ordered
current, replay, or reconcile output, then `recovery-caught-up`, then live
commits, progress, and projection changes. It stays open at caught-up.

The server issues a 256-bit capability from `crypto.getRandomValues` and keeps
it as an opaque key to the current semantic attachment in a runtime-local Map.
It is separate from the retained-session credential. Reattachment fences the
old epoch, removes its capability immediately, and issues a new capability
for the new epoch. Detach, goodbye, revocation, session fencing or expiration,
and Locus disposal invalidate it. The server compares the trusted request
principal with the attachment's original principal on every finite request
and stream bind. The application must obtain that context from authentication;
a caller-supplied principal string is not authentication. Capability lookup
uses an exact Map key; there is no derived-token or secret-string comparison.
Unknown capabilities receive a bounded empty admission response.
The client applies an invalid-capability response only to the capability and
attachment generation that sent that request. A delayed rejection for an old
epoch cannot fence a newly installed capability.

Replacing an HTTP stream uses the same Locus subscription generation as
WebSocket recovery. Cancelling or losing one response ends only that
subscription. The logical attachment and its capability remain usable, so
finite status and retry can continue and a replica recovers at the same epoch
from its last applied cursor. A failed stream clears caught-up readiness and
gates new replica authoring. Losing the logical attachment instead requires
retained-credential reattachment and a new epoch and capability. A finite
operation failure does not end a healthy stream. A stale stream cannot publish
after its epoch or subscription is fenced.

HTTP stream records are bounded NDJSON framing around the shared typed semantic
codec; NDJSON is not canonical Hson state. The client decodes UTF-8 across
chunks, bounds each record to the existing 64 MiB snapshot frame ceiling,
rejects malformed records and mid-record EOF, and awaits each semantic output
before reading the next. Ordinary request and finite response bodies use the
existing 4 MiB live-wire limit. Locus retains its bounded synchronization
queue. The HTTP response has a 64 MiB snapshot allowance plus one 4 MiB
live-frame allowance; if the reader cannot
keep up, the binder ends that subscription so the client can recover. It never
silently drops a canonical revision or waits indefinitely for the network
inside an authority transaction.
The shared synchronization decoder checks exact keys for every output family;
HTTP and WebSocket use that same admission. Only one HTTP observation or
synchronization response is current per attachment. A new response closes the
old one, including endpoint-only control observation. A recoverable physical
stream-open failure waits before another recovery attempt; an invalid semantic
stream does not cause a rapid retry loop.

An HTTP attachment expires after 120 seconds without a received request;
the binder closes its semantic attachment and normal retained-session
detach/grace rules apply. A healthy client sends a private finite heartbeat
every 30 seconds, so a quiet but active stream remains attached. The binder
also writes a transport-local heartbeat record every 30 seconds so a stalled
response encounters flow control. Heartbeats do not enter Hson state or Echo's
semantic output. The browser adapter uses
Fetch with `credentials: "same-origin"` by default; applications may pass a
Fetch implementation or explicit Fetch credentials policy. Cross-origin use
of the capability header requires the deployment's CORS preflight policy.
Cookie-backed authentication still needs application origin and CSRF checks;
the attachment capability does not replace them.
The 120-second lease deliberately exceeds the nominal 30-second heartbeat
interval. Any admitted finite request or new stream open also refreshes it;
heartbeat scheduling need not be exact. Long browser suspension or deployment
buffering can still affect liveness. Lease callbacks are fenced to the current
attachment and activity generation, and disposal clears their timers.

`transport.dispose()` is terminal: it aborts physical work and notifies Echo
that attachment observation ended, without revoking the retained session.
`echo.dispose()` releases its sole semantic owner and stops HTTP heartbeat and
automatic stream maintenance; the caller still disposes the transport object.

LiveHost stays generic. An application maps its authenticated
`LiveHostApplicationContext` to `LocusConnectionContext` and calls
`bind_locus_http(locus, { endpoint }).handle(request, context)`. The binder
owns HTTP routing, capability admission, framing, and stream lifecycle; the
existing Locus semantic attachment owns sessions, actions, recovery,
projection, and publication. Proxy buffering and compression policy outside
LiveHost must allow progressive response delivery.

The same client adapter and binder run over HTTP/1 and HTTP/2. The HTTP/2
runtime proof uses one session with a long-lived response and concurrent
finite requests; no HTTP/2 stream or connection ID enters Echo or Locus.
HTTP/3 reliable request/response streams are architecturally compatible with
this boundary, but no HTTP/3 runtime or QUIC migration is implemented or
tested. Echo does not add datagrams or unordered traffic.

An application may separately serve streamed HTML or another open HTTP
representation without JavaScript Echo or NDJSON. No-JavaScript continuation
and Scout are separate work. Scout remains deferred.
