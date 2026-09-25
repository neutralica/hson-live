import { parentPort } from "node:worker_threads";
import { ANY_DATA, ANY_DOCUMENT, Hson, HsonData, hsonLiveMap, type HsonSchema } from "../../src/index.ts";

const schema: HsonSchema = Hson.schema`<type "data" content <args "any" payload "any">>`;
const canonical = Hson.canonical`<args [null, true, -0] payload <z 1 a <nested []>>>`;
const certified = schema.certify(canonical);
const exact = Hson.data.fromHson(Hson.canonical`<'10' -0 '2' <__proto__ true>>`);
const map = hsonLiveMap.fromLibraries({ state: { data: { args: -0, payload: { z: 1, a: [] } }, schema } });
const state = map.lib("state");
state.at(["payload"]).replace({ second: [], first: { nested: true } });
const relational: HsonSchema = Hson.schema`<type "data" content <items <array <content <content <kind "string">> unique <by "kind" cases [["wide", ["A", "B"]], ["single-b", ["B"]], ["single-c", ["C"]]]>>>>>`;
const relationalAccepted = relational.certify(Hson.canonical`<items [<kind "wide">, <kind "single-c">]>`);
let relationalRejected = false;
try { relational.certify(Hson.canonical`<items [<kind "wide">, <kind "single-b">]>`); }
catch { relationalRejected = true; }
const empty = hsonLiveMap.create();
const primitive = hsonLiveMap.fromLibraries({ value: { data: 7, schema: ANY_DATA } });
const broadDocument = Hson.document`<main <p "worker"/>/>`;

parentPort?.postMessage({
  certified: certified === canonical,
  negativeZero: Object.is(state.snap(["args"]), -0),
  order: Object.keys(state.snap(["payload"]) as object),
  exactOrder: Hson.data.entries(exact)?.map(([name]) => name),
  exactNegativeZero: Object.is(Hson.data.materialize(Hson.data.entries(exact)?.[0]?.[1]!), -0),
  safeProto: Object.hasOwn(Hson.data.materialize(Hson.data.entries(exact)?.[1]?.[1]!) as object, "__proto__"),
  relationalAccepted: typeof relationalAccepted === "string",
  relationalRejected,
  emptyRev: empty.rev,
  emptyCount: empty.capture().libraries.length,
  primitiveMode: primitive.lib("value").mode,
  primitiveValue: primitive.lib("value").snap(),
  broadDocument: ANY_DOCUMENT.certify(broadDocument) === broadDocument,
});
