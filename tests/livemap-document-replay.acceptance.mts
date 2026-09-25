// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";
import { prepare_document_graph_operation } from "../src/api/livemap/livemap.document.mutation.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-replay", title: "Registry document observations and restoration",
  category: "LiveMap", runtime: "node",
  tags: Object.freeze(["document", "observation", "restore", "mutation"]),
});
const events = create_test_event_emitter("livemap.document-replay");
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
const Empty = Hson.schema`<type "document" tag "main" content "empty">`;
const Paragraph = Hson.schema`<type "document" tag "main" content <sequence [<tag "p" content "string">]>>`;
const Data = Hson.schema`<type "data" content <value "number">>`;
const ordinary = (source = "<main/>") => hsonLiveMap.fromLibraries({ page: { document: source, schema: Empty } });
const exact = (source: string, schema = Empty) => admit_exact_runtime_livemap_libraries({
  page: { document: parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }), schema },
});
const rootTarget = { kind: "path", path: [0] } as const;

check("document mutation publishes one named map commit", () => {
  const map = exact("<main @000000001/>");
  const seen: unknown[] = [];
  map.commits.observe((commit) => seen.push(commit));
  const commit = map.lib("page").document.attrs.set(rootTarget, "id", "main");
  assert.deepEqual(seen, [commit]);
  assert.equal(commit.operations[0]?.library, "page");
  assert.equal(commit.operations[0]?.operation.op, "set-attr");
  assert.deepEqual([commit.prevRev, commit.rev], [0, 1]);
  map.lib("page").document.attrs.set(rootTarget, "id", "main");
  assert.equal(seen.length, 1);
});
check("document mutation failures publish nothing", () => {
  const map = ordinary();
  const seen: unknown[] = [];
  map.commits.observe((commit) => seen.push(commit));
  const before = map.capture();
  assert.throws(() => map.lib("page").document.attrs.set(rootTarget, "bad name", "x"));
  assert.deepEqual(map.capture(), before);
  assert.deepEqual(seen, []);
});
check("data feed and registry commit observation see one change", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 1 }, schema: Data } });
  const feeds: unknown[] = [];
  const commits: unknown[] = [];
  map.lib("state").at(["value"]).feed((event) => feeds.push(event));
  map.commits.observe((commit) => commits.push(commit));
  const commit = map.lib("state").at(["value"]).set(2);
  assert.equal(feeds.length, 1);
  assert.deepEqual(commits, [commit]);
  assert.equal(commit.operations[0]?.library, "state");
});
check("registry restore swaps state and exact revision", () => {
  const source = hsonLiveMap.fromLibraries({ state: { data: { value: 1 }, schema: Data } });
  source.lib("state").at(["value"]).set(2);
  source.lib("state").at(["value"]).set(3);
  const target = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: Data } });
  target.restore(source.capture());
  assert.deepEqual(target.lib("state").snap(), { value: 3 });
  assert.equal(target.rev, 2);
  const before = target.capture();
  assert.throws(() => target.restore({ ...before, format: "wrong" } as never));
  assert.deepEqual(target.capture(), before);
});
check("document restore installs a coherent later state", () => {
  const source = exact('<main @000000002 <p @000000003 "old"/>/>', Paragraph);
  const target = exact('<main @000000002 <p @000000003 "old"/>/>', Paragraph);
  source.lib("page").document.attrs.set(rootTarget, "class", "ready");
  source.lib("page").document.attrs.set(rootTarget, "title", "new");
  target.restore(source.capture());
  assert.deepEqual(target.capture(), source.capture());
  assert.equal(target.rev, 2);
  assert.equal(target.lib("page").document.byQuid("000000003"), undefined);
});
check("replace attrs planning detaches caller input without changing state", () => {
  const map = exact('<main id="before" @00000001f/>');
  const attrs = { id: "after", style: { color: "red" } };
  const before = map.capture();
  const prepared = prepare_document_graph_operation(map.lib("page").root(), "document", {
    domain: "graph", op: "replace-attrs", target: rootTarget, attrs,
  });
  assert.deepEqual(map.capture(), before);
  assert.equal(prepared.operation.op, "replace-attrs");
  if (prepared.operation.op !== "replace-attrs") throw new Error("Expected attrs operation.");
  attrs.id = "caller-mutated";
  attrs.style.color = "blue";
  assert.deepEqual(prepared.operation.attrs, { id: "after", style: { color: "red" } });
});
check("bulk attrs methods produce one named replace operation", () => {
  const map = ordinary('<main id="old" title="kept"/>');
  const attrs = map.lib("page").document.attrs;
  const commits = [
    attrs.setMany(rootTarget, { id: "new", hidden: false }),
    attrs.dropMany(rootTarget, ["hidden"]),
    attrs.replace(rootTarget, { title: "next", count: 0 }),
    attrs.clear(rootTarget),
  ];
  assert.ok(commits.every((commit) => commit.operations.length === 1
    && commit.operations[0]?.library === "page"
    && commit.operations[0]?.operation.op === "replace-attrs"));
  assert.equal(map.rev, 4);
  assert.deepEqual(attrs.keys(rootTarget), []);
});
check("invalid attribute bags reject atomically", () => {
  const invalid = [
    { "hson:quid": "000000024" }, { "bad name": "malformed" },
    { bad: undefined }, { bad: Number.POSITIVE_INFINITY }, { bad: [] },
  ];
  for (const value of invalid) {
    const map = ordinary('<main id="kept"/>');
    const before = map.capture();
    assert.throws(() => map.lib("page").document.attrs.replace(rootTarget, value as never));
    assert.deepEqual(map.capture(), before);
  }
});
check("invalid document targets reject without advancing revision", () => {
  for (const path of [[0, 0], [9]]) {
    const map = ordinary();
    const before = map.capture();
    assert.throws(() => map.lib("page").document.attrs.set({ kind: "path", path }, "id", "x"));
    assert.deepEqual(map.capture(), before);
  }
});
check("capture and restore omit runtime QUID claims", () => {
  const source = exact('<main @000000020/>');
  const target = ordinary();
  target.restore(source.capture());
  assert.equal(target.lib("page").document.byQuid("000000020"), undefined);
  assert.equal(JSON.stringify(target.capture()).includes("000000020"), false);
});
process.stdout.write(`# ${checks} registry document observation checks passed\n`);
events.terminal("pass");
