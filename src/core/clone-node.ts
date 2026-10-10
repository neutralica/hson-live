// clone-node.ts

export function clone_node<T>(node: T): T {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(node);
  // This fallback copies the plain, data-property storage used by these
  // callers. It confers no graph admission, identity, or provenance authority.
  const result: { value?: T } = {};
  type Job = { kind: "copy"; source: unknown; target: object; key: string }
    | { kind: "leave"; source: object };
  const jobs: Job[] = [{ kind: "copy", source: node, target: result, key: "value" }];
  const active = new WeakSet<object>();
  const copies = new WeakMap<object, object>();
  const put = (target: object, key: string, value: unknown): void => {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  };
  const add = (job: Job): void => { put(jobs, String(jobs.length), job); };
  while (jobs.length > 0) {
    const job = jobs.pop()!;
    if (job.kind === "leave") { active.delete(job.source); continue; }
    const source = job.source;
    if (source === null || source === undefined || typeof source === "string" || typeof source === "boolean"
      || (typeof source === "number" && Number.isFinite(source))) {
      put(job.target, job.key, source);
      continue;
    }
    if (typeof source !== "object") throw new Error("Clone source contains unsupported storage.");
    if (active.has(source)) throw new Error("Clone source contains a cycle.");
    const previous = copies.get(source);
    if (previous !== undefined) { put(job.target, job.key, previous); continue; }
    const array = Array.isArray(source);
    const prototype = Object.getPrototypeOf(source);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new Error("Clone source must use plain storage.");
    // Like structuredClone, plain records become ordinary mutable records;
    // prototype/descriptor flags are not canonical graph value semantics.
    const copy: object = array ? [] : {};
    copies.set(source, copy);
    active.add(source);
    put(job.target, job.key, copy);
    add({ kind: "leave", source });
    const keys = Reflect.ownKeys(source);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!;
      if (typeof key !== "string") throw new Error("Clone source contains a symbol field.");
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor === undefined || !("value" in descriptor)
        || (!descriptor.enumerable && !(array && key === "length"))) throw new Error("Clone source must use enumerable data fields.");
      if (array && key === "length") Object.defineProperty(copy, key, { value: descriptor.value });
      else add({ kind: "copy", source: descriptor.value, target: copy, key });
    }
  }
  return result.value!;
}
