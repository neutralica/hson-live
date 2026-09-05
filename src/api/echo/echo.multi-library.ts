import type { JsonValue } from "../../core/types.js";
import type { LiveMapLibraries } from "../../types/livemap.types.js";
import type {
  LocusActionPayloads,
  MultiLibraryEcho,
  MultiLibraryEchoOptions,
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
>(options: MultiLibraryEchoOptions<TMap>): MultiLibraryEcho<TMap, TActions> {
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

  return Object.freeze({
    map: options.map,
    logicalMapId: endpoint.logicalMapId,
    get incarnationId() { return endpoint.incarnationId; },
    get lastAppliedRev() { return endpoint.lastAppliedRev; },
    clientId: endpoint.clientId,
    session: endpoint.session,
    connect: () => endpoint.connect(),
    subscribe: (library, path, listener) => endpoint.subscribe(library, path, listener),
    unsubscribe: (library, path) => endpoint.unsubscribe(library, path),
    action: (name, ...args) => endpoint.action(name, args[0]),
    retryAction: (request) => endpoint.retryAction(request),
    actionStatus: (requestId) => endpoint.actionStatus(requestId),
    dispose,
  }) as MultiLibraryEcho<TMap, TActions>;
}
