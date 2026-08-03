import {
  hsonLiveMap,
  LiveMapDocumentIdentityProvenanceError,
  type DocumentLiveMapCaptureIdentity,
  type DocumentLiveMapInstallIdentity,
  type LiveMapDocumentIdentityProvenanceErrorCode,
  type LiveMapDocumentInstallFailureCode,
} from "hson-live/livemap";

const map = hsonLiveMap.fromJson({ ready: true });
void map.snap();
void hsonLiveMap.fromHson(`<worker <ready true>>`);
void hsonLiveMap.fromNode(map.root());
void hsonLiveMap.schema.define((shape) => ({ ready: shape.boolean }));

const documentMap = hsonLiveMap.fromHson(`<main @0000000000000v01/>`);
if (documentMap.mode === "element") {
  const captureIdentity: DocumentLiveMapCaptureIdentity = "same-epoch";
  const installIdentity: DocumentLiveMapInstallIdentity = "preserve-metadata";
  const capture = documentMap.capture({ identity: captureIdentity });
  documentMap.install(capture, { identity: installIdentity });
}

const provenanceCode: LiveMapDocumentIdentityProvenanceErrorCode = "FOREIGN_IDENTITY_EPOCH";
const installCode: LiveMapDocumentInstallFailureCode = "DUPLICATE_PRESERVED_CLAIMS";
void new LiveMapDocumentIdentityProvenanceError(provenanceCode, installCode);
