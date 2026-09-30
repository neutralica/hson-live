import { create_echo, hsonEcho, EchoSyncError, EchoSessionError,
  type Echo, type EchoOptions, type EchoInitOptions, type EchoSession,
  type EchoActionRequest, type EchoEndpointTransport, type EchoReplicaTransport } from "hson-live/echo";
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
// @ts-expect-error Endpoint-only Echo has no map.
endpoint.map;
// @ts-expect-error Endpoint-only Echo has no synchronization diagnostics.
endpoint.sync;
const replica = await hsonEcho.init({ transport, now, credential });
void [replica.map, replica.sync.status, replica.session, replica.connect, replica.disconnect];
// @ts-expect-error Endpoint creation does not accept a replica map.
create_echo({ transport, map: projected });
// @ts-expect-error Endpoint creation does not accept replica initialization state.
create_echo({ transport, now });
// @ts-expect-error Replica establishment derives identity from session now state.
hsonEcho.init({ transport, now, credential, logicalMapId: "caller-value" });
// @ts-expect-error Client-local declarations are not a replica-establishment input.
hsonEcho.init({ transport, now, credential, local: {} });
// @ts-expect-error Socket is no longer an Echo construction option.
create_echo({ socket: {} });
// @ts-expect-error Replica initialization requires synchronization capability.
hsonEcho.init({ transport: endpointTransport, now, credential });
// @ts-expect-error Legacy one-map bootstrap Echo is retired.
import { create_locus_bootstrap_echo } from "hson-live/echo";
void create_locus_bootstrap_echo;
void [hsonEcho, EchoSyncError, EchoSessionError];
void (0 as unknown as Echo<LiveMap> | EchoOptions | EchoInitOptions | EchoSession | EchoActionRequest);
