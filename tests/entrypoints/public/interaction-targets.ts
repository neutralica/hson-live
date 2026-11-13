import { add_interaction, replace_interaction, remove_interaction, type HsonSchema, type InteractionDescriptor } from "hson-live";
import { hsonLiveMap, type LiveMap, type LiveMapStagedWriter } from "hson-live/livemap";
import type { Locus, LocusActionContext } from "hson-live/locus";
import type { Echo, EchoLocalDocumentLibrary, EchoProjectedDocumentLibrary } from "hson-live/echo";

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

declare const localDocument: EchoLocalDocumentLibrary;
declare const projectedDocument: EchoProjectedDocumentLibrary;
const pathElement = concrete.doc.must("page").at([1, 0]).asElement()!;
const pathId: string = pathElement.listen.local.onClick("panel.toggle", -0);
const quadId: string = concrete.doc.must("page").q("panel")!.listen.host.onClick("deck.advance", null);
const governedPathId: Promise<string> = governed.doc.must("page").at([1, 0]).asElement()!.listen.host.onClick("deck.advance", {});
const governedQuadId: Promise<string> = governed.doc.must("page").q("panel")!.listen.local.onClick("panel.toggle", []);
const localPathId: string = localDocument.at([1, 0]).asElement()!.listen.local.onClick("panel.toggle", true);
const localQuadId: string = localDocument.q("panel")!.listen.host.onClick("deck.advance", null);
void [pathId, quadId, governedPathId, governedQuadId, localPathId, localQuadId];
// @ts-expect-error Canonical click input is required.
pathElement.listen.local.onClick("panel.toggle");
// @ts-expect-error Canonical authoring returns the Descriptor ID.
pathId.off();
// @ts-expect-error Path locations have no QUAD scope lookup.
pathElement.q("panel");
// @ts-expect-error A text refinement exposes no element listener.
concrete.doc.must("page").at([1, 0]).asText()!.listen;
// @ts-expect-error An Echo-local text refinement exposes no element listener.
localDocument.at([1, 0]).asText()!.listen;
// @ts-expect-error A Locus text refinement exposes no element listener.
governed.doc.must("page").at([1, 0]).asText()!.listen;
// @ts-expect-error A projected element has no Descriptor write surface.
projectedDocument.at([1, 0]).asElement()!.listen;
// @ts-expect-error A projected QUAD stays read-only.
projectedDocument.q("panel")!.listen;
// @ts-expect-error Action-context element reads have no write authority.
action.doc.must("page").at([1, 0]).asElement()!.listen;
// @ts-expect-error Action-context QUADs stay read-only.
action.doc.must("page").q("panel")!.listen;
// @ts-expect-error A staged writer has no selected listener authoring.
writer.doc.must("page").at([1, 0]).asElement().listen;

type PageGraph = Readonly<{
  $_tag: "_hson_root";
  $_content: readonly [Readonly<{ $_tag: "main"; $_content: readonly [] }>];
}>;
declare const pageSchema: HsonSchema<PageGraph, "document">;
declare const preciseEcho: EchoLocalDocumentLibrary<PageGraph, typeof pageSchema>;
const preciseDefinition = { page: { document: "<main/>", schema: pageSchema } };
const preciseStandalone = hsonLiveMap.fromLibraries(preciseDefinition).doc.must("page").at([]);
const preciseLocus = hsonLiveMap.locus.create(preciseDefinition).doc.must("page").at([]);
const preciseLocal = preciseEcho.at([]);

preciseStandalone.listen.local.onClick("toggle", null) satisfies string;
preciseLocus.listen.host.onClick("advance", null) satisfies Promise<string>;
preciseLocal.listen.local.onClick("toggle", null) satisfies string;
preciseStandalone.asElement()!.listen.local.onClick("toggle", null) satisfies string;
preciseLocus.asElement()!.listen.host.onClick("advance", null) satisfies Promise<string>;
preciseLocal.asElement()!.listen.local.onClick("toggle", null) satisfies string;
// @ts-expect-error A text refinement of an element coordinate exposes no listener.
preciseStandalone.asText()!.listen;
// @ts-expect-error A precise Locus text refinement exposes no listener.
preciseLocus.asText()!.listen;
// @ts-expect-error A precise Echo-local text refinement exposes no listener.
preciseLocal.asText()!.listen;
// @ts-expect-error A presence check preserves the text refinement.
preciseStandalone.asText()!.present()!.listen;
// @ts-expect-error A presence check preserves the text refinement.
preciseLocus.asText()!.present()!.listen;
// @ts-expect-error A presence check preserves the text refinement.
preciseLocal.asText()!.present()!.listen;
