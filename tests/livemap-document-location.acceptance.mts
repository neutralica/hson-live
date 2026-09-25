// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode } from "../src/core/types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-location",
  title: "Named document library logical locations",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "path", "traversal", "watch", "public-api", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-location");
let checks = 0;
function check(name: string, run: () => void): void {
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
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const TreeSchema: HsonSchema = Hson.schema`<type "document" defs <Node <tag "item" content <repeat <ref "Node">>>> tag "main" content <repeat <ref "Node">>>`;
const TextSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "string">`;
const MultiSchema: HsonSchema = Hson.schema`<type "document" content <repeat <tag "item" content "empty">>>`;
const DataSchema: HsonSchema = Hson.schema`<type "data" content <items <array "string">>>`;
const item = (): HsonNode => ({ $_tag: "item", $_content: [] });
const tag = (value: unknown): string | undefined => is_Node(value) ? value.$_tag : undefined;
const tree = (source: string) => hsonLiveMap.fromLibraries({ page: { document: source, schema: TreeSchema } });

check("one-library document locations read root, child, and nested paths", () => {
  const map = tree("<main <item <item/>/>/>");
  const page = map.lib("page");
  assert.equal(tag(page.at([]).snap()), "main");
  assert.equal(tag(page.at([0]).snap()), "item");
  assert.equal(tag(page.at([0, 0]).snap()), "item");
  assert.equal(page.at([0, 1]).snap(), undefined);
  assert.deepEqual(page.at([0]).at([0]).path(), [0, 0]);
  assert.equal(page.at([0]).at([0]), page.at([0, 0]));
});

check("multi-node root and text leaves keep their logical coordinates", () => {
  const multi = hsonLiveMap.fromLibraries({ page: { document: "<item/> <item/>", schema: MultiSchema } }).lib("page");
  assert.equal(tag(multi.at([]).snap()), "_hson_root");
  assert.equal(tag(multi.at([0]).snap()), "item");
  assert.equal(tag(multi.at([1]).snap()), "item");
  const text = hsonLiveMap.fromLibraries({ page: { document: '<main "hello"/>', schema: TextSchema } }).lib("page");
  assert.equal(text.at([0]).snap(), "hello");
  assert.equal(text.at([0, 0]).snap(), undefined);
});

check("reads are detached, do not mint QUIDs, and do not advance revision", () => {
  const map = tree("<main <item/>/>");
  const page = map.lib("page");
  const before = map.rev;
  const read = page.at([0]).snap();
  if (!is_Node(read)) throw new Error("Expected item node.");
  read.$_tag = "changed";
  assert.equal(tag(page.at([0]).snap()), "item");
  assert.equal(page.document.byQuid("000000001"), undefined);
  assert.equal(map.rev, before);
});

check("fixed coordinates resolve their current occupant after insert, move, and remove", () => {
  const map = tree("<main <item id=\"first\"/> <item id=\"second\"/>/>");
  const page = map.lib("page");
  const atOne = page.at([1]);
  assert.equal((atOne.snap() as HsonNode).$_attrs?.id, "second");
  page.document.content.insert({ kind: "path", path: [0, 0] }, 0, item());
  assert.equal((atOne.snap() as HsonNode).$_attrs?.id, "first");
  page.document.content.move({ kind: "path", path: [0, 0] }, 0, 2);
  assert.equal((atOne.snap() as HsonNode).$_attrs?.id, "second");
  page.at([1]).delete();
  assert.equal(atOne.snap() === undefined, false);
});

check("location replacement stays within the selected document Schema", () => {
  const map = tree("<main <item/>/>");
  const page = map.lib("page");
  page.at([0]).replace({ $_tag: "item", $_attrs: { id: "replacement" }, $_content: [] });
  assert.equal((page.at([0]).snap() as HsonNode).$_attrs?.id, "replacement");
  assert.equal(map.rev, 1);
});

check("map restore refreshes existing document locations and watchers", () => {
  const map = tree("<main <item id=\"before\"/>/>");
  const page = map.lib("page");
  const location = page.at([0]);
  const snapshot = map.capture();
  const seen: unknown[] = [];
  location.watch((next) => seen.push(is_Node(next) ? next.$_attrs?.id : undefined));
  page.document.attrs.set({ kind: "path", path: [0, 0, 0] }, "id", "after");
  assert.equal((location.snap() as HsonNode).$_attrs?.id, "after");
  map.restore(snapshot);
  assert.equal((location.snap() as HsonNode).$_attrs?.id, "before");
  assert.deepEqual(seen, ["after", "before"]);
});

check("local identity acquisition does not publish document watch events", () => {
  const map = tree("<main <item/>/>");
  const page = map.lib("page");
  let events = 0;
  page.at([0]).watch(() => { events += 1; });
  acquire_document_identity(page.document, { kind: "path", path: [0, 0, 0] });
  assert.equal(events, 0);
});

check("malformed logical paths reject and coordinate inspection is frozen", () => {
  const page = tree("<main <item/>/>").lib("page");
  assert.throws(() => page.at([-1]), /not valid/);
  assert.throws(() => page.at([1.5]), /not valid/);
  const path = page.at([0]).path() as number[];
  assert.deepEqual(path, [0]);
  assert.throws(() => path.push(1), TypeError);
  assert.equal("at" in page.document, false);
});

check("data paths remain selected from their named library", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { items: ["first"] }, schema: DataSchema } });
  const state = map.lib("state");
  assert.equal(state.at(["items", 0]).snap(), "first");
  assert.equal(typeof state.at(["items"]).asArray()!.push, "function");
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
