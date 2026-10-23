// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hson } from "../src/index.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { hsonMirror } from "../src/api/mirror/mirror.facade.ts";
import type { LiveTree } from "../src/api/livetree/livetree.ts";
import type { DatasetMap } from "../src/api/livetree/managers/data-manager.ts";
import { link_node_to_el, unlinkNode } from "../src/api/livetree/utils/node-map-helpers.ts";
import { retained_subject } from "./helpers/retained-livetree-subject.mts";
import { FakeElement, install_fake_document } from "./helpers/fake-document.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.dataset-batch",
  title: "LiveTree dataset batch atomic admission",
  category: "LiveTree",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["dataset", "attributes", "atomicity", "ownership", "document"]),
});

install_fake_document();
const events = create_test_event_emitter("livetree.dataset-batch");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); checks++; events.case_end(name, "pass"); }
  catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; }
  console.log(`ok ${checks} - ${name}`);
}

class DatasetElement extends FakeElement {
  writes = 0;
  override setAttribute(name: string, value: string): void { this.writes++; super.setAttribute(name.toLowerCase(), value); }
  override removeAttribute(name: string): void { this.writes++; super.removeAttribute(name.toLowerCase()); }
  override getAttribute(name: string): string | null { return super.getAttribute(name.toLowerCase()); }
}

const source = '<main title="original" data-first="before" data-remove="old"/>';
const schema = Hson.schema`<type "document" tag "main" content "empty">`;
function fixture(bound: boolean, document = source) {
  const map = bound ? hson.liveMap.fromLibraries({ page: { document, schema } }) : undefined;
  const doc = map?.doc.must("page");
  const binding = doc === undefined ? undefined : hsonMirror(doc);
  const tree = binding?.tree.find.must.byTag("main") ?? hson.liveTree.fromHson(document);
  const subject = retained_subject(tree), quid = tree.quid;
  const element = new DatasetElement("main");
  element.attrs.set("hson:quid", quid);
  for (const [name, value] of Object.entries(tree.node.$_attrs ?? {})) element.attrs.set(name.toLowerCase(), String(value));
  link_node_to_el(subject, element as unknown as Element);
  const publications: unknown[] = [];
  const observed: unknown[] = [];
  const stop = map?.commits.observe(event => {
    publications.push(event);
    observed.push(doc?.root());
  });
  const snapshot = () => ({
    node: tree.node, canonical: doc?.root(), attrs: [...element.attrs], writes: element.writes,
    revision: map?.rev, sourceRevision: binding?.sourceRevision, publications: publications.length,
  });
  return {
    tree, element, map, doc, binding, publications, observed, snapshot,
    assertIdentity() {
      assert.equal(retained_subject(tree), subject);
      assert.equal(tree.quid, quid);
      assert.equal(tree.dom.el(), element);
      if (binding !== undefined) assert.equal(binding.status, "active");
    },
    close() { stop?.(); binding?.dispose(); unlinkNode(subject); (binding?.tree ?? tree).remove(); },
  };
}

function assertDataset(tree: LiveTree, expected: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(tree.data.get(key), value);
    assert.equal(tree.attrs.get(`data-${key}`), value);
    assert.equal(tree.node.$_attrs?.[`data-${key}`], value);
  }
}

check("original late-empty-key reproduction leaves an unmounted standalone tree unchanged", () => {
  const tree = hson.liveTree.fromNode({ $_tag: "div", $_content: [] });
  try {
    const before = tree.node;
    assert.throws(() => tree.data.setMany({ first: "written", "": "bad" }), /Dataset key must be non-empty/);
    assert.equal(tree.data.get("first"), undefined);
    assert.deepEqual(tree.node, before);
  } finally { tree.remove(); }
});

for (const bound of [false, true]) {
  const owner = bound ? "document-bound" : "standalone";
  check(`${owner}: successful batches preserve every untargeted canonical attribute`, () => {
    const f = fixture(bound, '<main id="root" class="one two" TITLE="Keep case" role="region" aria-label="Keep label" data-existing="untouched" data-Custom="Keep data case" data-first="before" data-remove="old"/>');
    try {
      const before = f.tree.node.$_attrs;
      const expected: Record<string, unknown> = { ...before, "data-first": "after", "data-user-id": "last" };
      delete expected["data-remove"];
      f.tree.data.setMany({ first: "after", userId: "earlier", user_id: "last", remove: null });
      assert.deepEqual(f.tree.node.$_attrs, expected);
      for (const name of ["id", "class", "TITLE", "role", "aria-label", "data-existing", "data-Custom"]) {
        assert.equal(f.tree.node.$_attrs?.[name], before?.[name]);
        assert.equal(f.element.getAttribute(name), before?.[name]);
      }
      assert.equal(f.tree.data.get("existing"), "untouched");
      assert.equal(f.tree.data.get("first"), "after");
      assert.equal(f.tree.data.get("userId"), "last");
      assert.equal(f.element.getAttribute("data-remove"), null);
      const names = Object.keys(f.tree.node.$_attrs ?? {});
      assert.deepEqual(names, [...names].sort());
      assert.equal(f.element.writes, names.length + 1);
      assert.equal(f.map?.rev, bound ? 1 : undefined);
      assert.equal(f.publications.length, bound ? 1 : 0);
      if (f.doc !== undefined) {
        const canonical = f.doc.root().$_content[0];
        assert.ok(is_Node(canonical));
        assert.deepEqual(canonical.$_attrs, expected);
        assert.deepEqual(f.observed, [f.doc.root()]);
      }
      const accepted = f.snapshot();
      assert.throws(() => f.tree.data.setMany({ first: "rejected", existing: null, "": "invalid" }));
      assert.deepEqual(f.snapshot(), accepted);
      f.tree.data.setMany({ first: "temporary", " first ": "after" });
      assert.deepEqual(f.snapshot(), accepted, "duplicate-key no-op preserves spelling, state and publications");
      f.assertIdentity();
    } finally { f.close(); }
  });

  check(`${owner}: late key rejection preserves canonical/native state and publications`, () => {
    const f = fixture(bound);
    try {
      for (const batch of [
        { first: "written", "": "bad" },
        { first: "next", second: 2, remove: null, third: true, "   ": "bad" },
        { first: "next", second: "new", "bad/key": "bad" },
      ]) {
        const before = f.snapshot();
        assert.throws(() => f.tree.data.setMany(batch));
        assert.deepEqual(f.snapshot(), before);
        assertDataset(f.tree, { first: "before", remove: "old" });
        f.assertIdentity();
      }
      f.tree.attrs.set("title", "after rejection");
      f.tree.data.set("ordinaryKey", "works");
      assert.equal(f.tree.attrs.get("title"), "after rejection");
      assert.equal(f.element.getAttribute("data-ordinary-key"), "works");
      assert.equal(f.map?.rev, bound ? 2 : undefined);
      assert.equal(f.publications.length, bound ? 2 : 0);
    } finally { f.close(); }
  });

  check(`${owner}: public attrs.replace retains name normalization and exact replacement semantics`, () => {
    const f = fixture(bound, '<main id="root" class="one two" TITLE="original" data-existing="old"/>');
    try {
      f.tree.attrs.replace({ TITLE: "replacement", "DATA-Only": "explicit" });
      const expected = { "data-only": "explicit", title: "replacement" };
      assert.deepEqual(f.tree.node.$_attrs, expected);
      assert.equal(f.element.getAttribute("title"), "replacement");
      assert.equal(f.element.getAttribute("data-only"), "explicit");
      for (const name of ["id", "class", "data-existing"]) assert.equal(f.element.getAttribute(name), null);
      assert.equal(f.map?.rev, bound ? 1 : undefined);
      assert.equal(f.publications.length, bound ? 1 : 0);
      if (f.doc !== undefined) {
        const canonical = f.doc.root().$_content[0];
        assert.ok(is_Node(canonical));
        assert.deepEqual(canonical.$_attrs, expected);
      }
      f.assertIdentity();
    } finally { f.close(); }
  });

  check(`${owner}: complete success preserves normalization, replacements, duplicates and deletion`, () => {
    const f = fixture(bound);
    try {
      const batch: DatasetMap = {
        first: "after", userId: "earlier", user_id: "last", "bad key": "normalized",
        count: 2, enabled: false, empty: "", remove: null, absent: undefined,
        goneKey: "temporary", gone_key: null, restoredKey: null, restored_key: "restored",
      };
      assert.equal(f.tree.data.setMany(batch), f.tree);
      batch.first = "caller mutation";
      delete batch.user_id;
      assertDataset(f.tree, {
        first: "after", "user-id": "last", "bad-key": "normalized", count: "2",
        enabled: "false", empty: "", "restored-key": "restored",
      });
      for (const key of ["remove", "absent", "gone-key"]) {
        assert.equal(f.tree.data.get(key), undefined);
        assert.equal(f.element.getAttribute(`data-${key}`), null);
      }
      assert.equal(f.tree.attrs.get("title"), "original");
      const names = Object.keys(f.tree.node.$_attrs ?? {});
      assert.deepEqual(names, [...names].sort(), "accepted attrs retain canonical ordering");
      for (const [name, value] of Object.entries(f.tree.node.$_attrs ?? {})) {
        assert.equal(typeof value, "string");
        assert.equal(f.element.getAttribute(name), value);
      }
      assert.equal(f.map?.rev, bound ? 1 : undefined);
      assert.equal(f.publications.length, bound ? 1 : 0);
      if (f.doc !== undefined) {
        const canonical = f.doc.root().$_content[0];
        assert.ok(is_Node(canonical));
        assert.deepEqual(f.tree.node.$_attrs, canonical.$_attrs);
        assert.deepEqual(f.observed, [f.doc.root()], "observers see only the complete accepted change");
      }
      assert.equal(f.element.writes, names.length + 1, "one final realization without intermediate dataset writes");
      const writes = f.element.writes;
      f.tree.data.setMany({ first: "after", userId: "last" });
      f.tree.data.setMany({ first: "temporary", " first ": "after", transientKey: "temporary", transient_key: null });
      f.tree.data.setMany({});
      assert.equal(f.element.writes, writes, "no-op batches do not realize intermediate changes");
      assert.equal(f.publications.length, bound ? 1 : 0);
      f.tree.data.set("first", "ordinary");
      f.tree.attrs.set("data-user-id", "attribute");
      assertDataset(f.tree, { first: "ordinary", "user-id": "attribute" });
      f.assertIdentity();
    } finally { f.close(); }
  });

  check(`${owner}: input reads and conversion finish before any admission`, () => {
    const f = fixture(bound);
    try {
      let reads = 0, text = "captured";
      const batch = { first: "next", get second() { reads++; return text; } };
      f.tree.data.setMany(batch);
      text = "caller changed";
      assertDataset(f.tree, { first: "next", second: "captured" });
      f.tree.attrs.set("title", "unrelated");
      assert.equal(reads, 1, "caller accessors are not retained");
      const before = f.snapshot();
      const readFailure = new Error("input read failed");
      assert.throws(() => f.tree.data.setMany({ first: "bad", get later(): string { throw readFailure; } }), error => error === readFailure);
      assert.deepEqual(f.snapshot(), before);
      const conversionFailure = new Error("conversion failed");
      const badValue = { toString() { throw conversionFailure; } };
      assert.throws(() => Reflect.apply(f.tree.data.setMany, f.tree.data, [{ first: "bad", later: badValue }]), error => error === conversionFailure);
      assert.deepEqual(f.snapshot(), before);
      const converted = { toString() { return text; } };
      Reflect.apply(f.tree.data.setMany, f.tree.data, [{ converted }]);
      text = "later behavior";
      assertDataset(f.tree, { converted: "caller changed" });
      f.assertIdentity();
    } finally { f.close(); }
  });
}

events.terminal("pass");
console.log(`# ${checks} dataset batch checks passed`);
