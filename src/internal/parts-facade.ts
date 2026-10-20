/** Shared capability/protocol exclusions, including capabilities absent in some contexts. */
export const PARTS_FACADE_RESERVED = [
  "family", "mode", "rev", "root", "snap", "hson", "must", "at", "schema", "source", "css",
  "then", "toJSON", "constructor", "toString", "toLocaleString", "valueOf", "hasOwnProperty",
  "isPrototypeOf", "propertyIsEnumerable", "__proto__", "__defineGetter__", "__defineSetter__",
  "__lookupGetter__", "__lookupSetter__",
] as const;

const reserved: ReadonlySet<string> = new Set(PARTS_FACADE_RESERVED);

/** Named selection only: storage, locations and lifetime checks remain with the owner. @internal */
export function make_parts_facade<T extends { at(path: readonly string[]): unknown }>(
  target: T,
  exists: (name: string) => boolean,
): T {
  return new Proxy(target, {
    get(target, key, receiver) {
      // Keep actual descriptors (including frozen properties), inherited intrinsics,
      // method identity and protocol probes. Members are virtual, never own keys.
      if (typeof key !== "string" || Reflect.has(target, key) || reserved.has(key)) {
        return Reflect.get(target, key, receiver);
      }
      if (!exists(key)) throw new Error(`Unknown Part member ${JSON.stringify(key)}.`);
      return target.at([key]);
    },
  });
}
