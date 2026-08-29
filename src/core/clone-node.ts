// clone-node.ts

export function clone_node<T>(node: T): T {
  if (typeof (globalThis as any).structuredClone === "function") {
    return (globalThis as any).structuredClone(node);
  }
  // Compatibility fallback for canonical Hson/document cloning. Generic
  // data values use the ordered admission/materialization leaves instead.
  return JSON.parse(JSON.stringify(node)) as T;
}
