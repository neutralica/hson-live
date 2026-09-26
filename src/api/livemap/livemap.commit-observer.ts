import type {
  LiveMapAnyOp,
  LiveMapCoreCommit,
  LiveMapCommitObserver,
  LiveMapDisposer,
} from "../../types/livemap.types.js";
import { deliver_livemap_observers } from "./livemap.observer-delivery.js";

/** Closure-local commit publication shared by projected and document maps. */
export function make_livemap_commit_observer_hub<TOp extends LiveMapAnyOp>(): LiveMapCommitObserverHub<TOp> {
  const observers: LiveMapCommitObserver<TOp>[] = [];
  let prepareNextObservation: ((observation: Parameters<LiveMapCommitObserver<TOp>>[0]) => void) | undefined;
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
      const prepare = prepareNextObservation;
      prepareNextObservation = undefined;
      prepare?.(observation);
      deliver_livemap_observers(observers, observer => observer(observation), "commit");
    },
    emitSnapshot: (revision) => {
      const observation = Object.freeze({ kind: "snapshot" as const, origin: "snapshot" as const, revision });
      const prepare = prepareNextObservation;
      prepareNextObservation = undefined;
      prepare?.(observation);
      deliver_livemap_observers(observers, observer => observer(observation), "snapshot");
    },
    prepareObservation: (prepare) => {
      if (prepareNextObservation !== undefined) {
        throw new Error("LiveMap observation evidence is already pending publication.");
      }
      prepareNextObservation = prepare;
    },
  });
}

export type LiveMapCommitObserverHub<TOp extends LiveMapAnyOp> = Readonly<{
  observe: (observer: LiveMapCommitObserver<TOp>) => LiveMapDisposer;
  emitCommit: (commit: LiveMapCoreCommit<TOp>, origin: "authoritative" | "replay") => void;
  emitSnapshot: (revision: number) => void;
  prepareObservation: (
    prepare: (observation: Parameters<LiveMapCommitObserver<TOp>>[0]) => void,
  ) => void;
}>;
