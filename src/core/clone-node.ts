// clone-node.ts

export function clone_node<T>(node: T): T {
  if (typeof (globalThis as any).structuredClone === "function") {
    return (globalThis as any).structuredClone(node);
  }
  // Compatibility fallback for canonical HSON/document cloning. Generic
  // projected values use the ordered admission/materialization leaves instead.
  return JSON.parse(JSON.stringify(node)) as T;
}
