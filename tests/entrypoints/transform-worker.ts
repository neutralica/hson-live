import { hsonTransform } from "hson-live/transform";
import { hsonLiveHost } from "hson-live/livehost";

void hsonLiveHost;
void hsonTransform.fromHson(`<worker <ready true>>`).toNode();
void hsonTransform.fromJson({ ready: true }).toHson().serialize();
void hsonTransform.fromNode({
  $_tag: "_object",
  $_content: [],
}).toJson().value();
void hsonTransform.fromTrustedHtml(`<worker ready></worker>`).toNode();
void hsonTransform.fromUntrustedHtml(`<worker ready onclick="bad()"></worker>`).toNode();
