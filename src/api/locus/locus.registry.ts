import type { JsonValue } from "../../core/types.js";
import { hson_data_text, type ExactDataCarrier } from "../data/hson-data.js";
import type {
  LiveMap,
  LiveMapStagedWriter,
} from "../../types/livemap.types.js";
import type {
  LocusActionPayloads,
  LocusClientActionMessage,
  LocusConnectionContext,
  Locus,
  LocusActionContext,
  LocusOptions,
  LocusSessionId,
  LocusSession,
  LocusSessionNow,
  LocusSessionHtmlNow,
  AuthorityProjectionSnapshot,
} from "../../types/locus.types.js";
import { alias_locus_remote_action_admission_internal } from "./locus.remote-action.internal.js";
import { alias_locus_retained_action_status_internal } from "./locus.action-status.internal.js";
import { make_locus_activity_controller } from "./locus.activity.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import {
  create_locus_hosted_aggregate_authority_internal,
} from "./locus.aggregate.authority.js";
import type { LocusHostedAggregateGateInput } from "./locus.aggregate.js";
import { cut_hosted_projection } from "../../internal/document-cut.js";
import { capture_selected_authority_projection_snapshot } from "./locus.authority-projection-snapshot.js";
import { LocusProjectionUnavailableError } from "./locus.projection.js";
import { make_locus_hosted_projection_policy } from "./locus.projection.js";
import { register_locus_semantic_attachment_internal } from "./locus.transport.internal.js";
import { make_locus_stage } from "./locus.stage.js";

function establish_authority_identity(
  map: LiveMap,
  logicalMapId: string | undefined,
  incarnationId: string | undefined,
): void {
  if (logicalMapId === undefined && incarnationId === undefined) return;
  const aggregate = internal_livemap_aggregate_authority(map);
  const position = aggregate.hostedPosition();
  if ((logicalMapId === undefined || logicalMapId === position.authority.logicalMapId)
    && (incarnationId === undefined || incarnationId === position.authority.incarnationId)) return;
  if (position.revision !== 0) {
    throw new Error("A hosted registry Locus identity may be set only before its first transition.");
  }
  aggregate.setInitialHostedAuthority(Object.freeze({
    logicalMapId: logicalMapId ?? position.authority.logicalMapId,
    incarnationId: incarnationId ?? position.authority.incarnationId,
  }));
}

/**
 * Route a public Library registry through the aggregate authority while
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
    recoveryFloorRevision?: number;
    afterRecoveryCut?: () => void | Promise<void>;
  }> = {},
): Readonly<{
  locus: Locus<TMap, TActions>;
  run_exclusive: <TResult>(operation: () => TResult | Promise<TResult>) => Promise<TResult>;
}> {
  const startingAuthority = internal_livemap_aggregate_authority(options.map);
  const startingPosition = startingAuthority.hostedPosition();
  make_locus_hosted_projection_policy(startingAuthority.hostedRegistry(), startingPosition.authority,
    options.libraries, options.defaultProjection, options.authorizeProjection, options.map);
  const probe = Object.freeze({});
  startingAuthority.claimManagement(probe);
  startingAuthority.releaseManagement(probe);
  let authorityForCleanup: Readonly<{ dispose: () => void }> | undefined;
  let activityForCleanup: Readonly<{ dispose: () => void }> | undefined;
  try {
  establish_authority_identity(options.map, options.logicalMapId, options.incarnationId);
  const activity = make_locus_activity_controller();
  activityForCleanup = activity;
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
        stage: LiveMapStagedWriter<LiveMap, void>;
      }>;
      const publicContext: LocusActionContext<TMap> = Object.freeze({
        map: aggregateContext.map as TMap,
        stage: aggregateContext.stage as LiveMapStagedWriter<TMap, void>,
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

  const authority = create_locus_hosted_aggregate_authority_internal({
    map: options.map,
    libraries: options.libraries,
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
      ...(internal.recoveryFloorRevision === undefined ? {} : { recoveryFloorRevision: internal.recoveryFloorRevision }),
      ...(internal.afterRecoveryCut === undefined ? {} : { afterRecoveryCut: internal.afterRecoveryCut }),
      acquireActionActivity: () => activity.acquire("action"),
      acquireSessionActivity: () => activity.acquire("session"),
      acquireConnectionActivity: () => activity.acquire("connection"),
      acquireRecoveryActivity: () => activity.acquire("recovery"),
    }),
  });
  authorityForCleanup = authority;
  const capabilities = new Map<LocusSessionId, LocusSession>();
  const retainedSessionReleases = new Map<string, () => void>();
  const stopSessionActivity = authority.sessions.onChange((event) => {
    if (event.kind === "attached" && event.session.resumable && !retainedSessionReleases.has(event.session.sessionId)) {
      retainedSessionReleases.set(event.session.sessionId, activity.acquire("session"));
      return;
    }
    if (event.kind !== "expired" && event.kind !== "revoked") return;
    capabilities.delete(event.session.sessionId);
    const release = retainedSessionReleases.get(event.session.sessionId);
    retainedSessionReleases.delete(event.session.sessionId);
    release?.();
  });

  let authoringStage = false;
  const submitStage = async (callback: (writer: LiveMapStagedWriter<LiveMap, void>) => void): Promise<void> => {
    if (authoringStage) throw new Error("Nested or direct Locus stage during an active stage callback is forbidden.");
    const release = activity.acquire("mutation");
    try {
      await authority.stage((writer) => {
        if (authoringStage) throw new Error("Nested Locus stage is forbidden.");
        authoringStage = true;
        try { return callback(writer); }
        finally { authoringStage = false; }
      });
    } finally {
      release();
    }
  };
  const stage = make_locus_stage(options.map, submitStage);

  const dispatchAction: Locus<TMap, TActions>["dispatchAction"] = async (message) => {
    const release = activity.acquire("action");
    try {
      return await authority.dispatch_message(message);
    } finally {
      release();
    }
  };

  function with_client_capture<TResult>(sessionId: LocusSessionId, key: object,
    consume: (snapshot: AuthorityProjectionSnapshot, effective: import("./locus.projection.js").LocusEffectiveProjection) => TResult): TResult {
    if (disposed || authority.sessions.key(sessionId) !== key) throw new LocusProjectionUnavailableError();
    const effective = authority.sessions.projection(sessionId);
    if (effective === undefined) throw new LocusProjectionUnavailableError();
    const projected = capture_selected_authority_projection_snapshot(options.map, effective);
    const result = consume(projected, effective);
    // Synchronous revocation observers can fence capture or rendering while it is built.
    if (authority.sessions.key(sessionId) !== key || authority.sessions.projection(sessionId) !== effective) throw new LocusProjectionUnavailableError();
    return result;
  }

  function retained_session(sessionId: LocusSessionId): LocusSession | undefined {
    const currentKey = authority.sessions.key(sessionId);
    if (disposed || currentKey === undefined) return undefined;
    const key: object = currentKey;
    const previous = capabilities.get(sessionId);
    if (previous !== undefined) return previous;
    function now(options: Readonly<{ html: string }>): LocusSessionHtmlNow;
    function now(options?: Readonly<{ html?: undefined }>): LocusSessionNow;
    function now(options: Readonly<{ html?: string }>): LocusSessionNow | LocusSessionHtmlNow;
    function now(options: Readonly<{ html?: string }> = {}): LocusSessionNow | LocusSessionHtmlNow {
      if (typeof options !== "object" || options === null || Array.isArray(options)
        || Object.keys(options).some(key => key !== "html")) {
        throw new TypeError("Session now options may contain only html.");
      }
      const html = options.html;
      return with_client_capture(sessionId, key, (snapshot, effective) => {
        const base: LocusSessionNow = Object.freeze({
          format: "hson-locus-session-now",
          sessionBinding: authority.sessions.binding(sessionId)!,
          libs: snapshot,
          local: effective.local,
          initializerDigest: effective.initializerDigest,
        });
        return html === undefined ? base : Object.freeze({ ...base, ...cut_hosted_projection(snapshot, html) });
      });
    }
    const session: LocusSession = Object.freeze({
      get credential() {
        if (disposed || authority.sessions.key(sessionId) !== key) throw new LocusProjectionUnavailableError();
        return authority.sessions.credential(sessionId);
      },
      now,
      update: (scope, context) => authority.sessions.updateProjection(sessionId, scope, context, key),
      revoke: () => !disposed && authority.sessions.key(sessionId) === key && authority.sessions.revoke(sessionId),
    });
    capabilities.set(sessionId, session);
    return session;
  }

  const locus = Object.freeze({
    map: options.map,
    lib: Object.freeze({ add: (definitions: import("../../types/livemap.types.js").LiveMapDefinitions,
      admission?: Readonly<{ ownership?: Readonly<Record<string, "private" | "shared">> }>) =>
      authority.add_libraries(definitions, admission?.ownership) }),
    logicalMapId: authority.logicalMapId,
    incarnationId: authority.incarnationId,
    get rev() { return authority.rev; },
    activity: activity.public,
    session: Object.freeze({
      create: async (scope: import("../../types/locus.types.js").LocusRequestedProjection,
        creation?: import("../../types/locus.types.js").LocusSessionCreateOptions) => {
        const id = await authority.create_session(scope, creation);
        const session = retained_session(id);
        if (session === undefined) throw new LocusProjectionUnavailableError();
        return session;
      },
      get: retained_session,
      debug: authority.sessions.debug,
      onChange: authority.sessions.onChange,
      dispose: authority.sessions.dispose,
    }),
    actionRequests: authority.actionRequests,
    stage,
    dispatchAction,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      authority.dispose();
      stopSessionActivity();
      for (const release of retainedSessionReleases.values()) release();
      retainedSessionReleases.clear();
      capabilities.clear();
      activity.dispose();
    },
  });
  register_locus_semantic_attachment_internal(locus, ({ notice, connection, onClose }) =>
    authority.attach(notice, connection, onClose), authority.debug().effectiveLiveWireBytes);
  alias_locus_remote_action_admission_internal(locus, authority);
  alias_locus_retained_action_status_internal(locus, authority);
  return Object.freeze({ locus, run_exclusive: authority.run_exclusive });
  } catch (cause) {
    authorityForCleanup?.dispose();
    activityForCleanup?.dispose();
    if (startingAuthority.hostedPosition().revision === 0) {
      startingAuthority.setInitialHostedAuthority(startingPosition.authority);
    }
    throw cause;
  }
}
