import type { JsonValue, HsonNode } from "../core/types.js";
import type { HsonSchema, SchemaType } from "../api/transform/transform.types.js";
import type {
  LiveMap, LiveMapKnownDefinitions, LiveMapKnownNames, LiveMapPathValue, LiveMapSetValue,
  LiveMapWriteValue, LivePath, LiveMapRootMode, LiveMapCssOp,
  LiveMapDocumentContent, LiveMapDocumentAttrs, LiveMapDocumentAttributeValue,
  LiveMapDocumentCommitTarget, LiveMapCut, LiveMapHtmlCut, LiveMapCutOptions,
  LiveMapRegistryCommitObserverApi, LiveMapDocumentLibrary, LiveMapDataLibrary,
} from "./livemap.types.js";
import type { HsonData } from "../api/transform/transform.types.js";

export type GovernorDataPath<TValue = JsonValue | undefined> = Readonly<{
  readonly rev: number;
  path: () => LivePath;
  snap: () => TValue;
  data: () => HsonData | undefined;
  at: <const TPath extends LivePath>(path: TPath) => GovernorDataPath<LiveMapPathValue<TValue, TPath>>;
  watch: (listener: (value: TValue) => void) => () => void;
  kind: () => "missing" | "object" | "array" | "scalar";
  set: (value: LiveMapSetValue<TValue>) => Promise<void>;
  replace: (value: LiveMapWriteValue<TValue>) => Promise<void>;
  delete: () => Promise<void>;
}>;

export type GovernorDataLibrary<TValue = JsonValue | undefined, TSchema extends HsonSchema = HsonSchema> = Readonly<{
  readonly mode: Exclude<LiveMapRootMode, "document">;
  readonly rev: number;
  root: () => HsonNode;
  snap: LiveMapDataLibrary<TValue, string, TSchema>["snap"];
  at: <const TPath extends LivePath>(path: TPath) => GovernorDataPath<LiveMapPathValue<TValue, TPath>>;
  schema: Readonly<{ get: LiveMapDataLibrary<TValue, string, TSchema>["schema"]["get"] }>;
}>;

export type GovernorDocumentLocation = Readonly<{
  readonly rev: number;
  path: () => readonly number[];
  snap: () => unknown;
  watch: (listener: (value: unknown) => void) => () => void;
  kind: () => "missing" | "root" | "element" | "text";
  at: (path: readonly number[]) => GovernorDocumentLocation;
  id: (value: string) => GovernorDocumentLocation | undefined;
  replace: (value: LiveMapDocumentContent) => Promise<void>;
  delete: () => Promise<void>;
  insert: (index: number, value: LiveMapDocumentContent) => Promise<void>;
  move: (from: number, to: number) => Promise<void>;
  attrs: Readonly<{
    get: (name: string) => LiveMapDocumentAttributeValue | undefined;
    has: (name: string) => boolean;
    keys: () => readonly string[];
    set: (name: string, value: LiveMapDocumentAttributeValue) => Promise<void>;
    drop: (name: string) => Promise<void>;
    replace: (values: LiveMapDocumentAttrs) => Promise<void>;
  }>;
}>;

export type GovernorDocumentLibrary<TEvidence = HsonNode, TSchema extends HsonSchema = HsonSchema> = Readonly<{
  readonly mode: "document";
  readonly rev: number;
  root: () => HsonNode;
  render: LiveMapDocumentLibrary<TEvidence, string, TSchema>["render"];
  commits: LiveMapDocumentLibrary<TEvidence, string, TSchema>["commits"];
  at: (path: readonly number[]) => GovernorDocumentLocation;
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

export type GovernorLibrary = GovernorDataLibrary | GovernorDocumentLibrary;

export type GovernorReadLibrary =
  | Readonly<Pick<GovernorDataLibrary, "mode" | "rev" | "root" | "snap" | "schema"> & {
      at: (path: LivePath) => Readonly<Pick<GovernorDataPath, "rev" | "path" | "snap" | "data" | "watch" | "kind">>;
    }>
  | Readonly<Pick<GovernorDocumentLibrary, "mode" | "rev" | "root" | "render" | "commits" | "schema"> & {
      at: (path: readonly number[]) => Readonly<Pick<GovernorDocumentLocation, "rev" | "path" | "snap" | "watch" | "kind">>;
      css: Readonly<Pick<GovernorDocumentLibrary["css"], "snapshot" | "has" | "list" | "get">>;
    }>;

type DefinitionLibrary<TDefinition> =
  TDefinition extends { data: unknown; schema: infer TSchema extends HsonSchema }
    ? GovernorDataLibrary<SchemaType<TSchema>, TSchema>
    : TDefinition extends { document: unknown; schema: infer TSchema extends HsonSchema }
      ? GovernorDocumentLibrary<SchemaType<TSchema>, TSchema>
      : TDefinition extends { data: unknown } ? GovernorDataLibrary<JsonValue>
        : TDefinition extends { document: unknown } ? GovernorDocumentLibrary : GovernorLibrary;

export type GovernorLibrarySelector<TMap extends LiveMap> = {
  <TName extends LiveMapKnownNames<TMap>>(
    name: TName,
  ): DefinitionLibrary<LiveMapKnownDefinitions<TMap extends LiveMap<infer TDefinitions> ? TDefinitions : never>[TName]>;
  (name: string): GovernorLibrary;
};

export type GovernorReadLibrarySelector<TMap extends LiveMap> = {
  <TName extends LiveMapKnownNames<TMap>>(name: TName):
    DefinitionLibrary<LiveMapKnownDefinitions<TMap extends LiveMap<infer TDefinitions> ? TDefinitions : never>[TName]> extends GovernorDataLibrary<infer TValue, infer TSchema>
      ? Readonly<Pick<GovernorDataLibrary<TValue, TSchema>, "mode" | "rev" | "root" | "snap" | "schema"> & {
          at: <const TPath extends LivePath>(path: TPath) => Readonly<Pick<GovernorDataPath<LiveMapPathValue<TValue, TPath>>, "rev" | "path" | "snap" | "data" | "watch" | "kind">>;
        }>
      : DefinitionLibrary<LiveMapKnownDefinitions<TMap extends LiveMap<infer TDefinitions> ? TDefinitions : never>[TName]> extends GovernorDocumentLibrary<infer TEvidence, infer TSchema>
        ? Readonly<Pick<GovernorDocumentLibrary<TEvidence, TSchema>, "mode" | "rev" | "root" | "render" | "commits" | "schema"> & {
            at: (path: readonly number[]) => Readonly<Pick<GovernorDocumentLocation, "rev" | "path" | "snap" | "watch" | "kind">>;
            css: Readonly<Pick<GovernorDocumentLibrary<TEvidence, TSchema>["css"], "snapshot" | "has" | "list" | "get">>;
          }>
        : GovernorReadLibrary;
  (name: string): GovernorReadLibrary;
};

export type GovernorCut = {
  (options?: undefined): LiveMapCut;
  (options: LiveMapCutOptions): LiveMapCut | LiveMapHtmlCut;
};

export type GovernorCommits = LiveMapRegistryCommitObserverApi;

export type EchoProjectedDataLibrary = Readonly<{
  source: "authority-projected";
  readonly mode: Exclude<LiveMapRootMode, "document">;
  readonly rev: number;
  root: () => HsonNode;
  snap: LiveMapDataLibrary["snap"];
  at: (path: LivePath) => EchoProjectedDataPath;
  schema: Readonly<{ get: () => HsonSchema }>;
}>;

export type EchoProjectedDataPath = Readonly<Pick<GovernorDataPath, "rev" | "path" | "snap" | "data" | "watch" | "kind"> & {
  at: (path: LivePath) => EchoProjectedDataPath;
}>;

export type EchoLocalDataLibrary = Readonly<Pick<LiveMapDataLibrary, "mode" | "rev" | "root" | "snap" | "at" | "schema"> & {
  source: "client-local";
}>;

export type EchoProjectedDocumentLibrary = GovernorDocumentLibrary & Readonly<{ source: "authority-projected" }>;
export type EchoLocalDocumentLibrary = Readonly<Pick<LiveMapDocumentLibrary, "mode" | "rev" | "root" | "at" | "render" | "css" | "commits" | "schema"> & {
  source: "client-local";
  document: Omit<LiveMapDocumentLibrary["document"], "byQuid">;
}>;

export type EchoLibrary = EchoProjectedDataLibrary | EchoLocalDataLibrary
  | EchoProjectedDocumentLibrary | EchoLocalDocumentLibrary;
