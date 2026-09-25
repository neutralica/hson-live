import { Hson } from "hson-live/hson";
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
  const documentCapture = page.capture();
  void documentCapture;
  const documentAcquisitionIsPublic: "ensureIdentity" extends keyof typeof page.document ? true : false = false;
  void documentAcquisitionIsPublic;
  // @ts-expect-error Data mutation is not a document location operation.
  location.set(page.root());
  // @ts-expect-error Document locations use numeric paths.
  page.at(["content"]);
  // @ts-expect-error Rendering is owned by the registry.
  page.render();
}
void documentMap.render();

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
