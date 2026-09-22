import { admit_hson, admit_hson_source, reconstruct_hson_interpolated_template } from "./api/transform/hson-admission.js";
import { ExactDataCarrier, hson_data_value } from "./api/data/hson-data.js";
import { ExactDocumentCarrier, qualify_hson_document_source } from "./api/document/hson-document.js";
import { parse_hson_interpolated_template } from "./api/transform/parsers/parse-hson.js";
import { tokenize_hson } from "./api/transform/parsers/tokenize-hson.js";
import { make_leaf } from "./api/transform/parsers/parse-tokens.js";
import { admit_hson_number } from "./core/hson-number.js";
import { projected_value_to_hson_node } from "./core/projected-value-graph.js";
import { detach_hson_root_value } from "./api/transform/utils/node-utils/detach-hson-root-value.js";
import { serialize_hson } from "./api/transform/serializers/serialize-hson.js";
import { _throw_transform_err } from "./core/errors.js";
import { is_transform_error } from "./core/errors.js";
import { is_Node } from "./core/node-guards.js";
import { HsonSchema } from "./api/schema/hson-schema.js";
import type { HsonCanonical, HsonData, HsonDocument, HsonSchemaData } from "./api/transform/transform.types.js";
import type { Tokens } from "./api/transform/token.types.js";

type Substitution = string | number | boolean | null;

function interpolation_position(source: string, offset: number) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);
  return { index: offset, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function interpolation_values(
  source: string,
  tokens: readonly Tokens[],
  substitutions: readonly Substitution[],
  mode: "document" | "data",
) {
  const values: Array<readonly import("./core/types.js").HsonNode[]> = [];
  for (const token of tokens) {
    if (token.kind !== "INTERPOLATION_SLOT") continue;
    const candidate = substitutions[token.slot];
    if (typeof candidate !== "string" && mode === "data"
      && (candidate === null || typeof candidate === "number" || typeof candidate === "boolean")) {
      values[token.slot] = [make_leaf(typeof candidate === "number" ? admit_hson_number(candidate) : candidate)];
      continue;
    }
    if (typeof candidate !== "string") {
      _throw_transform_err(
        mode === "document"
          ? "unquoted document interpolation requires HsonDocument source; wrap it in Hson quotes to insert text"
          : "unquoted data interpolation requires HsonData source or a primitive number, boolean, or null",
        `Hson.${mode}`, undefined, undefined,
        { code: "HSON_INTERPOLATION_CANDIDATE_TYPE_INVALID", stage: "template-admission",
          source: interpolation_position(source, token.pos.index), path: `$slot[${token.slot}]` },
      );
    }
    try {
      values[token.slot] = mode === "document"
        ? qualify_hson_document_source(candidate).$_content.map((item) => {
          if (!is_Node(item)) throw new TypeError("Document root content must be nodes.");
          return item;
        })
        : [projected_value_to_hson_node(
          hson_data_value(ExactDataCarrier.fromHson(admit_hson_source(candidate))),
        )];
    } catch (cause) {
      _throw_transform_err(
        mode === "document"
          ? "unquoted document interpolation must contain valid HsonDocument source; wrap it in Hson quotes to insert text"
          : "unquoted data interpolation must contain one valid HsonData value; wrap it in Hson quotes to insert a string",
        `Hson.${mode}`, undefined, cause,
        { code: "HSON_INTERPOLATION_CANDIDATE_INVALID", stage: "template-admission",
          source: interpolation_position(source, token.pos.index), path: `$slot[${token.slot}]` },
      );
    }
  }
  return values;
}

function canonical(strings: TemplateStringsArray, ...substitutions: readonly Substitution[]): HsonCanonical {
  return admit_hson(strings, ...substitutions);
}

function data_tag(strings: TemplateStringsArray, ...substitutions: readonly Substitution[]): HsonData {
  const template = reconstruct_hson_interpolated_template(strings, substitutions);
  if (template.slots.length === 0) return ExactDataCarrier.fromHson(admit_hson_source(template.source)).toHson() as HsonData;
  const tokens = tokenize_hson(template.source, 0, undefined, template.slots, "data", substitutions);
  const values = interpolation_values(template.source, tokens, substitutions, "data");
  try {
    const root = parse_hson_interpolated_template(template.source, "data", values, tokens);
    return ExactDataCarrier.fromHson(serialize_hson(detach_hson_root_value(root))).toHson() as HsonData;
  } catch (cause) {
    if (is_transform_error(cause)) throw cause;
    _throw_transform_err("composed Hson.data value failed admission", "Hson.data", undefined, cause,
      { code: "HSON_INTERPOLATION_COMPOSED_INVALID", stage: "canonical-data-admission" });
  }
}

function document_tag(strings: TemplateStringsArray, ...substitutions: readonly Substitution[]): HsonDocument {
  const template = reconstruct_hson_interpolated_template(strings, substitutions);
  if (template.slots.length === 0) return ExactDocumentCarrier.fromHson(template.source as HsonCanonical).toHson() as HsonDocument;
  const tokens = tokenize_hson(template.source, 0, undefined, template.slots, "document", substitutions);
  const values = interpolation_values(template.source, tokens, substitutions, "document");
  try {
    const root = parse_hson_interpolated_template(template.source, "document", values, tokens);
    return ExactDocumentCarrier.fromNode(root).toHson() as HsonDocument;
  } catch (cause) {
    if (is_transform_error(cause)) throw cause;
    _throw_transform_err("composed Hson.document value failed admission", "Hson.document", undefined, cause,
      { code: "HSON_INTERPOLATION_COMPOSED_INVALID", stage: "canonical-document-admission" });
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
