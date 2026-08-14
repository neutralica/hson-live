import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import {
  _create_livetree_for_runtime_test,
  _create_livetree_runtime_test_handle,
  _dispose_livetree_runtime_test_handle,
  _livetree_runtime_test_claim_count,
  _livetree_runtime_test_issued_count,
  _livetree_runtime_test_resource_counts,
  _lookup_livetree_runtime_test_node,
  _own_livetree_runtime_test_disposable,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import { assign_hson_node_quid } from "../src/core/hson-node-quid.ts";
import type { HsonNode } from "../src/core/types.ts";
import { element } from "./helpers/reflect-unit6.mts";

const Q1 = "000000v01";
const Q2 = "000000v02";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function node(tag = "main", quid?: string, children: HsonNode[] = []): HsonNode {
  const value: HsonNode = { $_tag: tag, $_content: children };
  if (quid !== undefined) assign_hson_node_quid(value, quid);
  return value;
}

function reuse(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && Reflect.get(error, "code") === "LIVETREE_QUID_REUSE"
    && Reflect.get(error, "quid") === Q1;
}

check("terminal removal permanently disposes the old exact handle", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const old = _create_livetree_for_runtime_test(runtime, node("main", Q1));
  old.remove();
  assert.equal(old.isDisposed, true);
  assert.throws(() => old.quid, (error: unknown) => Reflect.get(error as object, "code") === "LIVETREE_DISPOSED");
});

check("a new exact graph cannot reactivate retired bytes", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  assert.throws(() => _create_livetree_for_runtime_test(runtime, node("main", Q1)), reuse);
});

check("a structurally equal graph has no restoration authority", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1, [node("span")])).remove();
  assert.throws(
    () => _create_livetree_for_runtime_test(runtime, node("main", Q1, [node("span")])),
    reuse,
  );
});

check("a different tag cannot reuse retired bytes", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  assert.throws(() => _create_livetree_for_runtime_test(runtime, node("aside", Q1)), reuse);
});

check("manual object copying cannot recreate identity", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const source = node("main", Q1);
  _create_livetree_for_runtime_test(runtime, source).remove();
  const copy: HsonNode = { $_tag: "main", $_content: [], $_meta: { quid: Q1 } };
  assert.throws(() => _create_livetree_for_runtime_test(runtime, copy), reuse);
});

check("JSON round-trip cannot recreate identity", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const source = node("main", Q1);
  const encoded = JSON.stringify(source);
  _create_livetree_for_runtime_test(runtime, source).remove();
  const decoded: HsonNode = JSON.parse(encoded) as HsonNode;
  assert.throws(() => _create_livetree_for_runtime_test(runtime, decoded), reuse);
});

check("structured clone cannot recreate identity", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const source = node("main", Q1);
  const copy = structuredClone(source);
  _create_livetree_for_runtime_test(runtime, source).remove();
  assert.throws(() => _create_livetree_for_runtime_test(runtime, copy), reuse);
});

check("a stored raw QUID is absent throughout rejected reuse", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), undefined);
  assert.throws(() => _create_livetree_for_runtime_test(runtime, node("aside", Q1)), reuse);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), undefined);
});

check("raw bytes alone cannot authorize restoration", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const raw = Q1;
  _create_livetree_for_runtime_test(runtime, node("main", raw)).remove();
  assert.throws(() => _create_livetree_for_runtime_test(runtime, node("main", raw)), reuse);
});

check("repeated reuse attempts remain rejected", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.throws(() => _create_livetree_for_runtime_test(runtime, node("main", Q1)), reuse);
  }
  assert.equal(_livetree_runtime_test_issued_count(runtime), 1);
});

check("failed reuse never publishes a replacement exact node", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  const replacement = node("aside", Q1);
  assert.throws(() => _create_livetree_for_runtime_test(runtime, replacement), reuse);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), undefined);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
});

check("retired descendant rejects otherwise fresh root admission", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("old", Q1)).remove();
  assert.throws(
    () => _create_livetree_for_runtime_test(runtime, node("main", Q2, [node("span", Q1)])),
    reuse,
  );
});

check("retired root rejects otherwise fresh descendant admission", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("old", Q1)).remove();
  assert.throws(
    () => _create_livetree_for_runtime_test(runtime, node("main", Q1, [node("span", Q2)])),
    reuse,
  );
});

check("foreign runtime may own equal active bytes", () => {
  const left = _create_livetree_runtime_test_handle();
  const right = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(left, node("main", Q1));
  assert.equal(_create_livetree_for_runtime_test(right, node("aside", Q1)).quid, Q1);
});

check("fresh runtime may admit bytes retired elsewhere", () => {
  const oldRuntime = _create_livetree_runtime_test_handle();
  const freshRuntime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(oldRuntime, node("main", Q1)).remove();
  assert.equal(_create_livetree_for_runtime_test(freshRuntime, node("main", Q1)).quid, Q1);
});

check("runtime replacement fences the old issued lifetime", () => {
  const oldRuntime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(oldRuntime, node("main", Q1)).remove();
  _dispose_livetree_runtime_test_handle(oldRuntime);
  const replacementRuntime = _create_livetree_runtime_test_handle();
  assert.equal(_create_livetree_for_runtime_test(replacementRuntime, node("main", Q1)).quid, Q1);
});

check("detach preserves the exact node rather than restoring it", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const tree = _create_livetree_for_runtime_test(runtime, node("main", Q1));
  const exact = tree.node;
  tree.detach();
  assert.equal(tree.node, exact);
  assert.equal(tree.quid, Q1);
});

check("clone receives fresh identity instead of copied provenance", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const source = _create_livetree_for_runtime_test(runtime, node("main", Q1));
  const clone = source.cloneBranch();
  assert.notEqual(clone.quid, Q1);
});

check("public fromNode observes same-runtime non-reuse", () => {
  const first = hson.liveTree.fromNode(node("main", Q1));
  first.remove();
  assert.throws(() => hson.liveTree.fromNode(node("main", Q1)), reuse);
});

check("remove returns only lifecycle status and no restoration artifact", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const tree = _create_livetree_for_runtime_test(runtime, node("main", Q1));
  assert.equal(tree.remove(), 1);
  assert.equal(tree.remove(), 0);
});

check("deprecated removeChildren removes only direct semantic element children", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const text: HsonNode = { $_tag: "_hson_str", $_content: ["kept"] };
  const child = node("span", Q1);
  const parent = _create_livetree_for_runtime_test(runtime, {
    $_tag: "main",
    $_content: [text, child, "primitive"],
  });
  assert.equal(parent.removeChildren(), 1);
  assert.deepEqual(parent.node.$_content, [text, "primitive"]);
  assert.equal(parent.removeChildren(), 0);
});

check("deprecated removeChildren preserves the exact child handle and active QUID", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const childNode = node("span", Q1);
  const parent = _create_livetree_for_runtime_test(runtime, node("main", Q2, [childNode]));
  const child = _create_livetree_for_runtime_test(runtime, childNode).adoptRoots(parent.hostRootNode());
  assert.equal(parent.removeChildren(), 1);
  assert.equal(child.isDisposed, false);
  assert.equal(child.node, childNode);
  assert.equal(child.quid, Q1);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), childNode);
});

check("deprecated removeChildren drains listener and runtime resource ownership", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const childNode = node("span", Q1);
  const parent = _create_livetree_for_runtime_test(runtime, node("main", Q2, [childNode]));
  let disposed = 0;
  _own_livetree_runtime_test_disposable(runtime, Q1, () => { disposed += 1; }, "listener");
  _own_livetree_runtime_test_disposable(runtime, Q1, () => { disposed += 1; }, "other");
  parent.removeChildren();
  assert.equal(disposed, 2);
  assert.equal(_livetree_runtime_test_resource_counts(runtime, Q1).total, 0);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), childNode);
});

check("deprecated removeChildren permits exact child reattachment", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const childNode = node("span", Q1);
  const parent = _create_livetree_for_runtime_test(runtime, node("main", Q2, [childNode]));
  const child = _create_livetree_for_runtime_test(runtime, childNode).adoptRoots(parent.hostRootNode());
  parent.removeChildren();
  assert.equal(parent.append(child), parent);
  const carrier = parent.node.$_content[0];
  assert.equal(typeof carrier === "object" && carrier !== null && carrier.$_content[0], childNode);
  assert.equal(child.isDisposed, false);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), childNode);
});

check("empty terminally disposes children unlike deprecated removeChildren", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const childNode = node("span", Q1);
  const parent = _create_livetree_for_runtime_test(runtime, node("main", Q2, [childNode]));
  const child = _create_livetree_for_runtime_test(runtime, childNode).adoptRoots(parent.hostRootNode());
  assert.equal(parent.empty(), parent);
  assert.equal(child.isDisposed, true);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), undefined);
  assert.throws(() => parent.append(child), (error: unknown) => Reflect.get(error as object, "code") === "LIVETREE_DISPOSED");
});

check("deprecated removeChildren is rejected while Reflection owns structure", () => {
  const map = element(`<main <a/>/>`);
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map);
  const before = structuredClone(binding.tree.node);
  assert.throws(
    () => binding.tree.removeChildren(),
    (error: unknown) => Reflect.get(error as object, "code") === "DOCUMENT_REFLECT_UNSUPPORTED_OPERATION",
  );
  assert.deepEqual(binding.tree.node, before);
  assert.equal(binding.status, "active");
  binding.dispose();
});

check("deprecated removeChildren does not retire bytes from the runtime issued lifetime", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const childNode = node("span", Q1);
  const parent = _create_livetree_for_runtime_test(runtime, node("main", Q2, [childNode]));
  parent.removeChildren();
  assert.equal(_livetree_runtime_test_issued_count(runtime), 2);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 2);
  assert.throws(() => _create_livetree_for_runtime_test(runtime, node("aside", Q1)), /already registered/);
});

emit_hson_live_test_completion("livetree.terminal-reuse-boundaries", checks, checks, 0);
