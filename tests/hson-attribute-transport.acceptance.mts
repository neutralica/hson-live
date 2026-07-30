import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";
import { parseDocument } from "htmlparser2";
import { hsonTransform } from "../src/api/transform/index.ts";
import { parse_html } from "../src/api/transform/parsers/parse-html.ts";
import { serialize_html } from "../src/api/transform/serializers/serialize-html.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { node_from_svg } from "../src/api/transform/utils/node-utils/node-from-svg.ts";
import {
  decode_ordinary_attr_transit_name,
  ordinary_attr_transit_name,
} from "../src/api/transform/utils/html-preflights/ordinary-attribute-transit.ts";
import type { HsonNode } from "../src/core/types.ts";

const Q1 = "0000000000000001";
const ORDINARY_PRIVATE = "_hson_attr_transit_v1_613a62";
const METADATA_PRIVATE = "_hson_meta_attr_v2_71756964";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
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
  assert.equal(canonical_hson_graph_equal(workerNode, browserNode), true);
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
  assert_rejects_both(`<main @bad="1"/>`, /invalid HSON attribute name "@bad"/);
  assert.throws(
    () => parse_html(direct_element("main", [{ name: "@bad", value: "1" }])),
    /invalid HSON attribute name "@bad"/,
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
    /duplicate HSON metadata attribute "hson:quid"/,
  );
  assert_rejects_both(
    `<_hson_arr><_hson_ii hson:index="0" hson:index="0"><a/></_hson_ii></_hson_arr>`,
    /duplicate HSON metadata attribute "hson:index"/,
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
  assert.equal(canonical_hson_graph_equal(workerNode, browserNode), true);
});

check("HTML metadata spelling follows case-insensitive HTML name semantics", () => {
  const source = `<main HSON:QUID="${Q1}"/>`;
  const workerNode = worker(source);
  const browserNode = browser(source);
  assert.equal(must_tag(workerNode, "main").$_meta?.quid, Q1);
  assert.equal(must_tag(browserNode, "main").$_meta?.quid, Q1);
  assert.equal(canonical_hson_graph_equal(workerNode, browserNode), true);
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
    assert.equal(canonical_hson_graph_equal(first, second), true);
  }
});

check("transport-sensitive attrs retain canonical equality through HSON text", () => {
  const first = worker(`<main a:b="1" a__COLON__b="2" data--attrmap="owned"/>`);
  const hsonText = hsonTransform.fromNode(first).toHson().serialize();
  const reparsed = hsonTransform.fromHson(hsonText).toNode();
  assert.equal(canonical_hson_graph_equal(first, reparsed), true);
  assert.equal(must_tag(reparsed, "main").$_attrs?.["a:b"], "1");
  assert.equal(must_tag(reparsed, "main").$_attrs?.a__colon__b, "2");
});

process.stdout.write(`# ${checks} ordinary attribute transport checks passed\n`);
emit_hson_live_test_completion("hson.attribute-transport", checks, checks, 0);
