// livemap.index.ts — supported public module surface

export {
  append_live_path,
  clone_live_path,
  format_live_path,
  parent_live_path,
  path_is_prefix,
  paths_equal,
  paths_overlap,
  relative_live_path,
} from "./livemap.path.js";

export type {
  LiveMap,
  LiveMapPathHandle,
  LiveMapProxy,
  LiveMapProjectedIdentityHandle,
  LivePath,
  LivePathPart,
} from "../../types/livemap.types.js";

export type {
  InferLiveMapSchema,
  LiveMapSchema,
  LiveMapSchemaIssue,
  LiveMapSchemaValidation,
} from "./livemap.schema.js";
