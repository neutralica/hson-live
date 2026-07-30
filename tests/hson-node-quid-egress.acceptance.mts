import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { LiveTree } from "../src/api/livetree/livetree.ts";
import {
  destroy_subtree_quids,
  get_node_by_quid,
} from "../src/api/livetree/quid/data-quid.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { _DATA_QUID } from "../src/core/constants.ts";
import { read_hson_node_quid } from "../src/core/hson-node-quid.ts";
import type { HsonNode } from "../src/core/types.ts";

const Q1 = "0000000000000101";
const Q2 = "0000000000000102";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
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
    : { $_tag: tag, $_content: content, $_meta: { [_DATA_QUID]: quid } };
}

function fragment(content: HsonNode["$_content"]): HsonNode {
  return {
    $_tag: "_hson_root",
    $_content: [{ $_tag: "_hson_elem", $_content: content }],
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

check("HSON egress preserves canonical identity and rejects malformed spelling", () => {
  const valid = element("panel", [], Q1);
  assert.equal(hson.fromNode(valid).toHson().noBreak().serialize(), `<panel @${Q1}/>`);
  for (const invalid of ["short", "000000000000010I", "000000000000010A"]) {
    const malformed = element("panel", [], invalid);
    assert.throws(
      () => hson.fromNode(malformed).toHson().serialize(),
      /Invalid persisted QUID/,
    );
    assert.equal(malformed.$_meta?.[_DATA_QUID], invalid);
  }
});

check("HSON egress rejects QUID-bearing VSNs before emission", () => {
  const invalid = {
    $_tag: "_hson_elem",
    $_meta: { [_DATA_QUID]: Q1 },
    $_content: [element("p")],
  } satisfies HsonNode;
  const before = structuredClone(invalid);
  assert.throws(
    () => hson.fromNode(invalid).toHson().serialize(),
    /ineligible HSON structural node/,
  );
  assert.deepEqual(invalid, before);
});

check("cold HSON egress preserves duplicate canonical values without mutation", () => {
  const graph = fragment([element("div", [], Q1), element("span", [], Q1)]);
  const before = structuredClone(graph);
  const wire = hson.fromNode(graph).toHson().noBreak().serialize();
  assert.equal(occurrences(wire, `@${Q1}`), 2);
  assert.deepEqual(graph, before);
});

check("HTML egress emits protected QUID metadata exactly once", () => {
  const graph = element("button", [], Q1);
  graph.$_attrs = { id: "save", "data-kind": "action" };
  const wire = hson.fromNode(graph).toHtml().serialize();
  assert.equal(
    wire,
    `<button data-_quid="${Q1}" data-kind="action" id="save"></button>`,
  );
  assert.equal(occurrences(wire, "data-_quid="), 1);
});

check("HTML egress rejects malformed and VSN-hosted identity", () => {
  assert.throws(
    () => hson.fromNode(element("div", [], "000000000000010A")).toHtml().serialize(),
    /Invalid persisted QUID/,
  );
  const invalid = {
    $_tag: "_hson_future",
    $_meta: { [_DATA_QUID]: Q1 },
    $_content: [],
  } satisfies HsonNode;
  assert.throws(
    () => hson.fromNode(invalid).toHtml().serialize(),
    /ineligible HSON structural node/,
  );
});

check("cold HTML fragments serialize duplicate valid identity faithfully", () => {
  const graph = fragment([element("div", [], Q1), element("span", [], Q1)]);
  const wire = hson.fromNode(graph).toHtml().serialize();
  assert.equal(occurrences(wire, `data-_quid="${Q1}"`), 2);
});

check("SVG and XML-like egress preserve namespace and unrelated attributes", () => {
  const svg = element("svg", [element("g", [], Q2)], Q1);
  svg.$_attrs = { viewBox: "0 0 10 10", "aria-label": "shape" };
  const before = structuredClone(svg);
  const wire = hson.fromNode(svg).toHtml().serialize();
  assert.match(wire, new RegExp(`^<svg [^>]*data-_quid="${Q1}"`));
  assert.match(wire, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(wire, /viewBox="0 0 10 10"/);
  assert.match(wire, new RegExp(`<g data-_quid="${Q2}"></g>`));
  assert.deepEqual(svg, before);

  const xml = element("catalog", [element("entry", [], Q2)], Q1);
  xml.$_attrs = { "data-kind": "xml" };
  assert.equal(
    hson.fromNode(xml).toHtml().serialize(),
    `<catalog data-_quid="${Q1}" data-kind="xml"><entry data-_quid="${Q2}"></entry></catalog>`,
  );
});

check("noQuid is output-only and normal serialization remains repeatable", () => {
  const child = element("span", [], Q2);
  const root = element("main", [child], Q1);
  root.$_attrs = { "data-user": "keep" };
  const tree = new LiveTree(root);
  const projection = new AttributeProjection();
  projection.setAttribute(_DATA_QUID, Q1);
  link_node_to_el(root, projection as unknown as Element);
  const before = structuredClone(root);
  try {
    const normal = hson.fromNode(root).toHson().noBreak().serialize();
    const filtered = hson.fromNode(root).toHson().noBreak().noQuid().serialize();
    assert.equal(occurrences(normal, "@"), 2);
    assert.doesNotMatch(filtered, /@[0-9a-z]{16}/);
    assert.match(filtered, /data-user="keep"/);
    assert.deepEqual(root, before);
    assert.equal(projection.getAttribute(_DATA_QUID), Q1);
    assert.equal(get_node_by_quid(Q1), root);
    assert.equal(get_node_by_quid(Q2), child);
    assert.equal(hson.fromNode(root).toHson().noBreak().serialize(), normal);
    assert.equal(tree.quid, Q1);
  } finally {
    destroy_subtree_quids(root);
  }
});

check("serialization never mints an absent descendant identity", () => {
  const child = element("span");
  const root = element("main", [child], Q1);
  new LiveTree(root);
  try {
    assert.equal(read_hson_node_quid(child), undefined);
    hson.fromNode(root).toHson().serialize();
    hson.fromNode(root).toHson().noQuid().serialize();
    hson.fromNode(root).toHtml().serialize();
    assert.equal(read_hson_node_quid(child), undefined);
  } finally {
    destroy_subtree_quids(root);
  }
});

check("LiveTree graph-backed markup validates exactly the emitted scope", () => {
  const child = element("em", [], Q2);
  const root = element("section", [child], Q1);
  const unrelated = element("aside", [], "not-canonical");
  const tree = new LiveTree(root);
  try {
    assert.equal(
      tree.content.markup.innerHTML,
      `<em data-_quid="${Q2}"></em>`,
    );
    assert.equal(
      tree.content.markup.outerHTML,
      `<section data-_quid="${Q1}"><em data-_quid="${Q2}"></em></section>`,
    );
    assert.equal(unrelated.$_meta?.[_DATA_QUID], "not-canonical");

    child.$_meta = { [_DATA_QUID]: "not-canonical" };
    assert.throws(() => tree.content.markup.innerHTML, /Invalid persisted QUID/);
    assert.throws(() => tree.content.markup.outerHTML, /Invalid persisted QUID/);
  } finally {
    child.$_meta = { [_DATA_QUID]: Q2 };
    destroy_subtree_quids(root);
  }
});

check("fragment shapes remain stable across one-root, multi-root, text and mixed content", () => {
  const one = fragment([element("p", [], Q1)]);
  const many = fragment([element("p", [], Q1), element("hr", [], Q2)]);
  const text = fragment([{ $_tag: "_hson_str", $_content: ["text"] }]);
  const mixed = fragment([
    { $_tag: "_hson_str", $_content: ["before"] },
    element("strong", [{ $_tag: "_hson_str", $_content: ["middle"] }], Q1),
    { $_tag: "_hson_str", $_content: ["after"] },
  ]);
  assert.equal(hson.fromNode(one).toHtml().serialize(), `<p data-_quid="${Q1}"></p>`);
  assert.equal(
    hson.fromNode(many).toHtml().serialize(),
    `<p data-_quid="${Q1}"></p>\n<hr data-_quid="${Q2}"></hr>`,
  );
  assert.equal(hson.fromNode(text).toHtml().serialize(), "text");
  assert.equal(
    hson.fromNode(mixed).toHtml().serialize(),
    `before\n<strong data-_quid="${Q1}">middle</strong>\nafter`,
  );
});

check("JSON projection validates identity after canonical empty-element normalization", () => {
  const canonical = element("record", [], Q1);
  assert.deepEqual(hson.fromNode(canonical).toJson().value(), {
    record: { _hson_elem: [] },
    $_meta: { [_DATA_QUID]: Q1 },
  });
  assert.deepEqual(hson.fromJson({ a: 1, nested: [true, null] }).toJson().value(), {
    a: 1,
    nested: [true, null],
  });
  assert.throws(
    () => hson.fromNode(element("record", [], "000000000000010A")).toJson(),
    /Invalid persisted QUID/,
  );
  const duplicate = fragment([element("left", [], Q1), element("right", [], Q1)]);
  assert.doesNotThrow(() => hson.fromNode(duplicate).toJson().value());
});

console.log(`hson-node QUID egress acceptance: ${checks} checks passed`);
emit_hson_live_test_completion("transform.hson-node-quid-egress", checks, checks, 0);
