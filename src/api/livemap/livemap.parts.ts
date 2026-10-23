import { normalize_part_css_authoring } from "../../core/part-css-authoring.js";
import { structured_part_stylesheet } from "../../internal/css/structured-css.js";
import { document_css_subject_identities } from "../../internal/css/css-identity-translation.js";
import { ANY_DATA, hson_schema_digest, hson_schema_source_digest } from "../schema/hson-schema.js";
import type { HsonNode, JsonValue } from "../../core/types.js";
import { is_ordinary_element_node } from "../../core/node-guards.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import { is_ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { parse_part_stylesheet, merge_part_stylesheets } from "../../internal/css/part-stylesheet.js";
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet } from "../../internal/css/portable-document-stylesheet.js";
import type { DocumentCssRecord } from "../../types/document-css.types.js";
import type { PortableDocumentQuads } from "../../types/livemap.types.js";
import { admit_public_livemap_root } from "./livemap.node-admission.js";
import { decode_document_quads, parse_authored_document_library } from "./livemap.document.quad.js";

/** Portable owner contract, independent of application names and Schema. @internal */
export type DataLibraryValidation = "hson-part-collection-v1";
/** @internal */
export const PART_COLLECTION_VALIDATION: DataLibraryValidation = "hson-part-collection-v1";

/** The only Part value supported by this cut. Absence of CSS differs from empty CSS. @internal */
export type DocumentPart = import("../../types/livemap.types.js").LiveMapDocumentPart;
/** Detached operation-local consumer result. No facade, cache, or identity authority. @internal */
export type ValidatedPart = Readonly<{
  key: string;
  root: HsonNode;
  quads?: PortableDocumentQuads;
  css?: DocumentCssRecord;
}>;

/** Exact optional owner evidence; explicit undefined and accessors fail closed. @internal */
export function own_data_library_validation(input: object): DataLibraryValidation | undefined {
  const field = Object.getOwnPropertyDescriptor(input, "validation");
  if (field === undefined) return undefined;
  if (!field.enumerable || !Object.hasOwn(field, "value") || field.value !== PART_COLLECTION_VALIDATION) {
    throw new TypeError("Unsupported data Library validation contract.");
  }
  return PART_COLLECTION_VALIDATION;
}

/** Contracts belong only to ordinary object data Libraries. @internal */
export function assert_data_library_validation(validation: DataLibraryValidation | undefined, mode: string, scope?: string, schema?: string): void {
  if (validation !== undefined && (validation !== PART_COLLECTION_VALIDATION || mode !== "data-object" || scope !== undefined)) {
    throw new TypeError("Part collection validation requires an ordinary object data Library.");
  }
  if (validation !== undefined && schema !== undefined && hson_schema_source_digest(schema) !== hson_schema_digest(ANY_DATA)) {
    throw new TypeError("Part collections do not support supplemental Schema attachment.");
  }
}

/**
 * The single pure complete-candidate validator, shared by admission, transitions,
 * receiving owners, egress and future composition reads. Parsing remains detached;
 * authored QUAD coordinates never enter a runtime identity overlay.
 * @internal
 */
export function validate_part_collection(value: OrderedProjectedValue): readonly ValidatedPart[] {
  if (!is_ordered_projected_object(value)) throw new TypeError("Part collection requires a string-keyed data object.");
  return Object.freeze(value.entries.map(([key, member]): ValidatedPart => {
    if (!is_ordered_projected_object(member)) throw new TypeError("Part requires a data record.");
    const fields = new Map(member.entries);
    if (fields.size < 2 || fields.size > 4 || [...fields.keys()].some(name => name !== "kind" && name !== "document" && name !== "css" && name !== "stylesheet")
      || fields.get("kind") !== "document" || typeof fields.get("document") !== "string") {
      throw new TypeError("Part requires exactly kind, authored document, and optional css/stylesheet; member Schema is unsupported.");
    }
    const source = fields.get("document");
    if (typeof source !== "string") throw new TypeError("Part document requires authored Hson text.");
    const authored = parse_authored_document_library(source);
    const root = admit_public_livemap_root(authored.root, "document", "Part document");
    const element = root.$_content[0];
    if (root.$_content.length !== 1 || !is_ordinary_element_node(element) || element.$_tag.toLowerCase() === "hson-part") {
      throw new TypeError("Part requires exactly one ordinary element root.");
    }
    const quads = authored.declarations.length === 0 ? undefined : decode_document_quads(
      [...authored.declarations].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0), root, "document");
    const rawSheet = fields.get("stylesheet");
    if (fields.has("stylesheet") && typeof rawSheet !== "string") throw new TypeError("Part stylesheet requires text.");
    const names = new Set(authored.declarations.map(item => item.name));
    const records: DocumentCssRecord[] = [];
    if (typeof rawSheet === "string") records.push(parse_part_stylesheet(rawSheet));
    if (fields.has("css")) records.push(structured_part_stylesheet(materialize_projected_value(fields.get("css")!), names));
    const css = records.length ? encode_portable_document_stylesheet(merge_part_stylesheets(records)) : undefined;
    if (css !== undefined) for (const name of document_css_subject_identities(css, "inbound")) {
      if (!names.has(name)) throw new TypeError(`Part stylesheet references missing local QUAD ${name}.`);
    }
    return Object.freeze({ key, root, ...(quads === undefined ? {} : { quads }), ...(css === undefined ? {} : { css }) });
  }));
}

/** Validate exact graph storage as well as the complete data value, without identity issuance. @internal */
export function validate_data_library(root: HsonNode, mode: string, validation: DataLibraryValidation | undefined): readonly ValidatedPart[] | undefined {
  assert_data_library_validation(validation, mode);
  if (validation === undefined) return undefined;
  const admitted = admit_public_livemap_root(root, "data", "Part collection");
  return validate_part_collection(projected_value_from_hson_node(admitted));
}

/** Explicit internal construction through the ordinary initial/later Library grammar. @internal */
export function part_collection_definition_internal(input: unknown): Readonly<{ data: JsonValue; validation: DataLibraryValidation }> {
  const value = admit_projected_value(normalize_part_css_authoring(input));
  validate_part_collection(value);
  const data: JsonValue = materialize_projected_value(value);
  return Object.freeze({ data, validation: PART_COLLECTION_VALIDATION });
}
