import assert from "node:assert/strict";

import { hson } from "../src/hson.ts";
import { get_node_by_quid } from "../src/api/livetree/quid/data-quid.ts";
import type { HsonNode } from "../src/core/types.ts";

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

function elementWithAttrs(attrs: NonNullable<HsonNode["$_attrs"]>): HsonNode {
  return {
    $_tag: "_hson_root",
    $_content: [{
      $_tag: "_hson_elem",
      $_content: [{ $_tag: "tag", $_attrs: attrs, $_content: [] }],
    }],
  };
}

function onlyElement(node: HsonNode): HsonNode {
  return (node.$_content[0] as HsonNode).$_content[0] as HsonNode;
}

check("@quid parses into metadata and serializes immediately after the tag", () => {
  const node = parse(`<panel class="settings" @4k7m2v9d1r6x8qwc hidden "Content"/>`);
  const panel = onlyElement(node);
  assert.equal(panel.$_meta?.["data-_quid"], "4k7m2v9d1r6x8qwc");
  assert.equal(compact(node), `<panel @4k7m2v9d1r6x8qwc class="settings" hidden "Content"/>`);
  assert.equal(compact(parse(`<panel data-_quid="0000000000000000"/>`)), `<panel @0000000000000000/>`);
  assert.throws(() => parse(`<panel @0000000000000000 data-_quid="0000000000000000"/>`), /conflicting persisted QUID/);
});

function clone_without_quids(node: HsonNode): HsonNode {
  const clone = structuredClone(node);
  const visit = (current: HsonNode): void => {
    if (current.$_meta) {
      delete current.$_meta["data-_quid"];
      if (Object.keys(current.$_meta).length === 0) delete current.$_meta;
    }
    for (const child of current.$_content) {
      if (typeof child === "object" && child !== null && "$_tag" in child) visit(child);
    }
  };
  visit(clone);
  return clone;
}

check("fromHson.toNode returns the canonical graph directly", () => {
  const node = hson.fromHson(`<name "Phillip">`).toNode();
  assert.deepEqual(node, {
    $_tag: "_hson_root",
    $_content: [{
      $_tag: "_hson_obj",
      $_content: [{
        $_tag: "name",
        $_content: [{
          $_tag: "_hson_obj",
          $_content: [{ $_tag: "_hson_str", $_content: ["Phillip"] }],
        }],
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
  assert.deepEqual(hson.fromHson(jsonSource.toHson().serialize()).toNode(), jsonNode);

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
  const array = arrayNode.$_content[0] as HsonNode;
  const elementNode = hson.fromHson(`<tag count=2 disabled "value"/>`).toNode();
  const tag = (elementNode.$_content[0] as HsonNode).$_content[0] as HsonNode;
  assert.deepEqual(tag.$_attrs, { count: "2", disabled: "disabled" });
  assert.equal(array.$_content.length, 2);
});

check("fromHson.toNode preserves malformed-input errors", () => {
  const malformed = hson.fromHson(`<tag "value/>`);
  assert.throws(
    () => malformed.toNode(),
    /unterminated quoted string at 1:6 \(index 5\)/,
  );
});

check("bare Phillip remains invalid under the unchanged header grammar", () => {
  assert.throws(
    () => hson.fromHson(`<name Phillip>`).toNode(),
    /OBJ002.*_hson_obj children must not have \$_attrs/s,
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
  const rootCluster = node.$_content[0] as HsonNode;
  const tag = rootCluster.$_content[0] as HsonNode;
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
  assert.equal(readable(node), `<parent\n  <child "value">\n>`);
});

check("nested object property compact snapshot", () => {
  const node = parse(`<parent <child "value">>`);
  assert.equal(compact(node), `<parent <child "value">>`);
});

check("array readable snapshot", () => {
  const node = parse(`«1,"two",<<name "Ada"><active true>>,[3,4]»`);
  assert.equal(readable(node), `«\n  1,\n  "two",\n  <\n    <name "Ada">\n    <active true>\n  >,\n  «\n    3,\n    4\n  »\n»`);
});

check("array compact snapshot", () => {
  const node = parse(`«1,"two",<<name "Ada"><active true>>,[3,4]»`);
  assert.equal(compact(node), `«1,"two",<<name "Ada"><active true>>,«3,4»»`);
});

check("empty object and array snapshots", () => {
  assert.equal(readable(parse(`<>`)), `<>`);
  assert.equal(compact(parse(`<>`)), `<>`);
  assert.equal(readable(parse(`[]`)), `«»`);
  assert.equal(compact(parse(`[]`)), `«»`);
});

check("quoted names and escaped string content snapshot", () => {
  const node = parse(`<\`this is a tag\` title="a\\\"b" disabled "slash\\\\ tab\\t line\\nnext"/>`);
  const expected = `<\`this is a tag\` title="a\\\"b" disabled "slash\\\\ tab\\t line\\nnext"/>`;
  assert.equal(readable(node), expected);
  assert.equal(compact(node), expected);
});

check("noQuid filters only the exact persisted QUID key", () => {
  const node = parse(`<tag data-_quid="0000000000000001" data-_custom="keep" data-_index="7" "value"/>`);
  const plain = readable(node);
  const filtered = hson.fromNode(node).toHson().noQuid().serialize();
  assert.match(plain, /@0000000000000001/);
  assert.doesNotMatch(filtered, /data-_quid/);
  assert.match(filtered, /data-_custom="keep"/);
  assert.match(filtered, /data-_index="7"/);
  assert.notEqual(plain, filtered);
});

check("noBreak and noQuid compose in either order", () => {
  const node = parse(`<p data-_quid="0000000000000002" "first" <em "middle"/> "last"/>`);
  const left = hson.fromNode(node).toHson().noBreak().noQuid().serialize();
  const right = hson.fromNode(node).toHson().noQuid().noBreak().serialize();
  assert.equal(left, right);
  assert.equal(left, `<p "first" <em "middle"/> "last"/>`);
});

check("withOptions composes with convenience methods", () => {
  const node = parse(`<p data-_quid="0000000000000003" "first" <em "middle"/> "last"/>`);
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
  const node = parse(`<tag data-_quid="0000000000000004" "value"/>`);
  assert.equal(
    hson.fromNode(node).toHson().noBreak().noBreak().noQuid().noQuid().serialize(),
    `<tag "value"/>`,
  );
});

check("noQuid does not mutate or contaminate the source graph", () => {
  const node = parse(`<tag data-_quid="0000000000000005" data-_custom="keep" "value"/>`);
  const before = structuredClone(node);
  const filtered = hson.fromNode(node).toHson().noQuid().serialize();
  assert.deepEqual(node, before);
  assert.doesNotMatch(filtered, /data-_quid/);
  assert.match(readable(node), /@0000000000000005/);
});

check("noQuid does not register imported identity", () => {
  const quid = "0000000000000006";
  const node = parse(`<tag data-_quid="${quid}" "value"/>`);
  assert.equal(get_node_by_quid(quid), undefined);
  hson.fromNode(node).toHson().noQuid().serialize();
  assert.equal(get_node_by_quid(quid), undefined);
});

check("parsed noQuid graph equals the graph with only QUID fields removed", () => {
  const node = parse(`<p data-_quid="0000000000000007" data-_custom="keep" "first" <em data-_quid="0000000000000008" "middle"/>/>`);
  const wire = hson.fromNode(node).toHson().noQuid().serialize();
  assert.deepEqual(parse(wire), clone_without_quids(node));
});

check("array data-_index is rebuilt from physical order", () => {
  const node = parse(`«"a","b",<<name "Ada">>»`);
  const wire = hson.fromNode(node).toHson().noQuid().serialize();
  const reparsed = parse(wire);
  assert.deepEqual(reparsed, node);
  const array = reparsed.$_content[0] as HsonNode;
  assert.deepEqual(
    array.$_content.map((item) => (item as HsonNode).$_meta?.["data-_index"]),
    ["0", "1", "2"],
  );
});

check("empty literal root fails with a stable error", () => {
  const emptyRoot: HsonNode = { $_tag: "_hson_root", $_content: [] };
  assert.throws(
    () => readable(emptyRoot),
    /serialize-hson: empty _hson_root cannot be serialized/,
  );
});

check("root containing an empty object remains representable", () => {
  const node = parse(`<>`);
  assert.equal(readable(node), `<>`);
});

const boundaryCases: ReadonlyArray<readonly [string, string]> = [
  [`<tag "text"/>`, `<tag "text"/>`],
  [`<tag 2>`, `<tag 2>`],
  [`<tag attr="value"/>`, `<tag attr="value"/>`],
  [`<tag attr="value" flag/>`, `<tag attr="value" flag/>`],
  [`<tag flag "text"/>`, `<tag flag "text"/>`],
  [`<wrapper <tag flag 2>/>`, `<wrapper <tag flag 2>/>`],
  [`<p "text" <child/>/>`, `<p "text" <child/>/>`],
  [`<tag 1 <child "value">>`, `<tag 1 <child "value">>`],
  [`<p <a/> <b/>/>`, `<p <a/> <b/>/>`],
  [`<a <b <c "x"/>/>/>`, `<a <b <c "x"/>/>/>`],
  [`<a <b <c "x">>>`, `<a <b <c "x">>>`],
  [`«<<name "Ada"><active true>>»`, `«<<name "Ada"><active true>>»`],
  [`«[1,2],[3,[4]]»`, `««1,2»,«3,«4»»»`],
  [`<\`tag name\` "text"/>`, `<\`tag name\` "text"/>`],
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
  `«1,"two",<<name "Ada"><active true>>,[3,4]»`,
  `<\`quoted key\` data-_custom="meta" "a\\\"b\\\\c\\tline\\nnext"/>`,
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
  const node = elementWithAttrs({ count: 2, disabled: "disabled", enabled: true });
  onlyElement(node).$_meta = {
    "data-_custom": "keep",
    "data-_quid": "0000000000000009",
  };
  const builder = () => hson.fromNode(node).toHson();
  const plain = `<tag @0000000000000009 count="2" enabled="true" disabled data-_custom="keep"/>`;
  const filtered = `<tag count="2" enabled="true" disabled data-_custom="keep"/>`;
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
  const node = parse(`<p data-_quid="000000000000000a" "first" <em "middle"/> "last"/>`);
  onlyElement(node).$_attrs = { count: 2, disabled: "disabled" };
  assert.equal(
    readable(node),
    `<p @000000000000000a count="2" disabled\n  "first"\n  <em "middle"/>\n  "last"\n/>`,
  );
  assert.equal(
    hson.fromNode(node).toHson().noBreak().noQuid().serialize(),
    `<p count="2" disabled "first" <em "middle"/> "last"/>`,
  );
});

check("structured style serialization remains normalized and string-valued", () => {
  const node: HsonNode = {
    $_tag: "_hson_root",
    $_content: [{
      $_tag: "_hson_elem",
      $_content: [{
        $_tag: "tag",
        $_attrs: { style: { marginTop: 2, color: "red" } },
        $_content: [],
      }],
    }],
  };
  const wire = readable(node);
  assert.equal(wire, `<tag style="color: red; margin-top: 2"/>`);
  const reparsedTag = (parse(wire).$_content[0] as HsonNode).$_content[0] as HsonNode;
  assert.deepEqual(reparsedTag.$_attrs?.style, { color: "red", marginTop: "2" });
});

check("metadata on melted VSNs remains outside the HSON wire", () => {
  const node: HsonNode = {
    $_tag: "_hson_root",
    $_meta: { "data-_custom": "root" },
    $_content: [{
      $_tag: "_hson_elem",
      $_meta: { "data-_custom": "element-cluster" },
      $_content: [{
        $_tag: "tag",
        $_content: [{
          $_tag: "_hson_elem",
          $_content: [{
            $_tag: "_hson_str",
            $_meta: { "data-_custom": "leaf" },
            $_content: ["value"],
          }],
        }],
      }],
    }],
  };
  assert.equal(readable(node), `<tag "value"/>`);
});

check("serialization is deterministic across repeated calls", () => {
  const node = parse(`<p z="3" a="1" disabled data-_z="2" data-_a="1" "first" <em "middle"/> "last"/>`);
  const outputs = Array.from({ length: 20 }, () => hson.fromNode(node).toHson().serialize());
  assert.equal(new Set(outputs).size, 1);
});

check("representative 500-property document serializes and reparses in both layouts", () => {
  const payload = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [
    `key-${index}`,
    { index, enabled: index % 2 === 0, values: [index, `value-${index}`, null] },
  ]));
  const node = hson.fromJson(payload).toNode();
  assert.deepEqual(parse(readable(node)), node);
  assert.deepEqual(parse(compact(node)), node);
});

process.stdout.write(`# ${checks} HSON serializer checks passed\n`);
