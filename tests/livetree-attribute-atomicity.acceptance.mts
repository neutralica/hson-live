// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hson } from "../src/index.ts";
import { hsonMirror } from "../src/api/mirror/mirror.facade.ts";
import { link_node_to_el, unlinkNode } from "../src/api/livetree/utils/node-map-helpers.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { retained_subject } from "./helpers/retained-livetree-subject.mts";
import { FakeElement, install_fake_document } from "./helpers/fake-document.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.attribute-atomicity",
  title: "LiveTree standalone attribute acceptance and native recovery",
  category: "LiveTree",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["attributes", "atomicity", "ownership", "lifecycle", "document"]),
});
install_fake_document();
const events = create_test_event_emitter("livetree.attribute-atomicity");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); checks++; events.case_end(name, "pass"); }
  catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; }
  console.log(`ok ${checks} - ${name}`);
}
function fixture() {
  const root = hson.liveTree.fromHson('<section <button a="before" b="before" c="before"/>/>');
  const tree = root.find.must.byTag("button"), subject = retained_subject(tree), quid = tree.quid;
  const el = new FakeElement("button");
  for (const [name, value] of Object.entries(tree.node.$_attrs ?? {})) el.setAttribute(name, String(value));
  el.setAttribute("hson:quid", quid);
  // A synthetic owning realm lets recovery bypass failing instance methods.
  const prototype = { setAttribute: FakeElement.prototype.setAttribute, removeAttribute: FakeElement.prototype.removeAttribute };
  Object.defineProperty(el, "ownerDocument", { value: { defaultView: { Element: { prototype } } } });
  link_node_to_el(subject, el as unknown as Element);
  const before = tree.node, attrs = [...el.attrs];
  let clicks = 0; tree.listen.onClick(() => clicks++);
  return { root, tree, el, subject, before, attrs, prototype,
    unchanged(native = true) {
      assert.deepEqual(tree.node, before);
      assert.equal(retained_subject(tree), subject); assert.equal(tree.quid, quid); assert.equal(tree.dom.el(), el);
      assert.equal(tree.isDisposed, false);
      if (native) assert.deepEqual([...el.attrs].sort(), [...attrs].sort());
      const count = clicks; el.dispatchEvent(new Event("click")); assert.equal(clicks, count + 1);
    },
    close() { unlinkNode(subject); root.remove(); },
  };
}

for (const fail of ["set", "remove"] as const) check(`${fail} failure after native writes restores attrs without canonical acceptance or latent changes`, () => {
  const f = fixture(), original = new Error(`${fail} failed`);
  const priorBacking = f.subject.$_attrs;
  try {
    let writes = 0;
    if (fail === "set") f.el.setAttribute = function(name, value) {
      assert.deepEqual(f.tree.node, f.before, "native callbacks must see prior canonical state");
      writes++; if (writes === 2) throw original;
      FakeElement.prototype.setAttribute.call(this, name, value);
    };
    else f.el.removeAttribute = function(name) {
      writes++; if (writes === 2) throw original;
      FakeElement.prototype.removeAttribute.call(this, name);
    };
    assert.throws(() => f.tree.attrs.replace(fail === "set" ? { a: "rejected", b: "rejected", c: "rejected" } : { c: "rejected" }), error => error === original);
    assert.equal(writes, 2); f.unchanged(); assert.equal(f.subject.$_attrs, priorBacking);
    f.el.setAttribute = FakeElement.prototype.setAttribute; f.el.removeAttribute = FakeElement.prototype.removeAttribute;
    f.tree.attrs.set("later", "valid");
    assert.deepEqual(f.tree.node.$_attrs, { a: "before", b: "before", c: "before", later: "valid" });
    for (const name of ["a", "b", "c"]) assert.equal(f.el.getAttribute(name), "before");
  } finally { f.close(); }
});

check("capture and snapshot failures leave no native writes and release the operation", () => {
  for (const phase of ["capture", "names", "value"]) {
    const f = fixture(), original = new Error("capture failed");
    let writes = 0;
    try {
      f.el.setAttribute = () => { writes++; };
      f.el.removeAttribute = () => { writes++; };
      if (phase === "names") f.el.getAttributeNames = () => { throw original; };
      if (phase === "value") f.el.getAttribute = () => { throw original; };
      const values = phase === "capture" ? { get a(): string { throw original; } } : { a: "rejected" };
      assert.throws(() => f.tree.attrs.replace(values), error => error === original);
      assert.equal(writes, 0); f.unchanged();
      f.el.setAttribute = FakeElement.prototype.setAttribute; f.el.removeAttribute = FakeElement.prototype.removeAttribute;
      f.el.getAttributeNames = FakeElement.prototype.getAttributeNames; f.el.getAttribute = FakeElement.prototype.getAttribute;
      f.tree.attrs.set("later", "valid");
    } finally { f.close(); }
  }
});

check("restoration failure preserves backing identity, exposes both errors, and releases the reservation", () => {
  const f = fixture(), original = new Error("realization"), restoration = new Error("restoration");
  const priorBacking = f.subject.$_attrs;
  try {
    f.el.setAttribute = function(name, value) {
      FakeElement.prototype.setAttribute.call(this, name, value);
      if (name === "b") throw original;
    };
    f.prototype.setAttribute = () => {
      assert.throws(() => f.tree.remove(), /unfinished/);
      throw restoration;
    };
    assert.throws(() => f.tree.attrs.setMany({ a: "rejected", b: "rejected" }), error => {
      assert.ok(error instanceof AggregateError); assert.equal(error.cause, original);
      assert.deepEqual(error.errors, [original, restoration]); assert.match(error.message, /restoration failed/); return true;
    });
    f.unchanged(false); assert.equal(f.subject.$_attrs, priorBacking);
    assert.equal(f.el.getAttribute("a"), "rejected", "native incoherence is observable after failed recovery");
    f.el.setAttribute = FakeElement.prototype.setAttribute;
    f.tree.attrs.set("later", "valid");
    assert.equal(f.el.getAttribute("a"), "before"); assert.equal(f.el.getAttribute("b"), "before");
    f.root.empty(); assert.equal(f.tree.isDisposed, true);
  } finally { f.close(); }
});

for (const phase of ["capture", "snapshot names", "snapshot value", "namespace", "set", "remove", "restore"]) {
  check(`${phase}: same-subject writes, ancestor retirement and disposal cannot reenter a reserved operation`, () => {
    const f = fixture(), original = new Error("force restoration");
    let callbacks = 0;
    try {
      const callback = () => {
        callbacks++;
        assert.throws(() => f.tree.attrs.set("nested", "bad"), /unfinished/);
        assert.throws(() => f.root.empty(), /unfinished/);
        assert.throws(() => f.root.text.overwrite("replacement"), /unfinished/);
        assert.throws(() => f.root.remove(), /unfinished/);
        assert.throws(() => f.tree.remove(), /unfinished/);
        assert.throws(() => f.tree.detach(), /unfinished/);
        assert.deepEqual(f.tree.node, f.before);
      };
      let values = { a: "after" };
      if (phase === "namespace") {
        let staging = false;
        f.el.getAttributeNames = function() { staging = true; return [...this.attrs.keys()]; };
        Object.defineProperty(f.el, "namespaceURI", { configurable: true, get() {
          if (staging) callback(); return "http://www.w3.org/1999/xhtml";
        } });
      }
      if (phase === "capture") values = { get a() { callback(); return "after"; } };
      if (phase === "snapshot names") f.el.getAttributeNames = function() { callback(); return [...this.attrs.keys()]; };
      if (phase === "snapshot value") f.el.getAttribute = function(name) { callback(); return this.attrs.get(name) ?? null; };
      if (phase === "set") f.el.setAttribute = function(name, value) { callback(); FakeElement.prototype.setAttribute.call(this, name, value); };
      if (phase === "remove") f.el.removeAttribute = function(name) { callback(); FakeElement.prototype.removeAttribute.call(this, name); };
      if (phase === "restore") {
        f.el.setAttribute = () => { throw original; };
        f.prototype.setAttribute = function(name, value) { callback(); FakeElement.prototype.setAttribute.call(this, name, value); };
        assert.throws(() => f.tree.attrs.replace(values), error => error === original); f.unchanged();
      } else {
        f.tree.attrs.replace(values); assert.deepEqual(f.tree.node.$_attrs, { a: "after" });
      }
      assert.ok(callbacks > 0); assert.equal(retained_subject(f.tree), f.subject); assert.equal(f.tree.dom.el(), f.el);
      // Completion releases all guards, including after recovery.
      f.el.setAttribute = FakeElement.prototype.setAttribute; f.el.removeAttribute = FakeElement.prototype.removeAttribute;
      f.el.getAttributeNames = FakeElement.prototype.getAttributeNames; f.el.getAttribute = FakeElement.prototype.getAttribute;
      Object.defineProperty(f.el, "namespaceURI", { value: "http://www.w3.org/1999/xhtml", configurable: true });
      f.tree.attrs.set("later", "valid");
    } finally { f.close(); }
  });
}

for (const phase of ["capture", "snapshot", "set", "remove"]) check(`${phase}: changed correspondence cannot accept a candidate using a stale native subject`, () => {
  const f = fixture(), replacement = new FakeElement("button");
  try {
    const remap = () => link_node_to_el(f.subject, replacement as unknown as Element);
    let values = { a: "rejected" };
    if (phase === "capture") values = { get a() { remap(); return "rejected"; } };
    if (phase === "snapshot") f.el.getAttribute = function(name) { remap(); return this.attrs.get(name) ?? null; };
    if (phase === "set") f.el.setAttribute = function(name, value) { FakeElement.prototype.setAttribute.call(this, name, value); remap(); };
    if (phase === "remove") f.el.removeAttribute = function(name) { FakeElement.prototype.removeAttribute.call(this, name); remap(); };
    assert.throws(() => f.tree.attrs.replace(values), /correspondence changed|restoration failed/);
    assert.deepEqual(f.tree.node, f.before); assert.equal(f.tree.dom.el(), replacement); assert.equal(replacement.attrs.size, 0);
    assert.deepEqual([...f.el.attrs].sort(), [...f.attrs].sort());
    link_node_to_el(f.subject, f.el as unknown as Element);
    f.el.setAttribute = FakeElement.prototype.setAttribute; f.el.removeAttribute = FakeElement.prototype.removeAttribute;
    f.el.getAttribute = FakeElement.prototype.getAttribute;
    f.tree.attrs.set("later", "valid"); assert.equal(f.tree.attrs.get("a"), "before");
  } finally { f.close(); }
});

check("native reads during guard admission cannot leave a stale subject eligible for acceptance", () => {
  for (const action of ["retire", "remap"]) {
    const f = fixture(), before = f.subject.$_attrs, replacement = new FakeElement("button");
    let entered = false;
    Object.defineProperty(f.el, "namespaceURI", { configurable: true, get() {
      if (!entered) {
        entered = true;
        if (action === "retire") f.tree.remove();
        else link_node_to_el(f.subject, replacement as unknown as Element);
      }
      return "http://www.w3.org/1999/xhtml";
    } });
    try {
      assert.throws(() => f.tree.attrs.set("a", "stale"), /disposed|correspondence changed/);
      assert.equal(entered, true); assert.equal(f.subject.$_attrs, before);
      assert.equal(replacement.attrs.size, 0);
      if (action === "remap") {
        link_node_to_el(f.subject, f.el as unknown as Element);
        f.tree.attrs.set("later", "valid"); assert.equal(f.tree.attrs.get("a"), "before");
      }
    } finally { f.close(); }
  }
});

check("ordinary replacements, setters, flags, removals, ordering, normalization and no-ops retain semantics", () => {
  const f = fixture();
  try {
    let writes = 0; f.el.setAttribute = function(name, value) { writes++; FakeElement.prototype.setAttribute.call(this, name, value); };
    assert.equal(f.tree.attrs.replace({ C: "before", B: "before", A: "before" }), f.tree); assert.equal(writes, 0);
    const bag = { Z: 2, style: { color: "red" }, a: null, hidden: false };
    f.tree.attrs.replace(bag); bag.style.color = "blue";
    assert.deepEqual(f.tree.attrs.keys(), ["a", "hidden", "style", "z"]); assert.equal(f.tree.attrs.get("z"), 2);
    assert.equal(f.el.getAttribute("hidden"), null); assert.equal(f.el.getAttribute("style"), "color: red");
    f.tree.flags.set("disabled"); assert.equal(f.tree.flags.has("disabled"), true);
    f.tree.flags.clear("disabled"); f.tree.attrs.dropMany(["z", "missing"]); f.tree.attrs.drop("style");
    f.tree.attrs.clear(); assert.equal(f.subject.$_attrs, undefined);
    f.tree.attrs.setMany({ Z: "end", A: "start" }); assert.deepEqual(Object.keys(f.tree.node.$_attrs ?? {}), ["a", "z"]);
    const before = f.tree.node; assert.throws(() => f.tree.attrs.replace({ a: Number.NaN })); assert.deepEqual(f.tree.node, before);
  } finally { f.close(); }
});

check("candidate qualification rejects non-element attribute ownership before any native write", () => {
  const owner = hson.liveTree.fromNode({ $_tag: "holder", $_content: [{ $_tag: "_hson_obj", $_content: [
    { $_tag: "member", $_content: [{ $_tag: "_hson_obj", $_content: [] }] },
  ] }] });
  const tree = owner.find.must.byTag("member"), before = owner.node;
  assert.throws(() => tree.attrs.set("title", "invalid owner"), /attributes belong/);
  assert.deepEqual(owner.node, before); owner.remove();
});

check("bound accepted revisions survive native failure and Mirror fences subsequent delegation", () => {
  const schema = Hson.schema`<type "document" tag "button" content "empty">`;
  const map = hson.liveMap.fromLibraries({ page: { document: '<button a="before" b="before"/>', schema } });
  const binding = hsonMirror(map.doc.must("page")), tree = binding.tree.find.must.byTag("button");
  const subject = retained_subject(tree), el = new FakeElement("button"); link_node_to_el(subject, el as unknown as Element);
  let commits = 0; const stop = map.commits.observe(() => commits++);
  el.setAttribute = function(name, value) { if (name === "b") throw new Error("bound native failure"); FakeElement.prototype.setAttribute.call(this, name, value); };
  try {
    assert.equal(tree.attrs.replace({ a: "accepted", b: "accepted" }), tree);
    assert.equal(map.rev, 1); assert.equal(commits, 1); assert.equal(binding.status, "failed"); assert.equal(binding.sourceRevision, 0);
    assert.equal(map.doc.must("page").render(), '<button a="accepted" b="accepted"></button>');
    assert.throws(() => tree.attrs.set("later", "rejected"), /failed|active/i); assert.equal(map.rev, 1);
    assert.equal(tree.dom.el(), el); assert.equal(retained_subject(tree), subject);
    map.doc.must("page").document.attrs.set({ kind: "path", path: validate_document_path([0]) }, "later", "authority");
    assert.equal(map.rev, 2); assert.equal(commits, 2); assert.equal(binding.sourceRevision, 0); assert.equal(binding.status, "failed");
    assert.equal(tree.attrs.get("later"), undefined);
  } finally { stop(); binding.dispose(); unlinkNode(subject); binding.tree.remove(); }
});
events.terminal("pass"); console.log(`# ${checks} attribute-atomicity checks passed`);
