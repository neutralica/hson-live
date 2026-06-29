export function clone_node<T>(node: T): T {
  if (typeof (globalThis as any).structuredClone === "function") {
    return (globalThis as any).structuredClone(node);
  }
  return JSON.parse(JSON.stringify(node)) as T;
}
