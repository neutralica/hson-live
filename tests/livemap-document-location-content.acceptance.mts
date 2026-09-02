// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { _create_livetree_runtime_test_handle, _reflect_document_for_runtime_test } from "../src/diagnostics/index.ts";
import { LiveMapDocumentMutationError } from "../src/api/livemap/livemap.error.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { DocumentLiveMap, LiveMapDocumentRequestTarget } from "../src/types/livemap.types.ts";
import { element as reflectedElement, raw_node } from "./helpers/reflect-unit6.mts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-location-content",
  title: "Document location ordered-content convergence",
  category: "LiveMap",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "path", "mutation", "proxy", "reflection", "public-api", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-location-content");
let checks = 0;
const check = (name: string, run: () => void): void => {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  } checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); };
const element = (source: string): DocumentLiveMap => { const map = hson.liveMap.fromHson(source); if (map.mode !== "document") throw new Error("Expected element map"); return map; };
const multiNodeDocument = (source: string): DocumentLiveMap => { const map = hson.liveMap.fromHson(source); if (map.mode !== "document") throw new Error("Expected multiNodeDocument map"); return map; };
const emptyDocumentSequence = (): DocumentLiveMap => { const map = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] }); if (map.mode !== "document") throw new Error("Expected multiNodeDocument map"); return map; };
const ordinary = (source: string): HsonNode => {
  const only = element(source).root().$_content[0];
  if (typeof only !== "object" || only === null) throw new Error("Expected one ordinary document element");
  return only;
};
const target = (...path: number[]): LiveMapDocumentRequestTarget => ({ kind: "path", path });
const tag = (value: unknown): string | undefined => typeof value === "object" && value !== null && "$_tag" in value ? String(value.$_tag) : undefined;
const code = (run: () => unknown, expected: LiveMapDocumentMutationError["code"]): void => assert.throws(run, (error: unknown) => error instanceof LiveMapDocumentMutationError && error.code === expected);

check("element-root insert owns root authored content", () => { const map = element(`<main <b/>/>`); map.at([]).insert(0, ordinary(`<a/>`)); assert.deepEqual([tag(map.at([0]).snap()), tag(map.at([1]).snap())], ["a", "b"]); });
check("nested-element insert owns nested authored content", () => { const map = element(`<main <section <b/>/>/>`); map.at([0]).insert(0, ordinary(`<a/>`)); assert.deepEqual([tag(map.at([0, 0]).snap()), tag(map.at([0, 1]).snap())], ["a", "b"]); });
check("first empty-element insert reuses carrier materialization", () => { const map = element(`<main/>`); const commit = map.at([]).insert(0, ordinary(`<a/>`)); assert.equal(commit.ops[0]?.op, "insert-content"); assert.equal(tag(map.at([0]).snap()), "a"); });
check("multiNodeDocument-root insert owns top-level content", () => { const map = multiNodeDocument(`<a/> <c/>`); map.at([]).insert(1, ordinary(`<b/>`)); assert.deepEqual([0, 1, 2].map((i) => tag(map.at([i]).snap())), ["a", "b", "c"]); });
check("first empty-multiNodeDocument text insert reuses canonical materialization", () => { const map = emptyDocumentSequence(); const equivalent = emptyDocumentSequence(); const receiver = emptyDocumentSequence(); const commit = map.at([]).insert(0, "first"); assert.equal(commit.ops[0]?.op, "insert-content"); assert.deepEqual(commit, equivalent.document.content.insert(target(), 0, "first")); receiver.replay(commit); assert.deepEqual(map.root(), equivalent.root()); assert.deepEqual(receiver.root(), map.root()); assert.equal(map.at([0]).snap(), "first"); });
check("string insert uses established authored normalization", () => { const map = element(`<main/>`); const commit = map.at([]).insert(0, "text"); assert.equal(commit.ops[0]?.op === "insert-content" ? tag(commit.ops[0].content) : undefined, "_hson_elem"); assert.equal(map.at([0]).snap(), "text"); });
check("invalid insert index rejects exactly", () => { code(() => element(`<main/>`).at([]).insert(1, "x"), "INVALID_DOCUMENT_CONTENT_INDEX"); });
check("insert on primitive endpoint rejects", () => { code(() => element(`<main "x"/>`).at([0]).insert(0, "y"), "DOCUMENT_TARGET_KIND"); });
check("element-root move uses final indexes", () => { const map = element(`<main <a/> <b/> <c/>/>`); map.at([]).move(0, 2); assert.deepEqual([0, 1, 2].map((i) => tag(map.at([i]).snap())), ["b", "c", "a"]); });
check("nested move owns only nested content", () => { const map = element(`<main <section <a/> <b/>/> <aside/>/>`); map.at([0]).move(1, 0); assert.deepEqual([tag(map.at([0, 0]).snap()), tag(map.at([0, 1]).snap()), tag(map.at([1]).snap())], ["b", "a", "aside"]); });
check("multiNodeDocument move owns top-level content", () => { const map = multiNodeDocument(`<a/> <b/> <c/>`); map.at([]).move(2, 0); assert.deepEqual([0, 1, 2].map((i) => tag(map.at([i]).snap())), ["c", "a", "b"]); });
check("move to is the canonical final position", () => { const map = element(`<main <a/> <b/> <c/> <d/>/>`); map.at([]).move(1, 3); assert.deepEqual([0, 1, 2, 3].map((i) => tag(map.at([i]).snap())), ["a", "c", "d", "b"]); });
check("move on non-container rejects", () => { code(() => element(`<main "x"/>`).at([0]).move(0, 0), "DOCUMENT_TARGET_KIND"); });
check("child location remains fixed after movement", () => { const map = element(`<main <a/> <b/>/>`); const first = map.at([0]); map.at([]).move(0, 1); assert.equal(first, map.at([0])); assert.equal(tag(first.snap()), "b"); });
check("proxy escape delegates insert", () => { const map = element(`<main <section/>/>`); assert.equal(map.proxy()[0].$_, map.at([0])); assert.equal(map.proxy()[0].$_.insert(0, ordinary(`<a/>`)).ops[0]?.op, "insert-content"); });
check("proxy escape delegates move", () => { const map = element(`<main <a/> <b/>/>`); assert.equal(map.proxy().$_.move(0, 1).ops[0]?.op, "move-content"); assert.equal(tag(map.at([0]).snap()), "b"); });
check("insert commit exactly equals document API", () => { const left = element(`<main <a/>/>`); const right = element(`<main <a/>/>`); const value = ordinary(`<b/>`); assert.deepEqual(left.at([]).insert(1, value), right.document.content.insert(target(0, 0), 1, value)); assert.deepEqual(left.root(), right.root()); });
check("move commit exactly equals document API", () => { const left = element(`<main <a/> <b/>/>`); const right = element(`<main <a/> <b/>/>`); assert.deepEqual(left.at([]).move(0, 1), right.document.content.move(target(0, 0), 0, 1)); assert.deepEqual(left.root(), right.root()); });
check("location content commits replay without special cases", () => { const source = element(`<main <a/> <b/>/>`); const receiver = element(`<main <a/> <b/>/>`); receiver.replay(source.at([]).move(0, 1)); assert.deepEqual(receiver.root(), source.root()); });
check("Reflection consumes location content commits", () => { const map = reflectedElement(`<main <a/>/>`); const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map); map.at([]).insert(1, ordinary(`<b/>`)); assert.equal(raw_node(binding.tree.node, [0, 1]).$_tag, "b"); binding.dispose(); });
check("capability acquisition never mints QUIDs", () => { const map = element(`<main <a/>/>`); const location = map.at([]); void location.insert; void location.move; assert.equal(JSON.stringify(map.root()).includes("quid"), false); assert.equal(map.rev, 0); });
check("surface adds no duplicate item or generic operators", () => { const location = element(`<main/>`).at([]); assert.equal("remove" in location, false); assert.equal("set" in location, false); assert.equal("update" in location, false); const projected = hson.liveMap.fromJson([1]); assert.equal("insert" in projected.at([]), false); assert.equal("move" in projected.at([]), false); });

process.stdout.write(`# ${checks} document location ordered-content checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.document-location-content", checks, checks, 0);
