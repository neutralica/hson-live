import type { JsonValue } from "../core/types.js";
import type { LiveMapLibraryPathHandle, LiveMapDocumentLibrary, LibraryArrayRead, LibraryObjectRead, AuthorityDocumentLocation } from "../types/livemap.types.js";
import type { ReadDataLocation } from "../types/governor.types.js";
const ARRAY_READS = ["toArray", "slice", "take", "drop", "takeLast", "dropLast", "map", "length", "isEmpty", "at", "first", "last", "includes", "indexOf"] as const satisfies readonly (keyof LibraryArrayRead<JsonValue>)[];
const OBJECT_READS = ["toObject", "pick", "omit", "hasKey", "getKey", "keys", "isEmpty", "size", "values", "entries"] as const satisfies readonly (keyof LibraryObjectRead<JsonValue>)[];

function observations<T extends object, TName extends keyof T>(api: T, names: readonly TName[]): Readonly<Pick<T, TName>> {
  // Only explicitly admitted observations cross the read-only authority boundary.
  return Object.freeze(Object.fromEntries(names.map(name => [name, api[name]]))) as Readonly<Pick<T, TName>>;
}
/** Share the existing canonical read implementations, never their mutation methods. */
export function collection_observations(raw: LiveMapLibraryPathHandle): Readonly<{
  array?: LibraryArrayRead<JsonValue>; object?: LibraryObjectRead<JsonValue>;
}> {
  const array = raw.asArray()?.array, object = raw.asObject()?.object;
  return Object.freeze({
    ...(array === undefined ? {} : { array: observations(array, ARRAY_READS) }),
    ...(object === undefined ? {} : { object: observations(object, OBJECT_READS) }),
  });
}

export function read_data_location(raw: LiveMapLibraryPathHandle): ReadDataLocation {
  return Object.freeze({
    get rev() { return raw.rev; }, path: () => raw.path(), snap: () => raw.snap(), data: () => raw.data(),
    watch: raw.watch.bind(raw), kind: () => raw.kind(),
    at: (path: Parameters<typeof raw.at>[0]) => read_data_location(raw.at(path)),
    present: () => raw.present() === undefined ? undefined : read_data_location(raw),
    asArray: () => raw.asArray() === undefined ? undefined : read_data_location(raw),
    asObject: () => raw.asObject() === undefined ? undefined : read_data_location(raw),
    asScalar: () => raw.asScalar() === undefined ? undefined : read_data_location(raw),
    ...collection_observations(raw),
  }) as unknown as ReadDataLocation;
}

export function read_document_location(raw: ReturnType<LiveMapDocumentLibrary["at"]>): NonNullable<ReturnType<AuthorityDocumentLocation<unknown, never>["asElement"]>> {
  const element = () => {
    const value = raw.asElement();
    if (value === undefined) throw new Error("Document location is not an element.");
    return value;
  };
  return Object.freeze({
    get rev() { return raw.rev; }, path: () => raw.path(), snap: () => raw.snap(),
    watch: raw.watch.bind(raw), kind: () => raw.kind(),
    at: (path: readonly number[]) => read_document_location(raw.at(path)),
    id: (id: string) => { const found = raw.id(id); return found === undefined ? undefined : read_document_location(found); },
    present: () => raw.present() === undefined ? undefined : read_document_location(raw),
    asElement: () => raw.asElement() === undefined ? undefined : read_document_location(raw),
    asRoot: () => raw.asRoot() === undefined ? undefined : read_document_location(raw),
    asText: () => raw.asText() === undefined ? undefined : read_document_location(raw),
    attrs: Object.freeze({
      get: (name: string) => element().attrs.get(name),
      has: (name: string) => element().attrs.has(name),
      keys: () => element().attrs.keys(),
      must: Object.freeze({ get: (name: string) => element().attrs.must.get(name) }),
    }),
    flags: Object.freeze({ has: (name: string) => element().flags.has(name) }),
  }) as unknown as NonNullable<ReturnType<AuthorityDocumentLocation<unknown, never>["asElement"]>>;
}
