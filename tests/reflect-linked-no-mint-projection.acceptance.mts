// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import {
  element,
  mount,
  path,
  projected_element,
  raw_node,
} from "./helpers/reflect-unit6.mts";
import {
  begin_livetree_materialization_profile,
  _create_livetree_for_runtime_test,
  _create_livetree_runtime_test_handle,
  _dispose_livetree_runtime_test_handle,
  _is_livetree_node_disposed,
  _livetree_runtime_test_claim_count,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import { FakeElement } from "./helpers/fake-document.mts";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const runtime = _create_livetree_runtime_test_handle();

function reflected(source: string) {
  const map = element(source);
  return Object.freeze({ map, binding: _reflect_document_for_runtime_test(runtime, map) });
}

function close(binding: ReturnType<typeof reflected>["binding"]): void {
  binding.dispose();
  binding.tree.remove();
}

function assert_no_claims(): void {
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
}

check("QUID-less reflected root preserves metadata absence", () => {
  const { binding } = reflected(`<main/>`);
  assert.equal(binding.tree.node.$_meta?.quid, undefined);
  assert_no_claims();
  close(binding);
});

check("QUID-less reflected descendant preserves metadata absence", () => {
  const { binding } = reflected(`<main <span/>/>`);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_meta?.quid, undefined);
  assert_no_claims();
  close(binding);
});

check("mounted QUID-less root has no hson:quid markup", () => {
  const { binding } = reflected(`<main/>`);
  const root = mount(binding.tree.node);
  assert.equal(root.getAttribute("hson:quid"), null);
  assert_no_claims();
  close(binding);
});

check("mounted QUID-less descendant has no hson:quid markup", () => {
  const { binding } = reflected(`<main <span/>/>`);
  const root = mount(binding.tree.node);
  const child = root.childNodes[0] as FakeElement;
  assert.equal(child.getAttribute("hson:quid"), null);
  assert_no_claims();
  close(binding);
});

check("repeated projection retains exact DOM without minting", () => {
  const { binding } = reflected(`<main/>`);
  const first = mount(binding.tree.node);
  const second = mount(binding.tree.node);
  assert.equal(second, first);
  assert_no_claims();
  close(binding);
});

check("find wraps a QUID-less linked descendant without minting", () => {
  const { binding } = reflected(`<main <span/>/>`);
  const child = binding.tree.find.byTag("span");
  assert.equal(child?.node, raw_node(binding.tree.node, [0, 0]));
  assert.equal(child?.node.$_meta?.quid, undefined);
  assert_no_claims();
  close(binding);
});

check("direct linked-node wrapping preserves QUID absence", () => {
  const { binding } = reflected(`<main <span/>/>`);
  const childNode = raw_node(binding.tree.node, [0, 0]);
  const child = _create_livetree_for_runtime_test(runtime, childNode);
  assert.equal(child.node, childNode);
  assert.equal(child.node.$_meta?.quid, undefined);
  assert_no_claims();
  close(binding);
});

check("DOM reverse lookup uses exact correspondence without minting", () => {
  const { binding } = reflected(`<main <span/>/>`);
  const root = mount(binding.tree.node);
  const childNode = raw_node(binding.tree.node, [0, 0]);
  const child = binding.tree.dom.treeFromEl(root.childNodes[0] as unknown as Element);
  assert.equal(child?.node, childNode);
  assert_no_claims();
  close(binding);
});

check("attribute diagnostics do not mint an identity", () => {
  const { binding } = reflected(`<main/>`);
  assert.throws(
    () => binding.tree.attrs.must.get("missing"),
    (cause: unknown) => cause instanceof Error && Reflect.get(cause, "quid") === "<unassigned>",
  );
  assert.equal(binding.tree.node.$_meta?.quid, undefined);
  assert_no_claims();
  close(binding);
});

check("delegated attribute writes do not mint", () => {
  const { map, binding } = reflected(`<main/>`);
  binding.tree.attrs.set("title", "linked");
  assert.equal(map.document.attrs.get(path(), "title"), "linked");
  assert_no_claims();
  close(binding);
});

check("delegated attribute removal does not mint", () => {
  const { map, binding } = reflected(`<main title="old"/>`);
  binding.tree.attrs.drop("title");
  assert.equal(map.document.attrs.get(path(), "title"), undefined);
  assert_no_claims();
  close(binding);
});

check("delegated inline style writes do not mint", () => {
  const { map, binding } = reflected(`<main/>`);
  binding.tree.style.set.color("red");
  assert.deepEqual(map.document.attrs.get(path(), "style"), { color: "red" });
  assert_no_claims();
  close(binding);
});

check("delegated text writes do not mint", () => {
  const { map, binding } = reflected(`<main/>`);
  binding.tree.text.set("linked");
  assert.equal(raw_node(map.element.node(), [0, 0]).$_content[0], "linked");
  assert_no_claims();
  close(binding);
});

check("canonical insertion projects a QUID-less node without minting", () => {
  const { map, binding } = reflected(`<main "kept"/>`);
  mount(binding.tree.node);
  map.document.content.insert(path(0), 1, projected_element(`<span/>`));
  const inserted = raw_node(binding.tree.node, [0, 1]);
  assert.equal(inserted.$_meta?.quid, undefined);
  assert.equal(get_el_for_node(inserted)?.getAttribute("hson:quid"), null);
  assert_no_claims();
  close(binding);
});

check("QUID-less move preserves the exact projected node", () => {
  const { map, binding } = reflected(`<main <a/> <b/>/>`);
  const moved = raw_node(binding.tree.node, [0, 0]);
  map.document.content.move(path(0), 0, 1);
  assert.equal(raw_node(binding.tree.node, [0, 1]), moved);
  assert.equal(moved.$_meta?.quid, undefined);
  assert_no_claims();
  close(binding);
});

check("QUID-less replacement disposes the old exact node", () => {
  const { map, binding } = reflected(`<main <a/>/>`);
  const old = raw_node(binding.tree.node, [0, 0]);
  map.document.content.replace(path(0), 0, projected_element(`<b/>`));
  assert.equal(_is_livetree_node_disposed(old), true);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_meta?.quid, undefined);
  assert_no_claims();
  close(binding);
});

check("QUID-less removal disposes the removed exact node", () => {
  const { map, binding } = reflected(`<main <a/> <b/>/>`);
  const removed = raw_node(binding.tree.node, [0, 0]);
  map.document.content.remove(path(0), 0);
  assert.equal(_is_livetree_node_disposed(removed), true);
  assert_no_claims();
  close(binding);
});

check("new-epoch QUID-less root install is fresh and retains absence", () => {
  const { map, binding } = reflected(`<main class="old"/>`);
  const root = binding.tree.node;
  map.install(element(`<main class="new"/>`).capture());
  assert.notEqual(binding.tree.node, root);
  assert.equal(_is_livetree_node_disposed(root), true);
  assert.equal(binding.tree.node.$_meta?.quid, undefined);
  assert_no_claims();
  close(binding);
});

check("linked QUID access acquires exactly one canonical claim", () => {
  const { map, binding } = reflected(`<main/>`);
  const quid = binding.tree.quid;
  assert.equal(binding.tree.node.$_meta?.quid, quid);
  assert.equal(map.element.node().$_meta?.quid, quid);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 1);
  close(binding);
});

check("QUID-scoped CSS and events share one authority-owned acquisition", () => {
  const profile = begin_livetree_materialization_profile();
  const { map, binding } = reflected(`<main/>`);
  assert.ok(binding.tree.css);
  assert.ok(binding.tree.events);
  const result = profile.stop();
  assert.equal(result.quidEnsureCalls, 0);
  assert.equal(result.quidRegistryWrites, 2);
  assert.equal(map.rev, 1);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 1);
  close(binding);
});

_dispose_livetree_runtime_test_handle(runtime);
process.stdout.write(`Reflect linked no-mint projection acceptance: ${checks}/${checks}\n`);
emit_hson_live_test_completion("reflect.linked-no-mint-projection", checks, checks, 0);
