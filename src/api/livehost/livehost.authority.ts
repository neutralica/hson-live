import type { LiveMapAnyOp, LiveMapCommit } from "../../types/livemap.types.js";
import {
  get_livemap_staged_authority,
  type PreparedLiveMapTransition,
} from "../livemap/livemap.authority.js";

export type LiveHostAuthorityMutationSource = "host" | "action" | "document-action" | "link" | "checkpoint";

export type LiveHostAuthorityGateInput<TMap extends object> = Readonly<{
  map: TMap;
  transition: PreparedLiveMapTransition;
  commit: LiveMapCommit<LiveMapAnyOp>;
  baseRevision: number;
  nextRevision: number;
}>;

export type LiveHostAuthorityGate<TMap extends object> = (
  input: LiveHostAuthorityGateInput<TMap>,
) => void | Promise<void>;

export type LiveHostAuthorityErrorCode =
  | "LIVEHOST_AUTHORITY_ALREADY_MANAGED"
  | "LIVEHOST_AUTHORITY_CLOSED"
  | "LIVEHOST_AUTHORITY_GATE_REJECTED"
  | "LIVEHOST_AUTHORITY_TERMINAL"
  | "LIVEHOST_AUTHORITY_ACCEPTED_INGESTION_FAILED";

export class LiveHostAuthorityError extends Error {
  constructor(
    readonly code: LiveHostAuthorityErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LiveHostAuthorityError";
  }
}

export type LiveHostAuthorityEvent = Readonly<{
  phase: "enqueued" | "prepared" | "gate-started" | "gate-completed" | "gate-failed" | "accepted" | "notification-failed" | "failed" | "released";
  source: LiveHostAuthorityMutationSource;
  queueDepth: number;
  baseRevision?: number;
  nextRevision?: number;
  changed?: boolean;
  errorCode?: string;
}>;

export type LiveHostExclusiveAuthority<TMap extends object, TContext = undefined> = Readonly<{
  mutate: (
    mutation: (draft: TMap) => LiveMapCommit<LiveMapAnyOp>,
    source?: LiveHostAuthorityMutationSource,
    context?: TContext,
  ) => Promise<LiveMapCommit<LiveMapAnyOp>>;
  runExclusive: <TResult>(operation: () => TResult | Promise<TResult>) => Promise<TResult>;
  dispose: () => void;
  closed: Promise<void>;
  readonly failed: boolean;
}>;

type MutationQueueTask<TMap extends object, TContext> = {
  kind: "mutation";
  mutation: (draft: TMap) => LiveMapCommit<LiveMapAnyOp>;
  source: LiveHostAuthorityMutationSource;
  context: TContext | undefined;
  resolve: (commit: LiveMapCommit<LiveMapAnyOp>) => void;
  reject: (cause: unknown) => void;
};

type BarrierQueueTask<TResult = unknown> = {
  kind: "barrier";
  operation: () => TResult | Promise<TResult>;
  resolve: (result: TResult) => void;
  reject: (cause: unknown) => void;
};

type QueueTask<TMap extends object, TContext> = MutationQueueTask<TMap, TContext> | BarrierQueueTask;

/** One host-scoped FIFO authority queue with one future durability gate. */
export function make_livehost_exclusive_authority<TMap extends object, TContext = undefined>(
  map: TMap,
  options: Readonly<{
    gate?: LiveHostAuthorityGate<TMap>;
    accepted: (
      commit: LiveMapCommit<LiveMapAnyOp>,
      notificationFailureCount: number,
      source: LiveHostAuthorityMutationSource,
      context: TContext | undefined,
    ) => void;
    event?: (event: LiveHostAuthorityEvent) => void;
    released?: () => void;
  }>,
): LiveHostExclusiveAuthority<TMap, TContext> {
  const staged = get_livemap_staged_authority(map);
  const owner = Object.freeze({});
  const queue: QueueTask<TMap, TContext>[] = [];
  let active = false;
  let state: "open" | "closing" | "failed" | "closed" = "open";
  let resolveClosed: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });

  const emit = (event: LiveHostAuthorityEvent): void => {
    try { options.event?.(event); } catch { /* Diagnostics never own authority. */ }
  };

  function terminal(cause: unknown): LiveHostAuthorityError {
    state = "failed";
    const error = cause instanceof LiveHostAuthorityError
      ? cause
      : new LiveHostAuthorityError(
        "LIVEHOST_AUTHORITY_TERMINAL",
        "LiveHost exclusive authority entered a terminal state.",
        { cause },
      );
    emit({ phase: "failed", source: "host", queueDepth: queue.length, errorCode: error.code });
    while (queue.length > 0) queue.shift()?.reject(error);
    return error;
  }

  function release_if_idle(): void {
    if (active || state !== "closing") return;
    staged.releaseManagement(owner);
    state = "closed";
    resolveClosed?.();
    options.released?.();
    emit({ phase: "released", source: "host", queueDepth: 0 });
  }

  async function run_mutation(task: MutationQueueTask<TMap, TContext>): Promise<void> {
    let transition: PreparedLiveMapTransition | undefined;
    try {
      transition = staged.prepare(task.mutation);
      emit({
        phase: "prepared",
        source: task.source,
        queueDepth: queue.length,
        baseRevision: transition.baseRevision,
        nextRevision: transition.nextRevision,
        changed: transition.commit.changed,
      });
      if (transition.commit.changed) {
        emit({
          phase: "gate-started",
          source: task.source,
          queueDepth: queue.length,
          baseRevision: transition.baseRevision,
          nextRevision: transition.nextRevision,
          changed: true,
        });
        try {
          await options.gate?.({
            map,
            transition,
            commit: transition.commit,
            baseRevision: transition.baseRevision,
            nextRevision: transition.nextRevision,
          });
        } catch (cause) {
          staged.discard(transition);
          const error = structured_gate_error(cause) ?? new LiveHostAuthorityError(
              "LIVEHOST_AUTHORITY_GATE_REJECTED",
              "LiveHost authority gate rejected the prepared transition.",
              { cause },
            );
          emit({ phase: "gate-failed", source: task.source, queueDepth: queue.length, errorCode: error.code });
          task.reject(error);
          return;
        }
        emit({
          phase: "gate-completed",
          source: task.source,
          queueDepth: queue.length,
          baseRevision: transition.baseRevision,
          nextRevision: transition.nextRevision,
          changed: true,
        });
      }

      let acceptance;
      try {
        acceptance = staged.accept(transition, "isolate");
      } catch (cause) {
        task.reject(terminal(cause));
        return;
      }

      try {
        if (acceptance.commit.changed) {
          options.accepted(
            acceptance.commit,
            acceptance.notificationFailureCount,
            task.source,
            task.context,
          );
        }
      } catch (cause) {
        const error = new LiveHostAuthorityError(
          "LIVEHOST_AUTHORITY_ACCEPTED_INGESTION_FAILED",
          "LiveHost accepted a transition but could not ingest its commit.",
          { cause },
        );
        task.reject(terminal(error));
        return;
      }

      if (acceptance.notificationFailureCount > 0) {
        emit({
          phase: "notification-failed",
          source: task.source,
          queueDepth: queue.length,
          baseRevision: transition.baseRevision,
          nextRevision: transition.nextRevision,
          changed: acceptance.commit.changed,
        });
      }
      emit({
        phase: "accepted",
        source: task.source,
        queueDepth: queue.length,
        baseRevision: transition.baseRevision,
        nextRevision: transition.nextRevision,
        changed: acceptance.commit.changed,
      });
      task.resolve(acceptance.commit);
    } catch (cause) {
      if (transition !== undefined) {
        try { staged.discard(transition); } catch { /* It may already be accepted. */ }
      }
      task.reject(cause);
    }
  }

  async function run_barrier(task: BarrierQueueTask): Promise<void> {
    try {
      task.resolve(await task.operation());
    } catch (cause) {
      task.reject(cause);
    }
  }

  function drain(): void {
    if (active || state === "failed" || state === "closed") return;
    const task = queue.shift();
    if (task === undefined) {
      release_if_idle();
      return;
    }
    active = true;
    const running = task.kind === "mutation" ? run_mutation(task) : run_barrier(task);
    void running.finally(() => {
      active = false;
      drain();
    });
  }

  function mutate(
    mutation: (draft: TMap) => LiveMapCommit<LiveMapAnyOp>,
    source: LiveHostAuthorityMutationSource = "host",
    context?: TContext,
  ): Promise<LiveMapCommit<LiveMapAnyOp>> {
    if (state === "failed") {
      return Promise.reject(new LiveHostAuthorityError(
        "LIVEHOST_AUTHORITY_TERMINAL",
        "LiveHost exclusive authority is terminally failed.",
      ));
    }
    if (state !== "open") {
      return Promise.reject(new LiveHostAuthorityError(
        "LIVEHOST_AUTHORITY_CLOSED",
        "LiveHost exclusive authority is closed.",
      ));
    }
    return new Promise((resolve, reject) => {
      queue.push({ kind: "mutation", mutation, source, context, resolve, reject });
      emit({ phase: "enqueued", source, queueDepth: queue.length + (active ? 1 : 0) });
      drain();
    });
  }

  function runExclusive<TResult>(operation: () => TResult | Promise<TResult>): Promise<TResult> {
    if (state === "failed") {
      return Promise.reject(new LiveHostAuthorityError(
        "LIVEHOST_AUTHORITY_TERMINAL",
        "LiveHost exclusive authority is terminally failed.",
      ));
    }
    if (state !== "open") {
      return Promise.reject(new LiveHostAuthorityError(
        "LIVEHOST_AUTHORITY_CLOSED",
        "LiveHost exclusive authority is closed.",
      ));
    }
    return new Promise<TResult>((resolve, reject) => {
      const task: BarrierQueueTask<TResult> = { kind: "barrier", operation, resolve, reject };
      queue.push(task as BarrierQueueTask);
      emit({ phase: "enqueued", source: "checkpoint", queueDepth: queue.length + (active ? 1 : 0) });
      drain();
    });
  }

  staged.claimManagement(owner, (mutation) => mutate(mutation, "link"));

  return Object.freeze({
    mutate,
    runExclusive,
    closed,
    dispose(): void {
      if (state === "closed" || state === "closing") return;
      state = "closing";
      const error = new LiveHostAuthorityError(
        "LIVEHOST_AUTHORITY_CLOSED",
        "LiveHost exclusive authority is closing.",
      );
      while (queue.length > 0) queue.shift()?.reject(error);
      release_if_idle();
    },
    get failed() { return state === "failed"; },
  });
}

function structured_gate_error(cause: unknown): (Error & Readonly<{ code: string }>) | undefined {
  return cause instanceof Error
    && "code" in cause
    && typeof cause.code === "string"
    && cause.code.startsWith("LIVEHOST_")
    ? cause as Error & Readonly<{ code: string }>
    : undefined;
}
