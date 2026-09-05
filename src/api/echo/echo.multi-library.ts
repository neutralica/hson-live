import type { JsonValue } from "../../core/types.js";
import type { LiveMapLibraries } from "../../types/livemap.types.js";
import type {
  Echo,
  EchoRecoveryDiagnostics,
  EchoRecoveryChangeListener,
  EchoRecoveryFailure,
  EchoRecoveryOptions,
  EchoRecoveryStatus,
  EchoRecoveryStrategy,
  LocusActionPayloads,
  EchoOptions,
} from "../../types/locus.types.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import {
  document_action_payload_with_library,
  make_echo_document_authority,
  register_echo_document_authority,
  unregister_echo_document_authority,
  type EchoDocumentAuthority,
} from "./echo.document-authority.js";
import { create_multi_library_echo_socket_client_internal } from "./echo.multi-library.socket.js";
import { encode_locus_graph_content } from "../locus/locus.graph-content-codec.js";

/** Create one complete exact-topology Echo replica. */
export function create_multi_library_echo<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: EchoOptions<TMap> & Readonly<{ map: TMap; recovery: EchoRecoveryOptions }>): Echo<TMap, TActions> {
  const endpoint = create_multi_library_echo_socket_client_internal({
    socket: options.socket,
    map: options.map,
    logicalMapId: options.recovery.logicalMapId,
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.session === undefined ? {} : { session: options.session }),
  });
  const documentAuthorities: ReadonlyArray<Readonly<{
    map: object;
    authority: EchoDocumentAuthority;
  }>> = internal_livemap_aggregate_authority(options.map).hostedRegistry().libraries
    .filter((entry) => entry.mode === "document")
    .map((entry) => {
      const map = options.map.lib(entry.name);
      const authority = make_echo_document_authority(
        async (action) => {
          const payload: JsonValue = (action.name === "document.content.insert"
            ? Object.freeze({ ...action.payload, library: entry.name, content: encode_locus_graph_content(action.payload.content) })
            : action.name === "document.content.replace"
              ? Object.freeze({ ...action.payload, library: entry.name, replacement: encode_locus_graph_content(action.payload.replacement) })
              : document_action_payload_with_library(action, entry.name)) as unknown as JsonValue;
          let pending = endpoint.action(action.name, payload);
          let result;
          while (true) {
            try {
              result = await pending;
              break;
            } catch {
              const stable = pending.request;
              await endpoint.wait_until_ready();
              pending = endpoint.retryAction(stable);
            }
          }
          return Object.freeze({
            accepted: result.type === "ack" && result.ok === true,
            ...(result.completionRev === undefined ? {} : { completionRev: result.completionRev }),
          });
        },
        () => options.map.rev,
        (listener) => options.map.commits.observe(listener),
        () => endpoint.replica.ready,
        endpoint.replica.onDispose,
        endpoint.replica.waitUntilReady,
      );
      register_echo_document_authority(map, authority);
      return Object.freeze({ map, authority });
    });

  const dispose = (): void => {
    for (const registration of documentAuthorities) {
      registration.authority.dispose();
      unregister_echo_document_authority(registration.map, registration.authority);
    }
    endpoint.dispose();
  };

  let recoveryDisposed = false;
  let recoveryFailure: EchoRecoveryFailure | undefined;
  let recoveryStrategy: EchoRecoveryStrategy | undefined;

  function recoveryStatus(): EchoRecoveryStatus {
    if (recoveryDisposed) return "disposed";
    const status = endpoint.diagnostics().status;
    if (status === "recovering") return "recovering";
    if (status === "live") return "caught_up";
    if (status === "failed") return "failed";
    if (recoveryFailure !== undefined) return "failed";
    return "idle";
  }

  const recovery = Object.freeze({
    get status() { return recoveryStatus(); },
    get logicalMapId() { return options.recovery.logicalMapId; },
    get incarnationId() { return endpoint.incarnationId; },
    get lastAppliedRev() { return endpoint.lastAppliedRev; },
    map: options.map,
    get failure() { return recoveryFailure; },
    get strategy() { return recoveryStrategy; },
    async recover() {
      if (recoveryDisposed) throw new Error("Echo recovery is disposed.");
      const previousIncarnation = endpoint.incarnationId;
      try {
        const result = await endpoint.recover();
        recoveryStrategy = result.outcome;
        recoveryFailure = undefined;
        const incarnationId = endpoint.incarnationId;
        if (incarnationId === undefined) throw new Error("Aggregate recovery completed without authority identity.");
        const sessionId = endpoint.session.sessionId;
        if (sessionId === undefined) throw new Error("Aggregate recovery completed without an attached session.");
        return Object.freeze({
          strategy: result.outcome,
          sessionId,
          logicalMapId: options.recovery.logicalMapId,
          incarnationId,
          headRev: result.revision,
          incarnationChanged: previousIncarnation !== undefined && previousIncarnation !== incarnationId,
        });
      } catch (cause) {
        recoveryFailure ??= Object.freeze({
          code: "LOCUS_RECOVERY_FAILED",
          message: cause instanceof Error ? cause.message : "Aggregate Echo recovery failed.",
          cause,
        });
        throw cause;
      }
    },
    onChange(listener: EchoRecoveryChangeListener<TMap>) {
      if (recoveryDisposed) return () => {};
      return options.map.commits.observe((commit) => {
        const incarnationId = endpoint.incarnationId;
        if (incarnationId === undefined) return;
        listener(Object.freeze({
          kind: "commit",
          logicalMapId: options.recovery.logicalMapId,
          incarnationId,
          rev: commit.rev,
          map: options.map,
        }));
      });
    },
    dispose() {
      if (recoveryDisposed) return;
      recoveryDisposed = true;
      endpoint.replica.dispose();
    },
    debug(): EchoRecoveryDiagnostics {
      return Object.freeze({
        status: recoveryStatus(),
        ...(recoveryStrategy === undefined ? {} : { strategy: recoveryStrategy }),
        logicalMapId: options.recovery.logicalMapId,
        ...(endpoint.incarnationId === undefined ? {} : { incarnationId: endpoint.incarnationId }),
        ...(endpoint.lastAppliedRev === undefined ? {} : { lastAppliedRev: endpoint.lastAppliedRev }),
        bodyCommitsApplied: 0,
        snapshotInstalls: recoveryStrategy === "snapshot" ? 1 : 0,
        duplicateCommitsIgnored: 0,
        gapsDetected: 0,
        replayConflicts: 0,
        tailCommitsApplied: 0,
        liveCommitsApplied: 0,
        recoveryFailures: recoveryFailure === undefined ? 0 : 1,
        consumerNotifications: 0,
        observerFailures: 0,
      });
    },
  });

  return Object.freeze({
    map: options.map,
    recovery,
    clientId: endpoint.clientId,
    session: endpoint.session,
    connect: endpoint.attachTransport,
    disconnect: endpoint.disconnect,
    action: endpoint.action,
    retryAction: endpoint.retryAction,
    actionStatus: endpoint.actionStatus,
    dispose,
  }) as unknown as Echo<TMap, TActions>;
}
