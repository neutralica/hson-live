# Secure HTTP/2 Node LiveHost

`start_node_application_host` accepts optional caller-supplied PEM TLS material:

```ts
import { readFile } from "node:fs/promises";
import { start_node_application_host } from "hson-live/livehost/node";

const host = await start_node_application_host({
  port: 8443,
  applications: [application],
  http2: {
    key: await readFile("server-key.pem"),
    cert: await readFile("server-cert.pem"),
  },
});
```

Omitting `http2` keeps the existing insecure HTTP/1 server. Supplying it creates
Node's secure HTTP/2 server with `allowHTTP1: true`. Ordinary HTTPS requests can
use either version; WebSocket upgrades use HTTP/1. No extended CONNECT or
WebSocket-over-HTTP/2 implementation is provided.

Both versions enter one request handler, security normalization pipeline, Web
`Request` adapter, and Web `Response` writer. Applications retain the same API.
HTTP/2 pseudo-headers stay inside Node plumbing; `:authority` supplies the request
host, and the initial END_STREAM flag supplies body-presence information. The
response adapter omits HTTP/2-forbidden connection headers and headers nominated
by `Connection`, while preserving repeated `Set-Cookie` values.

Request origins use the physical socket's TLS state, with the existing explicit
trusted-proxy policy still controlling forwarded interpretation. Secure host
results use `https://` for `httpUrl` and `wss://` for `url`. Insecure results keep
`http://` and `ws://`. Route paths do not change.

Streaming writes still wait for physical drain before pulling more body data.
Closing one HTTP/2 response cancels its Web reader and affects only that stream.
Disposal stops admission, destroys tracked HTTP/2 sessions (canceling their active
streams), and waits for their close events alongside server closure. The existing
application disposal and WebSocket close behavior remains in place. The shutdown
deadline force-closes tracked physical sockets, including HTTP/1 fallback and
incomplete TLS connections.

The existing URL and header-value limits apply to both versions. HTTP/2 also
advertises the aggregate header limit and checks received header bytes. The
request timeout bounds HTTP/2 upload ingress, not the lifetime of a completed
request's progressive response. Existing `maxPayloadBytes` remains the WebSocket
message limit; this change does not introduce an HTTP body-size policy.

## Public surface review

| Aspect | Decision |
| --- | --- |
| Name | `NodeApplicationHostOptions.http2` explicitly selects secure HTTP/2 capability. |
| Shape | Optional readonly `{ key: string \| Buffer; cert: string \| Buffer }`; both PEM values are required. No broad Node TLS options passthrough or new exported type. |
| Return | Still `Promise<NodeApplicationHost>` with the same members; URL schemes reflect TLS. |
| Sync/async | Startup remains asynchronous and resolves after listening. No new synchronous startup API. |
| Errors | TLS construction errors reject startup and dispose registered applications once, following existing startup failure behavior. Certificate management stays with the caller. |
| Placement | Only the Node entrypoint's existing startup options expose this setting. Application and browser APIs do not change. |

The already-exported `normalize_node_request` keeps its name and three-argument
shape. Its first argument now uses `Pick<IncomingMessage, "headers" | "socket" |
"url" | "method">`, the capabilities it actually reads. Existing IncomingMessage
callers remain valid and HTTP/2 compatibility requests are accepted. Its return
value, synchronous execution, and policy-rejection error behavior are unchanged.
No new normalization export is introduced.

## Validation and experiment scope

Run `npm run test:livehost-node-http2`, `npm run test:livehost-node-hosting`, and
`npm run check`. The dedicated HTTP/2 acceptance suite uses a checked-in,
self-signed **test-only** localhost certificate and verifies TLS with that
certificate as its CA; it does not disable certificate verification.

Experiment 17 can use this transport for progressive ordinary request routes.
It must supply a certificate trusted by its browser. Browser experiments,
application protocol work, WebSocket-over-HTTP/2, certificate provisioning, and
HTTP PATCH are outside this change.

Node compatibility API reference: https://nodejs.org/docs/latest-v22.x/api/http2.html#compatibility-api
