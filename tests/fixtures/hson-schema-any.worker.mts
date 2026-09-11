import { parentPort } from "node:worker_threads";
import { Hson, HsonData, hsonLiveMap, type HsonSchema } from "../../src/index.ts";

const schema: HsonSchema = Hson`<type "data" content <args "any" payload "any">>`;
const canonical = Hson`<args [null, true, -0] payload <z 1 a <nested []>>>`;
const certified = Hson.certify(schema, canonical);
const exact = HsonData.fromHson(Hson`<'10' -0 '2' <__proto__ true>>`);
const map = hsonLiveMap.fromJson({ args: -0, payload: { z: 1, a: [] } }).schema.use(schema);
map.replace(["payload"], { second: [], first: { nested: true } });

parentPort?.postMessage({
  certified: certified === canonical,
  negativeZero: Object.is(map.snap(["args"]), -0),
  order: Object.keys(map.snap(["payload"]) as object),
  exactOrder: exact.entries()?.map(([name]) => name),
  exactNegativeZero: Object.is(exact.entries()?.[0]?.[1].scalar(), -0),
  safeProto: Object.hasOwn(exact.entries()?.[1]?.[1].materialize() as object, "__proto__"),
});
