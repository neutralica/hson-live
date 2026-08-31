import type { LiveMapLibraries } from "../../types/livemap.types.js";
import type {
  LocusActionPayloads,
  LocusMultiLibraryOptions,
  LocusMultiLibraryPersistenceAdapter,
  PersistentLocusMultiLibrary,
  PersistentLocusMultiLibraryOptions,
} from "../../types/locus.types.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import type { HostedAggregateCommit, HostedAggregateSnapshot } from "../livemap/livemap.hosted.js";
import { LocusPersistenceError } from "./locus.persistence.error.js";
import {
  load_persistent_locus_hosted_aggregate_internal,
  type LocusHostedAggregatePersistenceAdapter,
} from "./locus.hosted-multi-library.persistence.js";
import { create_multi_library_locus_internal } from "./locus.multi-library.js";

function checkpoint_record(snapshot: HostedAggregateSnapshot): object {
  return Object.freeze({
    logicalMapId: snapshot.authority.logicalMapId,
    incarnationId: snapshot.authority.incarnationId,
    mapKind: "hosted-aggregate",
    registryDigest: snapshot.registryDigest,
    rev: snapshot.revision,
    snapshot,
  });
}

function commit_record(commit: HostedAggregateCommit): object {
  return Object.freeze({
    logicalMapId: commit.authority.logicalMapId,
    incarnationId: commit.authority.incarnationId,
    mapKind: "hosted-aggregate",
    registryDigest: commit.registryDigest,
    commit,
  });
}

function set_initial_authority(
  map: LiveMapLibraries,
  logicalMapId: string | undefined,
  incarnationId: string | undefined,
): void {
  if (logicalMapId === undefined && incarnationId === undefined) return;
  const aggregate = internal_livemap_aggregate_authority(map);
  const snapshot = aggregate.captureHosted();
  if (snapshot.revision !== 0) {
    throw new LocusPersistenceError(
      "LOCUS_PERSISTED_STATE_INVALID",
      "A hosted multi-library persistence identity may be set only before its first transition.",
    );
  }
  aggregate.restoreHosted(Object.freeze({
    ...snapshot,
    authority: Object.freeze({
      logicalMapId: logicalMapId ?? snapshot.authority.logicalMapId,
      incarnationId: incarnationId ?? snapshot.authority.incarnationId,
    }),
  }));
}

async function durable_checkpoint(
  map: LiveMapLibraries,
  persistence: LocusMultiLibraryPersistenceAdapter,
): Promise<void> {
  try {
    await persistence.replaceCheckpoint(checkpoint_record(internal_livemap_aggregate_authority(map).captureHosted()));
  } catch (cause) {
    throw new LocusPersistenceError(
      "LOCUS_PERSISTENCE_CHECKPOINT_FAILED",
      "Hosted multi-library Locus could not replace its persisted checkpoint.",
      { cause },
    );
  }
}

async function append_durable_commit(
  persistence: LocusMultiLibraryPersistenceAdapter,
  commit: HostedAggregateCommit,
): Promise<void> {
  try {
    await persistence.appendCommit(commit_record(commit));
  } catch (cause) {
    throw new LocusPersistenceError(
      "LOCUS_PERSISTENCE_APPEND_FAILED",
      "Hosted multi-library Locus could not durably append the prepared commit.",
      { cause },
    );
  }
}

async function persistent_view<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads,
>(
  options: PersistentLocusMultiLibraryOptions<TMap, TActions>,
  initialize: boolean,
): Promise<PersistentLocusMultiLibrary<TMap, TActions>> {
  if (initialize) {
    set_initial_authority(options.map, options.logicalMapId, options.incarnationId);
    try {
      await options.persistence.replaceCheckpoint(checkpoint_record(internal_livemap_aggregate_authority(options.map).captureHosted()));
    } catch (cause) {
      throw new LocusPersistenceError(
        "LOCUS_PERSISTENCE_INITIAL_CHECKPOINT_FAILED",
        "Hosted multi-library Locus initial checkpoint could not be stored.",
        { cause },
      );
    }
  }
  const { persistence, ...locusOptions } = options;
  const managedOptions = initialize
    ? locusOptions
    : (() => {
      const { logicalMapId: _logicalMapId, incarnationId: _incarnationId, ...rest } = locusOptions;
      return rest;
    })();
  const runtime = create_multi_library_locus_internal(managedOptions as LocusMultiLibraryOptions<TMap, TActions>, {
    gate: ({ commit }) => append_durable_commit(persistence, commit),
  });
  const checkpoint = (): Promise<void> => runtime.run_exclusive(() => durable_checkpoint(options.map, persistence));
  return Object.freeze(Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(runtime.locus),
    checkpoint: Object.freeze({ value: checkpoint, enumerable: true }),
  })) as PersistentLocusMultiLibrary<TMap, TActions>;
}

/** Create a durable fixed-registry Locus through the ordinary persistence entry point. */
export async function create_persistent_multi_library_locus<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: PersistentLocusMultiLibraryOptions<TMap, TActions>,
): Promise<PersistentLocusMultiLibrary<TMap, TActions>> {
  const initial = internal_livemap_aggregate_authority(options.map).captureHosted();
  const logicalMapId = options.logicalMapId ?? initial.authority.logicalMapId;
  const restored = await load_persistent_locus_hosted_aggregate_internal(logicalMapId, {
    persistence: options.persistence as LocusHostedAggregatePersistenceAdapter,
  });
  if (restored === undefined) return persistent_view(options, true);
  const restoredSnapshot = internal_livemap_aggregate_authority(restored.map).captureHosted();
  if (restoredSnapshot.registryDigest !== initial.registryDigest) {
    restored.dispose();
    throw new LocusPersistenceError(
      "LOCUS_PERSISTED_STATE_INVALID",
      "Hosted multi-library persistence registry does not match the supplied static map topology.",
    );
  }
  // The caller's public map remains the authority identity. The durable loader
  // has already reconstructed and validated the exact state in an isolated map;
  // install that state into the same fixed registry before Locus claims it.
  internal_livemap_aggregate_authority(options.map).restoreHosted(restoredSnapshot);
  restored.dispose();
  return persistent_view(options, false);
}

/** @internal Load and validate a durable fixed-registry Locus before exposing its socket path. */
export async function load_persistent_multi_library_locus<
  TMap extends LiveMapLibraries = LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  logicalMapId: string,
  options: Omit<PersistentLocusMultiLibraryOptions<TMap, TActions>, "map" | "logicalMapId" | "incarnationId">,
): Promise<PersistentLocusMultiLibrary<TMap, TActions> | undefined> {
  const restored = await load_persistent_locus_hosted_aggregate_internal(logicalMapId, {
    persistence: options.persistence as LocusHostedAggregatePersistenceAdapter,
  });
  if (restored === undefined) return undefined;
  const map = restored.map as TMap;
  restored.dispose();
  return persistent_view({ ...options, map }, false);
}
