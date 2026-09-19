import { admit_hson, reconstruct_hson_template_source } from "./api/transform/hson-admission.js";
import { ExactDataCarrier } from "./api/data/hson-data.js";
import { ExactDocumentCarrier } from "./api/document/hson-document.js";
import { HsonSchema } from "./api/schema/hson-schema.js";
import type { HsonCanonical, HsonData, HsonDocument, HsonSchemaData } from "./api/transform/transform.types.js";

type Substitution = string | number | boolean | null;

function canonical(strings: TemplateStringsArray, ...substitutions: readonly Substitution[]): HsonCanonical {
  return admit_hson(strings, ...substitutions);
}

function data_tag(strings: TemplateStringsArray, ...substitutions: readonly Substitution[]): HsonData {
  return ExactDataCarrier.fromHson(admit_hson(strings, ...substitutions)).toHson() as HsonData;
}

function document_tag(strings: TemplateStringsArray, ...substitutions: readonly Substitution[]): HsonDocument {
  return ExactDocumentCarrier.fromHson(reconstruct_hson_template_source(strings, substitutions) as HsonCanonical).toHson() as HsonDocument;
}

function schema_tag(strings: TemplateStringsArray): HsonSchema {
  if (strings.length !== 1) throw new TypeError("Hson.schema requires a substitution-free tagged template.");
  return HsonSchema.fromHson(admit_hson(strings));
}

export const Hson = Object.freeze({
  canonical,
  data: Object.freeze(Object.assign(data_tag, {
    from(value: unknown): HsonData {
      return ExactDataCarrier.from(value).toHson() as HsonData;
    },
    fromHson(source: HsonCanonical): HsonData {
      return ExactDataCarrier.fromHson(source).toHson() as HsonData;
    },
    materialize(value: HsonData): import("./core/types.js").JsonValue {
      return ExactDataCarrier.fromHson(value).materialize();
    },
    entries(value: HsonData): readonly (readonly [string, HsonData])[] | undefined {
      return ExactDataCarrier.fromHson(value).entries()?.map(([name, item]) => [name, item.toHson() as HsonData] as const);
    },
  })),
  document: Object.freeze(Object.assign(document_tag, {
    fromHson(source: HsonCanonical): HsonDocument {
      const document = ExactDocumentCarrier.fromHson(source);
      if (document.toHson() !== source) throw new TypeError("Expected canonical Hson document text.");
      return source as HsonDocument;
    },
    fromNode(node: import("./core/types.js").HsonNode): HsonDocument {
      return ExactDocumentCarrier.fromNode(node).toHson() as HsonDocument;
    },
    toNode(value: HsonDocument): import("./core/types.js").HsonNode {
      const document = ExactDocumentCarrier.fromHson(value);
      if (document.toHson() !== value) throw new TypeError("Expected canonical Hson document text.");
      return document.toNode();
    },
  })),
  schema: Object.freeze(Object.assign(schema_tag, {
    fromHson(source: HsonSchemaData): HsonSchema {
      return HsonSchema.fromHson(source);
    },
  })),
});

export type { HsonCanonical, HsonData, HsonDocument, HsonSchemaData, HsonSchema, SchemaType } from "./api/transform/transform.types.js";
export type {
  BasicValue, HsonAttrs, HsonMeta, HsonNode, HsonSemanticPrimitive, JsonValue, NodeContent, Primitive,
} from "./core/types.js";
export { TransformError, is_transform_error, read_transform_error_details } from "./core/errors.js";
export type { TransformErrorDetails, TransformErrorRelated, TransformErrorSource } from "./core/errors.js";
