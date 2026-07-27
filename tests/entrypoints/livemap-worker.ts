import { hsonLiveMap } from "hson-live/livemap";

const map = hsonLiveMap.fromJson({ ready: true });
void map.snap();
void hsonLiveMap.fromHson(`<worker <ready true>>`);
void hsonLiveMap.fromNode(map.root());
void hsonLiveMap.schema.define((shape) => ({ ready: shape.boolean }));
