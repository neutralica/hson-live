import { clone_node } from "../../core/clone-node.js";

/** Own plain semantic operation storage before sharing it with any recipient. */
export function own_commit_description<T>(description: T): T {
  const owned = clone_node(description);
  const pending: unknown[] = [owned];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== "object" || value === null || seen.has(value)) continue;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const child: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
      // Do not hand captured publication storage to an inherited index setter.
      Object.defineProperty(pending, pending.length, {
        value: child, enumerable: true, writable: true, configurable: true,
      });
    }
    Object.freeze(value);
  }
  return owned;
}
