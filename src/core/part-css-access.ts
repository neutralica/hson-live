/** Public boundary only: canonical composition reads remain unrestricted.
 * Call only after authenticating the Parts family, with absolute member coordinates.
 */
export function assert_part_public_path(path: readonly (string | number)[]): void {
  if (path.length >= 2 && (path[1] === "css" || path[1] === "stylesheet")) {
    throw new TypeError("Part CSS fields require complete definition authoring; field access is unavailable.");
  }
}

/** Whole-definition enumeration is permitted; explicitly selected CSS fields are not. */
export function assert_part_object_access(path: readonly (string | number)[], method: string, args: readonly unknown[]): void {
  assert_part_public_path(path);
  if (path.length !== 1) return;
  const keys = method === "setMany" && typeof args[0] === "object" && args[0] !== null ? Reflect.ownKeys(args[0])
    : ["pick", "omit", "deleteMany"].includes(method) && Array.isArray(args[0]) ? args[0]
    : method === "renameKey" ? args.slice(0, 2)
    : ["getKey", "hasKey", "setKey", "deleteKey"].includes(method) ? args.slice(0, 1) : [];
  for (const key of keys) if (typeof key === "string") assert_part_public_path([...path, key]);
}
