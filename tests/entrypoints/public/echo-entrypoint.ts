import { create_echo, hsonEcho, EchoSyncError, EchoSessionError,
  type Echo, type EchoOptions, type EchoInitOptions, type EchoSession,
  type EchoActionRequest } from "hson-live/echo";
import type { LiveMap } from "hson-live/livemap";
import type { LocusSessionNow, LocusSessionCredential, LocusSocketLike } from "hson-live/locus";

declare const socket: LocusSocketLike;
declare const projected: LiveMap;
declare const now: LocusSessionNow;
declare const credential: LocusSessionCredential;
const endpoint = create_echo({ socket });
void [endpoint.clientId, endpoint.session, endpoint.connect, endpoint.disconnect,
  endpoint.action, endpoint.retryAction, endpoint.actionStatus, endpoint.dispose];
// @ts-expect-error Endpoint-only Echo has no map.
endpoint.map;
// @ts-expect-error Endpoint-only Echo has no synchronization diagnostics.
endpoint.sync;
const replica = await hsonEcho.init({ socket, now, credential });
void [replica.map, replica.sync.status, replica.session, replica.connect, replica.disconnect];
// @ts-expect-error Endpoint creation does not accept a replica map.
create_echo({ socket, map: projected });
// @ts-expect-error Endpoint creation does not accept replica initialization state.
create_echo({ socket, now });
// @ts-expect-error Replica establishment derives identity from session now state.
hsonEcho.init({ socket, now, credential, logicalMapId: "caller-value" });
// @ts-expect-error Client-local declarations are not a replica-establishment input.
hsonEcho.init({ socket, now, credential, local: {} });
// @ts-expect-error Legacy one-map bootstrap Echo is retired.
import { create_locus_bootstrap_echo } from "hson-live/echo";
void create_locus_bootstrap_echo;
void [hsonEcho, EchoSyncError, EchoSessionError];
void (0 as unknown as Echo<LiveMap> | EchoOptions | EchoInitOptions | EchoSession | EchoActionRequest);
