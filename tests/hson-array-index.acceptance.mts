import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { exact_tagged_payload, invalid_tagged_graphs, tagged_node, tagged_item } from "./helpers/tagged-codec-fixture.mts";
import { parseDocument } from "htmlparser2";
import { hson } from "../src/hson.ts";
import { Hson, type HsonSchema } from "../src/index.ts";
import { hsonTransform } from "../src/api/transform/index.ts";
import { parse_html } from "../src/api/transform/parsers/parse-html.ts";
import { node_from_svg, SVG_NS } from "../src/api/transform/utils/node-utils/node-from-svg.ts";
import {
  canonical_hson_graph_difference,
  canonical_hson_graph_equal,
} from "../src/core/canonical-hson-equal.ts";
import { assert_invariants } from "../src/core/assert-invariants.ts";
import { serialize_hson } from "../src/api/transform/serializers/serialize-hson.ts";
import { serialize_json } from "../src/api/transform/serializers/serialize-json.ts";
import { serialize_html } from "../src/api/transform/serializers/serialize-html.ts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import {
  decode_exact_hson_value,
  encode_exact_hson_value,
  encode_view_state_snapshot,
} from "../src/api/livemap/livemap.document.view-state-codec.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { decode_locus_graph_content } from "../src/api/locus/locus.graph-content-codec.ts";
import type { HsonNode } from "../src/core/types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "core.hson-array-index",
  title: "Canonical Hson array indexes",
  category: "Core",
  runtime: "node",
  tags: Object.freeze(["hson", "arrays", "canonicalization", "public-api"]),
});

const testEvents = create_test_event_emitter("core.hson-array-index");
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

function value(tag: string): HsonNode {
  return {
    $_tag: tag,
    $_content: [{ $_tag: "_hson_obj", $_content: [] }],
  };
}

function item(index: string | undefined, tag: string): HsonNode {
  return {
    $_tag: "_hson_ii",
    ...(index === undefined ? {} : { $_meta: { index } }),
    $_content: [{ $_tag: "_hson_obj", $_content: [value(tag)] }],
  };
}

function array_root(items: HsonNode[]): HsonNode {
  return {
    $_tag: "_hson_root",
    $_content: [{ $_tag: "_hson_arr", $_content: items }],
  };
}

function scalar_item(index: string, text: string): HsonNode {
  return {
    $_tag: "_hson_ii",
    $_meta: { index },
    $_content: [{ $_tag: "_hson_str", $_content: [text] }],
  };
}

function array_node(root: HsonNode): HsonNode {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) break;
    if (current.$_tag === "_hson_arr") return current;
    for (const child of current.$_content) if (is_Node(child)) pending.push(child);
  }
  throw new Error("Expected _hson_arr");
}

function payload_tags(root: HsonNode): string[] {
  return array_node(root).$_content.map((wrapper) => {
    assert.ok(is_Node(wrapper));
    const payload = wrapper.$_content[0];
    assert.ok(is_Node(payload));
    if (payload.$_tag === "_hson_obj" && payload.$_content.length === 1) {
      const property = payload.$_content[0];
      assert.ok(is_Node(property));
      return property.$_tag;
    }
    return payload.$_tag;
  });
}

function indexes(root: HsonNode): Array<string | undefined> {
  return array_node(root).$_content.map((wrapper) =>
    is_Node(wrapper) ? wrapper.$_meta?.index : undefined
  );
}

type DomAttr = Readonly<{ name: string; value: string }>;

function prepare_parser_element(
  node: Record<string, unknown>,
  inheritedNamespace = "http://www.w3.org/1999/xhtml",
): void {
  if (node.nodeType !== 1) return;
  Object.defineProperty(node, "namespaceURI", {
    configurable: true,
    value: inheritedNamespace,
  });
  Object.defineProperty(node, "hasAttribute", {
    configurable: true,
    value(name: string): boolean {
      return (node.attributes as DomAttr[]).some((attr) => attr.name === name);
    },
  });
  for (const child of node.childNodes as Record<string, unknown>[]) {
    prepare_parser_element(child, inheritedNamespace);
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

function with_browser_parser(fn: () => void): void {
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
    fn();
  } finally {
    if (parserDescriptor === undefined) Reflect.deleteProperty(globalThis, "DOMParser");
    else Object.defineProperty(globalThis, "DOMParser", parserDescriptor);
    if (nodeDescriptor === undefined) Reflect.deleteProperty(globalThis, "Node");
    else Object.defineProperty(globalThis, "Node", nodeDescriptor);
  }
}

const reversed = array_root([item("1", "b"), item("0", "a")]);
const ordered = array_root([item("0", "a"), item("1", "b")]);

check("raw HsonNode permutations reject without mutating caller input", () => {
  const before = structuredClone(reversed);
  assert.throws(() => hsonTransform.fromNode(array_node(reversed)));
  const canonical = hsonTransform.fromNode(detach_hson_root_value(ordered)).toNode();
  assert.deepEqual(payload_tags(canonical), ["a", "b"]);
  assert.deepEqual(indexes(canonical), ["0", "1"]);
  assert.deepEqual(reversed, before);
  assert.notEqual(canonical, reversed);
  assert.deepEqual(payload_tags(canonical), ["a", "b"]);
});

check("all malformed exact index spellings and contradictory sets reject", () => {
  const cases: ReadonlyArray<readonly [string, HsonNode]> = [
    ["missing", array_root([item(undefined, "a")])],
    ["empty", array_root([item("", "a")])],
    ["negative", array_root([item("-1", "a")])],
    ["plus", array_root([item("+1", "a")])],
    ["leading zero", array_root([item("01", "a"), item("0", "b")])],
    ["fraction", array_root([item("1.0", "a"), item("0", "b")])],
    ["exponent", array_root([item("1e2", "a")])],
    ["text", array_root([item("banana", "a")])],
    ["infinity", array_root([item("Infinity", "a")])],
    ["huge", array_root([item("254740993", "a")])],
    ["duplicate", array_root([item("0", "a"), item("0", "b")])],
    ["gap", array_root([item("0", "a"), item("2", "b")])],
    ["out of range", array_root([item("1", "a")])],
    ["invalid permutation", array_root([item("banana", "a"), item("0", "b")])],
  ];
  for (const [name, graph] of cases) {
    assert.throws(
      () => hsonTransform.fromNode(array_node(graph)),
      name,
    );
  }
});

check("index metadata on the wrong node kind rejects", () => {
  assert.throws(() => hsonTransform.fromNode({
    $_tag: "_hson_elem",
    $_content: [{ $_tag: "div", $_meta: { index: "0" }, $_content: [] }],
  }));
});

check("browser string and direct Element ingress use hson:index semantic order", () => {
  const markup =
    `<_hson_arr>`
    + `<_hson_ii hson:index="1"><_hson_obj><b><_hson_obj/></b></_hson_obj></_hson_ii>`
    + `<_hson_ii hson:index="0"><_hson_obj><a><_hson_obj/></a></_hson_obj></_hson_ii>`
    + `</_hson_arr>`;
  with_browser_parser(() => {
    const fromString = parse_html(markup);
    const fromElement = parse_html(parser_document(markup).documentElement);
    assert.deepEqual(payload_tags(fromString), ["a", "b"]);
    assert.deepEqual(indexes(fromString), ["0", "1"]);
    assert.deepEqual(fromElement, fromString);
  });
});

check("direct XML-shaped structural ingress canonicalizes explicit wrapper order", () => {
  const markup =
    `<_hson_arr>`
    + `<_hson_ii hson:index="1"><_hson_obj><b><_hson_obj/></b></_hson_obj></_hson_ii>`
    + `<_hson_ii hson:index="0"><_hson_obj><a><_hson_obj/></a></_hson_obj></_hson_ii>`
    + `</_hson_arr>`;
  const element = parser_document(markup).documentElement;
  prepare_parser_element(
    element as unknown as Record<string, unknown>,
    SVG_NS,
  );
  let canonical: HsonNode | undefined;
  with_browser_parser(() => {
    canonical = node_from_svg(element);
  });
  assert.ok(canonical);
  assert.deepEqual(payload_tags(canonical), ["a", "b"]);
  assert.deepEqual(indexes(canonical), ["0", "1"]);
});

check("Worker-safe raw-node ingress preserves ordered arrays and rejects permutations and invalid sets", () => {
  assert.throws(() => hsonTransform.fromNode(array_node(reversed)));
  const canonical = hsonTransform.fromNode(detach_hson_root_value(ordered)).toNode();
  assert.deepEqual(payload_tags(canonical), ["a", "b"]);
  assert.deepEqual(indexes(canonical), ["0", "1"]);
  for (const invalid of [
    array_root([item(undefined, "a")]),
    array_root([item("0", "a"), item("0", "b")]),
    array_root([item("banana", "a")]),
  ]) {
    assert.throws(() => hsonTransform.fromNode(array_node(invalid)));
  }
});

check("JSON and Hson native arrays generate canonical positional indexes", () => {
  const fromJson = hsonTransform.fromJson(["a", "b", "c"]).toNode();
  const fromHson = hsonTransform.fromHson(`«"a","b","c"»`).toNode();
  assert.deepEqual(indexes(fromJson), ["0", "1", "2"]);
  assert.deepEqual(indexes(fromHson), ["0", "1", "2"]);
  assert.deepEqual(
    hsonTransform.fromJson(JSON.parse(hsonTransform.fromNode(detach_hson_root_value(fromJson)).toJson().serialize())).toNode(),
    fromJson,
  );
  const wire = hsonTransform.fromNode(fromHson).toHson().serialize();
  assert.doesNotMatch(wire, /index/);
  assert.deepEqual(hsonTransform.fromHson(wire).toNode(), fromHson);
});

check("Transform serializers consume canonical order and reject noncanonical egress", () => {
  const scalarReversed = array_root([
    scalar_item("1", "b"),
    scalar_item("0", "a"),
  ]);
  assert.throws(() => hsonTransform.fromNode(array_node(scalarReversed)));
  const scalarCanonical = hsonTransform.fromNode(detach_hson_root_value(array_root([
    scalar_item("0", "a"), scalar_item("1", "b"),
  ]))).toNode();
  assert.deepEqual(JSON.parse(serialize_json(scalarCanonical)), ["a", "b"]);
  const scalarValue = scalarCanonical;
  const hsonWire = serialize_hson(scalarValue);
  assert.match(hsonWire, /"a"[\s\S]*"b"/);
  assert.equal(
    canonical_hson_graph_equal(hsonTransform.fromHson(hsonWire).toNode(), scalarValue),
    true,
  );
  const elementCanonical = hsonTransform.fromNode(detach_hson_root_value(ordered)).toNode();
  const htmlWire = serialize_html(elementCanonical);
  assert.match(htmlWire, /hson:index="0"[\s\S]*hson:index="1"/);
  with_browser_parser(() => {
    assert.equal(
      canonical_hson_graph_equal(detach_hson_root_value(parse_html(htmlWire)), elementCanonical),
      true,
    );
  });
  for (const serializer of [serialize_json, serialize_hson, serialize_html]) {
    assert.throws(() => serializer(reversed));
  }
});

check("canonical equality and exact array admission both retain physical index order", () => {
  assert.equal(canonical_hson_graph_equal(reversed, ordered), false);
  assert.equal(canonical_hson_graph_difference(reversed, ordered)?.kind, "content-ordering");
  assert.throws(() => hsonTransform.fromNode(array_node(reversed)));
  const portable = detach_hson_root_value(ordered);
  const admitted = hsonTransform.fromNode(portable).toNode();
  assert.equal(canonical_hson_graph_equal(admitted, portable), true);
  assert.throws(() => hsonTransform.fromNode(array_node(array_root([item("0", "a"), item("0", "b")]))));
});

check("LiveMap projection and every numeric path follow canonical physical order", () => {
  const schema: HsonSchema = Hson.schema`<type "data" defs <Root <array "string">> content <ref "Root">>`;
  const source = array_root([
    scalar_item("0", "a"),
    scalar_item("1", "b"),
  ]);
  const map = hson.liveMap.fromLibraries({ data: {
    data: hsonTransform.fromNode(detach_hson_root_value(source)).toJson().serialize(),
    schema,
  } });
  const data = map.lib("data");
  assert.equal(data.mode, "data-array");
  assert.deepEqual(data.snap(), ["a", "b"]);
  assert.equal(data.at([0]).snap(), "a");
  assert.equal(data.at([1]).snap(), "b");
  assert.equal(data.at([2]).snap(), undefined);
  assert.deepEqual(indexes(data.root()), ["0", "1"]);
});

check("LiveMap splice and move regenerate dense indexes and preserve addressability", () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <items <array "string">>>`;
  const map = hson.liveMap.fromLibraries({ data: {
    data: { items: ["a", "b", "c"] },
    schema,
  } });
  const data = map.lib("data");
  data.at(["items"]).asArray()!.splice(1, 1, "x", "y");
  data.at(["items"]).asArray()!.move(3, 0);
  assert.deepEqual(data.snap(), { items: ["c", "a", "x", "y"] });
  const root = data.root();
  const nestedArray = (() => {
    const arrays: HsonNode[] = [];
    const visit = (node: HsonNode): void => {
      if (node.$_tag === "_hson_arr") arrays.push(node);
      for (const child of node.$_content) if (is_Node(child)) visit(child);
    };
    visit(root);
    return arrays[0];
  })();
  assert.ok(nestedArray);
  assert.deepEqual(indexes(nestedArray), ["0", "1", "2", "3"]);
  for (let position = 0; position < 4; position += 1) {
    assert.notEqual(data.at(["items", position]).snap(), undefined);
  }
});

check("exact graph decoding rejects physical/index permutations without repairing them", () => {
  const payload = exact_tagged_payload(invalid_tagged_graphs[0].value);
  const representation = hson.fromHson(payload).toJson().value();
  if (typeof representation !== "object" || representation === null || Array.isArray(representation)) {
    throw new Error("Expected exact value representation record.");
  }
  assert.equal(Object.hasOwn(representation, "valueKind"), true);
  assert.throws(() => encode_exact_hson_value(reversed));
  assert.throws(() => decode_exact_hson_value(payload));
  assert.throws(() => decode_locus_graph_content({ format: "hson-graph", payload }));
  const decoded = decode_exact_hson_value(encode_exact_hson_value(ordered));
  assert.ok(is_Node(decoded));
  assert.deepEqual(payload_tags(decoded), ["a", "b"]);
  assert.deepEqual(indexes(decoded), ["0", "1"]);
  assert.equal(canonical_hson_graph_equal(decoded, ordered), true);
  const locusDecoded = decode_locus_graph_content({
    format: "hson-graph",
    payload: encode_exact_hson_value(ordered),
  });
  assert.ok(is_Node(locusDecoded));
  assert.deepEqual(payload_tags(locusDecoded), ["a", "b"]);
  assert.throws(() => decode_exact_hson_value(
    hson.fromJson({ ...representation, unexpectedField: true }).toHson().noBreak().serialize(),
  ));
  assert.throws(() => decode_exact_hson_value(exact_tagged_payload(tagged_node("_hson_arr", [
    tagged_item("0", tagged_node("_hson_str", [{ type: "string", value: "a" }])),
    tagged_item("0", tagged_node("_hson_str", [{ type: "string", value: "b" }])),
  ]))));
});

check("canonical document snapshots reject array structure inside an element branch", () => {
  const capture = {
    kind: "hson-document" as const,
    mode: "document" as const,
    rev: 4,
    root: {
      $_tag: "_hson_root",
      $_content: [{
        $_tag: "_hson_elem",
        $_content: [{
          $_tag: "data",
          $_content: [{
            $_tag: "_hson_arr",
            $_content: [scalar_item("0", "a"), scalar_item("1", "b")],
          }],
        }],
      }],
    } satisfies HsonNode,
  };
  assert.throws(
    () => encode_view_state_snapshot(capture),
    /View-state snapshot graph is invalid/,
  );
});

check("canonical invariant requires physical order to equal index order", () => {
  assert.doesNotThrow(() => assert_invariants(ordered));
  assert.throws(() => assert_invariants(reversed), /physical _hson_ii order/);
});

process.stdout.write(`# ${checks} canonical array-index checks passed\n`);
testEvents.terminal("pass");
