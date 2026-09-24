import type { HostedClientLibrariesSnapshot, HostedLiveMapLibrariesSnapshot, LiveMapLibraries } from "../../types/livemap.types.js";
import type {
  HostedAggregateCommit,
  HostedClientCommit,
} from "../livemap/livemap.hosted.js";
import { make_hosted_client_commit, make_hosted_client_snapshot } from "../livemap/livemap.hosted.js";
import {
  internal_livemap_aggregate_authority,
} from "../livemap/livemap.internal.js";
import { make_livemap_client_mirror_from_snapshot_internal } from "../livemap/livemap.libraries.js";
import {
  create_locus_hosted_aggregate_internal,
  type LocusHostedAggregate,
  type LocusHostedAggregateOptions,
} from "./locus.hosted-multi-library.js";
import { LocusPersistenceAppendUncertainError, LocusPersistenceError } from "./locus.persistence.error.js";

export type LocusDurableAggregateSnapshot = Readonly<Omit<HostedClientLibrariesSnapshot, "format"> & {
  format: "hson-livemap-durable-snapshot-v1";
}>;

export type LocusDurableAggregateCommit = Readonly<Omit<HostedClientCommit, "format"> & {
  format: "hson-livemap-durable-commit-v1";
}>;

/** Internal storage wrapper around one QUID-free aggregate cut. */
export type LocusHostedAggregatePersistedCheckpoint = Readonly<{
  format: "hson-locus-durable-aggregate-checkpoint-v1";
  logicalMapId: string;
  incarnationId: string;
  mapKind: "hosted-aggregate";
  registryDigest: string;
  rev: number;
  snapshot: LocusDurableAggregateSnapshot;
}>;

/** Internal storage wrapper around one QUID-free semantic transition. */
export type LocusHostedAggregatePersistedCommit = Readonly<{
  format: "hson-locus-durable-aggregate-record-v1";
  logicalMapId: string;
  incarnationId: string;
  mapKind: "hosted-aggregate";
  registryDigest: string;
  commit: LocusDurableAggregateCommit;
}>;

/** Internal adapter port; it stores opaque authoritative aggregate records. */
export interface LocusHostedAggregatePersistenceAdapter {
  load(logicalMapId: string): Promise<LocusHostedAggregatePersistedState | undefined>;
  /** A resolved append commits exactly this revision once. An ordinary rejection
   * guarantees no write. Throw LocusPersistenceAppendUncertainError if a write
   * may have happened; that fences the authority until restoration. */
  appendCommit(record: LocusHostedAggregatePersistedCommit): Promise<void>;
  /** Atomically replace the checkpoint and remove commits through its revision. */
  replaceCheckpoint(record: LocusHostedAggregatePersistedCheckpoint): Promise<void>;
}

/** Internal aggregate state returned verbatim by the storage adapter. */
export type LocusHostedAggregatePersistedState = Readonly<{
  checkpoint: LocusHostedAggregatePersistedCheckpoint;
  commits: readonly LocusHostedAggregatePersistedCommit[];
}>;

/** Internal durable aggregate authority; it never lowers into solo Locus. */
export type PersistentLocusHostedAggregate = Omit<LocusHostedAggregate, "run_exclusive"> & Readonly<{
  checkpoint: () => Promise<void>;
}>;

/** Internal construction options for one fixed, already-hosted registry. */
export type PersistentLocusHostedAggregateOptions = Omit<LocusHostedAggregateOptions, "gate"> & Readonly<{
  persistence: LocusHostedAggregatePersistenceAdapter;
  /** Optional storage identity override for a new, revision-zero hosted map. */
  logicalMapId?: string;
  /** Optional storage incarnation override for a new, revision-zero hosted map. */
  incarnationId?: string;
}>;

/** Internal restore options. Topology and identity come only from the checkpoint. */
export type RestorePersistentLocusHostedAggregateOptions = Omit<
  PersistentLocusHostedAggregateOptions,
  "map" | "logicalMapId" | "incarnationId"
>;

type ValidatedHostedAggregateState = Readonly<{
  checkpoint: LocusHostedAggregatePersistedCheckpoint;
  map: LiveMapLibraries;
}>;

function exact_keys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function valid_revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function valid_digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function invalid_state(cause?: unknown): LocusPersistenceError {
  return new LocusPersistenceError(
    "LOCUS_PERSISTED_STATE_INVALID",
    "Hosted aggregate persisted state is invalid.",
    cause === undefined ? undefined : { cause },
  );
}

function persistence_failure(
  code: "LOCUS_PERSISTENCE_APPEND_FAILED" | "LOCUS_PERSISTENCE_APPEND_UNCERTAIN" | "LOCUS_PERSISTENCE_CHECKPOINT_FAILED" | "LOCUS_PERSISTENCE_INITIAL_CHECKPOINT_FAILED",
  message: string,
  cause: unknown,
): LocusPersistenceError {
  return new LocusPersistenceError(code, message, { cause });
}

function hosted_checkpoint(snapshot: HostedLiveMapLibrariesSnapshot): LocusHostedAggregatePersistedCheckpoint {
  const { format: _clientFormat, ...semantic } = make_hosted_client_snapshot(snapshot);
  return Object.freeze({
    format: "hson-locus-durable-aggregate-checkpoint-v1",
    logicalMapId: snapshot.authority.logicalMapId,
    incarnationId: snapshot.authority.incarnationId,
    mapKind: "hosted-aggregate",
    registryDigest: snapshot.registryDigest,
    rev: snapshot.revision,
    snapshot: Object.freeze({ ...semantic, format: "hson-livemap-durable-snapshot-v1" }),
  });
}

function hosted_commit(commit: HostedAggregateCommit): LocusHostedAggregatePersistedCommit {
  const projected = make_hosted_client_commit(commit);
  if (projected === undefined) throw new Error("Runtime-local identity demand cannot become durable authority history.");
  const { format: _clientFormat, ...semantic } = projected;
  return Object.freeze({
    format: "hson-locus-durable-aggregate-record-v1",
    logicalMapId: commit.authority.logicalMapId,
    incarnationId: commit.authority.incarnationId,
    mapKind: "hosted-aggregate",
    registryDigest: commit.registryDigest,
    commit: Object.freeze({ ...semantic, format: "hson-livemap-durable-commit-v1" }),
  });
}

export function durable_aggregate_checkpoint(snapshot: HostedLiveMapLibrariesSnapshot): LocusHostedAggregatePersistedCheckpoint {
  return hosted_checkpoint(snapshot);
}

export function durable_aggregate_commit(commit: HostedAggregateCommit): LocusHostedAggregatePersistedCommit {
  return hosted_commit(commit);
}

export function durable_aggregate_snapshot_as_client(snapshot: LocusDurableAggregateSnapshot): HostedClientLibrariesSnapshot {
  const { format: _format, ...semantic } = snapshot;
  return Object.freeze({ ...semantic, format: "hson-livemap-client-snapshot-v1" });
}

function durable_aggregate_commit_as_client(commit: LocusDurableAggregateCommit): HostedClientCommit {
  const { format: _format, ...semantic } = commit;
  return Object.freeze({ format: "hson-hosted-client-commit-v1", ...semantic });
}

function assert_checkpoint_fence(
  checkpoint: Record<string, unknown>,
  requestedLogicalMapId: string,
): LocusHostedAggregatePersistedCheckpoint {
  if (!exact_keys(checkpoint, [
    "format", "logicalMapId", "incarnationId", "mapKind", "registryDigest", "rev", "snapshot",
  ])
    || checkpoint.format !== "hson-locus-durable-aggregate-checkpoint-v1"
    || checkpoint.logicalMapId !== requestedLogicalMapId
    || typeof checkpoint.logicalMapId !== "string"
    || typeof checkpoint.incarnationId !== "string"
    || checkpoint.incarnationId.length === 0
    || checkpoint.mapKind !== "hosted-aggregate"
    || !valid_digest(checkpoint.registryDigest)
    || !valid_revision(checkpoint.rev)
    || record(checkpoint.snapshot) === undefined) {
    throw invalid_state();
  }
  return checkpoint as unknown as LocusHostedAggregatePersistedCheckpoint;
}

function assert_snapshot_fence(
  checkpoint: LocusHostedAggregatePersistedCheckpoint,
): LocusDurableAggregateSnapshot {
  const snapshot = checkpoint.snapshot;
  if (!exact_keys(snapshot, ["format", "revision", "registry", "registryDigest", "libraries", "authority"])
    || snapshot.format !== "hson-livemap-durable-snapshot-v1") throw invalid_state();
  const authority = record(snapshot.authority);
  const registry = record(snapshot.registry);
  if (authority === undefined
    || registry === undefined
    || !exact_keys(authority, ["logicalMapId", "incarnationId"])
    || !exact_keys(registry, ["format", "libraries", "digest"])
    || authority.logicalMapId !== checkpoint.logicalMapId
    || authority.incarnationId !== checkpoint.incarnationId
    || snapshot.registryDigest !== checkpoint.registryDigest
    || registry.digest !== checkpoint.registryDigest
    || snapshot.revision !== checkpoint.rev) {
    throw invalid_state();
  }
  return snapshot;
}

function assert_commit_fence(
  value: unknown,
  checkpoint: LocusHostedAggregatePersistedCheckpoint,
  expectedPrevRev: number,
): LocusDurableAggregateCommit {
  const persisted = record(value);
  if (persisted === undefined || !exact_keys(persisted, [
    "format", "logicalMapId", "incarnationId", "mapKind", "registryDigest", "commit",
  ])
    || persisted.format !== "hson-locus-durable-aggregate-record-v1"
    || persisted.logicalMapId !== checkpoint.logicalMapId
    || persisted.incarnationId !== checkpoint.incarnationId
    || persisted.mapKind !== "hosted-aggregate"
    || persisted.registryDigest !== checkpoint.registryDigest) {
    throw invalid_state();
  }
  const commitRecord = record(persisted.commit);
  if (commitRecord === undefined) throw invalid_state();
  if (!exact_keys(commitRecord, ["format", "authority", "registryDigest", "prevRev", "rev", "operations"])
    || commitRecord.format !== "hson-livemap-durable-commit-v1") throw invalid_state();
  const authority = record(commitRecord.authority);
  if (authority === undefined
    || authority.logicalMapId !== checkpoint.logicalMapId
    || authority.incarnationId !== checkpoint.incarnationId
    || commitRecord.registryDigest !== checkpoint.registryDigest
    || commitRecord.prevRev !== expectedPrevRev
    || commitRecord.rev !== expectedPrevRev + 1) {
    throw invalid_state();
  }
  return persisted.commit as LocusDurableAggregateCommit;
}

function exact_representation_equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validate_hosted_aggregate_state(
  requestedLogicalMapId: string,
  value: unknown,
): ValidatedHostedAggregateState {
  try {
    const state = record(value);
    if (state === undefined || !exact_keys(state, ["checkpoint", "commits"])) throw invalid_state();
    const checkpointValue = record(state.checkpoint);
    if (checkpointValue === undefined) throw invalid_state();
    if (checkpointValue.format === undefined && exact_keys(checkpointValue, [
      "logicalMapId", "incarnationId", "mapKind", "registryDigest", "rev", "snapshot",
    ])) {
      throw new LocusPersistenceError("LOCUS_PERSISTED_STATE_INVALID", "Unsupported legacy aggregate checkpoint format.");
    }
    const checkpoint = assert_checkpoint_fence(checkpointValue, requestedLogicalMapId);
    const snapshot = assert_snapshot_fence(checkpoint);
    if (!Array.isArray(state.commits)) throw invalid_state();

    // The client installer already admits portable roots, compiles Schemas,
    // validates registry and system state, and creates a fresh identity owner.
    const map = make_livemap_client_mirror_from_snapshot_internal(durable_aggregate_snapshot_as_client(snapshot));
    const aggregate = internal_livemap_aggregate_authority(map);
    if (!exact_representation_equal(hosted_checkpoint(aggregate.captureHosted()).snapshot, snapshot)) throw invalid_state();

    let expectedPrevRev = checkpoint.rev;
    for (const item of state.commits) {
      const commit = assert_commit_fence(item, checkpoint, expectedPrevRev);
      // Durable replay validates portable operation semantics, the registry
      // fence, every library Schema, and atomic installation.
      aggregate.replayDurableHosted(durable_aggregate_commit_as_client(commit));
      expectedPrevRev += 1;
    }
    if (map.rev !== expectedPrevRev) throw invalid_state();
    return Object.freeze({ checkpoint, map });
  } catch (cause) {
    if (cause instanceof LocusPersistenceError) throw cause;
    throw invalid_state(cause);
  }
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
      "A hosted aggregate persistence identity may be set only before its first transition.",
    );
  }
  const authorityOverride = Object.freeze({
    logicalMapId: logicalMapId ?? position.authority.logicalMapId,
    incarnationId: incarnationId ?? position.authority.incarnationId,
  });
  aggregate.setInitialHostedAuthority(authorityOverride);
}

function make_durability_gate(
  adapter: LocusHostedAggregatePersistenceAdapter,
): Readonly<{
  prepareGate: NonNullable<LocusHostedAggregateOptions["prepareGate"]>;
  gate: NonNullable<LocusHostedAggregateOptions["gate"]>;
}> {
  const records = new WeakMap<HostedAggregateCommit, LocusHostedAggregatePersistedCommit>();
  return Object.freeze({
    prepareGate: ({ commit }) => {
      if (!commit.changed) return;
      const record = hosted_commit(commit);
      JSON.stringify(record);
      records.set(commit, record);
    },
    gate: async ({ commit }) => {
      if (!commit.changed) return;
      const record = records.get(commit);
      if (record === undefined) throw new Error("Prepared durable aggregate record is unavailable.");
      try {
        await adapter.appendCommit(record);
      } catch (cause) {
        throw persistence_failure(
          cause instanceof LocusPersistenceAppendUncertainError
            ? "LOCUS_PERSISTENCE_APPEND_UNCERTAIN" : "LOCUS_PERSISTENCE_APPEND_FAILED",
          "Hosted aggregate Locus could not durably append the prepared commit.",
          cause,
        );
      }
    },
  });
}

function persistent_view(
  locus: LocusHostedAggregate,
  adapter: LocusHostedAggregatePersistenceAdapter,
): PersistentLocusHostedAggregate {
  const checkpoint = (): Promise<void> => locus.run_exclusive(async () => {
    const snapshot = internal_livemap_aggregate_authority(locus.map).captureHosted();
    try {
      // The adapter's replacement operation owns checkpoint replacement plus
      // global-tail pruning as one durable operation.
      await adapter.replaceCheckpoint(hosted_checkpoint(snapshot));
    } catch (cause) {
      throw persistence_failure(
        "LOCUS_PERSISTENCE_CHECKPOINT_FAILED",
        "Hosted aggregate Locus could not replace its persisted checkpoint.",
        cause,
      );
    }
  });
  return Object.freeze({
    map: locus.map,
    get logicalMapId() { return locus.logicalMapId; },
    get incarnationId() { return locus.incarnationId; },
    get registryDigest() { return locus.registryDigest; },
    get rev() { return locus.rev; },
    mutate: locus.mutate,
    dispatch_action: locus.dispatch_action,
    on_wire: locus.on_wire,
    on_commit: locus.on_commit,
    checkpoint,
    dispose: locus.dispose,
  });
}

/**
 * Create the internal persistent hosted authority only after its QUID-free
 * aggregate checkpoint has been durably installed.
 */
export async function create_persistent_locus_hosted_aggregate_internal(
  options: PersistentLocusHostedAggregateOptions,
): Promise<PersistentLocusHostedAggregate> {
  set_initial_authority(options.map, options.logicalMapId, options.incarnationId);
  const { persistence, logicalMapId: _logicalMapId, incarnationId: _incarnationId, ...hostedOptions } = options;
  const durability = make_durability_gate(persistence);
  const locus = create_locus_hosted_aggregate_internal({
    ...hostedOptions,
    ...durability,
    uncertainGateFailure: (cause) => cause instanceof LocusPersistenceError && cause.code === "LOCUS_PERSISTENCE_APPEND_UNCERTAIN",
  });
  const snapshot = internal_livemap_aggregate_authority(locus.map).captureHosted();
  try {
    await persistence.replaceCheckpoint(hosted_checkpoint(snapshot));
  } catch (cause) {
    locus.dispose();
    throw persistence_failure(
      "LOCUS_PERSISTENCE_INITIAL_CHECKPOINT_FAILED",
      "Hosted aggregate Locus initial checkpoint could not be stored.",
      cause,
    );
  }
  return persistent_view(locus, persistence);
}

/**
 * Rebuild one aggregate authority from a fenced aggregate checkpoint and its ordered
 * semantic aggregate tail. This never rewrites or checkpoints the loaded state.
 */
export async function restore_persistent_locus_hosted_aggregate_internal(
  logicalMapId: string,
  state: LocusHostedAggregatePersistedState,
  options: RestorePersistentLocusHostedAggregateOptions,
): Promise<PersistentLocusHostedAggregate> {
  const validated = validate_hosted_aggregate_state(logicalMapId, state);
  const { persistence, ...hostedOptions } = options;
  const durability = make_durability_gate(persistence);
  const locus = create_locus_hosted_aggregate_internal({
    ...hostedOptions,
    map: validated.map,
    ...durability,
    uncertainGateFailure: (cause) => cause instanceof LocusPersistenceError && cause.code === "LOCUS_PERSISTENCE_APPEND_UNCERTAIN",
  });
  const actual = internal_livemap_aggregate_authority(locus.map).captureHosted();
  if (actual.authority.logicalMapId !== validated.checkpoint.logicalMapId
    || actual.authority.incarnationId !== validated.checkpoint.incarnationId
    || actual.registryDigest !== validated.checkpoint.registryDigest) {
    locus.dispose();
    throw invalid_state();
  }
  return persistent_view(locus, persistence);
}

/** Load one aggregate state through its adapter, then reconstruct it atomically. */
export async function load_persistent_locus_hosted_aggregate_internal(
  logicalMapId: string,
  options: RestorePersistentLocusHostedAggregateOptions,
): Promise<PersistentLocusHostedAggregate | undefined> {
  let state: LocusHostedAggregatePersistedState | undefined;
  try {
    state = await options.persistence.load(logicalMapId);
  } catch (cause) {
    throw new LocusPersistenceError(
      "LOCUS_PERSISTENCE_LOAD_FAILED",
      "Hosted aggregate persisted state could not be loaded.",
      { cause },
    );
  }
  if (state === undefined) return undefined;
  return restore_persistent_locus_hosted_aggregate_internal(logicalMapId, state, options);
}
