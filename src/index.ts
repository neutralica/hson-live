/**
 * Normal application and high-level composition API.
 *
 * Advanced protocol, replay, persistence, inspection, and environment-specific
 * contracts are owned by their explicit package subpaths.
 */

export { Hson } from "./hson-authoring.js";
export { HsonData } from "./api/data/hson-data.js";
export { HsonDocument } from "./api/document/hson-document.js";
export {
  hson,
  hsonCalc,
  hsonEcho,
  hsonLiveMap,
  hsonLiveTree,
  hsonLocus,
  hsonReflect,
  hsonTransform,
  type HsonFacade,
} from "./hson.js";

export type {
  BinaryDecodeOptions,
  HsonSchema,
  HsonSchemaMutationCandidate,
  TransformBinarySerialize,
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
export type { HsonNumber } from "./api/transform/hson-number.js";

export { continue_document } from "./api/continuation/continue-document.js";
export { continue_hosted_document } from "./api/continuation/continue-hosted-document.lazy.js";
export { DocumentContinuationError } from "./api/continuation/continuation.error.js";
export type {
  DocumentContinuation,
  HostedDocumentContinuation,
} from "./api/continuation/continuation.types.js";

export {
  activate_interactions,
  add_interaction,
  enable_interactions,
  remove_interaction,
  replace_interaction,
} from "./api/interactions/interactions.js";
export type {
  AuthoritativeInteractionDescriptor,
  InteractionActionDispatcher,
  InteractionActivationOptions,
  InteractionDescriptor,
  InteractionFailure,
  InteractionListener,
  InteractionLocalBehavior,
  InteractionLocalBehaviors,
  LocalInteractionDescriptor,
} from "./types/interaction.types.js";

export {
  decode_ssr_bootstrap,
  DocumentSsrError,
  encode_ssr_bootstrap,
  render_document,
  render_hosted_document,
  SsrBootstrapCodecError,
} from "./api/ssr/index.js";
export type {
  BrowserRealizationHtml,
  DecodedSsrBootstrap,
  DocumentSsr,
  EncodedSsrBootstrap,
  HostedDocumentSsr,
  HostedLibrariesDocumentSsr,
  LibrariesDocumentSsr,
  SsrBootstrapCodecOptions,
  SsrBootstrapKind,
} from "./api/ssr/index.js";

export { LiveTree } from "./api/livetree/livetree.js";
export { TreeSelector } from "./api/livetree/creation/tree-selector.js";
export type {
  AsyncLiveTree,
  AsyncLiveTreeAttrs,
  AsyncLiveTreeClasslist,
  AsyncLiveTreeFlags,
  AsyncLiveTreeForm,
  AsyncLiveTreeId,
  AsyncLiveTreeText,
} from "./api/livetree/async-livetree.js";
export {
  LiveTreeAlreadyAttachedError,
  LiveTreeAttributeError,
  LiveTreeBatchError,
  LiveTreeDisposedError,
  LiveTreeProtectedRootError,
  LiveTreeQuidReuseError,
} from "./api/livetree/livetree.error.js";
export { LiveTreeLinkedIdentityRequiredError } from "./api/livetree/lifecycle/document-binding-state.js";
export type {
  DetachedLiveContent,
  LiveTreeLifecycleResult,
} from "./types/lifecycle.types.js";

export { link_livemap } from "./api/livemap/livemap.link.js";
export {
  LiveMapDocumentAttributeNotFoundError,
  LiveMapDocumentIdentityProvenanceError,
  LiveMapDocumentIdentityRegistrationError,
  LiveMapDocumentInstallError,
  LiveMapDocumentMutationError,
  LiveMapDocumentStagingError,
} from "./api/livemap/livemap.error.js";
export type {
  ClassifiedLiveMap,
  DataLiveMapMode,
  DocumentLiveMap,
  DocumentLiveMapMode,
  HsonSchemaValue,
  LiveMap,
  LiveMapDataLibrary,
  LiveMapDataLibraryInput,
  LiveMapDocumentLibrary,
  LiveMapDocumentLibraryInput,
  LiveMapLibraries,
  LiveMapLibrariesInput,
  LiveMapLibraryInput,
} from "./types/livemap.types.js";

export type { Reflect } from "./api/reflect/reflect.facade.js";
export {
  reflect_document,
  type DocumentReflect,
  type DocumentReflectStatus,
} from "./api/reflect/reflect.document.js";
export { DocumentReflectError } from "./api/reflect/reflect.document.error.js";

export { create_echo } from "./api/echo/echo.js";
export { EchoRecoveryError, EchoSessionError } from "./api/echo/echo.error.js";
export { create_locus_bootstrap_echo, type LocusBootstrapEcho } from "./api/echo/echo.bootstrap.js";
export type {
  Echo,
  EchoActionFn,
  EchoActionPromise,
  EchoActionRequest,
  EchoActionStatusResult,
  EchoOptions,
  EchoRetryActionFn,
  EchoSession,
  EchoSessionFailure,
  EchoSessionOptions,
  EchoSessionResult,
  EchoSessionStatus,
} from "./types/echo.types.js";

export { create_locus } from "./api/locus/locus.core.js";
export {
  LocusDisconnectedError,
  LocusDuplicateActionIdError,
  LocusRecoveryError,
} from "./api/locus/locus.error.js";
export { LocusAuthorityError } from "./api/locus/locus.authority.js";
export type {
  DataLocusOptions,
  Locus,
  LocusActionContext,
  LocusActionHandler,
  LocusActionName,
  LocusActionPayloads,
  LocusActions,
  LocusActivity,
  LocusActivityKind,
  LocusActivitySnapshot,
  LocusActivityState,
  LocusConnection,
  LocusEventListener,
  LocusMultiLibrary,
  LocusMultiLibraryActionContext,
  LocusMultiLibraryActionHandler,
  LocusMultiLibraryActions,
  LocusMultiLibraryOptions,
  LocusOptions,
  LocusResult,
  LocusSocketLike,
} from "./types/locus.types.js";

export { create_livehost_locus_registry } from "./api/livehost/services/livehost.authority-registry.js";
export type {
  LiveHost,
  LiveHostApplication,
  LiveHostApplicationContext,
  LiveHostConnection,
  LiveHostConnectionRoute,
  LiveHostLocusAcquisition,
  LiveHostLocusEvictionResult,
  LiveHostLocusRegistry,
  LiveHostLocusRegistryOptions,
  LiveHostLocusRegistryResult,
  LiveHostPrincipal,
  LiveHostRequestRoute,
} from "./types/livehost.types.js";
