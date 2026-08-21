import type {
  LocusActivity,
  LocusActivityKind,
  LocusActivitySnapshot,
  LocusDisposer,
} from "../../types/locus.types.js";

const ACTIVITY_KINDS: readonly LocusActivityKind[] = Object.freeze([
  "connection",
  "session",
  "action",
  "recovery",
  "mutation",
  "persistence",
]);

export type LocusActivityController = Readonly<{
  public: LocusActivity;
  acquire(kind: LocusActivityKind): LocusDisposer;
  dispose(): void;
}>;

const controllers = new WeakMap<object, LocusActivityController>();

function make_snapshot(
  counts: ReadonlyMap<LocusActivityKind, number>,
  disposed: boolean,
): LocusActivitySnapshot {
  const blockers = ACTIVITY_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0);
  return Object.freeze({
    state: disposed ? "disposed" : blockers.length === 0 ? "idle" : "active",
    connectionCount: counts.get("connection") ?? 0,
    retainedSessionCount: counts.get("session") ?? 0,
    actionCount: counts.get("action") ?? 0,
    recoveryCount: counts.get("recovery") ?? 0,
    mutationCount: counts.get("mutation") ?? 0,
    persistenceCount: counts.get("persistence") ?? 0,
    blockerCount: blockers.reduce((total, kind) => total + (counts.get(kind) ?? 0), 0),
    blockers: Object.freeze(blockers),
  });
}

export function make_locus_activity_controller(): LocusActivityController {
  const counts = new Map<LocusActivityKind, number>();
  const listeners = new Set<(snapshot: LocusActivitySnapshot) => void>();
  let disposed = false;
  let previous = make_snapshot(counts, disposed);

  function publish(): void {
    const snapshot = make_snapshot(counts, disposed);
    if (
      snapshot.state === previous.state
      && snapshot.connectionCount === previous.connectionCount
      && snapshot.retainedSessionCount === previous.retainedSessionCount
      && snapshot.actionCount === previous.actionCount
      && snapshot.recoveryCount === previous.recoveryCount
      && snapshot.mutationCount === previous.mutationCount
      && snapshot.persistenceCount === previous.persistenceCount
    ) return;
    previous = snapshot;
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        // Authority lifecycle is isolated from observer failures.
      }
    }
  }

  const publicActivity: LocusActivity = Object.freeze({
    snapshot: () => previous,
    on_change(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      let listening = true;
      return () => {
        if (!listening) return;
        listening = false;
        listeners.delete(listener);
      };
    },
  });

  return Object.freeze({
    public: publicActivity,
    acquire(kind) {
      if (disposed) return () => {};
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      publish();
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        const next = Math.max(0, (counts.get(kind) ?? 0) - 1);
        if (next === 0) counts.delete(kind);
        else counts.set(kind, next);
        publish();
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      counts.clear();
      publish();
      listeners.clear();
    },
  });
}

export function register_locus_activity_controller(
  locus: object,
  controller: LocusActivityController,
): void {
  controllers.set(locus, controller);
}

/** @internal Claim work performed by a wrapper around an established authority. */
export function acquire_locus_internal_activity(
  locus: object,
  kind: LocusActivityKind,
): LocusDisposer {
  return controllers.get(locus)?.acquire(kind) ?? (() => {});
}
