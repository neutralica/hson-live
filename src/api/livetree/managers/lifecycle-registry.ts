// lifecycle-registry.ts

import {
  default_livetree_runtime,
  type LiveTreeRuntime,
} from "../runtime/livetree-runtime.js";
import type { HsonNode } from "../../../core/types.js";

export type LifecycleResourceKind =
  | "binding"
  | "listener"
  | "tree-event"
  | "resize-observer"
  | "other";

export type LifecycleResourceCounts = Readonly<{
  total: number;
  binding: number;
  listener: number;
  treeEvent: number;
  resizeObserver: number;
  other: number;
}>;

export const TERMINAL_DISPOSABLE_DRAIN_LIMIT = 64;

export type DisposableDrainResult = Readonly<{
  passes: number;
  callbacks: number;
  bounded: boolean;
}>;

type LifecycleOwner = HsonNode;

export function disposables_count_for_owner(
  ownerQuid: string,
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): number {
  const owner = runtime.quidToNode.get(ownerQuid);
  return owner === undefined ? 0 : disposables_count_for_subject(owner, runtime);
}

export function disposables_count_for_subject(
  owner: LifecycleOwner,
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): number {
  return runtime.ownerDisposables.get(owner)?.size ?? 0;
}

export function lifecycle_resource_counts_for_owner(
  ownerQuid: string,
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): LifecycleResourceCounts {
  const owner = runtime.quidToNode.get(ownerQuid);
  if (owner === undefined) return empty_resource_counts();
  return lifecycle_resource_counts_for_subject(owner, runtime);
}

export function lifecycle_resource_counts_for_subject(
  owner: LifecycleOwner,
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): LifecycleResourceCounts {
  const kinds = runtime.ownerDisposableKinds.get(owner);
  const count = (kind: LifecycleResourceKind): number => {
    if (!kinds) return 0;
    let total = 0;
    for (const value of kinds.values()) {
      if (value === kind) total += 1;
    }
    return total;
  };

  return Object.freeze({
    total: disposables_count_for_subject(owner, runtime),
    binding: count("binding"),
    listener: count("listener"),
    treeEvent: count("tree-event"),
    resizeObserver: count("resize-observer"),
    other: count("other"),
  });
}

function empty_resource_counts(): LifecycleResourceCounts {
  return Object.freeze({
    total: 0,
    binding: 0,
    listener: 0,
    treeEvent: 0,
    resizeObserver: 0,
    other: 0,
  });
}

export function disposable_add_for_owner(
  ownerQuid: string,
  off: () => void,
  kind: LifecycleResourceKind = "other",
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): void {
  const owner = runtime.quidToNode.get(ownerQuid);
  if (owner === undefined) throw new Error("Lifecycle owner is not active in this runtime.");
  disposable_add_for_subject(owner, off, kind, runtime);
}

export function disposable_add_for_subject(
  owner: LifecycleOwner,
  off: () => void,
  kind: LifecycleResourceKind = "other",
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): void {
  let set = runtime.ownerDisposables.get(owner);

  if (!set) {
    set = new Set();
    runtime.ownerDisposables.set(owner, set);
  }

  set.add(off);

  let kinds = runtime.ownerDisposableKinds.get(owner);
  if (!kinds) {
    kinds = new Map();
    runtime.ownerDisposableKinds.set(owner, kinds);
  }
  kinds.set(off, kind);
}

export function disposable_remove_for_owner(
  ownerQuid: string,
  off: () => void,
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): void {
  const owner = runtime.quidToNode.get(ownerQuid);
  if (owner === undefined) return;
  disposable_remove_for_subject(owner, off, runtime);
}

export function disposable_remove_for_subject(
  owner: LifecycleOwner,
  off: () => void,
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): void {
  const set = runtime.ownerDisposables.get(owner);

  if (!set) return;

  set.delete(off);
  runtime.ownerDisposableKinds.get(owner)?.delete(off);

  if (set.size === 0) {
    runtime.ownerDisposables.delete(owner);
    runtime.ownerDisposableKinds.delete(owner);
  }
}

/**
 * Register one idempotent resource disposer under a LiveTree owner.
 * Manual disposal first unregisters ownership, then releases the resource.
 */
export function own_disposable_for_owner(
  ownerQuid: string,
  dispose: () => void,
  kind: LifecycleResourceKind = "other",
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): () => void {
  const owner = runtime.quidToNode.get(ownerQuid);
  if (owner === undefined) throw new Error("Lifecycle owner is not active in this runtime.");
  return own_disposable_for_subject(owner, dispose, kind, runtime);
}

/** Browser-local cleanup follows one exact active realization, without QUID demand. */
export function own_disposable_for_subject(
  owner: LifecycleOwner,
  dispose: () => void,
  kind: LifecycleResourceKind = "other",
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): () => void {
  let active = true;

  const off = (): void => {
    if (!active) return;
    active = false;
    disposable_remove_for_subject(owner, off, runtime);
    dispose();
  };

  disposable_add_for_subject(owner, off, kind, runtime);
  return off;
}

export function disposables_off_for_owner(
  ownerQuid: string,
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): void {
  const owner = runtime.quidToNode.get(ownerQuid);
  if (owner === undefined) return;
  disposables_off_for_subject(owner, runtime);
}

export function disposables_off_for_subject(
  owner: LifecycleOwner,
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): void {
  const set = runtime.ownerDisposables.get(owner);

  if (!set) return;

  runtime.ownerDisposables.delete(owner);
  runtime.ownerDisposableKinds.delete(owner);

  for (const off of set) {
    try {
      off();
    } catch (err) {
      console.warn("[LiveTree.lifecycle] disposable cleanup failed", err);
    }
  }
}

/**
 * Drain disposables for a fixed owner set, including callbacks registered
 * reentrantly during teardown. A pathological owner that continuously
 * re-registers is bounded; remaining callbacks are discarded without running.
 */
export function disposables_drain_for_subjects(
  ownersInput: readonly LifecycleOwner[],
  passLimit: number = TERMINAL_DISPOSABLE_DRAIN_LIMIT,
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): DisposableDrainResult {
  const owners = [...new Set(ownersInput)];
  let passes = 0;
  let callbacks = 0;

  const pendingCount = (): number => owners.reduce(
    (total, owner) => total + disposables_count_for_subject(owner, runtime),
    0,
  );

  while (pendingCount() > 0 && passes < passLimit) {
    passes += 1;
    for (const owner of owners) {
      callbacks += disposables_count_for_subject(owner, runtime);
      disposables_off_for_subject(owner, runtime);
    }
  }

  const bounded = pendingCount() > 0;
  if (bounded) {
    for (const owner of owners) {
      runtime.ownerDisposables.delete(owner);
      runtime.ownerDisposableKinds.delete(owner);
    }
    console.warn(
      `[LiveTree.lifecycle] terminal disposable drain exceeded ${passLimit} passes; remaining callbacks were discarded`,
    );
  }

  return { passes, callbacks, bounded };
}
