import {
  ANY_DOCUMENT, Hson, continue_document, hsonLiveMap, hsonMirror,
  type DocumentContinuation, type HsonDocument, type HsonSchema,
} from "hson-live";
import type {
  LiveMapDocumentBindingSource, LiveMapDocumentLibrary,
} from "hson-live/livemap";
import { reflect_document, type DocumentMirror } from "hson-live/mirror";
import type { LocusDocumentLibrary } from "hson-live/locus";
import type { EchoLocalDocumentLibrary, EchoProjectedDocumentLibrary } from "hson-live/echo";

// The original consumer failure: inferred, Schema-free, public construction/selection.
const libraries = hsonLiveMap.fromLibraries({
  page: { document: '<main "Ready"/>' },
  authored: { document: Hson.document`<main "Ready"/>` },
  state: { json: { count: 0 } },
  components: { parts: { button: { kind: "document", document: "<button/>" } } },
});
const page = libraries.doc.must("page");
reflect_document(page) satisfies DocumentMirror;
reflect_document(libraries.doc.page);
reflect_document(libraries.doc.must("authored"));
const optional = libraries.doc("page");
if (optional !== undefined) reflect_document(optional);
hsonMirror(page);

// Preserve the previously passing Schema-backed and explicitly annotated forms.
const schematized = hsonLiveMap.fromLibraries({
  page: { document: '<main "Ready"/>', schema: Hson.schema`<type "document" tag "main" content "string">` },
});
reflect_document(schematized.doc.must("page"));
declare const legacy: LiveMapDocumentLibrary;
declare const unknownEvidence: LiveMapDocumentLibrary<unknown, "page">;
type DocumentNode = ReturnType<LiveMapDocumentLibrary["root"]>;
declare const broadEvidence: LiveMapDocumentLibrary<DocumentNode, "page", typeof ANY_DOCUMENT>;
reflect_document(legacy);
reflect_document(unknownEvidence);
reflect_document(broadEvidence);

// A precise materialized graph and independent Schema identity, as supplied by
// the Schema compiler. Reflection must neither demand nor manufacture this proof.
type PageGraph = Readonly<{
  $_tag: "_hson_root";
  $_content: readonly [Readonly<{
    $_tag: "main";
    $_content: readonly [Readonly<{ $_tag: "_hson_str"; $_content: readonly [string] }>];
  }>];
}>;
declare const pageIdentity: unique symbol;
declare const otherIdentity: unique symbol;
declare const Page: HsonSchema<PageGraph, "document", typeof pageIdentity>;
declare const Other: HsonSchema<PageGraph, "document", typeof otherIdentity>;
const preciseLibraries = hsonLiveMap.fromLibraries({
  page: { document: '<main "Ready"/>', schema: Page },
});
const precise = preciseLibraries.doc.must("page");
reflect_document(precise);
hsonMirror(precise);
precise.schema.get() satisfies typeof Page;
const certified: HsonDocument<typeof Page> = Page.certify(Hson.document`<main "Ready"/>`);
void certified;

function reflect<TDocument extends LiveMapDocumentBindingSource>(document: TDocument): TDocument {
  reflect_document(document);
  return document;
}
reflect(page) satisfies typeof page;
reflect<typeof precise>(precise) satisfies typeof precise;

// Continuation retains the selected handle, including its Schema and refinements.
declare const root: Element;
const continued = continue_document({ map: libraries, document: page, root });
continued.map satisfies typeof page;
continued satisfies DocumentContinuation<typeof page>;
const preciseContinuation = continue_document<typeof precise>({ map: preciseLibraries, document: precise, root });
preciseContinuation.map.schema.get() satisfies typeof Page;
preciseContinuation.map.at([0]).replace("next");
continue_document({ map: libraries, root }) satisfies DocumentContinuation;

// Reflection leaves logical endpoint/refinement and mutation constraints intact.
page.at([]).asElement()?.attrs.set("title", "next");
precise.at([]).asElement()?.insert(0, "next");
precise.at([0]).replace("next");
precise.proxy([0]).$_.replace("next");
// @ts-expect-error A text endpoint cannot be replaced with an element.
precise.at([0]).replace({ $_tag: "p", $_content: [] });
// @ts-expect-error An element's text insertion does not accept an object.
precise.at([]).asElement()?.insert(0, {});
// @ts-expect-error A known text endpoint has no element attributes.
precise.at([0]).attrs.set("title", "next");
// @ts-expect-error Broad logical descendants retain their narrower replacement domain.
page.at([0]).at([0]).replace(null);
// @ts-expect-error Broad logical descendants do not accept numeric replacements.
page.at([0]).replace(123);
// @ts-expect-error Attribute values must be supported public attribute values.
page.at([]).asElement()?.attrs.set("title", []);
// @ts-expect-error Precise paths still reject an impossible child.
precise.at([1]);
// @ts-expect-error Reflection cannot widen the governing Schema.
precise.schema.use(ANY_DOCUMENT);
// @ts-expect-error Matching graph shapes do not establish Schema identity.
precise.schema.use(Other);
// @ts-expect-error A broad handle does not prove this exact Schema.
const forged: typeof precise = page;
// @ts-expect-error Ordinary authored text lacks certification by Page.
const unproved: HsonDocument<typeof Page> = Hson.document`<main "Ready"/>`;
// @ts-expect-error Certification for another identity does not prove Page.
const wrongProof: HsonDocument<typeof Page> = Other.certify(Hson.document`<main "Ready"/>`);
// @ts-expect-error Continuation preserves text replacement constraints.
preciseContinuation.map.at([0]).replace(false);

// Incompatible families, locations, and incomplete structural lookalikes reject.
// @ts-expect-error Data is not a Document Library.
reflect_document(libraries.data.must("state"));
// @ts-expect-error Parts is not a Document Library.
reflect_document(libraries.parts.must("components"));
// @ts-expect-error A document location is not a selected Document Library.
reflect_document(page.at([]));
// @ts-expect-error Reflection requires canonical document edits and observations.
reflect_document({ mode: "document", root: page.root });
// @ts-expect-error Primitive values lack Document capabilities.
reflect_document("page");
// @ts-expect-error An aggregate is not a selected Document Library.
hsonMirror(libraries);
// @ts-expect-error Data cannot be passed to the Mirror facade.
hsonMirror(libraries.data.must("state"));
// @ts-expect-error Parts cannot be continued as a Document.
continue_document({ map: libraries, document: libraries.parts.must("components"), root });

// Governed handles must still go through the facade's authority-aware selection.
declare const locus: LocusDocumentLibrary;
declare const projected: EchoProjectedDocumentLibrary;
declare const local: EchoLocalDocumentLibrary;
hsonMirror(locus);
hsonMirror(projected);
hsonMirror(local);
declare const preciseLocus: LocusDocumentLibrary<PageGraph, typeof Page>;
declare const preciseProjected: EchoProjectedDocumentLibrary<PageGraph, typeof Page>;
declare const preciseLocal: EchoLocalDocumentLibrary<PageGraph, typeof Page>;
hsonMirror(preciseLocus);
hsonMirror(preciseProjected);
hsonMirror(preciseLocal);
preciseProjected.schema.get() satisfies typeof Page;
preciseLocal.schema.get() satisfies typeof Page;
// @ts-expect-error Projected Schema access remains read-only after reflection.
preciseProjected.schema.use(Page);
// @ts-expect-error Local Echo Schema identity remains precise after reflection.
preciseLocal.schema.use(Other);
// @ts-expect-error Asynchronous Locus writes are not direct canonical edits.
reflect_document(locus);
// @ts-expect-error Authority-projected Echo writes are not direct canonical edits.
reflect_document(projected);
// @ts-expect-error Local Echo wrappers also require canonical selection by the facade.
reflect_document(local);
// @ts-expect-error Read-only Schema access cannot gain mutation authority.
locus.schema.use(Page);

void [forged, unproved, wrongProof];
