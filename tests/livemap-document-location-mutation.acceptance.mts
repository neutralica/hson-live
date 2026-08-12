// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import {
  _create_livetree_runtime_test_handle,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import { LiveMapDocumentMutationError } from "../src/api/livemap/livemap.error.ts";
import { element as reflectedElement, raw_node } from "./helpers/reflect-unit6.mts";
import type {
  ElementLiveMap,
  FragmentLiveMap,
  LiveMapDocumentRequestTarget,
} from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element map; observed ${map.mode}`);
  return map;
}

function fragment(source: string): FragmentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "fragment") throw new Error(`Expected fragment map; observed ${map.mode}`);
  return map;
}

const target = (...path: number[]): LiveMapDocumentRequestTarget => ({ kind: "path", path });
const ordinary = (source: string) => element(source).element.node();
const tag = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "$_tag" in value ? String(value.$_tag) : undefined;
const mutationCode = (run: () => unknown, code: LiveMapDocumentMutationError["code"]): void => {
  assert.throws(run, (error: unknown) =>
    error instanceof LiveMapDocumentMutationError && error.code === code);
};

check("replace changes one root child element", () => {
  const map = element(`<main <a/> <b/>/>`);
  map.at([0]).replace(ordinary(`<x/>`));
  assert.equal(tag(map.at([0]).snap()), "x");
  assert.equal(tag(map.at([1]).snap()), "b");
});

check("replace changes one nested logical element", () => {
  const map = element(`<main <section <a/> <b/>/>/>`);
  map.at([0]).at([1]).replace(ordinary(`<x/>`));
  assert.equal(tag(map.at([0, 1]).snap()), "x");
});

check("replace normalizes authored text through the canonical planner", () => {
  const map = element(`<main "before"/>`);
  const commit = map.at([0]).replace("after");
  assert.equal(map.at([0]).snap(), "after");
  assert.equal(commit.ops[0]?.op === "replace-content" ? tag(commit.ops[0].replacement) : undefined, "_hson_str");
});

check("replace can change an element into authored text", () => {
  const map = element(`<main <a/>/>`);
  map.at([0]).replace("text");
  assert.equal(map.at([0]).snap(), "text");
});

check("replace can change authored text into an element", () => {
  const map = element(`<main "text"/>`);
  map.at([0]).replace(ordinary(`<a/>`));
  assert.equal(tag(map.at([0]).snap()), "a");
});

check("replace rejects a currently missing logical location", () => {
  mutationCode(() => element(`<main/>`).at([0]).replace(ordinary(`<x/>`)), "INVALID_DOCUMENT_CONTENT_INDEX");
});

check("replace rejects the document root location", () => {
  mutationCode(() => element(`<main/>`).at([]).replace(ordinary(`<x/>`)), "DOCUMENT_TARGET_KIND");
});

check("replace emits the exact existing replace-content operation", () => {
  const byLocation = element(`<main <a @000000001/>/>`);
  const byDocument = element(`<main <a @000000001/>/>`);
  const replacement = ordinary(`<x @000000002/>`);
  const locationCommit = byLocation.at([0]).replace(replacement);
  const documentCommit = byDocument.document.content.replace(target(0), 0, replacement);
  assert.deepEqual(locationCommit, documentCommit);
  assert.deepEqual(byLocation.root(), byDocument.root());
  assert.equal(byLocation.document.byQuid("000000001"), undefined);
  assert.equal(byLocation.document.byQuid("000000002")?.$_tag, "x");
});

check("replace advances revision exactly once", () => {
  const map = element(`<main <a/>/>`);
  const commit = map.at([0]).replace(ordinary(`<x/>`));
  assert.deepEqual([commit.prevRev, commit.rev, map.rev], [0, 1, 1]);
});

check("replace leaves the location attached to its fixed coordinate", () => {
  const map = element(`<main <a/>/>`);
  const location = map.at([0]);
  location.replace(ordinary(`<x/>`));
  assert.equal(location, map.at([0]));
  assert.equal(tag(location.snap()), "x");
});

check("replace commits replay through the existing document path", () => {
  const source = element(`<main <a/>/>`);
  const receiver = element(`<main <a/>/>`);
  receiver.replay(source.at([0]).replace(ordinary(`<x/>`)));
  assert.deepEqual(receiver.root(), source.root());
});

check("Reflection consumes location replacement without a special case", () => {
  const map = reflectedElement(`<main <a/>/>`);
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map);
  map.at([0]).replace(ordinary(`<x/>`));
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_tag, "x");
  binding.dispose();
});

check("delete removes one root child", () => {
  const map = element(`<main <a/> <b/>/>`);
  map.at([0]).delete();
  assert.equal(tag(map.at([0]).snap()), "b");
});

check("delete removes one nested logical content item", () => {
  const map = element(`<main <section <a/> <b/>/>/>`);
  map.at([0, 1]).delete();
  assert.equal(map.at([0, 1]).snap(), undefined);
  assert.equal(tag(map.at([0, 0]).snap()), "a");
});

check("delete removes authored text as one logical item", () => {
  const map = element(`<main "before" <a/>/>`);
  map.at([0]).delete();
  assert.equal(tag(map.at([0]).snap()), "a");
});

check("delete shifts the next occupant into the fixed location", () => {
  const map = element(`<main <a/> <b/>/>`);
  const location = map.at([0]);
  location.delete();
  assert.equal(location, map.at([0]));
  assert.equal(tag(location.snap()), "b");
});

check("deleting the final element item restores existing empty canonical state", () => {
  const map = element(`<main <a/>/>`);
  const commit = map.at([0]).delete();
  assert.equal(map.at([0]).snap(), undefined);
  assert.deepEqual(map.element.node().$_content, []);
  assert.equal(commit.ops[0]?.op, "remove-content");

  const fragmentMap = fragment(`"only"`);
  const fragmentReceiver = fragment(`"only"`);
  const fragmentCommit = fragmentMap.at([0]).delete();
  fragmentReceiver.replay(fragmentCommit);
  assert.deepEqual(fragmentMap.root(), { $_tag: "_hson_root", $_content: [] });
  assert.deepEqual(fragmentReceiver.root(), fragmentMap.root());
  assert.equal(fragmentCommit.ops[0]?.op, "remove-content");
});

check("delete rejects a currently missing logical location", () => {
  mutationCode(() => element(`<main/>`).at([0]).delete(), "INVALID_DOCUMENT_CONTENT_INDEX");
});

check("delete rejects the document root location", () => {
  mutationCode(() => fragment(`<a/> <b/>`).at([]).delete(), "DOCUMENT_TARGET_KIND");
});

check("delete emits the exact existing remove-content operation", () => {
  const byLocation = element(`<main <a @000000003/> <b/>/>`);
  const byDocument = element(`<main <a @000000003/> <b/>/>`);
  const locationCommit = byLocation.at([0]).delete();
  const documentCommit = byDocument.document.content.remove(target(0), 0);
  assert.deepEqual(locationCommit, documentCommit);
  assert.deepEqual(byLocation.root(), byDocument.root());
  assert.equal(byLocation.document.byQuid("000000003"), undefined);
});

check("delete advances revision exactly once", () => {
  const map = element(`<main <a/> <b/>/>`);
  const commit = map.at([0]).delete();
  assert.deepEqual([commit.prevRev, commit.rev, map.rev], [0, 1, 1]);
});

check("delete commits replay through the existing document path", () => {
  const source = element(`<main <a/> <b/>/>`);
  const receiver = element(`<main <a/> <b/>/>`);
  receiver.replay(source.at([0]).delete());
  assert.deepEqual(receiver.root(), source.root());
});

check("Reflection consumes location deletion without a special case", () => {
  const map = reflectedElement(`<main <a/> <b/>/>`);
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map);
  map.at([0]).delete();
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_tag, "b");
  binding.dispose();
});

check("proxy escapes delegate to the exact same location operations", () => {
  const map = element(`<main <a/> <b/>/>`);
  assert.equal(map.proxy()[0].$_, map.at([0]));
  assert.equal(map.proxy()[0].$_.replace(ordinary(`<x/>`)).ops[0]?.op, "replace-content");
  assert.equal(map.proxy()[0].$_.delete().ops[0]?.op, "remove-content");
  assert.equal(tag(map.at([0]).snap()), "b");
});

check("location mutation acquisition is non-minting and does not broaden capabilities", () => {
  const map = element(`<main <a/>/>`);
  const before = map.root();
  const location = map.at([0]);
  assert.equal(JSON.stringify(before).includes("quid"), false);
  assert.equal("set" in location, false);
  assert.equal("update" in location, false);
  assert.equal("array" in location, false);
  assert.equal("object" in location, false);
  const projected = hson.liveMap.fromJson({ item: 1 });
  assert.equal(typeof projected.at(["item"]).replace, "function");
  assert.equal(typeof projected.at(["item"]).delete, "function");
  assert.equal(JSON.stringify(map.root()).includes("quid"), false);
});

process.stdout.write(`# ${checks} document location mutation checks passed\n`);
emit_hson_live_test_completion("livemap.document-location-mutation", checks, checks, 0);
