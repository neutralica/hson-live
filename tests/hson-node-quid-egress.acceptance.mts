import { retained_subject } from "./helpers/retained-livetree-subject.mts";
import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { Hson } from "../src/hson-authoring.ts";
import { serialize_hson } from "../src/api/transform/serializers/serialize-hson.ts";
import { serialize_html } from "../src/api/transform/serializers/serialize-html.ts";
import { json_value_from_node } from "../src/api/transform/serializers/serialize-json.ts";
import { construct_exact_runtime_livetree } from "../src/api/livetree/livetree.ts";
import {
  destroy_subtree_quids,
  get_node_by_quid,
  HSON_QUID_MARKUP_NAME,
} from "../src/api/livetree/quid/data-quid.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { HSON_META_QUID } from "../src/core/constants.ts";
import { read_hson_node_quid } from "../src/core/hson-node-quid.ts";
import { read_transform_error_details } from "../src/core/errors.ts";
import type { HsonNode } from "../src/core/types.ts";

const Q1 = "000000101";
const Q2 = "000000102";
const Q3 = "000000103";
const Q4 = "000000104";
const Q5 = "000000105";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.hson-node-quid-egress",
  title: "Canonical HsonNode QUID egress",
  category: "Transform",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["quid", "egress", "serialization", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("transform.hson-node-quid-egress");
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

function element(
  tag: string,
  content: HsonNode["$_content"] = [],
  quid?: string,
): HsonNode {
  return quid === undefined
    ? { $_tag: tag, $_content: content }
    : { $_tag: tag, $_content: content, $_meta: { [HSON_META_QUID]: quid } };
}

function elementContent(content: HsonNode["$_content"]): HsonNode {
  return {
    $_tag: "_hson_elem",
    $_content: content,
  };
}

function occurrences(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}

class AttributeProjection {
  readonly values = new Map<string, string>();

  setAttribute(name: string, value: string): void {
    this.values.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.values.has(name);
  }

  removeAttribute(name: string): void {
    this.values.delete(name);
  }
}

// Cold graph egress validates existing identity without admitting it into a
// generic Transform. Generic snapshot cases below instead start QUID-free.
check("cold Hson egress omits canonical runtime identity and rejects malformed spelling", () => {
  const valid = element("panel", [], Q1);
  const before = structuredClone(valid);
  assert.equal(serialize_hson(valid, { noBreak: true }), `<panel/>`);
  assert.deepEqual(valid, before);
  assert.equal(hson.fromNode(elementContent([element("panel")])).toHson().noBreak().serialize(), `<panel/>`);
  assert.throws(() => hson.fromNode(elementContent([valid])), (error: unknown) => {
    const details = read_transform_error_details(error);
    assert.equal(details?.code, "PORTABLE_RUNTIME_QUID_FORBIDDEN");
    assert.equal(details?.stage, "source-admission"); return true;
  });
  for (const invalid of ["short", "000000000000010I", "000000000000010A"]) {
    const malformed = element("panel", [], invalid);
    assert.throws(
      () => serialize_hson(malformed),
      /invalid metadata value for "quid"/,
    );
    assert.equal(malformed.$_meta?.[HSON_META_QUID], invalid);
  }
});

check("Hson egress rejects QUIDs on every VSN", () => {
  for (const semantic of [
    { $_tag: "_hson_obj", $_content: [] }, { $_tag: "_hson_arr", $_content: [] },
    { $_tag: "_hson_str", $_content: ["text"] }, { $_tag: "_hson_val", $_content: [-0] },
    { $_tag: "_hson_elem", $_content: [element("p")] },
    { $_tag: "_hson_ii", $_content: [{ $_tag: "_hson_val", $_content: [-0] }] },
    { $_tag: "_hson_root", $_content: [element("p")] },
  ] satisfies HsonNode[]) {
    const graph: HsonNode = { ...semantic, $_meta: { [HSON_META_QUID]: Q1 } };
    const before = structuredClone(graph);
    assert.throws(() => serialize_hson(graph, { noBreak: true }), /quid must be a canonical persisted QUID on an eligible standard tag/);
    assert.throws(() => serialize_hson(graph, { noBreak: true }), /quid must be a canonical persisted QUID on an eligible standard tag/);
    assert.deepEqual(graph, before);
  }
  const invalid = {
    $_tag: "_hson_elem",
    $_meta: { [HSON_META_QUID]: Q1 },
    $_content: [element("p")],
  } satisfies HsonNode;
  const before = structuredClone(invalid);
  assert.throws(
    () => serialize_hson(invalid),
    /quid must be a canonical persisted QUID on an eligible standard tag/,
  );
  assert.deepEqual(invalid, before);
});

check("Hson egress rejects object-member QUIDs on portable egress", () => {
  const graph: HsonNode = {
    $_tag: "_hson_obj",
    $_content: [{
      $_tag: "member",
      $_meta: { [HSON_META_QUID]: Q1 },
      $_content: [{
        $_tag: "_hson_obj",
        $_content: [{ $_tag: "_hson_str", $_content: ["value"] }],
      }],
    }],
  };
  const before = structuredClone(graph);
  assert.throws(
    () => serialize_hson(graph),
    /object member <member> cannot carry metadata or a QUID/,
  );
  assert.throws(
    () => serialize_hson(graph),
    /object member <member> cannot carry metadata or a QUID/,
  );
  assert.deepEqual(graph, before);
});

check("cold Hson egress omits duplicate canonical values without mutation", () => {
  const graph = elementContent([element("div", [], Q1), element("span", [], Q1)]);
  const before = structuredClone(graph);
  const registered = get_node_by_quid(Q1);
  const wire = serialize_hson(graph, { noBreak: true });
  assert.equal(wire, "<div/> <span/>");
  assert.equal(occurrences(wire, `@${Q1}`), 0);
  assert.deepEqual(graph, before);
  assert.equal(get_node_by_quid(Q1), registered, "cold serialization does not register identity");
});

check("Transform HTML snapshots ignore later caller identity and attribute changes", () => {
  const graph = element("button");
  graph.$_attrs = {
    id: "save",
    "data-kind": "action",
    "data-_quid": "application",
    "data-_index": "ordinary",
  };
  const source = hson.fromNode(elementContent([graph]));
  graph.$_meta = { [HSON_META_QUID]: Q1 };
  const wire = source.toHtml().serialize();
  assert.equal(
    wire,
    `<button data-_index="ordinary" data-_quid="application" data-kind="action" id="save"></button>`,
  );
  assert.equal(occurrences(wire, "hson:quid="), 0);
  assert.doesNotMatch(wire, /_hson_meta_attr_/);
  assert.equal(serialize_html(graph), wire, "cold graph egress also omits valid runtime identity");
  graph.$_attrs.id = "caller changed";
  assert.equal(source.toHtml().serialize(), wire);
  assert.equal((source.toNode().$_content[0] as HsonNode).$_meta, undefined);
  assert.equal(graph.$_meta[HSON_META_QUID], Q1);

  const arrayWire = hson.fromJson([{}]).toHtml().serialize();
  assert.match(arrayWire, /hson:index="0"/);
  assert.doesNotMatch(arrayWire, /data-_index/);
  assert.doesNotMatch(arrayWire, /_hson_meta_attr_/);
});

check("HTML egress rejects malformed and VSN-hosted identity", () => {
  assert.throws(
    () => serialize_html(element("div", [], "000000000000010A")),
    /invalid metadata value for "quid"/,
  );
  const invalid = {
    $_tag: "_hson_obj",
    $_meta: { [HSON_META_QUID]: Q1 },
    $_content: [],
  } satisfies HsonNode;
  assert.throws(
    () => serialize_html(invalid),
    /quid must be a canonical persisted QUID on an eligible standard tag/,
  );
});

check("cold HTML document sequences omit duplicate runtime identity", () => {
  const graph = elementContent([element("div", [], Q1), element("span", [], Q1)]);
  const before = structuredClone(graph);
  const wire = serialize_html(graph);
  assert.equal(occurrences(wire, `hson:quid="${Q1}"`), 0);
  assert.equal(wire, "<div></div><span></span>"); assert.deepEqual(graph, before);
});

check("SVG and XML-like egress preserve namespace and unrelated attributes", () => {
  const svg = element("svg", [elementContent([element("g", [], Q2)])], Q1);
  svg.$_attrs = { viewBox: "0 0 10 10", "aria-label": "shape" };
  const before = structuredClone(svg);
  const wire = serialize_html(svg);
  assert.doesNotMatch(wire, /hson:quid/);
  assert.match(wire, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(wire, /viewBox="0 0 10 10"/);
  assert.match(wire, /<g><\/g>/);
  assert.deepEqual(svg, before);

  const xml = element("catalog", [elementContent([element("entry", [], Q2)])], Q1);
  xml.$_attrs = { "data-kind": "xml" };
  const xmlBefore = structuredClone(xml);
  assert.equal(
    serialize_html(xml),
    `<catalog data-kind="xml"><entry></entry></catalog>`,
  );
  assert.deepEqual(xml, xmlBefore);
});

check("portable output is identity-free while local ownership remains intact", () => {
  const child = element("span", [], Q2);
  const root = element("main", [elementContent([child])], Q1);
  root.$_attrs = { "data-user": "keep" };
  const tree = construct_exact_runtime_livetree(root);
  const projection = new AttributeProjection();
  projection.setAttribute(HSON_QUID_MARKUP_NAME, Q1);
  link_node_to_el(root, projection as unknown as Element);
  const before = structuredClone(root);
  try {
    assert.equal(retained_subject(tree), root);
    const normal = serialize_hson(retained_subject(tree), { noBreak: true });
    const filtered = serialize_hson(retained_subject(tree), { noBreak: true });
    assert.equal(occurrences(normal, "@"), 0);
    assert.doesNotMatch(filtered, /@[0-9a-z]{9}/);
    assert.match(filtered, /data-user="keep"/);
    assert.deepEqual(root, before);
    assert.equal(projection.getAttribute(HSON_QUID_MARKUP_NAME), Q1);
    assert.equal(get_node_by_quid(Q1), root);
    assert.equal(get_node_by_quid(Q2), child);
    assert.equal(serialize_hson(retained_subject(tree), { noBreak: true }), normal);
    assert.equal(tree.content.markup.outerHTML, '<main data-user="keep"><span></span></main>');
    assert.equal(serialize_html(retained_subject(tree)), tree.content.markup.outerHTML);
    assert.equal(tree.quid, Q1);
  } finally {
    destroy_subtree_quids(root);
  }
});

check("serialization never mints an absent descendant identity", () => {
  const child = element("span");
  const root = element("main", [elementContent([child])], Q3);
  const tree = construct_exact_runtime_livetree(root);
  const before = structuredClone(root);
  try {
    assert.equal(read_hson_node_quid(child), undefined);
    assert.equal(serialize_hson(retained_subject(tree), { noBreak: true }), "<main <span/>/>");
    assert.equal(serialize_hson(retained_subject(tree), { noBreak: true }), "<main <span/>/>");
    assert.equal(serialize_html(retained_subject(tree)), "<main><span></span></main>");
    assert.equal(tree.content.markup.outerHTML, "<main><span></span></main>");
    assert.equal(tree.content.markup.innerHTML, "<span></span>");
    assert.equal(read_hson_node_quid(child), undefined);
    assert.deepEqual(root, before); assert.equal(get_node_by_quid(Q3), root);
  } finally {
    destroy_subtree_quids(root);
  }
});

check("LiveTree graph-backed markup validates exactly the emitted scope", () => {
  const child = element("em", [], Q5);
  const root = element("section", [elementContent([child])], Q4);
  const unrelated = element("aside", [], "not-canonical");
  const tree = construct_exact_runtime_livetree(root);
  try {
    assert.equal(
      tree.content.markup.innerHTML,
      `<em></em>`,
    );
    assert.equal(
      tree.content.markup.outerHTML,
      `<section><em></em></section>`,
    );
    assert.equal(unrelated.$_meta?.[HSON_META_QUID], "not-canonical");

    child.$_meta = { [HSON_META_QUID]: "not-canonical" };
    assert.throws(() => tree.content.markup.innerHTML, /Invalid persisted QUID/);
    assert.throws(() => tree.content.markup.outerHTML, /Invalid persisted QUID/);
  } finally {
    child.$_meta = { [HSON_META_QUID]: Q5 };
    destroy_subtree_quids(root);
  }
});

check("document-content shapes remain stable across one-root, multi-root, text and mixed content", () => {
  const one = elementContent([element("p")]);
  const many = elementContent([element("p"), element("hr")]);
  const text: HsonNode = { $_tag: "_hson_str", $_content: ["text"] };
  const mixed = elementContent([
    { $_tag: "_hson_str", $_content: ["before"] },
    element("strong", [elementContent([{ $_tag: "_hson_str", $_content: ["middle"] }])]),
    { $_tag: "_hson_str", $_content: ["after"] },
  ]);
  // Document admission retains its own ROOT. HTML Transform fixtures are
  // complete ELEM sequences or the universal STR, supplied directly.
  const inputs = [one, many, text, mixed];
  const documents = inputs.map(input => Hson.document.fromNode(input));
  const roots = documents.map(document => Hson.document.toNode(document));
  const html = inputs.map(input => hson.fromNode(input).toHtml().serialize());
  assert.deepEqual(roots.map(root => root.$_content.length), [1, 2, 1, 3]);
  assert.equal(html[0], `<p></p>`);
  assert.equal(
    html[1],
    `<p></p><hr></hr>`,
  );
  assert.equal(
    html[2],
    '<_hson_obj><!--hson-text:0074006500780074-->text</_hson_obj>',
  );
  assert.equal(
    html[3],
    `before<strong>middle</strong>after`,
  );
  roots[0].$_content.length = 0;
  assert.equal(Hson.document.toNode(documents[0]).$_content.length, 1);
});

check("JSON snapshots preserve complete element structure and cold egress validates identity", () => {
  const canonical = element("record");
  const source = hson.fromNode(elementContent([canonical]));
  canonical.$_meta = { [HSON_META_QUID]: Q1 };
  const expected = { _hson_elem: [{ record: { _hson_elem: [] } }] };
  assert.deepEqual(source.toJson().value(), expected);
  assert.deepEqual(JSON.parse(source.toJson().serialize()), expected);
  assert.deepEqual(json_value_from_node(elementContent([canonical])), expected);
  assert.deepEqual(hson.fromJson({ a: 1, nested: [true, null] }).toJson().value(), {
    a: 1,
    nested: [true, null],
  });
  assert.throws(
    () => json_value_from_node(elementContent([element("record", [], "000000000000010A")])),
    /invalid metadata value for "quid"/,
  );
  const duplicate = elementContent([element("left", [], Q1), element("right", [], Q1)]);
  const before = structuredClone(duplicate);
  assert.deepEqual(json_value_from_node(duplicate), {
    _hson_elem: [{ left: { _hson_elem: [] } }, { right: { _hson_elem: [] } }],
  });
  assert.deepEqual(duplicate, before);
});

console.log(`hson-node QUID egress acceptance: ${checks} checks passed`);
testEvents.terminal("pass");
