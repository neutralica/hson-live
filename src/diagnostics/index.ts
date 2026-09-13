/** Supported tracing, profiling, and inspection diagnostics. */

export {
  begin_livetree_materialization_profile,
  type LiveTreeMaterializationProfile,
} from "../api/livetree/debug/materialization-profile.js";

export { create_live_trace_collector } from "../api/locus/locus.trace.collector.js";
export { create_live_trace_console_sink } from "../api/locus/locus.trace.console.js";
export type {
  LiveTraceCollector,
  LiveTraceCollectorOptions,
  LiveTraceConsoleSinkOptions,
  LiveTraceConsoleWriter,
  LiveTraceDetails,
  LiveTraceDetailValue,
  LiveTraceEvent,
  LiveTraceSink,
  LiveTraceStatus,
  LiveTraceSubsystem,
} from "../types/live.trace.types.js";

export { hsonInspect } from "../api/inspect/liveinspect.facade.js";
export { create_live_inspector } from "../api/inspect/liveinspect.js";
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
  type LiveInspectorErrorCode,
} from "../api/inspect/liveinspect.error.js";
export type {
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
} from "../types/liveinspect.types.js";
