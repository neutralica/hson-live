import assert from "node:assert/strict";
import { Hson, hson } from "../src/index.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { internal_livemap_library_ownership } from "../src/api/livemap/livemap.internal.ts";
import { acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";

const DataSchema = Hson`<type "data" content <name "string" age "number">>`;
let checks = 0;
const check = (name: string, run: () => void): void => {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
};

check("one stable internal default library owns the projected graph and mode", () => {
  const map = hson.liveMap.fromJson({ name: "Ada", age: 37 });
  const before = internal_livemap_library_ownership(map);
  assert.equal(before.mode, "data-object");
  assert.equal(before.revision, 0);
  assert.equal(before.hsonSchemaAttached, false);
  map.set(["age"], 38);
  const after = internal_livemap_library_ownership(map);
  assert.equal(after.library, before.library);
  assert.equal(after.root, before.root);
  assert.equal(after.revision, 1);
  assert.equal(after.quidEpoch, before.quidEpoch);
});

check("Schema attaches to the default library while map revision remains global", () => {
  const map = hson.liveMap.fromJson({ name: "Ada", age: 37 });
  const before = internal_livemap_library_ownership(map);
  map.schema.use(DataSchema);
  const afterSchema = internal_livemap_library_ownership(map);
  assert.equal(afterSchema.library, before.library);
  assert.equal(afterSchema.hsonSchemaAttached, true);
  assert.equal(afterSchema.revision, 0);
  map.set(["age"], 38);
  assert.equal(internal_livemap_library_ownership(map).revision, 1);
});

check("the single map-wide QUID ledger survives library-local graph changes", () => {
  const map = hson.liveMap.fromJson({ item: {} });
  const before = internal_livemap_library_ownership(map);
  acquire_projected_identity(map, ["item"]);
  const acquired = internal_livemap_library_ownership(map);
  assert.equal(acquired.library, before.library);
  assert.equal(acquired.issuedQuids, 1);
  map.delete(["item"]);
  const retired = internal_livemap_library_ownership(map);
  assert.equal(retired.library, before.library);
  assert.equal(retired.issuedQuids, 1);
  assert.equal(retired.revision, 2);
});

check("projected restore cannot bypass default-library HsonSchema admission", () => {
  const governed = hson.liveMap.fromJson({ name: "Ada", age: 37 }).schema.use(DataSchema);
  const invalid = hson.liveMap.fromJson({ name: "Ada" }).capture();
  assert.throws(() => governed.restore(invalid));
  assert.deepEqual(governed.snap(), { name: "Ada", age: 37 });
});

check("document maps retain a library-local mode without a public library selector", () => {
  const map = hson.liveMap.fromHson("<main/>");
  const ownership = internal_livemap_library_ownership(map);
  assert.equal(ownership.mode, "document");
  assert.equal("library" in map, false);
  assert.equal("lib" in map, false);
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livemap.library-ownership", checks, checks, 0);
