// Root compatibility facade. Subsystem exports flow upward from their curated
// entrypoints so the package root and subpaths cannot drift.

export * from "./hson.js";
export * from "./api/livetree/index.js";
export * from "./api/livemap/index.js";
export * from "./api/livehost/index.js";

export { project_keyed_collection } from "./api/liveproject/liveproject.keyed.js";
export { create_live_inspector } from "./api/liveinspect/liveinspect.js";
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
} from "./api/liveinspect/liveinspect.error.js";
export type { LiveInspectorErrorCode } from "./api/liveinspect/liveinspect.error.js";
export {
  LIVE_PROJECTION_BRANCH_ATTACHED_ERROR_CODE,
  LIVE_PROJECTION_DISPOSED_ERROR_CODE,
  LIVE_PROJECTION_DUPLICATE_KEY_ERROR_CODE,
  LIVE_PROJECTION_HOST_NOT_EMPTY_ERROR_CODE,
  LIVE_PROJECTION_INVALID_BRANCH_ERROR_CODE,
  LIVE_PROJECTION_INVALID_SOURCE_ERROR_CODE,
  LIVE_PROJECTION_MAPPING_CONFLICT_ERROR_CODE,
  LIVE_PROJECTION_MISSING_IDENTITY_ERROR_CODE,
  LIVE_PROJECTION_RENDERER_CREATE_ERROR_CODE,
  LIVE_PROJECTION_RENDERER_UPDATE_ERROR_CODE,
  LIVE_PROJECTION_SOURCE_REPLACEMENT_ERROR_CODE,
  LIVE_PROJECTION_UNSUPPORTED_OPERATION_ERROR_CODE,
  LiveProjectionError,
} from "./api/liveproject/liveproject.error.js";
export type { LiveProjectionErrorCode } from "./api/liveproject/liveproject.error.js";
export type * from "./types/liveproject.types.js";
export type * from "./types/liveinspect.types.js";

export {
  ARR_TAG,
  ATTRS_KEY,
  CONTENT_KEY,
  ELEM_TAG,
  II_TAG,
  META_KEY,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  TAG_KEY,
  VAL_TAG,
} from "./core/constants.js";
export { make_sanitizer, type SanitizerLike } from "./safety/sanitize-html.utils.js";
