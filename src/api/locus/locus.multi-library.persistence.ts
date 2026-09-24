import type { HostedLiveMapLibrariesSnapshot, LiveMapLibraries } from "../../types/livemap.types.js";
import type {
  LocusActionPayloads,
  LocusMultiLibraryOptions,
  LocusMultiLibraryPersistenceAdapter,
  PersistentLocusMultiLibrary,
  PersistentLocusMultiLibraryOptions,
} from "../../types/locus.types.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import type { HostedAggregateCommit } from "../livemap/livemap.hosted.js";
import { LocusPersistenceAppendUncertainError, LocusPersistenceError } from "./locus.persistence.error.js";
import {
  durable_aggregate_checkpoint,
  durable_aggregate_commit,
  durable_aggregate_snapshot_as_client,
  load_persistent_locus_hosted_aggregate_internal,
  type LocusHostedAggregatePersistenceAdapter,
} from "./locus.hosted-multi-library.persistence.js";
import { create_multi_library_locus_internal } from "./locus.multi-library.js";
import { alias_locus_remote_action_admission_internal } from "./locus.remote-action.internal.js";
import { alias_locus_retained_action_status_internal } from "./locus.action-status.internal.js";
import { alias_locus_libraries_snapshot_authority_internal } from "./locus.libraries-snapshot.js";
import { make_locus_hosted_projection_policy } from "./locus.projection.js";

function checkpoint_record(snapshot: HostedLiveMapLibrariesSnapshot): object {
  return durable_aggregate_checkpoint(snapshot);
}

function commit_record(commit: HostedAggregateCommit): object {
  return durable_aggregate_commit(commit);
}

function set_initial_authority(
  map: LiveMapLibraries,
  logicalMapId: string | undefined,
  incarnationId: string | undefined,
): void {
  if (logicalMapId === undefined && incarnationId === undefined) return;
  const aggregate = internal_livemap_aggregate_authority(map);
  const position = aggregate.hostedPosition();
  if (position.revision !== 0) {
    throw new LocusPersistenceError(
      "LOCUS_PERSISTED_STATE_INVALID",
      "A hosted multi-library persistence identity may be set only before its first transition.",
    );
  }
  aggregate.setInitialHostedAuthority(Object.freeze({
    logicalMapId: logicalMapId ?? position.authority.logicalMapId,
    incarnationId: incarnationId ?? position.authority.incarnationId,
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
  record: object,
): Promise<void> {
  try {
    await persistence.appendCommit(record);
  } catch (cause) {
    // Adapters promise ordinary rejection means no write. They must signal
    // uncertain write-then-error outcomes explicitly; those fence the host.
    throw new LocusPersistenceError(
      cause instanceof LocusPersistenceAppendUncertainError
        ? "LOCUS_PERSISTENCE_APPEND_UNCERTAIN" : "LOCUS_PERSISTENCE_APPEND_FAILED",
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
  const exposureAuthority = internal_livemap_aggregate_authority(options.map);
  make_locus_hosted_projection_policy(exposureAuthority.hostedRegistry(), exposureAuthority.hostedPosition().authority,
    options.exposure, options.defaultProjection, options.authorizeProjection);
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
  const records = new WeakMap<HostedAggregateCommit, object>();
  const runtime = create_multi_library_locus_internal(managedOptions as LocusMultiLibraryOptions<TMap, TActions>, {
    prepareGate: ({ commit }) => {
      if (!commit.changed) return;
      const record = commit_record(commit);
      JSON.stringify(record);
      records.set(commit, record);
    },
    gate: ({ commit }) => {
      if (!commit.changed) return;
      const record = records.get(commit);
      if (record === undefined) throw new Error("Prepared durable aggregate record is unavailable.");
      return append_durable_commit(persistence, record);
    },
  });
  const checkpoint = (): Promise<void> => runtime.run_exclusive(() => durable_checkpoint(options.map, persistence));
  const locus = Object.freeze(Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(runtime.locus),
    checkpoint: Object.freeze({ value: checkpoint, enumerable: true }),
  })) as PersistentLocusMultiLibrary<TMap, TActions>;
  alias_locus_remote_action_admission_internal(locus, runtime.locus);
  alias_locus_retained_action_status_internal(locus, runtime.locus);
  alias_locus_libraries_snapshot_authority_internal(locus, runtime.locus);
  return locus;
}

/** Create a durable fixed-registry Locus through the ordinary persistence entry point. */
export async function create_persistent_multi_library_locus<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: PersistentLocusMultiLibraryOptions<TMap, TActions>,
): Promise<PersistentLocusMultiLibrary<TMap, TActions>> {
  const initialAuthority = internal_livemap_aggregate_authority(options.map);
  const initial = initialAuthority.hostedPosition();
  make_locus_hosted_projection_policy(initialAuthority.hostedRegistry(), initial.authority,
    options.exposure, options.defaultProjection, options.authorizeProjection);
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
  // The supplied public map retains its registry but receives only the durable
  // semantic cut. This creates a new local identity epoch and no old claims.
  internal_livemap_aggregate_authority(options.map).restoreClientHosted(
    durable_aggregate_snapshot_as_client(durable_aggregate_checkpoint(restoredSnapshot).snapshot),
  );
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
