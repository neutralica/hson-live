import { bind_locus_http, bind_locus_websocket, type LocusWebSocketLike, type Locus, type LocusSessionId, type AuthorityProjectionSnapshot } from "hson-live/locus";
import { hsonLiveMap } from "hson-live/livemap";
import { type EchoReplicaTransport } from "hson-live/echo";
import { Hson } from "hson-live/hson";
import { hsonLiveHost, type LiveHostApplication } from "hson-live/livehost";

declare const socket: LocusWebSocketLike;
declare const transport: EchoReplicaTransport;
const pageDefinition = { document: "<main/>", schema: Hson.schema`<type "document" tag "main" content <repeat <tag "p" content "empty">>>` };
const map = hsonLiveMap.fromLibraries({ page: pageDefinition });
const locus: Locus<typeof map> = hsonLiveMap.locus.create({ shared: [{ name: "page", definition: pageDefinition }] });
const page = locus.lib("page");
if (page.mode === "document") {
  const authored = hsonLiveHost.create({ name: "worker-deck" });
  authored.GET("/", page.render);
  const application: LiveHostApplication = authored;
  void application;
}
void [locus, hsonLiveMap.locus];
void bind_locus_websocket(locus, socket);
const http = bind_locus_http(locus, { endpoint: "/_hson" });
void http.handle(new Request("https://example.test/_hson", { method: "POST" }), {});
http.dispose();
const retained = await locus.session.create({ libraries: ["page"] });
const snapshot: AuthorityProjectionSnapshot = retained.now().libs;
void hsonLiveMap.echo.create({ now: retained.now(), credential: retained.credential!, transport });
// @ts-expect-error Retained cuts have no family narrowing.
retained.now({ data: [] });
// @ts-expect-error The public plural namespace is retired.
void locus.sessions;
// @ts-expect-error A bare map cannot become a hosted Locus.
hsonLiveMap.locus.create(map);
