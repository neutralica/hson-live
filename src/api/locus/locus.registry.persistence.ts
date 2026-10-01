import type { LiveMap, LiveMapDefinitions } from "../../types/livemap.types.js";
import type {
  LocusActionPayloads,
  Locus,
  LocusRegistryOptions,
  LocusPersistenceAdapter,
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
  type LocusDurableOwnershipEntry,
} from "./locus.aggregate.persistence.js";
import { create_registry_locus_internal } from "./locus.registry.js";
import { make_locus_hosted_projection_policy } from "./locus.projection.js";

type DurableRegistryOptions<TMap extends LiveMap, TActions extends LocusActionPayloads> =
  LocusRegistryOptions<TMap, TActions> & Readonly<{ persistence: LocusPersistenceAdapter }>;

const checkpoints = new WeakMap<object, () => Promise<void>>();

export function checkpoint_registry_locus(locus: Locus): Promise<void> {
  const checkpoint = checkpoints.get(locus);
  return checkpoint === undefined
    ? Promise.reject(new Error("Locus has no durable backing to checkpoint."))
    : checkpoint();
}

function commit_record(commit: HostedAggregateCommit, additions?: readonly LocusDurableOwnershipEntry[]): object {
  return durable_aggregate_commit(commit, additions);
}

function set_initial_authority(
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
  options: DurableRegistryOptions<TMap, TActions>,
  initialize: boolean,
  runtimeOwnership = new Map<string, "private" | "shared">(),
): Promise<Locus<TMap, TActions>> {
  const exposureAuthority = internal_livemap_aggregate_authority(options.map);
  const suppliedAuthority = exposureAuthority.hostedPosition().authority;
  make_locus_hosted_projection_policy(exposureAuthority.hostedRegistry(), exposureAuthority.hostedPosition().authority,
    options.libraries, options.defaultProjection, options.authorizeProjection, options.map);
  if (initialize) {
    set_initial_authority(options.map, options.logicalMapId, options.incarnationId);
    try {
      await write_semantic_checkpoint(internal_livemap_aggregate_authority(options.map).captureSemanticCheckpoint(),
        options.persistence as LocusHostedAggregatePersistenceAdapter, []);
    } catch (cause) {
      if (exposureAuthority.hostedPosition().revision === 0) {
        exposureAuthority.setInitialHostedAuthority(suppliedAuthority);
      }
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
  const runtime = (() => {
    try { return create_registry_locus_internal(managedOptions as LocusRegistryOptions<TMap, TActions>, {
    ...(initialize ? {} : { recoveryFloorRevision: options.map.rev }),
    runtimeOwnership,
    onDispose: (locus) => { checkpoints.delete(locus); },
    prepareGate: ({ commit, libraryOwnershipAdded }) => {
      if (!commit.changed) return;
      const record = commit_record(commit, libraryOwnershipAdded);
      JSON.stringify(record);
      records.set(commit, record);
    },
    gate: ({ commit }) => {
      if (!commit.changed) return;
      const record = records.get(commit);
      if (record === undefined) throw new Error("Prepared durable aggregate record is unavailable.");
      return append_durable_commit(persistence, record);
    },
    }); } catch (cause) {
      if (initialize && exposureAuthority.hostedPosition().revision === 0) {
        exposureAuthority.setInitialHostedAuthority(suppliedAuthority);
      }
      throw cause;
    }
  })();
  let checkpointTail = Promise.resolve();
  const checkpoint = (): Promise<void> => {
    const run = checkpointTail.then(async () => {
      const captured = await runtime.run_exclusive(() => Object.freeze({
        map: internal_livemap_aggregate_authority(options.map).captureSemanticCheckpoint(),
        ownership: Object.freeze([...runtimeOwnership].map(([name, ownership]) => Object.freeze({ name, ownership }))),
      }));
      try { await write_semantic_checkpoint(captured.map, persistence as LocusHostedAggregatePersistenceAdapter, captured.ownership); }
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
  checkpoints.set(runtime.locus, checkpoint);
  return runtime.locus;
}

/** Create a durable Locus through the ordinary persistence entry point. */
export async function resume_registry_locus<
  TMap extends LiveMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: DurableRegistryOptions<TMap, TActions>,
): Promise<Locus<TMap, TActions>> {
  const initialAuthority = internal_livemap_aggregate_authority(options.map);
  const probe = Object.freeze({});
  initialAuthority.claimManagement(probe);
  initialAuthority.releaseManagement(probe);
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
  const runtimeOwnership = new Map(restored.runtimeOwnership.map((entry) => [entry.name, entry.ownership] as const));
  const restoredOriginals = restoredNames.filter((entry) => !runtimeOwnership.has(entry.name));
  const initialSystem = initialRegistry.libraries.filter((entry) => entry.scope === "hson-internal");
  const restoredSystem = restoredCheckpoint.registry.libraries.filter((entry) => entry.scope === "hson-internal");
  if (originalNames.length !== restoredOriginals.length
    || originalNames.some((entry) => runtimeOwnership.has(entry.name) || JSON.stringify(entry)
      !== JSON.stringify(restoredOriginals.find((candidate) => candidate.name === entry.name)))
    || JSON.stringify(initialSystem) !== JSON.stringify(restoredSystem)) {
    restored.dispose();
    throw new LocusPersistenceError(
      "LOCUS_PERSISTED_STATE_INVALID",
      "Hosted registry persistence source definition conflicts with durable topology.",
    );
  }
  const combinedCatalog = [...options.libraries,
    ...restored.runtimeOwnership.map((entry) => ({ name: entry.name, ownership: entry.ownership }))];
  try {
    make_locus_hosted_projection_policy(restoredCheckpoint.registry, restoredCheckpoint.authority,
      combinedCatalog, options.defaultProjection, options.authorizeProjection, restored.map);
  } catch (cause) {
    restored.dispose();
    throw new LocusPersistenceError("LOCUS_PERSISTED_STATE_INVALID",
      `Hosted registry topology requires complete Locus ownership: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
  if (restoredCheckpoint.registry.digest !== initial.registryDigest) {
    const definitions: Record<string, LiveMapDefinitions[string]> = Object.create(null);
    for (const [index, entry] of restoredCheckpoint.registry.libraries.entries()) {
      if (entry.scope === "hson-internal" || !runtimeOwnership.has(entry.name)) continue;
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
  return persistent_view({ ...options, libraries: combinedCatalog }, false, runtimeOwnership);
}
