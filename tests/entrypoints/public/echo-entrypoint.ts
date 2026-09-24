import { create_echo, hsonEcho, EchoRecoveryError, EchoSessionError,
  type Echo, type EchoOptions, type EchoRecoveryOptions, type EchoSession,
  type EchoActionRequest } from "hson-live/echo";
import type { LiveMapLibraries, DocumentLiveMap } from "hson-live/livemap";
import type { LocusSocketLike } from "hson-live/locus";

declare const socket: LocusSocketLike;
declare const projected: LiveMapLibraries;
const endpoint = create_echo({ socket });
void [endpoint.clientId, endpoint.session, endpoint.connect, endpoint.disconnect,
  endpoint.action, endpoint.retryAction, endpoint.actionStatus, endpoint.dispose];
// @ts-expect-error Endpoint-only Echo has no map.
endpoint.map;
// @ts-expect-error Endpoint-only Echo has no recovery.
endpoint.recovery;
const replica = create_echo({ socket, map: projected, recovery: { logicalMapId: "entrypoint-replica" } });
void [replica.map, replica.recovery, replica.session, replica.connect, replica.disconnect];
declare const localDocument: DocumentLiveMap;
// @ts-expect-error Solo hosted replica construction is retired.
create_echo({ socket, map: localDocument, recovery: { logicalMapId: "solo" } });
// @ts-expect-error Replica construction requires a recovery cursor.
create_echo({ socket, map: projected });
// @ts-expect-error Recovery configuration requires a projected map.
create_echo({ socket, recovery: { logicalMapId: "missing-map" } });
// @ts-expect-error Legacy one-map bootstrap Echo is retired.
import { create_locus_bootstrap_echo } from "hson-live/echo";
void create_locus_bootstrap_echo;
void [hsonEcho, EchoRecoveryError, EchoSessionError];
void (0 as unknown as Echo<LiveMapLibraries> | EchoOptions<LiveMapLibraries> | EchoRecoveryOptions | EchoSession | EchoActionRequest);
