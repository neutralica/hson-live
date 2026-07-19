// test-exports.ts

import type { hson } from "../hson.js";
import type { HsonNode, JsonValue } from "../core/types.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;
type HsonSourceSurface = ReturnType<typeof hson.fromHson>;
type JsonSourceSurface = ReturnType<typeof hson.fromJson>;
type HtmlSourceSurface = ReturnType<typeof hson.fromTrustedHtml>;
type NodeSourceSurface = ReturnType<typeof hson.fromNode>;
type AnySourceSurface =
  | JsonSourceSurface
  | HsonSourceSurface
  | HtmlSourceSurface
  | NodeSourceSurface;

type HsonSourceReturnsCanonicalNode = Expect<
  Equal<ReturnType<HsonSourceSurface["toNode"]>, HsonNode>
>;
type EverySourceReturnsCanonicalNode = Expect<
  Equal<ReturnType<AnySourceSurface["toNode"]>, HsonNode>
>;
type HsonSourceRetainsToHson = Expect<
  Equal<"toHson" extends keyof HsonSourceSurface ? true : false, true>
>;
type HsonSerializerOmitsParse = Expect<
  Equal<
    "parse" extends keyof ReturnType<HsonSourceSurface["toHson"]> ? true : false,
    false
  >
>;
type JsonFinalizer = ReturnType<NodeSourceSurface["toJson"]>;
type HtmlFinalizer = ReturnType<NodeSourceSurface["toHtml"]>;
type LiveMapSurface = ReturnType<typeof hson.liveMap.fromJson>;
type ClassifiedLiveMapSurface = ReturnType<typeof hson.liveMap.fromNode>;
type DocumentLiveMapSurface = ReturnType<typeof hson.liveMap.fromTrustedHtml>;
type JsonValueTerminalReturnsJsonValue = Expect<
  Equal<ReturnType<JsonFinalizer["value"]>, JsonValue>
>;
type JsonSerializerOmitsParse = Expect<
  Equal<"parse" extends keyof JsonFinalizer ? true : false, false>
>;
type HtmlSerializerOmitsParse = Expect<
  Equal<"parse" extends keyof HtmlFinalizer ? true : false, false>
>;
type LiveMapOmitsTopLevelNode = Expect<
  Equal<"node" extends keyof LiveMapSurface ? true : false, false>
>;
type DocumentLiveMapOmitsDataSet = Expect<
  Equal<"set" extends keyof DocumentLiveMapSurface ? true : false, false>
>;
type DocumentLiveMapOmitsDataProxy = Expect<
  Equal<"proxy" extends keyof DocumentLiveMapSurface ? true : false, false>
>;

function read_node_from_any_source(source: AnySourceSurface): HsonNode {
  return source.toNode();
}

function assert_hson_serializer_has_no_parse(source: HsonSourceSurface): void {
  // @ts-expect-error HSON graph access belongs to the source-level toNode().
  source.toHson().parse();
}

function assert_terminal_and_debug_surface(
  json: JsonFinalizer,
  html: HtmlFinalizer,
  map: LiveMapSurface,
): JsonValue {
  map.root();
  map.debug.node(["a"]);

  // @ts-expect-error JSON finalizers expose value(), never parse().
  json.parse();
  // @ts-expect-error HTML finalizers expose serialization only.
  html.parse();
  // @ts-expect-error Live node access is isolated under map.debug.
  map.node(["a"]);

  return json.value();
}

function assert_classified_livemap_surface(map: ClassifiedLiveMapSurface): HsonNode {
  if (map.mode === "element") {
    map.element.node();
    map.element.content();
  } else if (map.mode === "fragment") {
    map.fragment.content();
  } else {
    map.snap();
    map.proxy();
  }

  return map.root();
}

function assert_document_surface(documentMap: DocumentLiveMapSurface): void {
  documentMap.capture();
  documentMap.debug.node([]);

  // @ts-expect-error Document maps do not expose projected JSON mutation.
  documentMap.set([], {});
  // @ts-expect-error Document maps do not expose the JSON Proxy.
  documentMap.proxy();
  // @ts-expect-error Element is an instance capability, not a constructor namespace.
  hson.liveMap.element.fromTrustedHtml("<button>Save</button>");
  // @ts-expect-error Fragment is an instance capability, not a constructor namespace.
  hson.liveMap.fragment.fromTrustedHtml("text");
}


export { pseudo_to_suffix } from "../api/livetree/managers/css-manager.js";
export  { normalize_css_value } from "../api/transform/utils/attrs-utils/normalize-css.js";
export { normalize_css_key } from "../api/transform/utils/attrs-utils/normalize-css.js";
export { canon_to_css_prop } from "../api/transform/utils/attrs-utils/normalize-css.js";
export { render_rule } from "../api/livetree/managers/global-css.js";
export  { normalize_decls } from "../api/livetree/managers/keyframes-manager.js";
