import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import type { HsonNode } from "../src/core/types.ts";
import { EVERY_VSN, HSON_META_INDEX, HSON_META_QUID } from "../src/core/constants.ts";
import {
  drop_quid,
  destroy_subtree_quids,
  ensure_quid,
  get_node_by_quid,
  get_quid,
  has_quid,
  reindex_quid,
  remint_quid,
} from "../src/api/livetree/quid/data-quid.ts";
import { LiveTree } from "../src/api/livetree/livetree.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function node(
  tag: string,
  content: HsonNode["$_content"] = [],
  meta?: HsonNode["$_meta"],
): HsonNode {
  return meta === undefined
    ? { $_tag: tag, $_content: content }
    : { $_tag: tag, $_content: content, $_meta: meta };
}

function assertEligibilityError(fn: () => unknown, tag: string): void {
  assert.throws(
    fn,
    (cause) => cause instanceof Error
      && cause.message.includes("ineligible HSON structural node")
      && cause.message.includes(`"${tag}"`),
  );
}

function withoutQuids(value: HsonNode): HsonNode {
  const copy = structuredClone(value);
  const visit = (current: HsonNode): void => {
    if (current.$_meta !== undefined) {
      delete current.$_meta[HSON_META_QUID];
      if (Object.keys(current.$_meta).length === 0) delete current.$_meta;
    }
    for (const child of current.$_content) {
      if (typeof child === "object" && child !== null) visit(child);
    }
  };
  visit(copy);
  return copy;
}

const vsnTags = [...EVERY_VSN, "_hson_future"];

check("every current and future-prefix clean VSN reads as absent and rejects identity operations", () => {
  for (const tag of vsnTags) {
    const value = node(tag, [], tag === "_hson_ii" ? { [HSON_META_INDEX]: "0" } : undefined);
    const before = structuredClone(value);

    assert.equal(get_quid(value), undefined, `${tag} read`);
    assert.equal(has_quid(value), false, `${tag} has`);
    assertEligibilityError(() => ensure_quid(value), tag);
    assert.deepEqual(value, before, `${tag} ensure mutation`);
    assertEligibilityError(() => remint_quid(value), tag);
    assert.deepEqual(value, before, `${tag} remint mutation`);
    assertEligibilityError(() => reindex_quid(value), tag);
    assert.deepEqual(value, before, `${tag} reindex mutation`);
  }
});

check("QUID-bearing VSNs reject read, claim, remint, reindex, drop, and clone without repair", () => {
  for (const [index, tag] of vsnTags.entries()) {
    const q = (0x100 + index).toString(32).padStart(9, "0");
    const invalid = node(tag);
    const ordinaryBeforeInvalid = node(`before-${index}`);
    const source = node(`root-${index}`, [ordinaryBeforeInvalid, invalid]);
    const tree = new LiveTree(source);
    invalid.$_meta = { [HSON_META_QUID]: q };

    for (const operation of [
      () => get_quid(invalid),
      () => has_quid(invalid),
      () => ensure_quid(invalid),
      () => remint_quid(invalid),
      () => reindex_quid(invalid),
      () => drop_quid(invalid, { scrubMeta: true }),
      () => tree.cloneBranch(),
    ]) {
      assertEligibilityError(operation, tag);
      assert.equal(invalid.$_meta?.[HSON_META_QUID], q, `${tag} metadata retained`);
      assert.equal(get_node_by_quid(q), undefined, `${tag} registry unchanged`);
      assert.equal(get_quid(ordinaryBeforeInvalid), undefined, `${tag} no partial clone registration`);
    }
  }
});

check("subtree destruction preflights invalid VSN identity before any cleanup", () => {
  const ordinary = node("kept", [], { [HSON_META_QUID]: "000000200" });
  ensure_quid(ordinary);
  const invalid = node("_hson_elem", [], { [HSON_META_QUID]: "000000201" });
  const root = node("destroy-root", [ordinary, invalid]);

  assertEligibilityError(() => destroy_subtree_quids(root), "_hson_elem");
  assert.equal(ordinary.$_meta?.[HSON_META_QUID], "000000200");
  assert.equal(get_node_by_quid("000000200"), ordinary);
  assert.equal(invalid.$_meta?.[HSON_META_QUID], "000000201");
  assert.equal(get_node_by_quid("000000201"), undefined);
});

check("ordinary nodes retain canonical generation, stable ensure, descendant eligibility, and collision rejection", () => {
  const root = node("main", [node("section"), node("span")]);
  const [section, span] = root.$_content as HsonNode[];
  const rootQuid = ensure_quid(root);
  const sectionQuid = ensure_quid(section);
  const spanQuid = ensure_quid(span);

  for (const q of [rootQuid, sectionQuid, spanQuid]) {
    assert.match(q, /^[0-9abcdefghjkmnpqrstvwxyz]{9}$/);
  }
  assert.equal(ensure_quid(root), rootQuid);
  assert.equal(ensure_quid(section), sectionQuid);

  const collision = node("aside", [], { [HSON_META_QUID]: rootQuid });
  assert.throws(() => ensure_quid(collision), /Duplicate QUID/);
  assert.equal(collision.$_meta?.[HSON_META_QUID], rootQuid);
  assert.equal(get_node_by_quid(rootQuid), root);
});

check("a registered node changed into a VSN cannot operationally expose its prior QUID", () => {
  const value = node("mutable");
  const q = ensure_quid(value);
  value.$_tag = "_hson_future";

  assertEligibilityError(() => get_quid(value), "_hson_future");
  assertEligibilityError(() => get_node_by_quid(q), "_hson_future");
  assert.equal(value.$_meta?.[HSON_META_QUID], q);
});

check("clone remints every ordinary node and leaves nested VSN wrappers unquidded", () => {
  const source = node("main", [
    node("section"),
    node("_hson_elem", [
      node("span"),
      node("_hson_str", ["text"]),
    ]),
    node("_hson_obj", [
      node("property", [node("_hson_str", ["value"])]),
    ]),
    node("_hson_arr", [
      node("_hson_ii", [node("article")], { [HSON_META_INDEX]: "0" }),
    ]),
    node("_hson_val", [false]),
  ]);
  const sourceNodes: HsonNode[] = [];
  const collect = (current: HsonNode): void => {
    sourceNodes.push(current);
    for (const child of current.$_content) {
      if (typeof child === "object" && child !== null) collect(child);
    }
  };
  collect(source);

  const ordinarySource = sourceNodes.filter((value) => !value.$_tag.startsWith("_hson_"));
  const vsnSource = sourceNodes.filter((value) => value.$_tag.startsWith("_hson_"));
  const sourceQuids = ordinarySource.map((value) => ensure_quid(value));
  for (const value of vsnSource) assert.equal(get_quid(value), undefined);

  const clone = new LiveTree(source).cloneBranch().node;
  const cloneNodes: HsonNode[] = [];
  const collectClone = (current: HsonNode): void => {
    cloneNodes.push(current);
    for (const child of current.$_content) {
      if (typeof child === "object" && child !== null) collectClone(child);
    }
  };
  collectClone(clone);

  const ordinaryClone = cloneNodes.filter((value) => !value.$_tag.startsWith("_hson_"));
  const vsnClone = cloneNodes.filter((value) => value.$_tag.startsWith("_hson_"));
  assert.equal(ordinaryClone.length, ordinarySource.length);
  assert.equal(vsnClone.length, vsnSource.length);
  for (const [index, value] of ordinaryClone.entries()) {
    const q = get_quid(value);
    assert.match(q ?? "", /^[0-9abcdefghjkmnpqrstvwxyz]{9}$/);
    assert.notEqual(q, sourceQuids[index]);
  }
  for (const value of vsnClone) {
    assert.equal(get_quid(value), undefined);
    assert.equal(value.$_meta?.[HSON_META_QUID], undefined);
  }
  assert.deepEqual(withoutQuids(clone), withoutQuids(source));
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livetree.quid-eligibility", checks, checks, 0);
