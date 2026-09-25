import type {
  LocusHostedAggregatePersistedCommit,
  LocusHostedAggregatePersistedManifest,
  LocusHostedAggregatePersistedState,
  LocusHostedAggregatePersistenceAdapter,
} from "../../src/api/locus/locus.aggregate.persistence.ts";
import { active_checkpoint_id, assert_checkpoint_manifest } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { validate_checkpoint_chunk, type CheckpointChunk } from "../../src/api/locus/locus.checkpoint-chunks.ts";

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Simulates durable staging and one atomic active-manifest pointer replacement. */
export class MemoryCheckpointAdapter implements LocusHostedAggregatePersistenceAdapter {
  readonly states = new Map<string, LocusHostedAggregatePersistedState>();
  readonly chunks = new Map<string, CheckpointChunk>();
  readonly manifests = new Map<string, LocusHostedAggregatePersistedManifest>();
  readonly appendCalls: LocusHostedAggregatePersistedCommit[] = [];
  readonly checkpointCalls: LocusHostedAggregatePersistedManifest[] = [];
  failChunk: Error | undefined;
  failManifest: Error | undefined;
  failActivation: "before" | "after" | undefined;
  failPrune: Error | undefined;
  failAppend: Error | undefined;
  pendingChunk: ReturnType<typeof deferred> | undefined;
  enteredChunk: ReturnType<typeof deferred> | undefined;

  deferChunk() {
    const pending = deferred();
    const entered = deferred();
    this.pendingChunk = pending;
    this.enteredChunk = entered;
    return { entered: entered.promise, release: pending.resolve };
  }

  async load(logicalMapId: string): Promise<LocusHostedAggregatePersistedState | undefined> {
    return this.state(logicalMapId);
  }

  state(logicalMapId: string): LocusHostedAggregatePersistedState | undefined {
    const state = this.states.get(logicalMapId);
    return state === undefined ? undefined : structuredClone(state);
  }

  seed(logicalMapId: string, state: LocusHostedAggregatePersistedState): void {
    this.states.set(logicalMapId, structuredClone(state));
  }

  async appendCommit(record: LocusHostedAggregatePersistedCommit): Promise<void> {
    this.appendCalls.push(structuredClone(record));
    if (this.failAppend !== undefined) { const failure = this.failAppend; this.failAppend = undefined; throw failure; }
    const state = this.states.get(record.logicalMapId);
    const priorDigest = state?.commits.at(-1)?.registryDigest ?? state?.checkpoint.registryDigest;
    if (state === undefined || state.checkpoint.incarnationId !== record.incarnationId
      || record.registryDigest !== record.commit.registryDigest
      || (record.commit.topology === undefined
        ? priorDigest !== record.registryDigest
        : record.commit.previousRegistryDigest !== priorDigest || record.registryDigest === priorDigest)) {
      throw new Error("Durable commit fence mismatch.");
    }
    const expected = state.commits.at(-1)?.commit.rev ?? state.checkpoint.rev;
    if (record.commit.prevRev !== expected || record.commit.rev !== expected + 1) throw new Error("Durable tail gap.");
    this.states.set(record.logicalMapId, Object.freeze({ checkpoint: state.checkpoint,
      commits: Object.freeze([...state.commits, structuredClone(record)]) }));
  }

  async putCheckpointChunk(chunk: CheckpointChunk): Promise<void> {
    this.enteredChunk?.resolve();
    const pending = this.pendingChunk;
    this.pendingChunk = undefined;
    this.enteredChunk = undefined;
    if (pending !== undefined) await pending.promise;
    if (this.failChunk !== undefined) { const failure = this.failChunk; this.failChunk = undefined; throw failure; }
    this.chunks.set(chunk.id, structuredClone(chunk));
  }

  async putCheckpointManifest(manifest: LocusHostedAggregatePersistedManifest): Promise<void> {
    if (this.failManifest !== undefined) { const failure = this.failManifest; this.failManifest = undefined; throw failure; }
    assert_checkpoint_manifest(manifest, manifest.logicalMapId);
    for (const descriptor of manifest.chunks) validate_checkpoint_chunk(this.chunks.get(descriptor.id), descriptor);
    this.checkpointCalls.push(structuredClone(manifest));
    this.manifests.set(manifest.checkpointId, structuredClone(manifest));
  }

  async activateCheckpoint(logicalMapId: string, expectedCheckpointId: string | undefined, checkpointId: string): Promise<void> {
    if (this.failActivation === "before") { this.failActivation = undefined; throw new Error("Activation failed before commit."); }
    const manifest = this.manifests.get(checkpointId);
    if (manifest === undefined || manifest.logicalMapId !== logicalMapId) throw new Error("Candidate manifest is missing.");
    assert_checkpoint_manifest(manifest, logicalMapId);
    for (const descriptor of manifest.chunks) validate_checkpoint_chunk(this.chunks.get(descriptor.id), descriptor);
    const prior = this.states.get(logicalMapId);
    if ((prior === undefined ? undefined : active_checkpoint_id(prior.checkpoint)) !== expectedCheckpointId) {
      throw new Error("Active checkpoint compare-and-swap failed.");
    }
    // This single assignment is the modeled atomic storage primitive.
    this.states.set(logicalMapId, Object.freeze({ checkpoint: structuredClone(manifest),
      commits: Object.freeze(prior?.commits ?? []) }));
    if (this.failActivation === "after") { this.failActivation = undefined; throw new Error("Activation committed before error."); }
  }

  async readCheckpointChunk(id: string): Promise<CheckpointChunk | undefined> {
    const chunk = this.chunks.get(id);
    return chunk === undefined ? undefined : structuredClone(chunk);
  }

  async pruneCommitsThrough(logicalMapId: string, checkpointId: string, rev: number): Promise<void> {
    if (this.failPrune !== undefined) { const failure = this.failPrune; this.failPrune = undefined; throw failure; }
    const state = this.states.get(logicalMapId);
    if (state === undefined || active_checkpoint_id(state.checkpoint) !== checkpointId || state.checkpoint.rev !== rev) {
      throw new Error("Tail pruning requires the active checkpoint fence.");
    }
    this.states.set(logicalMapId, Object.freeze({ checkpoint: state.checkpoint,
      commits: Object.freeze(state.commits.filter((record) => record.commit.rev > rev)) }));
  }
}
