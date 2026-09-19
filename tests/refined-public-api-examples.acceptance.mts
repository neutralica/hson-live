import assert from "node:assert/strict";
import { Hson } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";
import { hsonTransform } from "hson-live/transform";

const canonical = hsonTransform.fromTrustedHtml("<main><p>Ready</p></main>").toHson().serialize();
assert.match(hsonTransform.fromHson(canonical).toHtml().serialize(), /<main>/);

const map = hsonLiveMap.fromJson({ count: 0 });
map.set(["count"], 1);
assert.equal(map.snap(["count"]), 1);
const data = map.data(["count"]);
assert.equal(typeof data, "string");
assert.equal(data === undefined ? undefined : Hson.data.materialize(data), 1);
