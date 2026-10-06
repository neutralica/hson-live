import type { HsonSchema, HsonSchemaMode, JsonFromSchema } from "../../api/transform/transform.types.js";

/** Structural data-library reads; admission separately establishes Schema identity. */
export type DataSchemaValue<TSchema extends HsonSchema> =
  TSchema extends HsonSchema<unknown, "data"> ? JsonFromSchema<TSchema>
    : TSchema extends HsonSchema<infer TValue, HsonSchemaMode> ? TValue : never;

/** Internal document graph evidence, never an application value projection API. */
export type DocumentSchemaGraph<TSchema extends HsonSchema> =
  TSchema extends HsonSchema<infer TGraph, HsonSchemaMode> ? TGraph : never;
