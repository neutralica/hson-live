import type { PARTS_FACADE_RESERVED } from "../internal/parts-facade.js";
import type { LibraryCertainNames, LibraryLiteralDefinitions, LibraryRefinedValue } from "./library-evidence.types.js";
import type { HsonAuthored } from "../api/transform/transform.types.js";
import type { Primitive } from "../core/types.js";
import type { LivePath, LiveMapPathValue, LiveMapPartCollection, LiveMapDocumentPart, LiveMapLibraryPathHandle, LiveMapStagedDataPath,
  LiveMapPartInputCheck, LiveMapPartMembersCheck, LiveMapObjectValue, LiveMapObjectShape, LiveMapObjectKey, LiveMapObjectSetValue,
  LiveMapObjectBranch, LiveMapArrayBranch, LiveMapScalarBranch } from "./livemap.types.js";
import type { LocusDataLocation, ReadDataLocation } from "./governor.types.js";

type Members<D> = D extends { parts: infer P } ? LibraryLiteralDefinitions<P> : {};
type Reserved = typeof PARTS_FACADE_RESERVED[number] | keyof Object;

type Authoring = Readonly<{
  /** Author a detached, receiver-relative invocation. Plain keys use the current receiving root declarations to encode Data/Document strings;
   * local:data="%{name}" and local:doc="%{name}" establish local #{} bindings. Admission validates selectors and usage. Ordinary fields retain scalar transport. */
  write: {
    (): HsonAuthored;
    <const Args extends Readonly<Record<string, Primitive>>>(
      args: Args & (Extract<keyof Args, `${string}:${string}`> extends never ? unknown : never)
    ): HsonAuthored;
  };
}>;

type Context = "local" | "locus" | "read" | "stage";
type Location<C, V, N extends string, R> = C extends "local" ? LiveMapLibraryPathHandle<V, N>
  : C extends "locus" ? LocusDataLocation<V> : C extends "stage" ? LiveMapStagedDataPath<V, R> : ReadDataLocation<V>;

type Refinement = "present" | "asObject" | "asArray" | "asScalar";
type Refined<V, K> = K extends "present" ? Exclude<V, undefined> : K extends "asObject" ? LiveMapObjectBranch<V>
  : K extends "asArray" ? LiveMapArrayBranch<V> : LiveMapScalarBranch<V>;
type AtValue<Read, P extends LivePath, Child extends LivePath> = P extends readonly []
  ? Child extends readonly [string] ? LiveMapDocumentPart | undefined : LiveMapPathValue<Read, Child>
  : LiveMapPathValue<Read, Child>;

/** Shared selector signature: ordinary locations keep their existing value projection. */
export type DataLocationAt<C, V, Read, N extends string = string, R = void, P extends LivePath | undefined = undefined> =
  <const Child extends LivePath>(path: Child & ([LiveMapPathValue<V, Child>] extends [never] ? never : unknown) & (P extends LivePath ? PublicPartPath<[...P, ...Child]> : unknown)) =>
    P extends LivePath
      ? GovernedLocation<Location<C, AtValue<Read, P, Child>, N, R>, C, [...P, ...Child], AtValue<Read, P, Child>, N, R>
      : Location<C, LiveMapPathValue<Read, Child>, N, R>;

type CssField = "css" | "stylesheet";
/** Coordinates, never value shape, establish the protected field boundary. */
type PublicPartPath<P extends LivePath> = P extends readonly [unknown, infer Field, ...unknown[]]
  ? Extract<Field, CssField> extends never ? unknown : never : unknown;
type Result<F> = F extends (...args: never[]) => infer T ? T : never;
type Proposal<P extends LivePath> = P extends readonly [] ? LiveMapPartCollection : LiveMapDocumentPart;
type CompleteCss<T> = Extract<keyof T, CssField> extends never ? unknown
  : T extends { kind: "document"; document: string } ? unknown : never;
type Check<P extends LivePath, T> = P extends readonly [] ? LiveMapPartMembersCheck<T> : CompleteCss<T> & LiveMapPartInputCheck<T>;
type MemberPatch = Partial<Omit<LiveMapDocumentPart, CssField>> & { css?: never; stylesheet?: never };
type Write<L, K extends keyof L, P extends LivePath> =
  <const T extends Proposal<P> | (K extends "set" ? P extends readonly [string] ? MemberPatch : never : never)>(
    value: T & Check<P, NoInfer<T>>) => Result<L[K]>;
type KeyCheck<K> = Extract<K, CssField> extends never ? unknown : never;
type MemberObject<O, V> = {
  readonly [K in keyof O]:
    K extends "getKey" ? <const Key extends string>(key: Key & KeyCheck<Key>) => LiveMapObjectValue<V, Key>
    : K extends "setKey" ? <const Key extends LiveMapObjectKey<V>>(
        key: Key & KeyCheck<Key>, value: NoInfer<LiveMapObjectSetValue<V, Key>>) => Result<O[K]>
    : K extends "pick" ? <const Keys extends readonly string[]>(keys: Keys & KeyCheck<Keys[number]>) =>
        Pick<LiveMapObjectShape<V>, Extract<Keys[number], keyof LiveMapObjectShape<V>>>
    : K extends "omit" ? <const Keys extends readonly string[]>(keys: Keys & KeyCheck<Keys[number]>) =>
        Omit<LiveMapObjectShape<V>, Extract<Keys[number], keyof LiveMapObjectShape<V>>>
    : K extends "setMany" ? <const T extends MemberPatch>(
        value: T & LiveMapPartInputCheck<NoInfer<T>> & KeyCheck<keyof T>) => Result<O[K]>
    : K extends "hasKey" | "deleteKey" | "renameKey" | "deleteMany"
      ? O[K] extends (...args: infer A) => unknown ? <const Args extends A>(...args: Args & KeyCheck<
        K extends "deleteMany" ? Args[0] extends readonly unknown[] ? Args[0][number] : never
        : K extends "renameKey" ? Args[number] : Args[0]>) => Result<O[K]> : O[K]
      : O[K];
};
type ObjectBoundary<O, P extends LivePath, V> = P extends readonly [] ? {
  readonly [K in keyof O]: K extends "setKey" ? <const T extends LiveMapDocumentPart>(
    key: string, value: T & LiveMapPartInputCheck<NoInfer<T>>) => Result<O[K]>
  : K extends "setMany" ? <const T extends LiveMapPartCollection>(
    value: T & LiveMapPartMembersCheck<NoInfer<T>>) => Result<O[K]> : O[K];
} : MemberObject<O, V>;

/** Parts retain their coordinate evidence through every refinement and empty path. */
type GovernedLocation<L, C, P extends LivePath, V, N extends string, R, Read = V> =
  L extends undefined ? L : P extends readonly [] | readonly [string]
    ? { readonly [K in keyof L]: K extends "at" ? DataLocationAt<C, V, Read, N, R, P>
      : K extends Refinement ? L[K] extends () => infer Next
        ? () => GovernedLocation<Next, C, P, Refined<V, K>, N, R, LibraryRefinedValue<Read, Refined<V, K>>> : L[K]
      : K extends "set" | "replace" ? Write<L, K, P>
      : K extends "update" ? <const T extends Proposal<P> | (P extends readonly [string] ? MemberPatch : never)>(
          updater: (value: Read) => T & Check<P, NoInfer<T>>) => Result<L[K]>
      : K extends "object" ? ObjectBoundary<L[K], P, V> : L[K];
    } & (P extends readonly [string] ? C extends "stage" ? {} : [V] extends [never] ? {} : Authoring : {})
    : L;

/** Names are construction evidence; retained coordinate reads still permit absence. */
export type PartsLibrary<D, H, L, C extends Context = "local", N extends string = string, R = void> =
  Omit<GovernedLocation<H, C, [], LiveMapPartCollection, N, R>, "snap"> & (H extends { snap: unknown } ? {
    readonly snap: {
      (): LiveMapPartCollection;
      <const Child extends LivePath>(path: Child & PublicPartPath<Child>): LiveMapPathValue<LiveMapPartCollection, Child>;
    };
  } : {}) & {
  readonly [K in Exclude<LibraryCertainNames<Members<D>>, Reserved | keyof H>]: GovernedLocation<L, C, [K], LiveMapDocumentPart | undefined, N, R>;
} & {
  readonly [K in Exclude<Extract<keyof Members<D>, string>, LibraryCertainNames<Members<D>> | Reserved | keyof H>]?: GovernedLocation<L, C, [K], LiveMapDocumentPart | undefined, N, R>;
};
