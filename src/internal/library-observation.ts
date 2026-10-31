import { required_reads } from "./required-reads.js";
import { forward_part_write } from "./part-write.js";
import type { JsonValue } from "../core/types.js";
import type { LiveMapDocumentLibrary, LibraryArrayRead, LibraryObjectRead, AuthorityDocumentLocation } from "../types/livemap.types.js";
import type { ReadDataLocation } from "../types/governor.types.js";
/** Structural read boundary also accepts a checked handle without its narrower write proposals. */
export interface DataLocationObservations {
  readonly rev: number;
  path(): import("../types/livemap.types.js").LivePath;
  snap(): JsonValue | undefined;
  readonly must: import("../types/livemap.types.js").RequiredReads<JsonValue | undefined, import("../api/transform/transform.types.js").HsonData>;
  hson(): import("../api/transform/transform.types.js").HsonData | undefined;
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

/** Live reads recheck lifetime after caller callbacks/conversion; returned data stays detached. */
export function live_observation(assertReadable: () => void) {
  return <TArgs extends unknown[], TResult>(read: (...args: TArgs) => TResult) => (...args: TArgs): TResult => {
    assertReadable();
    const result = read(...args);
    assertReadable();
    return result;
  };
}

/** Suppress revoked deliveries, but leave listener errors and cleanup to the publisher. */
export function live_subscription<TArgs extends unknown[]>(
  subscribe: (listener: (...args: TArgs) => void) => () => void,
  assertCurrent: () => void,
): (listener: (...args: TArgs) => void) => () => void {
  return listener => {
    assertCurrent();
    if (typeof listener !== "function") return subscribe(listener);
    return subscribe((...args) => {
      try { assertCurrent(); } catch { return; }
      listener(...args);
    });
  };
}

function observations<T extends object, TName extends keyof T>(api: T, names: readonly TName[], assertReadable: () => void): Readonly<Pick<T, TName>> {
  // Only explicitly admitted observations cross the read-only authority boundary.
  const observe = live_observation(assertReadable);
  return Object.freeze(Object.fromEntries(names.map(name => {
    const method = api[name];
    if (typeof method !== "function") throw new TypeError("Library observation must be callable.");
    return [name, observe((...args: unknown[]) => Reflect.apply(method, api, args))];
  }))) as Readonly<Pick<T, TName>>;
}
/** Share the existing canonical read implementations, never their mutation methods. */
export function collection_observations(raw: DataLocationObservations, assertReadable: () => void = () => {}): Readonly<{
  array?: LibraryArrayRead<JsonValue>; object?: LibraryObjectRead<JsonValue>;
}> {
  assertReadable();
  const array = raw.asArray()?.array, object = raw.asObject()?.object;
  const assertCurrent = () => { assertReadable(); void raw.rev; };
  return Object.freeze({
    ...(array === undefined ? {} : { array: observations(array, ARRAY_READS, assertCurrent) }),
    ...(object === undefined ? {} : { object: observations(object, OBJECT_READS, assertCurrent) }),
  });
}

export function read_data_location(raw: DataLocationObservations, assertReadable: () => void = () => {}): ReadDataLocation {
  assertReadable();
  const observe = live_observation(assertReadable);
  const snap = observe(() => raw.snap());
  const hson = observe(() => raw.hson());
  const facade = {
    get rev() { assertReadable(); return raw.rev; }, path: observe(() => raw.path()), snap, hson, must: required_reads(snap, hson),
    watch: live_subscription(raw.watch.bind(raw), () => { assertReadable(); void raw.rev; }), kind: observe(() => raw.kind()),
    at: observe((path: Parameters<typeof raw.at>[0]) => read_data_location(raw.at(path), assertReadable)),
    present: observe(() => { const checked = raw.present(); return checked === undefined ? undefined : read_data_location(checked, assertReadable); }),
    asArray: observe(() => { const checked = raw.asArray(); return checked === undefined ? undefined : read_data_location(checked, assertReadable); }),
    asObject: observe(() => { const checked = raw.asObject(); return checked === undefined ? undefined : read_data_location(checked, assertReadable); }),
    asScalar: observe(() => { const checked = raw.asScalar(); return checked === undefined ? undefined : read_data_location(checked, assertReadable); }),
    ...collection_observations(raw, assertReadable),
  };
  return Object.freeze(forward_part_write(facade, raw, assertReadable)) as unknown as ReadDataLocation;
}

export function read_document_location(raw: ReturnType<LiveMapDocumentLibrary["at"]>, assertReadable: () => void = () => {}): NonNullable<ReturnType<AuthorityDocumentLocation<unknown, never>["asElement"]>> {
  assertReadable();
  const observe = live_observation(assertReadable);
  const element = () => {
    const value = raw.asElement();
    if (value === undefined) throw new Error("Document location is not an element.");
    return value;
  };
  const snap = observe(() => raw.snap());
  const hson = observe(() => raw.hson());
  return Object.freeze({
    get rev() { assertReadable(); return raw.rev; }, path: observe(() => raw.path()), snap, hson, must: required_reads(snap, hson),
    watch: live_subscription(raw.watch.bind(raw), () => { assertReadable(); void raw.rev; }), kind: observe(() => raw.kind()),
    at: observe((path: readonly number[]) => read_document_location(raw.at(path), assertReadable)),
    id: observe((id: string) => { const found = raw.id(id); return found === undefined ? undefined : read_document_location(found, assertReadable); }),
    present: observe(() => { const checked = raw.present(); return checked === undefined ? undefined : read_document_location(checked, assertReadable); }),
    asElement: observe(() => { const checked = raw.asElement(); return checked === undefined ? undefined : read_document_location(checked, assertReadable); }),
    asRoot: observe(() => { const checked = raw.asRoot(); return checked === undefined ? undefined : read_document_location(checked, assertReadable); }),
    asText: observe(() => { const checked = raw.asText(); return checked === undefined ? undefined : read_document_location(checked, assertReadable); }),
    attrs: Object.freeze({
      get: observe((name: string) => element().attrs.get(name)),
      has: observe((name: string) => element().attrs.has(name)),
      keys: observe(() => element().attrs.keys()),
      must: Object.freeze({ get: observe((name: string) => element().attrs.must.get(name)) }),
    }),
    flags: Object.freeze({ has: observe((name: string) => element().flags.has(name)) }),
  }) as unknown as NonNullable<ReturnType<AuthorityDocumentLocation<unknown, never>["asElement"]>>;
}
