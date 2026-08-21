import type {
  LiveHostActivity,
  LiveHostActivityKind,
  LiveHostActivitySnapshot,
  LiveHostDisposer,
} from "../../types/livehost.types.js";

const ACTIVITY_KINDS: readonly LiveHostActivityKind[] = Object.freeze([
  "connection",
  "session",
  "action",
  "recovery",
  "mutation",
  "persistence",
]);

export type LiveHostActivityController = Readonly<{
  public: LiveHostActivity;
  acquire(kind: LiveHostActivityKind): LiveHostDisposer;
  dispose(): void;
}>;

const controllers = new WeakMap<object, LiveHostActivityController>();

function make_snapshot(
  counts: ReadonlyMap<LiveHostActivityKind, number>,
  disposed: boolean,
): LiveHostActivitySnapshot {
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

export function make_livehost_activity_controller(): LiveHostActivityController {
  const counts = new Map<LiveHostActivityKind, number>();
  const listeners = new Set<(snapshot: LiveHostActivitySnapshot) => void>();
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

  const publicActivity: LiveHostActivity = Object.freeze({
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

export function register_livehost_activity_controller(
  locus: object,
  controller: LiveHostActivityController,
): void {
  controllers.set(locus, controller);
}

/** @internal Claim work performed by a wrapper around an established authority. */
export function acquire_livehost_internal_activity(
  locus: object,
  kind: LiveHostActivityKind,
): LiveHostDisposer {
  return controllers.get(locus)?.acquire(kind) ?? (() => {});
}
