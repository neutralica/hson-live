import type { JsonValue } from "../core/types.js";
import type { LiveMapDocumentLibrary, LibraryArrayRead, LibraryObjectRead, AuthorityDocumentLocation } from "../types/livemap.types.js";
import type { ReadDataLocation } from "../types/governor.types.js";
/** Structural read boundary also accepts a checked handle without its narrower write proposals. */
export interface DataLocationObservations {
  readonly rev: number;
  path(): import("../types/livemap.types.js").LivePath;
  snap(): JsonValue | undefined;
  data(): import("../api/transform/transform.types.js").HsonData | undefined;
  kind(): import("../types/livemap.types.js").LiveMapPathKind;
  watch(listener: (value: JsonValue | undefined) => void): () => void;
  at(path: import("../types/livemap.types.js").LivePath): DataLocationObservations;
  present(): DataLocationObservations | undefined;
  asArray(): (DataLocationObservations & { readonly array: LibraryArrayRead<JsonValue> }) | undefined;
  asObject(): (DataLocationObservations & { readonly object: LibraryObjectRead<JsonValue> }) | undefined;
  asScalar(): DataLocationObservations | undefined;
}

const ARRAY_READS = ["toArray", "slice", "take", "drop", "takeLast", "dropLast", "map", "length", "isEmpty", "at", "first", "last", "includes", "indexOf"] as const satisfies readonly (keyof LibraryArrayRead<JsonValue>)[];
const OBJECT_READS = ["toObject", "pick", "omit", "hasKey", "getKey", "keys", "isEmpty", "size", "values", "entries"] as const satisfies readonly (keyof LibraryObjectRead<JsonValue>)[];

function observations<T extends object, TName extends keyof T>(api: T, names: readonly TName[]): Readonly<Pick<T, TName>> {
  // Only explicitly admitted observations cross the read-only authority boundary.
  return Object.freeze(Object.fromEntries(names.map(name => [name, api[name]]))) as Readonly<Pick<T, TName>>;
}
/** Share the existing canonical read implementations, never their mutation methods. */
export function collection_observations(raw: DataLocationObservations): Readonly<{
  array?: LibraryArrayRead<JsonValue>; object?: LibraryObjectRead<JsonValue>;
}> {
  const array = raw.asArray()?.array, object = raw.asObject()?.object;
  return Object.freeze({
    ...(array === undefined ? {} : { array: observations(array, ARRAY_READS) }),
    ...(object === undefined ? {} : { object: observations(object, OBJECT_READS) }),
  });
}

export function read_data_location(raw: DataLocationObservations): ReadDataLocation {
  return Object.freeze({
    get rev() { return raw.rev; }, path: () => raw.path(), snap: () => raw.snap(), data: () => raw.data(),
    watch: raw.watch.bind(raw), kind: () => raw.kind(),
    at: (path: Parameters<typeof raw.at>[0]) => read_data_location(raw.at(path)),
    present: () => { const checked = raw.present(); return checked === undefined ? undefined : read_data_location(checked); },
    asArray: () => { const checked = raw.asArray(); return checked === undefined ? undefined : read_data_location(checked); },
    asObject: () => { const checked = raw.asObject(); return checked === undefined ? undefined : read_data_location(checked); },
    asScalar: () => { const checked = raw.asScalar(); return checked === undefined ? undefined : read_data_location(checked); },
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
