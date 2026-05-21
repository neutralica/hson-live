// lifecycle-registry.ts

const OWNER_DISPOSABLE_REG = new Map<string, Set<() => void>>();

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