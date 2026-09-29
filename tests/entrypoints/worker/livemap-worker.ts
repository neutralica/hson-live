import { ANY_DATA, ANY_DOCUMENT, Hson } from "hson-live/hson";
import {
  hsonLiveMap,
  LiveMapDocumentIdentityProvenanceError,
  LiveMapProjectedIdentityError,
  LiveMapProjectedMutationError,
  type LiveMapSnapshot,
  type LiveMapDocumentIdentityProvenanceErrorCode,
  type LiveMapDocumentInstallFailureCode,
  type LiveMapProjectedIdentityErrorCode,
  type LiveMapProjectedMutationErrorCode,
} from "hson-live/livemap";

const map = hsonLiveMap.fromLibraries({
  state: {
    data: { ready: true, items: [1, 2] },
    schema: Hson.schema`<type "data" content <ready "boolean" items <array "number">>>`,
  },
});
const state = map.lib("state");
void state.snap();
const projectedAcquisitionIsPublic: "ensureIdentity" extends keyof typeof state ? true : false = false;
const capture: LiveMapSnapshot = map.capture();
void projectedAcquisitionIsPublic;
void capture.libraries;
const empty = hsonLiveMap.create();
void empty.capture();
const added = empty.addLibraries({ runtimePage: { document: Hson.document`<main/>` }, runtimeState: { data: 1 } });
void added.operations;
const runtimePage = empty.lib("runtimePage");
if (runtimePage.mode === "document") { void runtimePage.document.root(); void runtimePage.render(); }
const scalar = hsonLiveMap.fromLibraries({ value: { data: 1, schema: ANY_DATA } });
void scalar.lib("value").at([]).asScalar();
void ANY_DOCUMENT.toHson();

const documentMap = hsonLiveMap.fromLibraries({
  page: { document: `<main <button id="target" "Save"/>/>`, schema: Hson.schema`<type "document" tag "main" content <sequence [<tag "button" attrs <props <id "string">> content "string">]>>` },
});
const page = documentMap.lib("page");
if (page.mode === "document") {
  const location = page.at([0]);
  location.watch((next) => { void next; });
  const logicalPath: readonly number[] = location.path();
  void logicalPath;
  void location.rev;
  const discovered = page.at([]).id("target");
  void discovered?.snap();
  const documentAcquisitionIsPublic: "ensureIdentity" extends keyof typeof page.document ? true : false = false;
  void documentAcquisitionIsPublic;
  // @ts-expect-error Data mutation is not a document location operation.
  location.set(page.root());
  // @ts-expect-error Document locations use numeric paths.
  page.at(["content"]);
  page.render();
}
void documentMap.lib("page").render();

// @ts-expect-error Data locations do not provide HTML ID discovery.
state.at([]).id("target");
// @ts-expect-error Data locations do not own document content.
state.at([]).insert(0, true);

const provenanceCode: LiveMapDocumentIdentityProvenanceErrorCode = "FOREIGN_IDENTITY_EPOCH";
const installCode: LiveMapDocumentInstallFailureCode = "DUPLICATE_PRESERVED_CLAIMS";
void new LiveMapDocumentIdentityProvenanceError(provenanceCode, installCode);
const mutationCode: LiveMapProjectedMutationErrorCode = "OBJECT_RENAME_SOURCE_NOT_FOUND";
const identityCode: LiveMapProjectedIdentityErrorCode = "PROJECTED_IDENTITY_INELIGIBLE";
void new LiveMapProjectedMutationError(mutationCode, "rename", [], "proof");
void new LiveMapProjectedIdentityError(identityCode, [], "proof");

const stateCut = documentMap.cut();
void stateCut.libs;
// @ts-expect-error State-only cuts have no HTML.
void stateCut.html;
const selectedCut = documentMap.cut({ data: [], documents: ["page"], html: "page" });
const renderedName: "page" = selectedCut.document;
void renderedName;
// @ts-expect-error A document name cannot select data state.
documentMap.cut({ data: ["page"] });
// @ts-expect-error A data name cannot select document state.
map.cut({ documents: ["state"] });
// @ts-expect-error Data libraries have no document rendering capability.
state.render();

const selections = hsonLiveMap.fromLibraries({
  state: { data: 1 }, page: { document: "<main/>" }, admin: { document: "<aside/>" },
});
const known = selections.cut({ data: ["state"], documents: ["page"], html: "page" });
const knownName: "page" = known.document;
void knownName;
// @ts-expect-error Known document names cannot select data, even alongside unknown names.
selections.cut({ data: ["laterState", "page"] });
// @ts-expect-error Known data names cannot select documents.
selections.cut({ documents: ["state"] });
// @ts-expect-error Known data names cannot select HTML.
selections.cut({ html: "state" });
// @ts-expect-error A literal HTML name must belong to the literal document selection.
selections.cut({ documents: ["admin"], html: "page" });
// @ts-expect-error Empty document selections cannot produce HTML.
selections.cut({ documents: [], html: "page" });
selections.addLibraries({ later: { document: "<section/>" }, laterState: { data: 2 } });
const later = selections.cut({ data: ["laterState"], documents: ["later"], html: "later" });
const laterName: "later" = later.document;
void laterName;
declare const dynamicName: string;
const dynamic = selections.cut({ documents: [dynamicName], html: dynamicName });
const dynamicResult: string = dynamic.document;
void dynamicResult;
const dynamicDocuments: string[] = [dynamicName];
const dynamicSelection = selections.cut({ documents: dynamicDocuments, html: "page" });
const preciseHtml: "page" = dynamicSelection.document;
void preciseHtml;
declare const optionalSelection: import("hson-live/livemap").LiveMapCutOptions;
const optionalCut = selections.cut(optionalSelection);
void optionalCut.libs;
// @ts-expect-error Optional HTML does not guarantee an HTML result.
void optionalCut.html;
