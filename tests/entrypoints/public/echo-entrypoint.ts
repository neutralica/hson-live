import { create_echo, hsonEcho, EchoSyncError, EchoSessionError,
  type Echo, type EchoOptions, type EchoReplicaOptions, type EchoSession,
  type EchoActionRequest, type EchoEndpointTransport, type EchoReplicaTransport,
  type EchoHttpTransportOptions } from "hson-live/echo";
import type { LiveMap } from "hson-live/livemap";
import type { LocusSessionNow, LocusSessionCredential } from "hson-live/locus";

declare const transport: EchoReplicaTransport;
declare const endpointTransport: EchoEndpointTransport;
declare const projected: LiveMap;
declare const now: LocusSessionNow;
declare const credential: LocusSessionCredential;
const endpoint = create_echo({ transport: endpointTransport });
void [endpoint.clientId, endpoint.session, endpoint.connect, endpoint.disconnect,
  endpoint.action, endpoint.retryAction, endpoint.actionStatus, endpoint.dispose];
const endpointHasMap: "map" extends keyof typeof endpoint ? true : false = false;
// @ts-expect-error Endpoint-only Echo has no synchronization diagnostics.
endpoint.sync;
const replica = await hsonEcho.create({ transport, now, credential });
void [replica.rev, replica.lib, replica.cut, replica.commits, replica.sync.appliedRev,
  replica.sync.status, replica.session, replica.connect, replica.disconnect];
const namedReplica = await create_echo({ transport, now, credential });
void [namedReplica.rev, namedReplica.lib, namedReplica.sync.status];
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
const http = hsonEcho.transport.http(httpOptions);
void [http.operations, http.synchronization, http.dispose];
type HasInit = "init" extends keyof typeof hsonEcho ? true : false;
const noInit: HasInit = false;
void noInit;
// @ts-expect-error Endpoint creation does not accept a replica map.
create_echo({ transport, map: projected });
// @ts-expect-error Endpoint creation does not accept replica initialization state.
create_echo({ transport, now });
// @ts-expect-error Replica establishment derives identity from session now state.
hsonEcho.create({ transport, now, credential, logicalMapId: "caller-value" });
// @ts-expect-error Client-local declarations are not a replica-establishment input.
hsonEcho.create({ transport, now, credential, local: {} });
// @ts-expect-error Socket is no longer an Echo construction option.
create_echo({ socket: {} });
// @ts-expect-error Replica initialization requires synchronization capability.
hsonEcho.create({ transport: endpointTransport, now, credential });
// @ts-expect-error Legacy one-map bootstrap Echo is retired.
import { create_locus_bootstrap_echo } from "hson-live/echo";
void create_locus_bootstrap_echo;
void [hsonEcho, EchoSyncError, EchoSessionError];
void (0 as unknown as Echo<LiveMap> | EchoOptions | EchoReplicaOptions | EchoSession | EchoActionRequest);
