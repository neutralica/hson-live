import type { HsonNode } from "../../core/types.js";
import type { LiveMap } from "../../types/livemap.types.js";
import type {
  HostedAggregateCommit,
  PortableAggregateCommit,
} from "../livemap/livemap.hosted.js";
import { make_portable_aggregate_commit } from "../livemap/livemap.hosted.js";
import {
  internal_livemap_aggregate_authority,
} from "../livemap/livemap.internal.js";
import { make_livemap_mirror_from_semantic_checkpoint_internal } from "../livemap/livemap.libraries.js";
import type { LiveMapSemanticCheckpoint } from "../livemap/livemap.internal.js";
import type { HostedRegistry, HostedRegistryEntry } from "../livemap/livemap.hosted.js";
import { hosted_sha256 } from "../livemap/livemap.hosted.js";
import { HsonSchema } from "../schema/hson-schema.js";
import {
  CHECKPOINT_CHUNK_MAX_BYTES, CHECKPOINT_MAX_CHUNKS, CHECKPOINT_MAX_MANIFEST_BYTES,
  CheckpointTokenDecoder, encode_checkpoint_chunks, validate_checkpoint_chunk,
  type CheckpointChunk, type CheckpointChunkDescriptor,
} from "./locus.checkpoint-chunks.js";
import {
  create_locus_hosted_aggregate_internal,
  type LocusHostedAggregate,
  type LocusHostedAggregateOptions,
} from "./locus.aggregate.js";
import { LocusPersistenceAppendUncertainError, LocusPersistenceError } from "./locus.persistence.error.js";

export type LocusDurableAggregateCommit = Readonly<Omit<PortableAggregateCommit, "format"> & {
  format: "hson-livemap-durable-commit-v1";
}>;

/** The active v2 manifest is the atomic checkpoint decision. */
export type LocusHostedAggregatePersistedManifest = Readonly<{
  format: "hson-locus-durable-aggregate-checkpoint-v2";
  checkpointId: string;
  logicalMapId: string;
  incarnationId: string;
  mapKind: "hosted-aggregate";
  registryDigest: string;
  rev: number;
  registry: Readonly<{ format: "hson-hosted-registry"; libraries: readonly Omit<HostedRegistryEntry, "schema">[]; digest: string }>;
  chunks: readonly CheckpointChunkDescriptor[];
}>;
type AnyCheckpoint = LocusHostedAggregatePersistedManifest;

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
  /** Durable exact staging does not alter the active checkpoint or tail. */
  putCheckpointChunk(chunk: CheckpointChunk): Promise<void>;
  /** Resolve only when the candidate and every referenced chunk are durable and match their descriptors. */
  putCheckpointManifest(manifest: LocusHostedAggregatePersistedManifest): Promise<void>;
  /** Atomic compare-and-swap of one still-valid complete candidate. Never prune here. */
  activateCheckpoint(logicalMapId: string, expectedCheckpointId: string | undefined, checkpointId: string): Promise<void>;
  readCheckpointChunk(id: string): Promise<CheckpointChunk | undefined>;
  /** May remove only commits <= rev after checkpointId is observed active. */
  pruneCommitsThrough(logicalMapId: string, checkpointId: string, rev: number): Promise<void>;
}

/** Internal aggregate state returned verbatim by the storage adapter. */
export type LocusHostedAggregatePersistedState = Readonly<{
  checkpoint: AnyCheckpoint;
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
  checkpoint: AnyCheckpoint;
  map: LiveMap;
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
  code: "LOCUS_PERSISTENCE_APPEND_FAILED" | "LOCUS_PERSISTENCE_APPEND_UNCERTAIN" | "LOCUS_PERSISTENCE_CHECKPOINT_FAILED" | "LOCUS_PERSISTENCE_CHECKPOINT_UNCERTAIN" | "LOCUS_PERSISTENCE_INITIAL_CHECKPOINT_FAILED",
  message: string,
  cause: unknown,
): LocusPersistenceError {
  return new LocusPersistenceError(code, message, { cause });
}

export function active_checkpoint_id(checkpoint: AnyCheckpoint): string {
  return checkpoint.checkpointId;
}

function checkpoint_id(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id === undefined) throw new Error("A cryptographic checkpoint identity source is required.");
  return id;
}

/** Stage bounded semantic pieces, then atomically activate one manifest. */
export async function write_semantic_checkpoint(
  checkpoint: LiveMapSemanticCheckpoint,
  adapter: LocusHostedAggregatePersistenceAdapter,
): Promise<void> {
  const id = checkpoint_id();
  const previous = await adapter.load(checkpoint.authority.logicalMapId);
  if (previous !== undefined && (previous.checkpoint.incarnationId !== checkpoint.authority.incarnationId
    || previous.checkpoint.registryDigest !== checkpoint.registry.digest
    || previous.checkpoint.rev > checkpoint.revision)) throw invalid_state();
  const expectedId = previous === undefined ? undefined : active_checkpoint_id(previous.checkpoint);
  const descriptors: CheckpointChunkDescriptor[] = [];
  const metadata: Omit<HostedRegistryEntry, "schema">[] = [];
  for (let index = 0; index < checkpoint.registry.libraries.length; index += 1) {
    const entry = checkpoint.registry.libraries[index];
    const library = checkpoint.libraries[index];
    if (entry === undefined || library === undefined || entry.name !== library.name) throw invalid_state();
    const { schema, ...fixed } = entry;
    metadata.push(fixed);
    for (const [part, value] of [["schema", schema], ["root", library.root]] as const) {
      for (const { chunk, descriptor } of encode_checkpoint_chunks(id, checkpoint.revision, entry.name, part, value)) {
        if (descriptors.length >= CHECKPOINT_MAX_CHUNKS) throw new Error("Checkpoint chunk count exceeds its supported bound.");
        await adapter.putCheckpointChunk(chunk);
        descriptors.push(descriptor);
      }
    }
  }
  const manifest: LocusHostedAggregatePersistedManifest = Object.freeze({
    format: "hson-locus-durable-aggregate-checkpoint-v2",
    checkpointId: id,
    logicalMapId: checkpoint.authority.logicalMapId,
    incarnationId: checkpoint.authority.incarnationId,
    mapKind: "hosted-aggregate",
    registryDigest: checkpoint.registry.digest,
    rev: checkpoint.revision,
    registry: Object.freeze({ format: "hson-hosted-registry", libraries: Object.freeze(metadata), digest: checkpoint.registry.digest }),
    chunks: Object.freeze(descriptors),
  });
  if (new TextEncoder().encode(JSON.stringify(manifest)).byteLength > CHECKPOINT_MAX_MANIFEST_BYTES) {
    throw new Error("Checkpoint manifest exceeds its supported bound.");
  }
  await adapter.putCheckpointManifest(manifest);
  try {
    await adapter.activateCheckpoint(checkpoint.authority.logicalMapId, expectedId, id);
  } catch (cause) {
    // Activation may have committed before the adapter reported failure. Read
    // the exact active identity once; never issue a second activation blindly.
    let active: LocusHostedAggregatePersistedState | undefined;
    try { active = await adapter.load(checkpoint.authority.logicalMapId); }
    catch { throw new LocusPersistenceError("LOCUS_PERSISTENCE_CHECKPOINT_UNCERTAIN", "Checkpoint activation outcome is uncertain.", { cause }); }
    if (active?.checkpoint.format === "hson-locus-durable-aggregate-checkpoint-v2"
      && active.checkpoint.checkpointId === id) {
      // Exactly this candidate won despite the transport error.
    } else if ((active === undefined ? undefined : active_checkpoint_id(active.checkpoint)) === expectedId) {
      throw cause;
    } else {
      throw new LocusPersistenceError("LOCUS_PERSISTENCE_CHECKPOINT_UNCERTAIN",
        "Checkpoint activation outcome is uncertain.", { cause });
    }
  }
  await adapter.pruneCommitsThrough(checkpoint.authority.logicalMapId, id, checkpoint.revision);
}

export function assert_checkpoint_manifest(value: Record<string, unknown>, requestedLogicalMapId: string): LocusHostedAggregatePersistedManifest {
  if (!exact_keys(value, ["format", "checkpointId", "logicalMapId", "incarnationId", "mapKind", "registryDigest", "rev", "registry", "chunks"])
    || value.format !== "hson-locus-durable-aggregate-checkpoint-v2"
    || typeof value.checkpointId !== "string" || !/^[0-9a-f-]{36}$/u.test(value.checkpointId)
    || value.logicalMapId !== requestedLogicalMapId || requestedLogicalMapId.length > CHECKPOINT_MAX_MANIFEST_BYTES
    || typeof value.incarnationId !== "string" || !value.incarnationId
    || value.incarnationId.length > CHECKPOINT_MAX_MANIFEST_BYTES
    || value.mapKind !== "hosted-aggregate" || !valid_digest(value.registryDigest)
    || !valid_revision(value.rev) || !Array.isArray(value.chunks)
    || value.chunks.length < 2 || value.chunks.length > CHECKPOINT_MAX_CHUNKS) throw invalid_state();
  const registry = record(value.registry);
  if (registry === undefined || !exact_keys(registry, ["format", "libraries", "digest"])
    || registry.format !== "hson-hosted-registry" || registry.digest !== value.registryDigest
    || !Array.isArray(registry.libraries) || registry.libraries.length < 1 || registry.libraries.length > 1_024) throw invalid_state();
  const names = new Set<string>();
  for (const raw of registry.libraries) {
    const entry = record(raw);
    if (entry === undefined || !(exact_keys(entry, ["name", "scope", "mode", "schemaDigest", "rootCodec"])
      || exact_keys(entry, ["name", "mode", "schemaDigest", "rootCodec"]))
      || typeof entry.name !== "string" || !entry.name || entry.name.length > 1_024 || names.has(entry.name)
      || (entry.scope !== undefined && entry.scope !== "hson-internal")
      || (entry.mode !== "data-object" && entry.mode !== "data-array" && entry.mode !== "document")
      || !valid_digest(entry.schemaDigest) || entry.rootCodec !== "hson-exact-value") throw invalid_state();
    names.add(entry.name);
  }
  let position = 0;
  const ids = new Set<string>();
  for (const entry of registry.libraries as readonly Record<string, unknown>[]) {
    for (const part of ["schema", "root"] as const) {
      let index = 0;
      while (position < value.chunks.length) {
        const descriptor = record(value.chunks[position]);
        if (descriptor === undefined || descriptor.owner !== entry.name || descriptor.part !== part) break;
        if (!exact_keys(descriptor, ["id", "owner", "part", "rev", "index", "bytes", "sha256"])
          || descriptor.rev !== value.rev || descriptor.index !== index || typeof descriptor.id !== "string"
          || descriptor.id.length > 1_200
          || descriptor.id !== `${value.checkpointId}:${entry.name}:${part}:${index}` || ids.has(descriptor.id)
          || typeof descriptor.bytes !== "number" || !Number.isSafeInteger(descriptor.bytes)
          || descriptor.bytes < 1 || descriptor.bytes > CHECKPOINT_CHUNK_MAX_BYTES
          || !valid_digest(descriptor.sha256)) throw invalid_state();
        ids.add(descriptor.id);
        position += 1;
        index += 1;
      }
      if (index === 0) throw invalid_state();
    }
  }
  if (position !== value.chunks.length) throw invalid_state();
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > CHECKPOINT_MAX_MANIFEST_BYTES) throw invalid_state();
  return value as LocusHostedAggregatePersistedManifest;
}

async function restore_manifest(
  manifest: LocusHostedAggregatePersistedManifest,
  adapter: LocusHostedAggregatePersistenceAdapter,
): Promise<LiveMap> {
  const libraries: Array<Readonly<{ name: string; root: HsonNode }>> = [];
  const registryEntries: HostedRegistryEntry[] = [];
  let position = 0;
  for (const fixed of manifest.registry.libraries) {
    const values: unknown[] = [];
    for (const part of ["schema", "root"] as const) {
      const decoder = new CheckpointTokenDecoder();
      while (position < manifest.chunks.length && manifest.chunks[position]?.owner === fixed.name
        && manifest.chunks[position]?.part === part) {
        const descriptor = manifest.chunks[position]!;
        const chunk = await adapter.readCheckpointChunk(descriptor.id);
        decoder.feed(validate_checkpoint_chunk(chunk, descriptor));
        position += 1;
      }
      values.push(decoder.finish());
    }
    const [schema, root] = values;
    if (typeof schema !== "string" || hosted_sha256(schema) !== fixed.schemaDigest
      || typeof root !== "object" || root === null || Array.isArray(root)) throw invalid_state();
    registryEntries.push(Object.freeze({
      name: fixed.name,
      ...(fixed.scope === undefined ? {} : { scope: fixed.scope }),
      mode: fixed.mode,
      schema: HsonSchema.fromHson(schema).toHson(),
      schemaDigest: fixed.schemaDigest,
      rootCodec: fixed.rootCodec,
    }));
    libraries.push(Object.freeze({ name: fixed.name, root: root as HsonNode }));
  }
  const registry: HostedRegistry = Object.freeze({ format: "hson-hosted-registry",
    libraries: Object.freeze(registryEntries), digest: manifest.registryDigest });
  const semantic: LiveMapSemanticCheckpoint = Object.freeze({
    authority: Object.freeze({ logicalMapId: manifest.logicalMapId, incarnationId: manifest.incarnationId }),
    revision: manifest.rev, registry, libraries: Object.freeze(libraries),
  });
  return make_livemap_mirror_from_semantic_checkpoint_internal(semantic);
}

function hosted_commit(commit: HostedAggregateCommit): LocusHostedAggregatePersistedCommit {
  const projected = make_portable_aggregate_commit(commit);
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

export function durable_aggregate_commit(commit: HostedAggregateCommit): LocusHostedAggregatePersistedCommit {
  return hosted_commit(commit);
}

function durable_aggregate_commit_as_client(commit: LocusDurableAggregateCommit): PortableAggregateCommit {
  const { format: _format, ...semantic } = commit;
  return Object.freeze({ format: "hson-portable-aggregate-commit-v1", ...semantic });
}

function assert_commit_fence(
  value: unknown,
  checkpoint: AnyCheckpoint,
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

async function validate_hosted_aggregate_state(
  requestedLogicalMapId: string,
  value: unknown,
  adapter: LocusHostedAggregatePersistenceAdapter,
): Promise<ValidatedHostedAggregateState> {
  try {
    const state = record(value);
    if (state === undefined || !exact_keys(state, ["checkpoint", "commits"])) throw invalid_state();
    const checkpointValue = record(state.checkpoint);
    if (checkpointValue === undefined) throw invalid_state();
    const checkpoint = assert_checkpoint_manifest(checkpointValue, requestedLogicalMapId);
    if (!Array.isArray(state.commits)) throw invalid_state();

    const map = await restore_manifest(checkpoint, adapter);
    const aggregate = internal_livemap_aggregate_authority(map);
    if (aggregate.hostedPosition().registryDigest !== checkpoint.registryDigest
      || aggregate.hostedPosition().revision !== checkpoint.rev) throw invalid_state();

    let expectedPrevRev = checkpoint.rev;
    let lastCoveredRev: number | undefined;
    let crossedCheckpoint = false;
    for (const item of state.commits) {
      const maybe = record(item);
      const commitRecord = maybe === undefined ? undefined : record(maybe.commit);
      if (commitRecord !== undefined && valid_revision(commitRecord.rev) && commitRecord.rev <= checkpoint.rev) {
        if (crossedCheckpoint || !valid_revision(commitRecord.prevRev)
          || (lastCoveredRev !== undefined && commitRecord.prevRev !== lastCoveredRev)) throw invalid_state();
        assert_commit_fence(item, checkpoint, commitRecord.prevRev);
        lastCoveredRev = commitRecord.rev;
        continue;
      }
      crossedCheckpoint = true;
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
  let checkpointTail = Promise.resolve();
  const checkpoint = (): Promise<void> => {
    const run = checkpointTail.then(async () => {
      const captured = await locus.run_exclusive(() => internal_livemap_aggregate_authority(locus.map).captureSemanticCheckpoint());
    try {
      await write_semantic_checkpoint(captured, adapter);
    } catch (cause) {
      if (cause instanceof LocusPersistenceError && cause.code === "LOCUS_PERSISTENCE_CHECKPOINT_UNCERTAIN") locus.dispose();
      throw persistence_failure(
        cause instanceof LocusPersistenceError && cause.code === "LOCUS_PERSISTENCE_CHECKPOINT_UNCERTAIN"
          ? "LOCUS_PERSISTENCE_CHECKPOINT_UNCERTAIN" : "LOCUS_PERSISTENCE_CHECKPOINT_FAILED",
        "Hosted aggregate Locus could not activate its persisted checkpoint.",
        cause,
      );
    }
    });
    checkpointTail = run.catch(() => {});
    return run;
  };
  return Object.freeze({
    map: locus.map,
    get logicalMapId() { return locus.logicalMapId; },
    get incarnationId() { return locus.incarnationId; },
    get registryDigest() { return locus.registryDigest; },
    get rev() { return locus.rev; },
    mutate: locus.mutate,
    dispatch_action: locus.dispatch_action,
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
  const snapshot = internal_livemap_aggregate_authority(locus.map).captureSemanticCheckpoint();
  try {
    await write_semantic_checkpoint(snapshot, persistence);
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
  const validated = await validate_hosted_aggregate_state(logicalMapId, state, options.persistence);
  const { persistence, ...hostedOptions } = options;
  const durability = make_durability_gate(persistence);
  const locus = create_locus_hosted_aggregate_internal({
    ...hostedOptions,
    map: validated.map,
    ...durability,
    uncertainGateFailure: (cause) => cause instanceof LocusPersistenceError && cause.code === "LOCUS_PERSISTENCE_APPEND_UNCERTAIN",
  });
  const actual = internal_livemap_aggregate_authority(locus.map).hostedPosition();
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
