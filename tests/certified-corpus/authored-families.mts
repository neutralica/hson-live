import type { AcceptedCorpusCase, AcceptedFamilyDefinition, RejectedCorpusCase, RejectedFamilyDefinition } from "./corpus-types.mts";
import { elem, element, obj, property, str, val } from "./graph-expectations.mts";

function acceptedStringCase(id: string, spelling: string, decoded: string, expectedHson: string): AcceptedCorpusCase {
  const source = "\"" + spelling + "\"";
  return {
    id: "hson.accept.family.quoted-string." + id,
    claim: "Quoted-string escape variation " + id + " decodes and canonicalizes exactly.",
    classification: "materialized-accepted-family-case", ingress: "hson", escapedInput: JSON.stringify(source),
    taxonomy: { shape: "scalar", slot: "quoted-string", variation: id },
    tags: ["string", "escape", "transparent-family"], origin: "family.accept.quoted-string-json-escapes",
    rationale: "One lexical slot varies only the accepted escape spelling.", disposition: "accept", source,
    expectedGraph: str(decoded), expectedOutputs: { hson: expectedHson },
  };
}

const quotedStringAcceptedCases: readonly AcceptedCorpusCase[] = [
  acceptedStringCase("quote", "\\\"", "\"", "\"\\\"\""),
  acceptedStringCase("backslash", "\\\\", "\\", "\"\\\\\""),
  acceptedStringCase("slash", "\\/", "/", "\"/\""),
  acceptedStringCase("backspace", "\\b", "\b", "\"\\b\""),
  acceptedStringCase("form-feed", "\\f", "\f", "\"\\f\""),
  acceptedStringCase("line-feed", "\\n", "\n", "\"\\n\""),
  acceptedStringCase("carriage-return", "\\r", "\r", "\"\\r\""),
  acceptedStringCase("tab", "\\t", "\t", "\"\\t\""),
  acceptedStringCase("unicode-lowercase", "\\u0061", "a", "\"a\""),
  acceptedStringCase("unicode-uppercase", "\\u006A", "j", "\"j\""),
  acceptedStringCase("unicode-mixed-case", "\\u00aF", "¯", "\"¯\""),
  acceptedStringCase("unicode-u0000", "\\u0000", "\u0000", "\"\\u0000\""),
  acceptedStringCase("unicode-u001f", "\\u001F", "\u001f", "\"\\u001f\""),
  acceptedStringCase("unicode-u007f", "\\u007F", "\u007f", "\"\u007f\""),
  acceptedStringCase("unicode-u0080", "\\u0080", "\u0080", "\"\u0080\""),
  acceptedStringCase("unicode-u00ff", "\\u00FF", "ÿ", "\"ÿ\""),
  acceptedStringCase("unicode-u0100", "\\u0100", "Ā", "\"Ā\""),
  acceptedStringCase("unicode-u2028", "\\u2028", "\u2028", "\"\u2028\""),
  acceptedStringCase("unicode-u2029", "\\u2029", "\u2029", "\"\u2029\""),
  acceptedStringCase("unicode-high-surrogate", "\\uD800", "\ud800", "\"\\ud800\""),
  acceptedStringCase("unicode-low-surrogate", "\\uDC00", "\udc00", "\"\\udc00\""),
  acceptedStringCase("unicode-surrogate-pair", "\\uD83D\\uDE00", "😀", "\"😀\""),
  acceptedStringCase("consecutive-unicode", "\\u0041\\u0042", "AB", "\"AB\""),
  acceptedStringCase("escape-before-quote", "end\\t", "end\t", "\"end\\t\""),
  {
    id: "hson.accept.family.quoted-string.escape-before-container-closer",
    claim: "A valid escape may end immediately before an element closer.",
    classification: "materialized-accepted-family-case", ingress: "hson",
    escapedInput: JSON.stringify("<e \"x\\t\"/>"),
    taxonomy: { shape: "element", slot: "element-content", variation: "escape-before-container-closer" },
    tags: ["string", "escape", "transparent-family"], origin: "family.accept.quoted-string-json-escapes",
    rationale: "This materializes the grammar-boundary interaction without replaying the escape lattice.",
    disposition: "accept", source: "<e \"x\\t\"/>", expectedGraph: elem(element("e", [str("x\t")])),
    expectedOutputs: { hson: "<e \"x\\t\"/>" },
  },
] as const;

export const quotedStringAcceptedFamily: AcceptedFamilyDefinition = {
  id: "family.accept.quoted-string-json-escapes",
  claim: "Quoted strings accept every JSON escape branch and settled Unicode boundary.",
  classification: "transparent-accepted-family", variedDimension: "quoted-string escape spelling", cases: quotedStringAcceptedCases,
};

function acceptedNameCase(id: string, spelling: string, decoded: string, expectedHson: string): AcceptedCorpusCase {
  const source = "<'" + spelling + "' 1>";
  return {
    id: "hson.accept.family.quoted-name." + id,
    claim: "Quoted-name escape variation " + id + " decodes and canonicalizes exactly.",
    classification: "materialized-accepted-family-case", ingress: "hson", escapedInput: JSON.stringify(source),
    taxonomy: { shape: "object", slot: "property-key", variation: id },
    tags: ["quoted-name", "escape", "transparent-family"], origin: "family.accept.quoted-name-escapes",
    rationale: "One property-key slot varies only the accepted escape spelling.", disposition: "accept", source,
    expectedGraph: obj(property(decoded, val(1))), expectedOutputs: { hson: expectedHson },
  };
}

const quotedNameAcceptedCases: readonly AcceptedCorpusCase[] = [
  acceptedNameCase("escaped-apostrophe", "don\\'t", "don't", "<'don\\'t' 1>"),
  acceptedNameCase("escaped-backslash", "back\\\\slash", "back\\slash", "<'back\\\\slash' 1>"),
  acceptedNameCase("backspace", "back\\bspace", "back\bspace", "<'back\\bspace' 1>"),
  acceptedNameCase("form-feed", "form\\ffeed", "form\ffeed", "<'form\\ffeed' 1>"),
  acceptedNameCase("line-feed", "line\\nname", "line\nname", "<'line\\nname' 1>"),
  acceptedNameCase("carriage-return", "line\\rname", "line\rname", "<'line\\rname' 1>"),
  acceptedNameCase("tab", "line\\tname", "line\tname", "<'line\\tname' 1>"),
  acceptedNameCase("unicode-lowercase", "lower\\u0061name", "loweraname", "<loweraname 1>"),
  acceptedNameCase("unicode-uppercase", "upper\\u006Aname", "upperjname", "<upperjname 1>"),
  acceptedNameCase("unicode-mixed-case", "mixed\\u00aFname", "mixed¯name", "<'mixed¯name' 1>"),
  acceptedNameCase("unicode-u0000", "nul\\u0000name", "nul\u0000name", "<'nul\\u0000name' 1>"),
  acceptedNameCase("unicode-control", "control\\u0001name", "control\u0001name", "<'control\\u0001name' 1>"),
  acceptedNameCase("unicode-u001f", "unit\\u001Fname", "unit\u001fname", "<'unit\\u001fname' 1>"),
  acceptedNameCase("unicode-u007f", "unit\\u007fname", "unit\u007fname", "<'unit\u007fname' 1>"),
  acceptedNameCase("unicode-u0080", "unit\\u0080name", "unit\u0080name", "<'unit\u0080name' 1>"),
  acceptedNameCase("unicode-u00ff", "unit\\u00FFname", "unitÿname", "<'unitÿname' 1>"),
  acceptedNameCase("unicode-u0100", "unit\\u0100name", "unitĀname", "<'unitĀname' 1>"),
  acceptedNameCase("unicode-u2028", "unit\\u2028name", "unit\u2028name", "<'unit\u2028name' 1>"),
  acceptedNameCase("unicode-u2029", "unit\\u2029name", "unit\u2029name", "<'unit\u2029name' 1>"),
  acceptedNameCase("unicode-lambda", "lambda\\u03bbname", "lambdaλname", "<'lambdaλname' 1>"),
  acceptedNameCase("unicode-high-surrogate", "high\\uD800name", "high\ud800name", "<'high\ud800name' 1>"),
  acceptedNameCase("unicode-low-surrogate", "low\\uDC00name", "low\udc00name", "<'low\udc00name' 1>"),
  acceptedNameCase("unicode-surrogate-pair", "pair\\uD83D\\uDE00name", "pair😀name", "<'pair😀name' 1>"),
  acceptedNameCase("consecutive-unicode", "pair\\u0041\\u0042name", "pairABname", "<pairABname 1>"),
  acceptedNameCase("literal-backtick", "tick`name", "tick`name", "<'tick`name' 1>"),
] as const;

export const quotedNameAcceptedFamily: AcceptedFamilyDefinition = {
  id: "family.accept.quoted-name-escapes",
  claim: "Single-quoted property keys accept every settled escape branch and representative Unicode boundaries.",
  classification: "transparent-accepted-family", variedDimension: "quoted-name escape spelling", cases: quotedNameAcceptedCases,
};

function tokenError(code: string, index: number, line = 1, column = index + 1) {
  return { operation: "tokenize-hson", stage: "tokenization", code, source: { index, line, column } } as const;
}

function rejectedEscapeCase(family: "quoted-string" | "quoted-name", id: string, source: string, code: string, index: number): RejectedCorpusCase {
  return {
    id: "hson.reject.family." + family + "." + id, claim: family + " defect " + id + " rejects deterministically.",
    classification: "materialized-rejected-family-case", ingress: "hson", escapedInput: JSON.stringify(source),
    ...(source.includes("\n") || source.includes("\r") ? { verbatimInput: source } : {}),
    taxonomy: { shape: family === "quoted-string" ? "scalar" : "object", slot: family, defect: id },
    tags: [family, "escape", "transparent-family", "rejection"],
    origin: "family.reject." + family + "-malformed-escapes",
    rationale: "One lexical slot varies only the malformed escape spelling.", disposition: "reject", source,
    expectedRejection: tokenError(code, index),
  };
}

const malformedQuotedSpellings = [
  ["unicode-zero-hex", "\\u"], ["unicode-one-hex", "\\u1"], ["unicode-two-hex", "\\u12"],
  ["unicode-three-hex", "\\u123"], ["invalid-hex-position-1", "\\uG000"],
  ["invalid-hex-position-2", "\\u0G00"], ["invalid-hex-position-3", "\\u00G0"],
  ["invalid-hex-position-4", "\\u000G"], ["unicode-interrupted-space", "\\u 000"],
  ["unicode-interrupted-quote", "\\u\"000"], ["unicode-interrupted-backslash", "\\u\\000"],
  ["unsupported-letter", "\\q"],
] as const;
const malformedQuotedCases: readonly RejectedCorpusCase[] = [
  ...malformedQuotedSpellings.map(([id, spelling]) => rejectedEscapeCase("quoted-string", id, "\"" + spelling + "\"", "invalid-json-escape", 1)),
  rejectedEscapeCase("quoted-string", "eof-during-unicode", "\"\\u12", "invalid-json-escape", 1),
  rejectedEscapeCase("quoted-string", "trailing-backslash", "\"bad\\", "invalid-json-escape", 4),
] as const;
export const malformedQuotedStringFamily: RejectedFamilyDefinition = {
  id: "family.reject.quoted-string-malformed-escapes", claim: "Malformed and unsupported quoted-string escapes reject.",
  classification: "transparent-rejected-family", variedDimension: "malformed quoted-string escape spelling", cases: malformedQuotedCases,
};

const malformedNameSpellings = [
  ["unsupported-letter", "\\q"], ["unsupported-slash", "\\/"], ["unsupported-zero", "\\0"],
  ["unsupported-hex", "\\x41"], ["unicode-zero-hex", "\\u"], ["unicode-one-hex", "\\u1"],
  ["unicode-two-hex", "\\u12"], ["unicode-three-hex", "\\u123"],
  ["invalid-hex-position-1", "\\uG000"], ["invalid-hex-position-2", "\\u0G00"],
  ["invalid-hex-position-3", "\\u00G0"], ["invalid-hex-position-4", "\\u000G"],
  ["unicode-interrupted-space", "\\u 000"], ["unicode-interrupted-quote", "\\u\"000"],
  ["unicode-interrupted-closer", "\\u>000"],
  ["unicode-interrupted-backslash", "\\u\\000"],
] as const;
const malformedNameCases: readonly RejectedCorpusCase[] = [
  ...malformedNameSpellings.map(([id, spelling]) => rejectedEscapeCase("quoted-name", id, "<'" + spelling + "' 1>", "invalid-name-escape", 2)),
  rejectedEscapeCase("quoted-name", "unicode-interrupted-apostrophe", "<'\\u'000' 1>", "HSON_NAME_UNTERMINATED", 8),
  rejectedEscapeCase("quoted-name", "eof", "<'name", "HSON_NAME_UNTERMINATED", 1),
  rejectedEscapeCase("quoted-name", "trailing-backslash", "<'name\\", "invalid-name-escape", 6),
] as const;
export const malformedQuotedNameFamily: RejectedFamilyDefinition = {
  id: "family.reject.quoted-name-malformed-escapes", claim: "Malformed and unsupported quoted-name escapes reject.",
  classification: "transparent-rejected-family", variedDimension: "malformed quoted-name escape spelling", cases: malformedNameCases,
};

function rawControlCases(family: "quoted-string" | "quoted-name"): readonly RejectedCorpusCase[] {
  return Array.from({ length: 32 }, (_, codePoint) => {
    const hex = codePoint.toString(16).padStart(4, "0");
    const source = family === "quoted-string" ? "\"a" + String.fromCharCode(codePoint) + "b\"" : "<'a" + String.fromCharCode(codePoint) + "b' 1>";
    return {
      id: "hson.reject.family." + family + ".raw-u" + hex,
      claim: "Raw U+" + hex.toUpperCase() + " rejects in a " + family + ".",
      classification: "materialized-rejected-family-case", ingress: "hson",
      escapedInput: family === "quoted-string" ? "\"a\\u" + hex + "b\"" : "<'a\\u" + hex + "b' 1>",
      verbatimInput: source,
      taxonomy: { shape: family === "quoted-string" ? "scalar" : "object", slot: family, defect: "raw-u" + hex },
      tags: [family, "raw-c0", "transparent-family", "rejection"], origin: "family.reject." + family + "-raw-c0",
      rationale: "The finite 32-case family visibly materializes every raw C0 code point.",
      disposition: "reject", source,
      expectedRejection: tokenError(family === "quoted-string" ? "HSON_STRING_CONTROL_UNESCAPED" : "HSON_NAME_CONTROL_UNESCAPED", family === "quoted-string" ? 2 : 3),
    };
  });
}
const rawQuotedControlCases = rawControlCases("quoted-string");
const rawQuotedNameControlCases = rawControlCases("quoted-name");
export const rawQuotedControlFamily: RejectedFamilyDefinition = {
  id: "family.reject.quoted-string-raw-c0", claim: "Every raw U+0000–U+001F control rejects inside a quoted string.",
  classification: "transparent-rejected-family", variedDimension: "raw C0 code point", cases: rawQuotedControlCases,
};
export const rawQuotedNameControlFamily: RejectedFamilyDefinition = {
  id: "family.reject.quoted-name-raw-c0", claim: "Every raw U+0000–U+001F control rejects inside a single-quoted name.",
  classification: "transparent-rejected-family", variedDimension: "raw C0 code point", cases: rawQuotedNameControlCases,
};

const unsupportedWhitespaceCodePoints = [
  0x000b, 0x000c, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
  0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
] as const;
const unsupportedWhitespaceCases: readonly RejectedCorpusCase[] = unsupportedWhitespaceCodePoints.map((codePoint) => {
  const hex = codePoint.toString(16).padStart(4, "0"); const source = "1" + String.fromCodePoint(codePoint);
  return {
    id: "hson.reject.family.unsupported-whitespace.u" + hex,
    claim: "Unsupported whitespace U+" + hex.toUpperCase() + " rejects outside a quoted token.",
    classification: "materialized-rejected-family-case", ingress: "hson", escapedInput: "1\\u" + hex, verbatimInput: source,
    taxonomy: { shape: "scalar", slot: "trivia", defect: "unsupported-u" + hex },
    tags: ["trivia", "unicode", "transparent-family", "rejection"], origin: "family.reject.unsupported-whitespace",
    rationale: "Only the unsupported whitespace code point varies.", disposition: "reject", source,
    expectedRejection: tokenError("HSON_UNSUPPORTED_WHITESPACE", 1),
  };
});
export const unsupportedWhitespaceFamily: RejectedFamilyDefinition = {
  id: "family.reject.unsupported-whitespace", claim: "Whitespace outside SPACE, HT, LF, and CR rejects.",
  classification: "transparent-rejected-family", variedDimension: "unsupported whitespace code point", cases: unsupportedWhitespaceCases,
};

export const authoredAcceptedFamilies = [quotedStringAcceptedFamily, quotedNameAcceptedFamily] as const;
export const authoredRejectedFamilies = [
  malformedQuotedStringFamily, malformedQuotedNameFamily, rawQuotedControlFamily,
  rawQuotedNameControlFamily, unsupportedWhitespaceFamily,
] as const;
