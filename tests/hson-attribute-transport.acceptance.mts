import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import {
  assertCanonicalSerializedClosure,
  assert_canonical_oracle_graph_equal,
} from "../src/_tests/transform-oracle.ts";
import { parseDocument } from "htmlparser2";
import { hsonTransform } from "../src/api/transform/index.ts";
import { parse_html } from "../src/api/transform/parsers/parse-html.ts";
import { serialize_html } from "../src/api/transform/serializers/serialize-html.ts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import { normalize_detached_hson_semantic_value } from "../src/core/normalize-hson-semantic-value.ts";
import { node_from_svg } from "../src/api/transform/utils/node-utils/node-from-svg.ts";
import {
  decode_ordinary_attr_transit_name,
  ordinary_attr_transit_name,
} from "../src/api/transform/utils/html-preflights/ordinary-attribute-transit.ts";
import type { HsonNode } from "../src/core/types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson.attribute-transport",
  title: "Hson ordinary attribute transport",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["hson", "attributes", "transport", "canonicalization"]),
});

const Q1 = "000000001";
const ORDINARY_PRIVATE = "_hson_attr_transit_v1_613a62";
const METADATA_PRIVATE = "_hson_meta_attr_v2_71756964";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

const testEvents = create_test_event_emitter("hson.attribute-transport");
let checks = 0;
function check(name: string, fn: () => void): void {
  testEvents.case_begin(name, name);
  try {
    fn();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function is_node(value: HsonNode["$_content"][number]): value is HsonNode {
  return typeof value === "object" && value !== null && "$_tag" in value;
}

function nodes(root: HsonNode): HsonNode[] {
  const result: HsonNode[] = [];
  const visit = (node: HsonNode): void => {
    result.push(node);
    for (const child of node.$_content) if (is_node(child)) visit(child);
  };
  visit(root);
  return result;
}

function must_tag(root: HsonNode, tag: string): HsonNode {
  const found = nodes(root).find((node) => node.$_tag === tag);
  assert.ok(found, `expected <${tag}>`);
  return found;
}

type DomAttr = Readonly<{ name: string; value: string }>;

function prepare_parser_element(
  node: Record<string, unknown>,
  inheritedNamespace = HTML_NS,
): void {
  if (node.nodeType === 3) {
    Object.defineProperty(node, "textContent", {
      configurable: true,
      value: String(node.data ?? ""),
    });
    return;
  }
  if (node.nodeType !== 1) return;
  const tagName = String(node.name ?? node.tagName ?? "");
  const namespace = inheritedNamespace === SVG_NS || tagName.toLowerCase() === "svg"
    ? SVG_NS
    : HTML_NS;
  Object.defineProperty(node, "namespaceURI", {
    configurable: true,
    value: namespace,
  });
  Object.defineProperty(node, "hasAttribute", {
    configurable: true,
    value(name: string): boolean {
      return (node.attributes as DomAttr[]).some((attr) => attr.name === name);
    },
  });
  for (const child of node.childNodes as Record<string, unknown>[]) {
    prepare_parser_element(child, namespace);
  }
}

function parser_document(source: string): {
  documentElement: Element;
  querySelector(selector: string): null;
} {
  const parsed = parseDocument(source, {
    xmlMode: true,
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    recognizeSelfClosing: true,
  });
  const root = parsed.childNodes.find((node) => node.nodeType === 1);
  assert.ok(root);
  prepare_parser_element(root as unknown as Record<string, unknown>);
  return {
    documentElement: root as unknown as Element,
    querySelector: () => null,
  };
}

function with_browser_parser<T>(fn: () => T): T {
  const parserDescriptor = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  const nodeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Node");
  class TestDOMParser {
    parseFromString(source: string): ReturnType<typeof parser_document> {
      return parser_document(source);
    }
  }
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    writable: true,
    value: TestDOMParser,
  });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    writable: true,
    value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  });
  try {
    return fn();
  } finally {
    if (parserDescriptor === undefined) Reflect.deleteProperty(globalThis, "DOMParser");
    else Object.defineProperty(globalThis, "DOMParser", parserDescriptor);
    if (nodeDescriptor === undefined) Reflect.deleteProperty(globalThis, "Node");
    else Object.defineProperty(globalThis, "Node", nodeDescriptor);
  }
}

function direct_element(
  tag: string,
  attrs: readonly DomAttr[],
  namespaceURI = HTML_NS,
): Element {
  return {
    nodeType: 1,
    tagName: tag,
    namespaceURI,
    attributes: [...attrs],
    childNodes: [],
    hasAttribute(name: string): boolean {
      return attrs.some((attr) => attr.name === name);
    },
    textContent: "",
  } as unknown as Element;
}

function worker(source: string): HsonNode {
  return hsonTransform.fromTrustedHtml(source).toNode();
}

function browser(source: string): HsonNode {
  return with_browser_parser(() => parse_html(source));
}

function assert_worker_browser_equal(caseId: string, workerNode: HsonNode, browserNode: HsonNode): void {
  assert_canonical_oracle_graph_equal({
    launcher: "hson.attribute-transport",
    caseId,
    operation: "worker-browser-parity",
    expected: workerNode,
    actual: browserNode,
    classification: "cross-runtime-divergence",
  });
}

function assert_rejects_both(source: string, pattern: RegExp): void {
  assert.throws(() => worker(source), pattern);
  assert.throws(() => browser(source), pattern);
}

check("ordinary transit codec is deterministic, injective, and UTF-8 reversible", () => {
  const colon = ordinary_attr_transit_name("a:b");
  const literal = ordinary_attr_transit_name("a__COLON__b");
  assert.notEqual(colon, literal);
  assert.equal(ordinary_attr_transit_name("a:b"), colon);
  assert.equal(decode_ordinary_attr_transit_name(colon), "a:b");
  assert.equal(decode_ordinary_attr_transit_name(ordinary_attr_transit_name("xmlish:name")), "xmlish:name");
  assert.equal(decode_ordinary_attr_transit_name("_hson_attr_transit_v1_"), undefined);
  assert.equal(decode_ordinary_attr_transit_name("_hson_attr_transit_v1_0"), undefined);
  assert.equal(decode_ordinary_attr_transit_name("_hson_attr_transit_v1_GG"), undefined);
});

check("browser and Worker preserve distinct colonized and lookalike ordinary names", () => {
  const source = `<main a:b="1" a__COLON__b="2" c:d="3" hson-foo="ordinary"/>`;
  const workerNode = worker(source);
  const browserNode = browser(source);
  for (const node of [must_tag(workerNode, "main"), must_tag(browserNode, "main")]) {
    assert.equal(node.$_attrs?.["a:b"], "1");
    assert.equal(node.$_attrs?.a__colon__b, "2");
    assert.equal(node.$_attrs?.["c:d"], "3");
    assert.equal(node.$_attrs?.["hson-foo"], "ordinary");
    assert.equal(Object.keys(node.$_attrs ?? {}).some((key) => key.startsWith("_hson_")), false);
  }
  assert_worker_browser_equal("colonized-name-parity", workerNode, browserNode);
});

check("data--attrmap is ordinary application data", () => {
  for (const root of [worker(`<main data--attrmap="application-owned"/>`), browser(`<main data--attrmap="application-owned"/>`)]) {
    assert.equal(must_tag(root, "main").$_attrs?.["data--attrmap"], "application-owned");
  }
});

check("xml namespace plumbing is dropped consistently rather than transit-decoded", () => {
  const source = `<main xml:lang="en" xmlns:app="urn:app"/>`;
  for (const root of [worker(source), browser(source)]) {
    assert.deepEqual(must_tag(root, "main").$_attrs ?? {}, {});
  }
});

check("invalid canonical ordinary names reject instead of being renamed", () => {
  assert_rejects_both(`<main @bad="1"/>`, /invalid Hson attribute name "@bad"/);
  assert.throws(
    () => parse_html(direct_element("main", [{ name: "@bad", value: "1" }])),
    /invalid Hson attribute name "@bad"/,
  );
});

check("authored private names reject in browser, Worker, and direct Element ingress", () => {
  for (const privateName of [
    ORDINARY_PRIVATE,
    "_hson_attr_transit_v1_bad",
    "_HSON_ATTR_TRANSIT_V1_613a62",
    METADATA_PRIVATE,
  ]) {
    assert_rejects_both(
      `<main ${privateName}="secret"/>`,
      /externally authored private/,
    );
    assert.throws(
      () => parse_html(direct_element("main", [{ name: privateName, value: "secret" }])),
      /externally authored private/,
    );
  }
});

check("direct SVG Element ingress rejects both private transit domains without mutation", () => {
  for (const privateName of [ORDINARY_PRIVATE, METADATA_PRIVATE]) {
    const attrs = [{ name: privateName, value: "secret" }];
    const element = direct_element("svg", attrs, SVG_NS);
    assert.throws(() => node_from_svg(element), /externally authored private/);
    assert.deepEqual(attrs, [{ name: privateName, value: "secret" }]);
  }
});

check("raw canonical private attrs reject before serializer egress", () => {
  for (const privateName of [ORDINARY_PRIVATE, METADATA_PRIVATE]) {
    const graph: HsonNode = {
      $_tag: "_hson_root",
      $_content: [{
        $_tag: "_hson_elem",
        $_content: [{ $_tag: "main", $_attrs: { [privateName]: "secret" }, $_content: [] }],
      }],
    };
    assert.throws(() => hsonTransform.fromNode(graph), /private .* transit name is forbidden/);
    assert.throws(() => serialize_html(graph), /private .* transit name is forbidden/);
  }
});

check("ordinary duplicates are last-wins and case-equivalent in HTML", () => {
  const source = `<main id="a" ID="b" title="first" TITLE="last"/>`;
  for (const root of [worker(source), browser(source)]) {
    assert.deepEqual(must_tag(root, "main").$_attrs, { id: "b", title: "last" });
  }
});

check("duplicate colonized ordinary attrs use semantic identity and never suffix", () => {
  const source = `<main a:b="first" A:B="last"/>`;
  for (const root of [worker(source), browser(source)]) {
    const attrs = must_tag(root, "main").$_attrs;
    assert.deepEqual(attrs, { "a:b": "last" });
    assert.equal(Object.keys(attrs ?? {}).some((key) => key.endsWith("__1")), false);
  }
});

check("duplicate class declarations merge stable unique tokens", () => {
  const source = `<main class="a b" CLASS="b c" class/>`;
  for (const root of [worker(source), browser(source)]) {
    assert.equal(must_tag(root, "main").$_attrs?.class, "a b c class");
  }
});

check("duplicate minimized and valued attrs follow the same last-wins rule", () => {
  for (const root of [
    worker(`<main disabled="custom" disabled/>`),
    browser(`<main disabled="custom" disabled/>`),
  ]) {
    assert.equal(must_tag(root, "main").$_attrs?.disabled, "disabled");
  }
  for (const root of [
    worker(`<main disabled disabled="custom"/>`),
    browser(`<main disabled disabled="custom"/>`),
  ]) {
    assert.equal(must_tag(root, "main").$_attrs?.disabled, "custom");
  }
});

check("duplicate metadata declarations reject before ordinary duplicate policy", () => {
  assert_rejects_both(
    `<main hson:quid="${Q1}" hson:quid="${Q1}"/>`,
    /duplicate Hson metadata attribute "hson:quid"/,
  );
  assert_rejects_both(
    `<_hson_arr><_hson_ii hson:index="0" hson:index="0"><a/></_hson_ii></_hson_arr>`,
    /duplicate Hson metadata attribute "hson:index"/,
  );
});

check("direct Element admission preserves unique semantic names at its post-token boundary", () => {
  const attrs = [
    { name: "a:b", value: "1" },
    { name: "a__colon__b", value: "2" },
    { name: "data--attrmap", value: "application-owned" },
  ];
  const node = parse_html(direct_element("main", attrs));
  assert.deepEqual(must_tag(node, "main").$_attrs, {
    "a:b": "1",
    a__colon__b: "2",
    "data--attrmap": "application-owned",
  });
  assert.deepEqual(attrs, [
    { name: "a:b", value: "1" },
    { name: "a__colon__b", value: "2" },
    { name: "data--attrmap", value: "application-owned" },
  ]);
});

check("nested SVG xlink alias and case behavior agree across browser and Worker", () => {
  const source = `<main><svg viewBox="0 0 10 10"><a XLINK:HREF="/x"/></svg></main>`;
  const workerNode = worker(source);
  const browserNode = browser(source);
  for (const root of [workerNode, browserNode]) {
    assert.equal(must_tag(root, "svg").$_attrs?.viewBox, "0 0 10 10");
    const link = must_tag(root, "a");
    assert.equal(link.$_attrs?.href, "/x");
    assert.equal(link.$_attrs?.["xlink:href"], undefined);
  }
  assert_worker_browser_equal("svg-alias-parity", workerNode, browserNode);
});

check("HTML metadata spelling follows case-insensitive HTML name semantics", () => {
  const source = `<main Hson:QUID="${Q1}"/>`;
  const workerNode = worker(source);
  const browserNode = browser(source);
  assert.equal(must_tag(workerNode, "main").$_meta?.quid, Q1);
  assert.equal(must_tag(browserNode, "main").$_meta?.quid, Q1);
  assert_worker_browser_equal("metadata-case-parity", workerNode, browserNode);
});

check("standalone SVG and direct SVG Element use the same xlink alias rule", () => {
  const standalone = worker(
    `<svg viewBox="0 0 10 10" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="/x"/></svg>`,
  );
  const directLink = direct_element("a", [{ name: "xlink:href", value: "/x" }], SVG_NS);
  assert.equal(must_tag(standalone, "a").$_attrs?.href, "/x");
  assert.equal(must_tag(standalone, "a").$_attrs?.["xlink:href"], undefined);
  assert.equal(node_from_svg(directLink).$_attrs?.href, "/x");
  assert.equal(node_from_svg(directLink).$_attrs?.["xlink:href"], undefined);
  assert.equal(
    must_tag(worker(`<svg><a xlink:href="/x" href="/native"/></svg>`), "a").$_attrs?.href,
    "/native",
  );
  assert.equal(
    node_from_svg(direct_element("a", [
      { name: "xlink:href", value: "/x" },
      { name: "href", value: "/native" },
    ], SVG_NS)).$_attrs?.href,
    "/native",
  );
});

check("transport-sensitive attrs satisfy parse/serialize/parse closure", () => {
  const source = `<main a:b="1" c:d="2" data--attrmap="owned" hson:quid="${Q1}" disabled/>`;
  for (const parse of [worker, browser]) {
    const first = parse(source);
    const wire = serialize_html(first);
    assert.equal(wire.includes("_hson_attr_transit_v1_"), false);
    assert.equal(wire.includes("_hson_meta_attr_v2_"), false);
    const second = parse(wire);
    assert_canonical_oracle_graph_equal({
      launcher: "hson.attribute-transport",
      caseId: "html-transport-closure",
      operation: "parse-serialize-parse",
      expected: first,
      actual: second,
    });
  }
});

check("transport-sensitive attrs retain canonical equality through Hson text", () => {
  const first = worker(`<main a:b="1" a__COLON__b="2" data--attrmap="owned"/>`);
  const semantic = detach_hson_root_value(first);
  const hsonText = hsonTransform.fromNode(semantic).toHson().serialize();
  const reparsed = hsonTransform.fromHson(hsonText).toNode();
  assertCanonicalSerializedClosure({
    launcher: "hson.attribute-transport",
    caseId: "hson-attribute-transport-closure",
    node: semantic,
    serialized: hsonText,
  });
  assert.equal(must_tag(reparsed, "main").$_attrs?.["a:b"], "1");
  assert.equal(must_tag(reparsed, "main").$_attrs?.a__colon__b, "2");
});

check("HTML comments are ingress trivia inside _hson_str across all parser paths", () => {
  const source = `<_hson_str>&quot;a<!-- ignored -->b&quot;</_hson_str>`;
  const direct = parse_html(parser_document(source).documentElement);
  for (const root of [worker(source), browser(source), direct]) {
    assert.deepEqual(must_tag(root, "_hson_str").$_content, ["ab"]);
  }
  const meaningfulChild = `<_hson_str>&quot;a&quot;<span/></_hson_str>`;
  assert_rejects_both(meaningfulChild, /_hson_str.*text only/);
  assert.throws(
    () => parse_html(parser_document(meaningfulChild).documentElement),
    /_hson_str.*text only/,
  );
  const dangling = `<main/><!--`;
  assert_worker_browser_equal(
    "dangling-html-comment-parity",
    worker(dangling),
    browser(dangling),
  );
});

check("HTML QUID ingress rejects every structural carrier on all parser paths", () => {
  const cases = [
    `<_hson_root hson:quid="${Q1}"></_hson_root>`,
    `<_hson_obj hson:quid="${Q1}"></_hson_obj>`,
    `<_hson_elem hson:quid="${Q1}"></_hson_elem>`,
    `<_hson_arr hson:quid="${Q1}"></_hson_arr>`,
    `<_hson_ii hson:quid="${Q1}" hson:index="0"><_hson_val>1</_hson_val></_hson_ii>`,
    `<_hson_str hson:quid="${Q1}">&quot;x&quot;</_hson_str>`,
    `<_hson_val hson:quid="${Q1}">1</_hson_val>`,
  ];
  for (const source of cases) {
    const placement = /ineligible Hson structural node|metadata "quid" is not defined/;
    assert.throws(() => worker(source), placement);
    assert.throws(() => browser(source), placement);
    assert.throws(() => parse_html(parser_document(source).documentElement), placement);
  }
});

check("structural HTML typed scalars use only the detached object carrier", () => {
  for (const [source, expected] of [
    [`<_hson_obj><_hson_val>false</_hson_val></_hson_obj>`, false],
    [`<_hson_obj><_hson_val>-0</_hson_val></_hson_obj>`, -0],
  ] as const) {
    for (const [runtime, parsed] of [
      ["worker", worker(source)],
      ["browser", browser(source)],
    ] as const) {
      const scalar = normalize_detached_hson_semantic_value(
        detach_hson_root_value(parsed),
        `attribute-transport.${runtime}`,
      );
      assert.equal(scalar.$_tag, "_hson_val");
      assert.equal(Object.is(scalar.$_content[0], expected), true);
    }
  }

  assert_rejects_both(
    `<_hson_elem><_hson_val>1</_hson_val></_hson_elem>`,
    /_hson_val.*forbidden under.*_hson_elem/,
  );
});

check("reserved HTML transport lowering agrees across browser and Worker", () => {
  const sources = [
    `<value><_hson_val>-0</_hson_val></value>`,
    `<_hson_elem><_hson_str>&quot;a&quot;</_hson_str><_hson_str>&quot;&quot;</_hson_str><_hson_str>&quot;b&quot;</_hson_str></_hson_elem>`,
  ];
  for (const [index, source] of sources.entries()) {
    const workerNode = worker(source);
    const browserNode = browser(source);
    assert_worker_browser_equal(`reserved-transport-${index}`, workerNode, browserNode);
  }

  const scalar = detach_hson_root_value(worker(sources[0]!));
  assert.equal(scalar.$_tag, "_hson_obj");
  const property = scalar.$_content[0] as HsonNode;
  const value = property.$_content[0] as HsonNode;
  assert.equal(value.$_tag, "_hson_val");
  assert.equal(Object.is(value.$_content[0], -0), true);

  const text = detach_hson_root_value(worker(sources[1]!));
  assert.deepEqual(
    text.$_content.map((child) => (child as HsonNode).$_content[0]),
    ["a", "", "b"],
  );
  assert_rejects_both(
    `<_hson_str data-x="lost">&quot;text&quot;</_hson_str>`,
    /must not carry attributes or metadata/,
  );
});

process.stdout.write(`# ${checks} ordinary attribute transport checks passed\n`);
testEvents.terminal("pass");
