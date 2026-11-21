import type { HsonSchema, HsonSchemaMode, JsonFromSchema } from "../../api/transform/transform.types.js";
import type { DataObjectInput, DataValueInput } from "../../core/data-value.types.js";

/** Structural data-library reads; admission separately establishes Schema identity. */
export type DataSchemaValue<TSchema extends HsonSchema> =
  TSchema extends HsonSchema<unknown, "data"> ? JsonFromSchema<TSchema>
    : TSchema extends HsonSchema<infer TValue, HsonSchemaMode> ? TValue : never;

/** Compatibility for manually typed Schemas and libraries without generated evidence. */
export type DataSchemaProposal<TSchema extends HsonSchema, TFallback> =
  TSchema extends HsonSchema<unknown, "data", unknown, infer TProposal>
    ? unknown extends TProposal ? TFallback : TProposal
    : TFallback;

/** A library can have stable root shape even with a broad governing Schema. */
export type DataLibraryProposal<TSchema extends HsonSchema, TRead, TProposal = DataSchemaProposal<TSchema, TRead>> =
  DataValueInput extends TProposal
    ? [TRead] extends [readonly unknown[]] ? readonly DataValueInput[]
      : [TRead] extends [object] ? DataObjectInput : DataValueInput
    : TProposal;

/** Internal document graph evidence, never an application value projection API. */
export type DocumentSchemaGraph<TSchema extends HsonSchema> =
  TSchema extends HsonSchema<infer TGraph, HsonSchemaMode> ? TGraph : never;
