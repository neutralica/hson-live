/** Own plain instruction storage using descriptors, never getters or structuredClone.
 * This is the existing graph-instruction capture, shared with queued authoring.
 * Semantic Data and graph content still require their domain admission. */
export function capture_plain_instruction<T>(input: T, deep = true): T {
  const holder: { value: T } = Object.create(null);
  type Job = { source: unknown; target: object; key: string } | { leave: object };
  const jobs: Job[] = [{ source: input, target: holder, key: "value" }];
  const active = new WeakSet<object>();
  const copied = new WeakMap<object, object>();
  const put = (target: object, key: string, value: unknown): void => {
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
  };
  const enqueue = (job: Job): void => {
    // Work items contain private instruction references; bypass inherited setters.
    put(jobs, String(jobs.length), job);
  };
  while (jobs.length > 0) {
    const job = jobs.pop(); if (job === undefined) break;
    if ("leave" in job) { active.delete(job.leave); Object.freeze(copied.get(job.leave)); continue; }
    const { source, target, key } = job;
    if (source === null || typeof source !== "object") {
      if (source !== null && source !== undefined && typeof source !== "string" && typeof source !== "number" && typeof source !== "boolean") {
        throw new TypeError("instruction values must be records, arrays or primitives");
      }
      put(target, key, source); continue;
    }
    if (active.has(source)) throw new TypeError("instruction contains a cycle");
    const prior = copied.get(source); if (prior !== undefined) { put(target, key, prior); continue; }
    const array = Array.isArray(source);
    const prototype = Object.getPrototypeOf(source);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new TypeError("instruction records must be plain");
    const fields = new Map<string, unknown>();
    for (const name of Reflect.ownKeys(source)) {
      if (typeof name !== "string") throw new TypeError("instruction contains a symbol field");
      const descriptor = Reflect.getOwnPropertyDescriptor(source, name);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")
        || (!(array && name === "length") && !descriptor.enumerable)) {
        throw new TypeError("instruction fields must be own enumerable data properties");
      }
      fields.set(name, descriptor.value);
    }
    if (array) {
      const length = fields.get("length");
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || fields.size !== length + 1) {
        throw new TypeError("instruction arrays must be dense and undecorated");
      }
      for (let index = 0; index < length; index++) if (!fields.has(String(index))) throw new TypeError("instruction array is sparse or decorated");
    }
    const result: object = array ? [] : Object.create(null);
    copied.set(source, result); put(target, key, result);
    active.add(source); enqueue({ leave: source });
    for (const [name, value] of fields) {
      if (array && name === "length") continue;
      if (deep) { put(result, name, undefined); enqueue({ source: value, target: result, key: name }); }
      else put(result, name, value);
    }
  }
  return holder.value;
}

/** Freeze already-owned, admitted storage without another representation copy. */
export function freeze_owned_instruction<T>(input: T): T {
  const pending: unknown[] = [input];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const value = pending.pop();
    if (value === null || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    pending.push(...Object.values(value));
    Object.freeze(value);
  }
  return input;
}

/** Capture synchronously, reject admission errors asynchronously, and retain the queue's promise timing. */
export function capture_before_submission<T>(submit: () => Promise<T>): Promise<T> {
  try { return submit(); }
  catch (cause) { return Promise.reject(cause); }
}
