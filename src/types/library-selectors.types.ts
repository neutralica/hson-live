import type { JsonValue } from "../core/types.js";
import type { HsonSchema } from "../api/transform/transform.types.js";
import type { DataSchemaValue, DocumentSchemaGraph } from "../internal/hson-schema/schema-evidence.types.js";
import type { LibraryCertainNames, LibraryDefinitionEvidence, LibraryLiteralDefinitions } from "./library-evidence.types.js";
import type { LiveMapDataLibrary, LiveMapDocumentLibrary, LiveMapPartCollection,
  LiveMapStagedDataLibrary, LiveMapStagedDocumentLibrary } from "./livemap.types.js";
import type { LocusDataLibrary, LocusDocumentLibrary, ReadDataLibrary, ReadDocumentLibrary,
  EchoProjectedDataLibrary, EchoLocalDataLibrary, EchoProjectedDocumentLibrary, EchoLocalDocumentLibrary } from "./governor.types.js";

export type LibraryFamily = "doc" | "data" | "parts";
export type LibrarySelectorContext = "local" | "locus" | "read" | "stage" | "echo";

type DataValue<V> = unknown extends V ? JsonValue : V;

type Handle<C extends LibrarySelectorContext, F extends LibraryFamily, V, S extends HsonSchema, N extends string, R> =
  C extends "local" ? F extends "doc" ? LiveMapDocumentLibrary<V, N, S>
    : F extends "parts" ? Omit<LiveMapDataLibrary<DataValue<V>, N, S>, "schema"> & { readonly schema: { readonly get: () => HsonSchema<unknown, "data"> } }
      : LiveMapDataLibrary<DataValue<V>, N, S>
  : C extends "locus" ? F extends "doc" ? LocusDocumentLibrary<V, S> : LocusDataLibrary<DataValue<V>, S>
  : C extends "read" ? F extends "doc" ? ReadDocumentLibrary<V, S> : ReadDataLibrary<DataValue<V>, S>
  : C extends "stage" ? F extends "doc" ? LiveMapStagedDocumentLibrary<V, R> : LiveMapStagedDataLibrary<DataValue<V>, R>
  : F extends "doc" ? EchoProjectedDocumentLibrary<V, S> | EchoLocalDocumentLibrary<V, S>
    : EchoProjectedDataLibrary<DataValue<V>, S> | (F extends "parts"
      ? Omit<EchoLocalDataLibrary<DataValue<V>, S>, "schema"> & { readonly schema: { readonly get: () => HsonSchema<unknown, "data"> } }
      : EchoLocalDataLibrary<DataValue<V>, S>);

type FamilyEvidence<T, F extends LibraryFamily> = Extract<LibraryDefinitionEvidence<T>, { family: F extends "doc" ? "document" : F }>;
type FromEvidence<E, C extends LibrarySelectorContext, F extends LibraryFamily, N extends string, R> =
  E extends { value: infer V; schema: infer S extends HsonSchema } ? Handle<C, F, V, S, N, R> : never;
type DynamicSchema<H, C, F> = C extends "local" ? F extends "parts" ? H
  : H extends { schema: { get: infer G } } ? Omit<H, "schema"> & { readonly schema: { readonly get: G; readonly use: (schema: HsonSchema) => import("./livemap.types.js").LiveMapCommit } } : H
  : H;
type Broad<C extends LibrarySelectorContext, F extends LibraryFamily, N extends string, R> =
  DynamicSchema<Handle<C, F, F extends "doc" ? unknown : F extends "parts" ? LiveMapPartCollection : JsonValue,
    HsonSchema<unknown, F extends "doc" ? "document" : "data">, N, R>, C, F>;
type Selected<D, C extends LibrarySelectorContext, F extends LibraryFamily, N extends string, R> =
  N extends LibraryCertainNames<D> & keyof LibraryLiteralDefinitions<D>
    ? [FamilyEvidence<D[N], F>] extends [never] ? Broad<C, F, N, R> : FromEvidence<FamilyEvidence<D[N], F>, C, F, N, R>
    : Broad<C, F, N, R>;
// Distribute over possible absence: Schema | undefined cannot create unconditional evidence.
type Checked<D, C extends LibrarySelectorContext, F extends LibraryFamily, N extends string, S, R> =
  S extends HsonSchema ? Handle<C, F, F extends "doc" ? DocumentSchemaGraph<S> : F extends "parts" ? LiveMapPartCollection : DataSchemaValue<S>, S, N, R>
    : Selected<D, C, F, N, R>;

type Reserved = keyof Function | keyof Object | "must" | "then" | "toJSON" | "__proto__" | "prototype" | "arguments" | "caller"
  | "__defineGetter__" | "__defineSetter__" | "__lookupGetter__" | "__lookupSetter__";
type Names<D, F extends LibraryFamily> = Extract<{
  [N in keyof LibraryLiteralDefinitions<D>]: [FamilyEvidence<D[N], F>] extends [never] ? never : N;
}[keyof LibraryLiteralDefinitions<D>], string>;

/** Callable lookup is optional; required calls also recover dynamically admitted names. */
export type LibraryFamilySelector<D, C extends LibrarySelectorContext, F extends LibraryFamily, R = void> = {
  <const N extends Names<D, F>>(name: N): Selected<D, C, F, N, R> | undefined;
  <const N extends Names<D, F>, S extends HsonSchema | undefined>(name: N, schema: S): Checked<D, C, F, N, S, R> | undefined;
  (name: string): Broad<C, F, string, R> | undefined;
  <S extends HsonSchema | undefined>(name: string, schema: S): Checked<{}, C, F, string, S, R> | undefined;
  readonly must: {
    <const N extends Names<D, F>>(name: N): Selected<D, C, F, N, R>;
    <const N extends Names<D, F>, S extends HsonSchema | undefined>(name: N, schema: S): Checked<D, C, F, N, S, R>;
    (name: string): Broad<C, F, string, R>;
    <S extends HsonSchema | undefined>(name: string, schema: S): Checked<{}, C, F, string, S, R>;
  };
} & {
  readonly [N in Exclude<Extract<Names<D, F>, LibraryCertainNames<D>>, Reserved>]: Selected<D, C, F, N, R>;
} & {
  readonly [N in Exclude<Names<D, F>, LibraryCertainNames<D> | Reserved>]?: Selected<D, C, F, N, R>;
};

export type LibraryFamilyNamespaces<D, C extends LibrarySelectorContext, R = void> = {
  readonly [F in LibraryFamily]: LibraryFamilySelector<D, C, F, R>;
};
