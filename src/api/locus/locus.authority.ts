import type { LiveMapAnyOp, LiveMapCommit } from "../../types/livemap.types.js";
import {
  get_livemap_staged_authority,
  type PreparedLiveMapTransition,
} from "../livemap/livemap.authority.js";

export type LocusAuthorityMutationSource = "locus" | "action" | "document-action" | "link" | "checkpoint";

export type LocusAuthorityGateInput<TMap extends object> = Readonly<{
  map: TMap;
  transition: PreparedLiveMapTransition;
  commit: LiveMapCommit<LiveMapAnyOp>;
  baseRevision: number;
  nextRevision: number;
}>;

export type LocusAuthorityGate<TMap extends object> = (
  input: LocusAuthorityGateInput<TMap>,
) => void | Promise<void>;

export type LocusAuthorityErrorCode =
  | "LOCUS_AUTHORITY_ALREADY_MANAGED"
  | "LOCUS_AUTHORITY_CLOSED"
  | "LOCUS_AUTHORITY_GATE_REJECTED"
  | "LOCUS_AUTHORITY_TERMINAL"
  | "LOCUS_AUTHORITY_ACCEPTED_INGESTION_FAILED";

export class LocusAuthorityError extends Error {
  constructor(
    readonly code: LocusAuthorityErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LocusAuthorityError";
  }
}

export type LocusAuthorityEvent = Readonly<{
  phase: "enqueued" | "prepared" | "gate-started" | "gate-completed" | "gate-failed" | "accepted" | "notification-failed" | "failed" | "released";
  source: LocusAuthorityMutationSource;
  queueDepth: number;
  baseRevision?: number;
  nextRevision?: number;
  changed?: boolean;
  errorCode?: string;
}>;

export type LocusExclusiveAuthority<TMap extends object, TContext = undefined> = Readonly<{
  mutate: (
    mutation: (draft: TMap) => LiveMapCommit<LiveMapAnyOp>,
    source?: LocusAuthorityMutationSource,
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
  source: LocusAuthorityMutationSource;
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

/** One Locus-scoped FIFO authority queue with one future durability gate. */
export function make_locus_exclusive_authority<TMap extends object, TContext = undefined>(
  map: TMap,
  options: Readonly<{
    gate?: LocusAuthorityGate<TMap>;
    accepted: (
      commit: LiveMapCommit<LiveMapAnyOp>,
      notificationFailureCount: number,
      source: LocusAuthorityMutationSource,
      context: TContext | undefined,
    ) => void;
    event?: (event: LocusAuthorityEvent) => void;
    afterGate?: (transition: PreparedLiveMapTransition) => void;
    released?: () => void;
    terminal?: (error: LocusAuthorityError) => void;
  }>,
): LocusExclusiveAuthority<TMap, TContext> {
  const staged = get_livemap_staged_authority(map);
  const owner = Object.freeze({});
  const queue: QueueTask<TMap, TContext>[] = [];
  let active = false;
  let state: "open" | "closing" | "failed" | "closed" = "open";
  let resolveClosed: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });

  const emit = (event: LocusAuthorityEvent): void => {
    try { options.event?.(event); } catch { /* Diagnostics never own authority. */ }
  };

  function terminal(cause: unknown): LocusAuthorityError {
    state = "failed";
    const error = cause instanceof LocusAuthorityError
      ? cause
      : new LocusAuthorityError(
        "LOCUS_AUTHORITY_TERMINAL",
        "Locus authority entered a terminal state.",
        { cause },
      );
    emit({ phase: "failed", source: "locus", queueDepth: queue.length, errorCode: error.code });
    while (queue.length > 0) queue.shift()?.reject(error);
    try { options.terminal?.(error); } catch { /* Terminal fencing is best effort and cannot restore authority. */ }
    return error;
  }

  function release_if_idle(): void {
    if (active || state !== "closing") return;
    staged.releaseManagement(owner);
    state = "closed";
    resolveClosed?.();
    options.released?.();
    emit({ phase: "released", source: "locus", queueDepth: 0 });
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
          if (options.gate !== undefined) {
            await options.gate({
              map,
              transition,
              commit: transition.commit,
              baseRevision: transition.baseRevision,
              nextRevision: transition.nextRevision,
            });
          }
        } catch (cause) {
          staged.discard(transition);
          const error = structured_gate_error(cause) ?? new LocusAuthorityError(
              "LOCUS_AUTHORITY_GATE_REJECTED",
              "Locus authority gate rejected the prepared transition.",
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
        options.afterGate?.(transition);
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
        const error = new LocusAuthorityError(
          "LOCUS_AUTHORITY_ACCEPTED_INGESTION_FAILED",
          "Locus accepted a transition but could not ingest its commit.",
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
    source: LocusAuthorityMutationSource = "locus",
    context?: TContext,
  ): Promise<LiveMapCommit<LiveMapAnyOp>> {
    if (state === "failed") {
      return Promise.reject(new LocusAuthorityError(
        "LOCUS_AUTHORITY_TERMINAL",
        "Locus authority is terminally failed.",
      ));
    }
    if (state !== "open") {
      return Promise.reject(new LocusAuthorityError(
        "LOCUS_AUTHORITY_CLOSED",
        "Locus authority is closed.",
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
      return Promise.reject(new LocusAuthorityError(
        "LOCUS_AUTHORITY_TERMINAL",
        "Locus authority is terminally failed.",
      ));
    }
    if (state !== "open") {
      return Promise.reject(new LocusAuthorityError(
        "LOCUS_AUTHORITY_CLOSED",
        "Locus authority is closed.",
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
      const error = new LocusAuthorityError(
        "LOCUS_AUTHORITY_CLOSED",
        "Locus authority is closing.",
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
    && cause.code.startsWith("LOCUS_")
    ? cause as Error & Readonly<{ code: string }>
    : undefined;
}
