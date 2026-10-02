import type { JsonValue } from "../../core/types.js";
import type { EchoMapManagementLease } from "../../internal/echo-map-capability.js";
import type {
  EchoSyncDiagnostics,
  EchoSyncFailure,
  EchoSyncStatus,
  LocusActionPayloads,
} from "../../types/locus.types.js";
import type { LiveMap, LiveMapDocumentLibrary } from "../../types/livemap.types.js";
import type { ReplicaOptions, ReplicaStrategy } from "./echo.lazy.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { derive_replacement_lineage_for_action } from "../livemap/livemap.document.lineage.js";
import {
  document_action_payload_with_library,
  make_echo_document_authority,
  register_echo_document_authority,
  unregister_echo_document_authority,
  type EchoDocumentAuthority,
} from "./echo.document-authority.js";
import { create_echo_aggregate_client_internal } from "./echo.aggregate-replica.js";
import { encode_locus_portable_graph_content } from "../locus/locus.graph-content-codec.js";
import type { EchoEndpointConnection } from "./echo.client.js";
import type {
  LocusHostedAggregateCanonicalPublication,
  LocusHostedAggregateSynchronizationOutput,
  LocusHostedAggregateSynchronizationRequest,
} from "../locus/locus.aggregate.transport.internal.js";

/** Bind Echo authority to the projected portion of one fixed client registry. */
export function create_registry_echo<
  TMap extends LiveMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: ReplicaOptions<TMap>,
  composition: Readonly<{
    connection: EchoEndpointConnection<TActions>;
    management: EchoMapManagementLease;
  }>,
): ReplicaStrategy {
  const logicalMapId = internal_livemap_aggregate_authority(options.map).clientProjection()?.authority.logicalMapId;
  if (logicalMapId === undefined) throw new Error("Echo replica requires an admitted authority projection.");
  const endpoint = create_echo_aggregate_client_internal<TActions>({
    transport: options.transport,
    map: options.map,
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    connection: composition.connection,
    management: composition.management,
    ...(options.initialStateFingerprint === undefined ? {} : { initialStateFingerprint: options.initialStateFingerprint }),
    ...(options.initialInitializerDigest === undefined ? {} : { initialInitializerDigest: options.initialInitializerDigest }),
    ...(options.initialSessionBinding === undefined ? {} : { initialSessionBinding: options.initialSessionBinding }),
  });
  const documentAuthorities: Array<Readonly<{
    map: object;
    authority: EchoDocumentAuthority;
  }>> = [];
  const ensureDocumentAuthority = (map: LiveMapDocumentLibrary): EchoDocumentAuthority => {
      const previous = documentAuthorities.find((entry) => entry.map === map);
      if (previous !== undefined) return previous.authority;
      const name = internal_livemap_aggregate_authority(options.map).hostedRegistry().libraries
        .find((entry) => options.map.lib(entry.name) === map)?.name;
      if (name === undefined) throw new Error("Projected document Library name is unavailable.");
      const entry = { name };
      const authority = make_echo_document_authority(
        async (action, expectedIdentity) => {
          const payload: JsonValue = (action.name === "document.content.insert"
            ? Object.freeze({ ...action.payload, library: entry.name, content: encode_locus_portable_graph_content(action.payload.content) })
            : action.name === "document.content.replace"
              ? Object.freeze({ ...action.payload, library: entry.name, replacement: encode_locus_portable_graph_content(action.payload.replacement), lineage: derive_replacement_lineage_for_action(map.root(), "document", action.payload.target, action.payload.index, action.payload.replacement) })
              : document_action_payload_with_library(action, entry.name)) as unknown as JsonValue;
          let pending = endpoint.action(action.name, payload);
          let result;
          while (true) {
            try { result = await pending; break; }
            catch {
              const stable = pending.request;
              await endpoint.wait_until_ready();
              if (logicalMapId !== expectedIdentity.logicalMapId || endpoint.incarnationId !== expectedIdentity.incarnationId) {
                throw new Error("Echo document authority stream identity became incompatible before retry.");
              }
              pending = endpoint.retryAction(stable);
            }
          }
          return Object.freeze({ accepted: result.type === "ack" && result.ok === true,
            ...(result.completionRev === undefined ? {} : { completionRev: result.completionRev }),
            ...(result.type === "error" ? { error: result.error } : {}) });
        },
        () => endpoint.lastAppliedRev ?? 0,
        (listener) => endpoint.observeAuthorityPosition(listener),
        () => endpoint.replica.ready,
        endpoint.replica.onDispose,
        endpoint.replica.waitUntilReady,
        () => ({ logicalMapId, incarnationId: endpoint.incarnationId }),
        endpoint.replica.onStateChange,
        () => endpoint.replica.failure,
      );
      register_echo_document_authority(map, authority);
      documentAuthorities.push(Object.freeze({ map, authority }));
      return authority;
    };
  (internal_livemap_aggregate_authority(options.map).clientProjection()?.registry
    ?? internal_livemap_aggregate_authority(options.map).hostedRegistry()).libraries
    .filter((entry) => entry.mode === "document")
    .forEach((entry) => { ensureDocumentAuthority(options.map.lib(entry.name) as LiveMapDocumentLibrary); });

  const dispose = (): void => {
    for (const registration of documentAuthorities) {
      registration.authority.dispose();
      unregister_echo_document_authority(registration.map, registration.authority);
    }
    endpoint.dispose();
  };

  let recoveryFailure: EchoSyncFailure | undefined;

  function failure(): EchoSyncFailure | undefined {
    const underlying = endpoint.replica.failure;
    if (underlying === undefined) return recoveryFailure;
    if (underlying instanceof Error) return Object.freeze({
      code: "LOCUS_SYNC_FAILED", message: underlying.message, cause: underlying,
    });
    return recoveryFailure ?? Object.freeze({ code: "LOCUS_SYNC_FAILED", message: "Aggregate Echo synchronization failed.", cause: underlying });
  }

  function recoveryStatus(): EchoSyncStatus {
    const status = endpoint.diagnostics().status;
    if (status === "recovering") return "syncing";
    if (status === "live") return "caught_up";
    if (status === "failed") return "failed";
    if (failure() !== undefined) return "failed";
    return "idle";
  }

  const sync = Object.freeze({
    get appliedRev() { return endpoint.lastAppliedRev; },
    get status() { return recoveryStatus(); },
    get failure() { return failure(); },
    get strategy() { return endpoint.lastRecoveryOutcome; },
    async synchronize() {
      const previousIncarnation = endpoint.incarnationId;
      recoveryFailure = undefined;
      try {
        const result = await endpoint.recover();
        recoveryFailure = undefined;
        const incarnationId = endpoint.incarnationId;
        if (incarnationId === undefined) throw new Error("Aggregate synchronization completed without authority identity.");
        const sessionId = endpoint.session.sessionId;
        if (sessionId === undefined) throw new Error("Aggregate synchronization completed without an attached session.");
        return Object.freeze({
          strategy: result.outcome,
          sessionId,
          logicalMapId,
          incarnationId,
          headRev: result.revision,
          incarnationChanged: previousIncarnation !== undefined && previousIncarnation !== incarnationId,
        });
      } catch (cause) {
        recoveryFailure ??= Object.freeze({
          code: "LOCUS_SYNC_FAILED",
          message: cause instanceof Error ? cause.message : "Aggregate Echo synchronization failed.",
          cause,
        });
        throw cause;
      }
    },
    debug(): EchoSyncDiagnostics {
      return Object.freeze({
        status: recoveryStatus(),
        ...(endpoint.lastRecoveryOutcome === undefined ? {} : { strategy: endpoint.lastRecoveryOutcome }),
        logicalMapId,
        ...(endpoint.incarnationId === undefined ? {} : { incarnationId: endpoint.incarnationId }),
      });
    },
  });

  return Object.freeze({ sync, dispose, ensureDocumentAuthority });
}
