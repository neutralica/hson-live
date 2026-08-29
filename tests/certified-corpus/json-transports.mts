import {
  structuralJsonOrderFixtures,
  type StructuralJsonOrderFixture,
} from "../fixtures/structural-json-order-fixtures.mts";
import type { TransformErrorDetails } from "../../src/core/errors.ts";
import type { AcceptedCorpusCase, RejectedCorpusCase } from "./corpus-types.mts";
import { obj, property, str } from "./graph-expectations.mts";

function acceptedOrderCase(fixture: StructuralJsonOrderFixture): AcceptedCorpusCase {
  return {
    id: "json.accept." + fixture.id,
    claim: "Structural JSON preserves the handwritten canonical property sequence for " + fixture.id + ".",
    classification: "structural-json-transport", ingress: "graph", escapedInput: JSON.stringify(fixture.graph),
    taxonomy: { shape: fixture.graph.$_tag, slot: "object-property-order", variation: fixture.id },
    tags: ["json", "property-order", "transport"], origin: fixture.id,
    rationale: "The graph, JSON text, and expected nested key sequences are handwritten in the ordered JSON fixture inventory.",
    disposition: "accept", graphIngress: fixture.graph, expectedGraph: fixture.graph,
    expectedOutputs: { json: fixture.expectedJson }, expectedKeySequences: fixture.expectedObjectOrders, cycles: 4,
    ...(fixture.id.endsWith("negative-zero") ? { negativeZeroPaths: ["$.$_content[1].$_content[0].$_content[0].$_content[0]"] } : {}),
    specializedTestIds: ["tests/fixtures/structural-json-order-fixtures.mts#" + fixture.id],
  };
}

const unusualGraph = obj(
  property(":x", str("colon")),
  property("a.b", str("dot")),
  property("", str("empty")),
);

const unusualAuthoredKeyCase: AcceptedCorpusCase = {
  id: "json.accept.unusual-authored-keys",
  claim: "Structural JSON preserves keys whose authored-Hson canonical spelling uses single-quoted names.",
  classification: "structural-json-transport", ingress: "graph", escapedInput: JSON.stringify(unusualGraph),
  taxonomy: { shape: "object", slot: "object-property-order", variation: "unusual-authored-keys" },
  tags: ["json", "property-order", "quoted-name", "transport"], origin: "certified-corpus-design",
  rationale: "The expected order is authored directly rather than recovered through JavaScript object enumeration.",
  disposition: "accept", graphIngress: unusualGraph, expectedGraph: unusualGraph,
  expectedOutputs: { json: "{\n  \":x\": \"colon\",\n  \"a.b\": \"dot\",\n  \"\": \"empty\"\n}" },
  expectedKeySequences: [[":x", "a.b", ""]], cycles: 4,
};

export const structuralJsonAcceptedCases: readonly AcceptedCorpusCase[] = [
  ...structuralJsonOrderFixtures.map(acceptedOrderCase),
  unusualAuthoredKeyCase,
] as const;

function duplicateError(
  source: Readonly<{ index: number; line: number; column: number }>,
  path: string,
  first: Readonly<{ index: number; line: number; column: number }>,
): TransformErrorDetails {
  return {
    operation: "parse-json", stage: "parsing", code: "HSON_JSON_DUPLICATE_PROPERTY", source, path,
    related: [{ role: "first-declaration", source: first }],
  };
}

function duplicateCase(
  id: string,
  claim: string,
  source: string,
  expectedRejection: TransformErrorDetails,
): RejectedCorpusCase {
  return {
    id: "json.reject.duplicate." + id, claim, classification: "structural-json-transport", ingress: "json-text",
    escapedInput: JSON.stringify(source), ...(source.includes("\n") ? { verbatimInput: source } : {}),
    taxonomy: { shape: "json-object", slot: "property-key", defect: id },
    tags: ["json", "duplicate", "rejection", "structured-evidence"], origin: "structural-json-duplicate-contract",
    rationale: claim, disposition: "reject", transportIngress: source, expectedRejection,
    specializedTestIds: ["tests/json-ingress.acceptance.mts#duplicate-property-keys"],
  };
}

export const structuralJsonRejectedCases: readonly RejectedCorpusCase[] = [
  duplicateCase("adjacent", "Adjacent duplicate decoded keys reject before overwrite.", "{\"x\":1,\"x\":2}", duplicateError({ index: 7, line: 1, column: 8 }, "$[\"x\"]", { index: 1, line: 1, column: 2 })),
  duplicateCase("separated", "Separated duplicate decoded keys reject before overwrite.", "{\"x\":1,\"y\":0,\"x\":2}", duplicateError({ index: 13, line: 1, column: 14 }, "$[\"x\"]", { index: 1, line: 1, column: 2 })),
  duplicateCase("decoded-equivalent", "Literal and escaped spellings of the same decoded key are duplicates.", "{\"x\":1,\"\\u0078\":2}", duplicateError({ index: 7, line: 1, column: 8 }, "$[\"x\"]", { index: 1, line: 1, column: 2 })),
  duplicateCase("nested", "Nested duplicate keys report their nested structural path.", "{\"outer\":{\"x\":1,\"x\":2}}", duplicateError({ index: 16, line: 1, column: 17 }, "$[\"outer\"][\"x\"]", { index: 10, line: 1, column: 11 })),
  duplicateCase("array-contained", "Duplicate keys inside an array-contained object report the array path.", "[{\"x\":1,\"x\":2}]", duplicateError({ index: 8, line: 1, column: 9 }, "$[0][\"x\"]", { index: 2, line: 1, column: 3 })),
  duplicateCase("order-coexistence", "Duplicate rejection remains primary when integer-like ordering is also present.", "{\"10\":1,\"2\":2,\"10\":3}", duplicateError({ index: 14, line: 1, column: 15 }, "$[\"10\"]", { index: 1, line: 1, column: 2 })),
  duplicateCase("multiline-evidence", "Multiline duplicate coordinates identify both declarations exactly.", "{\n \"x\":1,\n \"x\":2\n}", duplicateError({ index: 11, line: 3, column: 2 }, "$[\"x\"]", { index: 3, line: 2, column: 2 })),
] as const;
