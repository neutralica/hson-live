// index.ts

export { Hson } from "./hson-authoring.js";
export { hson, hsonCalc, hsonLocus, hsonTransform, hsonLiveMap, hsonLiveTree, hsonInspect, type HsonFacade } from "./hson.js";
export type {
    BinaryDecodeOptions,
    TransformBinarySerialize,
    HsonSchema,
} from "./api/transform/transform.types.js";
export {
    TransformError,
    is_transform_error,
    read_transform_error_details,
} from "./core/errors.js";
export type {
    TransformErrorDetails,
    TransformErrorRelated,
    TransformErrorSource,
} from "./core/errors.js";
export {
    HSON_NUMBER_NONFINITE,
    HSON_NUMBER_TYPE_REQUIRED,
    type HsonNumber,
} from "./api/transform/hson-number.js";
export { hsonReflect, type Reflect } from "./api/reflect/reflect.facade.js";
export { LiveTree } from "./api/livetree/livetree.js";
export {
    LIVETREE_ALREADY_ATTACHED_ERROR_CODE,
    LIVETREE_DISPOSED_ERROR_CODE,
    LIVETREE_PROTECTED_ROOT_ERROR_CODE,
    LIVETREE_BATCH_ATTACHMENT_ERROR_CODE,
    LIVETREE_BATCH_VALIDATION_ERROR_CODE,
    LIVETREE_ATTRIBUTE_NOT_FOUND_ERROR_CODE,
    LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE,
    LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE,
    LIVETREE_PROTECTED_ATTRIBUTE_ERROR_CODE,
    LIVETREE_QUID_REUSE_ERROR_CODE,
    LiveTreeAttributeError,
    LiveTreeBatchError,
    LiveTreeAlreadyAttachedError,
    LiveTreeDisposedError,
    LiveTreeProtectedRootError,
    LiveTreeQuidReuseError,
} from "./api/livetree/livetree.error.js";
export {
    LIVETREE_LINKED_IDENTITY_REQUIRED_ERROR_CODE,
    LiveTreeLinkedIdentityRequiredError,
} from "./api/livetree/lifecycle/document-binding-state.js";
export type { LiveTreeAttributeErrorCode } from "./api/livetree/livetree.error.js";
export type { DetachedLiveContent, LiveTreeLifecycleResult } from "./types/lifecycle.types.js";
export { CssManager } from "./api/livetree/managers/css-manager.js";
export { make_tree_selector } from "./api/livetree/creation/make-tree-selector.js";
export { TreeSelector } from "./api/livetree/creation/tree-selector.js";

export { make_livemap_core } from "./api/livemap/livemap.core.js";
export { reflect_collection } from "./api/reflect/reflect.collection.js";
export {
    reflect_document,
    type DocumentReflect,
    type DocumentReflectStatus,
} from "./api/reflect/reflect.document.js";
export * from "./api/reflect/reflect.document.error.js";
export { create_live_inspector } from "./api/inspect/liveinspect.js";
export {
    LIVE_INSPECTOR_DISPOSED_ERROR_CODE,
    LIVE_INSPECTOR_DUPLICATE_ARRAY_KEY_ERROR_CODE,
    LIVE_INSPECTOR_EXPAND_LIMIT_ERROR_CODE,
    LIVE_INSPECTOR_INVALID_PATH_ERROR_CODE,
    LIVE_INSPECTOR_INVALID_ROOT_ERROR_CODE,
    LIVE_INSPECTOR_MISSING_ARRAY_KEY_ERROR_CODE,
    LIVE_INSPECTOR_NON_STRUCTURAL_EXPANSION_ERROR_CODE,
    LIVE_INSPECTOR_OBSERVER_ERROR_CODE,
    LIVE_INSPECTOR_PROJECTION_ERROR_CODE,
    LIVE_INSPECTOR_RENDERER_HOOK_ERROR_CODE,
    LIVE_INSPECTOR_SOURCE_REPLACEMENT_ERROR_CODE,
    LIVE_INSPECTOR_SPECIALIZATION_ERROR_CODE,
    LIVE_INSPECTOR_UNREPRESENTABLE_CONVERSION_ERROR_CODE,
    LIVE_INSPECTOR_UNSUPPORTED_SERIALIZATION_ERROR_CODE,
    LIVE_INSPECTOR_UNSUPPORTED_SOURCE_ERROR_CODE,
    LiveInspectorError,
} from "./api/inspect/liveinspect.error.js";
export type { LiveInspectorErrorCode } from "./api/inspect/liveinspect.error.js";
export {
    COLLECTION_REFLECT_BRANCH_ATTACHED_ERROR_CODE,
    COLLECTION_REFLECT_DISPOSED_ERROR_CODE,
    COLLECTION_REFLECT_DUPLICATE_KEY_ERROR_CODE,
    COLLECTION_REFLECT_HOST_NOT_EMPTY_ERROR_CODE,
    COLLECTION_REFLECT_INVALID_BRANCH_ERROR_CODE,
    COLLECTION_REFLECT_INVALID_SOURCE_ERROR_CODE,
    COLLECTION_REFLECT_MAPPING_CONFLICT_ERROR_CODE,
    COLLECTION_REFLECT_MISSING_IDENTITY_ERROR_CODE,
    COLLECTION_REFLECT_RENDERER_CREATE_ERROR_CODE,
    COLLECTION_REFLECT_RENDERER_UPDATE_ERROR_CODE,
    COLLECTION_REFLECT_SOURCE_REPLACEMENT_ERROR_CODE,
    COLLECTION_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
    CollectionReflectError,
} from "./api/reflect/reflect.collection.error.js";
export type { CollectionReflectErrorCode } from "./api/reflect/reflect.collection.error.js";
export { make_livemap_store_api } from "./api/livemap/livemap.store.js";
export {
    LiveMapDocumentAttributeNotFoundError,
    LiveMapDocumentInstallError,
    LiveMapDocumentIdentityProvenanceError,
    LiveMapDocumentIdentityRegistrationError,
    LiveMapDocumentMutationError,
    LiveMapDocumentStagingError,
    LiveMapProjectedTransportError,
    LiveMapProjectedValueError,
    LiveMapProjectedMutationError,
    LiveMapReplayError,
    LiveMapReplayInputError,
    LiveMapRevError,
} from "./api/livemap/livemap.error.js";
export type {
    LiveMapDocumentIdentityProvenanceErrorCode,
    LiveMapDocumentIdentityRegistrationErrorCode,
    LiveMapDocumentInstallFailureCode,
    LiveMapDocumentMutationErrorCode,
    LiveMapProjectedMutationErrorCode,
} from "./api/livemap/livemap.error.js";
export { format_live_path, path_is_prefix, paths_overlap } from "./api/livemap/livemap.path.js";
export {
    LiveMapDocumentPathError,
    validate_document_path,
} from "./api/livemap/livemap.document.path.js";
export { link_livemap } from "./api/livemap/livemap.link.js";
export { make_livemap_feed_hub } from "./api/livemap/livemap.feed.js";
export { make_livemap_proxy } from "./api/livemap/livemap.proxy.js";
export {
    bind_path,
    bind_paths,
    derive_from_paths,
    make_microtask_scheduler,
    stop_all,
    subscribe_paths,
} from "./api/livemap/livemap-helpers.js";
export {
  create_persistent_locus,
  LocusPersistenceError,
} from "./api/locus/locus.persistence.js";
export type { LocusPersistenceErrorCode } from "./api/locus/locus.persistence.error.js";
export { create_locus_client } from "./api/locus/locus.client.js";
export {
    LocusDisconnectedError,
    LocusDuplicateActionIdError,
    LocusClientRecoveryError,
    LocusClientSessionError,
    LocusRecoveryError,
} from "./api/locus/locus.error.js";
export {
    make_locus_sync_manager,
    type LocusSyncManager,
    type LocusSyncSend,
    type LocusSyncSession,
} from "./api/locus/locus.sync.js";
export { make_locus_canonical_stream } from "./api/locus/locus.history.js";
export { make_locus_recovery_planner } from "./api/locus/locus.recovery.js";
export { decode_locus_message, decode_locus_server_message, encode_locus_message } from "./api/locus/locus.protocol.js";
export { create_locus } from "./api/locus/locus.core.js";
export {
    LocusAuthorityError,
    type LocusAuthorityErrorCode,
} from "./api/locus/locus.authority.js";
export type {
    LiveMapPathHandle,
    LiveMapProxy,
    LivePath,
    LivePathPart,
    LiveMapEditResult,
    LiveMapCommit,
    LiveMapStructuralJsonEnvelope,
    LiveMapCapture,
    LiveMapApply,
    LiveMapReplay,
    LiveMapOp,
    LiveMapAnyOp,
    LiveMapDataOp,
    LiveMapRenameOp,
    LiveMapMoveOp,
    LiveMapGraphOp,
    LiveMapGraphReplaceRootOp,
    LiveMapGraphSetAttrOp,
    LiveMapGraphRemoveAttrOp,
    LiveMapGraphReplaceAttrsOp,
    LiveMapGraphReplaceContentOp,
    LiveMapGraphInsertContentOp,
    LiveMapGraphRemoveContentOp,
    LiveMapGraphMoveContentOp,
    LiveMapGraphEnsureQuidOp,
    LiveMapProjectedGraphEnsureQuidOp,
    LiveMapGraphCommit,
    LiveMapFeedEvent,
    LiveMapFeedListener,
    LiveMapDisposer,
    LiveMapCore,
    LiveMap,
    LiveMapRootMode,
    DataLiveMapMode,
    DocumentLiveMapMode,
    DocumentLiveMapCapture,
    DocumentLiveMapCaptureApi,
    DocumentLiveMapCaptureIdentity,
    DocumentLiveMapCaptureOptions,
    DocumentLiveMapInstallIdentity,
    DocumentLiveMapInstallOptions,
    LiveMapDocumentPath,
    LiveMapDocumentPathInput,
    LiveMapDocumentIdentityHandle,
    LiveMapProjectedIdentityHandle,
    LiveMapProjectedIdentityCommitTarget,
    LiveMapDocumentRequestTarget,
    LiveMapDocumentCommitTarget,
    LiveMapDocumentTargetWitness,
    LiveMapDocumentTarget,
    LiveMapDocumentAttributeValue,
    LiveMapDocumentAttrs,
    LiveMapDocumentContent,
    DocumentLiveMapAttrsMustApi,
    DocumentLiveMapAttrsReadApi,
    DocumentLiveMapAttrsMutationApi,
    DocumentLiveMapAttrsApi,
    DocumentLiveMapContentApi,
    LiveMapDocumentApi,
    DocumentLiveMap,
    ClassifiedLiveMap,
    LiveMapAuthority,
    LiveMapCommitOrigin,
    LiveMapCommitObservation,
    LiveMapCommitObserver,
    LiveMapCommitObserverApi,
    CollectionReflect,
    CollectionReflectOptions,
    CollectionReflectChange,
    CollectionReflectChangeKind,
    CollectionReflectDiagnostics,
    CollectionReflectItemContext,
    CollectionReflectItemUpdate,
    CollectionReflectKey,
    CollectionReflectListener,
    CollectionReflectMappingSummary,
    CollectionReflectRender,
    CollectionReflectRenderResult,
    CollectionReflectSnapshot,
    CollectionReflectStatus,
    LiveInspector,
    LiveInspectorArrayIdentity,
    LiveInspectorArrayKeyContext,
    LiveInspectorArrayKeyResolver,
    LiveInspectorBranchRole,
    LiveInspectorDiagnostics,
    LiveInspectorHsonMode,
    LiveInspectorListener,
    LiveInspectorMappingSummary,
    LiveInspectorOptions,
    LiveInspectorOwnedHsonOptions,
    LiveInspectorOwnedJsonOptions,
    LiveInspectorReadHandle,
    LiveInspectorRendererResult,
    LiveInspectorRendererUpdate,
    LiveInspectorRenderers,
    LiveInspectorSelection,
    LiveInspectorSemanticContext,
    LiveInspectorSemanticRenderer,
    LiveInspectorSerializationTarget,
    LiveInspectorSnapshot,
    LiveInspectorSource,
    LiveInspectorSpecialization,
    LiveInspectorStatus,
    LiveInspectorValueKind,
} from "./types/index.js";
export type * from "./types/locus.types.js";
export type { LocusDocumentSnapshotEncoding } from "./api/locus/locus.document-snapshot.js";
export { snap_live_path } from "./api/livemap/livemap.editor.js";
export { ELEM_TAG, OBJ_TAG, ARR_TAG, ROOT_TAG, II_TAG, STR_TAG, VAL_TAG, ATTRS_KEY, META_KEY, TAG_KEY, CONTENT_KEY } from "./core/constants.js";
export { make_sanitizer, type SanitizerLike } from "./safety/sanitize-html.utils.js";
