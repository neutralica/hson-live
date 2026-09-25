import assert from "node:assert/strict";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";
import { GlobalCss } from "../src/api/livetree/managers/global-css.ts";
import {
  clone_portable_document_stylesheet,
  decode_portable_document_stylesheet,
  drop_portable_document_keyframes,
  drop_portable_document_property,
  drop_portable_document_rule,
  empty_portable_document_stylesheet,
  encode_portable_document_stylesheet,
  portable_document_stylesheet_equal,
  render_portable_document_stylesheet,
  set_portable_document_declaration,
  set_portable_document_keyframes,
  set_portable_document_property,
} from "../src/internal/css/portable-document-stylesheet.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "css.portable-document-stylesheet",
  title: "Portable document stylesheet canonical state",
  category: "LiveTree",
  runtime: "node",
  tags: Object.freeze(["css", "portable", "worker"]),
});

const testEvents = create_test_event_emitter("css.portable-document-stylesheet");
function check(name: string, run: () => void): void {
  testEvents.case_begin(name, name);
  try { run(); testEvents.case_end(name, "pass"); }
  catch (error) {
    testEvents.diagnostic(name, "assertion", error instanceof Error ? error.message : "Check failed.");
    testEvents.case_end(name, "fail"); testEvents.terminal("fail"); throw error;
  }
}

check("empty state clones, round trips, compares and renders empty", () => {
  const empty = empty_portable_document_stylesheet();
  assert.deepEqual(encode_portable_document_stylesheet(empty), { rules: [], properties: [], keyframes: [], order: [] });
  assert.equal(render_portable_document_stylesheet(empty), "");
  assert.ok(portable_document_stylesheet_equal(empty, clone_portable_document_stylesheet(empty)));
  assert.ok(portable_document_stylesheet_equal(empty, decode_portable_document_stylesheet(JSON.parse(JSON.stringify(encode_portable_document_stylesheet(empty))))));
  assert.notEqual(empty, clone_portable_document_stylesheet(empty));
});

check("selector rules retain first-write order and re-add appends", () => {
  let sheet = empty_portable_document_stylesheet();
  sheet = set_portable_document_declaration(sheet, "a", ".a", "color", "red");
  sheet = set_portable_document_declaration(sheet, "b", ".b", "display", "grid");
  sheet = set_portable_document_declaration(sheet, "a", ".a", "background-color", "black");
  assert.deepEqual(sheet.rules.map((rule) => rule.ruleKey), ["a", "b"]);
  assert.deepEqual(encode_portable_document_stylesheet(sheet).rules[0]?.declarations,
    [["backgroundColor", "black"], ["color", "red"]]);
  assert.equal(render_portable_document_stylesheet(sheet), ".a{background-color:black;color:red;}\n\n.b{display:grid;}");
  const same = set_portable_document_declaration(sheet, "a", ".a", "color", "red");
  assert.equal(same, sheet, "semantic no-op returns the existing value");
  const removed = drop_portable_document_rule(sheet, "a");
  assert.deepEqual(removed.rules.map((rule) => rule.ruleKey), ["b"]);
  const readded = set_portable_document_declaration(removed, "a", ".a", "color", "red");
  assert.deepEqual(readded.rules.map((rule) => rule.ruleKey), ["b", "a"]);
  assert.ok(!portable_document_stylesheet_equal(sheet, readded));
  assert.ok(portable_document_stylesheet_equal(readded, clone_portable_document_stylesheet(readded)));
  assert.ok(portable_document_stylesheet_equal(readded, decode_portable_document_stylesheet(JSON.parse(JSON.stringify(encode_portable_document_stylesheet(readded))))));
});

check("semantic equality retains rule identity even when CSS text matches", () => {
  let first = empty_portable_document_stylesheet();
  first = set_portable_document_declaration(first, "first", ".x", "color", "red");
  first = set_portable_document_declaration(first, "second", ".x", "color", "red");
  let second = empty_portable_document_stylesheet();
  second = set_portable_document_declaration(second, "second", ".x", "color", "red");
  second = set_portable_document_declaration(second, "first", ".x", "color", "red");
  assert.equal(render_portable_document_stylesheet(first), render_portable_document_stylesheet(second));
  assert.equal(portable_document_stylesheet_equal(first, second), false);
});

check("scopes, variables and selector changes follow global rule semantics", () => {
  let sheet = empty_portable_document_stylesheet();
  sheet = set_portable_document_declaration(sheet, "global-vars::root", ":root", "--accent", "purple");
  sheet = set_portable_document_declaration(sheet, "button", ".button", "color", "var(--accent)", ["@layer components"]);
  sheet = set_portable_document_declaration(sheet, "button", ".button", "color", "white", ["@media (max-width: 600px)", "@supports (display: grid)"]);
  assert.equal(sheet.rules.length, 3);
  assert.deepEqual(sheet.rules[2]?.scopes, ["@media (max-width: 600px)", "@supports (display: grid)"]);
  assert.match(render_portable_document_stylesheet(sheet), /@layer components \{\n  \.button\{color:var\(--accent\);\}\n\}/);
  assert.match(render_portable_document_stylesheet(sheet), /@media \(max-width: 600px\) \{\n  @supports \(display: grid\) \{/);
  const changedSelector = set_portable_document_declaration(sheet, "button", ".link", "color", "blue", ["@layer components"]);
  assert.equal(changedSelector.rules[1]?.selector, ".link");
  assert.deepEqual(changedSelector.rules[1]?.declarations, { color: "blue" });
  assert.deepEqual(changedSelector.rules.map((rule) => rule.ruleKey), ["global-vars::root", "button", "button"]);
});

check("portable selector rendering matches the current GlobalCss text path", () => {
  const runtime = new GlobalCss().api(() => {});
  runtime.rule("a", ".a").setMany({ color: "red", backgroundColor: "black" });
  runtime.media("(max-width: 600px)").rule("b", ".b").set.color("white");
  runtime.var.set("accent", "purple");
  let sheet = empty_portable_document_stylesheet();
  sheet = set_portable_document_declaration(sheet, "a", ".a", "color", "red");
  sheet = set_portable_document_declaration(sheet, "a", ".a", "backgroundColor", "black");
  sheet = set_portable_document_declaration(sheet, "b", ".b", "color", "white", ["@media (max-width: 600px)"]);
  sheet = set_portable_document_declaration(sheet, "global-vars::root", ":root", "--accent", "purple");
  assert.equal(render_portable_document_stylesheet(sheet), runtime.renderAll());
  runtime.dispose();
});

check("global @property and authored keyframes clone, round trip and retain authored order", () => {
  let sheet = empty_portable_document_stylesheet();
  sheet = set_portable_document_property(sheet, ["--z", "*", "anything"]);
  sheet = set_portable_document_property(sheet, ["--phase", "<number>", "0"]);
  sheet = set_portable_document_keyframes(sheet, { name: "zoom", steps: { to: { opacity: "1" }, from: { opacity: "0" } } });
  sheet = set_portable_document_keyframes(sheet, { name: "fade", steps: { "50%": { opacity: "0.5" }, from: { opacity: "0" }, to: { opacity: "1" } } });
  sheet = set_portable_document_declaration(sheet, "body", "body", "animation", "fade 1s");
  assert.deepEqual(sheet.properties.map((item) => item.name), ["--phase", "--z"]);
  assert.deepEqual(sheet.keyframes.map((item) => item.name), ["fade", "zoom"]);
  assert.deepEqual(sheet.keyframes[0]?.steps.map((step) => step.at), ["from", "50%", "to"]);
  const css = render_portable_document_stylesheet(sheet);
  assert.ok(css.indexOf("@property --z") < css.indexOf("@property --phase"));
  assert.ok(css.indexOf("@property --phase") < css.indexOf("@keyframes zoom"));
  assert.ok(css.indexOf("@keyframes zoom") < css.indexOf("@keyframes fade"));
  assert.ok(css.indexOf("@keyframes zoom") < css.indexOf("body{animation:fade 1s;}"));
  const clone = clone_portable_document_stylesheet(sheet);
  assert.ok(portable_document_stylesheet_equal(sheet, clone));
  assert.notEqual(sheet.keyframes[0], clone.keyframes[0]);
  assert.notEqual(sheet.keyframes[0]?.steps[0]?.decls, clone.keyframes[0]?.steps[0]?.decls);
  assert.ok(Object.isFrozen(clone.keyframes[0]?.steps[0]?.decls));
  const decoded = decode_portable_document_stylesheet(JSON.parse(JSON.stringify(encode_portable_document_stylesheet(sheet))));
  assert.ok(portable_document_stylesheet_equal(sheet, decoded));
  assert.equal(render_portable_document_stylesheet(sheet), render_portable_document_stylesheet(decoded));
  assert.equal(set_portable_document_property(sheet, ["--phase", "<number>", "0"]), sheet);
  assert.equal(set_portable_document_keyframes(sheet, { name: "fade", steps: { to: { opacity: "1" }, from: { opacity: "0" }, "50%": { opacity: "0.5" } } }), sheet);
  assert.equal(drop_portable_document_property(sheet, "--missing"), sheet);
  assert.equal(drop_portable_document_keyframes(sheet, "missing"), sheet);
  assert.deepEqual(drop_portable_document_property(sheet, "--phase").properties.map((item) => item.name), ["--z"]);
  assert.deepEqual(drop_portable_document_keyframes(sheet, "fade").keyframes.map((item) => item.name), ["zoom"]);
});

check("admission rejects nonportable or ambiguous records", () => {
  assert.throws(() => decode_portable_document_stylesheet({ rules: [{ ruleKey: "a", selector: ".a", scopes: [], declarations: [["color", "red"], ["color", "blue"]] }], properties: [], keyframes: [], order: [{ kind: "rule", ruleKey: "a", scopes: [] }] }));
  assert.throws(() => decode_portable_document_stylesheet({ rules: [{ ruleKey: "a", selector: ".a", scopes: [], declarations: [["color", "red"]] }, { ruleKey: "a", selector: ".b", scopes: [], declarations: [["color", "blue"]] }], properties: [], keyframes: [], order: [{ kind: "rule", ruleKey: "a", scopes: [] }] }));
  assert.throws(() => decode_portable_document_stylesheet({ rules: [], properties: [{ name: "--phase", syn: "<number>", inh: false }], keyframes: [], order: [{ kind: "property", name: "--phase" }] }));
  assert.throws(() => decode_portable_document_stylesheet({ rules: [], properties: [], keyframes: [{ name: "fade", steps: [{ at: "wat", declarations: [["opacity", "0"]] }] }], order: [{ kind: "keyframes", name: "fade" }] }));
  assert.throws(() => decode_portable_document_stylesheet({ rules: [], properties: [], keyframes: [{ name: "fade", owner: "runtime-node", steps: [{ at: "from", declarations: [["opacity", "0"]] }] }], order: [{ kind: "keyframes", name: "fade" }] }));
  assert.throws(() => decode_portable_document_stylesheet({ rules: [], properties: [], keyframes: [], order: [], quid: "000000abc" }));
  const accessor = Object.defineProperty({ rules: [], properties: [], order: [] }, "keyframes", { enumerable: true, get: () => [] });
  assert.throws(() => decode_portable_document_stylesheet(accessor));
});

check("portable admission and rendering ignore browser CSS.supports", () => {
  const sample = { rules: [{ ruleKey: "x", selector: ".x", scopes: [], declarations: [["futureProperty", "future-value"]] }], properties: [], keyframes: [], order: [{ kind: "rule", ruleKey: "x", scopes: [] }] };
  const before = render_portable_document_stylesheet(decode_portable_document_stylesheet(sample));
  const previous = Object.getOwnPropertyDescriptor(globalThis, "CSS");
  try {
    Object.defineProperty(globalThis, "CSS", { configurable: true, value: { supports: () => false } });
    assert.equal(render_portable_document_stylesheet(decode_portable_document_stylesheet(sample)), before);
    Object.defineProperty(globalThis, "CSS", { configurable: true, value: { supports: () => true } });
    assert.equal(render_portable_document_stylesheet(decode_portable_document_stylesheet(sample)), before);
  } finally {
    if (previous) Object.defineProperty(globalThis, "CSS", previous);
    else Reflect.deleteProperty(globalThis, "CSS");
  }
});

const workerCase = "Node and Worker render the same portable state";
testEvents.case_begin(workerCase, workerCase);
try {
  let sheet = empty_portable_document_stylesheet();
  sheet = set_portable_document_declaration(sheet, "body", "body", "color", "navy");
  sheet = set_portable_document_declaration(sheet, "media", "body", "color", "white", ["@media (max-width: 600px)"]);
  sheet = set_portable_document_property(sheet, ["--phase", "<number>", "0"]);
  sheet = set_portable_document_keyframes(sheet, { name: "fade", steps: { from: { opacity: "0" }, to: { opacity: "1" } } });
  const workerValue = await new Promise<Readonly<{ record: unknown; css: string }>>((resolve, reject) => {
    const worker = repository_typescript_worker(new URL("./fixtures/portable-document-stylesheet.worker.mts", import.meta.url));
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => { if (code !== 0) reject(new Error(`Stylesheet Worker exited with code ${code}.`)); });
  });
  assert.deepEqual(workerValue.record, encode_portable_document_stylesheet(sheet));
  assert.equal(workerValue.css, render_portable_document_stylesheet(sheet));
  testEvents.case_end(workerCase, "pass");
  testEvents.terminal("pass");
} catch (error) {
  testEvents.diagnostic(workerCase, "assertion", error instanceof Error ? error.message : "Check failed.");
  testEvents.case_end(workerCase, "fail"); testEvents.terminal("fail"); throw error;
}
