import type { LibraryShapeCapabilities, LibraryArrayRead, LibraryObjectRead, LibraryArrayCommands, LibraryObjectCommands, LiveMapArrayBranch, LiveMapObjectBranch, LiveMapScalarBranch } from "./livemap.types.js";
import type { DataSchemaValue, DocumentSchemaGraph } from "../internal/hson-schema/schema-evidence.types.js";
import type { JsonValue, HsonNode } from "../core/types.js";
import type { HsonSchema } from "../api/transform/transform.types.js";
import type {
  LiveMap, LiveMapKnownDefinitions, LiveMapKnownNames, LiveMapPathValue, LiveMapSetValue,
  LiveMapWriteValue, LiveMapPartWrite, LivePath, LiveMapRootMode, LiveMapCssOp,
  LiveMapDocumentContent, LiveMapDocumentAttrs, LiveMapDocumentAttributeValue,
  LiveMapDocumentCommitTarget, LiveMapCut, LiveMapHtmlCut, LiveMapCutOptions,
  LiveMapRegistryCommitObserverApi, LiveMapDocumentLibrary, LiveMapDataLibrary,
} from "./livemap.types.js";
import type { HsonData } from "../api/transform/transform.types.js";

export type LocusDataLocation<TValue = JsonValue | undefined> = Readonly<{
  readonly rev: number;
  path: () => LivePath;
  snap: () => TValue;
  data: () => HsonData | undefined;
  at: <const TPath extends LivePath>(path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown)) => LocusDataLocation<LiveMapPathValue<TValue, TPath>>;
  watch: (listener: (value: TValue) => void) => () => void;
  kind: () => "missing" | "object" | "array" | "scalar";
  present: () => LocusDataLocation<Exclude<TValue, undefined>> | undefined;
  asArray: () => LocusDataLocation<LiveMapArrayBranch<TValue>> | undefined;
  asObject: () => LocusDataLocation<LiveMapObjectBranch<TValue>> | undefined;
  asScalar: () => LocusDataLocation<LiveMapScalarBranch<TValue>> | undefined;
  set: LiveMapPartWrite<TValue, LiveMapSetValue<TValue>, Promise<void>>;
  replace: LiveMapPartWrite<TValue, LiveMapWriteValue<TValue>, Promise<void>>;
  delete: () => Promise<void>;
}> & LibraryShapeCapabilities<TValue,
  LibraryArrayRead<TValue> & LibraryArrayCommands<TValue, Promise<void>>,
  LibraryObjectRead<TValue> & LibraryObjectCommands<TValue, Promise<void>>>;

export type LocusDataLibrary<TValue = JsonValue | undefined, TSchema extends HsonSchema = HsonSchema> = Readonly<{
  readonly mode: Exclude<LiveMapRootMode, "document">;
  readonly rev: number;
  root: () => HsonNode;
  snap: LiveMapDataLibrary<TValue, string, TSchema>["snap"];
  at: <const TPath extends LivePath>(path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown)) => LocusDataLocation<LiveMapPathValue<TValue, TPath>>;
  schema: Readonly<{ get: LiveMapDataLibrary<TValue, string, TSchema>["schema"]["get"] }>;
}>;

export type LocusDocumentLocation = import("./livemap.types.js").AuthorityDocumentLocation;

export type LocusDocumentLibrary<TEvidence = HsonNode, TSchema extends HsonSchema = HsonSchema> = Readonly<{
  readonly mode: "document";
  readonly rev: number;
  root: () => HsonNode;
  render: LiveMapDocumentLibrary<TEvidence, string, TSchema>["render"];
  commits: LiveMapDocumentLibrary<TEvidence, string, TSchema>["commits"];
  at: import("./livemap.types.js").AuthorityDocumentSelector<TEvidence>;
  schema: Readonly<{ get: LiveMapDocumentLibrary<TEvidence, string, TSchema>["schema"]["get"] }>;
  css: ((operation: LiveMapCssOp) => Promise<void>) & Readonly<{
    snapshot: LiveMapDocumentLibrary<TEvidence, string, TSchema>["css"]["snapshot"];
    has: LiveMapDocumentLibrary<TEvidence, string, TSchema>["css"]["has"];
    list: LiveMapDocumentLibrary<TEvidence, string, TSchema>["css"]["list"];
    get: LiveMapDocumentLibrary<TEvidence, string, TSchema>["css"]["get"];
    stylesheet: (text: string) => Promise<void>;
  }>;
  document: Readonly<{
    root: () => HsonNode;
    content: (() => readonly LiveMapDocumentContent[]) & Readonly<{
      replace: (target: LiveMapDocumentCommitTarget, index: number, value: LiveMapDocumentContent) => Promise<void>;
      insert: (target: LiveMapDocumentCommitTarget, index: number, value: LiveMapDocumentContent) => Promise<void>;
      remove: (target: LiveMapDocumentCommitTarget, index: number) => Promise<void>;
      move: (target: LiveMapDocumentCommitTarget, from: number, to: number) => Promise<void>;
    }>;
    attrs: Readonly<{
      get: LiveMapDocumentLibrary<TEvidence, string, TSchema>["document"]["attrs"]["get"];
      has: LiveMapDocumentLibrary<TEvidence, string, TSchema>["document"]["attrs"]["has"];
      keys: LiveMapDocumentLibrary<TEvidence, string, TSchema>["document"]["attrs"]["keys"];
      set: (target: LiveMapDocumentCommitTarget, name: string, value: LiveMapDocumentAttributeValue) => Promise<void>;
      drop: (target: LiveMapDocumentCommitTarget, name: string) => Promise<void>;
      replace: (target: LiveMapDocumentCommitTarget, values: LiveMapDocumentAttrs) => Promise<void>;
    }>;
  }>;
}>;

export type LocusLibrary = LocusDataLibrary | LocusDocumentLibrary;

export type ReadDataLocation<TValue = JsonValue | undefined> = Readonly<{
  readonly rev: number;
  path: () => LivePath;
  snap: () => TValue;
  data: () => HsonData | undefined;
  watch: (listener: (value: TValue) => void) => () => void;
  kind: LocusDataLocation["kind"];
  at: <const TPath extends LivePath>(path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown)) => ReadDataLocation<LiveMapPathValue<TValue, TPath>>;
  present: () => ReadDataLocation<Exclude<TValue, undefined>> | undefined;
  asArray: () => ReadDataLocation<LiveMapArrayBranch<TValue>> | undefined;
  asObject: () => ReadDataLocation<LiveMapObjectBranch<TValue>> | undefined;
  asScalar: () => ReadDataLocation<LiveMapScalarBranch<TValue>> | undefined;
}> & LibraryShapeCapabilities<TValue, LibraryArrayRead<TValue>, LibraryObjectRead<TValue>>;
export type ReadDataLibrary<TValue = JsonValue | undefined, TSchema extends HsonSchema = HsonSchema> =
  Pick<LocusDataLibrary<TValue, TSchema>, "mode" | "rev" | "root" | "snap" | "schema"> & Readonly<{
    at: <const TPath extends LivePath>(path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown)) => ReadDataLocation<LiveMapPathValue<TValue, TPath>>;
  }>;
export type ReadDocumentLibrary<TEvidence = HsonNode, TSchema extends HsonSchema = HsonSchema> =
  Pick<LocusDocumentLibrary<TEvidence, TSchema>, "mode" | "rev" | "root" | "render" | "commits" | "schema"> & Readonly<{
    at: import("./livemap.types.js").AuthorityDocumentSelector<TEvidence, never>;
    css: Pick<LocusDocumentLibrary<TEvidence, TSchema>["css"], "snapshot" | "has" | "list" | "get">;
  }>;
export type ReadLibrary = ReadDataLibrary | ReadDocumentLibrary;

export type DefinitionLibrary<TDefinition> =
  TDefinition extends { data: unknown; schema: infer TSchema extends HsonSchema }
    ? LocusDataLibrary<DataSchemaValue<TSchema>, TSchema>
    : TDefinition extends { document: unknown; schema: infer TSchema extends HsonSchema }
      ? LocusDocumentLibrary<DocumentSchemaGraph<TSchema>, TSchema>
      : TDefinition extends { parts: unknown } ? LocusDataLibrary<import("./livemap.types.js").LiveMapPartCollection>
        : TDefinition extends { data: unknown } ? LocusDataLibrary<JsonValue>
        : TDefinition extends { document: unknown } ? LocusDocumentLibrary : LocusLibrary;

export type LocusLibrarySelector<TMap extends LiveMap> = {
  <TName extends LiveMapKnownNames<TMap>>(
    name: TName,
  ): DefinitionLibrary<LiveMapKnownDefinitions<TMap extends LiveMap<infer TDefinitions> ? TDefinitions : never>[TName]>;
  (name: string): LocusLibrary;
};

type ReadDefinitionLibrary<TDefinition> =
  TDefinition extends { data: unknown; schema: infer TSchema extends HsonSchema } ? ReadDataLibrary<DataSchemaValue<TSchema>, TSchema>
    : TDefinition extends { document: unknown; schema: infer TSchema extends HsonSchema } ? ReadDocumentLibrary<DocumentSchemaGraph<TSchema>, TSchema>
      : TDefinition extends { parts: unknown } ? ReadDataLibrary<import("./livemap.types.js").LiveMapPartCollection>
        : TDefinition extends { data: unknown } ? ReadDataLibrary<JsonValue>
          : TDefinition extends { document: unknown } ? ReadDocumentLibrary : ReadLibrary;
export type ReadLibrarySelector<TMap extends LiveMap> = {
  <TName extends LiveMapKnownNames<TMap>>(name: TName): ReadDefinitionLibrary<LiveMapKnownDefinitions<TMap extends LiveMap<infer TDefinitions> ? TDefinitions : never>[TName]>;
  (name: string): ReadLibrary;
};

export type LibraryCut = {
  (options?: undefined): LiveMapCut;
  (options: LiveMapCutOptions): LiveMapCut | LiveMapHtmlCut;
};

export type LibraryCommits = LiveMapRegistryCommitObserverApi;

export type EchoProjectedDataLibrary = Readonly<{
  source: "authority-projected";
  readonly mode: Exclude<LiveMapRootMode, "document">;
  readonly rev: number;
  root: () => HsonNode;
  snap: LiveMapDataLibrary["snap"];
  at: (path: LivePath) => EchoProjectedDataPath;
  schema: Readonly<{ get: () => HsonSchema }>;
}>;

export type EchoProjectedDataPath = ReadDataLocation;

export type EchoLocalDataLibrary = Readonly<Pick<LiveMapDataLibrary, "mode" | "rev" | "root" | "snap" | "at" | "schema"> & {
  source: "client-local";
}>;

export type EchoProjectedDocumentLibrary = LocusDocumentLibrary & Readonly<{ source: "authority-projected" }>;
export type EchoLocalDocumentLibrary = Readonly<Pick<LiveMapDocumentLibrary, "mode" | "rev" | "root" | "at" | "render" | "css" | "commits" | "schema"> & {
  source: "client-local";
  document: Omit<LiveMapDocumentLibrary["document"], "byQuid">;
}>;

export type EchoLibrary = EchoProjectedDataLibrary | EchoLocalDataLibrary
  | EchoProjectedDocumentLibrary | EchoLocalDocumentLibrary;
