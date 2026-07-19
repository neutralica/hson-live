import type {
  LiveMapAnyOp,
  LiveMapCommit,
  LiveMapCommitObserver,
  LiveMapDisposer,
} from "../../types/livemap.types.js";

/** Closure-local commit publication shared by projected and document maps. */
export function make_livemap_commit_observer_hub<TOp extends LiveMapAnyOp>(): LiveMapCommitObserverHub<TOp> {
  const observers: LiveMapCommitObserver<TOp>[] = [];
  return Object.freeze({
    observe: (observer) => {
      if (typeof observer !== "function") throw new TypeError("LiveMap commit observer must be a function.");
      observers.push(observer);
      return () => {
        const index = observers.indexOf(observer);
        if (index !== -1) observers.splice(index, 1);
      };
    },
    emitCommit: (commit, origin) => {
      if (!commit.changed) return;
      const observation = Object.freeze({ kind: "commit" as const, commit, origin });
      for (const observer of [...observers]) observer(observation);
    },
    emitSnapshot: (revision) => {
      const observation = Object.freeze({ kind: "snapshot" as const, origin: "snapshot" as const, revision });
      for (const observer of [...observers]) observer(observation);
    },
  });
}

export type LiveMapCommitObserverHub<TOp extends LiveMapAnyOp> = Readonly<{
  observe: (observer: LiveMapCommitObserver<TOp>) => LiveMapDisposer;
  emitCommit: (commit: LiveMapCommit<TOp>, origin: "authoritative" | "replay") => void;
  emitSnapshot: (revision: number) => void;
}>; 
