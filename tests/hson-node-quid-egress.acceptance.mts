import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { construct_exact_runtime_livetree } from "../src/api/livetree/livetree.ts";
import {
  destroy_subtree_quids,
  get_node_by_quid,
  HSON_QUID_MARKUP_NAME,
} from "../src/api/livetree/quid/data-quid.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { HSON_META_QUID } from "../src/core/constants.ts";
import { read_hson_node_quid } from "../src/core/hson-node-quid.ts";
import type { HsonNode } from "../src/core/types.ts";
import { source_before_local_identity } from "./helpers/source-before-local-identity.mts";

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

check("Hson egress omits canonical runtime identity and rejects malformed spelling", () => {
  const valid = element("panel", [], Q1);
  assert.equal(source_before_local_identity(valid).toHson().noBreak().serialize(), `<panel/>`);
  for (const invalid of ["short", "000000000000010I", "000000000000010A"]) {
    const malformed = element("panel", [], invalid);
    assert.throws(
      () => source_before_local_identity(malformed).toHson().serialize(),
      /invalid metadata value for "quid"/,
    );
    assert.equal(malformed.$_meta?.[HSON_META_QUID], invalid);
  }
});

check("Hson egress rejects QUIDs on every VSN", () => {
  for (const tag of ["_hson_obj", "_hson_arr"] as const) {
    const semantic: HsonNode = { $_tag: tag, $_content: [], $_meta: { [HSON_META_QUID]: Q1 } };
    assert.throws(() => source_before_local_identity(semantic).toHson().noBreak().serialize(), /quid must be a canonical persisted QUID on an eligible standard tag/);
    assert.throws(() => source_before_local_identity(semantic).toHson().noBreak().serialize(), /quid must be a canonical persisted QUID on an eligible standard tag/);
  }
  const invalid = {
    $_tag: "_hson_elem",
    $_meta: { [HSON_META_QUID]: Q1 },
    $_content: [element("p")],
  } satisfies HsonNode;
  const before = structuredClone(invalid);
  assert.throws(
    () => source_before_local_identity(invalid).toHson().serialize(),
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
  assert.throws(
    () => source_before_local_identity(graph).toHson().serialize(),
    /object member <member> cannot carry metadata or a QUID/,
  );
  assert.throws(
    () => source_before_local_identity(graph).toHson().serialize(),
    /object member <member> cannot carry metadata or a QUID/,
  );
});

check("cold Hson egress omits duplicate canonical values without mutation", () => {
  const graph = elementContent([element("div", [], Q1), element("span", [], Q1)]);
  const before = structuredClone(graph);
  const wire = source_before_local_identity(graph).toHson().noBreak().serialize();
  assert.equal(occurrences(wire, `@${Q1}`), 0);
  assert.deepEqual(graph, before);
});

check("Transform HTML egress omits protected QUID metadata", () => {
  const graph = element("button", [], Q1);
  graph.$_attrs = {
    id: "save",
    "data-kind": "action",
    "data-_quid": "application",
    "data-_index": "ordinary",
  };
  const wire = source_before_local_identity(graph).toHtml().serialize();
  assert.equal(
    wire,
    `<button data-_index="ordinary" data-_quid="application" data-kind="action" id="save"></button>`,
  );
  assert.equal(occurrences(wire, "hson:quid="), 0);
  assert.doesNotMatch(wire, /_hson_meta_attr_v2_/);

  const arrayWire = hson.fromJson([{}]).toHtml().serialize();
  assert.match(arrayWire, /hson:index="0"/);
  assert.doesNotMatch(arrayWire, /data-_index/);
  assert.doesNotMatch(arrayWire, /_hson_meta_attr_v2_/);
});

check("HTML egress rejects malformed and VSN-hosted identity", () => {
  assert.throws(
    () => source_before_local_identity(element("div", [], "000000000000010A")).toHtml().serialize(),
    /invalid metadata value for "quid"/,
  );
  const invalid = {
    $_tag: "_hson_obj",
    $_meta: { [HSON_META_QUID]: Q1 },
    $_content: [],
  } satisfies HsonNode;
  assert.throws(
    () => source_before_local_identity(invalid).toHtml().serialize(),
    /quid must be a canonical persisted QUID on an eligible standard tag/,
  );
});

check("cold HTML document sequences omit duplicate runtime identity", () => {
  const graph = elementContent([element("div", [], Q1), element("span", [], Q1)]);
  const wire = source_before_local_identity(graph).toHtml().serialize();
  assert.equal(occurrences(wire, `hson:quid="${Q1}"`), 0);
});

check("SVG and XML-like egress preserve namespace and unrelated attributes", () => {
  const svg = element("svg", [element("g", [], Q2)], Q1);
  svg.$_attrs = { viewBox: "0 0 10 10", "aria-label": "shape" };
  const before = structuredClone(svg);
  const wire = source_before_local_identity(svg).toHtml().serialize();
  assert.doesNotMatch(wire, /hson:quid/);
  assert.match(wire, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(wire, /viewBox="0 0 10 10"/);
  assert.match(wire, /<g><\/g>/);
  assert.deepEqual(svg, before);

  const xml = element("catalog", [element("entry", [], Q2)], Q1);
  xml.$_attrs = { "data-kind": "xml" };
  assert.equal(
    source_before_local_identity(xml).toHtml().serialize(),
    `<catalog data-kind="xml"><entry></entry></catalog>`,
  );
});

check("portable output is identity-free while local ownership remains intact", () => {
  const child = element("span", [], Q2);
  const root = element("main", [child], Q1);
  root.$_attrs = { "data-user": "keep" };
  const tree = construct_exact_runtime_livetree(root);
  const projection = new AttributeProjection();
  projection.setAttribute(HSON_QUID_MARKUP_NAME, Q1);
  link_node_to_el(root, projection as unknown as Element);
  const before = structuredClone(root);
  try {
    const normal = source_before_local_identity(root).toHson().noBreak().serialize();
    const filtered = source_before_local_identity(root).toHson().noBreak().serialize();
    assert.equal(occurrences(normal, "@"), 0);
    assert.doesNotMatch(filtered, /@[0-9a-z]{9}/);
    assert.match(filtered, /data-user="keep"/);
    assert.deepEqual(root, before);
    assert.equal(projection.getAttribute(HSON_QUID_MARKUP_NAME), Q1);
    assert.equal(get_node_by_quid(Q1), root);
    assert.equal(get_node_by_quid(Q2), child);
    assert.equal(source_before_local_identity(root).toHson().noBreak().serialize(), normal);
    assert.equal(tree.quid, Q1);
  } finally {
    destroy_subtree_quids(root);
  }
});

check("serialization never mints an absent descendant identity", () => {
  const child = element("span");
  const root = element("main", [child], Q3);
  construct_exact_runtime_livetree(root);
  try {
    assert.equal(read_hson_node_quid(child), undefined);
    source_before_local_identity(root).toHson().serialize();
    source_before_local_identity(root).toHson().serialize();
    source_before_local_identity(root).toHtml().serialize();
    assert.equal(read_hson_node_quid(child), undefined);
  } finally {
    destroy_subtree_quids(root);
  }
});

check("LiveTree graph-backed markup validates exactly the emitted scope", () => {
  const child = element("em", [], Q5);
  const root = element("section", [child], Q4);
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
  const one = elementContent([element("p", [], Q1)]);
  const many = elementContent([element("p", [], Q1), element("hr", [], Q2)]);
  const text = elementContent([{ $_tag: "_hson_str", $_content: ["text"] }]);
  const mixed = elementContent([
    { $_tag: "_hson_str", $_content: ["before"] },
    element("strong", [{ $_tag: "_hson_str", $_content: ["middle"] }], Q1),
    { $_tag: "_hson_str", $_content: ["after"] },
  ]);
  assert.equal(source_before_local_identity(one).toHtml().serialize(), `<p></p>`);
  assert.equal(
    source_before_local_identity(many).toHtml().serialize(),
    `<p></p><hr></hr>`,
  );
  assert.equal(
    source_before_local_identity(text).toHtml().serialize(),
    '<_hson_obj><!--hson-text:0074006500780074-->text</_hson_obj>',
  );
  assert.equal(
    source_before_local_identity(mixed).toHtml().serialize(),
    `before<strong>middle</strong>after`,
  );
});

check("JSON projection omits runtime identity after canonical empty-element normalization", () => {
  const canonical = element("record", [], Q1);
  assert.deepEqual(source_before_local_identity(canonical).toJson().value(), {
    record: { _hson_elem: [] },
  });
  assert.deepEqual(hson.fromJson({ a: 1, nested: [true, null] }).toJson().value(), {
    a: 1,
    nested: [true, null],
  });
  assert.throws(
    () => source_before_local_identity(element("record", [], "000000000000010A")).toJson(),
    /invalid metadata value for "quid"/,
  );
  const duplicate = elementContent([element("left", [], Q1), element("right", [], Q1)]);
  assert.doesNotThrow(() => source_before_local_identity(duplicate).toJson().value());
});

console.log(`hson-node QUID egress acceptance: ${checks} checks passed`);
testEvents.terminal("pass");
