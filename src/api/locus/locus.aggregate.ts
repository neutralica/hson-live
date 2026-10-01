import type { JsonValue } from "../../core/types.js";
import { ExactDataCarrier } from "../data/hson-data.js";
import type {
  LiveMap,
  LiveMapDefinitions,
  LiveMapStagedWriter,
  LiveMapSynchronousAuthoring,
} from "../../types/livemap.types.js";
import type { LocusActionOrigin, LocusClientActionMessage } from "../../types/locus.types.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import {
  type HostedAggregateCommit,
} from "../livemap/livemap.hosted.js";
import type { PreparedLiveMapAuthorityTransition } from "../livemap/livemap.authority.js";
import { prepare_hosted_livemap_library_add_internal } from "../livemap/livemap.libraries.js";
import { is_staged_thenable, make_livemap_staged_writer } from "../livemap/livemap.staged.js";

export { DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES } from "./locus.aggregate.protocol.js";

/** Complete exact living-authority history envelope, never a client message. */
export type LocusHostedAggregateAuthorityEnvelope = Readonly<{
  logicalMapId: string;
  incarnationId: string;
  registryDigest: string;
  commit: HostedAggregateCommit;
}>;

export type LocusHostedAggregateStageWriter = LiveMapStagedWriter<LiveMap, void>;
export type LocusHostedAggregateDocumentStage = Extract<ReturnType<LocusHostedAggregateStageWriter["lib"]>, Readonly<{ mode: "document" }>>;
export type LocusHostedAggregateDataStage = Exclude<ReturnType<LocusHostedAggregateStageWriter["lib"]>, LocusHostedAggregateDocumentStage>;

export type LocusHostedAggregateActionContext = Readonly<{
  map: LiveMap;
  origin: LocusActionOrigin;
  /**
   * Add work to this action's one aggregate candidate. Nothing becomes visible
   * until the action returns and the single prepared transition is accepted.
   */
  stage: LocusHostedAggregateStageWriter;
}>;

export type LocusHostedAggregateAction = (
  context: LocusHostedAggregateActionContext,
  payload: ExactDataCarrier | undefined,
  message?: LocusClientActionMessage,
) => unknown | void | Promise<unknown | void>;

export type LocusHostedAggregateGateInput = Readonly<{
  transition: PreparedLiveMapAuthorityTransition;
  commit: HostedAggregateCommit;
  baseRevision: number;
  nextRevision: number;
  libraryOwnershipAdded?: readonly Readonly<{ name: string; ownership: "private" | "shared" }>[];
}>;

export type LocusHostedAggregatePreaccept = Readonly<{
  /** Install an already prepared retained-history decision after runtime installation. */
  install?: () => void;
  /** Release the session admission fence on either outcome. */
  release?: () => void;
}>;

export type LocusHostedAggregateOptions = Readonly<{
  map: LiveMap;
  actions?: Readonly<Record<string, LocusHostedAggregateAction>>;
  /** The existing Locus pre-accept/durability boundary, at aggregate granularity. */
  gate?: (input: LocusHostedAggregateGateInput) => void | Promise<void>;
  /** Validate and retain the portable record before the session roster cut. @internal */
  prepareGate?: (input: LocusHostedAggregateGateInput) => void;
  /** Synchronous semantic/session/history preflight before the durable gate. @internal */
  beforeAccept?: (input: LocusHostedAggregateGateInput) => LocusHostedAggregatePreaccept | void;
  /** Whether a gate failure may mean the durable record was written. @internal */
  uncertainGateFailure?: (cause: unknown) => boolean;
  /** Notification that this authority can no longer serve safely. @internal */
  onFault?: (cause: unknown) => void;
}>;

export type LocusHostedAggregate = Readonly<{
  map: LiveMap;
  readonly logicalMapId: string;
  readonly incarnationId: string;
  readonly registryDigest: string;
  readonly rev: number;
  stage: LiveMapSynchronousAuthoring<LocusHostedAggregateStageWriter, Promise<HostedAggregateCommit | undefined>>;
  /** @internal Stage one ordinary LiveMap library-add batch through this authority's gate. */
  add_libraries_internal: (definitions: LiveMapDefinitions, afterInstall?: () => void,
    ownership?: readonly Readonly<{ name: string; ownership: "private" | "shared" }>[]) => Promise<HostedAggregateCommit>;
  dispatch_action: (name: string, payload?: ExactDataCarrier | JsonValue, message?: LocusClientActionMessage, origin?: LocusActionOrigin) => Promise<unknown | void>;
  /** @internal Ordered non-mutation barrier shared with aggregate mutations. */
  run_exclusive: <TResult>(operation: () => TResult | Promise<TResult>) => Promise<TResult>;
  /** Internal exact transition feed for retained authority history. */
  on_commit: (listener: (commit: HostedAggregateCommit) => void) => () => void;
  dispose: () => void;
}>;

/**
 * Internal aggregate server authority. It owns one existing aggregate LiveMap
 * and lowers every action into exactly one exact map-authority transition.
 */
export function create_locus_hosted_aggregate_internal(
  options: LocusHostedAggregateOptions,
): LocusHostedAggregate {
  const aggregate = internal_livemap_aggregate_authority(options.map);
  const snapshot = aggregate.hostedPosition();
  const owner = Object.freeze({});
  const commitListeners = new Set<(commit: HostedAggregateCommit) => void>();
  let disposed = false;
  let faulted = false;
  let reservedDecision = false;
  let tail = Promise.resolve();
  const directOrigin: LocusActionOrigin = Object.freeze({ kind: "direct" });

  aggregate.claimManagement(owner);

  const accept_prepared = async (
    transition: PreparedLiveMapAuthorityTransition,
    afterInstall?: () => void,
    libraryOwnershipAdded?: readonly Readonly<{ name: string; ownership: "private" | "shared" }>[],
  ): Promise<HostedAggregateCommit> => {
    const hosted = transition.commit.hosted;
    if (hosted === undefined) {
      aggregate.discard(transition);
      throw new Error("Hosted map-authority transition did not produce exact replay evidence.");
    }
    if (transition.commit.changed === false) {
      // Consume the token with normal validity checks, without preparing or
      // publishing an authority revision that did not occur.
      aggregate.accept(transition);
      return hosted;
    }
    const gateInput = Object.freeze({ transition, commit: hosted,
      baseRevision: transition.baseRevision, nextRevision: transition.nextRevision,
      ...(libraryOwnershipAdded === undefined ? {} : { libraryOwnershipAdded }) });
    let releaseReservation: (() => void) | undefined;
    let preaccept: LocusHostedAggregatePreaccept | void;
    try {
      options.prepareGate?.(gateInput);
      releaseReservation = aggregate.reserve(transition);
      reservedDecision = true;
      preaccept = options.beforeAccept?.(gateInput);
    } catch (cause) {
      aggregate.discard(transition);
      releaseReservation?.();
      reservedDecision = false;
      if (disposed && !faulted) aggregate.releaseManagement(owner);
      throw cause;
    }
    let durableDecision = false;
    try {
      try {
        await options.gate?.(gateInput);
        durableDecision = true;
      } catch (cause) {
        if (options.uncertainGateFailure?.(cause)) {
          faulted = true;
          try { options.onFault?.(cause); } catch { /* The authority remains fenced. */ }
        }
        throw cause;
      }
      // The reserved transition is installed only after its durable decision.
      const accepted = aggregate.accept(transition, "isolate", () => {
        afterInstall?.();
        preaccept?.install?.();
      }).commit;
      const acceptedHosted = accepted.hosted;
      if (acceptedHosted === undefined) throw new Error("Accepted hosted commit is unavailable.");
      for (const listener of [...commitListeners]) {
        try { listener(acceptedHosted); } catch { /* External observers are isolated. */ }
      }
      return acceptedHosted;
    } catch (cause) {
      if (durableDecision) {
        faulted = true;
        try { options.onFault?.(cause); } catch { /* The authority remains fenced. */ }
      } else {
        aggregate.discard(transition);
      }
      throw cause;
    } finally {
      preaccept?.release?.();
      releaseReservation?.();
      reservedDecision = false;
      if (disposed && !faulted) aggregate.releaseManagement(owner);
    }
  };

  const enqueue = <T>(
    operation: (writer: LocusHostedAggregateStageWriter) => T | Promise<T>,
    synchronous = false,
  ): Promise<Readonly<{ result: T; commit: HostedAggregateCommit | undefined }>> => {
    const run = async (): Promise<Readonly<{ result: T; commit: HostedAggregateCommit | undefined }>> => {
      if (disposed || faulted) throw new Error("Hosted aggregate Locus authority is closed or faulted.");
      const accumulator = make_livemap_staged_writer<LiveMap>(aggregate);
      let result: T;
      try {
        const submitted = operation(accumulator.writer);
        if (synchronous && is_staged_thenable(submitted)) {
          void Promise.resolve(submitted).catch(() => {});
          throw new TypeError("Locus stage callback must be synchronous.");
        }
        result = synchronous ? submitted as T : await submitted;
      } finally {
        accumulator.close();
      }
      const writes = accumulator.writes();
      if (writes.length === 0) return Object.freeze({ result, commit: undefined });

      const transition = aggregate.prepareManaged(owner, writes);
      return Object.freeze({ result, commit: await accept_prepared(transition) });
    };
    const next = tail.then(run, run);
    tail = next.then(() => undefined, () => undefined);
    return next;
  };

  return Object.freeze({
    map: options.map,
    logicalMapId: snapshot.authority.logicalMapId,
    incarnationId: snapshot.authority.incarnationId,
    get registryDigest() { return aggregate.hostedPosition().registryDigest; },
    get rev() { return options.map.rev; },
    async stage(callback) {
      return (await enqueue(callback, true)).commit;
    },
    add_libraries_internal(definitions, afterInstall, ownership) {
      const run = async (): Promise<HostedAggregateCommit> => {
        if (disposed || faulted) throw new Error("Hosted aggregate Locus authority is closed or faulted.");
        const prepared = prepare_hosted_livemap_library_add_internal(options.map, owner, definitions);
        return accept_prepared(prepared.transition, () => {
          prepared.afterInstall();
          afterInstall?.();
        }, ownership);
      };
      const next = tail.then(run, run);
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
    async dispatch_action(name, payload, message, origin = directOrigin) {
      const action = options.actions?.[name];
      if (action === undefined) throw new Error(`Unknown hosted aggregate Locus action: ${name}`);
      const admittedPayload = payload === undefined ? undefined : ExactDataCarrier.from(payload);
      return (await enqueue(async (writer) => {
        const context: LocusHostedAggregateActionContext = Object.freeze({
          map: options.map,
          origin,
          stage: writer,
        });
        return action(context, admittedPayload, message);
      })).result;
    },
    run_exclusive<TResult>(operation: () => TResult | Promise<TResult>): Promise<TResult> {
      const run = async (): Promise<TResult> => {
        if (disposed || faulted) throw new Error("Hosted aggregate Locus authority is closed or faulted.");
        return operation();
      };
      const next = tail.then(run, run);
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
    on_commit(listener) {
      commitListeners.add(listener);
      return () => { commitListeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!faulted && !reservedDecision) aggregate.releaseManagement(owner);
    },
  });
}
