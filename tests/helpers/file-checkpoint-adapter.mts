import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type {
  LocusHostedAggregatePersistedCommit, LocusHostedAggregatePersistedManifest, LocusHostedAggregatePersistedState,
} from "../../src/api/locus/locus.aggregate.persistence.ts";
import type { CheckpointChunk } from "../../src/api/locus/locus.checkpoint-chunks.ts";
import { MemoryCheckpointAdapter } from "./memory-checkpoint-adapter.mts";

type Stored = {
  states: [string, LocusHostedAggregatePersistedState][];
  chunks: [string, CheckpointChunk][];
  manifests: [string, LocusHostedAggregatePersistedManifest][];
};

/** Reopenable byte storage around the existing adapter's staging/CAS/fault model.
 * Callers supply a file under an external temporary directory. Graphs travel
 * only inside encoded chunk/commit strings, never as raw roots in this JSON. */
export class FileCheckpointAdapter extends MemoryCheckpointAdapter {
  constructor(readonly file: string) {
    super();
    if (existsSync(file)) {
      const stored: Stored = JSON.parse(readFileSync(file, "utf8"));
      for (const [key, value] of stored.states) this.states.set(key, value);
      for (const [key, value] of stored.chunks) this.chunks.set(key, value);
      for (const [key, value] of stored.manifests) this.manifests.set(key, value);
    }
  }

  flush(): void {
    const stored: Stored = { states: [...this.states], chunks: [...this.chunks], manifests: [...this.manifests] };
    writeFileSync(`${this.file}.pending`, JSON.stringify(stored));
    renameSync(`${this.file}.pending`, this.file);
  }

  override async appendCommit(record: LocusHostedAggregatePersistedCommit): Promise<void> {
    try { await super.appendCommit(record); } finally { this.flush(); }
  }
  override async putCheckpointChunk(chunk: CheckpointChunk): Promise<void> {
    try { await super.putCheckpointChunk(chunk); } finally { this.flush(); }
  }
  override async putCheckpointManifest(manifest: LocusHostedAggregatePersistedManifest): Promise<void> {
    try { await super.putCheckpointManifest(manifest); } finally { this.flush(); }
  }
  override async activateCheckpoint(logicalMapId: string, expectedCheckpointId: string | undefined, checkpointId: string): Promise<void> {
    try { await super.activateCheckpoint(logicalMapId, expectedCheckpointId, checkpointId); } finally { this.flush(); }
  }
  override async pruneCommitsThrough(logicalMapId: string, checkpointId: string, rev: number): Promise<void> {
    try { await super.pruneCommitsThrough(logicalMapId, checkpointId, rev); } finally { this.flush(); }
  }
}
