import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";

type RuntimeShape = Readonly<{
  count: number;
  nested: Readonly<{ value: number }>;
}>;
type ArrayShape = Readonly<{ flags: readonly number[] }>;

const DataSchema = Hson.schema`<type "data" content <count "number" nested <content <value "number">>>>` as HsonSchema<RuntimeShape, "data">;
const ArraySchema = Hson.schema`<type "data" content <flags <array <content "number" unique true minlen 1 maxlen 3>>>>` as HsonSchema<ArrayShape, "data">;
const DynamicSchema = Hson.schema`<type "data" content <maybe <optional "any"> choice "any">>`;
const PageSchema = Hson.schema`<type "document" tag "main" attrs <props <id "string" hidden <optional "flag">>> content <sequence [<tag "section" content "string">]>>`;

const map = hsonLiveMap.fromLibraries({
  state: {
    data: {
      count: 1,
      nested: { value: 1 },
    },
    schema: DataSchema,
  },
  sequence: {
    data: { flags: [1] },
    schema: ArraySchema,
  },
  dynamic: {
    data: { choice: [1] },
    schema: DynamicSchema,
  },
  page: {
    document: `<main @000009991 id=hero <section "body"/>/>`,
    schema: PageSchema,
  },
});

const state = map.lib("state");
assert.equal(state.at(["nested"]).kind(), "object");
state.at(["nested"]).setKey("value", 2);
assert.equal(state.at(["nested", "value"]).snap(), 2);
assert.equal(state.at(["nested"]).asArray(), undefined);

const sequence = map.lib("sequence");
assert.equal(sequence.at(["flags"]).kind(), "array");
sequence.at(["flags"]).push(2);
assert.deepEqual(sequence.at(["flags"]).snap(), [1, 2]);
assert.equal(sequence.at(["flags"]).asObject(), undefined);

assert.equal(state.at(["count"]).kind(), "scalar");
assert.notEqual(state.at(["count"]).asScalar(), undefined);
assert.equal(state.at(["count"]).asObject(), undefined);
const dynamic = map.lib("dynamic");
assert.equal(dynamic.at(["maybe"]).kind(), "missing");
assert.equal(dynamic.at(["maybe"]).present(), undefined);

const staleArray = dynamic.at(["choice"]).asArray();
assert.notEqual(staleArray, undefined);
dynamic.at(["choice"]).replace({ value: 3 });
const revisionBeforeStaleUse = map.rev;
assert.throws(() => staleArray!.push(4), /array/i);
assert.equal(map.rev, revisionBeforeStaleUse);
assert.deepEqual(dynamic.at(["choice"]).snap(), { value: 3 });
dynamic.at(["choice"]).asObject()!.setKey("value", 4);
assert.deepEqual(dynamic.at(["choice"]).snap(), { value: 4 });

const page = map.lib("page");
page.at([]).asElement()!.attrs.set("id", "root");
page.at([]).asElement()!.flags.set("hidden");
assert.equal(page.at([]).asElement()!.attrs.get("id"), "root");
assert.equal(page.at([]).asElement()!.flags.has("hidden"), true);
assert.equal(page.at([0, 0]).kind(), "text");
assert.notEqual(page.at([0, 0]).asText(), undefined);
assert.equal(page.at([0, 0]).asElement(), undefined);
page.at([0, 0]).replace("next");
assert.equal(page.at([0, 0]).snap(), "next");
assert.equal(page.document.byQuid("000009991")?.$_tag, "main");

assert.equal(map.rev, 7);
process.stdout.write("livemap shape handles acceptance passed\n");
