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

/** Opaque prepared map-authority transition. @internal */
export type PreparedLiveMapAuthorityTransition = Readonly<{
  readonly kind: "authority";
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
export type LiveMapAuthorityTransitionAcceptance = Readonly<{
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

type AuthorityTransitionRecord<TCommit> = {
  state: TransitionState;
  baseRevision: number;
  generation: number;
  commit: TCommit;
  baseStillCurrent: () => boolean;
  install: () => void;
  notify: (commit: TCommit) => void;
};

type MapAuthorityTransitionRecord = AuthorityTransitionRecord<LiveMapAggregateCommit>;

/** Internal aggregate preparation accepted by the same map-wide controller. @internal */
export type LiveMapAuthorityTransitionPreparation = Readonly<{
  commit: LiveMapAggregateCommit;
  libraryModes: readonly LiveMapRootMode[];
  baseStillCurrent: () => boolean;
  install: () => void;
  notify: (commit: LiveMapAggregateCommit) => void;
}>;

export type LiveMapTransitionController = Readonly<{
  /** @internal */
  prepareAuthority: (
    preparation: LiveMapAuthorityTransitionPreparation,
  ) => PreparedLiveMapAuthorityTransition;
  /** Present one aggregate authority transition through the temporary solo token contract. @internal */
  projectAggregateCompatibility: (
    transition: PreparedLiveMapAuthorityTransition,
    commit: LiveMapCommit<LiveMapAnyOp>,
    mode: LiveMapRootMode,
  ) => PreparedLiveMapTransition;
  accept: (
    transition: PreparedLiveMapTransition,
    policy?: LiveMapTransitionNotificationPolicy,
  ) => LiveMapTransitionAcceptance;
  /** @internal */
  acceptAuthority: (
    transition: PreparedLiveMapAuthorityTransition,
    policy?: LiveMapTransitionNotificationPolicy,
    afterInstall?: () => void,
  ) => LiveMapAuthorityTransitionAcceptance;
  /** Fence all local identity and competing authority changes across an async durable decision. @internal */
  reserveAuthority: (transition: PreparedLiveMapAuthorityTransition) => () => void;
  assertLocalIdentityAllowed: () => void;
  discard: (transition: PreparedLiveMapTransition) => void;
  /** @internal */
  discardAuthority: (transition: PreparedLiveMapAuthorityTransition) => void;
  invalidate: () => void;
  assertPublicMutationAllowed: () => void;
  /** The owner currently executing a privileged transition, if any. @internal */
  managedExecutionOwner: () => object | undefined;
  claimManagement: (owner: object, schedule: LiveMapManagedMutationScheduler<object>) => void;
  releaseManagement: (owner: object) => void;
  /** Run a preparation owned by the current exclusive manager. @internal */
  runManaged: <T>(owner: object, operation: () => T) => T;
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
  runManaged: <T>(owner: object, operation: () => T) => T;
  scheduleManaged: (mutation: (draft: TMap) => LiveMapCommit<LiveMapAnyOp>) => Promise<LiveMapCommit<LiveMapAnyOp>> | undefined;
}>;

const authorities = new WeakMap<object, LiveMapStagedAuthority<object>>();

/** Construct one closure-local transition controller for a single LiveMap authority. */
export function make_livemap_transition_controller(
  getRevision: () => number,
): LiveMapTransitionController {
  const authorityRecords = new WeakMap<PreparedLiveMapAuthorityTransition, MapAuthorityTransitionRecord>();
  const aggregateCompatibility = new WeakMap<PreparedLiveMapTransition, Readonly<{
    transition: PreparedLiveMapAuthorityTransition;
    commit: LiveMapCommit<LiveMapAnyOp>;
  }>>();
  let generation = 0;
  let management: Readonly<{
    owner: object;
    schedule: LiveMapManagedMutationScheduler<object>;
  }> | undefined;
  let managedExecutionOwner: object | undefined;
  let reserved: PreparedLiveMapAuthorityTransition | undefined;

  function authority_record_for(
    transition: PreparedLiveMapAuthorityTransition,
  ): MapAuthorityTransitionRecord {
    const record = authorityRecords.get(transition);
    if (record !== undefined) return record;
    throw new LiveMapTransitionError(
      "LIVEMAP_TRANSITION_FOREIGN",
      "Prepared LiveMap authority transition belongs to another authority.",
    );
  }

  function prepareAuthority(
    preparation: LiveMapAuthorityTransitionPreparation,
  ): PreparedLiveMapAuthorityTransition {
    const baseRevision = getRevision();
    const commit = preparation.commit;
    if (commit.prevRev !== baseRevision
      || commit.rev !== (commit.changed ? baseRevision + 1 : baseRevision)) {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_INVALID",
        "Prepared LiveMap authority transition revisions are invalid.",
      );
    }
    const token = Object.freeze({
      kind: "authority" as const,
      commit,
      baseRevision,
      nextRevision: commit.rev,
      libraryModes: Object.freeze([...preparation.libraryModes]),
    });
    authorityRecords.set(token, {
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

  function projectAggregateCompatibility(
    transition: PreparedLiveMapAuthorityTransition,
    commit: LiveMapCommit<LiveMapAnyOp>,
    compatibilityMode: LiveMapRootMode,
  ): PreparedLiveMapTransition {
    authority_record_for(transition);
    if (commit.prevRev !== transition.baseRevision || commit.rev !== transition.nextRevision
      || commit.changed !== transition.commit.changed) {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_INVALID",
        "Solo compatibility commit disagrees with its map authority transition.",
      );
    }
    const token: PreparedLiveMapTransition = Object.freeze({
      commit,
      baseRevision: transition.baseRevision,
      nextRevision: transition.nextRevision,
      mode: compatibilityMode,
    });
    aggregateCompatibility.set(token, Object.freeze({ transition, commit }));
    return token;
  }

  function accept(
    transition: PreparedLiveMapTransition,
    policy: LiveMapTransitionNotificationPolicy = "legacy",
  ): LiveMapTransitionAcceptance {
    const compatibility = aggregateCompatibility.get(transition);
    if (compatibility !== undefined) {
      const accepted = acceptAuthority(compatibility.transition, policy);
      return Object.freeze({
        commit: compatibility.commit,
        notificationFailureCount: accepted.notificationFailureCount,
      });
    }
    throw new LiveMapTransitionError(
      "LIVEMAP_TRANSITION_FOREIGN",
      "Prepared LiveMap transition belongs to another authority.",
    );
  }

  function discard(transition: PreparedLiveMapTransition): void {
    const compatibility = aggregateCompatibility.get(transition);
    if (compatibility !== undefined) {
      discardAuthority(compatibility.transition);
      return;
    }
    throw new LiveMapTransitionError(
      "LIVEMAP_TRANSITION_FOREIGN",
      "Prepared LiveMap transition belongs to another authority.",
    );
  }

  function acceptAuthority(
    transition: PreparedLiveMapAuthorityTransition,
    policy: LiveMapTransitionNotificationPolicy = "legacy",
    afterInstall?: () => void,
  ): LiveMapAuthorityTransitionAcceptance {
    const record = authority_record_for(transition);
    return accept_record(record, "LiveMap authority", policy, transition, afterInstall);
  }

  function reserveAuthority(transition: PreparedLiveMapAuthorityTransition): () => void {
    const record = authority_record_for(transition);
    if (reserved !== undefined || record.state !== "pending"
      || record.baseRevision !== getRevision() || record.generation !== generation
      || !record.baseStillCurrent()) {
      throw new LiveMapTransitionError("LIVEMAP_TRANSITION_STALE", "Prepared LiveMap authority transition cannot be reserved.");
    }
    reserved = transition;
    return () => { if (reserved === transition) reserved = undefined; };
  }

  function accept_record<TCommit extends Readonly<{ changed: boolean }>>(
    record: AuthorityTransitionRecord<TCommit>,
    label: string,
    policy: LiveMapTransitionNotificationPolicy,
    transition?: PreparedLiveMapAuthorityTransition,
    afterInstall?: () => void,
  ): Readonly<{ commit: TCommit; notificationFailureCount: number }> {
    if (record.state === "accepted") {
      throw new LiveMapTransitionError("LIVEMAP_TRANSITION_ALREADY_ACCEPTED", `Prepared ${label} transition was already accepted.`);
    }
    if (record.state === "discarded") {
      throw new LiveMapTransitionError("LIVEMAP_TRANSITION_DISCARDED", `Prepared ${label} transition was discarded.`);
    }
    if (reserved !== undefined && reserved !== transition) {
      throw new LiveMapTransitionError("LIVEMAP_TRANSITION_STALE", `Prepared ${label} transition is fenced by a durable decision.`);
    }
    if (reserved !== transition && (record.baseRevision !== getRevision()
      || record.generation !== generation || !record.baseStillCurrent())) {
      throw new LiveMapTransitionError("LIVEMAP_TRANSITION_STALE", `Prepared ${label} transition is stale.`);
    }
    if (record.commit.changed) {
      try { record.install(); }
      catch (cause) {
        record.state = "discarded";
        generation += 1;
        throw new LiveMapTransitionError("LIVEMAP_TRANSITION_INVALID", `Prepared ${label} transition installation failed.`, { cause });
      }
      generation += 1;
    }
    record.state = "accepted";
    if (record.commit.changed) afterInstall?.();
    let notificationFailureCount = 0;
    if (record.commit.changed) {
      if (policy === "legacy") record.notify(record.commit);
      else {
        try { record.notify(record.commit); }
        catch { notificationFailureCount = 1; }
      }
    }
    return Object.freeze({ commit: record.commit, notificationFailureCount });
  }

  function discardAuthority(transition: PreparedLiveMapAuthorityTransition): void {
    const record = authority_record_for(transition);
    if (record.state === "accepted") {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_ALREADY_ACCEPTED",
        "Accepted LiveMap authority transition cannot be discarded.",
      );
    }
    if (record.state !== "discarded") record.state = "discarded";
  }

  return Object.freeze({
    prepareAuthority,
    projectAggregateCompatibility,
    accept,
    acceptAuthority,
    reserveAuthority,
    assertLocalIdentityAllowed(): void {
      if (reserved !== undefined) throw new LiveMapTransitionError(
        "LIVEMAP_MANAGED_MUTATION_REJECTED",
        "LiveMap local identity is reserved by a pending authority decision.",
      );
    },
    discard,
    discardAuthority,
    invalidate(): void {
      if (reserved !== undefined) throw new LiveMapTransitionError(
        "LIVEMAP_MANAGED_MUTATION_REJECTED", "LiveMap authority is reserved by a pending durable decision.",
      );
      generation += 1;
    },
    assertPublicMutationAllowed(): void {
      if (management === undefined || managedExecutionOwner === management.owner) return;
      throw new LiveMapTransitionError(
        "LIVEMAP_MANAGED_MUTATION_REJECTED",
        "LiveMap mutation is controlled by an exclusive Locus authority.",
      );
    },
    managedExecutionOwner: () => managedExecutionOwner,
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
    runManaged<T>(owner: object, operation: () => T): T {
      if (management?.owner !== owner) {
        throw new LiveMapTransitionError(
          "LIVEMAP_MANAGED_MUTATION_REJECTED",
          "LiveMap managed preparation belongs to another authority.",
        );
      }
      const previous = managedExecutionOwner;
      managedExecutionOwner = owner;
      try {
        return operation();
      } finally {
        managedExecutionOwner = previous;
      }
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
