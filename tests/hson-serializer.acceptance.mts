import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";

import { hson, hsonString } from "../src/hson.ts";
import { hsonTransform } from "../src/api/transform/index.ts";
import {
  assertCanonicalClosure,
  assertCanonicalSerializedClosure,
} from "../src/_tests/transform-oracle.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { parse_json } from "../src/api/transform/parsers/parse-json.ts";
import { tokenize_hson } from "../src/api/transform/parsers/tokenize-hson.ts";
import { assert_invariants } from "../src/core/assert-invariants.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { normalize_hson_array_index_order } from "../src/core/hson-array-indexes.ts";
import { EVERY_VSN, VSN_TAGS } from "../src/core/constants.ts";
import {
  serialize_hson,
  serialize_hson_owned_element_text_fragment,
} from "../src/api/transform/serializers/serialize-hson.ts";
import { serialize_html } from "../src/api/transform/serializers/serialize-html.ts";
import { serialize_json } from "../src/api/transform/serializers/serialize-json.ts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import { get_node_by_quid } from "../src/api/livetree/quid/data-quid.ts";
import { TOKEN_KIND } from "../src/api/transform/token.types.ts";
import type { HsonMeta, HsonNode } from "../src/core/types.ts";
import { TransformError } from "../src/core/errors.ts";

let checks = 0;

function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function parse(source: string): HsonNode {
  return hson.fromHson(source).toNode();
}

function readable(node: HsonNode): string {
  return hson.fromNode(node).toHson().serialize();
}

function compact(node: HsonNode): string {
  return hson.fromNode(node).toHson().noBreak().serialize();
}

function parse_serialized_value(source: string): HsonNode {
  return detach_hson_root_value(parse_hson(source));
}

function assert_vsn_free_wire(source: string): void {
  for (const token of tokenize_hson(source)) {
    if (token.kind !== TOKEN_KIND.OPEN) continue;
    const authoredHeader = source.slice(token.pos.index + 1).trimStart();
    if (token.tag.startsWith("_hson_")) {
      assert.equal(
        authoredHeader.startsWith(token.tag) || authoredHeader.startsWith(`\`${token.tag}`),
        false,
        `serializer exposed internal tag <${token.tag}>`,
      );
    }
    assert.notEqual(token.tag, "$_meta", "serializer exposed a raw metadata container");
    for (const attr of token.rawAttrs) {
      assert.equal(
        ["$_meta", "hson:index", "data-_index"].includes(attr.name),
        false,
        `serializer exposed raw metadata attribute ${attr.name}`,
      );
    }
  }
}

function assert_wire_closure(
  original: HsonNode,
  source: string,
  expected: HsonNode = original,
): HsonNode {
  assert_vsn_free_wire(source);
  const reparsed = assertCanonicalSerializedClosure({
    launcher: "transform.hson-serializer",
    caseId: "serializer-wire-closure",
    node: original,
    serialized: source,
    expectedNode: expected,
    ingress: "canonical-node",
  });
  assert.equal(reparsed.$_tag === "_hson_root", false, "detached closure leaked a root carrier");
  return reparsed;
}

function assert_hson_closure(node: HsonNode): string {
  const result = assertCanonicalClosure({
    launcher: "transform.hson-serializer",
    caseId: `serializer-closure:${node.$_tag}`,
    ingress: "canonical-node",
    node,
  });
  assert_vsn_free_wire(result.serialized);
  return result.serialized;
}

function elementWithAttrs(attrs: NonNullable<HsonNode["$_attrs"]>): HsonNode {
  return {
    $_tag: "_hson_elem",
    $_content: [{ $_tag: "tag", $_attrs: attrs, $_content: [] }],
  };
}

function elementWithTypedStyle(value: unknown): HsonNode {
  const style: Record<string, unknown> = { width: value };
  const attrs: NonNullable<HsonNode["$_attrs"]> = {};
  Reflect.set(attrs, "style", style);
  return elementWithAttrs(attrs);
}

function elementWithMeta(meta: NonNullable<HsonNode["$_meta"]>): HsonNode {
  return {
    $_tag: "_hson_elem",
    $_content: [{ $_tag: "tag", $_meta: meta, $_content: [] }],
  };
}

function assertEveryNodeBoundaryRejects(node: HsonNode): void {
  for (const boundary of [
    () => assert_invariants(node, "descriptor-safe boundary"),
    () => serialize_hson(node),
    () => serialize_html(node),
    () => serialize_json(node),
    () => hsonTransform.fromNode(node).toNode(),
  ]) {
    assert.throws(boundary);
  }
}

function onlyElement(node: HsonNode): HsonNode {
  assert.equal(node.$_tag, "_hson_elem");
  return node.$_content[0] as HsonNode;
}

check("official HSON serialization remains an exact primitive string", () => {
  const node = parse(`<panel "ready"/>`);
  const direct = serialize_hson(node);
  const fluent = hson.fromNode(node).toHson().serialize();
  assert.equal(typeof direct, "string");
  assert.equal(direct, `<panel "ready"/>`);
  assert.equal(fluent, direct);
  assert.deepEqual(parse(fluent), node);
});

check("hson.transform.string returns canonical valid HSON as a primitive string", () => {
  const normalized = hson.transform.string(`<panel "ready"/>`);
  const named = hsonString(`<panel "ready"/>`);
  assert.equal(hson.transform.string, hsonString);
  assert.equal(typeof normalized, "string");
  assert.equal(normalized, `<panel "ready"/>`);
  assert.equal(named, normalized);
});

check("hson.transform.string normalizes irregular and compact source to default readable output", () => {
  assert.equal(hson.transform.string(`<tag count=2/>`), `<tag count="2"/>`);
  assert.equal(
    hson.transform.string(`<p "first"<em "middle"/>"last"/>`),
    `<p\n  "first"\n  <em "middle"/>\n  "last"\n/>`,
  );
});

check("hson.transform.string preserves canonical QUID metadata through default serialization", () => {
  const normalized = hson.transform.string(
    `<panel class="x" @d1r6x8qwc hidden "Content"/>`,
  );
  assert.equal(
    normalized,
    `<panel @d1r6x8qwc class="x" hidden "Content"/>`,
  );
  assert.equal(onlyElement(parse(normalized)).$_meta?.["quid"], "d1r6x8qwc");
});

check("hson.transform.string preserves negative zero and empty element/object modes", () => {
  const negativeZero = hson.transform.string(`<value -0>`);
  const negativeZeroNode = parse(negativeZero);
  const negativeZeroLeaf = (((negativeZeroNode.$_content[0] as HsonNode)
    .$_content[0] as HsonNode).$_content[0] as HsonNode);
  assert.equal(negativeZero, `<value -0>`);
  assert.equal(Object.is(negativeZeroLeaf.$_content[0], -0), true);
  assert.equal(hson.transform.string(`<tag/>`), `<tag/>`);
  assert.equal(hson.transform.string(`<>`), `<>`);
});

check("authored exponent alternatives canonicalize while invalid signs and zeroes never normalize", () => {
  assert.deepEqual(
    ["1E3", "1e+3", "1e-3", "-0"].map(hson.transform.string),
    ["1000", "1000", "0.001", "-0"],
  );
  for (const [source, code] of [
    ["01", "HSON_NUMBER_LEADING_ZERO"],
    ["+1", "HSON_NUMBER_LEADING_PLUS"],
  ] as const) {
    assert.throws(
      () => hson.transform.string(source),
      (cause) => cause instanceof TransformError && cause.code === code,
    );
  }
});

check("hson.transform.string is idempotent and reparses to the first canonical graph", () => {
  const source = `<p id="x" "first"<em "middle"/>"last"/>`;
  const firstGraph = parse(source);
  const normalized = hson.transform.string(source);
  assert.equal(hson.transform.string(normalized), normalized);
  assert.equal(canonical_hson_graph_equal(parse(normalized), firstGraph), true);
});

check("hson.transform.string retains existing syntax, name, metadata, and number rejection", () => {
  assert.throws(() => hson.transform.string(`<tag "unterminated/>`), /unterminated/i);
  assert.throws(() => hson.transform.string(`<tag bad^name="x"/>`), /unexpected (?:character|token)|invalid/i);
  assert.throws(
    () => hson.transform.string(`<_hson_obj @000000000>`),
    /persisted QUID|metadata|_hson_obj/i,
  );
  assert.throws(() => hson.transform.string(`<value NaN>`), /invariant|number|NaN/i);
});

check("@quid parses into metadata and serializes immediately after the tag", () => {
  const node = parse(`<panel class="settings" @d1r6x8qwc hidden "Content"/>`);
  const panel = onlyElement(node);
  assert.equal(panel.$_meta?.["quid"], "d1r6x8qwc");
  assert.equal(compact(node), `<panel @d1r6x8qwc class="settings" hidden "Content"/>`);
  assert.equal(compact(parse(`<panel @000000000/>`)), `<panel @000000000/>`);
  assert.throws(() => parse(`<panel @000000000 @000000000/>`), /duplicate persisted QUID/);
});

function clone_without_quids(node: HsonNode): HsonNode {
  const clone = structuredClone(node);
  const visit = (current: HsonNode): void => {
    if (current.$_meta) {
      delete current.$_meta["quid"];
      if (Object.keys(current.$_meta).length === 0) delete current.$_meta;
    }
    for (const child of current.$_content) {
      if (typeof child === "object" && child !== null && "$_tag" in child) visit(child);
    }
  };
  visit(clone);
  return clone;
}

check("fromHson.toNode returns the detached semantic graph directly", () => {
  const node = hson.fromHson(`<name "Phillip">`).toNode();
  assert.deepEqual(node, {
    $_tag: "_hson_obj",
    $_content: [{
      $_tag: "name",
      $_content: [{
        $_tag: "_hson_obj",
        $_content: [{ $_tag: "_hson_str", $_content: ["Phillip"] }],
      }],
    }],
  });
});

check("HSON source supports direct nodes and HSON reserialization without parse", () => {
  const source = hson.fromHson(`<name "Phillip">`);
  assert.equal("toNode" in source, true);
  assert.equal("toHson" in source, true);
  const output = source.toHson();
  assert.equal("parse" in output, false);
  assert.equal(output.serialize(), `<name "Phillip">`);
  assert.equal(source.toHson().noBreak().serialize(), `<name "Phillip">`);
});

check("normalized JSON and node sources expose direct canonical nodes", () => {
  const jsonSource = hson.fromJson({ name: "Ada", active: true });
  const jsonNode = jsonSource.toNode();
  assert.deepEqual(
    hson.fromHson(jsonSource.toHson().serialize()).toNode(),
    detach_hson_root_value(jsonNode),
  );

  const nodeSource = hson.fromNode(jsonNode);
  assert.equal(nodeSource.toNode(), jsonNode);
});

check("HSON-source readable and compact serialization remain available", () => {
  const source = hson.fromHson(`<p "first" <em "middle"/> "last"/>`);
  assert.equal(
    source.toHson().serialize(),
    `<p\n  "first"\n  <em "middle"/>\n  "last"\n/>`,
  );
  assert.equal(
    source.toHson().noBreak().serialize(),
    `<p "first" <em "middle"/> "last"/>`,
  );
  assert.equal("parse" in source.toHson().withOptions({ noBreak: true }), false);
});

check("fromHson.toNode accepts equivalent multiline and compact HSON", () => {
  const multiline = `<p\n  "first"\n  <em "middle"/>\n  "last"\n/>`;
  const compactSource = `<p "first" <em "middle"/> "last"/>`;
  assert.deepEqual(hson.fromHson(multiline).toNode(), hson.fromHson(compactSource).toNode());
});

check("fromHson.toNode preserves arrays and string-valued attributes", () => {
  const arrayNode = hson.fromHson(`«1,[true,null]»`).toNode();
  const elementNode = hson.fromHson(`<tag count=2 disabled "value"/>`).toNode();
  const tag = elementNode.$_content[0] as HsonNode;
  assert.deepEqual(tag.$_attrs, { count: "2", disabled: "disabled" });
  assert.equal(arrayNode.$_content.length, 2);
});

check("fromHson.toNode preserves malformed-input errors", () => {
  const malformed = hson.fromHson(`<tag "value/>`);
  assert.throws(
    () => malformed.toNode(),
    /unterminated quoted string at 1:6 \(index 5\)/,
  );
});

check("bare Phillip remains invalid as an unquoted object value", () => {
  assert.throws(
    () => hson.fromHson(`<name Phillip>`).toNode(),
    /invalid bare object value "Phillip".*quote string values/,
  );
});

check("compact serializer output reparses through fromHson.toNode", () => {
  const node = hson.fromHson(`<p id="x" "first" <em "middle"/> "last"/>`).toNode();
  const source = hson.fromNode(node).toHson().noBreak().serialize();
  const reparsed = hson.fromHson(source).toNode();
  assert.deepEqual(reparsed, node);
});

check("HSON serialization is lazy after toHson", () => {
  const node = parse(`<tag "before"/>`);
  const builder = hson.fromNode(node).toHson();
  const tag = node.$_content[0] as HsonNode;
  const cluster = tag.$_content[0] as HsonNode;
  const leaf = cluster.$_content[0] as HsonNode;
  leaf.$_content[0] = "after";
  assert.equal(builder.serialize(), `<tag "after"/>`);
});

check("readable and compact layouts differ for complex content", () => {
  const node = parse(`<p "first" <em "middle"/> "last"/>`);
  assert.notEqual(readable(node), compact(node));
});

check("readable mixed-content snapshot", () => {
  const node = parse(`<p "first" <em "middle"/> "last"/>`);
  assert.equal(readable(node), `<p\n  "first"\n  <em "middle"/>\n  "last"\n/>`);
});

check("compact mixed-content snapshot", () => {
  const node = parse(`<p "first" <em "middle"/> "last"/>`);
  assert.equal(compact(node), `<p "first" <em "middle"/> "last"/>`);
});

check("simple headers and content stay conventionally spaced", () => {
  const node = parse(`<tag z="last" attr="value" flag "content"/>`);
  assert.equal(readable(node), `<tag attr="value" z="last" flag "content"/>`);
  assert.equal(compact(node), `<tag attr="value" z="last" flag "content"/>`);
});

check("ordinary attributes are canonical across insertion orders", () => {
  const left = parse(`<tag z="3" a="1" m="2"/>`);
  const right = parse(`<tag m="2" z="3" a="1"/>`);
  assert.equal(readable(left), `<tag a="1" m="2" z="3"/>`);
  assert.equal(readable(left), readable(right));
});

check("ordinary number attributes serialize as quoted strings", () => {
  assert.equal(readable(elementWithAttrs({ count: 2 })), `<tag count="2"/>`);
});

check("ordinary true attributes serialize as quoted strings", () => {
  assert.equal(readable(elementWithAttrs({ enabled: true })), `<tag enabled="true"/>`);
});

check("ordinary false attributes serialize as quoted strings", () => {
  assert.equal(readable(elementWithAttrs({ visible: false })), `<tag visible="false"/>`);
});

check("ordinary null attributes serialize as quoted strings", () => {
  assert.equal(readable(elementWithAttrs({ missing: null })), `<tag missing="null"/>`);
});

check("only exact string-equals-key values serialize as flags", () => {
  assert.equal(readable(elementWithAttrs({ disabled: "disabled" })), `<tag disabled/>`);
  assert.equal(readable(elementWithAttrs({ disabled: true })), `<tag disabled="true"/>`);
  assert.equal(readable(elementWithAttrs({ disabled: false })), `<tag disabled="false"/>`);
  assert.equal(readable(elementWithAttrs({ disabled: null })), `<tag disabled="null"/>`);
});

check("mixed valued attributes remain sorted before sorted flags", () => {
  const node = elementWithAttrs({
    missing: null,
    enabled: true,
    disabled: "disabled",
    count: 2,
  });
  const expected = `<tag count="2" enabled="true" missing="null" disabled/>`;
  assert.equal(readable(node), expected);
  assert.equal(compact(node), expected);
});

check("ordinary quoted attribute escaping is canonical", () => {
  const node = elementWithAttrs({ text: `quote" slash\\ tab\t line\nreturn\r` });
  const expected = `<tag text="quote\\" slash\\\\ tab\\t line\\nreturn\\r"/>`;
  assert.equal(readable(node), expected);
  assert.equal(compact(node), expected);
  assert.deepEqual(onlyElement(parse(expected)).$_attrs, {
    text: `quote" slash\\ tab\t line\nreturn\r`,
  });
});

check("nested object property readable snapshot", () => {
  const node = parse(`<parent <child "value">>`);
  assert.equal(readable(node), `<parent <child "value">>`);
});

check("nested object property compact snapshot", () => {
  const node = parse(`<parent <child "value">>`);
  assert.equal(compact(node), `<parent <child "value">>`);
});

check("array readable snapshot", () => {
  const node = parse(`«1,"two",<name "Ada" active true>,[3,4]»`);
  assert.equal(readable(node), `«\n  1,\n  "two",\n  <\n    name "Ada"\n    active true\n  >,\n  «\n    3,\n    4\n  »\n»`);
});

check("array compact snapshot", () => {
  const node = parse(`«1,"two",<name "Ada" active true>,[3,4]»`);
  assert.equal(compact(node), `«1,"two",<name "Ada" active true>,«3,4»»`);
});

check("empty object and array snapshots", () => {
  assert.equal(readable(parse(`<>`)), `<>`);
  assert.equal(compact(parse(`<>`)), `<>`);
  assert.equal(readable(parse(`[]`)), `«»`);
  assert.equal(compact(parse(`[]`)), `«»`);
});

check("quoted names and escaped string content snapshot", () => {
  const node = parse(`<'this is a tag' title="a\\\"b" disabled "slash\\\\ tab\\t line\\nnext"/>`);
  const expected = `<'this is a tag' title="a\\\"b" disabled "slash\\\\ tab\\t line\\nnext"/>`;
  assert.equal(readable(node), expected);
  assert.equal(compact(node), expected);
});

check("noQuid filters only the exact persisted QUID key", () => {
  const node = parse(`<tag @000000001 data-user="keep" "value"/>`);
  const plain = readable(node);
  const filtered = hson.fromNode(node).toHson().noQuid().serialize();
  assert.match(plain, /@000000001/);
  assert.doesNotMatch(filtered, /@[0123456789abcdefghjkmnpqrstvwxyz]{9}/);
  assert.match(filtered, /data-user="keep"/);
  assert.notEqual(plain, filtered);
});

check("noBreak and noQuid compose in either order", () => {
  const node = parse(`<p @000000002 "first" <em "middle"/> "last"/>`);
  const left = hson.fromNode(node).toHson().noBreak().noQuid().serialize();
  const right = hson.fromNode(node).toHson().noQuid().noBreak().serialize();
  assert.equal(left, right);
  assert.equal(left, `<p "first" <em "middle"/> "last"/>`);
});

check("withOptions composes with convenience methods", () => {
  const node = parse(`<p @000000003 "first" <em "middle"/> "last"/>`);
  const expected = `<p "first" <em "middle"/> "last"/>`;
  assert.equal(
    hson.fromNode(node).toHson().withOptions({ noBreak: true, noQuid: true }).serialize(),
    expected,
  );
  assert.equal(
    hson.fromNode(node).toHson().withOptions({ noBreak: true }).noQuid().serialize(),
    expected,
  );
  assert.equal(
    hson.fromNode(node).toHson().noBreak().withOptions({ noQuid: true }).serialize(),
    expected,
  );
});

check("repeated options are idempotent", () => {
  const node = parse(`<tag @000000004 "value"/>`);
  assert.equal(
    hson.fromNode(node).toHson().noBreak().noBreak().noQuid().noQuid().serialize(),
    `<tag "value"/>`,
  );
});

check("noQuid does not mutate or contaminate the source graph", () => {
  const node = parse(`<tag @000000005 data-user="keep" "value"/>`);
  const before = structuredClone(node);
  const filtered = hson.fromNode(node).toHson().noQuid().serialize();
  assert.deepEqual(node, before);
  assert.doesNotMatch(filtered, /@[0123456789abcdefghjkmnpqrstvwxyz]{9}/);
  assert.match(readable(node), /@000000005/);
});

check("noQuid does not register imported identity", () => {
  const quid = "000000006";
  const node = parse(`<tag @${quid} "value"/>`);
  assert.equal(get_node_by_quid(quid), undefined);
  hson.fromNode(node).toHson().noQuid().serialize();
  assert.equal(get_node_by_quid(quid), undefined);
});

check("parsed noQuid graph equals the graph with only QUID fields removed", () => {
  const node = parse(`<p @000000007 data-user="keep" "first" <em @000000008 "middle"/>/>`);
  const wire = hson.fromNode(node).toHson().noQuid().serialize();
  assert.deepEqual(parse(wire), clone_without_quids(node));
});

check("native HSON array order regenerates canonical positional indexes", () => {
  const node = parse(`«"a","b",<name "Ada">»`);
  const wire = hson.fromNode(node).toHson().noQuid().serialize();
  const reparsed = parse(wire);
  assert.deepEqual(reparsed, node);
  assert.deepEqual(
    reparsed.$_content.map((item) => (item as HsonNode).$_meta?.["index"]),
    ["0", "1", "2"],
  );
});

check("empty literal root fails at the root egress boundary", () => {
  const emptyRoot: HsonNode = { $_tag: "_hson_root", $_content: [] };
  assert.throws(
    () => readable(emptyRoot),
    /_hson_root is an internal attachment carrier/,
  );
});

check("detached empty object remains representable", () => {
  const node = parse(`<>`);
  assert.equal(readable(node), `<>`);
});

const boundaryCases: ReadonlyArray<readonly [string, string]> = [
  [`<tag "text"/>`, `<tag "text"/>`],
  [`<tag 2>`, `<tag 2>`],
  [`<tag attr="value"/>`, `<tag attr="value"/>`],
  [`<tag attr="value" flag/>`, `<tag attr="value" flag/>`],
  [`<tag flag "text"/>`, `<tag flag "text"/>`],
  [`<wrapper <tag flag "2"/>/>`, `<wrapper <tag flag "2"/>/>`],
  [`<p "text" <child/>/>`, `<p "text" <child/>/>`],
  [`<tag 1 child "value">`, `<tag 1 child "value">`],
  [`<p <a/> <b/>/>`, `<p <a/> <b/>/>`],
  [`<a <b <c "x"/>/>/>`, `<a <b <c "x"/>/>/>`],
  [`<a <b <c "x">>>`, `<a <b <c "x">>>`],
  [`«<name "Ada" active true>»`, `«<name "Ada" active true>»`],
  [`«[1,2],[3,[4]]»`, `««1,2»,«3,«4»»»`],
  [`<'tag name' "text"/>`, `<'tag name' "text"/>`],
  [`<empty <>>`, `<empty <>>`],
  [`<items []>`, `<items «»>`],
];

for (const [source, expected] of boundaryCases) {
  check(`compact boundary: ${source}`, () => {
    assert.equal(compact(parse(source)), expected);
  });
}

const equivalenceSources = [
  `<tag attr="value" flag "content"/>`,
  `<p "first" <em "middle"/> "last"/>`,
  `<parent <child "value">>`,
  `«1,"two",<name "Ada" active true>,[3,4]»`,
  `<'quoted key' data-user="meta" "a\\\"b\\\\c\\tline\\nnext"/>`,
  `<>`,
  `[]`,
];

for (const source of equivalenceSources) {
  check(`readable/compact parse equivalence: ${source}`, () => {
    const node = parse(source);
    assert.deepEqual(parse(readable(node)), node);
    assert.deepEqual(parse(compact(node)), node);
    assert.deepEqual(parse(readable(node)), parse(compact(node)));
  });
}

check("programmatic primitive attributes canonicalize to strings on reparse", () => {
  const node = elementWithAttrs({
    count: 2,
    enabled: true,
    visible: false,
    missing: null,
  });
  const expectedWire = `<tag count="2" enabled="true" missing="null" visible="false"/>`;
  assert.equal(readable(node), expectedWire);
  assert.equal(compact(node), expectedWire);
  assert.deepEqual(onlyElement(parse(expectedWire)).$_attrs, {
    count: "2",
    enabled: "true",
    missing: "null",
    visible: "false",
  });
});

check("quoted and unquoted attribute input both parse as strings", () => {
  const unquoted = parse(`<tag count=2/>`);
  const quoted = parse(`<tag count="2"/>`);
  assert.deepEqual(onlyElement(unquoted).$_attrs, { count: "2" });
  assert.deepEqual(onlyElement(quoted).$_attrs, { count: "2" });
  assert.equal(readable(unquoted), `<tag count="2"/>`);
  assert.equal(readable(quoted), `<tag count="2"/>`);
});

check("string-valued ordinary attributes retain exact graph round trips", () => {
  const node = parse(`<tag count="2" enabled="true" missing="null"/>`);
  assert.deepEqual(parse(readable(node)), node);
  assert.deepEqual(parse(compact(node)), node);
});

check("attribute wire canonicalization does not mutate source values", () => {
  const node = elementWithAttrs({ count: 2, enabled: true, missing: null });
  const before = structuredClone(node);
  assert.equal(readable(node), `<tag count="2" enabled="true" missing="null"/>`);
  assert.deepEqual(node, before);
  assert.equal(compact(node), `<tag count="2" enabled="true" missing="null"/>`);
  assert.deepEqual(node, before);
  assert.equal(typeof onlyElement(node).$_attrs?.count, "number");
  assert.equal(typeof onlyElement(node).$_attrs?.enabled, "boolean");
  assert.equal(onlyElement(node).$_attrs?.missing, null);
});

check("all HSON option combinations retain quoted ordinary attributes", () => {
  const node = elementWithAttrs({
    count: 2,
    "data-user": "keep",
    disabled: "disabled",
    enabled: true,
  });
  onlyElement(node).$_meta = {
    quid: "000000009",
  };
  const builder = () => hson.fromNode(node).toHson();
  const plain = `<tag @000000009 count="2" data-user="keep" enabled="true" disabled/>`;
  const filtered = `<tag count="2" data-user="keep" enabled="true" disabled/>`;
  assert.equal(builder().serialize(), plain);
  assert.equal(builder().noBreak().serialize(), plain);
  assert.equal(builder().noQuid().serialize(), filtered);
  assert.equal(builder().noBreak().noQuid().serialize(), filtered);
  assert.equal(builder().noQuid().noBreak().serialize(), filtered);
  const withOptions = builder().withOptions({ noBreak: true, noQuid: true }).serialize();
  assert.equal(withOptions, filtered);
  assert.doesNotMatch(withOptions, /count=2(?:\s|\/|>)/);
});

check("quoted ordinary attributes are unchanged for structured block content", () => {
  const node = parse(`<p @00000000a "first" <em "middle"/> "last"/>`);
  onlyElement(node).$_attrs = { count: 2, disabled: "disabled" };
  assert.equal(
    readable(node),
    `<p @00000000a count="2" disabled\n  "first"\n  <em "middle"/>\n  "last"\n/>`,
  );
  assert.equal(
    hson.fromNode(node).toHson().noBreak().noQuid().serialize(),
    `<p count="2" disabled "first" <em "middle"/> "last"/>`,
  );
});

check("structured style serialization remains normalized and string-valued", () => {
  const node: HsonNode = {
    $_tag: "_hson_elem",
    $_content: [{
      $_tag: "tag",
      $_attrs: { style: { width: { value: 2, unit: "px" }, marginTop: 2, color: "red" } },
      $_content: [],
    }],
  };
  const wire = readable(node);
  assert.equal(wire, `<tag style="color: red; margin-top: 2; width: 2px"/>`);
  const reparsedTag = parse(wire).$_content[0] as HsonNode;
  assert.deepEqual(reparsedTag.$_attrs?.style, { color: "red", marginTop: "2", width: "2px" });
});

check("typed style admission preserves all ordinary own unit states", () => {
  const cases = [
    [{ value: 2 }, false, undefined, `<tag style="width: 2"/>`],
    [{ value: 2, unit: undefined }, true, undefined, `<tag style="width: 2"/>`],
    [{ value: 2, unit: "px" }, true, "px", `<tag style="width: 2px"/>`],
    [{ value: 2, unit: "" }, true, "", `<tag style="width: 2"/>`],
  ] as const;

  for (const [typed, hasUnit, expectedUnit, expectedWire] of cases) {
    const source = elementWithTypedStyle(typed);
    assert.doesNotThrow(() => assert_invariants(source, "typed style own-data admission"));
    assert.equal(readable(source), expectedWire);

    const detached = hsonTransform.fromNode(source).toNode();
    const style = onlyElement(detached).$_attrs?.style;
    const width = style?.width;
    assert.equal(typeof width, "object");
    assert.notEqual(width, null);
    if (typeof width !== "object" || width === null) throw new Error("missing detached typed style");
    assert.equal(Object.hasOwn(width, "value"), true);
    assert.equal(Reflect.get(width, "value"), 2);
    assert.equal(Object.hasOwn(width, "unit"), hasUnit);
    assert.equal(Reflect.get(width, "unit"), expectedUnit);
  }

  const fixedDescriptors = Object.defineProperties({}, {
    value: { configurable: false, enumerable: true, value: 2, writable: false },
    unit: { configurable: false, enumerable: true, value: "px", writable: false },
  });
  const symbolDecorated = { value: 2, [Symbol("nonsemantic")]: "ignored" };
  assert.doesNotThrow(() => assert_invariants(elementWithTypedStyle(fixedDescriptors), "typed style descriptor flags"));
  assert.doesNotThrow(() => assert_invariants(elementWithTypedStyle(symbolDecorated), "typed style symbol decoration"));
});

check("typed style rejects inherited semantic fields", () => {
  function rejectsWithPollutedPrototype(key: "value" | "unit", leaf: Record<string, unknown>, inherited: unknown): boolean {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
    let rejected = false;
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: inherited,
    });
    try {
      try {
        assert_invariants(elementWithTypedStyle(leaf), `typed style inherited ${key}`);
      } catch {
        rejected = true;
      }
    } finally {
      Reflect.deleteProperty(Object.prototype, key);
      if (previous !== undefined) Object.defineProperty(Object.prototype, key, previous);
    }
    return rejected;
  }

  assert.equal(rejectsWithPollutedPrototype("value", {}, 2), true);
  assert.equal(rejectsWithPollutedPrototype("unit", { value: 2 }, "px"), true);
});

check("typed style rejects accessors without invoking them", () => {
  let getterCalls = 0;
  const throwingValue = Object.defineProperty({}, "value", {
    enumerable: true,
    get(): never {
      getterCalls += 1;
      throw new Error("typed value getter must not run");
    },
  });
  const changingUnit = Object.defineProperties({ value: 2 }, {
    unit: {
      enumerable: true,
      get(): string {
        getterCalls += 1;
        return getterCalls % 2 === 0 ? "px" : "rem";
      },
    },
  });
  const setterOnly = Object.defineProperty({}, "value", {
    enumerable: true,
    set(_value: unknown): void {
      getterCalls += 1;
    },
  });
  const styleEntryAccessor = Object.defineProperty({}, "width", {
    enumerable: true,
    get(): never {
      getterCalls += 1;
      throw new Error("style entry getter must not run");
    },
  });

  for (const candidate of [throwingValue, changingUnit, setterOnly]) {
    assert.throws(
      () => assert_invariants(elementWithTypedStyle(candidate), "typed style accessor rejection"),
      /malformed attribute value/,
    );
  }
  const accessorAttrs: NonNullable<HsonNode["$_attrs"]> = {};
  Reflect.set(accessorAttrs, "style", styleEntryAccessor);
  assert.throws(
    () => assert_invariants(elementWithAttrs(accessorAttrs), "style entry accessor rejection"),
    /malformed attribute value/,
  );
  assert.equal(getterCalls, 0);
});

check("typed style rejects hidden semantic fields and malformed ordinary shapes", () => {
  const hiddenValue = Object.defineProperty({}, "value", { enumerable: false, value: 2 });
  const hiddenUnit = Object.defineProperty({ value: 2 }, "unit", { enumerable: false, value: "px" });
  const malformed = [
    hiddenValue,
    hiddenUnit,
    {},
    { value: undefined },
    { value: true },
    { value: Number.NaN },
    { value: 2, unit: 1 },
    { value: 2, extra: undefined },
  ];
  for (const candidate of malformed) {
    assert.throws(
      () => assert_invariants(elementWithTypedStyle(candidate), "typed style malformed shape"),
      /malformed attribute value/,
    );
  }
});

check("attribute accessors reject at every canonical boundary without invocation", () => {
  let calls = 0;
  const throwing: NonNullable<HsonNode["$_attrs"]> = {};
  Object.defineProperty(throwing, "id", {
    enumerable: true,
    get(): never {
      calls += 1;
      throw new Error("attribute getter must not run");
    },
  });
  const changing: NonNullable<HsonNode["$_attrs"]> = {};
  Object.defineProperty(changing, "id", {
    enumerable: true,
    get(): string {
      calls += 1;
      return calls % 2 === 0 ? "second" : "first";
    },
  });
  const setterOnly: NonNullable<HsonNode["$_attrs"]> = {};
  Object.defineProperty(setterOnly, "id", {
    enumerable: true,
    set(_value: string): void {
      calls += 1;
    },
  });

  for (const attrs of [throwing, changing, setterOnly]) {
    assertEveryNodeBoundaryRejects(elementWithAttrs(attrs));
  }

  const containerAccessor = elementWithAttrs({ id: "unused" });
  const element = onlyElement(containerAccessor);
  Reflect.deleteProperty(element, "$_attrs");
  Object.defineProperty(element, "$_attrs", {
    enumerable: true,
    get(): never {
      calls += 1;
      throw new Error("attribute-container getter must not run");
    },
  });
  assertEveryNodeBoundaryRejects(containerAccessor);
  assert.equal(calls, 0);
});

check("metadata accessors reject at every canonical boundary without invocation", () => {
  let calls = 0;
  const accessorMeta: NonNullable<HsonNode["$_meta"]> = {};
  Object.defineProperty(accessorMeta, "quid", {
    enumerable: true,
    get(): never {
      calls += 1;
      throw new Error("metadata getter must not run");
    },
  });
  assertEveryNodeBoundaryRejects(elementWithMeta(accessorMeta));

  const containerAccessor = elementWithMeta({ quid: "000000001" });
  const element = onlyElement(containerAccessor);
  Reflect.deleteProperty(element, "$_meta");
  Object.defineProperty(element, "$_meta", {
    enumerable: true,
    get(): never {
      calls += 1;
      throw new Error("metadata-container getter must not run");
    },
  });
  assertEveryNodeBoundaryRejects(containerAccessor);
  assert.equal(calls, 0);
});

check("required node fields reject accessors at every canonical boundary without invocation", () => {
  let calls = 0;
  const candidates: HsonNode[] = [];

  for (const descriptor of [
    {
      enumerable: true,
      get(): never {
        calls += 1;
        throw new Error("tag getter must not run");
      },
    },
    {
      enumerable: true,
      get(): string {
        calls += 1;
        return calls % 2 === 0 ? "second" : "first";
      },
    },
    {
      enumerable: true,
      set(_value: string): void {
        calls += 1;
      },
    },
  ]) {
    candidates.push(Object.defineProperty({ $_tag: "tag", $_content: [] }, "$_tag", descriptor));
  }

  for (const descriptor of [
    {
      enumerable: true,
      get(): never {
        calls += 1;
        throw new Error("content getter must not run");
      },
    },
    {
      enumerable: true,
      get(): HsonNode["$_content"] {
        calls += 1;
        return calls % 2 === 0 ? [] : [{ $_tag: "child", $_content: [] }];
      },
    },
    {
      enumerable: true,
      set(_value: HsonNode["$_content"]): void {
        calls += 1;
      },
    },
  ]) {
    candidates.push(Object.defineProperty({ $_tag: "tag", $_content: [] }, "$_content", descriptor));
  }

  for (const candidate of candidates) {
    assertEveryNodeBoundaryRejects(candidate);
    assert.throws(() => normalize_hson_array_index_order(candidate, "required-field descriptor rejection"));
  }
  assert.equal(calls, 0);
});

check("required node fields reject inherited and hidden semantic storage", () => {
  const hiddenTag = Object.defineProperty({ $_tag: "tag", $_content: [] }, "$_tag", {
    enumerable: false,
    value: "tag",
  });
  const hiddenContent = Object.defineProperty({ $_tag: "tag", $_content: [] }, "$_content", {
    enumerable: false,
    value: [],
  });
  assertEveryNodeBoundaryRejects(hiddenTag);
  assertEveryNodeBoundaryRejects(hiddenContent);
  assert.throws(() => normalize_hson_array_index_order(hiddenTag, "hidden tag"));
  assert.throws(() => normalize_hson_array_index_order(hiddenContent, "hidden content"));

  for (const [field, value] of [
    ["$_tag", "tag"],
    ["$_content", []],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, field);
    const candidate: HsonNode = { $_tag: "tag", $_content: [] };
    Reflect.deleteProperty(candidate, field);
    Object.defineProperty(Object.prototype, field, {
      configurable: true,
      enumerable: true,
      value,
    });
    try {
      assertEveryNodeBoundaryRejects(candidate);
      assert.throws(() => normalize_hson_array_index_order(candidate, `inherited ${field}`));
    } finally {
      Reflect.deleteProperty(Object.prototype, field);
      if (previous !== undefined) Object.defineProperty(Object.prototype, field, previous);
    }
  }
});

check("content arrays reject accessor, inherited, sparse, and hidden slots without invocation", () => {
  let calls = 0;
  const accessorItems: HsonNode["$_content"][] = [
    Object.defineProperty(["unused"], "0", {
      enumerable: true,
      get(): never {
        calls += 1;
        throw new Error("content item getter must not run");
      },
    }),
    Object.defineProperty(["unused"], "0", {
      enumerable: true,
      set(_value: unknown): void {
        calls += 1;
      },
    }),
    Object.defineProperty(["unused"], "0", {
      enumerable: false,
      value: "hidden",
    }),
  ];
  for (const content of accessorItems) {
    const candidate: HsonNode = { $_tag: "_hson_str", $_content: content };
    assertEveryNodeBoundaryRejects(candidate);
    assert.throws(() => normalize_hson_array_index_order(candidate, "content slot descriptor rejection"));
  }

  const sparse = new Array(1);
  const sparseNode: HsonNode = { $_tag: "_hson_str", $_content: sparse };
  assertEveryNodeBoundaryRejects(sparseNode);
  assert.throws(() => normalize_hson_array_index_order(sparseNode, "sparse content"));

  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  Object.defineProperty(Array.prototype, "0", {
    configurable: true,
    enumerable: true,
    value: "inherited",
    writable: true,
  });
  try {
    const inheritedSlot: HsonNode = { $_tag: "_hson_str", $_content: new Array(1) };
    assertEveryNodeBoundaryRejects(inheritedSlot);
    assert.throws(() => normalize_hson_array_index_order(inheritedSlot, "inherited content slot"));
  } finally {
    Reflect.deleteProperty(Array.prototype, "0");
    if (previous !== undefined) Object.defineProperty(Array.prototype, "0", previous);
  }
  assert.equal(calls, 0);
});

check("required node descriptor flags, null prototypes, and symbols are nonsemantic", () => {
  const fixed: HsonNode = { $_tag: "_hson_str", $_content: ["text"] };
  Object.defineProperties(fixed, {
    $_tag: { configurable: false, enumerable: true, value: "_hson_str", writable: false },
    $_content: { configurable: false, enumerable: true, value: ["text"], writable: false },
  });
  Reflect.set(fixed, Symbol("nonsemantic"), "ignored");
  const nullPrototype = Object.assign(Object.create(null), {
    $_tag: "_hson_str",
    $_content: ["text"],
  });
  assert.doesNotThrow(() => assert_invariants(fixed, "fixed required descriptors"));
  assert.doesNotThrow(() => assert_invariants(nullPrototype, "null-prototype node"));
  assert.equal(canonical_hson_graph_equal(fixed, nullPrototype), true);
  assert.equal(serialize_hson(fixed), `"text"`);
  assert.equal(serialize_hson(nullPrototype), `"text"`);
  assert.equal(canonical_hson_graph_equal(hsonTransform.fromNode(fixed).toNode(), nullPrototype), true);

  const customPrototype = Object.assign(Object.create({ decoration: true }), {
    $_tag: "_hson_str",
    $_content: ["text"],
  });
  assert.throws(() => assert_invariants(customPrototype, "custom node prototype"), /plain object/);
});

check("attribute and metadata records reject hidden or inherited semantic state", () => {
  const hiddenAttrs: NonNullable<HsonNode["$_attrs"]> = {};
  Object.defineProperty(hiddenAttrs, "id", { enumerable: false, value: "x" });
  assert.throws(() => assert_invariants(elementWithAttrs(hiddenAttrs), "hidden attrs"));

  const hiddenMeta: NonNullable<HsonNode["$_meta"]> = {};
  Object.defineProperty(hiddenMeta, "quid", { enumerable: false, value: "000000001" });
  assert.throws(() => assert_invariants(elementWithMeta(hiddenMeta), "hidden metadata"));

  const inheritedAttrs: NonNullable<HsonNode["$_attrs"]> = Object.create({ id: "x" });
  assert.throws(() => assert_invariants(elementWithAttrs(inheritedAttrs), "inherited attrs"));

  const previousQuid = Object.getOwnPropertyDescriptor(Object.prototype, "quid");
  let inheritedMetaRejected = false;
  Object.defineProperty(Object.prototype, "quid", {
    configurable: true,
    enumerable: false,
    value: "000000001",
  });
  try {
    try {
      assert_invariants(elementWithMeta({}), "inherited metadata");
    } catch {
      inheritedMetaRejected = true;
    }
  } finally {
    Reflect.deleteProperty(Object.prototype, "quid");
    if (previousQuid !== undefined) Object.defineProperty(Object.prototype, "quid", previousQuid);
  }
  assert.equal(inheritedMetaRejected, true);
});

check("ordinary attrs and metadata preserve portable data semantics", () => {
  const attrs: NonNullable<HsonNode["$_attrs"]> = Object.create(null);
  Object.defineProperties(attrs, {
    id: { configurable: false, enumerable: true, value: "x", writable: false },
    style: {
      configurable: false,
      enumerable: true,
      value: { width: { value: 2, unit: "px" } },
      writable: false,
    },
  });
  Reflect.set(attrs, Symbol("nonsemantic"), "ignored");

  const meta: NonNullable<HsonNode["$_meta"]> = Object.create(null);
  Object.defineProperty(meta, "quid", {
    configurable: false,
    enumerable: true,
    value: "000000001",
    writable: false,
  });
  Reflect.set(meta, Symbol("nonsemantic"), "ignored");

  const graph = elementWithAttrs(attrs);
  onlyElement(graph).$_meta = meta;
  assert.doesNotThrow(() => assert_invariants(graph, "portable attr/meta records"));
  assert.equal(readable(graph), `<tag @000000001 id="x" style="width: 2px"/>`);
  assert.match(serialize_html(graph), /id="x"/);
  assert.match(serialize_json(graph), /"quid": "000000001"/);

  const detached = hsonTransform.fromNode(graph).toNode();
  const detachedElement = onlyElement(detached);
  assert.equal(detachedElement.$_attrs?.id, "x");
  const detachedWidth = detachedElement.$_attrs?.style?.width;
  assert.equal(typeof detachedWidth, "object");
  if (typeof detachedWidth !== "object" || detachedWidth === null) throw new Error("missing detached width");
  assert.equal(Object.hasOwn(detachedWidth, "unit"), true);
  assert.equal(Reflect.get(detachedWidth, "unit"), "px");
  assert.equal(detachedElement.$_meta?.quid, "000000001");

  const array = hson.fromHson(`«1»`).toNode();
  const item = array.$_content[0];
  if (typeof item !== "object" || item === null) throw new Error("missing canonical array item");
  const index = item.$_meta?.index;
  assert.equal(index, "0");
  if (item.$_meta === undefined) throw new Error("missing canonical array index metadata");
  Object.defineProperty(item.$_meta, "index", {
    configurable: false,
    enumerable: true,
    value: index,
    writable: false,
  });
  assert.doesNotThrow(() => assert_invariants(array, "fixed array-index metadata"));
  assert.equal(hsonTransform.fromNode(array).toHson().noBreak().serialize(), `«1»`);

  assert.doesNotThrow(() => assert_invariants({ $_tag: "_hson_str", $_meta: {}, $_content: ["m"] }, "present-empty metadata"));
  assert.throws(() => assert_invariants(elementWithAttrs({}), "empty attrs"), /empty \$_attrs/);
});

check("ordinary HTML serialization uses textual primitives and typed inline CSS leaves", () => {
  const node = elementWithAttrs({
    disabled: "disabled",
    empty: "",
    enabled: true,
    missing: null,
    visible: false,
    zero: 0,
    style: { width: { value: 1.25, unit: "rem" } },
  });
  assert.equal(
    hson.fromNode(node).toHtml().serialize(),
    `<tag disabled empty="" enabled="true" missing="null" style="width: 1.25rem" visible="false" zero="0"></tag>`,
  );
});

check("nested inline stylesheet structures fail before HSON or HTML emission", () => {
  const malformed = elementWithAttrs({ style: { _hover: { color: "blue" } } });
  for (const serialize of [
    () => readable(malformed),
    () => hson.fromNode(malformed).toHtml().serialize(),
  ]) {
    assert.throws(serialize, (cause) => cause instanceof Error
      && /malformed attribute value/.test(cause.message)
      && !cause.message.includes("[object Object]"));
  }
});

check("unsupported structural VSN metadata is rejected with its VSN and path", () => {
  for (const tag of ["_hson_root", "_hson_elem", "_hson_obj", "_hson_arr", "_hson_str", "_hson_val"]) {
    const content = tag === "_hson_root"
      ? [{ $_tag: "_hson_elem", $_content: [] }]
      : tag === "_hson_str"
        ? ["value"]
        : tag === "_hson_val"
          ? [1]
          : [];
    const node = {
      $_tag: tag,
      $_meta: { "data-_custom": "lost" } as unknown as HsonMeta,
      $_content: content,
    } as HsonNode;
    assert.throws(
      () => assert_invariants(node, "structural metadata acceptance"),
      (cause) => cause instanceof Error
        && cause.message.includes(`unknown canonical metadata key`)
        && cause.message.includes(`@meta:"data-_custom"`)
        && cause.message.includes(`/${tag}`),
    );
  }

  const item: HsonNode = {
    $_tag: "_hson_ii",
    $_meta: { index: "0", "data-_custom": "lost" } as unknown as HsonMeta,
    $_content: [{ $_tag: "_hson_str", $_content: ["value"] }],
  };
  const array: HsonNode = { $_tag: "_hson_arr", $_content: [item] };
  assert.throws(
    () => assert_invariants(array, "structural metadata acceptance"),
    /_hson_ii.*data-_custom.*unknown canonical metadata key/,
  );
});

check("unknown reserved standard-tag metadata is default-deny at every HSON boundary", () => {
  const node: HsonNode = {
    $_tag: "_hson_elem",
    $_content: [{
      $_tag: "section",
      $_content: [{
        $_tag: "_hson_elem",
        $_content: [{
          $_tag: "span",
          $_meta: { "data-_custom": "invalid" } as unknown as HsonMeta,
          $_content: [{
            $_tag: "_hson_elem",
            $_content: [],
          }],
        }],
      }],
    }],
  };
  for (const operation of [
    () => hson.fromNode(node).toNode(),
    () => serialize_hson(node),
  ]) {
    assert.throws(
      operation,
      (cause) => cause instanceof Error
        && cause.message.includes(`/tag:section/_hson_elem/[0]/tag:span`)
        && cause.message.includes(`@meta:"data-_custom"`)
      && cause.message.includes(`unknown canonical metadata key`),
    );
  }

  assert.throws(
    () => parse(`<section <span hson:unknown="invalid"/>/>`),
    (cause) => cause instanceof TransformError
      && cause.code === "HSON_AUTHORED_METADATA_FORBIDDEN",
  );
  assert.deepEqual(
    onlyElement(parse(`<section data-_custom="ordinary"/>`)).$_attrs,
    { "data-_custom": "ordinary" },
  );

  assert.throws(
    () => hson.fromNode({
      $_tag: "section",
      $_attrs: { "hson:unknown": "invalid" },
      $_content: [],
    }).toNode(),
    (cause) => cause instanceof Error
      && cause.message.includes(`/tag:section@attrs:"hson:unknown"`)
      && cause.message.includes(`unknown canonical metadata key`),
  );
});

check("index is string-valued only on _hson_ii and canonical position is enforced", () => {
  assert.throws(
    () => parse(`<tag hson:index="3"/>`),
    (cause) => cause instanceof TransformError
      && cause.code === "HSON_AUTHORED_METADATA_FORBIDDEN",
  );
  const invalidValue = parse(`«"value"»`);
  const item = invalidValue.$_content[0] as HsonNode;
  if (!item.$_meta) throw new Error("Expected array index metadata.");
  Reflect.set(item.$_meta, "index", 0);
  assert.throws(
    () => serialize_hson(invalidValue),
    /invalid metadata value for "index"/,
  );
});

check("direct HSON serialization never silently omits unsupported structural metadata", () => {
  const node: HsonNode = {
    $_tag: "_hson_elem",
    $_content: [{
      $_tag: "span",
      $_meta: { "data-_custom": "lost" } as unknown as HsonMeta,
      $_content: [],
    }],
  };
  assert.throws(
    () => serialize_hson(node),
    /span.*data-_custom.*unknown canonical metadata key/,
  );
});

check("the authoritative VSN inventory contains only the seven established tags", () => {
  assert.deepEqual(
    [...EVERY_VSN].sort(),
    [
      "_hson_arr",
      "_hson_elem",
      "_hson_ii",
      "_hson_obj",
      "_hson_root",
      "_hson_str",
      "_hson_val",
    ],
  );
  assert.deepEqual(
    [...VSN_TAGS].sort(),
    EVERY_VSN.filter((tag) => tag !== "_hson_root").sort(),
  );
  assert.throws(
    () => assert_invariants(
      { $_tag: "_hson_future", $_content: [] },
      "VSN inventory",
    ),
    /unknown VSN-like tag "_hson_future"/,
  );
});

check("permissive node ingress normalizes empty storage and ordinary attributes without mutation", () => {
  const source = {
    $_tag: "_hson_root",
    $_content: [{
      $_tag: "_hson_elem",
      $_content: [{
        $_tag: "tag",
        $_attrs: { count: 2, enabled: true, missing: null },
        $_meta: [],
        $_content: [],
      }],
    }],
  } as unknown as HsonNode;
  const before = structuredClone(source);
  const normalized = hson.fromNode(source).toNode();
  assert.deepEqual(source, before);
  const semantic = normalized.$_content[0] as HsonNode;
  const tag = onlyElement(semantic);
  assert.deepEqual(tag.$_attrs, { count: "2", enabled: "true", missing: "null" });
  assert.equal(Object.hasOwn(tag, "$_meta"), false);
  assert.deepEqual(tag.$_content, []);
  assert.equal(compact(semantic), `<tag count="2" enabled="true" missing="null"/>`);

  const emptyAttrs: HsonNode = {
    $_tag: "_hson_root",
    $_content: [{
      $_tag: "_hson_elem",
      $_content: [{ $_tag: "empty", $_attrs: {}, $_content: [] }],
    }],
  };
  assert.throws(
    () => assert_invariants(emptyAttrs, "runtime carrier storage"),
    (error) => error instanceof Error && "code" in error && error.code === "HSON_EMPTY_ATTRIBUTES",
  );
  const emptySemantic = hson.fromNode(emptyAttrs).toNode().$_content[0] as HsonNode;
  assert.equal(Object.hasOwn(onlyElement(emptySemantic), "$_attrs"), false);
});

check("empty _hson_elem and empty _hson_obj remain distinct canonical standard-tag states", () => {
  const elem = parse(`<tag/>`);
  const obj = parse(`<tag <>>`);
  assert.equal(canonical_hson_graph_equal(elem, obj), false);
  assert.equal(compact(elem), `<tag/>`);
  assert.equal(compact(obj), `<tag <>>`);
});

check("object properties and roots reject invalid retained element mode", () => {
  const objectWithElementProperty: HsonNode = {
    $_tag: "_hson_root",
    $_content: [{
      $_tag: "_hson_obj",
      $_content: [{ $_tag: "empty", $_content: [] }],
    }],
  };
  assert.throws(
    () => hson.fromNode(objectWithElementProperty).toNode(),
    /object property must retain/,
  );

  const emptyElementRoot: HsonNode = {
    $_tag: "_hson_root",
    $_content: [{ $_tag: "_hson_elem", $_content: [] }],
  };
  assert.throws(
    () => serialize_hson(emptyElementRoot.$_content[0] as HsonNode),
    /empty _hson_elem is not valid retained canonical state/,
  );
});

check("attribute and metadata names use the tokenizer's unquoted name grammar", () => {
  for (const key of ["", "bad key", "x=y", "`quoted`", `bad"quote`, "bad/close"]) {
    const node = elementWithAttrs({ [key]: "value" });
    assert.throws(
      () => hson.fromNode(node).toNode(),
      (cause) => cause instanceof Error
        && cause.message.includes(`invalid HSON attribute name`)
        && cause.message.includes(`/tag:tag`),
    );
  }
  assert.throws(() => parse(`<tag 'bad key'="value"/>`), /single-quoted names are valid only/);
  const badMeta: HsonNode = {
    $_tag: "_hson_root",
    $_content: [{
      $_tag: "_hson_elem",
      $_content: [{
        $_tag: "tag",
        $_meta: { "data-_bad key": "value" } as unknown as HsonMeta,
        $_content: [{ $_tag: "_hson_elem", $_content: [] }],
      }],
    }],
  };
  assert.throws(
    () => hson.fromNode(badMeta).toNode(),
    /@meta:"data-_bad key": unknown canonical metadata key/,
  );
  assert.equal(compact(parse(`<tag data-item-id="42" aria-label="Example" internal_flag/>`)),
    `<tag aria-label="Example" data-item-id="42" internal_flag/>`);
  const ordinaryData = parse(`<tag data-user="42" data-theme="dark" data-id="7"/>`);
  assert.deepEqual(onlyElement(ordinaryData).$_attrs, {
    "data-id": "7",
    "data-theme": "dark",
    "data-user": "42",
  });
  assert.equal(onlyElement(ordinaryData).$_meta, undefined);
  assert.equal(
    compact(ordinaryData),
    `<tag data-id="7" data-theme="dark" data-user="42"/>`,
  );
  assert.equal(compact(parse(`<'bad key' "value">`)), `<'bad key' "value">`);
});

check("finite HSON numbers round-trip and negative zero retains identity", () => {
  for (const value of [0, -0, 1.5, Number.MAX_VALUE, Number.MIN_VALUE]) {
    const node: HsonNode = {
      $_tag: "_hson_obj",
      $_content: [{
        $_tag: "value",
        $_content: [{
          $_tag: "_hson_obj",
          $_content: [{ $_tag: "_hson_val", $_content: [value] }],
        }],
      }],
    };
    const wire = compact(node);
    const reparsed = parse(wire);
    const leaf = ((reparsed.$_content[0] as HsonNode).$_content[0] as HsonNode)
      .$_content[0] as HsonNode;
    assert.equal(Object.is(leaf.$_content[0], value), true);
  }
});

check("non-finite HSON numbers fail node, JSON, and direct serializer admission", () => {
  for (const value of [Number.NaN, Infinity, -Infinity]) {
    const node: HsonNode = {
      $_tag: "_hson_obj",
      $_content: [{
        $_tag: "nested",
        $_content: [{
          $_tag: "_hson_obj",
          $_content: [{ $_tag: "_hson_val", $_content: [value] }],
        }],
      }],
    };
    for (const operation of [
      () => hson.fromNode(node).toNode(),
      () => serialize_hson(node),
      () => hson.fromJson({ nested: value }).toNode(),
    ]) {
      assert.throws(
        operation,
        (cause) => cause instanceof Error
          && cause.message.includes(`invalid HSON number ${String(value)}`)
          && cause.message.includes(`numbers must be finite`),
      );
    }
  }
});

check("cycles fail deterministically while shared acyclic references serialize by value", () => {
  const cyclic: HsonNode = { $_tag: "loop", $_content: [] };
  cyclic.$_content.push(cyclic);
  assert.throws(
    () => hson.fromNode(cyclic).toNode(),
    /cycle detected.*reference returns to \/loop/,
  );

  const shared: HsonNode = { $_tag: "child", $_content: [] };
  const fragment: HsonNode = {
    $_tag: "_hson_elem",
    $_content: [shared, shared],
  };
  const wire = compact(fragment);
  assert.equal(wire, `<child/> <child/>`);
  const reparsed = parse(wire);
  const children = reparsed.$_content;
  assert.equal(children.length, 2);
  assert.notEqual(children[0], children[1]);
});

check("canonical closure covers every primitive HSON value without wrapper invention", () => {
  const fixtures: ReadonlyArray<readonly [HsonNode, string]> = [
    [{ $_tag: "_hson_str", $_content: [""] }, `""`],
    [{ $_tag: "_hson_str", $_content: ["hello"] }, `"hello"`],
    [{ $_tag: "_hson_val", $_content: [0] }, `0`],
    [{ $_tag: "_hson_val", $_content: [-0] }, `-0`],
    [{ $_tag: "_hson_val", $_content: [42] }, `42`],
    [{ $_tag: "_hson_val", $_content: [-42] }, `-42`],
    [{ $_tag: "_hson_val", $_content: [true] }, `true`],
    [{ $_tag: "_hson_val", $_content: [false] }, `false`],
    [{ $_tag: "_hson_val", $_content: [null] }, `null`],
  ];
  for (const [node, expectedSource] of fixtures) {
    assert.equal(assert_hson_closure(node), expectedSource);
    const reparsed = parse_serialized_value(expectedSource);
    assert.equal(reparsed.$_tag, node.$_tag);
    assert.equal(Object.is(reparsed.$_content[0], node.$_content[0]), true);
  }
});

check("canonical closure covers empty, scalar, nested, array-valued, and ordered objects", () => {
  const fixtures = [
    parse(`<>`),
    parse(`<name "Ada" age 42 active true>`),
    parse(`<person <name "Ada" address <city "Chicago">>>`),
    parse(`<items «1,"two",<name "Ada">»>`),
    parse(`<z 3 a 1 m 2>`),
  ];
  for (const node of fixtures) assert_hson_closure(node);
  assert.deepEqual(
    parse_serialized_value(serialize_hson(fixtures[4])).$_content.map((child) => (child as HsonNode).$_tag),
    ["z", "a", "m"],
  );
});

check("canonical closure covers arrays, reconstructed indexes, nesting, and objects", () => {
  const fixtures = [
    parse(`«»`),
    parse(`«0,-0,true,false,null,"text"»`),
    parse(`«<name "Ada">,<name "Lin">»`),
    parse(`««1,2»,«3,«4»»»`),
    parse(`«<item "one">,<item "two">»`),
  ];
  for (const node of fixtures) {
    const source = assert_hson_closure(node);
    assert.doesNotMatch(source, /hson:index|data-_index/);
    const reparsed = parse_serialized_value(source);
    assert.deepEqual(
      reparsed.$_content.map((item) => (item as HsonNode).$_meta?.index),
      reparsed.$_content.map((_, index) => String(index)),
    );
  }
});

check("canonical closure covers element text, nesting, fragments, QUIDs, and mixed content", () => {
  const fixtures = [
    parse(`<empty/>`),
    parse(`<p "text"/>`),
    parse(`<main <section <span "deep"/>/>/>`),
    parse(`<a/><b/>`),
    parse(`<main @000000013 <aside @000000014/>/>`),
    parse(`<p "before" <em "middle"/> "after"/>`),
  ];
  for (const node of fixtures) assert_hson_closure(node);
});

check("canonical closure preserves ordinary attributes, structured style, and QUID metadata", () => {
  const node = parse(
    `<panel @000000015 aria-label="Settings" disabled style="color: red; margin-top: 2px" "ready"/>`,
  );
  const source = assert_hson_closure(node);
  assert.match(source, /@000000015/);
  assert.match(source, /aria-label="Settings"/);
  assert.match(source, /disabled/);
  assert.doesNotMatch(source, /\$_meta/);

  const before = structuredClone(node);
  const noQuidSource = hson.fromNode(node).toHson().noQuid().serialize();
  assert_wire_closure(node, noQuidSource, clone_without_quids(node));
  assert.deepEqual(node, before);
});

check("direct and fluent serializers have equivalent closure for every HSON option", () => {
  for (const node of [
    parse(`<record <name "Ada" active true> items «1,2»>`),
    parse(`<p @000000016 class="copy" "first" <em "middle"/> "last"/>`),
  ]) {
    const cases = [
      { options: {}, fluent: () => hson.fromNode(node).toHson().serialize() },
      { options: { noBreak: true }, fluent: () => hson.fromNode(node).toHson().noBreak().serialize() },
      { options: { noQuid: true }, fluent: () => hson.fromNode(node).toHson().noQuid().serialize() },
      {
        options: { noBreak: true, noQuid: true },
        fluent: () => hson.fromNode(node).toHson().noBreak().noQuid().serialize(),
      },
    ] as const;
    for (const entry of cases) {
      const direct = serialize_hson(node, entry.options);
      assert.equal(entry.fluent(), direct);
      assert_wire_closure(
        node,
        direct,
        "noQuid" in entry.options && entry.options.noQuid ? clone_without_quids(node) : node,
      );
    }
  }
});

check("serialization is nonmutating and repeated parse/serialize cycles converge", () => {
  const original = parse(
    `<article @000000017 data-user="Ada" "before" <strong "middle"/> "after"/>`,
  );
  const before = structuredClone(original);
  const first = serialize_hson(original);
  assert.deepEqual(original, before);

  let current = parse_serialized_value(first);
  assert.deepEqual(original, before, "parsing serialized output mutated the source graph");
  for (let cycle = 0; cycle < 5; cycle += 1) {
    const nextSource = serialize_hson(current);
    assert.equal(nextSource, first);
    const next = parse_serialized_value(nextSource);
    assert.equal(canonical_hson_graph_equal(original, next), true);
    current = next;
  }
  assert.equal((current.$_content[0] as HsonNode).$_meta?.quid, "000000017");
});

check("forbidden-output inspection distinguishes syntax from user string data", () => {
  const node = parse(`<tag note="_hson_obj $_meta data-_index" "_hson_elem hson:index"/>`);
  const source = assert_hson_closure(node);
  assert.match(source, /_hson_obj \$_meta data-_index/);
  assert.match(source, /_hson_elem hson:index/);
  assert_vsn_free_wire(source);
});

check("invalid roots and malformed structural crossings fail before compatibility emission", () => {
  for (const child of [
    { $_tag: "_hson_str", $_content: ["value"] },
    { $_tag: "_hson_val", $_content: [1] },
    { $_tag: "_hson_obj", $_content: [] },
    { $_tag: "_hson_arr", $_content: [] },
    { $_tag: "_hson_elem", $_content: [{ $_tag: "tag", $_content: [] }] },
  ] satisfies HsonNode[]) {
    assert.throws(
      () => serialize_hson({ $_tag: "_hson_root", $_content: [child] }),
      /_hson_root is an internal attachment carrier/,
    );
  }

  const crossing: HsonNode = {
    $_tag: "_hson_obj",
    $_content: [{
      $_tag: "property",
      $_content: [{
        $_tag: "_hson_elem",
        $_content: [{ $_tag: "child", $_content: [] }],
      }],
    }],
  };
  assert.throws(() => serialize_hson(crossing), /object property must retain/);
});

check("object member metadata and QUIDs are outside the HSON serialization domain", () => {
  const member: HsonNode = {
    $_tag: "member",
    $_meta: { quid: "000000001" },
    $_content: [{
      $_tag: "_hson_obj",
      $_content: [{ $_tag: "_hson_str", $_content: ["value"] }],
    }],
  };
  const node: HsonNode = {
    $_tag: "_hson_obj",
    $_content: [member],
  };
  assert.throws(() => serialize_hson(node), /object member <member> cannot carry metadata or a QUID/);
  assert.throws(
    () => serialize_hson(node, { noQuid: true }),
    /object member <member> cannot carry metadata or a QUID/,
  );

  const unknownMetadata = structuredClone(node);
  (unknownMetadata.$_content[0] as HsonNode).$_meta = { custom: "value" } as unknown as HsonMeta;
  assert.throws(() => serialize_hson(unknownMetadata), /unknown canonical metadata key/);
  assert.throws(() => serialize_hson(unknownMetadata, { noQuid: true }), /unknown canonical metadata key/);

  const attributed = structuredClone(node);
  delete (attributed.$_content[0] as HsonNode).$_meta;
  (attributed.$_content[0] as HsonNode).$_attrs = { title: "value", hidden: "hidden" };
  assert.throws(() => serialize_hson(attributed), /must not have \$_attrs|cannot carry attributes or flags/);
});

check("detached object scalar carriers normalize to strings and typed values", () => {
  for (const leaf of [
    { $_tag: "_hson_str", $_content: ["value"] },
    { $_tag: "_hson_val", $_content: [false] },
    { $_tag: "_hson_val", $_content: [-0] },
  ] satisfies HsonNode[]) {
    const carrier: HsonNode = { $_tag: "_hson_obj", $_content: [leaf] };
    const before = structuredClone(carrier);
    for (const admitted of [
      hsonTransform.fromNode(carrier).toNode(),
      hson.fromNode(carrier).toNode(),
    ]) {
      assert.deepEqual(admitted, leaf);
      if (Object.is(leaf.$_content[0], -0)) {
        assert.equal(Object.is(admitted.$_content[0], -0), true);
      }
    }
    assert.deepEqual(carrier, before);
    assert.throws(() => serialize_hson(carrier), /detached scalar _hson_obj carrier/);
  }
});

check("detached element string carriers normalize to exact text leaves", () => {
  for (const text of ["text", ""]) {
    const leaf: HsonNode = { $_tag: "_hson_str", $_content: [text] };
    const carrier: HsonNode = { $_tag: "_hson_elem", $_content: [leaf] };
    const before = structuredClone(carrier);
    assert.deepEqual(hsonTransform.fromNode(carrier).toNode(), leaf);
    assert.deepEqual(hson.fromNode(carrier).toNode(), leaf);
    assert.deepEqual(carrier, before);
    assert.throws(() => serialize_hson(carrier), /detached scalar _hson_elem carrier/);
  }
});

check("detached element typed carriers reach invariant admission and reject deterministically", () => {
  const started = performance.now();
  const reject = (carrier: HsonNode): Readonly<Record<string, unknown>> => {
    const details: Array<Readonly<Record<string, unknown>>> = [];
    for (const admit of [
      () => hsonTransform.fromNode(carrier).toNode(),
      () => hson.fromNode(carrier).toNode(),
    ]) {
      let observed: TransformError | undefined;
      assert.throws(
        admit,
        (cause) => {
          if (!(cause instanceof TransformError)) return false;
          observed = cause;
          return cause.operation === "fromNode"
            && cause.stage === "canonical-invariant-admission"
            && cause.code === "HSON_CANONICAL_INVARIANT_VIOLATION";
        },
      );
      assert.ok(observed);
      details.push({
        operation: observed.operation,
        stage: observed.stage,
        code: observed.code,
        path: observed.path,
      });
    }
    assert.deepEqual(details[1], details[0]);
    return details[0]!;
  };

  for (const value of [false, null, 1, -0]) {
    const carrier: HsonNode = {
      $_tag: "_hson_elem",
      $_content: [{ $_tag: "_hson_val", $_content: [value] }],
    };
    const before = structuredClone(carrier);
    const first = reject(carrier);
    const second = reject(carrier);
    assert.deepEqual(first, {
      operation: "fromNode",
      stage: "canonical-invariant-admission",
      code: "HSON_CANONICAL_INVARIANT_VIOLATION",
      path: undefined,
    });
    assert.deepEqual(second, first);
    assert.deepEqual(carrier, before);
  }
  assert.ok(
    performance.now() - started < 250,
    "mode-sensitive detached element/value rejection must settle synchronously and promptly",
  );
});

check("array semantic values retain valid object and element string detachment", () => {
  for (const carrierTag of ["_hson_obj", "_hson_elem"] as const) {
    const arrayCarrier: HsonNode = {
      $_tag: "_hson_arr",
      $_content: [{
        $_tag: "_hson_ii",
        $_meta: { index: "0" },
        $_content: [{
          $_tag: carrierTag,
          $_content: [{ $_tag: "_hson_str", $_content: ["value"] }],
        }],
      }],
    };
    const admittedArray = hson.fromNode(arrayCarrier).toNode();
    assert.equal(admittedArray.$_tag, "_hson_arr");
    assert.equal(((admittedArray.$_content[0] as HsonNode).$_content[0] as HsonNode).$_tag, "_hson_str");
  }
});

check("owned scalar relationship, element text, and root-fragment carriers remain intact", () => {
  const object = parse_json({ member: "value" });
  const admittedObject = hson.fromNode(detach_hson_root_value(object)).toNode();
  const member = admittedObject.$_content[0] as HsonNode;
  assert.equal((member.$_content[0] as HsonNode).$_tag, "_hson_obj");

  const element = parse(`<p "value"/>`);
  const admittedElement = hson.fromNode(element).toNode();
  const ordinary = admittedElement.$_content[0] as HsonNode;
  assert.equal((ordinary.$_content[0] as HsonNode).$_tag, "_hson_elem");

  const rootOwnedFragment: HsonNode = {
    $_tag: "_hson_elem",
    $_content: [{ $_tag: "_hson_str", $_content: ["text only"] }],
  };
  const wire = serialize_hson_owned_element_text_fragment(rootOwnedFragment, { noBreak: true });
  assert.equal(wire, `"text only"`);
  const rebuilt = detach_hson_root_value(parse_hson(wire, { allowTopLevelTextFragment: true }));
  assert.equal(canonical_hson_graph_equal(rebuilt, rootOwnedFragment), true);
});

check("direct, universal Worker-safe, and browser facade HSON paths serialize identically", () => {
  for (const node of [
    parse(`<record <name "Ada" active true> items «1,2»>`),
    parse(`«<name "Ada">,<name "Lin">»`),
    parse(`<main @000000018 class="shell" <span "ready"/>/>`),
  ]) {
    const direct = serialize_hson(node);
    const universal = hsonTransform.fromNode(node).toHson().serialize();
    const browserFacade = hson.fromNode(node).toHson().serialize();
    assert.equal(universal, direct);
    assert.equal(browserFacade, direct);
    assert_wire_closure(node, direct);
  }
});

check("serialization is deterministic across repeated calls", () => {
  const node = parse(`<p z="3" a="1" disabled data-z="2" data-a="1" "first" <em "middle"/> "last"/>`);
  const outputs = Array.from({ length: 20 }, () => hson.fromNode(node).toHson().serialize());
  assert.equal(new Set(outputs).size, 1);
});

check("representative 500-property document serializes and reparses in both layouts", () => {
  const payload = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [
    `key-${index}`,
    { index, enabled: index % 2 === 0, values: [index, `value-${index}`, null] },
  ]));
  const node = hson.fromJson(payload).toNode();
  const semantic = detach_hson_root_value(node);
  assert.deepEqual(parse(readable(semantic)), semantic);
  assert.deepEqual(parse(compact(semantic)), semantic);
});

process.stdout.write(`# ${checks} HSON serializer checks passed\n`);
emit_hson_live_test_completion("transform.hson-serializer", checks, checks, 0);
