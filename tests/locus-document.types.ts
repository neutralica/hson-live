import { create_locus, create_echo, create_persistent_locus, hson, validate_document_path } from "../src/index.ts";
import type {
  DocumentLiveMap,LocusOptions,

  Locus,
  Echo,
  LocusDocumentActionPayloads,
  LocusEncodedGraphOp,
  LiveMapDocumentAttrs,
  LiveMapDocumentAttributeValue,
  LiveMapGraphReplaceAttrsOp,
  LiveMap,
  LiveTree,
  ProjectedLocusOptions,
  LocusPersistenceAdapter,
  LocusPersistedCommit,
  LocusPersistedDocumentCheckpoint,
  LocusPersistedMapState,
} from "../src/index.ts";
import type { LocusReadonlyMap } from "../src/types/locus.types.ts";

const replacementAttrs: LiveMapDocumentAttrs = {
  count: 0,
  hidden: false,
  nullable: null,
  style: { color: "red" },
  title: "next",
};
const replacementOperation: LiveMapGraphReplaceAttrsOp = {
  domain: "graph",
  op: "replace-attrs",
  target: { kind: "path", path: validate_document_path([]) },
  attrs: replacementAttrs,
};
void replacementOperation;

const invalidCanonicalWireOperation: LocusEncodedGraphOp = {
  domain: "graph",
  op: "remove-attr",
  // @ts-expect-error current canonical Locus operations cannot retain QUID-only targets
  target: { kind: "quid", quid: "000000001" },
  name: "title",
};
void invalidCanonicalWireOperation;

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends (<T>() => T extends TRight ? 1 : 2)
  ? (<T>() => T extends TRight ? 1 : 2) extends (<T>() => T extends TLeft ? 1 : 2)
    ? true
    : false
  : false;
type Assert<TValue extends true> = TValue;

declare const tree: LiveTree;
const treeAttr = tree.attrs.get("id");
const requiredTreeAttr = tree.attrs.must.get("id");
const treeHasAttr = tree.attrs.has("id");
const treeAttrKeys = tree.attrs.keys();
type TreeAttrIsCanonical = Assert<Equal<typeof treeAttr, LiveMapDocumentAttributeValue | undefined>>;
type RequiredTreeAttrIsCanonical = Assert<Equal<typeof requiredTreeAttr, LiveMapDocumentAttributeValue>>;
type TreeHasAttrIsBoolean = Assert<Equal<typeof treeHasAttr, boolean>>;
type TreeAttrKeysAreReadonly = Assert<Equal<typeof treeAttrKeys, readonly string[]>>;
tree.attrs.set("id", "main");
tree.attrs.set("hidden", false);
tree.attrs.set("nullable", null);
tree.attrs.setMany(replacementAttrs);
tree.attrs.drop("id");
tree.attrs.dropMany(["id", "title"]);
tree.attrs.clear();
tree.attrs.replace(replacementAttrs);
tree.flags.set("hidden");
tree.flags.clear("hidden");
// @ts-expect-error undefined is absence, not a canonical set value
tree.attrs.set("id", undefined);
// @ts-expect-error dropMany accepts one readonly string array
tree.attrs.dropMany("id");
// @ts-expect-error no bulk read helper exists
tree.attrs.getMany(["id"]);
// @ts-expect-error no entries helper exists
tree.attrs.entries();
// @ts-expect-error must exposes get only
tree.attrs.must.has("id");
// @ts-expect-error obsolete namespace is not part of the public API
tree.attr;
// @ts-expect-error obsolete namespace is not part of the public API
tree.flag;

const projectedHost: Locus<LiveMap<{ count: number }>> = create_locus({ state: { count: 0 } });
const projectedMap: LocusReadonlyMap<LiveMap<{ count: number }>> = projectedHost.map;
type ProjectedMapIsNarrow = Assert<typeof projectedHost.map extends LocusReadonlyMap<LiveMap<{ count: number }>> ? true : false>;
projectedMap.at(["count"]).watch((next) => {
  const exact: number = next;
  void exact;
});
const authoritativeProjectedHost = create_locus<{ count: number }, { increment: number }>({
  state: { count: 0 },
    actions: {
    async increment(context, amount) {
      context.map.snap(["count"]);
      context.map.at(["count"]).watch((next) => {
        const exact: number = next;
        void exact;
      });
      // @ts-expect-error hosted action contexts expose a read-only map
      context.map.set(["count"], amount);
      await context.mutate((draft) => draft.set(["count"], amount));
    },
  },
});
authoritativeProjectedHost.map.snap(["count"]);
authoritativeProjectedHost.mutate((draft) => draft.set(["count"], 1));
// @ts-expect-error hosted maps expose a read-only map
authoritativeProjectedHost.map.set(["count"], 1);

const socket = {
  send() {},
  close() {},
  onMessage() {},
  onClose() {},
};

const inferredProjectedClient = create_echo<{ count: number }>({ socket });
inferredProjectedClient.subscribe([]);
inferredProjectedClient.unsubscribe(["count"]);
type InferredProjectedSubscribeIsCallable = Assert<
  Equal<typeof inferredProjectedClient.subscribe, (path: readonly (string | number)[]) => void>
>;

declare const projectedClientAlias: Echo<LiveMap<{ count: number }>>;
projectedClientAlias.subscribe([]);
projectedClientAlias.unsubscribe(["count"]);
type ProjectedAliasSubscribeIsCallable = Assert<
  Equal<typeof projectedClientAlias.subscribe, (path: readonly (string | number)[]) => void>
>;

const existingProjectedMap = hson.liveMap.fromJson({ count: 0 });
const existingProjectedClient = create_echo({ socket, map: existingProjectedMap });
existingProjectedClient.subscribe([]);
existingProjectedClient.unsubscribe(["count"]);
type ExistingProjectedSubscribeIsCallable = Assert<
  Equal<typeof existingProjectedClient.subscribe, (path: readonly (string | number)[]) => void>
>;

const elementCandidate = hson.liveMap.fromHson(`<main/>`);
if (elementCandidate.mode !== "document") throw new Error("Expected element map");
const elementHost = create_locus({ map: elementCandidate });
type ElementMapIsExact = Assert<typeof elementHost.map extends LocusReadonlyMap<DocumentLiveMap> ? true : false>;
elementHost.map.document.attrs.get({ kind: "path", path: [] }, "id");
// @ts-expect-error hosted readonly document maps expose no mutable location acquisition
elementHost.map.at([0]).replace(elementCandidate.root());
elementHost.mutate((draft) => draft.document.attrs.set(
  { kind: "path", path: [] },
  "id",
  "exclusive",
));
// @ts-expect-error hosted document maps omit mutation methods
elementHost.map.document.attrs.set({ kind: "path", path: [] }, "id", "direct");
declare const persistenceAdapter: LocusPersistenceAdapter;
declare const persistedCommit: LocusPersistedCommit;
declare const persistedCheckpoint: LocusPersistedDocumentCheckpoint;
declare const persistedState: LocusPersistedMapState;
persistenceAdapter.appendCommit(persistedCommit);
persistenceAdapter.replaceCheckpoint(persistedCheckpoint);
void persistedState;
const persistentElementHost = create_persistent_locus({
  map: elementCandidate,
    persistence: persistenceAdapter,
});
persistentElementHost.then((host) => {
  host.checkpoint();
  host.mutate((draft) => draft.document.attrs.set(documentTarget, "id", "persistent"));
  // @ts-expect-error persistent host maps are read-only
  host.map.document.attrs.set(documentTarget, "id", "direct");
});
// @ts-expect-error persistence is available only through the async persistent constructor
create_locus({ map: elementCandidate, persistence: persistenceAdapter });
// @ts-expect-error projected-data persistence is deliberately unsupported in version one
create_persistent_locus({ map: existingProjectedMap, persistence: persistenceAdapter });
const elementHostAlias: Locus<DocumentLiveMap> = elementHost;
const documentTarget = { kind: "path", path: [] } as const;
const optionalAttr = elementCandidate.document.attrs.get(documentTarget, "title");
const requiredAttr = elementCandidate.document.attrs.must.get(documentTarget, "title");
const attrPresent = elementCandidate.document.attrs.has(documentTarget, "title");
const attrKeys = elementCandidate.document.attrs.keys(documentTarget);
type OptionalAttrIsCanonical = Assert<Equal<typeof optionalAttr, LiveMapDocumentAttributeValue | undefined>>;
type RequiredAttrIsCanonical = Assert<Equal<typeof requiredAttr, LiveMapDocumentAttributeValue>>;
type AttrPresentIsBoolean = Assert<Equal<typeof attrPresent, boolean>>;
type AttrKeysAreReadonly = Assert<Equal<typeof attrKeys, readonly string[]>>;
elementCandidate.document.attrs.setMany({ kind: "path", path: [] }, replacementAttrs);
elementCandidate.document.attrs.dropMany({ kind: "path", path: [] }, ["title"]);
elementCandidate.document.attrs.clear({ kind: "path", path: [] });
elementCandidate.document.attrs.replace({ kind: "path", path: [] }, replacementAttrs);
// @ts-expect-error document targets require an explicit path or QUID discriminant
elementCandidate.document.attrs.clear({ path: [] });
// @ts-expect-error dropMany accepts one readonly string array
elementCandidate.document.attrs.dropMany({ kind: "path", path: [] }, "title");
// @ts-expect-error undefined is not a canonical document attribute value
elementCandidate.document.attrs.setMany({ kind: "path", path: [] }, { title: undefined });
// @ts-expect-error document reads require an explicit document target
elementCandidate.document.attrs.get([], "title");
// @ts-expect-error document attribute names are strings
elementCandidate.document.attrs.has(documentTarget, 1);
// @ts-expect-error keys requires a target
elementCandidate.document.attrs.keys();
// @ts-expect-error no bulk read helper is exposed
elementCandidate.document.attrs.getMany(documentTarget, ["title"]);
// @ts-expect-error no entries reader is exposed
elementCandidate.document.attrs.entries(documentTarget);

const multiNodeDocumentCandidate = hson.liveMap.fromHson(`<main/> <aside/>`);
if (multiNodeDocumentCandidate.mode !== "document") throw new Error("Expected multiNodeDocument map");
const multiNodeDocumentHost = create_locus({
  map: multiNodeDocumentCandidate,
  actions: {
    inspect(context) {
      const exact: LocusReadonlyMap<DocumentLiveMap> = context.map;
      return exact.mode;
    },
  },
});
type DocumentSequenceMapIsExact = Assert<typeof multiNodeDocumentHost.map extends LocusReadonlyMap<DocumentLiveMap> ? true : false>;

const client = create_echo({
  socket,
  map: elementCandidate,
});
type ClientElementMapIsExact = Assert<Equal<typeof client.map, DocumentLiveMap>>;
type DocumentSubscribeIsGated = Assert<Equal<typeof client.subscribe, never>>;
type DocumentUnsubscribeIsGated = Assert<Equal<typeof client.unsubscribe, never>>;

const multiNodeDocumentClient = create_echo({ socket, map: multiNodeDocumentCandidate });
type DocumentSequenceSubscribeIsGated = Assert<Equal<typeof multiNodeDocumentClient.subscribe, never>>;
type DocumentSequenceUnsubscribeIsGated = Assert<Equal<typeof multiNodeDocumentClient.unsubscribe, never>>;

type BothForms = Readonly<{ state: { count: number }; map: DocumentLiveMap }>;
type ConstructorOptions = ProjectedLocusOptions<{ count: number }> | LocusOptions<DocumentLiveMap>;
type StateAndMapAreRejected = Assert<Equal<BothForms extends ConstructorOptions ? true : false, false>>;

void elementHostAlias;
void projectedMap;
type TypeAssertions =
  | ProjectedMapIsNarrow
  | InferredProjectedSubscribeIsCallable
  | ProjectedAliasSubscribeIsCallable
  | ExistingProjectedSubscribeIsCallable
  | ElementMapIsExact
  | DocumentSequenceMapIsExact
  | ClientElementMapIsExact
  | DocumentSubscribeIsGated
  | DocumentUnsubscribeIsGated
  | DocumentSequenceSubscribeIsGated
  | DocumentSequenceUnsubscribeIsGated
  | StateAndMapAreRejected;
const assertions: TypeAssertions = true;
void assertions;

type CustomActions = Readonly<{ custom: number }>;
declare const typedProjectedClient: Echo<LiveMap<{ count: number }>, CustomActions>;
typedProjectedClient.subscribe(["count"]);
typedProjectedClient.unsubscribe([]);
typedProjectedClient.action("custom", 1);

declare const typedDocumentClient: Echo<DocumentLiveMap, CustomActions>;
typedDocumentClient.action("custom", 1);
typedDocumentClient.action("document.attrs.set", {
  target: { kind: "quid", quid: "000000001" },
  name: "title",
  value: "typed",
});
typedDocumentClient.action("document.attrs.drop", {
  target: { kind: "path", path: [] },
  name: "title",
});
typedDocumentClient.action("document.attrs.setMany", {
  target: { kind: "path", path: [] },
  values: replacementAttrs,
});
typedDocumentClient.action("document.attrs.dropMany", {
  target: { kind: "path", path: [] },
  names: ["title"],
});
typedDocumentClient.action("document.attrs.clear", {
  target: { kind: "path", path: [] },
});
typedDocumentClient.action("document.attrs.replace", {
  target: { kind: "path", path: [] },
  values: replacementAttrs,
});
// @ts-expect-error hosted read actions are not implemented
typedDocumentClient.action("document.attrs.get", { target: { kind: "path", path: [] }, name: "id" });
// @ts-expect-error hosted read actions are not implemented
typedDocumentClient.action("document.attrs.has", { target: { kind: "path", path: [] }, name: "id" });
// @ts-expect-error hosted read actions are not implemented
typedDocumentClient.action("document.attrs.keys", { target: { kind: "path", path: [] } });
// @ts-expect-error hosted read actions are not implemented
typedDocumentClient.action("document.attrs.must.get", { target: { kind: "path", path: [] }, name: "id" });
// @ts-expect-error obsolete hosted action is not part of the public API
typedDocumentClient.action("document.attr.set", { target: { kind: "path", path: [] }, name: "id", value: "main" });
typedDocumentClient.action("document.content.replace", {
  target: { kind: "path", path: [] },
  index: 0,
  replacement: elementCandidate.root(),
});
typedDocumentClient.action("document.content.insert", {
  target: { kind: "path", path: [] },
  index: 0,
  content: elementCandidate.root(),
});
typedDocumentClient.action("document.content.remove", {
  target: { kind: "path", path: [] },
  index: 0,
});
typedDocumentClient.action("document.content.move", {
  target: { kind: "path", path: [] },
  from: 0,
  to: 1,
});
const builtins: LocusDocumentActionPayloads = {
  "document.attrs.set": { target: { kind: "path", path: [] }, name: "id", value: "main" },
  "document.attrs.drop": { target: { kind: "path", path: [] }, name: "id" },
  "document.attrs.setMany": { target: { kind: "path", path: [] }, values: replacementAttrs },
  "document.attrs.dropMany": { target: { kind: "path", path: [] }, names: ["id"] },
  "document.attrs.clear": { target: { kind: "path", path: [] } },
  "document.attrs.replace": { target: { kind: "path", path: [] }, values: replacementAttrs },
  "document.content.replace": { target: { kind: "path", path: [] }, index: 0, replacement: "text" },
  "document.content.insert": { target: { kind: "path", path: [] }, index: 0, content: "text" },
  "document.content.remove": { target: { kind: "path", path: [] }, index: 0 },
  "document.content.move": { target: { kind: "path", path: [] }, from: 0, to: 1 },
};
void builtins;
