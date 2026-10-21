import type { PARTS_FACADE_RESERVED } from "../internal/parts-facade.js";
import type { LibraryCertainNames, LibraryLiteralDefinitions, LibraryRefinedValue } from "./library-evidence.types.js";
import type { HsonAuthored } from "../api/transform/transform.types.js";
import type { Primitive } from "../core/types.js";
import type { LivePath, LiveMapPathValue, LiveMapPartCollection, LiveMapDocumentPart, LiveMapLibraryPathHandle, LiveMapStagedDataPath,
  LiveMapObjectBranch, LiveMapArrayBranch, LiveMapScalarBranch } from "./livemap.types.js";
import type { LocusDataLocation, ReadDataLocation } from "./governor.types.js";

type Members<D> = D extends { parts: infer P } ? LibraryLiteralDefinitions<P> : {};
type Reserved = typeof PARTS_FACADE_RESERVED[number] | keyof Object;

type Authoring = Readonly<{
  /** Author a detached, receiver-relative invocation; admission validates parameter usage. */
  write: {
    (): HsonAuthored;
    (args: Readonly<Record<string, Primitive>>): HsonAuthored;
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
  <const Child extends LivePath>(path: Child & ([LiveMapPathValue<V, Child>] extends [never] ? never : unknown)) =>
    P extends LivePath
      ? GovernedLocation<Location<C, AtValue<Read, P, Child>, N, R>, C, [...P, ...Child], AtValue<Read, P, Child>, N, R>
      : Location<C, LiveMapPathValue<Read, Child>, N, R>;

/** Keep coordinate category and value/read evidence separate through relative navigation and checks. */
type GovernedLocation<L, C, P extends LivePath, V, N extends string, R, Read = V> =
  L extends undefined ? L : C extends "stage" ? L : P extends readonly [] | readonly [string]
    ? Omit<L, "at" | Refinement> & Readonly<{
      // One generic signature keeps unioned Echo reads callable at every path depth.
      at: DataLocationAt<C, V, Read, N, R, P>;
    }> & {
      readonly [K in Extract<keyof L, Refinement>]: L[K] extends () => infer Next
        ? () => GovernedLocation<Next, C, P, Refined<V, K>, N, R, LibraryRefinedValue<Read, Refined<V, K>>> : L[K];
    } & (P extends readonly [string] ? [V] extends [never] ? {} : Authoring : {})
    : L;

/** Names are construction evidence; retained coordinate reads still permit absence. */
export type PartsLibrary<D, H, L, C extends Context = "local", N extends string = string, R = void> =
  GovernedLocation<H, C, [], LiveMapPartCollection, N, R> & {
  readonly [K in Exclude<LibraryCertainNames<Members<D>>, Reserved | keyof H>]: GovernedLocation<L, C, [K], LiveMapDocumentPart | undefined, N, R>;
} & {
  readonly [K in Exclude<Extract<keyof Members<D>, string>, LibraryCertainNames<Members<D>> | Reserved | keyof H>]?: GovernedLocation<L, C, [K], LiveMapDocumentPart | undefined, N, R>;
};
