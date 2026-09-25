import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";

const DataSchema = Hson.schema`<type "data" content <name "string" age "number">>`;
const ItemSchema = Hson.schema`<type "data" content <item <optional "any">>>`;
const PageSchema = Hson.schema`<type "document" tag "main" content "empty">`;

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.library-ownership",
  title: "LiveMap library ownership",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["livemap", "libraries", "ownership"]),
});

const testEvents = create_test_event_emitter("livemap.library-ownership");
let checks = 0;
const check = (name: string, run: () => void): void => {
  testEvents.case_begin(name, name);
  try { run(); testEvents.case_end(name, "pass"); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail"); testEvents.terminal("fail"); throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
};

check("one named data library retains its state identity across graph changes", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { name: "Ada", age: 37 }, schema: DataSchema } });
  const state = map.lib("state");
  const authority = internal_livemap_aggregate_authority(map);
  const before = authority.inspect().libraries[0]!;
  assert.equal(before.mode, "data-object");
  assert.equal(map.rev, 0);
  assert.equal(before.hsonSchemaAttached, true);
  state.at(["age"]).set(38);
  const after = authority.inspect().libraries[0]!;
  assert.equal(after.identity, before.identity);
  assert.notEqual(after.root, before.root);
  assert.equal(map.rev, 1);
  assert.equal(authority.identityEpoch().current(), 0);
});

check("one registry ledger survives library-local graph changes", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { item: {} }, schema: ItemSchema } });
  const state = map.lib("state");
  const authority = internal_livemap_aggregate_authority(map);
  const before = authority.inspect().libraries[0]!;
  acquire_projected_identity(state, ["item"]);
  const acquired = authority.inspect().libraries[0]!;
  assert.equal(acquired.identity, before.identity);
  assert.equal(authority.identityEpoch().issued().size, 1);
  state.at(["item"]).delete();
  const retired = authority.inspect().libraries[0]!;
  assert.equal(retired.identity, before.identity);
  assert.equal(authority.identityEpoch().issued().size, 1);
  assert.equal(map.rev, 1);
});

check("one named document library retains its mode under the registry", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: PageSchema } });
  const page = map.lib("page");
  const ownership = internal_livemap_aggregate_authority(map).inspect().libraries[0]!;
  assert.equal(ownership.mode, "document");
  assert.equal(map.lib("page"), page);
  assert.equal("lib" in map, true);
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
