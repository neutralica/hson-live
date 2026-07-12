// livemap.index.ts — supported public module surface
export { define_livemap_schema, make_livemap_schema, LIVEMAP_SCHEMA } from "./livemap.schema.js";

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
  LivePath,
  LivePathPart,
} from "../../types/livemap.types.js";

export type {
  InferLiveMapSchema,
  LiveMapSchema,
  LiveMapSchemaBuilder,
  LiveMapSchemaInput,
  LiveMapSchemaIssue,
  LiveMapSchemaValidation,
} from "./livemap.schema.js";