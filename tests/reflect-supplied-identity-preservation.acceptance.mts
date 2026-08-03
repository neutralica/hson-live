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
  _livetree_runtime_test_claim_count,
  _lookup_livetree_runtime_test_node,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import { FakeElement } from "./helpers/fake-document.mts";

const syntheticDocument = globalThis.document;
const syntheticHead = new FakeElement("head");
syntheticHead.isConnected = true;
Reflect.set(syntheticDocument, "head", syntheticHead);
Reflect.set(syntheticDocument, "documentElement", syntheticHead);
Reflect.set(syntheticDocument, "querySelector", () => undefined);
Reflect.set(FakeElement.prototype, "querySelector", () => undefined);

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const Q1 = "0000000000001001";
const Q2 = "0000000000001002";
const Q3 = "0000000000001003";
const Q4 = "0000000000001004";
const COLLISION = "0000000000001099";
const runtime = _create_livetree_runtime_test_handle();

function reflected(source: string) {
  const map = element(source);
  return Object.freeze({ map, binding: _reflect_document_for_runtime_test(runtime, map) });
}

function close(binding: ReturnType<typeof reflected>["binding"]): void {
  binding.dispose();
  binding.tree.remove();
}

check("canonical root QUID is preserved by linked construction", () => {
  const { binding } = reflected(`<main @${Q1}/>`);
  assert.equal(binding.tree.node.$_meta?.quid, Q1);
  assert.equal(binding.tree.quid, Q1);
  close(binding);
});

check("canonical descendant QUID is preserved by linked construction", () => {
  const { binding } = reflected(`<main <span @${Q2}/>/>`);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_meta?.quid, Q2);
  close(binding);
});

check("root DOM hson:quid matches canonical metadata", () => {
  const { binding } = reflected(`<main @${Q1}/>`);
  assert.equal(mount(binding.tree.node).getAttribute("hson:quid"), Q1);
  close(binding);
});

check("descendant DOM hson:quid matches canonical metadata", () => {
  const { binding } = reflected(`<main <span @${Q2}/>/>`);
  const root = mount(binding.tree.node);
  assert.equal((root.childNodes[0] as FakeElement).getAttribute("hson:quid"), Q2);
  close(binding);
});

check("runtime lookup resolves the canonical root claim", () => {
  const { binding } = reflected(`<main @${Q1}/>`);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), binding.tree.node);
  close(binding);
});

check("runtime lookup resolves the canonical descendant claim", () => {
  const { binding } = reflected(`<main <span @${Q2}/>/>`);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q2), raw_node(binding.tree.node, [0, 0]));
  close(binding);
});

check("linked admission retains exactly the supplied sparse claims", () => {
  const { binding } = reflected(`<main @${Q1} <span/> <i @${Q2}/>/>`);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 2);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_meta?.quid, undefined);
  close(binding);
});

check("linked admission never calls the QUID allocator", () => {
  const profile = begin_livetree_materialization_profile();
  const { binding } = reflected(`<main @${Q1} <span @${Q2}/>/>`);
  const result = profile.stop();
  assert.equal(result.quidEnsureCalls, 0);
  assert.equal(result.quidRegistryWrites, 4);
  close(binding);
});

check("repeated supplied projection performs no remint or registry rewrite", () => {
  const { binding } = reflected(`<main @${Q1}/>`);
  const profile = begin_livetree_materialization_profile();
  const first = mount(binding.tree.node);
  const second = mount(binding.tree.node);
  const result = profile.stop();
  assert.equal(second, first);
  assert.equal(result.quidEnsureCalls, 0);
  assert.equal(result.quidRegistryWrites, 0);
  close(binding);
});

check("find returns the exact supplied-QUID descendant", () => {
  const { binding } = reflected(`<main <span @${Q2}/>/>`);
  const child = binding.tree.find.byTag("span");
  assert.equal(child?.quid, Q2);
  assert.equal(child?.node, raw_node(binding.tree.node, [0, 0]));
  close(binding);
});

check("DOM reverse lookup returns the supplied-QUID descendant", () => {
  const { binding } = reflected(`<main <span @${Q2}/>/>`);
  const root = mount(binding.tree.node);
  const child = binding.tree.dom.treeFromEl(root.childNodes[0] as unknown as Element);
  assert.equal(child?.quid, Q2);
  close(binding);
});

check("delegated attributes retain the canonical claim", () => {
  const { map, binding } = reflected(`<main @${Q1}/>`);
  binding.tree.attrs.set("title", "kept");
  assert.equal(map.document.byQuid(Q1)?.$_attrs?.title, "kept");
  assert.equal(binding.tree.quid, Q1);
  close(binding);
});

check("canonical insertion registers a supplied descendant claim", () => {
  const { map, binding } = reflected(`<main @${Q1} "kept"/>`);
  mount(binding.tree.node);
  map.document.content.insert(path(0), 1, projected_element(`<span @${Q3}/>`));
  const inserted = raw_node(binding.tree.node, [0, 1]);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q3), inserted);
  assert.equal(get_el_for_node(inserted)?.getAttribute("hson:quid"), Q3);
  close(binding);
});

check("mixed insertion preserves supplied identity and QUID absence", () => {
  const { map, binding } = reflected(`<main @${Q1} <a/>/>`);
  map.document.content.insert(path(0), 1, projected_element(`<b @${Q3}/>`));
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_meta?.quid, undefined);
  assert.equal(raw_node(binding.tree.node, [0, 1]).$_meta?.quid, Q3);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 2);
  close(binding);
});

check("same-runtime standalone collision rejects linked admission", () => {
  const occupied = _create_livetree_for_runtime_test(runtime, projected_element(`<aside @${COLLISION}/>`));
  assert.throws(
    () => _reflect_document_for_runtime_test(runtime, element(`<main @${COLLISION}/>`)),
    /Initial LiveTree projection construction failed/,
  );
  occupied.remove();
});

check("same-runtime reflected collision rejects a second binding", () => {
  const first = reflected(`<main @${COLLISION}/>`).binding;
  assert.throws(
    () => _reflect_document_for_runtime_test(runtime, element(`<aside @${COLLISION}/>`)),
    /Initial LiveTree projection construction failed/,
  );
  close(first);
});

check("equal canonical QUIDs admit independently in separate runtimes", () => {
  const leftRuntime = _create_livetree_runtime_test_handle();
  const rightRuntime = _create_livetree_runtime_test_handle();
  const left = _reflect_document_for_runtime_test(leftRuntime, element(`<main @${Q4}/>`));
  const right = _reflect_document_for_runtime_test(rightRuntime, element(`<main @${Q4}/>`));
  assert.equal(left.tree.quid, Q4);
  assert.equal(right.tree.quid, Q4);
  left.dispose();
  left.tree.remove();
  right.dispose();
  right.tree.remove();
  _dispose_livetree_runtime_test_handle(leftRuntime);
  _dispose_livetree_runtime_test_handle(rightRuntime);
});

check("durable capture preserves supplied QUID metadata", () => {
  const source = element(`<main @${Q1} <span @${Q2}/>/>`);
  const restored = element(`<main/>`);
  restored.restore(source.capture());
  assert.equal(restored.element.node().$_meta?.quid, Q1);
  assert.equal(raw_node(restored.element.node(), [0, 0]).$_meta?.quid, Q2);
});

check("durably restored QUIDs project without reminting", () => {
  const source = element(`<main @${Q1} <span @${Q2}/>/>`);
  const restored = element(`<main/>`);
  restored.restore(source.capture());
  const profile = begin_livetree_materialization_profile();
  const binding = _reflect_document_for_runtime_test(runtime, restored);
  const result = profile.stop();
  assert.equal(binding.tree.quid, Q1);
  assert.equal(result.quidEnsureCalls, 0);
  close(binding);
});

check("identity-stripped capture projects with no supplied claims", () => {
  const source = element(`<main @${Q1} <span @${Q2}/>/>`);
  const stripped = element(`<main/>`);
  stripped.restore(source.capture({ identity: "strip" }));
  const binding = _reflect_document_for_runtime_test(runtime, stripped);
  assert.equal(binding.tree.node.$_meta?.quid, undefined);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_meta?.quid, undefined);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  close(binding);
});

_dispose_livetree_runtime_test_handle(runtime);
process.stdout.write(`Reflect supplied identity preservation acceptance: ${checks}/${checks}\n`);
emit_hson_live_test_completion("reflect.supplied-identity-preservation", checks, checks, 0);
