import type { JsonValue } from "../../core/types.js";
import { hson_data_text, type ExactDataCarrier } from "../data/hson-data.js";
import type {
  LiveMap,
} from "../../types/livemap.types.js";
import type {
  LocusActionPayloads,
  LocusClientActionMessage,
  LocusConnection,
  LocusConnectionContext,
  Locus,
  LocusActionContext,
  LocusOptions,
} from "../../types/locus.types.js";
import { alias_locus_remote_action_admission_internal } from "./locus.remote-action.internal.js";
import { alias_locus_retained_action_status_internal } from "./locus.action-status.internal.js";
import { make_locus_activity_controller } from "./locus.activity.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import {
  create_locus_hosted_aggregate_socket_internal,
} from "./locus.aggregate.socket.js";
import type { LocusHostedAggregateGateInput } from "./locus.aggregate.js";
import { register_locus_libraries_snapshot_authority_internal } from "./locus.libraries-snapshot.js";
import { cut_hosted_projection } from "../../internal/document-cut.js";
import { capture_selected_authority_projection_snapshot } from "./locus.authority-projection-snapshot.js";
import { LocusProjectionUnavailableError } from "./locus.projection.js";
import { make_locus_hosted_projection_policy } from "./locus.projection.js";

function establish_authority_identity(
  map: LiveMap,
  logicalMapId: string | undefined,
  incarnationId: string | undefined,
): void {
  if (logicalMapId === undefined && incarnationId === undefined) return;
  const aggregate = internal_livemap_aggregate_authority(map);
  const position = aggregate.hostedPosition();
  if (position.revision !== 0) {
    throw new Error("A hosted registry Locus identity may be set only before its first transition.");
  }
  aggregate.setInitialHostedAuthority(Object.freeze({
    logicalMapId: logicalMapId ?? position.authority.logicalMapId,
    incarnationId: incarnationId ?? position.authority.incarnationId,
  }));
}

/**
 * Route a public fixed Library registry through the aggregate authority while
 * preserving the ordinary Locus construction and action callback shape.
 */
export function create_registry_locus<
  TMap extends LiveMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: LocusOptions<TMap, TActions>,
): Locus<TMap, TActions> {
  return create_registry_locus_internal(options).locus;
}

/** Shared in-package composition point for the ordinary and durable Locus views. */
export function create_registry_locus_internal<
  TMap extends LiveMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: LocusOptions<TMap, TActions>,
  internal: Readonly<{
    gate?: (input: LocusHostedAggregateGateInput) => void | Promise<void>;
    prepareGate?: (input: LocusHostedAggregateGateInput) => void;
    maxHistoryBytes?: number;
    afterRecoveryCut?: () => void | Promise<void>;
  }> = {},
): Readonly<{
  locus: Locus<TMap, TActions>;
  run_exclusive: <TResult>(operation: () => TResult | Promise<TResult>) => Promise<TResult>;
}> {
  const startingAuthority = internal_livemap_aggregate_authority(options.map);
  const startingPosition = startingAuthority.hostedPosition();
  make_locus_hosted_projection_policy(startingAuthority.hostedRegistry(), startingPosition.authority,
    options.exposure, options.defaultProjection, options.authorizeProjection);
  establish_authority_identity(options.map, options.logicalMapId, options.incarnationId);
  const activity = make_locus_activity_controller();
  let actionSequence = 0;
  let disposed = false;
  const actions: Record<string, (
    context: unknown,
    payload: ExactDataCarrier | undefined,
    message?: LocusClientActionMessage,
  ) => unknown | void | Promise<unknown | void>> = {};

  for (const [name, handler] of Object.entries(options.actions ?? {})) {
    if (handler === undefined) continue;
    actions[name] = async (context, payload, actionMessage) => {
      actionSequence += 1;
      const aggregateContext = context as Readonly<{
        map: LiveMap;
        origin: LocusActionContext<TMap>["origin"];
        mutate: (mutation: (draft: unknown) => void) => Promise<void>;
      }>;
      const publicContext: LocusActionContext<TMap> = Object.freeze({
        map: aggregateContext.map as TMap,
        mutate: async (mutation) => aggregateContext.mutate(mutation as (draft: unknown) => void),
        seq: actionSequence,
        origin: aggregateContext.origin,
        // Aggregate transport does not carry application events. Keep the
        // established action context callable without fabricating a stream.
        emitEvent: () => false,
      });
      const message: LocusClientActionMessage<TActions> = (actionMessage ?? Object.freeze({
        type: "action",
        id: `locus-action-${actionSequence}`,
        name,
        ...(payload === undefined ? {} : { payload: hson_data_text(payload) }),
      })) as LocusClientActionMessage<TActions>;
      return handler(
        publicContext,
        payload === undefined ? undefined : hson_data_text(payload),
        message,
      );
    };
  }

  const authority = create_locus_hosted_aggregate_socket_internal({
    map: options.map,
    exposure: options.exposure,
    ...(options.defaultProjection === undefined ? {} : { defaultProjection: options.defaultProjection }),
    ...(options.authorizeProjection === undefined ? {} : { authorizeProjection: options.authorizeProjection }),
    ...(Object.keys(actions).length === 0 ? {} : { actions }),
    ...(internal.gate === undefined ? {} : { gate: internal.gate }),
    ...(internal.prepareGate === undefined ? {} : { prepareGate: internal.prepareGate }),
    ...(internal.maxHistoryBytes === undefined ? {} : { maxHistoryBytes: internal.maxHistoryBytes }),
    ...(options.authorizeAction === undefined ? {} : { authorizeAction: options.authorizeAction }),
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    ...(options.sessions === undefined ? {} : { sessions: options.sessions }),
    ...(options.actionDedupe === undefined ? {} : { actionDedupe: options.actionDedupe }),
    ...(options.schema === undefined ? {} : { schema: options.schema }),
    internal: Object.freeze({
      ...(internal.afterRecoveryCut === undefined ? {} : { afterRecoveryCut: internal.afterRecoveryCut }),
      acquireActionActivity: () => activity.acquire("action"),
      acquireSessionActivity: () => activity.acquire("session"),
      acquireConnectionActivity: () => activity.acquire("connection"),
      acquireRecoveryActivity: () => activity.acquire("recovery"),
    }),
  });
  const retainedSessionReleases = new Map<string, () => void>();
  const stopSessionActivity = authority.sessions.onChange((event) => {
    if (event.kind === "attached" && event.session.resumable && !retainedSessionReleases.has(event.session.sessionId)) {
      retainedSessionReleases.set(event.session.sessionId, activity.acquire("session"));
      return;
    }
    if (event.kind !== "expired" && event.kind !== "revoked") return;
    const release = retainedSessionReleases.get(event.session.sessionId);
    retainedSessionReleases.delete(event.session.sessionId);
    release?.();
  });

  const mutate: Locus<TMap, TActions>["mutate"] = async (mutation) => {
    const release = activity.acquire("mutation");
    try {
      await authority.mutate((draft) => mutation(draft as never));
    } finally {
      release();
    }
  };

  const dispatchAction: Locus<TMap, TActions>["dispatchAction"] = async (message) => {
    const release = activity.acquire("action");
    try {
      return await authority.dispatch_message(message);
    } finally {
      release();
    }
  };

  const connect: Locus<TMap, TActions>["connect"] = (socket, _context?: LocusConnectionContext) => {
    if (disposed) return Object.assign(() => {}, { emitEvent: () => {} });
    const stop = authority.connect(socket, _context);
    return Object.assign(stop, { emitEvent: () => {} }) as LocusConnection;
  };

  const locus = Object.freeze({
    map: options.map,
    cut: (sessionId: string, document?: string) => {
      if (disposed || typeof sessionId !== "string" || sessionId.length === 0) throw new LocusProjectionUnavailableError();
      const effective = authority.sessions.projection(sessionId);
      if (effective === undefined) throw new LocusProjectionUnavailableError();
      const projected = capture_selected_authority_projection_snapshot(options.map, effective);
      const cut = cut_hosted_projection(projected, document);
      // Synchronous revocation observers can fence a cut while it is built.
      if (authority.sessions.projection(sessionId) !== effective) throw new LocusProjectionUnavailableError();
      return cut;
    },
    logicalMapId: authority.logicalMapId,
    incarnationId: authority.incarnationId,
    get rev() { return authority.rev; },
    activity: activity.public,
    sessions: authority.sessions,
    revokeSession: authority.sessions.revoke,
    actionRequests: authority.actionRequests,
    mutate,
    dispatchAction,
    connect,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      authority.dispose();
      stopSessionActivity();
      for (const release of retainedSessionReleases.values()) release();
      retainedSessionReleases.clear();
      activity.dispose();
    },
  });
  alias_locus_remote_action_admission_internal(locus, authority);
  alias_locus_retained_action_status_internal(locus, authority);
  register_locus_libraries_snapshot_authority_internal(locus, Object.freeze({
    capture: () => {
      const snapshot = internal_livemap_aggregate_authority(options.map).captureHosted();
      if (snapshot.authority.logicalMapId !== locus.logicalMapId
        || snapshot.authority.incarnationId !== locus.incarnationId
        || snapshot.revision !== locus.rev) {
        throw new Error("Hosted Libraries snapshot disagrees with its Locus authority fence.");
      }
      return snapshot;
    },
  }));
  return Object.freeze({ locus, run_exclusive: authority.run_exclusive });
}
