// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, projected_element, raw_node, commit_document_operations } from "./helpers/mirror-unit6.mts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import type { LiveMapGraphOp, LiveMapDocumentLibrary } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-staging",
  title: "Registry staged canonical document operations",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "path", "staging", "registry", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-staging");
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
const p = (...parts: number[]) => Object.freeze({ kind: "path" as const, path: validate_document_path(parts) });
const root = p(0, 0);
const item = (index: number) => p(0, 0, index);
const fixture = () => element('<main <item id="a"/> <item id="b"/> <item id="c"/>/>');
const ids = (map: LiveMapDocumentLibrary) => [0, 1, 2]
  .map((index) => { try { return raw_node(map.root(), [0, index]).$_attrs?.id; } catch { return undefined; } })
  .filter((id) => id !== undefined);
const commit = (map: LiveMapDocumentLibrary, operations: readonly LiveMapGraphOp[]) => commit_document_operations(map, operations);

check("insert followed by mutation addresses the inserted ordinal", () => {
  const map = fixture();
  const result = commit(map, [
    { domain: "graph", op: "insert-content", target: root, index: 1, content: projected_element('<item/>') },
    { domain: "graph", op: "set-attr", target: item(1), name: "id", value: "inserted" },
  ]);
  assert.equal(result.rev, 1);
  assert.deepEqual(ids(map), ["a", "inserted", "b"]);
});

check("delete followed by mutation addresses the shifted sibling", () => {
  const map = fixture();
  commit(map, [
    { domain: "graph", op: "remove-content", target: root, index: 0 },
    { domain: "graph", op: "set-attr", target: item(0), name: "shifted", value: true },
  ]);
  assert.equal(map.document.attrs.get(item(0), "id"), "b");
  assert.equal(map.document.attrs.get(item(0), "shifted"), true);
});

check("forward move uses the final position after removal", () => {
  const map = fixture();
  commit(map, [{ domain: "graph", op: "move-content", target: root, from: 0, to: 2 }]);
  assert.deepEqual(ids(map), ["b", "c", "a"]);
});

check("backward move uses the final position after removal", () => {
  const map = fixture();
  commit(map, [{ domain: "graph", op: "move-content", target: root, from: 2, to: 0 }]);
  assert.deepEqual(ids(map), ["c", "a", "b"]);
});

check("replacement is visible to a later staged path write", () => {
  const map = fixture();
  commit(map, [
    { domain: "graph", op: "replace-content", target: root, index: 0, replacement: projected_element('<item id="new"/>') },
    { domain: "graph", op: "set-attr", target: item(0), name: "ready", value: true },
  ]);
  assert.equal(map.document.attrs.get(item(0), "id"), "new");
  assert.equal(map.document.attrs.get(item(0), "ready"), true);
});

check("a later invalid operation leaves earlier staged writes unapplied", () => {
  const map = fixture();
  const before = map.capture();
  assert.throws(() => commit(map, [
    { domain: "graph", op: "set-attr", target: item(0), name: "temp", value: true },
    { domain: "graph", op: "set-attr", target: item(99), name: "bad", value: true },
  ]));
  assert.deepEqual(map.capture(), before);
});

check("one staged transaction publishes one global revision", () => {
  const map = fixture();
  let publications = 0;
  map.commits.observe((event) => { if (event.kind === "commit") publications += 1; });
  commit(map, [
    { domain: "graph", op: "set-attr", target: item(0), name: "x", value: 1 },
    { domain: "graph", op: "set-attr", target: item(1), name: "y", value: 2 },
  ]);
  assert.equal(map.rev, 1);
  assert.equal(publications, 1);
});

check("equal roots and operations produce equal staged documents", () => {
  const left = fixture();
  const right = fixture();
  const operations: readonly LiveMapGraphOp[] = [
    { domain: "graph", op: "move-content", target: root, from: 2, to: 0 },
    { domain: "graph", op: "set-attr", target: item(0), name: "moved", value: true },
  ];
  commit(left, operations);
  commit(right, operations);
  assert.deepEqual(left.root(), right.root());
  assert.equal(left.rev, right.rev);
});

events.terminal("pass");
process.stdout.write(`# ${checks} staged registry document checks passed\n`);
