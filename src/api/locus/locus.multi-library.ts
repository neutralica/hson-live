import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapLibraries,
} from "../../types/livemap.types.js";
import type {
  LocusActionPayloads,
  LocusClientActionMessage,
  LocusConnection,
  LocusConnectionContext,
  LocusMultiLibrary,
  LocusMultiLibraryActionContext,
  LocusMultiLibraryClient,
  LocusMultiLibraryClientOptions,
  LocusMultiLibraryOptions,
} from "../../types/locus.types.js";
import { make_locus_activity_controller } from "./locus.activity.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import {
  create_locus_hosted_aggregate_socket_client_internal,
  create_locus_hosted_aggregate_socket_internal,
} from "./locus.hosted-multi-library.socket.js";
import type { LocusHostedAggregateGateInput } from "./locus.hosted-multi-library.js";

const DIRECT_ORIGIN = Object.freeze({ kind: "direct" as const });

function establish_authority_identity(
  map: LiveMapLibraries,
  logicalMapId: string | undefined,
  incarnationId: string | undefined,
): void {
  if (logicalMapId === undefined && incarnationId === undefined) return;
  const aggregate = internal_livemap_aggregate_authority(map);
  const snapshot = aggregate.captureHosted();
  if (snapshot.revision !== 0) {
    throw new Error("A hosted multi-library Locus identity may be set only before its first transition.");
  }
  aggregate.restoreHosted(Object.freeze({
    ...snapshot,
    authority: Object.freeze({
      logicalMapId: logicalMapId ?? snapshot.authority.logicalMapId,
      incarnationId: incarnationId ?? snapshot.authority.incarnationId,
    }),
  }));
}

/**
 * Route a public fixed Library registry through the aggregate authority while
 * preserving the ordinary Locus construction and action callback shape.
 */
export function create_multi_library_locus<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: LocusMultiLibraryOptions<TMap, TActions>,
): LocusMultiLibrary<TMap, TActions> {
  return create_multi_library_locus_internal(options).locus;
}

/** Shared in-package composition point for the ordinary and durable Locus views. */
export function create_multi_library_locus_internal<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: LocusMultiLibraryOptions<TMap, TActions>,
  internal: Readonly<{
    gate?: (input: LocusHostedAggregateGateInput) => void | Promise<void>;
  }> = {},
): Readonly<{
  locus: LocusMultiLibrary<TMap, TActions>;
  run_exclusive: <TResult>(operation: () => TResult | Promise<TResult>) => Promise<TResult>;
}> {
  establish_authority_identity(options.map, options.logicalMapId, options.incarnationId);
  const activity = make_locus_activity_controller();
  let actionSequence = 0;
  let disposed = false;
  const actions: Record<string, (context: unknown, payload: JsonValue | undefined) => JsonValue | void | Promise<JsonValue | void>> = {};

  for (const [name, handler] of Object.entries(options.actions ?? {})) {
    if (handler === undefined) continue;
    actions[name] = async (context, payload) => {
      actionSequence += 1;
      const aggregateContext = context as Readonly<{
        map: LiveMapLibraries;
        mutate: (mutation: (draft: unknown) => void) => Promise<void>;
      }>;
      const publicContext: LocusMultiLibraryActionContext<TMap> = Object.freeze({
        map: aggregateContext.map as TMap,
        mutate: async (mutation) => aggregateContext.mutate(mutation as (draft: unknown) => void),
        seq: actionSequence,
        origin: DIRECT_ORIGIN,
        // Aggregate transport does not carry application events. Keep the
        // established action context callable without fabricating a stream.
        emit_event: () => false,
      });
      const message: LocusClientActionMessage<TActions> = Object.freeze({
        type: "action",
        id: `locus-action-${actionSequence}`,
        name,
        ...(payload === undefined ? {} : { payload }),
      }) as LocusClientActionMessage<TActions>;
      return (handler as (context: LocusMultiLibraryActionContext<TMap>, payload: JsonValue | undefined, message: LocusClientActionMessage<TActions>) => JsonValue | void | Promise<JsonValue | void>)(
        publicContext,
        payload,
        message,
      );
    };
  }

  const authority = create_locus_hosted_aggregate_socket_internal({
    map: options.map,
    ...(Object.keys(actions).length === 0 ? {} : { actions }),
    ...(internal.gate === undefined ? {} : { gate: internal.gate }),
  });

  const mutate: LocusMultiLibrary<TMap, TActions>["mutate"] = async (mutation) => {
    const release = activity.acquire("mutation");
    try {
      await authority.mutate((draft) => mutation(draft as never));
    } finally {
      release();
    }
  };

  const dispatch_action: LocusMultiLibrary<TMap, TActions>["dispatch_action"] = async (message) => {
    const release = activity.acquire("action");
    actionSequence += 1;
    try {
      const result = await authority.dispatch_action(message.name, message.payload);
      return Object.freeze({
        type: "ack" as const,
        id: message.id,
        ok: true as const,
        seq: actionSequence,
        ...(result === undefined ? {} : { result }),
      });
    } catch (cause) {
      return Object.freeze({
        type: "error" as const,
        id: message.id,
        ok: false as const,
        seq: actionSequence,
        error: Object.freeze({
          message: cause instanceof Error ? cause.message : "Locus action failed.",
        }),
      });
    } finally {
      release();
    }
  };

  const connect: LocusMultiLibrary<TMap, TActions>["connect"] = (socket, _context?: LocusConnectionContext) => {
    if (disposed) return Object.assign(() => {}, { emit_event: () => {} });
    const release = activity.acquire("connection");
    const stop = authority.connect(socket);
    let connected = true;
    const close = (): void => {
      if (!connected) return;
      connected = false;
      stop();
      release();
    };
    return Object.assign(close, { emit_event: () => {} }) as LocusConnection;
  };

  const locus = Object.freeze({
    map: options.map,
    logicalMapId: authority.logicalMapId,
    incarnationId: authority.incarnationId,
    get rev() { return authority.rev; },
    activity: activity.public,
    mutate,
    dispatch_action,
    connect,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      authority.dispose();
      activity.dispose();
    },
  });
  return Object.freeze({ locus, run_exclusive: authority.run_exclusive });
}

/** Create one complete fixed-registry mirror through the ordinary Locus client entry point. */
export function create_multi_library_locus_client<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: LocusMultiLibraryClientOptions<TMap>,
): LocusMultiLibraryClient<TMap, TActions> {
  const client = create_locus_hosted_aggregate_socket_client_internal({
    socket: options.socket,
    map: options.map,
    logicalMapId: options.recovery.logicalMapId,
  });

  return Object.freeze({
    map: options.map,
    logicalMapId: client.logicalMapId,
    get incarnationId() { return client.incarnationId; },
    get lastAppliedRev() { return client.lastAppliedRev; },
    connect: () => client.connect(),
    recover: () => client.recover(),
    subscribe: (library, path, listener) => client.subscribe(library, path, listener),
    unsubscribe: (library, path) => client.unsubscribe(library, path),
    action: (name, ...args) => client.action(name, args[0]),
    close: client.close,
  }) as LocusMultiLibraryClient<TMap, TActions>;
}
