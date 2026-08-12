import {
  hsonLiveMap,
  LiveMapDocumentIdentityProvenanceError,
  LiveMapProjectedIdentityError,
  LiveMapProjectedMutationError,
  type DocumentLiveMapCaptureIdentity,
  type DocumentLiveMapInstallIdentity,
  type LiveMapDocumentIdentityProvenanceErrorCode,
  type LiveMapDocumentInstallFailureCode,
  type LiveMapMoveOp,
  type LiveMap,
  type LiveMapCanonicalCapture,
  type LiveMapProjectedIdentityErrorCode,
  type LiveMapProjectedIdentityHandle,
  type LiveMapProjectedMutationErrorCode,
  type LiveMapRenameOp,
} from "hson-live/livemap";

const map = hsonLiveMap.fromJson({ ready: true });
void map.snap();
declare const projectedHandle: LiveMapProjectedIdentityHandle;
const projectedAcquisitionIsPublic: "ensureIdentity" extends keyof typeof map ? true : false = false;
const projectedCapture: LiveMapCanonicalCapture = map.capture();
void projectedHandle.path();
void projectedAcquisitionIsPublic;
void projectedCapture.root;
void hsonLiveMap.fromHson(`<worker <ready true>>`);
void hsonLiveMap.fromNode(map.root());
void hsonLiveMap.schema.define((shape) => ({ ready: shape.boolean }));

declare const optionalProjectedMap: LiveMap<Readonly<{ user?: Readonly<{ name: string }> }>>;
const optionalProjectedName: string | undefined = optionalProjectedMap.proxy().user.name.$_.snap();
void optionalProjectedName;

const documentMap = hsonLiveMap.fromHson(`<main @000000v01/>`);
if (documentMap.mode === "element") {
  const documentLocation = documentMap.at([0]);
  const documentEndpoint = documentLocation.at([1]).snap();
  const logicalPath: readonly number[] = documentLocation.path();
  void documentEndpoint;
  void logicalPath;
  void documentLocation.rev;
  const documentProxy = documentMap.proxy();
  const documentProxyLocation = documentProxy[0][1].$_;
  const rootedDocumentProxyLocation = documentMap.proxy([0])[1].$_;
  void documentProxyLocation.snap();
  void rootedDocumentProxyLocation.path();
  // @ts-expect-error document proxies expose numeric structural traversal only
  documentProxy.attrs;
  // @ts-expect-error document proxy escapes omit projected mutation capabilities
  documentProxyLocation.set(documentMap.element.node());
  // @ts-expect-error logical document paths do not accept projected string keys
  documentMap.at(["content"]);
  // @ts-expect-error document locations intentionally omit projected mutation helpers
  documentLocation.set(documentMap.element.node());
  // @ts-expect-error document-specific namespaces do not duplicate passive traversal
  documentMap.document.at([0]);
  const captureIdentity: DocumentLiveMapCaptureIdentity = "same-epoch";
  const installIdentity: DocumentLiveMapInstallIdentity = "preserve-metadata";
  const capture = documentMap.capture({ identity: captureIdentity });
  documentMap.install(capture, { identity: installIdentity });
  const documentAcquisitionIsPublic: "ensureIdentity" extends keyof typeof documentMap.document ? true : false = false;
  void documentAcquisitionIsPublic;
}

const provenanceCode: LiveMapDocumentIdentityProvenanceErrorCode = "FOREIGN_IDENTITY_EPOCH";
const installCode: LiveMapDocumentInstallFailureCode = "DUPLICATE_PRESERVED_CLAIMS";
void new LiveMapDocumentIdentityProvenanceError(provenanceCode, installCode);

const renameOp: LiveMapRenameOp | undefined = map.at([]).object.renameKey("ready", "renamed").ops[0] as LiveMapRenameOp;
const moveMap = hsonLiveMap.fromJson({ items: [1, 2] });
const moveOp: LiveMapMoveOp | undefined = moveMap.at(["items"]).array.move(0, 1).ops[0] as LiveMapMoveOp;
const mutationCode: LiveMapProjectedMutationErrorCode = "OBJECT_RENAME_SOURCE_NOT_FOUND";
const identityCode: LiveMapProjectedIdentityErrorCode = "PROJECTED_IDENTITY_INELIGIBLE";
void renameOp;
void moveOp;
void new LiveMapProjectedMutationError(mutationCode, "rename", [], "proof");
void new LiveMapProjectedIdentityError(identityCode, [], "proof");
