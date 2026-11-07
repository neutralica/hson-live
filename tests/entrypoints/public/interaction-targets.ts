import { add_interaction, replace_interaction, remove_interaction, type InteractionDescriptor } from "hson-live";
import { hsonLiveMap, type LiveMap, type LiveMapStagedWriter } from "hson-live/livemap";
import type { Locus, LocusActionContext } from "hson-live/locus";
import type { Echo } from "hson-live/echo";

declare const descriptor: InteractionDescriptor;
declare const map: LiveMap;
declare const locus: Locus;
declare const endpoint: Echo;
declare const replica: Echo<LiveMap>;
declare const action: LocusActionContext;
declare const writer: LiveMapStagedWriter<LiveMap, void>;

for (const helper of [add_interaction, replace_interaction]) {
  helper(map, descriptor);
  helper(writer, descriptor);
  helper(action.stage, descriptor);
  map.batch(draft => helper(draft, descriptor));
  locus.stage(draft => helper(draft, descriptor));
  // @ts-expect-error Arbitrary objects have no supported mutation capability.
  helper({}, descriptor);
  // @ts-expect-error Public Locus facades are not stage writers.
  helper(locus, descriptor);
  // @ts-expect-error Endpoint Echo has no direct mutation capability.
  helper(endpoint, descriptor);
  // @ts-expect-error Replica Echo does not expose its subordinate map.
  helper(replica, descriptor);
}
remove_interaction(map, "id");
remove_interaction(writer, "id");
remove_interaction(action.stage, "id");
map.batch(draft => remove_interaction(draft, "id"));
locus.stage(draft => remove_interaction(draft, "id"));
// @ts-expect-error Arbitrary objects are unsupported.
remove_interaction({}, "id");
// @ts-expect-error A Locus facade is unsupported.
remove_interaction(locus, "id");
// @ts-expect-error An endpoint Echo facade is unsupported.
remove_interaction(endpoint, "id");
// @ts-expect-error A replica Echo facade is unsupported.
remove_interaction(replica, "id");

// Retain specialized inventories, not just broad declared capabilities.
const concrete = hsonLiveMap.fromLibraries({ page: { document: "<main/>" }, state: { json: { count: 0 } } });
const governed = hsonLiveMap.locus.create({ page: { document: "<main/>" } });
add_interaction(concrete, descriptor);
concrete.batch(draft => { add_interaction(draft, descriptor); replace_interaction(draft, descriptor); remove_interaction(draft, "id"); });
governed.stage(draft => { add_interaction(draft, descriptor); replace_interaction(draft, descriptor); remove_interaction(draft, "id"); });
// @ts-expect-error Specialized Locus facades are also unsupported.
add_interaction(governed, descriptor);
