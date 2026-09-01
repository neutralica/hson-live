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
  type LiveMapCapture,
  type LiveMapProjectedIdentityErrorCode,
  type LiveMapProjectedIdentityHandle,
  type LiveMapProjectedMutationErrorCode,
  type LiveMapRenameOp,
} from "hson-live/livemap";
import type { HsonSchema } from "hson-live/hson";

const map = hsonLiveMap.fromJson({ ready: true });
void map.snap();
declare const projectedHandle: LiveMapProjectedIdentityHandle;
const projectedAcquisitionIsPublic: "ensureIdentity" extends keyof typeof map ? true : false = false;
const projectedCapture: LiveMapCapture = map.capture();
void projectedHandle.path();
void projectedAcquisitionIsPublic;
void projectedCapture.root;
void hsonLiveMap.fromHson(`<worker <ready true>>`);
void hsonLiveMap.fromNode(map.root());
declare const workerSchema: HsonSchema;
void map.schema.use(workerSchema);

declare const optionalProjectedMap: LiveMap<Readonly<{ user?: Readonly<{ name: string }> }>>;
const optionalProjectedName: string | undefined = optionalProjectedMap.proxy().user.name.$_.snap();
void optionalProjectedName;

const documentMap = hsonLiveMap.fromHson(`<main @000000v01/>`);
if (documentMap.mode === "document") {
  const documentLocation = documentMap.at([0]);
  const documentEndpoint = documentLocation.at([1]).snap();
  documentLocation.watch((next) => { void next; });
  documentMap.proxy()[0].$_.watch((next) => { void next; });
  const logicalPath: readonly number[] = documentLocation.path();
  void documentEndpoint;
  void logicalPath;
  void documentLocation.rev;
  const documentProxy = documentMap.proxy();
  const documentProxyLocation = documentProxy[0][1].$_;
  const rootedDocumentProxyLocation = documentMap.proxy([0])[1].$_;
  const discoveredDocumentLocation = documentMap.at([]).id("target");
  const proxyDiscoveredDocumentLocation = documentMap.proxy().$_.id("target");
  const replacementCommit = documentLocation.replace(documentMap.root());
  const deletionCommit = documentProxyLocation.delete();
  const insertionCommit = documentMap.at([]).insert(0, documentMap.root());
  const movementCommit = documentMap.proxy().$_.move(0, 1);
  const attrValue = documentLocation.attrs.get("id");
  const attrCommit = documentProxyLocation.attrs.set("title", "worker");
  // @ts-expect-error a missing read does not make undefined valid replacement content
  documentLocation.replace(undefined);
  void documentProxyLocation.snap();
  void rootedDocumentProxyLocation.path();
  void discoveredDocumentLocation?.snap();
  void proxyDiscoveredDocumentLocation?.path();
  void replacementCommit.ops;
  void deletionCommit.ops;
  void insertionCommit.ops;
  void movementCommit.ops;
  void attrValue;
  void attrCommit.ops;
  // @ts-expect-error document proxies expose numeric structural traversal only
  documentProxy.attrs;
  // @ts-expect-error document proxy escapes omit data mutation capabilities
  documentProxyLocation.set(documentMap.root());
  // @ts-expect-error logical document paths do not accept data string keys
  documentMap.at(["content"]);
  // @ts-expect-error document locations intentionally omit data mutation helpers
  documentLocation.set(documentMap.root());
  // @ts-expect-error document locations do not gain projected update semantics
  documentLocation.update(() => documentMap.root());
  // @ts-expect-error document-specific namespaces do not duplicate passive traversal
  documentMap.document.at([0]);
  // @ts-expect-error canonical ID discovery belongs to locations, not the document façade
  documentMap.document.id("target");
  const captureIdentity: DocumentLiveMapCaptureIdentity = "same-epoch";
  const installIdentity: DocumentLiveMapInstallIdentity = "preserve-metadata";
  const capture = documentMap.capture({ identity: captureIdentity });
  documentMap.install(capture, { identity: installIdentity });
  const documentAcquisitionIsPublic: "ensureIdentity" extends keyof typeof documentMap.document ? true : false = false;
  void documentAcquisitionIsPublic;
}

// @ts-expect-error projected locations do not expose HTML ID discovery
map.at([]).id("target");
// @ts-expect-error projected proxy escapes remain data path handles
map.proxy().$_.id("target");
// @ts-expect-error projected locations do not expose document content ownership
map.at([]).insert(0, true);
// @ts-expect-error projected proxy escapes do not expose document attrs
map.proxy().$_.attrs.get("id");

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
