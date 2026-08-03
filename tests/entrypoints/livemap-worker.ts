import {
  hsonLiveMap,
  LiveMapDocumentIdentityProvenanceError,
  LiveMapProjectedMutationError,
  type DocumentLiveMapCaptureIdentity,
  type DocumentLiveMapInstallIdentity,
  type LiveMapDocumentIdentityProvenanceErrorCode,
  type LiveMapDocumentInstallFailureCode,
  type LiveMapMoveOp,
  type LiveMapProjectedMutationErrorCode,
  type LiveMapRenameOp,
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

const renameOp: LiveMapRenameOp | undefined = map.at([]).object.renameKey("ready", "renamed").ops[0] as LiveMapRenameOp;
const moveMap = hsonLiveMap.fromJson({ items: [1, 2] });
const moveOp: LiveMapMoveOp | undefined = moveMap.at(["items"]).array.move(0, 1).ops[0] as LiveMapMoveOp;
const mutationCode: LiveMapProjectedMutationErrorCode = "OBJECT_RENAME_SOURCE_NOT_FOUND";
void renameOp;
void moveOp;
void new LiveMapProjectedMutationError(mutationCode, "rename", [], "proof");
