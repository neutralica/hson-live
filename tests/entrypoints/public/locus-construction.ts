import { Hson } from "hson-live/hson";
import * as hsonLiveMap from "hson-live/livemap";

import type { LocusActionContext, LocusPersistenceAdapter } from "hson-live/locus";
import type { HsonSchema } from "hson-live";

const Count = Hson.schema`<type "data" content <value "number">>`;
const Page = Hson.schema`<type "document" tag "main" content "empty">`;
const sheet: string = "main { display: block; }";
const definitions = {
  count: { data: { value: 1 }, schema: Count },
  page: { document: "<main/>", schema: Page },
} as const;
const direct = hsonLiveMap.fromLibraries(definitions);
const locus = hsonLiveMap.locus.create({
  shared: [{ name: "count", definition: definitions.count }],
  private: [{ name: "page", definition: definitions.page, css: sheet }],
  local: [{ name: "ui", initializer: { data: { selected: false } } }],
});
const knownName = locus.data.must("count");
const documentName = locus.doc.must("page");
const noPublicMap: "map" extends keyof typeof locus ? true : false = false;
const page = locus.doc.must("page");
if (page.mode !== "document") throw new Error("Library family inference failed.");
void [knownName, documentName, page, noPublicMap];
declare const ctx: LocusActionContext<typeof direct>;
const actionPage = ctx.doc.must("page");
const actionPageMode: "document" = actionPage.mode;
const actionPageSchema: typeof Page = actionPage.schema.get();
void [actionPageMode, actionPageSchema, actionPage.render(), actionPage.css.snapshot()];
// @ts-expect-error Action-context document reads cannot mutate CSS.
actionPage.css.stylesheet(sheet);
// @ts-expect-error Action-context document reads cannot attach a Schema.
actionPage.schema.use(Page);
const actionCount = ctx.data.must("count");
const actionCountSchema: typeof Count = actionCount.schema.get();
void [actionCountSchema, actionCount.snap(["value"])];
// @ts-expect-error Known data reads have no document render capability.
actionCount.render();
// @ts-expect-error Action-context data reads cannot mutate data.
actionCount.at(["value"]).set(2);
declare const dynamicName: string;
const dynamicRead = ctx.data.must(dynamicName);
// @ts-expect-error Dynamic names require mode narrowing for document reads.
dynamicRead.render();
ctx.doc.must(dynamicName).render();
declare const RefinedPage: HsonSchema<{ readonly title: string }, "document">;
const refinedMap = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: RefinedPage } });
declare const refinedCtx: LocusActionContext<typeof refinedMap>;
const refinedRead = refinedCtx.doc.must("page");
const refinedSchema: HsonSchema<{ readonly title: string }, "document"> = refinedRead.schema.get();
void refinedSchema;
void locus.data.must("count").at(["value"]).set(2);
void locus.doc.must("page").css.stylesheet(sheet);
void locus.doc.must("page").css({ domain: "css", kind: "clear-all" });
void locus.addLibraries({ shared: [{ name: "laterPage", definition: definitions.page, css: sheet }] });
// @ts-expect-error Data Libraries have no CSS handle.
void locus.data.must("count").css;
// @ts-expect-error Data Library construction cannot carry CSS.
void hsonLiveMap.locus.create({ shared: [{ name: "bad", definition: definitions.count, css: sheet }] });
// @ts-expect-error Data Library stage admission cannot carry CSS.
void locus.addLibraries({ shared: [{ name: "bad", definition: definitions.count, css: sheet }] });
void locus.stage((loc) => { loc.data.must("count").at(["value"]).set(3); });
const noStageLib: "lib" extends keyof typeof locus.stage ? true : false = false;
const noStageAdmission: "addLibraries" extends keyof typeof locus.stage ? true : false = false;
void [noStageLib, noStageAdmission];
// @ts-expect-error Grouped stage callbacks cannot add topology.
void locus.stage((loc) => { loc.addLibraries({ added: { data: 1 } }); });
// @ts-expect-error LiveMap batches cannot add topology.
direct.batch((map) => { map.addLibraries({ added: { data: 1 } }); });
// @ts-expect-error Runtime Locus addition excludes local initializers.
void locus.addLibraries({ local: [{ name: "later", initializer: { data: 1 } }] });
// @ts-expect-error A fresh Locus cannot accept persistence.
void hsonLiveMap.locus.create({ shared: [{ name: "count", definition: definitions.count }], persistence: {} });
// @ts-expect-error Literal duplicate names are rejected.
void hsonLiveMap.locus.create({ shared: [{ name: "count", definition: definitions.count }],
  local: [{ name: "count", initializer: { data: 1 } }] });

declare const provider: LocusPersistenceAdapter;
// @ts-expect-error Durable resume requires a stable logicalMapId.
void hsonLiveMap.locus.resume({ shared: [{ name: "count", definition: definitions.count }], persistence: provider });
const resumed = await hsonLiveMap.locus.resume({
  shared: [{ name: "count", definition: definitions.count }],
  private: [{ name: "page", definition: definitions.page, css: sheet }],
  logicalMapId: "locus-construction-entrypoint",
  persistence: provider,
});
const resumedName = resumed.doc.must("page");
void [resumedName, hsonLiveMap.locus.checkpoint(resumed)];
// @ts-expect-error Checkpointing is a Locus namespace operation.
void resumed.checkpoint;
