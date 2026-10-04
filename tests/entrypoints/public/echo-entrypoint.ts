import { EchoSyncError, EchoSessionError, type Echo, type EchoOptions, type EchoReplicaOptions, type EchoSession, type EchoActionRequest, type EchoEndpointTransport, type EchoReplicaTransport, type EchoHttpTransportOptions, type EchoWebSocketTransportOptions } from "hson-live/echo";
import * as hsonLiveMap from "hson-live/livemap";
import type { LiveMap } from "hson-live/livemap";
import type { LocusSessionNow, LocusSessionCredential } from "hson-live/locus";

declare const transport: EchoReplicaTransport;
declare const endpointTransport: EchoEndpointTransport;
declare const projected: LiveMap;
declare const now: LocusSessionNow;
declare const credential: LocusSessionCredential;
const endpoint = hsonLiveMap.echo.create({ transport: endpointTransport });
void [endpoint.clientId, endpoint.session, endpoint.connect, endpoint.disconnect,
  endpoint.action, endpoint.retryAction, endpoint.actionStatus, endpoint.dispose];
const endpointHasMap: "map" extends keyof typeof endpoint ? true : false = false;
// @ts-expect-error Endpoint-only Echo has no synchronization diagnostics.
endpoint.sync;
const replica = await hsonLiveMap.echo.create({ transport, now, credential });
void [replica.rev, replica.lib, replica.cut, replica.commits, replica.sync.appliedRev,
  replica.sync.status, replica.session, replica.connect, replica.disconnect];
const replicaHasMap: "map" extends keyof typeof replica ? true : false = false;
void [endpointHasMap, replicaHasMap];
const selected = replica.lib("state");
if (selected.source === "authority-projected" && selected.mode !== "document") {
  selected.at(["value"]).snap();
  // @ts-expect-error Projected data has no generic setter.
  selected.at(["value"]).set(1);
  // @ts-expect-error Projected Schema attachment is unavailable.
  selected.schema.use;
}
if (selected.source === "client-local" && selected.mode !== "document") {
  selected.at(["value"]).set(1);
  selected.schema.use;
}
const httpOptions: EchoHttpTransportOptions = { endpoint: "/_hson" };
const http = hsonLiveMap.echo.transport.http(httpOptions);
void [http.operations, http.synchronization, http.dispose];
const websocketOptions: EchoWebSocketTransportOptions = { url: "wss://example.test/_hson" };
const websocket = hsonLiveMap.echo.transport.websocket(websocketOptions);
void [websocket.operations, websocket.synchronization, websocket.dispose];
type HasInit = "init" extends keyof typeof hsonLiveMap.echo ? true : false;
const noInit: HasInit = false;
void noInit;
// @ts-expect-error Endpoint creation does not accept a replica map.
hsonLiveMap.echo.create({ transport, map: projected });
// @ts-expect-error Endpoint creation does not accept replica initialization state.
hsonLiveMap.echo.create({ transport, now });
// @ts-expect-error Replica establishment derives identity from session now state.
hsonLiveMap.echo.create({ transport, now, credential, logicalMapId: "caller-value" });
// @ts-expect-error Client-local declarations are not a replica-establishment input.
hsonLiveMap.echo.create({ transport, now, credential, local: {} });
// @ts-expect-error Socket is no longer an Echo construction option.
hsonLiveMap.echo.create({ socket: {} });
// @ts-expect-error Replica initialization requires synchronization capability.
hsonLiveMap.echo.create({ transport: endpointTransport, now, credential });
// @ts-expect-error Legacy one-map bootstrap Echo is retired.
import { create_locus_bootstrap_echo } from "hson-live/echo";
void create_locus_bootstrap_echo;
void [hsonLiveMap.echo, EchoSyncError, EchoSessionError];
void (0 as unknown as Echo<LiveMap> | EchoOptions | EchoReplicaOptions | EchoSession | EchoActionRequest);

// @ts-expect-error Echo construction is owned by hsonLiveMap.echo.
import { create_echo } from "hson-live/echo";
void create_echo;
