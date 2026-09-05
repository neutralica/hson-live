import {
  EchoRecoveryError,
  EchoSessionError,
  create_echo,
  create_locus_bootstrap_echo,
  hsonEcho,
  type Echo,
  type EchoActionFn,
  type EchoActionPromise,
  type EchoActionRequest,
  type EchoActionStatusResult,
  type EchoOptions,
  type EchoRecovery,
  type EchoRecoveryChange,
  type EchoRecoveryChangeListener,
  type EchoRecoveryCursor,
  type EchoRecoveryDiagnostics,
  type EchoRecoveryFailure,
  type EchoRecoveryOptions,
  type EchoRecoveryResult,
  type EchoRecoveryStatus,
  type EchoRecoveryStrategy,
  type EchoRetryActionFn,
  type EchoSession,
  type EchoSessionDiagnostics,
  type EchoSessionFailure,
  type EchoSessionOptions,
  type EchoSessionResult,
  type EchoSessionStatus,
  type LocusBootstrapEcho,
} from "hson-live/echo";
import type { LiveMap } from "hson-live/livemap";
import type { LocusSocketLike } from "hson-live/locus";

// @ts-expect-error Locus authority construction is not owned by Echo.
import { create_locus } from "hson-live/echo";
// @ts-expect-error Wire codecs remain owned by Locus.
import { decode_locus_message } from "hson-live/echo";
// @ts-expect-error Removed endpoint name has no compatibility alias.
import type { LocusClientActionPromise } from "hson-live/echo";
// @ts-expect-error Removed endpoint recovery name has no compatibility alias.
import type { LocusClientRecoveryCursor } from "hson-live/echo";
// @ts-expect-error Removed architectural endpoint type has no compatibility alias.
import type { LocusClient } from "hson-live/echo";
// @ts-expect-error Removed multi-library word order has no compatibility alias.
import type { EchoMultiLibraryOptions } from "hson-live/echo";
// @ts-expect-error Removed multi-library word order has no compatibility alias.
import type { EchoMultiLibraryRecovery } from "hson-live/echo";
// @ts-expect-error Removed bootstrap endpoint name has no compatibility alias.
import { create_locus_bootstrap_client } from "hson-live/echo";
// @ts-expect-error Removed bootstrap endpoint type has no compatibility alias.
import type { LocusBootstrapClient } from "hson-live/echo";

declare const socket: LocusSocketLike;
declare const echo: Echo;
declare const replicaEcho: Echo<LiveMap>;
declare const bootstrapEcho: LocusBootstrapEcho<LiveMap>;
const endpointEcho = create_echo({ socket });
void endpointEcho.clientId;
void endpointEcho.session;
void endpointEcho.connect;
void endpointEcho.disconnect;
void endpointEcho.action;
void endpointEcho.retryAction;
void endpointEcho.actionStatus;
void endpointEcho.dispose;
// @ts-expect-error endpoint-only Echo has no map
endpointEcho.map;
// @ts-expect-error endpoint-only Echo has no recovery
endpointEcho.recovery;
// @ts-expect-error endpoint-only Echo has no replica subscription surface
endpointEcho.subscribe;
// @ts-expect-error endpoint-only Echo has no legacy revision cursor
endpointEcho.seq;
// @ts-expect-error endpoint-only Echo has no public transient event surface
endpointEcho.onEvent;
// @ts-expect-error endpoint-only Echo does not imply LiveTree capability
endpointEcho.liveTree;
declare const replicaMap: LiveMap;
const constructedReplicaEcho = create_echo({
  socket,
  map: replicaMap,
  recovery: { logicalMapId: "entrypoint-replica" },
});
void constructedReplicaEcho.map;
void constructedReplicaEcho.recovery;
void constructedReplicaEcho.session;
void constructedReplicaEcho.connect;
void constructedReplicaEcho.disconnect;
// @ts-expect-error replica-bearing Echo does not imply LiveTree capability
constructedReplicaEcho.liveTree;
// @ts-expect-error replica construction requires recovery configuration
create_echo({ socket, map: replicaMap });
// @ts-expect-error recovery configuration requires a supplied map
create_echo({ socket, recovery: { logicalMapId: "entrypoint-replica" } });
// @ts-expect-error no-map construction cannot claim an arbitrary map type
create_echo<LiveMap>({ socket });
// @ts-expect-error Protocol correlation-ID generation is not public configuration.
create_echo({ socket, actionId: () => "test-request" });
// @ts-expect-error public onEvent was removed
echo.onEvent(() => {});
echo.retryAction({ requestId: "request", name: "action" });
void echo.actionStatus("request");
// @ts-expect-error endpoint-only Echo has no recovery
echo.recovery;
replicaEcho.recovery.onChange(() => {});
void replicaEcho.retryAction;
void replicaEcho.actionStatus;
replicaEcho.dispose();
void bootstrapEcho.connectAndRecover;
void bootstrapEcho.echo;
// @ts-expect-error Removed snake_case continuation has no alias.
void bootstrapEcho.connect_and_recover;
// @ts-expect-error Active continuation is named echo, not client.
void bootstrapEcho.client;
// @ts-expect-error Terminal endpoint disposal has no close alias.
replicaEcho.close();
// @ts-expect-error Removed snake_case endpoint method has no alias.
echo.on_event(() => {});
// @ts-expect-error Removed snake_case endpoint method has no alias.
echo.retry_action({ requestId: "request", name: "action" });
// @ts-expect-error Removed snake_case endpoint method has no alias.
void echo.action_status("request");
// @ts-expect-error Removed snake_case recovery method has no alias.
echo.recovery.on_change(() => {});

void create_echo;
void create_locus_bootstrap_echo;
void hsonEcho;
void EchoRecoveryError;
void EchoSessionError;
void (0 as unknown as Echo);
void (0 as unknown as EchoActionFn);
void (0 as unknown as EchoActionPromise);
void (0 as unknown as EchoActionRequest);
void (0 as unknown as EchoActionStatusResult);
void (0 as unknown as EchoOptions);
void (0 as unknown as EchoRecovery);
void (0 as unknown as EchoRecoveryChange);
void (0 as unknown as EchoRecoveryChangeListener);
void (0 as unknown as EchoRecoveryCursor);
void (0 as unknown as EchoRecoveryDiagnostics);
void (0 as unknown as EchoRecoveryFailure);
void (0 as unknown as EchoRecoveryOptions);
void (0 as unknown as EchoRecoveryResult);
void (0 as unknown as EchoRecoveryStatus);
void (0 as unknown as EchoRecoveryStrategy);
void (0 as unknown as EchoRetryActionFn);
void (0 as unknown as EchoSession);
void (0 as unknown as EchoSessionDiagnostics);
void (0 as unknown as EchoSessionFailure);
void (0 as unknown as EchoSessionOptions);
void (0 as unknown as EchoSessionResult);
void (0 as unknown as EchoSessionStatus);
void (0 as unknown as LocusBootstrapEcho<LiveMap>);
// @ts-expect-error obsolete topology-specific Echo type is absent
import type { MultiLibraryEcho } from "hson-live/echo";
// @ts-expect-error obsolete topology-specific Echo options are absent
import type { MultiLibraryEchoOptions } from "hson-live/echo";
// @ts-expect-error obsolete topology-specific Echo recovery is absent
import type { MultiLibraryEchoRecovery } from "hson-live/echo";
// @ts-expect-error Scout is deliberately not part of the Echo package
import type { Scout } from "hson-live/echo";
