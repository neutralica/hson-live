# Locus API

`Locus` governs one fixed application library registry and separate system state. The registry may contain one library or many; its cardinality does not change the hosted protocol. A hosted client obtains an authorized session projection before receiving framework state. There is no sessionless one-map hosted socket.

```ts
import { create_locus } from "hson-live/locus";
import { hsonLiveMap } from "hson-live/livemap";

const map = hsonLiveMap.fromLibraries({
  page: { document: "<main/>" },
});
const locus = create_locus({
  map,
  exposure: [{ library: "page", exposure: "client-public" }],
  authorizeProjection: () => ({ libraries: ["page"] }),
});
```

Every application library needs one explicit `client-public` or `server-private` exposure entry. Public exposure makes a library eligible; the session projection and read authorizer determine what this particular client receives. A one-library registry is not implicitly selected or public. A selected HTML document must be an authorized document in the effective projection. `defaultProjection`, when configured, is a default *request* and still passes authorization.

`create_persistent_locus` uses the same registry ontology. Durable authority checkpoints remain complete and server-side; exposure is not serialized into them. Application code may read `locus.map` and private state for server work, and remains responsible for arbitrary HTML or `Response` values it writes itself.

## Hosted cut and client state

After a session is established, `locus.cut(sessionId, document?)` produces an object-owned authorized cut. Its `html` and `data` (`AuthorityProjectionSnapshot`) come from one coherent authority revision and the session's stored immutable projection. It rejects a revoked session and any private, unselected, wrong-kind, or otherwise unauthorized document choice without naming hidden libraries. A zero-argument cut needs an authorized `htmlDocument`; no first-document fallback exists.

The application owns the HTML shell, routing, headers, CSP, asset tags, and bootstrap placement. `new Response(cut.html)` is valid when no browser continuation is needed. When continuation is needed, encode the projected state from that same cut with the hosted SSR bootstrap v3 `hosted-projection` contract. Local SSR still uses its separate version 2 contract.

The browser composes client-local libraries separately with the authority projection. Echo starts `authorityRev` from the authority snapshot revision; its `map.rev` follows ordinary local LiveMap revisions. Hosted continuation checks projection identity, authority binding and revision, then adopts matching DOM before installing Mirror. It does not compare server-generated QUIDs.

The active hosted socket is `hson-locus-hosted-aggregate-message-v4`. It projects bootstrap, live commits or progress, retained replay, recovery tail, and snapshot fallback for the stored session projection. Reattachment reuses that projection; revocation fences new cuts and transport work.

Ordinary local `map.cut()` and `libraries.cut(...)` remain structural APIs, not authorization boundaries. Local one-library LiveMap constructors remain supported.

See [authorized client projections](./authorized-client-projection.md), [SSR composition](../ssr-composition.md), and [Echo API](../echo/api-echo.md).
