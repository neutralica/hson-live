import type { LiveMap, LiveMapDefinitions } from "../../types/livemap.types.js";
import type {
  LocusActionPayloads,
  LocusOptions,
  LocusPersistenceAdapter,
  PersistentLocus,
  PersistentLocusOptions,
} from "../../types/locus.types.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { node_to_json_value } from "../livemap/livemap.editor.js";
import { HsonSchema } from "../schema/hson-schema.js";
import type { HostedAggregateCommit } from "../livemap/livemap.hosted.js";
import { LocusPersistenceAppendUncertainError, LocusPersistenceError } from "./locus.persistence.error.js";
import {
  durable_aggregate_commit,
  load_persistent_locus_hosted_aggregate_internal,
  write_semantic_checkpoint,
  type LocusHostedAggregatePersistenceAdapter,
} from "./locus.aggregate.persistence.js";
import { create_registry_locus_internal } from "./locus.registry.js";
import { alias_locus_remote_action_admission_internal } from "./locus.remote-action.internal.js";
import { alias_locus_retained_action_status_internal } from "./locus.action-status.internal.js";
import { alias_locus_libraries_snapshot_authority_internal } from "./locus.libraries-snapshot.js";
import { make_locus_hosted_projection_policy } from "./locus.projection.js";

function commit_record(commit: HostedAggregateCommit): object {
  return durable_aggregate_commit(commit);
}

function set_initial_authority(
  map: LiveMap,
  logicalMapId: string | undefined,
  incarnationId: string | undefined,
): void {
  if (logicalMapId === undefined && incarnationId === undefined) return;
  const aggregate = internal_livemap_aggregate_authority(map);
  const position = aggregate.hostedPosition();
  if (position.revision !== 0) {
    throw new LocusPersistenceError(
      "LOCUS_PERSISTED_STATE_INVALID",
      "A hosted registry persistence identity may be set only before its first transition.",
    );
  }
  aggregate.setInitialHostedAuthority(Object.freeze({
    logicalMapId: logicalMapId ?? position.authority.logicalMapId,
    incarnationId: incarnationId ?? position.authority.incarnationId,
  }));
}

async function append_durable_commit(
  persistence: LocusPersistenceAdapter,
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
      "Hosted registry Locus could not durably append the prepared commit.",
      { cause },
    );
  }
}

async function persistent_view<
  TMap extends LiveMap,
  TActions extends LocusActionPayloads,
>(
  options: PersistentLocusOptions<TMap, TActions>,
  initialize: boolean,
): Promise<PersistentLocus<TMap, TActions>> {
  const exposureAuthority = internal_livemap_aggregate_authority(options.map);
  make_locus_hosted_projection_policy(exposureAuthority.hostedRegistry(), exposureAuthority.hostedPosition().authority,
    options.exposure, options.defaultProjection, options.authorizeProjection);
  if (initialize) {
    set_initial_authority(options.map, options.logicalMapId, options.incarnationId);
    try {
      await write_semantic_checkpoint(internal_livemap_aggregate_authority(options.map).captureSemanticCheckpoint(),
        options.persistence as LocusHostedAggregatePersistenceAdapter);
    } catch (cause) {
      throw new LocusPersistenceError(
        "LOCUS_PERSISTENCE_INITIAL_CHECKPOINT_FAILED",
        "Hosted registry Locus initial checkpoint could not be stored.",
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
  const runtime = create_registry_locus_internal(managedOptions as LocusOptions<TMap, TActions>, {
    ...(initialize ? {} : { recoveryFloorRevision: options.map.rev }),
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
  let checkpointTail = Promise.resolve();
  const checkpoint = (): Promise<void> => {
    const run = checkpointTail.then(async () => {
      const captured = await runtime.run_exclusive(() => internal_livemap_aggregate_authority(options.map).captureSemanticCheckpoint());
      try { await write_semantic_checkpoint(captured, persistence as LocusHostedAggregatePersistenceAdapter); }
      catch (cause) {
        const uncertain = cause instanceof LocusPersistenceError && cause.code === "LOCUS_PERSISTENCE_CHECKPOINT_UNCERTAIN";
        if (uncertain) runtime.locus.dispose();
        throw new LocusPersistenceError(uncertain ? "LOCUS_PERSISTENCE_CHECKPOINT_UNCERTAIN" : "LOCUS_PERSISTENCE_CHECKPOINT_FAILED",
          "Hosted registry Locus could not activate its persisted checkpoint.", { cause });
      }
    });
    checkpointTail = run.catch(() => {});
    return run;
  };
  const locus = Object.freeze(Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(runtime.locus),
    checkpoint: Object.freeze({ value: checkpoint, enumerable: true }),
  })) as PersistentLocus<TMap, TActions>;
  alias_locus_remote_action_admission_internal(locus, runtime.locus);
  alias_locus_retained_action_status_internal(locus, runtime.locus);
  alias_locus_libraries_snapshot_authority_internal(locus, runtime.locus);
  return locus;
}

/** Create a durable Locus through the ordinary persistence entry point. */
export async function create_persistent_registry_locus<
  TMap extends LiveMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: PersistentLocusOptions<TMap, TActions>,
): Promise<PersistentLocus<TMap, TActions>> {
  const initialAuthority = internal_livemap_aggregate_authority(options.map);
  const initial = initialAuthority.hostedPosition();
  const logicalMapId = options.logicalMapId ?? initial.authority.logicalMapId;
  const restored = await load_persistent_locus_hosted_aggregate_internal(logicalMapId, {
    persistence: options.persistence as LocusHostedAggregatePersistenceAdapter,
  });
  if (restored === undefined) return persistent_view(options, true);
  const restoredCheckpoint = internal_livemap_aggregate_authority(restored.map).captureSemanticCheckpoint();
  const initialRegistry = initialAuthority.hostedRegistry();
  const originalNames = initialRegistry.libraries.filter((entry) => entry.scope !== "hson-internal");
  const restoredNames = restoredCheckpoint.registry.libraries.filter((entry) => entry.scope !== "hson-internal");
  const initialSystem = initialRegistry.libraries.filter((entry) => entry.scope === "hson-internal");
  const restoredSystem = restoredCheckpoint.registry.libraries.filter((entry) => entry.scope === "hson-internal");
  if (originalNames.some((entry) => JSON.stringify(entry)
      !== JSON.stringify(restoredNames.find((candidate) => candidate.name === entry.name)))
    || JSON.stringify(initialSystem) !== JSON.stringify(restoredSystem)) {
    restored.dispose();
    throw new LocusPersistenceError(
      "LOCUS_PERSISTED_STATE_INVALID",
      "Hosted registry persistence registry does not extend the supplied map topology.",
    );
  }
  // Deployment policy must classify every restored application name. Policy
  // remains Locus-owned and is never imported from semantic Library records.
  try {
    make_locus_hosted_projection_policy(restoredCheckpoint.registry, restoredCheckpoint.authority,
      options.exposure, options.defaultProjection, options.authorizeProjection);
  } catch (cause) {
    restored.dispose();
    throw new LocusPersistenceError("LOCUS_PERSISTED_STATE_INVALID",
      `Hosted registry topology requires complete deployment exposure: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
  if (restoredCheckpoint.registry.digest !== initial.registryDigest) {
    const definitions: Record<string, LiveMapDefinitions[string]> = Object.create(null);
    for (const [index, entry] of restoredCheckpoint.registry.libraries.entries()) {
      if (entry.scope === "hson-internal" || originalNames.some((candidate) => candidate.name === entry.name)) continue;
      const root = restoredCheckpoint.libraries[index];
      if (root?.name !== entry.name) throw new LocusPersistenceError("LOCUS_PERSISTED_STATE_INVALID",
        "Restored topology root order is invalid.");
      const schema = HsonSchema.fromHson(entry.schema);
      if (entry.mode === "document") definitions[entry.name] = { document: root.root, schema };
      else {
        const value = node_to_json_value(root.root);
        definitions[entry.name] = { data: typeof value === "string" ? JSON.stringify(value) : value, schema };
      }
    }
    options.map.addLibraries(definitions);
  }
  // Rebind the durable authority fence and begin a fresh local identity epoch.
  internal_livemap_aggregate_authority(options.map).installSemanticCheckpoint(restoredCheckpoint);
  restored.dispose();
  return persistent_view(options, false);
}
