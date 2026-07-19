// test-exports.ts

import type { hson } from "../hson.js";
import type { HsonNode, JsonValue } from "../core/types.js";
import {
  create_live_trace_collector,
  create_live_trace_console_sink,
} from "../diagnostics/index.js";
import type {
  LiveHostOptions,
  LiveHostActionAuthorizationContext,
  LiveHostActionAuthorizer,
  LiveTraceCollector,
  LiveTraceEvent,
  LiveTraceSink,
} from "../types/livehost.types.js";

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
type DocumentLiveMapExposesInstall = Expect<
  Equal<"install" extends keyof DocumentLiveMapSurface ? true : false, true>
>;
type DataLiveMapOmitsInstall = Expect<
  Equal<"install" extends keyof LiveMapSurface ? true : false, false>
>;
type TraceSinkHasOneMethod = Expect<Equal<keyof LiveTraceSink, "emit">>;
type TraceConfigurationIsOptional = Expect<
  Equal<undefined extends LiveHostOptions["trace"] ? true : false, true>
>;
type TraceEventIsReadonly = Expect<
  Equal<Readonly<LiveTraceEvent>, LiveTraceEvent>
>;
type LiveMapOmitsTrace = Expect<
  Equal<"trace" extends keyof LiveMapSurface ? true : false, false>
>;
type AuthorizationContextIsReadonly = Expect<
  Equal<Readonly<LiveHostActionAuthorizationContext>, LiveHostActionAuthorizationContext>
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
  const target = { kind: "path", path: [] } as const;
  if (map.mode === "element") {
    map.element.node();
    map.element.content();
    map.element.attrs.set(target, "id", "main");
    map.element.attrs.drop(target, "id");
    map.element.content.replace(target, 0, "text");
    // @ts-expect-error Attribute mutation belongs under the attrs namespace.
    map.element.setAttr(target, "id", "main");
    // @ts-expect-error Bulk attribute mutation is not part of this slice.
    map.element.attrs.setMany(target, { id: "main" });
  } else if (map.mode === "fragment") {
    map.fragment.content();
    map.fragment.attrs.set({ kind: "quid", quid: "known" }, "id", "value");
    map.fragment.attrs.drop(target, "id");
    map.fragment.content.replace(target, 0, "text");
  } else {
    map.snap();
    map.proxy();
    // @ts-expect-error Data maps do not expose document capability namespaces.
    map.element.attrs.set(target, "id", "main");
  }

  return map.root();
}

function assert_document_surface(documentMap: DocumentLiveMapSurface): void {
  const capture = documentMap.capture();
  documentMap.install(capture);
  documentMap.install(capture, { expectedRev: documentMap.rev });
  documentMap.debug.node([]);

  // @ts-expect-error Document maps do not expose projected JSON mutation.
  documentMap.set([], {});
  // @ts-expect-error Document maps do not expose the JSON Proxy.
  documentMap.proxy();
  // @ts-expect-error Canonical nodes establish identity through construction, not install.
  documentMap.install(documentMap.root());
  // @ts-expect-error Graph replay is not part of the document façade.
  documentMap.replayGraph(capture);
  // @ts-expect-error Graph apply is not part of the document façade.
  documentMap.applyGraph(capture);
  // @ts-expect-error Data maps do not expose canonical document installation.
  hson.liveMap.fromJson({}).install(capture);
  // @ts-expect-error Data maps do not expose document attribute mutation.
  hson.liveMap.fromJson({}).element.attrs.set({ kind: "path", path: [] }, "id", "x");
  // @ts-expect-error Element is an instance capability, not a constructor namespace.
  hson.liveMap.element.fromTrustedHtml("<button>Save</button>");
  // @ts-expect-error Fragment is an instance capability, not a constructor namespace.
  hson.liveMap.fragment.fromTrustedHtml("text");
}

function assert_trace_diagnostics_exports(): LiveTraceCollector {
  const collector = create_live_trace_collector({ capacity: 8 });
  const sink: LiveTraceSink = create_live_trace_console_sink({ write: () => undefined });
  const options: LiveHostOptions = { trace: sink };
  void options;
  return collector;
}

function assert_livehost_authorization_types(): void {
  type Actions = Readonly<{ set: Readonly<{ value: number }> }>;
  const sync: LiveHostActionAuthorizer<Actions> = (context) => {
    // @ts-expect-error Authorization context fields are readonly.
    context.action = "set";
    // @ts-expect-error The validated policy payload is readonly.
    context.payload.value = 2;
    return context.session.resumable;
  };
  const asyncPolicy: LiveHostActionAuthorizer<Actions> = async () => true;
  const options: LiveHostOptions<Readonly<{ value: number }>, Actions> = {
    state: { value: 0 },
    authorizeAction: sync,
  };
  const asyncOptions: LiveHostOptions<Readonly<{ value: number }>, Actions> = {
    state: { value: 0 },
    authorizeAction: asyncPolicy,
  };
  void options;
  void asyncOptions;
}


export { pseudo_to_suffix } from "../api/livetree/managers/css-manager.js";
export  { normalize_css_value } from "../api/transform/utils/attrs-utils/normalize-css.js";
export { normalize_css_key } from "../api/transform/utils/attrs-utils/normalize-css.js";
export { canon_to_css_prop } from "../api/transform/utils/attrs-utils/normalize-css.js";
export { render_rule } from "../api/livetree/managers/global-css.js";
export  { normalize_decls } from "../api/livetree/managers/keyframes-manager.js";
