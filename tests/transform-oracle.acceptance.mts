import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";
import {
  assertCanonicalClosure,
  assertCanonicalCycleConvergence,
  assertCanonicalRejection,
  assertCanonicalRuntimeParity,
  assert_canonical_oracle_graph_equal,
  TransformOracleAssertionError,
  type TransformRegressionCase,
} from "../src/_tests/transform-oracle.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { serialize_hson } from "../src/api/transform/serializers/serialize-hson.ts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import { hsonTransform } from "../src/api/transform/index.ts";
import {
  canonical_hson_graph_difference,
  canonical_hson_graph_equal,
} from "../src/core/canonical-hson-equal.ts";
import {
  read_transform_error_details,
  TransformError,
} from "../src/core/errors.ts";
import type { HsonNode } from "../src/core/types.ts";

const LAUNCHER = "transform.canonical-oracle";
const Q1 = "0000000000000001";
const Q2 = "0000000000000002";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function node(
  tag: string,
  content: HsonNode["$_content"] = [],
  attrs?: HsonNode["$_attrs"],
  meta?: HsonNode["$_meta"],
): HsonNode {
  return {
    $_tag: tag,
    ...(attrs === undefined ? {} : { $_attrs: attrs }),
    ...(meta === undefined ? {} : { $_meta: meta }),
    $_content: content,
  };
}

function parse_value(source: string): HsonNode {
  return detach_hson_root_value(parse_hson(source));
}

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expect_oracle_failure(
  fn: () => unknown,
  classification: TransformOracleAssertionError["classification"],
): TransformOracleAssertionError {
  const error = capture(fn);
  assert.ok(error instanceof TransformOracleAssertionError);
  assert.equal(error.classification, classification);
  return error;
}

function clone_without_quids(input: HsonNode): HsonNode {
  const output = structuredClone(input);
  const visit = (current: HsonNode): void => {
    if (current.$_meta?.quid !== undefined) {
      delete current.$_meta.quid;
      if (Object.keys(current.$_meta).length === 0) delete current.$_meta;
    }
    for (const child of current.$_content) {
      if (typeof child === "object" && child !== null) visit(child);
    }
  };
  visit(output);
  return output;
}

function assert_structured_rejection(input: Readonly<{
  caseId: string;
  operation: string;
  source?: string;
  candidate?: HsonNode;
  expectedCode: string;
  expectedOperation: string;
  expectedStage: string;
  expectedSource?: Readonly<{ index: number; line: number; column: number }>;
  expectedPath?: string;
  message: RegExp;
  run: () => unknown;
}>): void {
  const direct = capture(input.run);
  assert.ok(direct instanceof Error);
  assert.match(direct.message, input.message);
  const directDetails = read_transform_error_details(direct);
  assert.ok(directDetails);
  assert.equal(directDetails.operation, input.expectedOperation);
  assert.equal(directDetails.code, input.expectedCode);
  assert.equal(directDetails.stage, input.expectedStage);
  if (input.expectedSource !== undefined) assert.deepEqual(directDetails.source, input.expectedSource);
  if (input.expectedPath !== undefined) assert.equal(directDetails.path, input.expectedPath);

  const result = assertCanonicalRejection({
    launcher: LAUNCHER,
    caseId: input.caseId,
    operation: input.operation,
    ingress: input.source === undefined ? "canonical-node" : "hson-source",
    source: input.source,
    candidate: input.candidate,
    expectedCode: input.expectedCode,
    expectedStage: input.expectedStage,
    run: input.run,
    repetitions: 3,
  });
  assert.equal(result.details.code, input.expectedCode);
  assert.match(result.witnessBody, new RegExp(input.expectedCode));
}

check("separately allocated canonical graphs compare equal", () => {
  const left = parse_value(`<p @${Q1} class="copy" "text"/>`);
  const right = parse_value(`<p @${Q1} class="copy" "text"/>`);
  assert.notEqual(left, right);
  assert.equal(canonical_hson_graph_equal(left, right), true);
  assert.doesNotThrow(() => assert_canonical_oracle_graph_equal({
    launcher: LAUNCHER,
    caseId: "identical-allocation",
    operation: "compare",
    expected: left,
    actual: right,
  }));
});

check("canonical differences distinguish scalar types and negative zero", () => {
  assert.equal(canonical_hson_graph_difference(node("_hson_val", [0]), node("_hson_val", ["0"]))?.kind, "value-type-mismatch");
  assert.equal(canonical_hson_graph_difference(node("_hson_val", [0]), node("_hson_val", [-0]))?.kind, "negative-zero-mismatch");
  assert.equal(canonical_hson_graph_difference(node("_hson_val", [1]), node("_hson_val", [2]))?.kind, "scalar-value-mismatch");
});

check("canonical differences identify member names and ordered content", () => {
  const member = (name: string, value: number) => node(name, [node("_hson_obj", [node("_hson_val", [value])])]);
  const first = node("_hson_obj", [member("a", 1), member("b", 2)]);
  const renamed = node("_hson_obj", [member("z", 1), member("b", 2)]);
  const reordered = node("_hson_obj", [member("b", 2), member("a", 1)]);
  assert.equal(canonical_hson_graph_difference(first, renamed)?.kind, "node-name-mismatch");
  assert.equal(canonical_hson_graph_difference(first, reordered)?.kind, "content-ordering");

  const array = parse_value(`«1,2»`);
  const reversed = structuredClone(array);
  reversed.$_content.reverse();
  assert.equal(canonical_hson_graph_difference(array, reversed)?.kind, "content-ordering");
});

check("canonical differences identify index, QUID, and metadata presence", () => {
  const indexed = node("_hson_ii", [node("_hson_val", [1])], undefined, { index: "0" });
  const changedIndex = node("_hson_ii", [node("_hson_val", [1])], undefined, { index: "1" });
  assert.equal(canonical_hson_graph_difference(indexed, changedIndex)?.kind, "array-index-difference");

  const quid = node("tag", [], undefined, { quid: Q1 });
  const changedQuid = node("tag", [], undefined, { quid: Q2 });
  assert.equal(canonical_hson_graph_difference(quid, changedQuid)?.kind, "quid-difference");
  assert.equal(canonical_hson_graph_difference(quid, node("tag"))?.kind, "metadata-presence");
});

check("canonical differences identify modes, roots, and missing or extra children", () => {
  assert.equal(canonical_hson_graph_difference(node("_hson_obj"), node("_hson_elem"))?.kind, "structural-mode-mismatch");
  assert.equal(canonical_hson_graph_difference(node("_hson_root", [node("_hson_val", [1])]), node("_hson_val", [1]))?.kind, "root-leakage");
  const short = node("_hson_elem", [node("a")]);
  const long = node("_hson_elem", [node("a"), node("b")]);
  assert.equal(canonical_hson_graph_difference(short, long)?.content, "missing-node");
  assert.equal(canonical_hson_graph_difference(long, short)?.content, "extra-node");
});

check("readable and compact sources close to the same canonical graph", () => {
  const readable = assertCanonicalClosure({
    launcher: LAUNCHER,
    caseId: "readable-closure",
    ingress: "hson-source",
    source: `<p "first" <em "middle"/> "last"/>`,
    cycles: 3,
  });
  const compact = assertCanonicalClosure({
    launcher: LAUNCHER,
    caseId: "compact-closure",
    ingress: "hson-source",
    source: `<p "first"<em "middle"/>"last"/>`,
    serializeOptions: { noBreak: true },
    cycles: 3,
  });
  assert.equal(canonical_hson_graph_equal(readable.reparsed, compact.reparsed), true);
});

check("noQuid closure uses one explicit expected projection", () => {
  const semantic = parse_value(`<p @${Q1} "first" <em @${Q2} "middle"/>/>`);
  const expected = clone_without_quids(semantic);
  assertCanonicalClosure({
    launcher: LAUNCHER,
    caseId: "noquid-projection",
    ingress: "canonical-node",
    node: semantic,
    expectedNode: expected,
    serializeOptions: { noQuid: true },
    cycles: 3,
  });
  assert.equal(semantic.$_meta?.quid, undefined);
  assert.equal((semantic.$_content[0] as HsonNode).$_meta?.quid, Q1);
});

check("ordinary closure is nonmutating and repeated cycles converge", () => {
  const semantic = parse_value(`<article @${Q1} data-user="Ada" "before" <strong "middle"/> "after"/>`);
  const before = structuredClone(semantic);
  assertCanonicalClosure({
    launcher: LAUNCHER,
    caseId: "stable-cycles",
    ingress: "canonical-node",
    node: semantic,
    cycles: 5,
  });
  assert.deepEqual(semantic, before);
});

check("authored reserved names expose stable lexical identity", () => {
  const source = `<_hson_obj>`;
  assert_structured_rejection({
    caseId: "reserved-name",
    operation: "parse_hson",
    source,
    expectedCode: "authored-reserved-name",
    expectedOperation: "tokenize-hson.authored-name",
    expectedStage: "tokenization",
    expectedSource: { index: 1, line: 1, column: 2 },
    message: /authored HSON name "_hson_obj".*1:2 \(index 1\)/,
    run: () => parse_hson(source),
  });
});

check("malformed escapes expose stable lexical identity", () => {
  const source = String.raw`<tag value="\q"/>`;
  assert_structured_rejection({
    caseId: "malformed-escape",
    operation: "parse_hson",
    source,
    expectedCode: "invalid-json-escape",
    expectedOperation: "tokenize-hson",
    expectedStage: "tokenization",
    expectedSource: { index: 12, line: 1, column: 13 },
    message: /unsupported escape.*quoted attribute "value".*1:13 \(index 12\)/,
    run: () => parse_hson(source),
  });
});

check("missing object-member values expose stable lexical identity", () => {
  const source = `<member >`;
  assert_structured_rejection({
    caseId: "missing-object-value",
    operation: "parse_hson",
    source,
    expectedCode: "missing-object-member-value",
    expectedOperation: "tokenize-hson",
    expectedStage: "tokenization",
    expectedSource: { index: 1, line: 1, column: 2 },
    message: /object member "member" is missing its value.*1:2 \(index 1\)/,
    run: () => parse_hson(source),
  });
});

check("legacy doubled objects expose stable lexical identity", () => {
  const source = `<<a 1>>`;
  assert_structured_rejection({
    caseId: "legacy-doubled-object",
    operation: "parse_hson",
    source,
    expectedCode: "legacy-doubled-object-syntax",
    expectedOperation: "tokenize-hson",
    expectedStage: "tokenization",
    expectedSource: { index: 1, line: 1, column: 2 },
    message: /legacy doubled object syntax.*1:2 \(index 1\)/,
    run: () => parse_hson(source),
  });
});

check("object QUID admission exposes stable lexical identity", () => {
  const source = `<member @${Q1} "value">`;
  assert_structured_rejection({
    caseId: "object-quid",
    operation: "parse_hson",
    source,
    expectedCode: "HSON_OBJECT_QUID_FORBIDDEN",
    expectedOperation: "tokenize-hson",
    expectedStage: "tokenization",
    expectedSource: { index: 8, line: 1, column: 9 },
    message: /object members cannot author persisted QUID declarations.*1:9 \(index 8\)/,
    run: () => parse_hson(source),
  });
});

check("root serialization exposes stable admission identity", () => {
  const candidate = node("_hson_root", [node("_hson_val", [1])]);
  assert_structured_rejection({
    caseId: "root-serialization",
    operation: "serialize_hson",
    candidate,
    expectedCode: "HSON_ROOT_SERIALIZATION_FORBIDDEN",
    expectedOperation: "serialize_hson",
    expectedStage: "serialization-admission",
    expectedPath: "$",
    message: /_hson_root is an internal attachment carrier/,
    run: () => serialize_hson(candidate),
  });
});

check("object metadata serialization exposes stable graph identity", () => {
  const candidate = node("_hson_obj", [
    node("member", [node("_hson_obj", [node("_hson_str", ["value"])])], undefined, { quid: Q1 }),
  ]);
  assert_structured_rejection({
    caseId: "object-metadata",
    operation: "serialize_hson",
    candidate,
    expectedCode: "HSON_OBJECT_MEMBER_METADATA_FORBIDDEN",
    expectedOperation: "serialize_hson.emitObjectMember",
    expectedStage: "serialization-admission",
    expectedPath: `$_content[0].$_meta`,
    message: /object member <member> cannot carry metadata or a QUID/,
    run: () => serialize_hson(candidate),
  });
});

check("object-element crossings expose stable invariant identity", () => {
  const candidate = node("_hson_obj", [
    node("property", [node("_hson_elem", [node("child")])]),
  ]);
  assert_structured_rejection({
    caseId: "object-element-crossing",
    operation: "serialize_hson",
    candidate,
    expectedCode: "HSON_OBJECT_ELEMENT_STRUCTURAL_CROSSING",
    expectedOperation: "serialize_hson",
    expectedStage: "canonical-invariant-admission",
    expectedPath: `/_hson_obj/[0]/tag:property`,
    message: /object property must retain.*found element/,
    run: () => serialize_hson(candidate),
  });
});

check("the oracle reports an exact controlled input mutation path", () => {
  const candidate = node("_hson_val", [1]);
  const error = expect_oracle_failure(() => assertCanonicalRejection({
    launcher: LAUNCHER,
    caseId: "controlled-mutation",
    operation: "controlled",
    candidate,
    expectedCode: "CONTROLLED_REJECTION",
    expectedStage: "serialization",
    run: () => {
      candidate.$_content[0] = 2;
      throw new TransformError("controlled rejection", {
        operation: "controlled",
        code: "CONTROLLED_REJECTION",
        stage: "serialization",
      });
    },
  }), "input-mutation");
  assert.equal(error.witness.firstCanonicalDifference?.path, `$.$_content[0]`);
});

check("the oracle separates unexpected acceptance and error class", () => {
  expect_oracle_failure(() => assertCanonicalRejection({
    launcher: LAUNCHER,
    caseId: "unexpected-acceptance",
    operation: "controlled",
    expectedCode: "CONTROLLED",
    run: () => undefined,
  }), "unexpected-acceptance");
  expect_oracle_failure(() => assertCanonicalRejection({
    launcher: LAUNCHER,
    caseId: "unexpected-error-class",
    operation: "controlled",
    expectedCode: "CONTROLLED",
    run: () => { throw new Error("plain failure"); },
  }), "unexpected-error-class");
});

check("canonical divergence witnesses are deterministic", () => {
  const left = node("_hson_val", [1]);
  const right = node("_hson_val", [2]);
  const bodies = Array.from({ length: 3 }, () => expect_oracle_failure(() =>
    assert_canonical_oracle_graph_equal({
      launcher: LAUNCHER,
      caseId: "deterministic-divergence",
      operation: "compare",
      expected: left,
      actual: right,
    }), "canonical-divergence").witnessBody);
  assert.equal(new Set(bodies).size, 1);
  assert.match(bodies[0] ?? "", /scalar-value-mismatch/);
  assert.doesNotMatch(bodies[0] ?? "", /pid|timestamp|\.pipe/);
});

check("cycle and runtime divergence classifications are independent", () => {
  expect_oracle_failure(() => assertCanonicalCycleConvergence({
    launcher: LAUNCHER,
    caseId: "controlled-cycle",
    operation: "cycle",
    initial: node("_hson_val", [1]),
    cycles: 2,
    next: (_current, cycle) => node("_hson_val", [cycle + 1]),
  }), "nonconvergent-cycle");
  expect_oracle_failure(() => assertCanonicalRuntimeParity({
    launcher: LAUNCHER,
    caseId: "runtime-divergence",
    operation: "runtime",
    projections: [
      { runtime: "universal", run: () => node("_hson_val", [1]) },
      { runtime: "worker", run: () => node("_hson_val", [2]) },
    ],
  }), "cross-runtime-divergence");
});

check("cross-runtime parity accepts strict semantic identity", () => {
  const source = `<record <name "Ada" active true>>`;
  const projections = assertCanonicalRuntimeParity({
    launcher: LAUNCHER,
    caseId: "runtime-parity",
    operation: "runtime",
    projections: [
      { runtime: "direct", run: () => parse_value(source) },
      { runtime: "universal", run: () => hsonTransform.fromHson(source).toNode() },
    ],
  });
  assert.equal(canonical_hson_graph_equal(projections[0]!, projections[1]!), true);
});

check("fixed regression descriptors cover every future promotion shape", () => {
  const cases: readonly TransformRegressionCase[] = [
    { kind: "valid-source-closure", caseId: "source", source: `42` },
    { kind: "invalid-source-rejection", caseId: "invalid-source", source: `<_hson_obj>`, expectedCode: "authored-reserved-name" },
    { kind: "valid-graph-serialization-closure", caseId: "graph", node: node("_hson_val", [1]) },
    { kind: "invalid-graph-serialization-rejection", caseId: "invalid-graph", node: node("_hson_root"), expectedCode: "HSON_ROOT_SERIALIZATION_FORBIDDEN" },
    { kind: "cross-runtime-parity", caseId: "runtime", fixture: node("_hson_val", [1]), runtimes: ["universal", "worker"] },
  ];
  assert.deepEqual(cases.map((entry) => entry.kind), [
    "valid-source-closure",
    "invalid-source-rejection",
    "valid-graph-serialization-closure",
    "invalid-graph-serialization-rejection",
    "cross-runtime-parity",
  ]);
});

process.stdout.write(`# ${checks} canonical Transform oracle checks passed\n`);
emit_hson_live_test_completion(LAUNCHER, checks, checks, 0);
