import { parentPort } from "node:worker_threads";
import assert from "node:assert/strict";
import { ANY_DATA, ANY_DOCUMENT, Hson, HsonDataValue, hsonLiveMap, type HsonSchema } from "../../src/index.ts";
import { direct_data_schema_cases } from "./direct-data-admission-cases.mts";
import { decode_hosted_root } from "../../src/api/livemap/livemap.hosted.ts";
import { snap_live_path } from "../../src/api/livemap/livemap.editor.ts";

direct_data_schema_cases();

const schema: HsonSchema = Hson.schema`<type "data" content <args "any" payload "any">>`;
const canonical = Hson.canonical`<args [null, true, -0] payload <z 1 a <nested []>>>`;
const certified = schema.certify(Hson.data.fromSource(canonical));
const exact = Hson.data.fromSource(Hson.canonical`<'10' -0 '2' <__proto__ true>>`);
const map = hsonLiveMap.fromLibraries({ state: { json: { args: -0, payload: { z: 1, a: [] } }, schema } });
const state = map.data.must("state");
state.at(["payload"]).replace({ second: [], first: { nested: true } });
const relational: HsonSchema = Hson.schema`<type "data" content <items <array <content <content <kind "string">> unique <by "kind" cases [["wide", ["A", "B"]], ["single-b", ["B"]], ["single-c", ["C"]]]>>>>>`;
const relationalAccepted = relational.certify(Hson.data.parse`<items [<kind "wide">, <kind "single-c">]>`);
let relationalRejected = false;
try { relational.certify(Hson.data.parse`<items [<kind "wide">, <kind "single-b">]>`); }
catch { relationalRejected = true; }
const empty = hsonLiveMap.create();
const emptyCapture = empty.capture();
assert.equal(empty.rev, 0);
assert.equal(emptyCapture.revision, 0);
assert.deepEqual(emptyCapture.registry.libraries.map(({ name, scope, mode }) => ({ name, scope, mode })), [
  { name: "@hson/canonical-interactions", scope: "hson-internal", mode: "data-object" },
]);
assert.deepEqual(emptyCapture.libraries.map(({ name, mode, root }) => ({
  name, mode, state: snap_live_path(decode_hosted_root(root), []),
})), [{ name: "@hson/canonical-interactions", mode: "data-object", state: { descriptors: [] } }]);
const primitive = hsonLiveMap.fromLibraries({ value: { json: 7, schema: ANY_DATA } });
const broadDocument = Hson.document`<main <p "worker"/>/>`;

parentPort?.postMessage({
  certified: certified.toHson() === canonical,
  negativeZero: Object.is(state.snap(["args"]), -0),
  order: Object.keys(state.snap(["payload"]) as object),
  exactOrder: (exact).entries()?.map(([name]) => name),
  exactNegativeZero: Object.is(((exact).entries()?.[0]?.[1]!).materialize(), -0),
  safeProto: Object.hasOwn(((exact).entries()?.[1]?.[1]!).materialize() as object, "__proto__"),
  relationalAccepted: relationalAccepted instanceof HsonDataValue,
  relationalRejected,
  emptyRev: empty.rev,
  // The acceptance result counts application Libraries; the internal binding is checked above.
  emptyCount: emptyCapture.registry.libraries.filter(({ scope }) => scope !== "hson-internal").length,
  primitiveMode: primitive.data.must("value").mode,
  primitiveValue: primitive.data.must("value").snap(),
  broadDocument: ANY_DOCUMENT.certify(broadDocument) === String(broadDocument),
});
