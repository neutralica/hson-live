import type { HsonNode } from "../../../core/types.js";

/** Fresh owner storage from already captured/qualified private source material.
 * No memoization: sharing in a structural value is not runtime subject identity.
 * This is not admission, observation copying, or an existing-subject handoff. */
export function materialize_owned_occurrences<T>(source: T): T {
  const result: { value?: T } = {};
  type Job = { source: unknown; target: object; key: PropertyKey };
  const jobs: Job[] = [{ source, target: result, key: "value" }];
  const add = (job: Job): void => {
    Object.defineProperty(jobs, jobs.length, { value: job, enumerable: true, configurable: true, writable: true });
  };
  while (jobs.length) {
    const job = jobs.pop()!;
    const value = job.source;
    if (value === null || typeof value !== "object") {
      Object.defineProperty(job.target, job.key, { value, enumerable: true, configurable: true, writable: true });
      continue;
    }
    const array = Array.isArray(value);
    const copy: object = array ? [] : Object.create(Object.getPrototypeOf(value));
    Object.defineProperty(job.target, job.key, { value: copy, enumerable: true, configurable: true, writable: true });
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]!;
      if (array && key === "length") continue;
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key)!;
      if (!Object.hasOwn(descriptor, "value")) throw new Error("Fresh owner material must already have exact data storage.");
      add({ source: descriptor.value, target: copy, key });
    }
    if (array) Object.defineProperty(copy, "length", { value: descriptors.length!.value });
  }
  return result.value!;
}

/** Node-specific name keeps fresh ownership explicit at graph call sites. */
export function materialize_owned_graph(source: HsonNode): HsonNode {
  return materialize_owned_occurrences(source);
}
