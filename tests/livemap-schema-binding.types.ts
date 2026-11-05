import { ANY_DATA, hsonLiveMap, type HsonSchema } from "hson-live";
import type { LiveMapCommit } from "hson-live/livemap";

declare const Count: HsonSchema<{ readonly count: number }, "data", "Count">;
declare const Name: HsonSchema<{ readonly name: string }, "data", "Name">;
declare const Page: HsonSchema<unknown, "document", "Page">;
const map = hsonLiveMap.fromLibraries({
  state: { data: { count: 1 }, schema: Count },
  other: { data: { name: "Ada" }, schema: Name },
  page: { document: "<main/>", schema: Page },
});
const initial: typeof Count = map.data.must("state").schema.get();
const same: LiveMapCommit<"state"> = map.data.must("state").schema.use(Count);
map.data.must("state").at(["count"]).set(2);
const retained: typeof Count = map.data.must("state").schema.get();
const separate: typeof Name = map.data.must("other").schema.get();
// @ts-expect-error A known governing binding does not accept another specific contract.
map.data.must("state").schema.use(Name);
// @ts-expect-error A Data Library cannot accept a Document Schema.
map.data.must("state").schema.use(Page);
// @ts-expect-error Fixed Schema still governs Data mutation types.
map.data.must("state").at(["count"]).set("wrong");

const broad = hsonLiveMap.fromLibraries({ state: { data: { count: 1 }, schema: ANY_DATA } });
// Dynamic use remains callable; runtime rejects a different admitted binding.
broad.data.must("state").schema.use(Count);
// @ts-expect-error The declared API does not turn a use call into a new binding proof.
const replaced: typeof Count = broad.data.must("state").schema.get();

const managed = hsonLiveMap.locus.create({ state: { data: { count: 1 }, schema: Count, access: "shared" } });
// @ts-expect-error Managed facades expose the established Schema without a use route.
managed.data.must("state").schema.use(Count);
void [initial, same, retained, separate, replaced];

const omitted = hsonLiveMap.fromLibraries({ state: { data: { count: 1 } } });
try { omitted.data.must("state").schema.use(Count); } catch {}
// @ts-expect-error Neither a rejected use nor its catch establishes governing proof.
const afterRejectedUse: typeof Count = omitted.data.must("state").schema.get();
const added = omitted.addLibraries({ governed: { data: { count: 2 }, schema: Count } });
const admitted: typeof Count = added.libraries.governed.schema.get();
// @ts-expect-error Initial admission proof still guards subsequent Data mutations.
added.libraries.governed.at(["count"]).set("wrong");
void [afterRejectedUse, admitted];
