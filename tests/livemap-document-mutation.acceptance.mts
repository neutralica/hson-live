// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, path, projected_element } from "./helpers/mirror-unit6.mts";
import { livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-mutation",
  title: "Registry document library mutation",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "mutation", "schema", "identity", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-mutation");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}
const fixture = () => element('<main <item id="a"/> <item id="b"/>/>');
const root = path();
const carrier = path(0);
const item = (index: number) => path(0, index);

check("document libraries expose canonical attribute and content operations", () => {
  const map = fixture();
  assert.equal(map.mode, "document");
  assert.equal(typeof map.document.attrs.set, "function");
  assert.equal(typeof map.document.content.insert, "function");
});

check("attribute set, replacement, and no-op follow one revision stream", () => {
  const map = fixture();
  const first = map.document.attrs.set(root, "title", "hello");
  assert.equal(first.rev, 1);
  assert.equal(first.operations[0]?.operation.op, "set-attr");
  assert.equal(map.document.attrs.get(root, "title"), "hello");
  const unchanged = map.document.attrs.set(root, "title", "hello");
  assert.equal(unchanged.changed, false);
  assert.equal(map.rev, 1);
  map.document.attrs.set(root, "title", "next");
  assert.equal(map.rev, 2);
});

check("attribute bags are detached from callers and returned snapshots", () => {
  const map = fixture();
  const input = { style: { color: "red" } };
  map.document.attrs.setMany(root, input);
  input.style.color = "blue";
  assert.deepEqual(map.document.attrs.get(root, "style"), { color: "red" });
  const output = map.document.attrs.get(root, "style") as { color: string };
  assert.throws(() => { output.color = "green"; }, TypeError);
  assert.deepEqual(map.document.attrs.get(root, "style"), { color: "red" });
});

check("setMany preserves unspecified attributes in one commit", () => {
  const map = fixture();
  map.document.attrs.set(root, "old", true);
  const commit = map.document.attrs.setMany(root, { a: 1, b: 2 });
  assert.equal(commit.operations.length, 1);
  assert.equal(commit.operations[0]?.operation.op, "replace-attrs");
  assert.deepEqual(map.document.attrs.keys(root), ["a", "b", "old"]);
});

check("drop, dropMany, clear, and replace keep exact attribute bags", () => {
  const map = fixture();
  map.document.attrs.replace(root, { a: 1, b: 2, c: 3 });
  map.document.attrs.drop(root, "a");
  map.document.attrs.dropMany(root, ["b", "missing", "b"]);
  assert.deepEqual(map.document.attrs.keys(root), ["c"]);
  map.document.attrs.clear(root);
  assert.deepEqual(map.document.attrs.keys(root), []);
  map.document.attrs.replace(root, { ready: true });
  assert.deepEqual(map.document.attrs.keys(root), ["ready"]);
});

check("invalid attribute names and raw QUID targets reject atomically", () => {
  const map = fixture();
  const before = map.capture();
  assert.throws(() => map.document.attrs.set(root, "bad name", "x"));
  assert.throws(() => map.document.attrs.set({ kind: "quid", quid: "000000001" } as never, "title", "x"));
  assert.deepEqual(map.capture(), before);
});

check("content insertion accepts beginning, middle, and append under Schema", () => {
  const map = fixture();
  map.document.content.insert(carrier, 0, projected_element('<item id="first"/>'));
  map.document.content.insert(carrier, 2, projected_element('<item id="middle"/>'));
  map.document.content.insert(carrier, 4, projected_element('<item id="last"/>'));
  assert.deepEqual([0, 1, 2, 3, 4].map((index) => map.document.attrs.get(item(index), "id")),
    ["first", "a", "middle", "b", "last"]);
});

check("content replacement changes one slot and rejects off-Schema tags", () => {
  const map = fixture();
  map.document.content.replace(carrier, 0, projected_element('<item id="new"/>'));
  assert.equal(map.document.attrs.get(item(0), "id"), "new");
  assert.equal(map.document.attrs.get(item(1), "id"), "b");
  const before = map.capture();
  assert.throws(() => map.document.content.replace(carrier, 0, projected_element('<aside/>')));
  assert.deepEqual(map.capture(), before);
});

check("content removal and final-position movement preserve surviving values", () => {
  const map = fixture();
  map.document.content.move(carrier, 0, 1);
  assert.deepEqual([0, 1].map((index) => map.document.attrs.get(item(index), "id")), ["b", "a"]);
  map.document.content.remove(carrier, 0);
  assert.equal(map.document.attrs.get(item(0), "id"), "a");
});

check("same-position move and failed indexes consume no revision", () => {
  const map = fixture();
  const before = map.capture();
  const noop = map.document.content.move(carrier, 0, 0);
  assert.equal(noop.changed, false);
  assert.throws(() => map.document.content.move(carrier, 0, 99));
  assert.deepEqual(map.capture(), before);
});

check("sparse document identity moves with a canonical item", () => {
  const map = element('<main <item @000000a01/> <item/>/>');
  map.document.content.move(carrier, 0, 1);
  assert.deepEqual(livemap_document_identity_overlay_for(map.document).pathForQuid("000000a01"), [0, 0, 1]);
  assert.equal(map.document.byQuid("000000a01")?.$_tag, "item");
});

check("incoming supplied QUID claims reject without partial mutation", () => {
  const map = fixture();
  const before = map.capture();
  assert.throws(() => map.document.content.insert(carrier, 1, projected_element('<item @000000a02/>')));
  assert.deepEqual(map.capture(), before);
});

check("sequential successful mutations each advance the global revision", () => {
  const map = fixture();
  const start = map.rev;
  map.document.attrs.set(root, "one", 1);
  map.document.content.insert(carrier, 1, projected_element('<item/>'));
  map.document.attrs.set(item(1), "two", 2);
  assert.equal(map.rev, start + 3);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry document mutation checks passed\n`);
