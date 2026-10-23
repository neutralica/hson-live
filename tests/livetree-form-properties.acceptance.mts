// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hson } from "../src/index.ts";
import { hsonMirror } from "../src/api/mirror/mirror.facade.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { runtime_for_tree } from "../src/api/livetree/runtime/livetree-runtime.ts";
import { retained_subject } from "./helpers/retained-livetree-subject.mts";
import { FakeElement, install_fake_document } from "./helpers/fake-document.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.form-properties", title: "Standalone native form properties and bound authoring compatibility",
  category: "LiveTree", runtime: "node-synthetic-dom",
  tags: Object.freeze(["forms", "ownership", "admission", "lifecycle", "document"]),
});
install_fake_document();
const events = create_test_event_emitter("livetree.form-properties");
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  events.case_begin(name, name);
  try { await run(); checks++; events.case_end(name, "pass"); console.log(`ok ${checks} - ${name}`); }
  catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
class Control extends FakeElement {
  type = "text";
  multiple = true;
  writes = 0;
  private current = "";
  private ticked = false;
  beforeWrite: (() => void) | undefined;
  fail = false;
  readonly options = ["b", "a", "b", "c"].map(value => ({ value, selected: false }));
  get value(): string { return this.current; }
  set value(value: string) { this.writes++; this.beforeWrite?.(); if (this.fail) throw new Error("injected value failure"); this.current = value; }
  get checked(): boolean { return this.ticked; }
  set checked(value: boolean) { this.writes++; this.beforeWrite?.(); if (this.fail) throw new Error("injected checked failure"); this.ticked = value; }
  get selectedOptions() { return this.options.filter(option => option.selected); }
}
function fixture(tag = "input", type = "text") {
  const tree = hson.liveTree.fromHson(`<${tag} value="authored"/>`);
  const control = new Control(tag); control.type = type;
  link_node_to_el(retained_subject(tree), control as unknown as Element);
  return { tree, control };
}
function invoke(fn: Function, value: unknown): unknown { return Reflect.apply(fn, undefined, [value]); }

await check("unrealized controls reject consistently without adding attributes, identities or resources", () => {
  const tree = hson.liveTree.fromHson('<input value="authored" checked/>');
  const node = tree.node, runtime = runtime_for_tree(tree);
  const issued = [...runtime.issuedQuids];
  for (const [fn, value] of [[tree.form.setValue, "new"], [tree.form.setChecked, true], [tree.form.setSelected, ["a"]]] as const) {
    assert.throws(() => invoke(fn, value), /missing native control/);
    assert.deepEqual(tree.node, node); assert.equal(tree.dom.el(), undefined);
  }
  assert.deepEqual([...runtime.issuedQuids], issued);
  assert.equal(tree.form.getValue(), ""); assert.equal(tree.form.getChecked(), false); assert.equal(tree.form.getSelected(), "");
  tree.attrs.set("title", "works before realization");
  assert.equal(tree.attrs.get("title"), "works before realization"); tree.remove();
});

await check("all malformed scalars reject without coercion or canonical/native mutation", () => {
  const { tree, control } = fixture(); const before = tree.node;
  let coerced = 0;
  const object = { toString() { coerced++; return "changed"; }, valueOf() { coerced++; return 1; } };
  for (const value of [undefined, null, 0, -0, NaN, Infinity, -Infinity, true, object, new String("x"), Symbol("x"), 1n]) {
    assert.throws(() => invoke(tree.form.setValue, value), /primitive string/);
  }
  for (const value of [undefined, null, 0, NaN, Infinity, "true", object, new Boolean(true)]) {
    assert.throws(() => invoke(tree.form.setChecked, value), /primitive boolean/);
  }
  assert.equal(coerced, 0); assert.equal(control.writes, 0); assert.deepEqual(tree.node, before); tree.remove();
});

await check("selected arrays capture own primitive data descriptors and reject holes, accessors and invalid elements", () => {
  const { tree, control } = fixture("select"); const before = tree.node;
  let reads = 0;
  const accessor = ["a", "b"]; Object.defineProperty(accessor, "1", { get() { reads++; return "b"; } });
  const sparse = ["a", , "b"];
  const inherited = ["a", , "b"]; Object.setPrototypeOf(inherited, { 1: "b" });
  const inconsistent = new Proxy(["a", {}], { getOwnPropertyDescriptor(target, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    return key === "length" ? { ...descriptor, value: 1 } : descriptor;
  } });
  const bad = [accessor, sparse, inherited, inconsistent, ["a", 1], ["a", NaN], ["a", {}], ["a", new String("b")], 2, NaN, {}];
  for (const value of bad) {
    assert.throws(() => invoke(tree.form.setSelected, value), TypeError);
    assert.deepEqual(control.options.map(option => option.selected), [false, false, false, false]);
    assert.deepEqual(tree.node, before);
  }
  const revoked = Proxy.revocable(["a"], {}); revoked.revoke();
  assert.throws(() => invoke(tree.form.setSelected, revoked.proxy), TypeError);
  assert.equal(reads, 0); tree.attrs.set("title", "canonical remains usable"); tree.remove();
});

await check("caller methods and species never run; getters are independent arrays in native option order", () => {
  const { tree, control } = fixture("select"); const before = tree.node;
  const selected = ["a", "b"];
  const unexpected = () => { throw new Error("caller behavior invoked"); };
  for (const key of ["slice", "map", "constructor", Symbol.iterator]) Object.defineProperty(selected, key, { get: unexpected });
  assert.equal(tree.form.setSelected(selected), tree);
  selected[0] = "c";
  assert.deepEqual(tree.form.getSelected(), ["b", "a", "b"]);
  const result = tree.form.getSelected(); assert.ok(Array.isArray(result)); result.push("caller");
  assert.deepEqual(tree.form.getSelected(), ["b", "a", "b"]); assert.deepEqual(tree.node, before);
  tree.form.setSelected([]); assert.deepEqual(tree.form.getSelected(), []);
  tree.attrs.set("title", "valid"); assert.equal(tree.attrs.get("values"), undefined);
  assert.equal(control.writes, 0); tree.remove();
});

await check("changing proxy descriptors are captured once before option writes and retain no caller behavior", () => {
  const { tree, control } = fixture("select"); let captured = 0, current = "a";
  const selected = new Proxy(["a"], { getOwnPropertyDescriptor(target, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    if (key === "0") { captured++; return { ...descriptor, value: current }; }
    return descriptor;
  } });
  tree.form.setSelected(selected); current = "c";
  assert.equal(captured, 1); assert.deepEqual(tree.form.getSelected(), ["a"]);
  assert.equal(control.options[1]?.selected, true); tree.remove();
});

await check("unsupported exact targets, input value modes and single-select arrays reject before native writes", () => {
  for (const type of ["hidden", "submit", "image", "reset", "button", "checkbox", "radio"]) {
    const { tree, control } = fixture("input", type); const before = tree.node;
    assert.throws(() => tree.form.setValue("new"), /unsupported native control/);
    assert.equal(control.writes, 0); assert.deepEqual(tree.node, before); tree.remove();
  }
  for (const tag of ["div", "textarea", "input"]) {
    const { tree, control } = fixture(tag);
    assert.throws(() => tree.form.setSelected("a"), /unsupported native control/);
    assert.throws(() => tree.form.setChecked(true), /unsupported native control/);
    assert.equal(control.writes, 0); tree.remove();
  }
  const { tree, control } = fixture("select"); control.multiple = false;
  assert.throws(() => tree.form.setSelected(["a"]), /arrays require a multiple select/);
  assert.deepEqual(control.options.map(option => option.selected), [false, false, false, false]); tree.remove();
  const foreign = fixture("input");
  link_node_to_el(retained_subject(foreign.tree), new FakeElement("input", "urn:other") as unknown as Element);
  assert.throws(() => foreign.tree.form.setValue("x"), /unsupported native control/); foreign.tree.remove();
});

await check("native assignment failures preserve canonical state and release publication guards", () => {
  for (const type of ["text", "checkbox"]) {
    const { tree, control } = fixture("input", type); const before = tree.node;
    control.fail = true;
    const write = () => type === "text" ? tree.form.setValue("after") : tree.form.setChecked(true);
    assert.throws(write, cause => cause instanceof Error && /native property assignment failed/.test(cause.message)
      && cause.cause instanceof Error && /injected/.test(cause.cause.message));
    assert.deepEqual(tree.node, before);
    control.fail = false; assert.equal(write(), tree); assert.deepEqual(tree.node, before); tree.remove();
  }
});

await check("native multi-option failure leaves the graph unchanged without promising browser-side rollback", () => {
  const { tree, control } = fixture("select"); const before = tree.node;
  Object.defineProperty(control.options[1], "selected", { set() { throw new Error("option failure"); } });
  assert.throws(() => tree.form.setSelected(["b", "a"]), /native property assignment failed/);
  assert.equal(control.options[0]?.selected, true); assert.deepEqual(tree.node, before);
  tree.attrs.set("title", "guard released"); tree.remove();
});

await check("publication guards prevent lifecycle and canonical reentry during native writes and reflective capture", () => {
  const { tree, control } = fixture();
  control.beforeWrite = () => {
    assert.throws(() => tree.remove(), /unfinished/);
    assert.throws(() => tree.attrs.set("title", "reentrant"), /unfinished/);
    assert.throws(() => tree.form.setValue("reentrant"), /unfinished/);
  };
  tree.form.setValue("outer"); assert.equal(control.value, "outer"); tree.remove();
  const select = fixture("select");
  const proxy = new Proxy(["a"], { ownKeys(target) {
    assert.throws(() => select.tree.remove(), /unfinished/);
    return Reflect.ownKeys(target);
  } });
  select.tree.form.setSelected(proxy); assert.deepEqual(select.tree.form.getSelected(), ["a"]); select.tree.remove();
});

await check("scalar qualification rejects retirement before writes and preserves exact active ownership", () => {
  for (const type of ["text", "checkbox"]) {
    const { tree, control } = fixture("input", type);
    const before = tree.node, subject = retained_subject(tree), quid = tree.quid, runtime = runtime_for_tree(tree);
    const write = () => type === "text" ? tree.form.setValue("current") : tree.form.setChecked(true);
    let attempts = 0;
    Object.defineProperty(control, "type", { configurable: true, get() { attempts++; tree.remove(); return type; } });
    assert.throws(write, /unfinished/);
    assert.ok(attempts > 0); assert.equal(control.writes, 0); assert.equal(tree.isDisposed, false);
    assert.equal(retained_subject(tree), subject); assert.equal(tree.dom.el(), control);
    assert.equal(tree.quid, quid); assert.equal(runtime_for_tree(tree), runtime); assert.deepEqual(tree.node, before);
    Object.defineProperty(control, "type", { configurable: true, get() {
      assert.throws(() => tree.remove(), /unfinished/);
      assert.throws(() => tree.text.overwrite("replacement"), /unfinished/);
      return type;
    } });
    assert.equal(write(), tree); assert.equal(control.writes, 1); assert.deepEqual(tree.node, before);
    Object.defineProperty(control, "type", { configurable: true, writable: true, value: type });
    assert.equal(write(), tree); assert.equal(control.writes, 2);
    const cached = tree.form; tree.remove();
    assert.throws(() => cached.setValue("retired"), /disposed/); assert.equal(control.writes, 2);
  }
});

await check("selection qualification, enumeration and option planning share one lifecycle reservation", () => {
  for (const read of ["multiple", "options", "iterator", "option value"]) {
    const { tree, control } = fixture("select");
    const before = tree.node, subject = retained_subject(tree), options = control.options, option = options[1]!;
    const target = read === "option value" ? option : read === "iterator" ? options : control;
    const key = read === "option value" ? "value" : read === "iterator" ? Symbol.iterator : read;
    const original = Object.getOwnPropertyDescriptor(target, key);
    let attempts = 0;
    Object.defineProperty(target, key, { configurable: true, get() { attempts++; tree.remove(); } });
    assert.throws(() => tree.form.setSelected(["b", "a"]), /unfinished/);
    assert.ok(attempts > 0); assert.equal(tree.isDisposed, false); assert.deepEqual(tree.node, before);
    assert.equal(retained_subject(tree), subject); assert.equal(tree.dom.el(), control);
    assert.deepEqual(options.map(option => option.selected), [false, false, false, false]);
    if (original === undefined) Reflect.deleteProperty(target, key);
    else Object.defineProperty(target, key, original);
    tree.form.setSelected(["a"]); assert.deepEqual(tree.form.getSelected(), ["a"]);
    assert.deepEqual(tree.node, before); tree.remove();
  }
});

await check("correspondence changes during qualification reject before any retained control write", () => {
  for (const type of ["text", "checkbox"]) {
    const { tree, control } = fixture("input", type), replacement = new Control("input");
    const before = tree.node, subject = retained_subject(tree);
    Object.defineProperty(control, "type", { configurable: true, get() {
      // Deliberately bypass public lifecycle admission to exercise the final
      // correspondence proof, independently of the public reentry guard.
      link_node_to_el(subject, replacement as unknown as Element); return type;
    } });
    assert.throws(() => type === "text" ? tree.form.setValue("stale") : tree.form.setChecked(true), /correspondence changed/);
    assert.equal(control.writes, 0); assert.equal(replacement.writes, 0); assert.deepEqual(tree.node, before);
    assert.equal(tree.dom.el(), replacement); assert.equal(retained_subject(tree), subject);
    replacement.type = type;
    if (type === "text") tree.form.setValue("retry"); else tree.form.setChecked(true);
    assert.equal(replacement.writes, 1); assert.equal(control.writes, 0); tree.remove();
  }
});

await check("selection revalidates correspondence after capture and planning and between option writes", () => {
  for (const phase of ["capture", "planning", "assignment"]) {
    const { tree, control } = fixture("select"), replacement = new Control("select");
    const before = tree.node, subject = retained_subject(tree), options = control.options;
    const remap = () => link_node_to_el(subject, replacement as unknown as Element);
    let values: readonly string[] = ["a", "b"];
    if (phase === "capture") values = new Proxy(["a", "b"], { ownKeys(target) { remap(); return Reflect.ownKeys(target); } });
    if (phase === "planning") Object.defineProperty(options[1], "value", { get() { remap(); return "a"; } });
    if (phase === "assignment") Object.defineProperty(options[0], "selected", { get() { return false; }, set() { remap(); } });
    assert.throws(() => tree.form.setSelected(values), /correspondence changed|native property assignment failed/);
    assert.deepEqual(options.map(option => option.selected), [false, false, false, false]);
    assert.deepEqual(replacement.options.map(option => option.selected), [false, false, false, false]);
    assert.equal(tree.dom.el(), replacement); assert.equal(retained_subject(tree), subject); assert.deepEqual(tree.node, before);
    tree.form.setSelected(["c"]); assert.deepEqual(tree.form.getSelected(), ["c"]); assert.deepEqual(tree.node, before); tree.remove();
  }
});

await check("document-bound scalar authoring succeeds without native controls and selected stays unsupported", async () => {
  const schema = Hson.schema`<type "document" tag "input" content "empty">`;
  const map = hson.liveMap.fromLibraries({ page: { document: '<input value="authored"/>', schema } });
  const binding = hsonMirror(map.doc.must("page")); const tree = binding.tree.find.must.byTag("input");
  let commits = 0; const stop = map.commits.observe(() => commits++);
  assert.equal(tree.form.setValue("bound"), tree); assert.equal(tree.attrs.get("value"), "bound");
  assert.equal(tree.form.setChecked(true), tree); assert.equal(tree.attrs.get("checked"), true);
  assert.equal(tree.form.getValue(), ""); assert.equal(tree.form.getChecked(), false);
  assert.equal(map.rev, 2); assert.equal(commits, 2); assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, map.rev);
  const before = map.capture();
  for (const value of ["a", ["a"], []]) assert.throws(() => invoke(tree.form.setSelected, value), /form.setSelected/);
  assert.deepEqual(map.capture(), before);
  // Deliberate temporary asymmetry: async scalars still author attributes.
  await tree.async.form.setValue("async bound"); await tree.async.form.setChecked(false);
  assert.equal(tree.attrs.get("value"), "async bound"); assert.equal(tree.attrs.get("checked"), false);
  assert.equal(binding.sourceRevision, map.rev); stop(); binding.dispose(); binding.tree.remove();
});

await check("standalone async facade retains its authored attribute route without realization", async () => {
  const tree = hson.liveTree.fromHson('<input/>');
  await tree.async.form.setValue("async authored"); await tree.async.form.setChecked(true);
  assert.equal(tree.attrs.get("value"), "async authored"); assert.equal(tree.attrs.get("checked"), true);
  assert.equal(tree.dom.el(), undefined); assert.equal(tree.form.getValue(), ""); tree.remove();
});

await check("accepted bound scalar commits survive native attribute realization failure and Mirror fails explicitly", () => {
  const schema = Hson.schema`<type "document" tag "input" content "empty">`;
  const map = hson.liveMap.fromLibraries({ page: { document: '<input/>', schema } });
  const binding = hsonMirror(map.doc.must("page")); const tree = binding.tree.find.must.byTag("input");
  const control = new Control("input"); control.attrs.set("hson:quid", tree.quid);
  link_node_to_el(retained_subject(tree), control as unknown as Element);
  control.setAttribute = () => { throw new Error("injected attribute failure"); };
  let accepted = 0; const stop = map.commits.observe(() => accepted++);
  assert.equal(tree.form.setValue("authority accepted"), tree);
  assert.equal(map.rev, 1); assert.equal(accepted, 1); assert.equal(binding.status, "failed");
  assert.equal(binding.sourceRevision, 0);
  assert.equal(map.doc.must("page").render(), '<input value="authority accepted">');
  stop(); binding.dispose(); binding.tree.remove();
});
events.terminal("pass");
console.log(`# ${checks} form-property checks passed`);
