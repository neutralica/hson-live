import { Hson, ANY_DATA, type HsonSchema, type HsonAuthored } from "hson-live/hson";
import { hsonLiveMap, type LiveMapDocumentPart, type LiveMapPartCollection, type LiveMapLibraryPathHandle } from "hson-live/livemap";
import type { LocusActionContext, LocusDataLocation, ReadDataLocation } from "hson-live/locus";
import type { Echo } from "hson-live/echo";

const definitions = { components: { parts: {
  heading: { kind: "document", document: Hson.document`<h1/>` },
  submit: { kind: "document", document: Hson.document`<button/>` },
  snap: { kind: "document", document: "<p/>" },
  call: { kind: "document", document: "<p/>" },
  __defineGetter__: { kind: "document", document: "<p/>" },
  then: { kind: "document", document: "<p/>" },
} } } as const;
const map = hsonLiveMap.fromLibraries(definitions);
const parts = map.parts.components;
parts.heading.snap() satisfies LiveMapDocumentPart | undefined;
parts.heading.at(["document"]).snap() satisfies string | undefined;
// @ts-expect-error CSS-field navigation is forbidden on authenticated Parts.
parts.heading.at(["stylesheet"]).snap() satisfies string | undefined;
parts.heading.at(["kind"]).snap() satisfies "document" | undefined;
parts.heading.watch(value => value?.document satisfies string | undefined);
parts.heading.asObject()?.object.keys();
parts.heading.set({ kind: "document", document: "<h1/>", stylesheet: "h1{color:red}" });
parts.heading.replace({ kind: "document", document: "<h2/>" });
parts.heading.delete();
parts.call.snap(); // Parts facades are objects, not functions.
parts.snap() satisfies LiveMapPartCollection;
parts.at(["snap"]).snap() satisfies LiveMapDocumentPart | undefined;
parts.schema.get() satisfies HsonSchema<unknown, "data">;
map.parts.must("components", ANY_DATA).heading.snap();
map.parts("components")?.heading.snap();
// @ts-expect-error Construction names do not promise perpetual presence.
parts.heading.snap() satisfies LiveMapDocumentPart;
// @ts-expect-error No unknown dot-name inventory or broad index signature.
parts.unknown;
// @ts-expect-error A definition cannot render.
parts.heading.render();
parts.heading.must.snap() satisfies LiveMapDocumentPart;
// @ts-expect-error No member-level Schema attachment.
parts.heading.schema.use(ANY_DATA);
// @ts-expect-error Parts cannot attach supplemental Schema.
parts.schema.use(ANY_DATA);
// @ts-expect-error Protocols are not member locations.
parts.then.snap();
// @ts-expect-error Inherited functions are not member locations.
parts.__defineGetter__.snap();
// @ts-expect-error Invalid definition kind.
parts.heading.replace({ kind: "data", document: "<p/>" });
// @ts-expect-error Invalid document source type.
parts.heading.at(["document"]).set(7);
// @ts-expect-error Invalid CSS type.
parts.heading.set({ stylesheet: {} });
// @ts-expect-error Inferred forbidden member Schema remains forbidden.
parts.heading.set({ schema: undefined });
// @ts-expect-error Governed definitions do not invent arbitrary fields.
parts.heading.at(["unknown"]);

declare const optional: { required: LiveMapDocumentPart; maybe?: LiveMapDocumentPart };
const optionalMap = hsonLiveMap.fromLibraries({ components: { parts: optional } });
optionalMap.parts.components.required.snap();
optionalMap.parts.components.maybe?.snap();
// @ts-expect-error Optional construction membership cannot become required selection.
optionalMap.parts.components.maybe.snap();
declare const widened: LiveMapPartCollection;
const broad = hsonLiveMap.fromLibraries({ components: { parts: widened } });
// @ts-expect-error Widened records have no known member names.
broad.parts.components.heading;
broad.parts.components.at(["heading"]).snap() satisfies LiveMapDocumentPart | undefined;
declare const dynamicName: string;
// @ts-expect-error No broad member index signature.
parts[dynamicName];
parts.at([dynamicName]).snap(); // Existing dynamic-path typing remains conservative.
const dynamic = hsonLiveMap.create();
const receipt = dynamic.addLibraries(definitions);
receipt.libraries.components.heading.snap();
// @ts-expect-error Dynamic admission does not mutate original inventory.
dynamic.parts.components;
// @ts-expect-error A dynamic library name cannot recover construction-time members.
dynamic.parts.must("components").heading;

declare const maybeLibrary: { components?: typeof definitions.components };
const uncertain = hsonLiveMap.fromLibraries(maybeLibrary);
// @ts-expect-error Optional library membership cannot guarantee the later binding's names.
uncertain.parts.components?.heading;

const locus = hsonLiveMap.locus.create(definitions);
locus.parts.components.heading.snap() satisfies LiveMapDocumentPart | undefined;
void locus.parts.components.heading.set({ kind: "document", document: "<h1/>", stylesheet: "" });
void locus.stage(writer => {
  writer.parts.components.heading.replace({ kind: "document", document: "<h3/>" });
  // @ts-expect-error Stages have no observation API.
  writer.parts.components.heading.snap();
});
map.batch(writer => {
  writer.parts.components.heading.set({ kind: "document", document: "<h1/>", stylesheet: "" });
  writer.parts.components.heading.asObject().object.setMany({ document: "<h3/>" });
  // @ts-expect-error Stage expiration is not bypassed by standalone document realization.
  writer.parts.components.heading.render();
  // @ts-expect-error Staged writes retain intrinsic definition validation.
  writer.parts.components.heading.set({ schema: undefined });
});
declare const read: LocusActionContext<typeof map>;
read.parts.components.heading.snap() satisfies LiveMapDocumentPart | undefined;
// @ts-expect-error Read-only context has no mutation.
read.parts.components.heading.delete();
// @ts-expect-error Read-only refinements cannot grant mutation.
read.parts.components.heading.asObject()?.object.clear();
declare const echo: Echo<typeof map>;
const echoParts = echo.parts.components;
echoParts.heading.snap() satisfies LiveMapDocumentPart | undefined;
if (echoParts.source === "client-local") {
  echoParts.heading.set({ document: "<h4/>" });
  // @ts-expect-error Client-local Parts cannot gain supplemental Schema attachment.
  echoParts.schema.use(ANY_DATA);
} else {
  // @ts-expect-error Projected Parts cannot gain server-authoritative mutation.
  echoParts.heading.set({ document: "<h4/>" });
}
declare const endpoint: Echo;
// @ts-expect-error Endpoint-only Echo has no Library selection.
endpoint.parts;

parts.heading.write() satisfies HsonAuthored;
parts.heading.write({ content: "Hello", count: 3, enabled: true, empty: null }) satisfies HsonAuthored;
parts.at(["heading"]).write();
parts.at([dynamicName]).write({ ExactCase: "value" });
broad.parts.components.at([dynamicName]).write();
map.parts.must(dynamicName).at([dynamicName]).write();
receipt.libraries.components.heading.write();
locus.parts.components.heading.write();
locus.parts.components.at([dynamicName]).write();
read.parts.components.heading.write();
read.parts.must(dynamicName).at([dynamicName]).write();
echoParts.heading.write();
echo.parts.must(dynamicName).at([dynamicName]).write();
Hson.document`<section ${parts.heading.write()}/>` satisfies HsonAuthored;
// @ts-expect-error Explicit undefined is not a scalar argument record.
parts.heading.write(undefined);
// @ts-expect-error Explicit undefined is not a scalar argument value.
parts.heading.write({ content: undefined });
// @ts-expect-error Structural values are unsupported.
parts.heading.write({ content: {} });
// @ts-expect-error Entire collections have no authoring method.
parts.write();
// @ts-expect-error Collection root locations have no authoring method.
parts.at([]).write();
// @ts-expect-error Nested fields have no authoring method.
parts.at(["heading", "document"]).write();
// @ts-expect-error Nested member fields have no authoring method.
parts.heading.at(["document"]).write();
const ordinary = hsonLiveMap.fromLibraries({ data: { data: { heading: { document: "<h1/>" } } } });
// @ts-expect-error Ordinary data cannot gain Part authoring.
ordinary.data.data.at(["heading"]).write();
map.batch(writer => {
  // @ts-expect-error Write-only stages cannot author invocations.
  writer.parts.components.heading.write();
  // @ts-expect-error Dynamic staged members cannot author invocations.
  writer.parts.must(dynamicName).at([dynamicName]).write();
});
void locus.stage(writer => {
  // @ts-expect-error Locus stages cannot author invocations.
  writer.parts.components.at(["heading"]).write();
});

// Governed coordinates survive refinement; ordinary location authority and absence do too.
const p = parts.heading;
p.write();
p.present()?.write();
p.asObject()?.write();
p.at([]).write();
parts.at([]).at(["heading"]).write();
for (const member of [p, parts.at([dynamicName]), receipt.libraries.components.heading,
  locus.parts.components.heading, locus.parts.components.at([dynamicName]),
  read.parts.components.heading, read.parts.must(dynamicName).at([dynamicName]),
  echoParts.heading, echo.parts.must(dynamicName).at([dynamicName])]) {
  member.present()?.write() satisfies HsonAuthored | undefined;
  member.asObject()?.write() satisfies HsonAuthored | undefined;
  member.at([]).at([]).write() satisfies HsonAuthored;
  member.present()?.asObject()?.at([]).present()?.write();
  member.asObject()?.present()?.at([]).asObject()?.write();
  member.present()?.at(["document"] as const).snap() satisfies string | undefined;
// @ts-expect-error CSS-field navigation is forbidden on authenticated Parts.
  member.asObject()?.at(["stylesheet"] as const).snap() satisfies string | undefined;
  member.asObject()?.object.keys();
  // @ts-expect-error Incompatible array refinement cannot grant Part authoring.
  member.asArray()?.write();
  // @ts-expect-error Incompatible scalar refinement cannot grant Part authoring.
  member.asScalar()?.write();
  // @ts-expect-error Further checks cannot rehabilitate an incompatible refinement.
  member.asArray()?.present()?.asObject()?.write();
  // @ts-expect-error Refinement does not turn a nested field into a whole Part.
  member.present()?.at(["document"]).present()?.write();
  // @ts-expect-error Empty navigation cannot turn a nested field into a whole Part.
  member.asObject()?.at(["stylesheet"]).at([]).write();
  // @ts-expect-error Refinement preserves permitted relative field names.
  member.present()?.at(["unrelated"]);
}
for (const collection of [parts, locus.parts.components, read.parts.components, echoParts,
  map.parts.must(dynamicName), locus.parts.must(dynamicName), read.parts.must(dynamicName), echo.parts.must(dynamicName)]) {
  collection.at([]).at([dynamicName]).present()?.asObject()?.at([]).write();
  collection.at([]).asObject()?.present()?.at([]).at([dynamicName]).asObject()?.write();
  collection.at([]).present()?.at(["notKnown"]).write();
  collection.at([]).at(["heading", "document"] as const).snap() satisfies string | undefined;
  // @ts-expect-error Collection-root refinements are not Part members.
  collection.at([]).asObject()?.present()?.at([]).write();
  // @ts-expect-error Collection navigation does not confer authoring on nested fields.
  collection.at([]).asObject()?.at([dynamicName, "document"]).write();
}
optionalMap.parts.components.maybe?.present()?.asObject()?.at([]).write();
p.present()?.at(["document"]).snap() satisfies string | undefined;
// @ts-expect-error CSS-field navigation is forbidden on authenticated Parts.
locus.parts.components.heading.asObject()?.at(["stylesheet"]).snap() satisfies string | undefined;
read.parts.components.heading.present()?.at(["document"]).snap() satisfies string | undefined;
echoParts.heading.present()?.at(["document"]).snap() satisfies string | undefined;
echoParts.at([]).asObject()?.at([dynamicName]).at(["document"]).snap() satisfies string | undefined;
parts.at([dynamicName]).snap() satisfies LiveMapDocumentPart | undefined;
// @ts-expect-error A dynamic member's incompatible array refinement cannot author a Part.
parts.at([]).at([dynamicName]).asArray()?.write();
optionalMap.parts.components.at([]).at(["maybe"]).present()?.write();
broad.parts.components.at([]).asObject()?.at([dynamicName]).at([]).write();
// @ts-expect-error Refined navigation does not create unknown named inventory.
parts.at([]).asObject()?.heading;
// @ts-expect-error Optional inventory remains optional before refinement.
optionalMap.parts.components.maybe.present()?.write();
const presentPart = p.present(), objectPart = p.asObject();
if (presentPart !== undefined && objectPart !== undefined) {
  presentPart.snap() satisfies LiveMapDocumentPart | undefined;
  objectPart.snap() satisfies LiveMapDocumentPart | undefined;
  // @ts-expect-error Retained checks do not guarantee a perpetually present value.
  presentPart.snap() satisfies LiveMapDocumentPart;
  // @ts-expect-error Object refinement does not strengthen retained optional reads.
  objectPart.snap() satisfies LiveMapDocumentPart;
}
// @ts-expect-error Unknown coordinate reads still permit absence.
parts.at([]).at(["notKnown"]).snap() satisfies LiveMapDocumentPart;
// @ts-expect-error Read-only chains cannot gain mutation authority.
read.parts.components.heading.present()?.asObject()?.at([]).delete();
if (echoParts.source === "authority-projected") {
  echoParts.at([]).at([dynamicName]).present()?.asObject()?.write();
  // @ts-expect-error Projected refined locations retain read-only authority.
  echoParts.heading.asObject()?.at([]).set({ document: "<h1/>" });
} else {
  echoParts.at([]).at([dynamicName]).present()?.asObject()?.write();
  echoParts.heading.asObject()?.at([]).set({ document: "<h1/>" });
}
// @ts-expect-error Ordinary lookalike Data stays ordinary after refinement and empty navigation.
ordinary.data.data.at([]).asObject()?.at(["heading"]).present()?.at([]).write();
const documents = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
// @ts-expect-error Document locations cannot acquire Part authoring.
documents.doc.page.at([]).present()?.asElement()?.at([]).write();
declare const arbitraryPath: readonly string[];
// @ts-expect-error An unknown-depth path cannot promise a whole Part coordinate.
parts.at(arbitraryPath).present()?.at([]).write();
map.batch(writer => {
  // @ts-expect-error Staged root navigation cannot confer detached authoring.
  writer.parts.components.at([]).at([dynamicName]).asObject().at([]).write();
});
void locus.stage(writer => {
  // @ts-expect-error Locus staged refinements remain write-only proposals.
  writer.parts.components.heading.asObject().at([]).write();
});

// Part provenance intentionally prevents widening to unrestricted Data locations.
// @ts-expect-error Generic Data promises unrestricted paths.
const localBase: LiveMapLibraryPathHandle<LiveMapDocumentPart | undefined, "components"> = p;
// @ts-expect-error Generic Data promises unrestricted paths.
const locusBase: LocusDataLocation<LiveMapDocumentPart | undefined> = locus.parts.components.heading;
// @ts-expect-error Generic Data promises unrestricted paths.
const actionBase: ReadDataLocation<LiveMapDocumentPart | undefined> = read.parts.components.heading;
const longPart = p.at([]).at([]).present()?.asObject()?.at([]);
longPart?.write();
// @ts-expect-error Long refinement chains cannot restore CSS paths.
longPart?.at(["css"]);
// @ts-expect-error Read-only contexts retain the same field boundary.
read.parts.components.heading.at(["stylesheet"]);
// @ts-expect-error Both Echo ownership contexts retain the field boundary.
echoParts.heading.at(["css"]);
// @ts-expect-error General-purpose local handles do not promise Part authoring.
localBase.write();
// @ts-expect-error General-purpose Locus handles do not promise Part authoring.
locusBase.at([]).write();
// @ts-expect-error General-purpose read handles do not promise Part authoring.
actionBase.present()?.write();

// HsonData uses the existing string branch of Part.write; no new wrapper or overload.
parts.heading.write({ "data:slide": Hson.data`<title "Visible">`, "data:index": Hson.data`0` }) satisfies HsonAuthored;
