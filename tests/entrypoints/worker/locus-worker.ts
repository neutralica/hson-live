import { bind_locus_http, bind_locus_websocket, create_locus, hsonLocus,
  type LocusWebSocketLike, type Locus, type LocusSessionId, type AuthorityProjectionSnapshot } from "hson-live/locus";
import { hsonLiveMap } from "hson-live/livemap";
import { hsonEcho, type EchoReplicaTransport } from "hson-live/echo";
import { Hson } from "hson-live/hson";

declare const socket: LocusWebSocketLike;
declare const transport: EchoReplicaTransport;
const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: Hson.schema`<type "document" tag "main" content <repeat <tag "p" content "empty">>>` } });
const locus: Locus<typeof map> = create_locus({ map, libraries: [{ name: "page", ownership: "shared" }] });
void [locus, hsonLocus];
void bind_locus_websocket(locus, socket);
const http = bind_locus_http(locus, { endpoint: "/_hson" });
void http.handle(new Request("https://example.test/_hson", { method: "POST" }), {});
http.dispose();
const retained = await locus.session.create({ libraries: ["page"] });
const snapshot: AuthorityProjectionSnapshot = retained.now().libs;
void hsonEcho.create({ now: retained.now(), credential: retained.credential!, transport });
// @ts-expect-error Retained cuts have no family narrowing.
retained.now({ data: [] });
// @ts-expect-error The public plural namespace is retired.
void locus.sessions;
// @ts-expect-error A bare map cannot become a hosted Locus.
create_locus({ map: hsonLiveMap.fromLibraries({ state: { data: { value: 1 }, schema: Hson.schema`<type "data" content <value "number">>` } }) });
