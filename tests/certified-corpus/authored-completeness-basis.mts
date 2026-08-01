import type { TransformErrorDetails } from "../../src/core/errors.ts";
import type { AcceptedCorpusCase, RejectedCorpusCase } from "./corpus-types.mts";
import { arr, elem, element, obj, property, str, val } from "./graph-expectations.mts";

type ReviewPriority = "medium" | "high" | "critical";

function accepted(
  id: string,
  claim: string,
  source: string,
  expectedGraph: AcceptedCorpusCase["expectedGraph"],
  expectedHson: string,
  shape: string,
  slot: string,
  tags: readonly string[],
  provenance: string,
  novelty: string,
  humanReviewPriority: ReviewPriority = "medium",
): AcceptedCorpusCase {
  return {
    id,
    claim,
    classification: "literal-accepted-authored-hson",
    ingress: "hson",
    escapedInput: JSON.stringify(source),
    ...(source.includes("\n") || source.includes("\r") ? { verbatimInput: source } : {}),
    taxonomy: { shape, slot, variation: id.split(".").at(-1) },
    tags,
    origin: "targeted-authored-hson-completeness-amendment",
    rationale: claim,
    provenance,
    novelty,
    humanReviewPriority,
    disposition: "accept",
    source,
    expectedGraph,
    expectedOutputs: { hson: expectedHson },
  };
}

function tokenError(code: string, index: number, line = 1, column = index + 1): TransformErrorDetails {
  return { operation: "tokenize-hson", stage: "tokenization", code, source: { index, line, column } };
}

function rejected(
  id: string,
  claim: string,
  source: string,
  expectedRejection: TransformErrorDetails,
  shape: string,
  slot: string,
  defect: string,
  tags: readonly string[],
  provenance: string,
  novelty: string,
  humanReviewPriority: ReviewPriority = "medium",
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
    origin: "targeted-authored-hson-completeness-amendment",
    rationale: claim,
    provenance,
    novelty,
    humanReviewPriority,
    disposition: "reject",
    source,
    expectedRejection,
  };
}

const NUMBER_PROVENANCE = "Direct transcription of the settled JSON-compatible finite-number grammar.";
const TRIVIA_PROVENANCE = "Newly reasoned from the settled SPACE/HT/LF/CR and physical-line-comment grammar.";
const MODE_PROVENANCE = "Direct transcription of the settled authored-HSON structural-mode contract.";
const NAME_PROVENANCE = "Direct transcription after auditing the existing authored-name role grammar.";

export const completenessAcceptedNumberCases: readonly AcceptedCorpusCase[] = [
  accepted("hson.accept.basis.number.negative-integer", "A minus may prefix a nonzero JSON integer.", "-1", val(-1), "-1", "scalar", "root-number", ["number", "json-number-grammar"], NUMBER_PROVENANCE, "Adds the missing negative-integer lexical branch."),
  accepted("hson.accept.basis.number.positive-fraction", "A fraction retains digits on both sides of the decimal point.", "0.5", val(0.5), "0.5", "scalar", "root-number", ["number", "json-number-grammar"], NUMBER_PROVENANCE, "Adds the missing positive-fraction lexical branch."),
  accepted("hson.accept.basis.number.uppercase-exponent", "An uppercase exponent marker is accepted.", "1E3", val(1000), "1000", "scalar", "root-number", ["number", "json-number-grammar", "exponent"], NUMBER_PROVENANCE, "Adds the uppercase exponent-marker spelling."),
  accepted("hson.accept.basis.number.positive-exponent-sign", "An exponent may contain an explicit plus sign.", "1e+3", val(1000), "1000", "scalar", "root-number", ["number", "json-number-grammar", "exponent"], NUMBER_PROVENANCE, "Adds the positive exponent-sign spelling."),
  accepted("hson.accept.basis.number.negative-exponent-sign", "An exponent may contain a minus sign.", "1e-3", val(0.001), "0.001", "scalar", "root-number", ["number", "json-number-grammar", "exponent"], NUMBER_PROVENANCE, "Adds the negative exponent-sign spelling."),
] as const;

export const completenessRejectedNumberCases: readonly RejectedCorpusCase[] = [
  rejected("hson.reject.basis.number.leading-zero", "A nonzero integer may not begin with zero.", "01", tokenError("HSON_NUMBER_LEADING_ZERO", 1), "scalar", "root-number", "leading-zero", ["number", "json-number-grammar", "rejection"], NUMBER_PROVENANCE, "Adds direct ownership for the leading-zero defect."),
  rejected("hson.reject.basis.number.leading-plus", "A JSON-compatible HSON number may not begin with plus.", "+1", tokenError("HSON_NUMBER_LEADING_PLUS", 0), "scalar", "root-number", "leading-plus", ["number", "json-number-grammar", "rejection"], NUMBER_PROVENANCE, "Adds direct ownership for the leading-plus defect."),
  rejected("hson.reject.basis.number.missing-integer-before-fraction", "A fraction requires an integer component before the decimal point.", ".5", tokenError("HSON_NUMBER_INCOMPLETE_FRACTION", 0), "scalar", "root-number", "missing-integer-before-fraction", ["number", "json-number-grammar", "rejection"], NUMBER_PROVENANCE, "Adds the missing-integer fraction boundary."),
  rejected("hson.reject.basis.number.missing-fraction-digits", "A decimal point requires following fraction digits.", "1.", tokenError("HSON_NUMBER_INCOMPLETE_FRACTION", 0), "scalar", "root-number", "missing-fraction-digits", ["number", "json-number-grammar", "rejection"], NUMBER_PROVENANCE, "Adds the missing fraction-digits boundary."),
  rejected("hson.reject.basis.number.missing-exponent-digits", "An exponent marker requires following digits.", "1e", tokenError("HSON_NUMBER_INCOMPLETE_EXPONENT", 0), "scalar", "root-number", "missing-exponent-digits", ["number", "json-number-grammar", "rejection"], NUMBER_PROVENANCE, "Adds the empty exponent boundary."),
  rejected("hson.reject.basis.number.missing-signed-exponent-digits", "An exponent sign requires following digits.", "1e+", tokenError("HSON_NUMBER_INCOMPLETE_EXPONENT", 0), "scalar", "root-number", "missing-signed-exponent-digits", ["number", "json-number-grammar", "rejection"], NUMBER_PROVENANCE, "Adds the signed empty exponent boundary."),
  rejected("hson.reject.basis.number.named-nan", "NaN is not an authored finite number.", "NaN", tokenError("HSON_NUMBER_UNSUPPORTED_SPELLING", 0), "scalar", "root-number", "named-nonfinite", ["number", "nonfinite", "rejection"], NUMBER_PROVENANCE, "Adds explicit named-NaN rejection."),
  rejected("hson.reject.basis.number.named-positive-infinity", "Infinity is not an authored finite number.", "Infinity", tokenError("HSON_NUMBER_UNSUPPORTED_SPELLING", 0), "scalar", "root-number", "named-nonfinite", ["number", "nonfinite", "rejection"], NUMBER_PROVENANCE, "Adds explicit positive-Infinity rejection."),
  rejected("hson.reject.basis.number.named-negative-infinity", "Negative Infinity is not an authored finite number.", "-Infinity", tokenError("HSON_NUMBER_UNSUPPORTED_SPELLING", 0), "scalar", "root-number", "named-nonfinite", ["number", "nonfinite", "rejection"], NUMBER_PROVENANCE, "Adds explicit negative-Infinity rejection."),
  rejected("hson.reject.basis.number.hexadecimal", "Hexadecimal spelling is not JSON-compatible HSON number syntax.", "0x10", tokenError("HSON_NUMBER_UNSUPPORTED_SPELLING", 0), "scalar", "root-number", "unsupported-hexadecimal", ["number", "json-number-grammar", "rejection"], NUMBER_PROVENANCE, "Adds explicit hexadecimal-spelling rejection."),
  rejected("hson.reject.basis.number.numeric-separator", "Numeric separators are not JSON-compatible HSON number syntax.", "1_0", tokenError("HSON_NUMBER_UNSUPPORTED_SPELLING", 0), "scalar", "root-number", "unsupported-separator", ["number", "json-number-grammar", "rejection"], NUMBER_PROVENANCE, "Adds explicit numeric-separator rejection."),
  rejected("hson.reject.basis.number.nonfinite-overflow", "A syntactically valid number that overflows binary64 rejects as nonfinite.", "1e309", tokenError("HSON_NUMBER_NONFINITE", 0), "scalar", "root-number", "nonfinite-overflow", ["number", "nonfinite", "rejection"], NUMBER_PROVENANCE, "Adds the finite-domain overflow boundary."),
] as const;

export const completenessTriviaCases: readonly AcceptedCorpusCase[] = [
  accepted(
    "hson.accept.basis.trivia.object-slots",
    "Object trivia covers after-open, key/value, sibling, before-close, and consecutive terminated-comment slots.",
    "< \talpha// first\n// second\r\n 1\r beta\t2 \n>",
    obj(property("alpha", val(1)), property("beta", val(2))),
    "<\n  alpha 1\n  beta 2\n>",
    "object", "object-trivia-slots", ["trivia", "comment", "object", "crlf"], TRIVIA_PROVENANCE,
    "Adds one readable basis spanning the missing object trivia slots and consecutive comments.", "high",
  ),
  accepted(
    "hson.accept.basis.trivia.array-slots",
    "Array trivia covers after-opener, before-comma, after-comma, before-closer, and a terminated item-boundary comment.",
    "[ \t1 \r,\n// next item\n 2 \r\n]",
    arr(val(1), val(2)),
    "«\n  1,\n  2\n»",
    "array", "array-trivia-slots", ["trivia", "comment", "array", "crlf"], TRIVIA_PROVENANCE,
    "Adds one readable basis spanning the missing array trivia slots.", "high",
  ),
  accepted(
    "hson.accept.basis.trivia.element-slots",
    "Element trivia covers before-name, after-name, around equals, between header items, before and between content, and before slash.",
    "< \nwidget \t title \r= \n\"value\"\r\n enabled \t \"a\"// next leaf\n \"b\" \r />",
    elem(element("widget", [str("a"), str("b")], { title: "value", enabled: "enabled" })),
    "<widget title=\"value\" enabled\n  \"a\"\n  \"b\"\n/>",
    "element", "element-trivia-slots", ["trivia", "comment", "element", "attribute", "flag", "crlf", "implementation-derived-output"],
    "The graph was newly reasoned from the settled trivia grammar; the exact canonical HSON attribute order was corrected after focused production validation.",
    "Adds one readable basis spanning the missing element trivia slots while leaving '/>' indivisible.", "critical",
  ),
  accepted(
    "hson.accept.basis.trivia.comment-to-eof",
    "A physical-line comment may supply trailing root trivia through EOF.",
    "42// comment to EOF",
    val(42),
    "42",
    "scalar", "source-trailing-trivia", ["trivia", "comment", "eof"], TRIVIA_PROVENANCE,
    "Adds the missing valid comment-to-EOF source boundary.", "high",
  ),
] as const;

export const completenessCompositionCases: readonly (AcceptedCorpusCase | RejectedCorpusCase)[] = [
  rejected(
    "hson.reject.basis.mode.object-element",
    "An HSON object property cannot contain an element-mode value.",
    "<a <e/>>",
    tokenError("HSON_STRUCTURAL_MODE_CROSSING", 3),
    "object", "property-value", "element-beneath-object", ["structural-mode", "object", "element", "rejection"],
    MODE_PROVENANCE, "Adds the previously missing direct object-to-element crossing.",
  ),
  accepted(
    "hson.accept.basis.root.element-fragment",
    "A homogeneous root element fragment preserves sibling order.",
    "<a/><b/>",
    elem(element("a"), element("b")),
    "<a/>\n<b/>",
    "element-fragment", "root", ["root-boundary", "element", "fragment", "order"],
    MODE_PROVENANCE, "Adds the missing positive multi-element root fragment.",
  ),
  accepted(
    "hson.accept.basis.object.primitive-looking-keys",
    "true, false, and null are ordinary property keys in HSON object key position.",
    "<true 1 false 2 null 3>",
    obj(property("true", val(1)), property("false", val(2)), property("null", val(3))),
    "<\n  true 1\n  false 2\n  null 3\n>",
    "object", "property-key", ["object", "property-key", "primitive-keyword", "order"],
    MODE_PROVENANCE, "Adds the contextual-key contrast with typed object values and element flags.",
  ),
] as const;

export const completenessBacktickRoleCases: readonly (AcceptedCorpusCase | RejectedCorpusCase)[] = [
  accepted(
    "hson.accept.basis.backtick-name.element-name",
    "A nonempty backtick name is admitted as an HSON element name.",
    "<`x y`/>",
    elem(element("x y")),
    "<`x y`/>",
    "element", "element-name", ["element", "backtick-name", "authored-name"],
    NAME_PROVENANCE, "Adds the missing positive backtick element-name role.", "high",
  ),
  rejected(
    "hson.reject.basis.backtick-name.attribute-name",
    "Backtick names are not admitted as element attribute names.",
    "<e `data key`=\"value\"/>",
    tokenError("HSON_NAME_INVALID_START", 3),
    "element", "element-attribute", "backtick-role-forbidden", ["element", "attribute", "backtick-name", "rejection"],
    NAME_PROVENANCE, "Adds the missing nonempty backtick attribute-role rejection.", "high",
  ),
  rejected(
    "hson.reject.basis.backtick-name.flag-name",
    "Backtick names are not admitted as element flag names.",
    "<e `feature flag`/>",
    tokenError("HSON_NAME_INVALID_START", 3),
    "element", "element-flag", "backtick-role-forbidden", ["element", "flag", "backtick-name", "rejection"],
    NAME_PROVENANCE, "Adds the missing nonempty backtick flag-role rejection.", "high",
  ),
] as const;

export const authoredCompletenessBasisCases = [
  ...completenessAcceptedNumberCases,
  ...completenessRejectedNumberCases,
  ...completenessTriviaCases,
  ...completenessCompositionCases,
  ...completenessBacktickRoleCases,
] as const;
