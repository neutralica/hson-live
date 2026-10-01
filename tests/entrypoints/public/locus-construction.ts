import { Hson, hsonLocus } from "hson-live";
import { hsonLiveMap, type LiveMapKnownNames } from "hson-live/livemap";
import type { LocusPersistenceAdapter } from "hson-live/locus";

const Count = Hson.schema`<type "data" content <value "number">>`;
const Page = Hson.schema`<type "document" tag "main" content "empty">`;
const definitions = {
  count: { data: { value: 1 }, schema: Count },
  page: { document: "<main/>", schema: Page },
} as const;
const direct = hsonLiveMap.fromLibraries(definitions);
const locus = hsonLocus.create({
  shared: [{ name: "count", definition: definitions.count }],
  private: [{ name: "page", definition: definitions.page }],
  local: [{ name: "ui", initializer: { data: { selected: false } } }],
});
const sameMapType: typeof direct = locus.map;
const knownName: LiveMapKnownNames<typeof locus.map> = "count";
const documentName: LiveMapKnownNames<typeof locus.map> = "page";
// @ts-expect-error Local initializers are absent from authoritative map type evidence.
const localName: LiveMapKnownNames<typeof locus.map> = "ui";
const page = locus.map.lib("page");
if (page.mode !== "document") throw new Error("Library family inference failed.");
void [sameMapType, knownName, documentName, localName, page];
void locus.stage.lib("count").at(["value"]).set(2);
void locus.stage((loc) => { loc.lib("count").at(["value"]).set(3); });
// @ts-expect-error Locus no longer has a separate library admission namespace.
void locus.lib;
// @ts-expect-error Grouped stage callbacks cannot add topology.
void locus.stage((loc) => { loc.addLibraries({ added: { data: 1 } }); });
// @ts-expect-error LiveMap batches cannot add topology.
direct.batch((map) => { map.addLibraries({ added: { data: 1 } }); });
// @ts-expect-error Runtime Locus addition excludes local initializers.
void locus.stage.addLibraries({ local: [{ name: "later", initializer: { data: 1 } }] });
// @ts-expect-error A fresh Locus cannot accept persistence.
void hsonLocus.create({ shared: [{ name: "count", definition: definitions.count }], persistence: {} });
// @ts-expect-error Literal duplicate names are rejected.
void hsonLocus.create({ shared: [{ name: "count", definition: definitions.count }],
  local: [{ name: "count", initializer: { data: 1 } }] });

declare const provider: LocusPersistenceAdapter;
const resumed = await hsonLocus.resume({
  shared: [{ name: "count", definition: definitions.count }],
  private: [{ name: "page", definition: definitions.page }],
  persistence: provider,
});
const resumedName: LiveMapKnownNames<typeof resumed.map> = "page";
void [resumedName, hsonLocus.checkpoint(resumed)];
// @ts-expect-error Checkpointing is a Locus namespace operation.
void resumed.checkpoint;
