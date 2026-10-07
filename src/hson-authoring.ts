import { admit_hson, admit_hson_source, reconstruct_hson_interpolated_template } from "./api/transform/hson-admission.js";
import { ExactDataCarrier, hson_data_value } from "./api/data/hson-data.js";
import { ExactDocumentCarrier, qualify_hson_document_source } from "./api/document/hson-document.js";
import { ELEM_TAG, STR_TAG } from "./core/constants.js";
import type { HsonNode } from "./core/types.js";
import { parse_hson, parse_hson_interpolated_template } from "./api/transform/parsers/parse-hson.js";
import { tokenize_hson } from "./api/transform/parsers/tokenize-hson.js";
import { make_leaf } from "./api/transform/parsers/parse-tokens.js";
import { admit_hson_number } from "./core/hson-number.js";
import { projected_value_to_hson_node } from "./core/projected-value-graph.js";
import { detach_hson_root_value } from "./api/transform/utils/node-utils/detach-hson-root-value.js";
import { admit_portable_hson_node } from "./api/transform/utils/hson-utils/quid-ingress.js";
import { serialize_hson } from "./api/transform/serializers/serialize-hson.js";
import { _throw_transform_err } from "./core/errors.js";
import { is_transform_error } from "./core/errors.js";
import { is_Node } from "./core/node-guards.js";
import { HsonSchema } from "./api/schema/hson-schema.js";
export { ANY_DATA, ANY_DOCUMENT } from "./api/schema/hson-schema.js";
import type { HsonCanonical, HsonData, HsonDocument, HsonSchemaData } from "./api/transform/transform.types.js";
import type { Tokens } from "./api/transform/token.types.js";

type Substitution = string | number | boolean | null;
type DocumentSubstitution = Substitution | undefined;

function interpolation_position(source: string, offset: number) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);
  return { index: offset, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function interpolation_values(
  source: string,
  tokens: readonly Tokens[],
  substitutions: readonly DocumentSubstitution[],
  mode: "canonical" | "document" | "data",
) {
  const values: Array<readonly HsonNode[]> = [];
  for (const token of tokens) {
    if (token.kind !== "INTERPOLATION_SLOT") continue;
    const candidate = substitutions[token.slot];
    if (mode === "document" && candidate === undefined) {
      values[token.slot] = [];
      continue;
    }
    if (typeof candidate !== "string" && mode !== "document" && token.context !== "document-content"
      && (candidate === null || typeof candidate === "number" || typeof candidate === "boolean")) {
      values[token.slot] = [make_leaf(typeof candidate === "number" ? admit_hson_number(candidate) : candidate)];
      continue;
    }
    if (typeof candidate !== "string") {
      const unsupportedCanonical = mode === "canonical" && candidate !== null
        && typeof candidate !== "number" && typeof candidate !== "boolean";
      _throw_transform_err(
        mode === "document"
          ? "unquoted document interpolation requires HsonDocument source or undefined; wrap strings in Hson quotes to insert text"
          : "unquoted interpolation requires Hson source or a primitive valid in this grammatical position",
        unsupportedCanonical ? "Hson" : `Hson.${mode}`, undefined, undefined,
        { code: unsupportedCanonical
            ? "HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED" : "HSON_INTERPOLATION_CANDIDATE_TYPE_INVALID", stage: "template-admission",
          source: interpolation_position(source, token.pos.index), path: `$slot[${token.slot}]` },
      );
    }
    try {
      if (mode === "document") {
        values[token.slot] = qualify_hson_document_source(candidate).$_content.map((item) => {
          if (!is_Node(item)) throw new TypeError("Document root content must be nodes.");
          return item;
        });
      } else if (mode === "data" || token.context === "data-value") {
        values[token.slot] = [projected_value_to_hson_node(
          hson_data_value(ExactDataCarrier.fromHson(admit_hson_source(candidate))),
        )];
      } else {
        const semantic = detach_hson_root_value(parse_hson(candidate));
        if (token.context === "document-content" && semantic.$_tag !== ELEM_TAG && semantic.$_tag !== STR_TAG) {
          throw new TypeError("Element content requires strings or elements.");
        }
        // A generic content cluster denotes ordered items, not an extra nested
        // wrapper. Scalars, objects and arrays remain one semantic value.
        values[token.slot] = semantic.$_tag === ELEM_TAG
          ? semantic.$_content.map((item) => {
            if (!is_Node(item)) throw new TypeError("Element content must be nodes.");
            return item;
          }) : [semantic];
      }
    } catch (cause) {
      _throw_transform_err(
        mode === "document"
          ? "unquoted document interpolation must contain valid HsonDocument source; wrap it in Hson quotes to insert text"
          : "unquoted interpolation must contain valid Hson source for its grammatical position; wrap it in Hson quotes to insert a string",
        `Hson.${mode}`, undefined, cause,
        { code: "HSON_INTERPOLATION_CANDIDATE_INVALID", stage: "template-admission",
          source: interpolation_position(source, token.pos.index), path: `$slot[${token.slot}]` },
      );
    }
  }
  return values;
}

function canonical(strings: TemplateStringsArray, ...substitutions: readonly Substitution[]): HsonCanonical {
  const template = reconstruct_hson_interpolated_template(strings, substitutions);
  const tokens = tokenize_hson(template.source, 0, undefined, template.slots, "canonical", substitutions);
  const values = interpolation_values(template.source, tokens, substitutions, "canonical");
  const root = parse_hson_interpolated_template(template.source, "canonical", values, tokens);
  return serialize_hson(detach_hson_root_value(root));
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

function document_tag(strings: TemplateStringsArray, ...substitutions: readonly DocumentSubstitution[]): HsonDocument {
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
      return document.toHson() as HsonDocument;
    },
    fromNode(node: import("./core/types.js").HsonNode): HsonDocument {
      admit_portable_hson_node(node, "Hson.document.fromNode");
      return ExactDocumentCarrier.fromNode(node).toHson() as HsonDocument;
    },
    toNode(value: HsonDocument): import("./core/types.js").HsonNode {
      const document = ExactDocumentCarrier.fromHson(value);
      return document.toNode();
    },
  })),
  schema: Object.freeze(Object.assign(schema_tag, {
    fromHson(source: HsonSchemaData): HsonSchema {
      return HsonSchema.fromHson(source);
    },
  })),
});

export type { HsonCanonical, HsonData, HsonDocument, HsonSchemaData, HsonSchema, HsonFromSchema, JsonFromSchema } from "./api/transform/transform.types.js";
export type {
  BasicValue, HsonAttrs, HsonMeta, HsonNode, HsonSemanticPrimitive, JsonValue, NodeContent, Primitive,
} from "./core/types.js";
export { TransformError, is_transform_error, read_transform_error_details } from "./core/errors.js";
export type { TransformErrorDetails, TransformErrorRelated, TransformErrorSource } from "./core/errors.js";
