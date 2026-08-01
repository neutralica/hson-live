import type { TransformErrorDetails } from "../../src/core/errors.ts";
import type { RejectedCorpusCase } from "./corpus-types.mts";

function tokenError(code: string, index: number, line = 1, column = index + 1): TransformErrorDetails {
  return { operation: "tokenize-hson", stage: "tokenization", code, source: { index, line, column } };
}

function literal(
  id: string,
  claim: string,
  source: string,
  expectedRejection: TransformErrorDetails,
  shape: string,
  slot: string,
  defect: string,
  tags: readonly string[],
): RejectedCorpusCase {
  return {
    id,
    claim,
    classification: "literal-rejected-authored-hson",
    ingress: "hson",
    escapedInput: JSON.stringify(source),
    ...(source.includes("\n") || source.includes("\r") ? { verbatimInput: source } : {}),
    taxonomy: { shape, slot, defect },
    tags,
    origin: "settled-authored-hson-language",
    rationale: claim,
    disposition: "reject",
    source,
    expectedRejection,
  };
}

export const literalRejectedAuthoredHsonCases: readonly RejectedCorpusCase[] = [
  literal("hson.reject.literal.source.empty", "Empty source has no semantic value.", "", { operation: "parse_hson", stage: "source-admission", code: "HSON_SOURCE_EMPTY", source: { index: 0, line: 1, column: 1 } }, "source", "root", "empty-source", ["source-admission"]),
  literal("hson.reject.literal.source.whitespace-only", "Whitespace-only source has no semantic value.", "   ", { operation: "parse_hson", stage: "source-admission", code: "HSON_SOURCE_EMPTY", source: { index: 0, line: 1, column: 1 } }, "source", "root", "empty-source", ["source-admission", "trivia"]),
  literal("hson.reject.literal.source.comment-only", "Comment-only source has no semantic value.", "// comment", { operation: "parse_hson", stage: "source-admission", code: "HSON_SOURCE_EMPTY", source: { index: 0, line: 1, column: 1 } }, "source", "root", "empty-source", ["source-admission", "comment"]),
  literal("hson.reject.literal.root.bare-name", "An arbitrary bare name is not a root primitive.", "value", tokenError("HSON_PRIMITIVE_TOKEN_INVALID", 0), "source", "root-value", "bare-name", ["grammar"]),
  literal("hson.reject.literal.root.multiple-values", "A root contains exactly one semantic value.", "1 2", { operation: "parse_tokens.root-shaping", stage: "root-shaping", code: "HSON_ROOT_MULTIPLE_VALUES", source: { index: 2, line: 1, column: 3 } }, "source", "root", "multiple-values", ["root-boundary"]),
  literal("hson.reject.literal.root.trailing-closer", "Trailing source after a primitive rejects.", "42>", tokenError("HSON_TRAILING_SOURCE", 2), "source", "root", "trailing-source", ["root-boundary"]),
  literal("hson.reject.literal.root.mixed-modes", "Element and object root modes cannot mix.", "<a/><b 2>", { operation: "parse_tokens.structural-mode", stage: "root-shaping", code: "HSON_ROOT_MIXED_MODES", source: { index: 4, line: 1, column: 5 } }, "mixed-root", "root", "mixed-mode", ["structural-mode"]),
  literal("hson.reject.literal.object.duplicate", "Duplicate decoded object-property keys reject with related evidence.", "<a 1 a 2>", { operation: "tokenize-hson", stage: "tokenization", code: "HSON_OBJECT_DUPLICATE_MEMBER", source: { index: 5, line: 1, column: 6 }, related: [{ role: "first-declaration", source: { index: 1, line: 1, column: 2 } }] }, "object", "property-key", "duplicate-key", ["object", "duplicate"]),
  literal("hson.reject.literal.element.duplicate-attribute", "Duplicate decoded element attributes reject with related evidence.", `<e x="1" x="2"/>`, { operation: "tokenize-hson", stage: "tokenization", code: "HSON_ELEMENT_DUPLICATE_ATTRIBUTE", source: { index: 9, line: 1, column: 10 }, related: [{ role: "first-declaration", source: { index: 3, line: 1, column: 4 } }] }, "element", "element-attribute", "duplicate-attribute", ["element", "duplicate"]),
  literal("hson.reject.literal.object.comma", "Object properties do not use commas.", "<a 1, b 2>", tokenError("HSON_OBJECT_COMMA_FORBIDDEN", 4), "object", "property-separator", "comma", ["object", "grammar"]),
  literal("hson.reject.literal.object.missing-trivia", "A property key and value require trivia.", `<a"x">`, tokenError("HSON_REQUIRED_TRIVIA_MISSING", 2), "object", "property-separator", "missing-trivia", ["object", "grammar"]),
  literal("hson.reject.literal.object.extra-value", "An object property has exactly one value.", "<a 1 2 3>", tokenError("HSON_OBJECT_EXTRA_VALUE", 5), "object", "property-value", "extra-value", ["object", "grammar"]),
  literal("hson.reject.literal.object.attribute-syntax", "Object properties do not use attribute equals syntax.", `<a title="x" "v">`, tokenError("HSON_OBJECT_ATTRIBUTE_FORBIDDEN", 3), "object", "property-key", "attribute-syntax", ["object", "grammar"]),
  literal("hson.reject.literal.object.flag", "An object property cannot omit its value.", "<a flag>", tokenError("HSON_OBJECT_FLAG_FORBIDDEN", 3), "object", "property-value", "flag", ["object", "grammar"]),
  literal("hson.reject.literal.object.quid", "Object-property QUIDs do not exist in authored HSON.", "<a @0000000000000001 1>", tokenError("HSON_OBJECT_QUID_FORBIDDEN", 3), "object", "property-key", "object-quid", ["object", "quid"]),
  literal("hson.reject.literal.authored-metadata", "Authored structural metadata names reject.", `<e hson:index="0"/>`, tokenError("HSON_AUTHORED_METADATA_FORBIDDEN", 3), "element", "element-attribute", "authored-metadata", ["metadata", "reserved-name"]),
  literal("hson.reject.literal.object.legacy-doubled", "Legacy doubled-angle object syntax rejects.", "<<a 1>>", tokenError("legacy-doubled-object-syntax", 1), "object", "container", "legacy-syntax", ["object", "legacy"]),
  literal("hson.reject.literal.object.legacy-adjacent", "Adjacent angle objects do not merge into one object.", "<a 1><b 2>", { operation: "parse_tokens.root-shaping", stage: "root-shaping", code: "HSON_LEGACY_ADJACENT_OBJECT", source: { index: 5, line: 1, column: 6 } }, "object", "root", "legacy-syntax", ["object", "legacy"]),
  literal("hson.reject.literal.element.missing-attribute-value", "An explicit element attribute requires a value.", "<e x=/>", tokenError("HSON_ELEMENT_ATTRIBUTE_VALUE_INVALID", 3), "element", "element-attribute", "missing-value", ["element", "attribute"]),
  literal("hson.reject.literal.element.flag-after-content", "Element flags cannot follow content.", `<e "x" late/>`, tokenError("HSON_ELEMENT_HEADER_AFTER_CONTENT", 7), "element", "element-flag", "after-content", ["element", "flag"]),
  literal("hson.reject.literal.element.numeric-content", "Numeric typed content beneath an HSON element rejects.", `<e 1/>`, tokenError("HSON_ELEMENT_TYPED_CONTENT_FORBIDDEN", 3), "element", "element-content", "typed-content", ["element", "number", "structural-mode"]),
  literal("hson.reject.literal.element.missing-quid", "An element QUID marker requires a persisted QUID.", "<e @/>", tokenError("HSON_ELEMENT_QUID_INVALID", 3), "element", "element-quid", "missing-quid", ["element", "quid"]),
  literal("hson.reject.literal.element.duplicate-quid", "An element cannot declare two QUIDs.", "<e @0000000000000001 @0000000000000002/>", { operation: "tokenize-hson", stage: "tokenization", code: "HSON_ELEMENT_QUID_INVALID", source: { index: 21, line: 1, column: 22 }, related: [{ role: "first-declaration", source: { index: 3, line: 1, column: 4 } }] }, "element", "element-quid", "duplicate-quid", ["element", "quid"]),
  literal("hson.reject.literal.mode.element-object", "An HSON element cannot contain object structure.", "<e <b 1>/>", tokenError("HSON_STRUCTURAL_MODE_CROSSING", 3), "element", "element-content", "object-beneath-element", ["structural-mode"]),
  literal("hson.reject.literal.mode.element-array", "An HSON element cannot contain an array.", "<e [1]/>", tokenError("HSON_STRUCTURAL_MODE_CROSSING", 3), "element", "element-content", "array-beneath-element", ["structural-mode"]),
  literal("hson.reject.literal.mode.array-element", "An array cannot contain element-mode content.", "[<e/>]", { operation: "parse_tokens.structural-mode", stage: "structural-mode-admission", code: "HSON_STRUCTURAL_MODE_CROSSING", source: { index: 1, line: 1, column: 2 } }, "array", "array-item", "element-in-array", ["structural-mode"]),
  literal("hson.reject.literal.array.missing-comma", "Array items require commas.", "[1 2]", tokenError("HSON_ARRAY_COMMA_MISSING", 3), "array", "array-separator", "missing-comma", ["array", "grammar"]),
  literal("hson.reject.literal.array.missing-item", "Two array commas cannot omit an item.", "[1,,2]", tokenError("HSON_ARRAY_ITEM_MISSING", 3), "array", "array-item", "missing-item", ["array", "grammar"]),
  literal("hson.reject.literal.array.mismatched-bracket", "A bracket array must close with a bracket.", "[1,2»", tokenError("HSON_ARRAY_CLOSER_MISMATCH", 4), "array", "container", "mismatched-closer", ["array", "grammar"]),
  literal("hson.reject.literal.array.mismatched-guillemet", "A guillemet array must close with a guillemet.", "«1,2]", tokenError("HSON_ARRAY_CLOSER_MISMATCH", 4), "array", "container", "mismatched-closer", ["array", "grammar"]),
  literal("hson.reject.literal.comment.block", "Block comments are unsupported.", "/*x*/1", tokenError("HSON_BLOCK_COMMENT_UNSUPPORTED", 0), "source", "trivia", "block-comment", ["comment", "grammar"]),
  literal("hson.reject.literal.element.malformed-closer", "Whitespace cannot split an element closer.", "<e/ >", tokenError("HSON_ELEMENT_CLOSER_MALFORMED", 2), "element", "container", "malformed-closer", ["element", "grammar"]),
  literal("hson.reject.literal.reserved-name", "Authored _hson_* element names reject.", "<_hson_obj/>", { operation: "tokenize-hson.authored-name", stage: "tokenization", code: "authored-reserved-name", source: { index: 1, line: 1, column: 2 } }, "element", "element-name", "reserved-name", ["reserved-name"]),
  literal("hson.reject.literal.empty-element-name", "An empty decoded element name rejects.", "<``/>", tokenError("HSON_ELEMENT_NAME_REQUIRED", 1), "element", "element-name", "empty-decoded-name", ["element", "empty-name"]),
  literal("hson.reject.literal.empty-attribute-name", "An empty decoded attribute name rejects.", "<e ``=\"x\"/>", tokenError("HSON_NAME_INVALID_START", 3), "element", "element-attribute", "empty-decoded-name", ["element", "attribute", "empty-name"]),
  literal("hson.reject.literal.empty-flag-name", "An empty decoded flag name rejects.", "<e ``/>", tokenError("HSON_NAME_INVALID_START", 3), "element", "element-flag", "empty-decoded-name", ["element", "flag", "empty-name"]),
  literal("hson.reject.literal.whitespace.byte-order-mark", "U+FEFF is not authored-HSON trivia.", `1\ufeff`, tokenError("HSON_NUMBER_TRAILING_JUNK", 0), "scalar", "trivia", "unsupported-u-feff", ["trivia", "unicode"]),
] as const;
