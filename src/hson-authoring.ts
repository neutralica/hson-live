import { admit_hson, admit_hson_source, reconstruct_hson_structural_template } from "./api/transform/hson-admission.js";
import { ExactDataCarrier, hson_data_value } from "./api/data/hson-data.js";
import { ExactDocumentCarrier, qualify_hson_document_source } from "./api/document/hson-document.js";
import { parse_hson_structural_template } from "./api/transform/parsers/parse-hson.js";
import { projected_value_to_hson_node } from "./core/projected-value-graph.js";
import { detach_hson_root_value } from "./api/transform/utils/node-utils/detach-hson-root-value.js";
import { serialize_hson } from "./api/transform/serializers/serialize-hson.js";
import { _throw_transform_err } from "./core/errors.js";
import { is_transform_error } from "./core/errors.js";
import { is_Node } from "./core/node-guards.js";
import { HsonSchema } from "./api/schema/hson-schema.js";
import type { HsonCanonical, HsonData, HsonDocument, HsonSchemaData } from "./api/transform/transform.types.js";

type Substitution = string | number | boolean | null;

function structural_position(source: string, offset: number) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);
  return { index: offset, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function structural_values(
  source: string,
  slots: readonly Readonly<{ offset: number; substitution: number }>[],
  substitutions: readonly Substitution[],
  mode: "document" | "data",
) {
  const values: Array<readonly import("./core/types.js").HsonNode[]> = [];
  for (const slot of slots) {
    const candidate = substitutions[slot.substitution];
    if (typeof candidate !== "string") {
      _throw_transform_err(
        `structural interpolation ${slot.substitution + 1} requires a primitive string`,
        `Hson.${mode}`, undefined, undefined,
        { code: "HSON_STRUCTURAL_CANDIDATE_STRING_REQUIRED", stage: "template-admission",
          source: structural_position(source, slot.offset), path: `$slot[${slot.substitution}]` },
      );
    }
    try {
      values[slot.substitution] = mode === "document"
        ? qualify_hson_document_source(candidate).$_content.map((item) => {
          if (!is_Node(item)) throw new TypeError("Document root content must be nodes.");
          return item;
        })
        : [projected_value_to_hson_node(
          hson_data_value(ExactDataCarrier.fromHson(admit_hson_source(candidate))),
        )];
    } catch (cause) {
      _throw_transform_err(
        `structural interpolation ${slot.substitution + 1} is invalid Hson.${mode} content`,
        `Hson.${mode}`, undefined, cause,
        { code: "HSON_STRUCTURAL_CANDIDATE_INVALID", stage: "template-admission",
          source: structural_position(source, slot.offset), path: `$slot[${slot.substitution}]` },
      );
    }
  }
  return values;
}

function canonical(strings: TemplateStringsArray, ...substitutions: readonly Substitution[]): HsonCanonical {
  return admit_hson(strings, ...substitutions);
}

function data_tag(strings: TemplateStringsArray, ...substitutions: readonly Substitution[]): HsonData {
  const template = reconstruct_hson_structural_template(strings, substitutions);
  if (template.slots.length === 0) return ExactDataCarrier.fromHson(admit_hson_source(template.source)).toHson() as HsonData;
  const values = structural_values(template.source, template.slots, substitutions, "data");
  try {
    const root = parse_hson_structural_template(template.source, template.slots, "data", values);
    return ExactDataCarrier.fromHson(serialize_hson(detach_hson_root_value(root))).toHson() as HsonData;
  } catch (cause) {
    if (is_transform_error(cause)) throw cause;
    _throw_transform_err("composed Hson.data value failed admission", "Hson.data", undefined, cause,
      { code: "HSON_STRUCTURAL_COMPOSED_INVALID", stage: "canonical-data-admission" });
  }
}

function document_tag(strings: TemplateStringsArray, ...substitutions: readonly Substitution[]): HsonDocument {
  const template = reconstruct_hson_structural_template(strings, substitutions);
  if (template.slots.length === 0) return ExactDocumentCarrier.fromHson(template.source as HsonCanonical).toHson() as HsonDocument;
  const values = structural_values(template.source, template.slots, substitutions, "document");
  try {
    const root = parse_hson_structural_template(template.source, template.slots, "document", values);
    return ExactDocumentCarrier.fromNode(root).toHson() as HsonDocument;
  } catch (cause) {
    if (is_transform_error(cause)) throw cause;
    _throw_transform_err("composed Hson.document value failed admission", "Hson.document", undefined, cause,
      { code: "HSON_STRUCTURAL_COMPOSED_INVALID", stage: "canonical-document-admission" });
  }
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
