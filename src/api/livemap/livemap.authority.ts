import { clone_node } from "../../core/clone-node.js";
import type { LiveMapAnyOp, LiveMapCommit, LiveMapRootMode } from "../../types/livemap.types.js";
import type { LiveMapAggregateCommit } from "./livemap.library.js";

export type LiveMapTransitionNotificationPolicy = "legacy" | "isolate";

/** Opaque, detached view of one prepared but unapplied LiveMap transition. */
export type PreparedLiveMapTransition = Readonly<{
  readonly commit: LiveMapCommit<LiveMapAnyOp>;
  readonly baseRevision: number;
  readonly nextRevision: number;
  readonly mode: LiveMapRootMode;
}>;

/** Opaque prepared aggregate transition; never accepted by the legacy Locus boundary. @internal */
export type PreparedLiveMapAggregateTransition = Readonly<{
  readonly kind: "aggregate";
  readonly commit: LiveMapAggregateCommit;
  readonly baseRevision: number;
  readonly nextRevision: number;
  readonly libraryModes: readonly LiveMapRootMode[];
}>;

export type LiveMapTransitionAcceptance = Readonly<{
  commit: LiveMapCommit<LiveMapAnyOp>;
  notificationFailureCount: number;
}>;

/** Internal acceptance result retaining the non-serializable aggregate commit. @internal */
export type LiveMapAggregateTransitionAcceptance = Readonly<{
  commit: LiveMapAggregateCommit;
  notificationFailureCount: number;
}>;

export type LiveMapTransitionErrorCode =
  | "LIVEMAP_TRANSITION_FOREIGN"
  | "LIVEMAP_TRANSITION_STALE"
  | "LIVEMAP_TRANSITION_ALREADY_ACCEPTED"
  | "LIVEMAP_TRANSITION_DISCARDED"
  | "LIVEMAP_TRANSITION_INVALID"
  | "LIVEMAP_MANAGED_MUTATION_REJECTED"
  | "LIVEMAP_ALREADY_MANAGED";

export class LiveMapTransitionError extends Error {
  readonly code: LiveMapTransitionErrorCode;

  constructor(code: LiveMapTransitionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LiveMapTransitionError";
    this.code = code;
  }
}

type TransitionState = "pending" | "accepted" | "discarded";

type TransitionRecord = {
  state: TransitionState;
  baseRevision: number;
  generation: number;
  mode: LiveMapRootMode;
  commit: LiveMapCommit<LiveMapAnyOp>;
  baseStillCurrent: () => boolean;
  install: () => void;
  notify: (commit: LiveMapCommit<LiveMapAnyOp>) => void;
};

type AggregateTransitionRecord = {
  state: TransitionState;
  baseRevision: number;
  generation: number;
  commit: LiveMapAggregateCommit;
  baseStillCurrent: () => boolean;
  install: () => void;
  notify: (commit: LiveMapAggregateCommit) => void;
};

export type LiveMapTransitionPreparation = Readonly<{
  commit: LiveMapCommit<LiveMapAnyOp>;
  baseStillCurrent: () => boolean;
  install: () => void;
  notify: (commit: LiveMapCommit<LiveMapAnyOp>) => void;
}>;

/** Internal aggregate preparation accepted by the same map-wide controller. @internal */
export type LiveMapAggregateTransitionPreparation = Readonly<{
  commit: LiveMapAggregateCommit;
  libraryModes: readonly LiveMapRootMode[];
  baseStillCurrent: () => boolean;
  install: () => void;
  notify: (commit: LiveMapAggregateCommit) => void;
}>;

export type LiveMapTransitionController = Readonly<{
  prepare: (preparation: LiveMapTransitionPreparation) => PreparedLiveMapTransition;
  /** @internal */
  prepareAggregate: (
    preparation: LiveMapAggregateTransitionPreparation,
  ) => PreparedLiveMapAggregateTransition;
  accept: (
    transition: PreparedLiveMapTransition,
    policy?: LiveMapTransitionNotificationPolicy,
  ) => LiveMapTransitionAcceptance;
  /** @internal */
  acceptAggregate: (
    transition: PreparedLiveMapAggregateTransition,
    policy?: LiveMapTransitionNotificationPolicy,
  ) => LiveMapAggregateTransitionAcceptance;
  discard: (transition: PreparedLiveMapTransition) => void;
  /** @internal */
  discardAggregate: (transition: PreparedLiveMapAggregateTransition) => void;
  invalidate: () => void;
  assertPublicMutationAllowed: () => void;
  claimManagement: (owner: object, schedule: LiveMapManagedMutationScheduler<object>) => void;
  releaseManagement: (owner: object) => void;
  scheduleManaged: (
    mutation: (draft: object) => LiveMapCommit<LiveMapAnyOp>,
  ) => Promise<LiveMapCommit<LiveMapAnyOp>> | undefined;
  readonly generation: number;
}>;

export type LiveMapManagedMutationScheduler<TMap extends object> = (
  mutation: (draft: TMap) => LiveMapCommit<LiveMapAnyOp>,
) => Promise<LiveMapCommit<LiveMapAnyOp>>;

export type LiveMapStagedAuthority<TMap extends object = object> = Readonly<{
  prepare: (mutation: (draft: TMap) => LiveMapCommit<LiveMapAnyOp>) => PreparedLiveMapTransition;
  accept: LiveMapTransitionController["accept"];
  discard: LiveMapTransitionController["discard"];
  claimManagement: (owner: object, schedule: LiveMapManagedMutationScheduler<TMap>) => void;
  releaseManagement: (owner: object) => void;
  scheduleManaged: (mutation: (draft: TMap) => LiveMapCommit<LiveMapAnyOp>) => Promise<LiveMapCommit<LiveMapAnyOp>> | undefined;
}>;

const authorities = new WeakMap<object, LiveMapStagedAuthority<object>>();

/** Construct one closure-local transition controller for a single LiveMap authority. */
export function make_livemap_transition_controller(
  mode: LiveMapRootMode,
  getRevision: () => number,
): LiveMapTransitionController {
  const records = new WeakMap<PreparedLiveMapTransition, TransitionRecord>();
  const aggregateRecords = new WeakMap<PreparedLiveMapAggregateTransition, AggregateTransitionRecord>();
  let generation = 0;
  let management: Readonly<{
    owner: object;
    schedule: LiveMapManagedMutationScheduler<object>;
  }> | undefined;

  function prepare(preparation: LiveMapTransitionPreparation): PreparedLiveMapTransition {
    const baseRevision = getRevision();
    const commit = preparation.commit;
    if (commit.prevRev !== baseRevision
      || commit.rev !== (commit.changed ? baseRevision + 1 : baseRevision)) {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_INVALID",
        "Prepared LiveMap transition revisions are invalid.",
      );
    }

    const token = Object.freeze({
      commit: deep_freeze(clone_node(commit)),
      baseRevision,
      nextRevision: commit.rev,
      mode,
    });
    records.set(token, {
      state: "pending",
      baseRevision,
      generation,
      mode,
      commit,
      baseStillCurrent: preparation.baseStillCurrent,
      install: preparation.install,
      notify: preparation.notify,
    });
    return token;
  }

  function record_for(transition: PreparedLiveMapTransition): TransitionRecord {
    const record = records.get(transition);
    if (record !== undefined) return record;
    throw new LiveMapTransitionError(
      "LIVEMAP_TRANSITION_FOREIGN",
      "Prepared LiveMap transition belongs to another authority.",
    );
  }

  function aggregate_record_for(
    transition: PreparedLiveMapAggregateTransition,
  ): AggregateTransitionRecord {
    const record = aggregateRecords.get(transition);
    if (record !== undefined) return record;
    throw new LiveMapTransitionError(
      "LIVEMAP_TRANSITION_FOREIGN",
      "Prepared aggregate LiveMap transition belongs to another authority.",
    );
  }

  function prepareAggregate(
    preparation: LiveMapAggregateTransitionPreparation,
  ): PreparedLiveMapAggregateTransition {
    const baseRevision = getRevision();
    const commit = preparation.commit;
    if (commit.prevRev !== baseRevision
      || commit.rev !== (commit.changed ? baseRevision + 1 : baseRevision)
      || preparation.libraryModes.length === 0) {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_INVALID",
        "Prepared aggregate LiveMap transition revisions or libraries are invalid.",
      );
    }
    const token = Object.freeze({
      kind: "aggregate" as const,
      commit,
      baseRevision,
      nextRevision: commit.rev,
      libraryModes: Object.freeze([...preparation.libraryModes]),
    });
    aggregateRecords.set(token, {
      state: "pending",
      baseRevision,
      generation,
      commit,
      baseStillCurrent: preparation.baseStillCurrent,
      install: preparation.install,
      notify: preparation.notify,
    });
    return token;
  }

  function accept(
    transition: PreparedLiveMapTransition,
    policy: LiveMapTransitionNotificationPolicy = "legacy",
  ): LiveMapTransitionAcceptance {
    const record = record_for(transition);
    if (record.state === "accepted") {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_ALREADY_ACCEPTED",
        "Prepared LiveMap transition was already accepted.",
      );
    }
    if (record.state === "discarded") {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_DISCARDED",
        "Prepared LiveMap transition was discarded.",
      );
    }
    if (record.mode !== mode
      || record.baseRevision !== getRevision()
      || record.generation !== generation
      || !record.baseStillCurrent()) {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_STALE",
        "Prepared LiveMap transition is stale.",
      );
    }

    if (record.commit.changed) {
      try {
        record.install();
      } catch (cause) {
        record.state = "discarded";
        generation += 1;
        throw new LiveMapTransitionError(
          "LIVEMAP_TRANSITION_INVALID",
          "Prepared LiveMap transition installation failed.",
          { cause },
        );
      }
      generation += 1;
    }
    record.state = "accepted";

    let notificationFailureCount = 0;
    if (record.commit.changed) {
      if (policy === "legacy") {
        record.notify(record.commit);
      } else {
        try {
          record.notify(record.commit);
        } catch {
          notificationFailureCount = 1;
        }
      }
    }

    return Object.freeze({
      commit: record.commit,
      notificationFailureCount,
    });
  }

  function discard(transition: PreparedLiveMapTransition): void {
    const record = record_for(transition);
    if (record.state === "accepted") {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_ALREADY_ACCEPTED",
        "Accepted LiveMap transition cannot be discarded.",
      );
    }
    if (record.state === "discarded") return;
    record.state = "discarded";
  }

  function acceptAggregate(
    transition: PreparedLiveMapAggregateTransition,
    policy: LiveMapTransitionNotificationPolicy = "legacy",
  ): LiveMapAggregateTransitionAcceptance {
    const record = aggregate_record_for(transition);
    if (record.state === "accepted") {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_ALREADY_ACCEPTED",
        "Prepared aggregate LiveMap transition was already accepted.",
      );
    }
    if (record.state === "discarded") {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_DISCARDED",
        "Prepared aggregate LiveMap transition was discarded.",
      );
    }
    if (record.baseRevision !== getRevision()
      || record.generation !== generation
      || !record.baseStillCurrent()) {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_STALE",
        "Prepared aggregate LiveMap transition is stale.",
      );
    }
    if (record.commit.changed) {
      try {
        record.install();
      } catch (cause) {
        record.state = "discarded";
        generation += 1;
        throw new LiveMapTransitionError(
          "LIVEMAP_TRANSITION_INVALID",
          "Prepared aggregate LiveMap transition installation failed.",
          { cause },
        );
      }
      generation += 1;
    }
    record.state = "accepted";
    let notificationFailureCount = 0;
    if (record.commit.changed) {
      if (policy === "legacy") {
        record.notify(record.commit);
      } else {
        try {
          record.notify(record.commit);
        } catch {
          notificationFailureCount = 1;
        }
      }
    }
    return Object.freeze({ commit: record.commit, notificationFailureCount });
  }

  function discardAggregate(transition: PreparedLiveMapAggregateTransition): void {
    const record = aggregate_record_for(transition);
    if (record.state === "accepted") {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_ALREADY_ACCEPTED",
        "Accepted aggregate LiveMap transition cannot be discarded.",
      );
    }
    if (record.state !== "discarded") record.state = "discarded";
  }

  return Object.freeze({
    prepare,
    prepareAggregate,
    accept,
    acceptAggregate,
    discard,
    discardAggregate,
    invalidate(): void {
      generation += 1;
    },
    assertPublicMutationAllowed(): void {
      if (management === undefined) return;
      throw new LiveMapTransitionError(
        "LIVEMAP_MANAGED_MUTATION_REJECTED",
        "LiveMap mutation is controlled by an exclusive Locus authority.",
      );
    },
    claimManagement(owner, schedule): void {
      if (management !== undefined && management.owner !== owner) {
        throw new LiveMapTransitionError(
          "LIVEMAP_ALREADY_MANAGED",
          "LiveMap is already controlled by another exclusive authority.",
        );
      }
      management = Object.freeze({ owner, schedule });
    },
    releaseManagement(owner): void {
      if (management?.owner === owner) management = undefined;
    },
    scheduleManaged(mutation) {
      return management?.schedule(mutation);
    },
    get generation() {
      return generation;
    },
  });
}

export function register_livemap_staged_authority<TMap extends object>(
  map: TMap,
  authority: LiveMapStagedAuthority<TMap>,
): void {
  authorities.set(map, authority as unknown as LiveMapStagedAuthority<object>);
}

/** Package-internal accessor used by the later hosted-authority layer and focused tests. */
export function get_livemap_staged_authority<TMap extends object>(
  map: TMap,
): LiveMapStagedAuthority<TMap> {
  const authority = authorities.get(map);
  if (authority !== undefined) return authority as unknown as LiveMapStagedAuthority<TMap>;
  throw new LiveMapTransitionError(
    "LIVEMAP_TRANSITION_INVALID",
    "LiveMap has no staged authority controller.",
  );
}

/** Route a managed link-target mutation without importing Locus into LiveMap. */
export function schedule_livemap_managed_mutation<TMap extends object>(
  map: TMap,
  mutation: (draft: TMap) => LiveMapCommit<LiveMapAnyOp>,
): Promise<LiveMapCommit<LiveMapAnyOp>> | undefined {
  const authority = authorities.get(map);
  return authority?.scheduleManaged(mutation as (draft: object) => LiveMapCommit<LiveMapAnyOp>);
}

function deep_freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deep_freeze(item);
  return Object.freeze(value);
}
