import { hsonLiveMap } from "hson-live/livemap";
import type { LocusActionContext } from "hson-live/locus";
import type { EchoLibrary } from "hson-live/echo";
import { firstSchema } from "./fixtures/hson-schema-document/out/deck.js";
const definition = { document: '<html <head/> <body/>/>', schema: firstSchema };
const map = hsonLiveMap.fromLibraries({ page: definition });
const locus = hsonLiveMap.locus.create({ "page": { ...definition, access: "shared" } });
locus.doc.must("page").at([1]).attrs.setMany({ title: "yes" }) satisfies Promise<void>;
locus.doc.must("page").at([1]).flags.set("hidden") satisfies Promise<void>;
locus.doc.must("page").at([1]).attrs.must.get("title");
locus.doc.must("page").at([]).at([1]).attrs.dropMany(["title"]);
// @ts-expect-error Known document paths retain Schema evidence.
locus.doc.must("page").at([2]);
// @ts-expect-error Known nested paths retain Schema evidence.
locus.doc.must("page").at([]).at([2]);
locus.doc.must("page").css.media({ minWidth: 400 }).sel("body").setProp("color", "red") satisfies Promise<void>;
locus.doc.must("page").css.var.value("accent") satisfies string | undefined;
locus.doc.must("page").css.atProperty.register({ name: "--tone", syn: "<color>", init: "red" }) satisfies Promise<void>;
map.batch(writer => {
  writer.doc.must("page").at([1]).attrs.setMany({ title: "yes" }) satisfies void;
  writer.doc.must("page").at([1]).attrs.clear() satisfies void;
  writer.doc.must("page").at([1]).flags.clear("hidden") satisfies void;
  writer.doc.must("page").css.sel("body").setMany({ color: "red" }) satisfies void;
  writer.doc.must("page").at([1, 99]).asElement().attrs.setMany({ title: "checked at admission" });
  // @ts-expect-error Commands cannot observe a staged graph.
  writer.doc.must("page").at([1]).snap();
  // @ts-expect-error Commands cannot observe attributes.
  writer.doc.must("page").at([1]).attrs.get("title");
  // @ts-expect-error Commands cannot observe flags.
  writer.doc.must("page").at([1]).flags.has("hidden");
  // @ts-expect-error Commands cannot observe a staged stylesheet.
  writer.doc.must("page").css.snapshot();
  // @ts-expect-error Commands cannot observe staged custom properties.
  writer.doc.must("page").css.var.value("accent");
});
declare const context: LocusActionContext<typeof map>;
context.doc.must("page").at([1]).attrs.must.get("title");
context.doc.must("page").at([1]).flags.has("hidden");
context.doc.must("page").document.attrs.must.get({ kind: "path", path: [] }, "title");
context.doc.must("page").css.atProperty.get("--tone");
// @ts-expect-error Read-only action document attributes cannot mutate.
context.doc.must("page").at([1]).attrs.clear();
// @ts-expect-error Read-only action flags cannot mutate.
context.doc.must("page").at([1]).flags.set("hidden");
// @ts-expect-error Navigation/refinement cannot gain write authority.
context.doc.must("page").at([]).id("button")?.asElement()?.attrs.setMany({ title: "no" });
// @ts-expect-error Root-level read-only attrs cannot mutate.
context.doc.must("page").document.attrs.replace({ kind: "path", path: [] }, {});
// @ts-expect-error Read-only CSS custom properties cannot mutate.
context.doc.must("page").css.var.set("accent", "red");
// @ts-expect-error Read-only CSS keyframes cannot mutate.
context.doc.must("page").css.keyframes.delete("spin");
// @ts-expect-error Read-only CSS does not acquire rule writers.
context.doc.must("page").css.sel("body");
declare const echo: EchoLibrary;
if (echo.mode === "document") {
  echo.at([]).asElement()?.flags.has("hidden");
  if (echo.source === "authority-projected") {
    echo.at([]).asElement()?.attrs.setMany({ title: "governed request" }) satisfies Promise<void> | undefined;
    echo.at([]).asElement()?.flags.set("hidden") satisfies Promise<void> | undefined;
    echo.css.atProperty.register({ name: "--tone", syn: "<color>", init: "red" }) satisfies Promise<void>;
    echo.css.keyframes.delete("fade") satisfies Promise<void>;
    // @ts-expect-error No conditional remote flag-clear protocol exists.
    echo.at([]).asElement()?.flags.clear("hidden");
    // @ts-expect-error Projected CSS does not gain direct per-property write authority.
    echo.css.var.set("accent", "red");
    // @ts-expect-error Projected schema is read-only.
    echo.schema.use(firstSchema);
  } else {
    echo.at([]).asElement()?.flags.set("hidden");
    echo.css.sel("body").setProp("color", "red") satisfies void;
  }
}
async function admission() {
  await locus.admit({ "added": { ...definition, access: "private" } });
  locus.doc.must("added", firstSchema).at([1]).attrs.clear();
  locus.doc.must("added", firstSchema).css.sel("body").setProp("color", "red");
  // @ts-expect-error Dynamic admission preserves exact document Schema paths.
  locus.doc.must("added", firstSchema).at([2]);
  const optional: { maybe?: typeof definition } = {};
  const local = map.addLibraries(optional);
  // @ts-expect-error An optional receipt entry does not guarantee admission.
  local.libraries.maybe.at([1]);
  local.libraries.maybe?.at([1]).attrs.clear();
}

// Broad and dynamically discovered endpoints require a shape check before element observations.
const broad = hsonLiveMap.locus.create({ "page": { document: "<main/>", access: "shared" } });
// @ts-expect-error An untyped location does not certify an element.
broad.doc.must("page").at([]).attrs.get("title");
// @ts-expect-error ID discovery is optional and does not certify an element.
broad.doc.must("page").at([]).id("button")?.flags.has("checked");
broad.doc.must("page").at([]).asElement()?.attrs.must.get("title");


import { PageSchema } from "./fixtures/hson-schema-document/out/producer.js";
const strict = hsonLiveMap.locus.create({ "page": { document: '<main id="hero" <section "body"/>/>', schema: PageSchema, access: "shared" } });
// Generated graph evidence retains document shape; attribute rules are validated at admission,
// matching local LiveMap's materialized-graph evidence contract.
strict.doc.must("page").at([]).attrs.setMany({ id: "next", hidden: "hidden" });
strict.doc.must("page").at([]).flags.set("hidden");
strict.stage(writer => {
  writer.doc.must("page").at([]).flags.clear("hidden");
  writer.doc.must("page").at([0, 0]).asText();
  // @ts-expect-error Known text locations cannot acquire element commands without refinement.
  writer.doc.must("page").at([0, 0]).attrs.clear();
});
// @ts-expect-error Known text locations do not expose element attributes.
strict.doc.must("page").at([0, 0]).attrs.get("id");
map.batch(writer => {
  // @ts-expect-error A broad indexed child may be absent and requires refinement.
  writer.doc.must("page").at([1, 99]).attrs.clear();
  writer.doc.must("page").at([1, 99]).asElement().attrs.clear();
  writer.doc.must("page").attrs.setMany({ kind: "path", path: [0, 0, 1] }, { title: "target" });
});


locus.doc.must("page").q("button")?.attrs.setMany({ title: "governed" }) satisfies Promise<void> | undefined;
context.doc.must("page").q("button")?.flags.has("checked");
// @ts-expect-error Identity selection cannot add write authority to a read-only context.
context.doc.must("page").q("button")?.attrs.clear();
// @ts-expect-error Chained scoped q selection is not part of P4.
locus.doc.must("page").q("panel")?.q("button");
if (echo.mode === "document" && echo.source === "authority-projected") {
  echo.q("button")?.attrs.must.get("title");
  // @ts-expect-error Projected identity capabilities expose observations only.
  echo.q("button")?.delete();
}


broad.stage(writer => {
  // @ts-expect-error An unschematized root does not certify an element.
  writer.doc.must("page").at([]).attrs.clear();
  writer.doc.must("page").at([]).asElement().attrs.clear();
});
