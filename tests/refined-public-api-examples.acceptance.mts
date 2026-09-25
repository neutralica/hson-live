import assert from "node:assert/strict";
import { Hson } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";
import { hsonTransform } from "hson-live/transform";

const canonical = hsonTransform.fromTrustedHtml("<main><p>Ready</p></main>").toHson().serialize();
assert.match(hsonTransform.fromHson(canonical).toHtml().serialize(), /<main>/);

const map = hsonLiveMap.fromLibraries({ state: { data: { count: 0 }, schema: Hson.schema`<type "data" content <count "number">>` } });
const state = map.lib("state");
state.at(["count"]).set(1);
assert.equal(state.snap(["count"]), 1);
const data = state.at(["count"]).data();
assert.equal(typeof data, "string");
assert.equal(data === undefined ? undefined : Hson.data.materialize(data), 1);
