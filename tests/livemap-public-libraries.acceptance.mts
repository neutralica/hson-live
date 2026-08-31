import assert from "node:assert/strict";
import {
  Hson,
  hsonLiveMap,
  hsonLocus,
  type HsonSchema,
  type LiveMapMultiLibraryCommit,
} from "../src/index.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

const StateSchema: HsonSchema = Hson`<type "data" content <count "number" nested <content <value "number">>>>`;
const ColorsSchema: HsonSchema = Hson`<type "data" content <primary "string">>`;
const PageSchema: HsonSchema = Hson`<type "document" tag "main" content "empty">`;
let checks = 0;

function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function create_map() {
  return hsonLiveMap.fromLibraries({
    state: { data: { count: 1, nested: { value: 2 } }, schema: StateSchema },
    colors: { data: { primary: "blue" }, schema: ColorsSchema },
    page: { document: "<main/>", schema: PageSchema },
  });
}

check("fromLibraries establishes fixed named data and document Libraries", () => {
  const map = create_map();
  assert.equal(map.rev, 0);
  assert.equal(map.lib("state").mode, "data-object");
  assert.equal(map.lib("colors").snap(["primary"]), "blue");
  assert.equal(map.lib("page").mode, "document");
  assert.equal(map.lib("page").root().$_content.length, 1);
  assert.equal("document" in map.lib("page"), false);
  assert.equal("add" in map.lib, false);
  assert.equal("create" in map.lib, false);
  assert.equal("library" in map, false);
});

check("named Handles stay library-relative and return one truthful global commit", () => {
  const map = create_map();
  const seen: LiveMapMultiLibraryCommit[] = [];
  map.commits.observe((commit) => seen.push(commit));
  const handle = map.lib("state").at(["nested"]);
  const commit = handle.at(["value"]).set(3);

  assert.equal(commit.kind, "multi-library");
  assert.deepEqual([commit.prevRev, commit.rev], [0, 1]);
  assert.deepEqual(commit.operations.map((entry) => entry.library), ["state"]);
  assert.equal("target" in commit.operations[0]!, false);
  assert.deepEqual(handle.snap(), { value: 3 });
  assert.equal(map.lib("colors").snap(["primary"]), "blue");
  assert.equal(map.rev, 1);
  assert.deepEqual(seen, [commit]);
});

check("each named Library validates its initial graph before the registry is returned", () => {
  assert.throws(() => hsonLiveMap.fromLibraries({
    state: { data: { count: 1, nested: { value: 2 } }, schema: StateSchema },
    colors: { data: { primary: 3 }, schema: ColorsSchema },
  }), /schema/i);
});

check("the public commit family preserves future cross-library operation order", () => {
  const proof: LiveMapMultiLibraryCommit<"state" | "colors"> = {
    kind: "multi-library",
    changed: true,
    prevRev: 7,
    rev: 8,
    operations: [
      { library: "state", operation: { kind: "set", path: ["count"], prev: 1, next: 2 } },
      { library: "colors", operation: { kind: "set", path: ["primary"], prev: "blue", next: "green" } },
      { library: "state", operation: { kind: "set", path: ["count"], prev: 2, next: 3 } },
    ],
  };
  assert.deepEqual(proof.operations.map((entry) => entry.library), ["state", "colors", "state"]);
});

check("current Locus rejects a public multi-library map before claiming management", () => {
  const map = create_map();
  assert.throws(
    () => hsonLocus.create({ map: map as never }),
    /multi-library LiveMap support is not yet available/i,
  );
  assert.equal(map.lib("state").at(["count"]).set(2).rev, 1);
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livemap.public-libraries", checks, checks, 0);
