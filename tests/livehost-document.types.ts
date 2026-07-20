import { create_livehost, create_livehost_client, hson } from "../src/index.ts";
import type {
  ElementLiveMap,
  ExistingMapLiveHostOptions,
  FragmentLiveMap,
  LiveHost,
  LiveHostClient,
  LiveHostForMap,
  LiveHostClientForMap,
  LiveHostDocumentActionPayloads,
  LiveMap,
  LiveTree,
  ProjectedLiveHostOptions,
} from "../src/index.ts";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends (<T>() => T extends TRight ? 1 : 2)
  ? (<T>() => T extends TRight ? 1 : 2) extends (<T>() => T extends TLeft ? 1 : 2)
    ? true
    : false
  : false;
type Assert<TValue extends true> = TValue;

declare const tree: LiveTree;
tree.attrs.set("id", "main");
tree.attrs.drop("id");
tree.flags.set("hidden");
tree.flags.clear("hidden");
// @ts-expect-error obsolete namespace is not part of the public API
tree.attr;
// @ts-expect-error obsolete namespace is not part of the public API
tree.flag;

const projectedHost: LiveHost<{ count: number }> = create_livehost({ state: { count: 0 } });
const projectedMap: LiveMap<{ count: number }> = projectedHost.map;
type ProjectedMapIsNarrow = Assert<typeof projectedHost.map extends LiveMap<{ count: number }> ? true : false>;

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
const elementHostAlias: LiveHostForMap<ElementLiveMap> = elementHost;

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
  "document.content.replace": { target: { kind: "path", path: [] }, index: 0, replacement: "text" },
  "document.content.insert": { target: { kind: "path", path: [] }, index: 0, content: "text" },
  "document.content.remove": { target: { kind: "path", path: [] }, index: 0 },
  "document.content.move": { target: { kind: "path", path: [] }, from: 0, to: 1 },
};
void builtins;
