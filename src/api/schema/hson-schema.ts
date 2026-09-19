import type { HsonCanonical, HsonData, HsonDocument, HsonSchemaData, HsonSchemaMode } from "../transform/transform.types.js";
import { ExactDataCarrier } from "../data/hson-data.js";
import { ExactDocumentCarrier } from "../document/hson-document.js";
import { compile_hson_schema, type CompiledHsonSchema } from "../../internal/hson-schema/compiler.js";
import { validate_hson_schema_graph } from "../../internal/schema-hson-validation/validate-canonical-hson.js";
import { hson_data_value } from "../data/hson-data.js";
import { projected_value_to_hson_node } from "../../core/projected-value-graph.js";
import { hson_document_root } from "../document/hson-document.js";

type Compiled = Extract<ReturnType<typeof compile_hson_schema>, { ok: true }>["value"];
type Certified<TSchema extends HsonSchema> = TSchema extends HsonSchema<unknown, "data">
  ? HsonData<Extract<TSchema, HsonSchema<unknown, "data">>>
  : TSchema extends HsonSchema<unknown, "document">
    ? HsonDocument<Extract<TSchema, HsonSchema<unknown, "document">>>
    : HsonData | HsonDocument;
type WrongMode<TSchema extends HsonSchema> = [TSchema] extends [HsonSchema<unknown, "data">]
  ? HsonDocument
  : [TSchema] extends [HsonSchema<unknown, "document">] ? HsonData : never;
const schema_state = new WeakMap<object, Readonly<{ source: HsonSchemaData; compiled: Compiled }>>();
const authority = Object.freeze({});
declare const HSON_SCHEMA_EVIDENCE: unique symbol;

/** Immutable active handle for one valid portable Hson Schema definition. */
export class HsonSchema<
  TValue = unknown,
  TMode extends HsonSchemaMode = HsonSchemaMode,
  TIdentity = unknown,
> {
  declare readonly [HSON_SCHEMA_EVIDENCE]: Readonly<{ value: TValue; mode: TMode; identity: TIdentity }>;

  private constructor(source: HsonSchemaData, compiled: Compiled, key: object) {
    if (key !== authority) throw new TypeError("Hson Schema construction requires validated Schema data.");
    schema_state.set(this, Object.freeze({ source, compiled }));
    Object.freeze(this);
  }

  /** @internal Defensively admit a portable Schema definition. */
  static fromHson(source: string): HsonSchema {
    if (typeof source !== "string") throw new TypeError("Hson Schema source must be a string.");
    const canonical = ExactDataCarrier.fromHson(source as HsonCanonical).toHson() as HsonSchemaData;
    const compiled = compile_hson_schema(canonical);
    if (!compiled.ok) throw new TypeError(`Invalid Hson Schema: ${compiled.issues.map(issue => issue.message).join(" ")}`);
    return new HsonSchema(canonical, compiled.value, authority);
  }

  toHson(): HsonSchemaData {
    return schema_state_of(this).source;
  }

  certify<TSchema extends HsonSchema, const TCandidate extends HsonCanonical>(
    this: TSchema,
    candidate: TCandidate & (TCandidate extends WrongMode<TSchema> ? never : unknown),
  ): Certified<TSchema> {
    if (typeof candidate !== "string") throw new TypeError("Schema certification requires canonical Hson text.");
    const compiled = schema_state_of(this).compiled;
    if (compiled.semantic.kind === "document" || compiled.semantic.kind === "document-element") {
      const document = ExactDocumentCarrier.fromHson(candidate);
      if (document.toHson() !== candidate) throw new TypeError("Schema certification requires canonical Hson document text.");
      validate_hson_schema_graph(this, hson_document_root(document));
      return document.toHson() as unknown as Certified<TSchema>;
    }
    const data = ExactDataCarrier.fromHson(candidate);
    validate_hson_schema_graph(this, projected_value_to_hson_node(hson_data_value(data)));
    return data.toHson() as unknown as Certified<TSchema>;
  }
}

function schema_state_of(schema: HsonSchema): Readonly<{ source: HsonSchemaData; compiled: Compiled }> {
  const state = schema_state.get(schema);
  if (state === undefined) throw new TypeError("Expected a genuine HsonSchema object.");
  return state;
}

/** @internal Reuse the Schema object's eagerly compiled graph. */
export function compiled_hson_schema_of(schema: HsonSchema): CompiledHsonSchema {
  return schema_state_of(schema).compiled;
}
