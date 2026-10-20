import { Hson, ANY_DATA, type HsonSchema } from "hson-live/hson";
import { hsonLiveMap, type LiveMapDocumentPart, type LiveMapPartCollection } from "hson-live/livemap";
import type { LocusActionContext } from "hson-live/locus";
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
parts.heading.at(["css"]).snap() satisfies string | undefined;
parts.heading.at(["kind"]).snap() satisfies "document" | undefined;
parts.heading.watch(value => value?.document satisfies string | undefined);
parts.heading.asObject()?.object.keys();
parts.heading.set({ css: "h1{color:red}" });
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
parts.heading.set({ css: {} });
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
void locus.parts.components.heading.set({ css: "" });
void locus.stage(writer => {
  writer.parts.components.heading.replace({ kind: "document", document: "<h3/>" });
  // @ts-expect-error Stages have no observation API.
  writer.parts.components.heading.snap();
});
map.batch(writer => {
  writer.parts.components.heading.set({ css: "" });
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
