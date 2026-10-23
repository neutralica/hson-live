import type { RequiredReads, EndpointRepresentation } from "./livemap.types.js";
import type { PartsLibrary, DataLocationAt } from "./parts-library.types.js";
import type { LibraryDefinitionEvidence, LibraryRefinedValue } from "./library-evidence.types.js";
import type { LibraryShapeCapabilities, LibraryArrayRead, LibraryObjectRead, LibraryArrayCommands, LibraryObjectCommands, LiveMapArrayBranch, LiveMapObjectBranch, LiveMapScalarBranch } from "./livemap.types.js";
import type { JsonValue, HsonNode } from "../core/types.js";
import type { HsonSchema } from "../api/transform/transform.types.js";
import type {
  LiveMapPathValue, LiveMapSetValue,
  LiveMapWriteValue, LivePath, LiveMapRootMode, LiveMapCssOp,
  LiveMapDocumentContent, LiveMapDocumentAttrs, LiveMapDocumentAttributeValue,
  LiveMapDocumentRequestTarget, LiveMapCut, LiveMapHtmlCut, LiveMapCutOptions,
  LiveMapRegistryCommitObserverApi, LiveMapDocumentLibrary, LiveMapDataLibrary,
} from "./livemap.types.js";
import type { HsonData } from "../api/transform/transform.types.js";

export type LocusDataLocation<TValue = JsonValue | undefined, TRead = TValue> = Readonly<{
  readonly rev: number;
  path: () => LivePath;
  snap: () => TRead;
  hson: () => EndpointRepresentation<TRead, HsonData>;
  readonly must: RequiredReads<TRead, HsonData>;
  at: DataLocationAt<"locus", TValue, TRead>;
  watch: (listener: (value: TRead) => void) => () => void;
  kind: () => "missing" | "object" | "array" | "scalar";
  present: () => LocusDataLocation<Exclude<TValue, undefined>, LibraryRefinedValue<TRead, Exclude<TValue, undefined>>> | undefined;
  asArray: () => LocusDataLocation<LiveMapArrayBranch<TValue>, LibraryRefinedValue<TRead, LiveMapArrayBranch<TValue>>> | undefined;
  asObject: () => LocusDataLocation<LiveMapObjectBranch<TValue>, LibraryRefinedValue<TRead, LiveMapObjectBranch<TValue>>> | undefined;
  asScalar: () => LocusDataLocation<LiveMapScalarBranch<TValue>, LibraryRefinedValue<TRead, LiveMapScalarBranch<TValue>>> | undefined;
  set: (value: LiveMapSetValue<TValue>) => Promise<void>;
  replace: (value: LiveMapWriteValue<TValue>) => Promise<void>;
  delete: () => Promise<void>;
}> & LibraryShapeCapabilities<TValue,
  LibraryArrayRead<TValue> & LibraryArrayCommands<TValue, Promise<void>>,
  LibraryObjectRead<TValue> & LibraryObjectCommands<TValue, Promise<void>>>;

export type LocusDataLibrary<TValue = JsonValue | undefined, TSchema extends HsonSchema = HsonSchema> = Readonly<{
  readonly mode: Exclude<LiveMapRootMode, "document">;
  readonly rev: number;
  root: () => HsonNode;
  snap: LiveMapDataLibrary<TValue, string, TSchema>["snap"];
  hson: LiveMapDataLibrary<TValue, string, TSchema>["hson"];
  readonly must: RequiredReads<TValue, HsonData>;
  at: <const TPath extends LivePath>(path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown)) => LocusDataLocation<LiveMapPathValue<TValue, TPath>>;
  schema: Readonly<{ get: LiveMapDataLibrary<TValue, string, TSchema>["schema"]["get"] }>;
}>;

export type LocusDocumentLocation = import("./livemap.types.js").AuthorityDocumentLocation;

export type LocusDocumentLibrary<TEvidence = HsonNode, TSchema extends HsonSchema = HsonSchema> = Readonly<{
  readonly mode: "document";
  readonly rev: number;
  root: () => HsonNode;
  render: LiveMapDocumentLibrary<TEvidence, string, TSchema>["render"];
  snap: LiveMapDocumentLibrary<TEvidence, string, TSchema>["snap"];
  hson: LiveMapDocumentLibrary<TEvidence, string, TSchema>["hson"];
  must: LiveMapDocumentLibrary<TEvidence, string, TSchema>["must"];
  watch: LiveMapDocumentLibrary<TEvidence, string, TSchema>["watch"];
  commits: LiveMapDocumentLibrary<TEvidence, string, TSchema>["commits"];
  at: import("./livemap.types.js").AuthorityDocumentSelector<TEvidence>;
  q: (name: string) => import("./livemap.types.js").AuthorityDocumentQuadLocation | undefined;
  schema: Readonly<{ get: LiveMapDocumentLibrary<TEvidence, string, TSchema>["schema"]["get"] }>;
  css: ((operation: LiveMapCssOp) => Promise<void>) & import("./document-css.types.js").DocumentCssCommands<Promise<void>>
    & import("./document-css.types.js").DocumentCssRead;
  document: Readonly<{
    root: () => HsonNode;
    content: (() => readonly LiveMapDocumentContent[]) & Readonly<{
      replace: (target: LiveMapDocumentRequestTarget, index: number, value: LiveMapDocumentContent) => Promise<void>;
      insert: (target: LiveMapDocumentRequestTarget, index: number, value: LiveMapDocumentContent) => Promise<void>;
      remove: (target: LiveMapDocumentRequestTarget, index: number) => Promise<void>;
      move: (target: LiveMapDocumentRequestTarget, from: number, to: number) => Promise<void>;
    }>;
    flags: Readonly<{
      has: LiveMapDocumentLibrary<TEvidence, string, TSchema>["document"]["flags"]["has"];
      set: (target: LiveMapDocumentRequestTarget, ...names: string[]) => Promise<void>;
      clear: (target: LiveMapDocumentRequestTarget, ...names: string[]) => Promise<void>;
    }>;
    attrs: Readonly<{
      get: LiveMapDocumentLibrary<TEvidence, string, TSchema>["document"]["attrs"]["get"];
      has: LiveMapDocumentLibrary<TEvidence, string, TSchema>["document"]["attrs"]["has"];
      keys: LiveMapDocumentLibrary<TEvidence, string, TSchema>["document"]["attrs"]["keys"];
      must: LiveMapDocumentLibrary<TEvidence, string, TSchema>["document"]["attrs"]["must"];
      setMany: (target: LiveMapDocumentRequestTarget, values: LiveMapDocumentAttrs) => Promise<void>;
      dropMany: (target: LiveMapDocumentRequestTarget, names: readonly string[]) => Promise<void>;
      clear: (target: LiveMapDocumentRequestTarget) => Promise<void>;
      set: (target: LiveMapDocumentRequestTarget, name: string, value: LiveMapDocumentAttributeValue) => Promise<void>;
      drop: (target: LiveMapDocumentRequestTarget, name: string) => Promise<void>;
      replace: (target: LiveMapDocumentRequestTarget, values: LiveMapDocumentAttrs) => Promise<void>;
    }>;
  }>;
}>;

export type LocusLibrary = LocusDataLibrary | LocusDocumentLibrary;

export type ReadDataLocation<TValue = JsonValue | undefined, TRead = TValue> = Readonly<{
  readonly rev: number;
  path: () => LivePath;
  snap: () => TRead;
  hson: () => EndpointRepresentation<TRead, HsonData>;
  readonly must: RequiredReads<TRead, HsonData>;
  watch: (listener: (value: TRead) => void) => () => void;
  kind: LocusDataLocation["kind"];
  at: DataLocationAt<"read", TValue, TRead>;
  present: () => ReadDataLocation<Exclude<TValue, undefined>, LibraryRefinedValue<TRead, Exclude<TValue, undefined>>> | undefined;
  asArray: () => ReadDataLocation<LiveMapArrayBranch<TValue>, LibraryRefinedValue<TRead, LiveMapArrayBranch<TValue>>> | undefined;
  asObject: () => ReadDataLocation<LiveMapObjectBranch<TValue>, LibraryRefinedValue<TRead, LiveMapObjectBranch<TValue>>> | undefined;
  asScalar: () => ReadDataLocation<LiveMapScalarBranch<TValue>, LibraryRefinedValue<TRead, LiveMapScalarBranch<TValue>>> | undefined;
}> & LibraryShapeCapabilities<TValue, LibraryArrayRead<TValue>, LibraryObjectRead<TValue>>;
export type ReadDataLibrary<TValue = JsonValue | undefined, TSchema extends HsonSchema = HsonSchema> =
  Pick<LocusDataLibrary<TValue, TSchema>, "mode" | "rev" | "root" | "snap" | "hson" | "must" | "schema"> & Readonly<{
    at: <const TPath extends LivePath>(path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown)) => ReadDataLocation<LiveMapPathValue<TValue, TPath>>;
  }>;
export type ReadDocumentLibrary<TEvidence = HsonNode, TSchema extends HsonSchema = HsonSchema> =
  Pick<LocusDocumentLibrary<TEvidence, TSchema>, "mode" | "rev" | "root" | "snap" | "hson" | "must" | "watch" | "render" | "commits" | "schema"> & Readonly<{
    at: import("./livemap.types.js").AuthorityDocumentSelector<TEvidence, never>;
    q: (name: string) => import("./livemap.types.js").AuthorityDocumentQuadLocation<never> | undefined;
    css: import("./document-css.types.js").DocumentCssRead;
    document: Readonly<{
      root: LiveMapDocumentLibrary["root"];
      content: () => readonly LiveMapDocumentContent[];
      attrs: Pick<LiveMapDocumentLibrary["document"]["attrs"], "get" | "has" | "keys" | "must">;
      flags: Pick<LiveMapDocumentLibrary["document"]["flags"], "has">;
    }>;
  }>;
export type ReadLibrary = ReadDataLibrary | ReadDocumentLibrary;

export type DefinitionLibrary<TDefinition> =
  LibraryDefinitionEvidence<TDefinition> extends infer E
    ? E extends { family: infer F; value: infer V; schema: infer S extends HsonSchema }
      ? F extends "document" ? LocusDocumentLibrary<V, S>
        : F extends "parts" ? PartsLibrary<TDefinition, LocusDataLibrary<V, S>, LocusDataLocation<import("./livemap.types.js").LiveMapDocumentPart | undefined>, "locus">
        : LocusDataLibrary<V, S>
      : LocusLibrary
    : never;

export type LibraryCut = {
  (options?: undefined): LiveMapCut;
  (options: LiveMapCutOptions): LiveMapCut | LiveMapHtmlCut;
};

export type LibraryCommits = LiveMapRegistryCommitObserverApi;

export type EchoProjectedDataLibrary<TValue = JsonValue, TSchema extends HsonSchema = HsonSchema> = Readonly<{
  source: "authority-projected";
  readonly mode: Exclude<LiveMapRootMode, "document">;
  readonly rev: number;
  root: () => HsonNode;
  snap: LiveMapDataLibrary<TValue, string, TSchema>["snap"];
  hson: LiveMapDataLibrary<TValue, string, TSchema>["hson"];
  readonly must: RequiredReads<TValue, HsonData>;
  at: ReadDataLibrary<TValue, TSchema>["at"];
  schema: ReadDataLibrary<TValue, TSchema>["schema"];
}>;

export type EchoProjectedDataPath = ReadDataLocation;

export type EchoLocalDataLibrary<TValue = JsonValue, TSchema extends HsonSchema = HsonSchema> = Readonly<Pick<LiveMapDataLibrary<TValue, string, TSchema>, "mode" | "rev" | "root" | "snap" | "hson" | "must" | "at" | "schema"> & {
  source: "client-local";
}>;

export type EchoDocumentLocation = import("./livemap.types.js").AuthorityDocumentLocation<unknown, Promise<void>, "set">;
export type EchoProjectedDocumentLibrary<TEvidence = unknown, TSchema extends HsonSchema = HsonSchema> = Omit<LocusDocumentLibrary<TEvidence, TSchema>, "at" | "document" | "css" | "q"> & Readonly<{
  source: "authority-projected";
  css: ((operation: LiveMapCssOp) => Promise<void>) & import("./document-css.types.js").DocumentCssRead
    & Pick<import("./document-css.types.js").DocumentCssCommands<Promise<void>>, "clearAll" | "atProperty" | "keyframes">
    & Readonly<{ stylesheet: (text: string) => Promise<void> }>;
  at: import("./livemap.types.js").AuthorityDocumentSelector<TEvidence, Promise<void>, "set">;
  q: (name: string) => import("./livemap.types.js").AuthorityDocumentQuadLocation<never> | undefined;
  document: Omit<LocusDocumentLibrary["document"], "flags"> & Readonly<{
    flags: Pick<LocusDocumentLibrary["document"]["flags"], "has" | "set">;
  }>;
}>;
export type EchoLocalDocumentLibrary<TEvidence = unknown, TSchema extends HsonSchema = HsonSchema> = Readonly<Pick<LiveMapDocumentLibrary<TEvidence, string, TSchema>, "mode" | "rev" | "root" | "at" | "snap" | "hson" | "must" | "watch" | "render" | "css" | "commits" | "schema" | "q"> & {
  source: "client-local";
  document: Omit<LiveMapDocumentLibrary["document"], "byQuid">;
}>;

export type EchoLibrary = EchoProjectedDataLibrary | EchoLocalDataLibrary
  | EchoProjectedDocumentLibrary | EchoLocalDocumentLibrary;
