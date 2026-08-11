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
  _create_livetree_for_runtime_test,
  _create_livetree_runtime_test_handle,
  _dispose_livetree_runtime_test_handle,
  _livetree_runtime_test_claim_count,
  _project_livetree_for_runtime_test,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import { graft } from "../src/api/livetree/creation/graft.ts";
import { livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";
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

const runtime = _create_livetree_runtime_test_handle();
const SUPPLIED = "000001101";

check("standalone LiveTree construction still mints root identity", () => {
  const tree = _create_livetree_for_runtime_test(runtime, projected_element(`<main/>`));
  assert.equal(typeof tree.quid, "string");
  assert.equal(tree.node.$_meta?.quid, tree.quid);
  tree.remove();
});

check("standalone LiveTree construction preserves supplied identity", () => {
  const tree = _create_livetree_for_runtime_test(runtime, projected_element(`<main @${SUPPLIED}/>`));
  assert.equal(tree.quid, SUPPLIED);
  tree.remove();
});

check("standalone projection still mints descendant identity", () => {
  const tree = _create_livetree_for_runtime_test(runtime, projected_element(`<main <span/>/>`));
  _project_livetree_for_runtime_test(runtime, tree, syntheticDocument);
  const child = raw_node(tree.node, [0, 0]);
  assert.equal(typeof child.$_meta?.quid, "string");
  tree.remove();
});

check("standalone find still materializes descendant identity", () => {
  const tree = _create_livetree_for_runtime_test(runtime, projected_element(`<main <span/>/>`));
  const before = _livetree_runtime_test_claim_count(runtime);
  const child = tree.find.byTag("span");
  assert.equal(typeof child?.quid, "string");
  assert.equal(_livetree_runtime_test_claim_count(runtime), before + 1);
  tree.remove();
});

check("standalone DOM projection still emits hson:quid", () => {
  const tree = _create_livetree_for_runtime_test(runtime, projected_element(`<main/>`));
  const dom = _project_livetree_for_runtime_test(runtime, tree, syntheticDocument) as unknown as FakeElement;
  assert.equal(dom.getAttribute("hson:quid"), tree.quid);
  tree.remove();
});

check("standalone graft of an existing projection retains identity", () => {
  const tree = _create_livetree_for_runtime_test(runtime, projected_element(`<main/>`));
  const dom = _project_livetree_for_runtime_test(runtime, tree, syntheticDocument);
  const grafted = graft(dom as HTMLElement);
  assert.equal(grafted.node, tree.node);
  assert.equal(grafted.quid, tree.quid);
  tree.remove();
});

check("linked Reflection differs from standalone by preserving absence", () => {
  const map = element(`<main/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  assert.equal(binding.tree.node.$_meta?.quid, undefined);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  binding.dispose();
  binding.tree.remove();
});

check("QUID-free LiveMap begins with an empty sparse overlay", () => {
  const map = element(`<main <span/>/>`);
  assert.equal(livemap_document_identity_overlay_for(map).size, 0);
});

check("Reflection leaves a QUID-free LiveMap overlay empty", () => {
  const map = element(`<main <span/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  mount(binding.tree.node);
  assert.equal(livemap_document_identity_overlay_for(map).size, 0);
  binding.dispose();
  binding.tree.remove();
});

check("rendering does not mutate canonical LiveMap metadata", () => {
  const map = element(`<main class="same" <span/>/>`);
  const before = map.capture();
  const binding = _reflect_document_for_runtime_test(runtime, map);
  mount(binding.tree.node);
  assert.deepEqual(map.capture(), before);
  binding.dispose();
  binding.tree.remove();
});

check("QUID-free structural insertion keeps the overlay empty", () => {
  const map = element(`<main <a/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  map.document.content.insert(path(0), 1, projected_element(`<b/>`));
  assert.equal(livemap_document_identity_overlay_for(map).size, 0);
  assert.equal(raw_node(binding.tree.node, [0, 1]).$_meta?.quid, undefined);
  binding.dispose();
  binding.tree.remove();
});

check("path-first delegated attributes remain canonical", () => {
  const map = element(`<main <span/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const child = binding.tree.find.byTag("span");
  child?.attrs.set("title", "path-first");
  assert.equal(map.document.attrs.get(path(0, 0), "title"), "path-first");
  assert.equal(child?.node.$_meta?.quid, undefined);
  binding.dispose();
  binding.tree.remove();
});

check("path-first move retains exact QUID-less correspondence", () => {
  const map = element(`<main <a/> <b/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const moved = raw_node(binding.tree.node, [0, 0]);
  map.document.content.move(path(0), 0, 1);
  assert.equal(raw_node(binding.tree.node, [0, 1]), moved);
  assert.equal(moved.$_meta?.quid, undefined);
  binding.dispose();
  binding.tree.remove();
});

check("ordinary durable capture preserves QUID absence", () => {
  const source = element(`<main <span/>/>`);
  const restored = element(`<main/>`);
  restored.restore(source.capture());
  assert.equal(restored.element.node().$_meta?.quid, undefined);
  assert.equal(raw_node(restored.element.node(), [0, 0]).$_meta?.quid, undefined);
});

check("same-epoch capture preserves QUID absence", () => {
  const source = element(`<main <span/>/>`);
  const target = element(`<main/>`);
  target.install(source.capture({ identity: "same-epoch" }));
  assert.equal(target.element.node().$_meta?.quid, undefined);
  assert.equal(livemap_document_identity_overlay_for(target).size, 0);
});

check("identity stripping remains an explicit metadata fence", () => {
  const source = element(`<main @${SUPPLIED}/>`);
  const target = element(`<main/>`);
  target.restore(source.capture({ identity: "strip" }));
  assert.equal(target.element.node().$_meta?.quid, undefined);
  assert.equal(livemap_document_identity_overlay_for(target).size, 0);
});

check("linked explicit QUID demand registers exactly one canonical identity", () => {
  const map = element(`<main/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const quid = binding.tree.quid;
  assert.equal(map.rev, 1);
  assert.equal(map.element.node().$_meta?.quid, quid);
  assert.equal(binding.tree.node.$_meta?.quid, quid);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 1);
  binding.dispose();
  binding.tree.remove();
});

check("standalone QUID-scoped CSS remains available", () => {
  const tree = _create_livetree_for_runtime_test(runtime, projected_element(`<main/>`));
  assert.doesNotThrow(() => tree.css);
  assert.equal(typeof tree.quid, "string");
  tree.remove();
});

check("standalone event ownership remains available", () => {
  const tree = _create_livetree_for_runtime_test(runtime, projected_element(`<main/>`));
  assert.doesNotThrow(() => tree.events);
  assert.equal(typeof tree.quid, "string");
  tree.remove();
});

check("Unit 10 keeps acquisition internal and adds no raw reconstruction", () => {
  const map = element(`<main/>`);
  assert.equal(Reflect.get(map.document, "ensureIdentity"), undefined);
  assert.equal("retain" in map.document, false);
  assert.equal("fromQuid" in map.document, false);
});

_dispose_livetree_runtime_test_handle(runtime);
process.stdout.write(`Reflect no-mint regression boundaries acceptance: ${checks}/${checks}\n`);
emit_hson_live_test_completion("reflect.no-mint-regression-boundaries", checks, checks, 0);
