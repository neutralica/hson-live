import { create_echo, hsonEcho, EchoRecoveryError, EchoSessionError,
  type Echo, type EchoOptions, type EchoReplicateOptions, type EchoSession,
  type EchoActionRequest } from "hson-live/echo";
import type { LiveMap } from "hson-live/livemap";
import type { LocusSessionCut, LocusSessionCredential, LocusSocketLike } from "hson-live/locus";

declare const socket: LocusSocketLike;
declare const projected: LiveMap;
declare const cut: LocusSessionCut;
declare const credential: LocusSessionCredential;
const endpoint = create_echo({ socket });
void [endpoint.clientId, endpoint.session, endpoint.connect, endpoint.disconnect,
  endpoint.action, endpoint.retryAction, endpoint.actionStatus, endpoint.dispose];
// @ts-expect-error Endpoint-only Echo has no map.
endpoint.map;
// @ts-expect-error Endpoint-only Echo has no recovery.
endpoint.recovery;
const replica = await hsonEcho.replicate({ socket, cut, credential });
void [replica.map, replica.recovery.status, replica.session, replica.connect, replica.disconnect];
// @ts-expect-error Endpoint creation does not accept a replica map.
create_echo({ socket, map: projected });
// @ts-expect-error Endpoint creation does not accept recovery configuration.
create_echo({ socket, recovery: { logicalMapId: "missing-map" } });
// @ts-expect-error Replica establishment derives identity from the cut.
hsonEcho.replicate({ socket, cut, credential, logicalMapId: "caller-value" });
// @ts-expect-error Client-local declarations are not a replica-establishment input.
hsonEcho.replicate({ socket, cut, credential, localLibraries: {} });
// @ts-expect-error Legacy one-map bootstrap Echo is retired.
import { create_locus_bootstrap_echo } from "hson-live/echo";
void create_locus_bootstrap_echo;
void [hsonEcho, EchoRecoveryError, EchoSessionError];
void (0 as unknown as Echo<LiveMap> | EchoOptions | EchoReplicateOptions | EchoSession | EchoActionRequest);
