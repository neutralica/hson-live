import { parentPort } from "node:worker_threads";
import { Hson, hsonLiveMap, type HsonSchema } from "../../src/index.ts";

const schema: HsonSchema = Hson`<type "data" content <args "any" payload "any">>`;
const canonical = Hson`<args [null, true, -0] payload <z 1 a <nested []>>>`;
const certified = Hson.certify(schema, canonical);
const map = hsonLiveMap.fromJson({ args: -0, payload: { z: 1, a: [] } }).schema.use(schema);
map.replace(["payload"], { second: [], first: { nested: true } });

parentPort?.postMessage({
  certified: certified === canonical,
  negativeZero: Object.is(map.snap(["args"]), -0),
  order: Object.keys(map.snap(["payload"]) as object),
});
