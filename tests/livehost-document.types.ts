import { create_livehost, create_livehost_client, create_persistent_livehost, hson } from "../src/index.ts";
import type {
  ElementLiveMap,
  ExistingMapLiveHostOptions,
  FragmentLiveMap,
  LiveHost,
  LiveHostClient,
  LiveHostForMap,
  LiveHostClientForMap,
  LiveHostDocumentActionPayloads,
  LiveMapDocumentAttrs,
  LiveMapDocumentAttributeValue,
  LiveMapGraphReplaceAttrsOp,
  LiveMap,
  LiveTree,
  ProjectedLiveHostOptions,
  LiveHostPersistenceAdapter,
  LiveHostPersistedCommit,
  LiveHostPersistedDocumentCheckpoint,
  LiveHostPersistedMapState,
} from "../src/index.ts";

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
  target: { kind: "path", path: [] },
  attrs: replacementAttrs,
};
void replacementOperation;

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

const projectedHost: LiveHost<{ count: number }> = create_livehost({ state: { count: 0 } });
const projectedMap: LiveMap<{ count: number }> = projectedHost.map;
type ProjectedMapIsNarrow = Assert<typeof projectedHost.map extends LiveMap<{ count: number }> ? true : false>;
const exclusiveProjectedHost = create_livehost<{ count: number }, { increment: number }>({
  state: { count: 0 },
  authority: "exclusive",
  actions: {
    async increment(context, amount) {
      context.map.snap(["count"]);
      // @ts-expect-error exclusive action contexts expose a read-only map
      context.map.set(["count"], amount);
      await context.mutate((draft) => draft.set(["count"], amount));
    },
  },
});
exclusiveProjectedHost.map.snap(["count"]);
exclusiveProjectedHost.mutate((draft) => draft.set(["count"], 1));
// @ts-expect-error exclusive hosts expose a read-only map
exclusiveProjectedHost.map.set(["count"], 1);

const socket = {
  send() {},
  close() {},
  onMessage() {},
  onClose() {},
};

const inferredProjectedClient = create_livehost_client<{ count: number }>({ socket });
inferredProjectedClient.subscribe([]);
inferredProjectedClient.unsubscribe(["count"]);
type InferredProjectedSubscribeIsCallable = Assert<
  Equal<typeof inferredProjectedClient.subscribe, (path: readonly (string | number)[]) => void>
>;

declare const projectedClientAlias: LiveHostClient<{ count: number }>;
projectedClientAlias.subscribe([]);
projectedClientAlias.unsubscribe(["count"]);
type ProjectedAliasSubscribeIsCallable = Assert<
  Equal<typeof projectedClientAlias.subscribe, (path: readonly (string | number)[]) => void>
>;

const existingProjectedMap = hson.liveMap.fromJson({ count: 0 });
const existingProjectedClient = create_livehost_client({ socket, map: existingProjectedMap });
existingProjectedClient.subscribe([]);
existingProjectedClient.unsubscribe(["count"]);
type ExistingProjectedSubscribeIsCallable = Assert<
  Equal<typeof existingProjectedClient.subscribe, (path: readonly (string | number)[]) => void>
>;

const elementCandidate = hson.liveMap.fromHson(`<main/>`);
if (elementCandidate.mode !== "element") throw new Error("Expected element map");
const elementHost = create_livehost({ map: elementCandidate });
type ElementMapIsExact = Assert<Equal<typeof elementHost.map, ElementLiveMap>>;
const exclusiveElementHost = create_livehost({ map: elementCandidate, authority: "exclusive" });
exclusiveElementHost.map.document.attrs.get({ kind: "path", path: [] }, "id");
exclusiveElementHost.mutate((draft) => draft.document.attrs.set(
  { kind: "path", path: [] },
  "id",
  "exclusive",
));
// @ts-expect-error exclusive document maps omit mutation methods
exclusiveElementHost.map.document.attrs.set({ kind: "path", path: [] }, "id", "direct");
declare const persistenceAdapter: LiveHostPersistenceAdapter;
declare const persistedCommit: LiveHostPersistedCommit;
declare const persistedCheckpoint: LiveHostPersistedDocumentCheckpoint;
declare const persistedState: LiveHostPersistedMapState;
persistenceAdapter.appendCommit(persistedCommit);
persistenceAdapter.replaceCheckpoint(persistedCheckpoint);
void persistedState;
const persistentElementHost = create_persistent_livehost({
  map: elementCandidate,
  authority: "exclusive",
  persistence: persistenceAdapter,
});
persistentElementHost.then((host) => {
  host.checkpoint();
  host.mutate((draft) => draft.document.attrs.set(documentTarget, "id", "persistent"));
  // @ts-expect-error persistent host maps are read-only
  host.map.document.attrs.set(documentTarget, "id", "direct");
});
// @ts-expect-error persistence is available only through the async persistent constructor
create_livehost({ map: elementCandidate, persistence: persistenceAdapter });
// @ts-expect-error projected-data persistence is deliberately unsupported in version one
create_persistent_livehost({ map: existingProjectedMap, authority: "exclusive", persistence: persistenceAdapter });
const elementHostAlias: LiveHostForMap<ElementLiveMap> = elementHost;
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

const fragmentCandidate = hson.liveMap.fromHson(`<main/> <aside/>`);
if (fragmentCandidate.mode !== "fragment") throw new Error("Expected fragment map");
const fragmentHost = create_livehost({
  map: fragmentCandidate,
  actions: {
    inspect(context) {
      const exact: FragmentLiveMap = context.map;
      return exact.mode;
    },
  },
});
type FragmentMapIsExact = Assert<Equal<typeof fragmentHost.map, FragmentLiveMap>>;

const client = create_livehost_client({
  socket,
  map: elementCandidate,
});
type ClientElementMapIsExact = Assert<Equal<typeof client.map, ElementLiveMap>>;
type DocumentSubscribeIsGated = Assert<Equal<typeof client.subscribe, never>>;
type DocumentUnsubscribeIsGated = Assert<Equal<typeof client.unsubscribe, never>>;

const fragmentClient = create_livehost_client({ socket, map: fragmentCandidate });
type FragmentSubscribeIsGated = Assert<Equal<typeof fragmentClient.subscribe, never>>;
type FragmentUnsubscribeIsGated = Assert<Equal<typeof fragmentClient.unsubscribe, never>>;

type BothForms = Readonly<{ state: { count: number }; map: ElementLiveMap }>;
type ConstructorOptions = ProjectedLiveHostOptions<{ count: number }> | ExistingMapLiveHostOptions<ElementLiveMap>;
type StateAndMapAreRejected = Assert<Equal<BothForms extends ConstructorOptions ? true : false, false>>;

void elementHostAlias;
void projectedMap;
type TypeAssertions =
  | ProjectedMapIsNarrow
  | InferredProjectedSubscribeIsCallable
  | ProjectedAliasSubscribeIsCallable
  | ExistingProjectedSubscribeIsCallable
  | ElementMapIsExact
  | FragmentMapIsExact
  | ClientElementMapIsExact
  | DocumentSubscribeIsGated
  | DocumentUnsubscribeIsGated
  | FragmentSubscribeIsGated
  | FragmentUnsubscribeIsGated
  | StateAndMapAreRejected;
const assertions: TypeAssertions = true;
void assertions;

type CustomActions = Readonly<{ custom: number }>;
declare const typedProjectedClient: LiveHostClient<{ count: number }, CustomActions>;
typedProjectedClient.subscribe(["count"]);
typedProjectedClient.unsubscribe([]);
typedProjectedClient.action("custom", 1);

declare const typedDocumentClient: LiveHostClientForMap<ElementLiveMap, CustomActions>;
typedDocumentClient.action("custom", 1);
typedDocumentClient.action("document.attrs.set", {
  target: { kind: "quid", quid: "0000000000000001" },
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
  replacement: elementCandidate.element.node(),
});
typedDocumentClient.action("document.content.insert", {
  target: { kind: "path", path: [] },
  index: 0,
  content: elementCandidate.element.node(),
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
const builtins: LiveHostDocumentActionPayloads = {
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
