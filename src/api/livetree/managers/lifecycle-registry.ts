// lifecycle-registry.ts

const OWNER_DISPOSABLE_REG = new Map<string, Set<() => void>>();

export const TERMINAL_DISPOSABLE_DRAIN_LIMIT = 64;

export type DisposableDrainResult = Readonly<{
  passes: number;
  callbacks: number;
  bounded: boolean;
}>;

export function disposables_count_for_owner(ownerQuid: string): number {
  return OWNER_DISPOSABLE_REG.get(ownerQuid)?.size ?? 0;
}

export function disposable_add_for_owner(ownerQuid: string, off: () => void): void {
  let set = OWNER_DISPOSABLE_REG.get(ownerQuid);

  if (!set) {
    set = new Set();
    OWNER_DISPOSABLE_REG.set(ownerQuid, set);
  }

  set.add(off);
}

export function disposable_remove_for_owner(ownerQuid: string, off: () => void): void {
  const set = OWNER_DISPOSABLE_REG.get(ownerQuid);

  if (!set) return;

  set.delete(off);

  if (set.size === 0) {
    OWNER_DISPOSABLE_REG.delete(ownerQuid);
  }
}

export function disposables_off_for_owner(ownerQuid: string): void {
  const set = OWNER_DISPOSABLE_REG.get(ownerQuid);

  if (!set) return;

  OWNER_DISPOSABLE_REG.delete(ownerQuid);

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
export function disposables_drain_for_owners(
  ownerQuids: readonly string[],
  passLimit: number = TERMINAL_DISPOSABLE_DRAIN_LIMIT,
): DisposableDrainResult {
  const owners = [...new Set(ownerQuids)];
  let passes = 0;
  let callbacks = 0;

  const pendingCount = (): number => owners.reduce(
    (total, owner) => total + disposables_count_for_owner(owner),
    0,
  );

  while (pendingCount() > 0 && passes < passLimit) {
    passes += 1;
    for (const owner of owners) {
      callbacks += disposables_count_for_owner(owner);
      disposables_off_for_owner(owner);
    }
  }

  const bounded = pendingCount() > 0;
  if (bounded) {
    for (const owner of owners) OWNER_DISPOSABLE_REG.delete(owner);
    console.warn(
      `[LiveTree.lifecycle] terminal disposable drain exceeded ${passLimit} passes; remaining callbacks were discarded`,
    );
  }

  return { passes, callbacks, bounded };
}
