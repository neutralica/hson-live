import type { HsonSchema, HsonSchemaMode } from "../../api/transform/transform.types.js";

/** Internal data-library evidence; library admission establishes the family. */
export type DataSchemaValue<TSchema extends HsonSchema> =
  TSchema extends HsonSchema<infer TValue, HsonSchemaMode> ? TValue : never;

/** Internal document graph evidence, never an application value projection API. */
export type DocumentSchemaGraph<TSchema extends HsonSchema> =
  TSchema extends HsonSchema<infer TGraph, HsonSchemaMode> ? TGraph : never;
