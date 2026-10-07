import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { create_hson_source_program, discover_hson_tagged_templates } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import { discover_static_from_hson_sources } from "../../../src/internal/embedded-hson/discover-static-from-hson-sources.js";
import { apply_hson_diagnostic_expectations, type ExpectationRegion } from "../src/diagnostic-expectations.js";
import { produce_document_diagnostics, type DocumentDiagnosticSpec } from "../src/document-diagnostics.js";
import { local_hson_schema_diagnostics } from "../src/hson-schema-local.js";

const prefix = 'import { Hson, hsonTransform } from "hson-live";\n';
const canonicalCode = "HSON_INTERPOLATION_CANONICAL_STATIC_TYPE";
const target = 'Hson.canonical`${bad}`;';
let checks = 0;
function check(name: string, body: () => void): void {
  body();
  process.stdout.write(`ok expectation ${++checks} - ${name}\n`);
}

function context(text: string, fileName = "/workspace/expectations.ts") {
  const program = create_hson_source_program(fileName, text);
  const file = program.getSourceFile(fileName);
  assert.ok(file);
  const discovery = discover_hson_tagged_templates(fileName, text, program);
  const regions: ExpectationRegion[] = [
    ...[...discovery.sources, ...discovery.interpolated].map((source): ExpectationRegion => ({
      kind: "template", range: { start: source.tagRange.start, end: source.templateRange.end },
    })),
    ...discover_static_from_hson_sources(fileName, text, program).sources.map((source): ExpectationRegion => ({
      kind: "static-source", range: source.callRange,
    })),
  ];
  return { file, regions };
}

function spec(text: string, code?: string, token = "bad"): DocumentDiagnosticSpec {
  const start = text.lastIndexOf(token);
  assert.ok(start >= 0);
  return { ...(code === undefined ? {} : { code }), source: "Hson", message: code ?? "uncoded",
    range: { start, end: start + token.length }, precision: "exact", related: [] };
}

function apply(text: string, diagnostics: readonly DocumentDiagnosticSpec[] = [], fileName?: string) {
  const { file, regions } = context(text, fileName);
  return apply_hson_diagnostic_expectations(file, regions, diagnostics);
}

function produce(text: string, fileName = "/workspace/expectations.ts") {
  return produce_document_diagnostics({ text, fileName, languageId: fileName.endsWith(".tsx") ? "typescriptreact" : "typescript" });
}

check("exact code consumes one original diagnostic and missing/wrong codes fail", () => {
  const text = prefix + "// @hson-expect-error CODE_A\n" + target;
  const a = spec(text, "CODE_A"), b = spec(text, "CODE_B");
  assert.deepEqual(apply(text, [a]), []);
  const missing = apply(text);
  assert.equal(missing[0]?.code, "HSON_EXPECT_ERROR_UNUSED");
  assert.equal(missing[0]?.message, "Expected Hson diagnostic CODE_A was not reported for this target.");
  assert.equal(missing[0]?.source, "Hson");
  assert.deepEqual(missing[0]?.range, { start: text.indexOf("@hson-expect-error"), end: text.indexOf("CODE_A") + 6 });
  const wrong = apply(text, [b]);
  assert.strictEqual(wrong[0], b);
  assert.equal(wrong[1]?.code, "HSON_EXPECT_ERROR_UNUSED");
  assert.deepEqual(apply(text, [a, b]), [b]);
  assert.equal(apply(text.replace("CODE_A", "code_a"), [a])[1]?.code, "HSON_EXPECT_ERROR_UNUSED");
});

check("source range order consumes one occurrence and preserves survivor order/ranges", () => {
  const text = prefix + "// @hson-expect-error CODE_A\nHson.canonical`${early} ${bad}`;";
  const first = spec(text, "CODE_A", "early"), second = spec(text, "CODE_A");
  const other = spec(text, "CODE_B");
  assert.deepEqual(apply(text, [second, other, first]), [second, other]);
  assert.deepEqual(apply(text, [second, first])[0]?.range, second.range);
  const tied = { ...first, message: "same range, later original occurrence" };
  assert.deepEqual(apply(text, [first, tied]), [tied]);
});

check("repeated directives consume distinct diagnostics, including repeated codes", () => {
  const text = prefix + "// @hson-expect-error CODE_A\n// @hson-expect-error CODE_A\n" + target;
  const a = spec(text, "CODE_A");
  assert.deepEqual(apply(text, [a, { ...a }]), []);
  const missing = apply(text, [a]);
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.range.start, text.lastIndexOf("@hson-expect-error"));
  const distinct = text.replace("// @hson-expect-error CODE_A\nHson", "// @hson-expect-error CODE_B\nHson");
  assert.deepEqual(apply(distinct, [spec(distinct, "CODE_A"), spec(distinct, "CODE_B")]), []);
});

check("missing code, extra tokens and suppression syntax are invalid", () => {
  for (const syntax of ["", "CODE_A CODE_B", "CODE_A explanation", "CODE_A,CODE_B", "CODE_*", "/CODE/"]) {
    const text = prefix + "// @hson-expect-error" + (syntax ? " " + syntax : "") + "\n" + target;
    const original = spec(text, "CODE_A");
    const result = apply(text, [original]);
    assert.strictEqual(result[0], original);
    assert.equal(result[1]?.code, "HSON_EXPECT_ERROR_INVALID");
    assert.equal(result[1]?.message, "@hson-expect-error requires exactly one diagnostic code.");
    assert.deepEqual(result[1]?.range, { start: text.indexOf("@hson-expect-error"), end: text.indexOf("\nHson") });
  }
});

check("uncoded, generic and expectation-generated errors never satisfy expectations", () => {
  for (const code of [undefined, "TRANSFORM_ERROR", "HSON_EXPECT_ERROR_UNUSED", "HSON_EXPECT_ERROR_INVALID"]) {
    const text = prefix + `// @hson-expect-error ${code ?? "CODE_A"}\n` + target;
    const original = spec(text, code);
    const result = apply(text, [original]);
    assert.strictEqual(result[0], original);
    assert.equal(result[1]?.code, "HSON_EXPECT_ERROR_UNUSED");
  }
  const text = prefix + "// @hson-expect-error HSON_EXPECT_ERROR_UNUSED\n// @hson-expect-error CODE_A\n" + target;
  assert.deepEqual(apply(text).map(item => item.code), ["HSON_EXPECT_ERROR_UNUSED", "HSON_EXPECT_ERROR_UNUSED"]);
  const numericText = prefix + "// @hson-expect-error CODE_A\n" + target;
  const numeric = spec(numericText, "CODE_A");
  Object.defineProperty(numeric, "code", { value: 95002 });
  const result = apply(numericText, [numeric]);
  assert.strictEqual(result[0], numeric);
  assert.equal(result[1]?.code, "HSON_EXPECT_ERROR_UNUSED");
});

check("full primary-range containment is required; related ranges cannot satisfy", () => {
  const text = prefix + "// @hson-expect-error CODE_A\n" + target;
  const inside = spec(text, "CODE_A");
  const start = text.indexOf("Hson.canonical");
  const overlap = { ...inside, range: { start: start - 1, end: inside.range.end }, related: [{ message: "inside", range: inside.range }] };
  const outside = { ...inside, range: { start: 0, end: 1 }, related: overlap.related };
  for (const original of [overlap, outside]) {
    const result = apply(text, [original]);
    assert.strictEqual(result[0], original);
    assert.equal(result[1]?.code, "HSON_EXPECT_ERROR_UNUSED");
  }
});

check("multiline, trivia, TS directive, wrappers and all eligible statement kinds associate", () => {
  const directive = `// @hson-expect-error ${canonicalCode}\n`;
  const cases = [
    directive + 'const x = Hson.canonical`\n\n  ${{}}\n`; ',
    directive + '\n// ordinary comment\n/* block trivia */\nHson.canonical`${{}}`;',
    '// @ts-expect-error Tagged substitutions exclude objects.\n' + directive + 'Hson.canonical`${{}}`;',
    directive + '// @ts-expect-error\nHson.canonical`${{}}`;',
    directive + 'const x = (Hson.canonical`${{}}`);',
    directive + 'const x = consume(Hson.canonical`${{}}`);',
    'function f() {\n' + directive + 'return Hson.canonical`${{}}`;\n}',
    'function f() {\n' + directive + 'throw Hson.canonical`${{}}`;\n}',
    directive + 'Hson.canonical`${{}}`;',
    directive + 'const x = [Hson.canonical`${{}}`, () => Hson.canonical`37`];',
  ];
  for (const body of cases) assert.deepEqual(produce(prefix + body), [], body);
  const document = prefix + '// @hson-expect-error HSON_INTERPOLATION_DOCUMENT_STATIC_TYPE\nconst x = Hson.document`\n<main\n${1n}\n/>\n`;';
  assert.deepEqual(produce(document), []);
  assert.deepEqual(produce((prefix + cases[0]).replaceAll("\n", "\r\n")), []);
});

check("no target, unrelated statements and non-list statements fail without drifting", () => {
  for (const suffix of ["", "const unrelated = 1;\n" + target, "if (true) " + target,
    "function f() { " + target + " }", "class C { f() { " + target + " } }"] ) {
    const text = prefix + "// @hson-expect-error CODE_A\n" + suffix;
    const diagnostics = suffix.includes("bad") ? [spec(text, "CODE_A")] : [];
    const result = apply(text, diagnostics);
    assert.deepEqual(result.slice(0, diagnostics.length), diagnostics);
    assert.equal(result.at(-1)?.code, "HSON_EXPECT_ERROR_UNUSED");
    assert.equal(result.at(-1)?.message, "Expected Hson diagnostic CODE_A, but no unique Hson template target was found.");
  }
  const after = prefix + 'const x = 1;\n// @hson-expect-error CODE_A';
  assert.equal(apply(after)[0]?.code, "HSON_EXPECT_ERROR_UNUSED");
  const arrow = prefix + '// @hson-expect-error CODE_A\nconst f = () => ' + target;
  assert.equal(apply(arrow, [spec(arrow, "CODE_A")])[1]?.code, "HSON_EXPECT_ERROR_UNUSED");
});

check("sibling, nested and nested static-source regions are ambiguous", () => {
  for (const statement of [
    'const x = [Hson.canonical`${bad}`, Hson.canonical`37`];',
    'const x = Hson.canonical`${Hson.canonical`${bad}`}`;',
    'const x = Hson.canonical`${hsonTransform.fromHson("+1")}`;',
  ]) {
    const text = prefix + '// @hson-expect-error CODE_A\n' + statement;
    const original = spec(text, "CODE_A", statement.includes("bad") ? "bad" : "+1");
    const result = apply(text, [original]);
    assert.strictEqual(result[0], original);
    assert.equal(result[1]?.code, "HSON_EXPECT_ERROR_UNUSED");
  }
});

check("outer expectations cannot consume diagnostics owned by nested function/class regions", () => {
  for (const expression of [
    '(() => Hson.canonical`${{}}`)()',
    '(function () { return Hson.canonical`${{}}`; })()',
    '(() => { class C { value() { return Hson.canonical`${{}}`; } } return new C().value(); })()',
  ]) {
    const body = 'const x = Hson.canonical`${' + expression + '}`;';
    assert.deepEqual(produce(prefix + body).map(item => item.code), [canonicalCode]);
    const text = prefix + `// @hson-expect-error ${canonicalCode}\n` + body;
    const result = produce(text);
    const innerStart = text.indexOf("${{}}") + 2;
    assert.deepEqual(result.map(item => item.code), [canonicalCode, "HSON_EXPECT_ERROR_UNUSED"]);
    assert.deepEqual(result[0]?.range, { start: innerStart, end: innerStart + 2 });
    assert.deepEqual(result[1]?.range, { start: text.indexOf("@hson-expect-error"), end: text.indexOf("\nconst x") });
    // Selection still finds the unique outer target; ownership rejects the inner occurrence.
    assert.equal(result[1]?.message, `Expected Hson diagnostic ${canonicalCode} was not reported for this target.`);
  }
});

check("outer matching preserves earlier nested occurrences with identical or different codes", () => {
  const directive = `// @hson-expect-error ${canonicalCode}\n`;
  const same = prefix + directive + 'const x = Hson.canonical`${(() => Hson.canonical`${{}}`)()} ${{}}`;';
  const ordinary = produce(same.replace(directive, ""));
  assert.deepEqual(ordinary.map(item => item.code), [canonicalCode, canonicalCode]);
  const result = produce(same);
  const innerStart = same.indexOf("${{}}") + 2;
  assert.deepEqual(result.map(item => item.code), [canonicalCode]);
  assert.deepEqual(result[0]?.range, { start: innerStart, end: innerStart + 2 });
  const different = prefix + directive + 'const x = Hson.canonical`${(() => Hson.document`<main attr=${bad}/>` )()} ${{}}`;';
  const mixed = produce(different);
  const substitutionStart = different.indexOf("${bad}");
  assert.deepEqual(mixed.map(item => item.code), ["HSON_INTERPOLATION_POSITION_INVALID"]);
  assert.deepEqual(mixed[0]?.range, { start: substitutionStart, end: substitutionStart + "${bad}".length });
});

check("innermost ownership still requires full primary-range containment", () => {
  const text = prefix + '// @hson-expect-error CODE_A\nconst x = Hson.canonical`${(() => Hson.canonical`${inner}`)()} ${outer}`;';
  const { file, regions } = context(text);
  const outer = spec(text, "CODE_A", "outer"), inner = spec(text, "CODE_A", "inner");
  // A range extending beyond the inner template is owned by the outer template.
  const spanning = { ...inner, range: { start: inner.range.start, end: outer.range.end } };
  assert.deepEqual(apply_hson_diagnostic_expectations(file, regions, [inner, spanning, outer]), [inner, outer]);
  const outside = { ...outer, range: { start: text.indexOf("Hson.canonical"), end: text.length } };
  const result = apply_hson_diagnostic_expectations(file, regions, [inner, outside]);
  assert.deepEqual(result.slice(0, 2), [inner, outside]);
  assert.equal(result[2]?.code, "HSON_EXPECT_ERROR_UNUSED");
  let nested = 'Hson.canonical`${inner}`';
  for (let depth = 0; depth < 16; depth += 1) nested = 'Hson.canonical`${(() => ' + nested + ')()}`';
  const deep = prefix + '// @hson-expect-error CODE_A\nconst x = Hson.canonical`${(() => ' + nested + ')()} ${outer}`;';
  const deepInner = spec(deep, "CODE_A", "inner"), deepOuter = spec(deep, "CODE_A", "outer");
  assert.deepEqual(apply(deep, [deepInner, deepOuter]), [deepInner]);
});

check("closing-token and EOF trivia retains valid/invalid orphan directives exactly once", () => {
  const wrappers = [
    ["function fixture() {\n", "\n}"], ["const x = [\n", "\n];"],
    ["const x = {\n", "\n};"], ["consume(\n", "\n);"],
    ["class Fixture {\n", "\n}"], ["namespace Fixture {\n", "\n}"],
    ["", ""],
  ];
  for (const [before, after] of wrappers) {
    for (const code of [" CODE_A", ""]) {
      const text = prefix + before + "  // @hson-expect-error" + code + after;
      const result = produce(text);
      assert.deepEqual(result.map(item => item.code), [code ? "HSON_EXPECT_ERROR_UNUSED" : "HSON_EXPECT_ERROR_INVALID"], text);
      assert.deepEqual(result[0]?.range, { start: text.indexOf("@hson-expect-error"),
        end: text.indexOf("@hson-expect-error") + "@hson-expect-error".length + code.length });
    }
  }
  const crlf = prefix + "function fixture() {\r\n  // @hson-expect-error CODE_A\r\n}";
  assert.deepEqual(produce(crlf).map(item => item.code), ["HSON_EXPECT_ERROR_UNUSED"]);
});

check("statement-list boundaries retain orphan assertions without drifting out of a block", () => {
  const directive = `// @hson-expect-error ${canonicalCode}\n`;
  assert.deepEqual(produce(prefix + "{\n" + directive + 'Hson.canonical`${{}}`;\n}'), []);
  const text = prefix + "function f() {\n" + directive + '}\nHson.canonical`${{}}`;';
  const result = produce(text);
  assert.deepEqual(result.map(item => item.code), [canonicalCode, "HSON_EXPECT_ERROR_UNUSED"]);
  const diagnosticStart = text.indexOf("${{}}") + 2;
  assert.deepEqual(result[0]?.range, { start: diagnosticStart, end: diagnosticStart + 2 });
});

check("physical comments are not duplicated across stacked directives and EOF trivia", () => {
  const text = prefix + "// @hson-expect-error CODE_A\n// @hson-expect-error CODE_A\n" + target
    + "\n// @hson-expect-error\n// @hson-expect-error CODE_A";
  const result = apply(text, [spec(text, "CODE_A")]);
  assert.deepEqual(result.map(item => item.code), ["HSON_EXPECT_ERROR_UNUSED", "HSON_EXPECT_ERROR_INVALID", "HSON_EXPECT_ERROR_UNUSED"]);
  const starts = [...text.matchAll(/@hson-expect-error/g)].map(match => match.index);
  assert.deepEqual(result.map(item => item.range.start), starts.slice(1));
});

check("large directive sets build the token/statement index in one source pass", () => {
  const count = 1_000;
  const text = prefix + Array.from({ length: count }, (_, index) =>
    `// @hson-expect-error CODE_A\nconst x${index} = Hson.canonical\`37\`;\n`).join("");
  const { file, regions } = context(text);
  const getChildren = file.getChildren.bind(file);
  let passes = 0;
  file.getChildren = sourceFile => { passes += 1; return getChildren(sourceFile); };
  const diagnostics: DocumentDiagnosticSpec[] = regions.map(region => ({ code: "CODE_A", source: "Hson",
    message: "matching occurrence", range: { start: region.range.start, end: region.range.start }, precision: "exact", related: [] }));
  assert.deepEqual(apply_hson_diagnostic_expectations(file, regions, diagnostics), []);
  assert.equal(passes, 1);
  const result = apply_hson_diagnostic_expectations(file, regions, []);
  assert.equal(passes, 2);
  assert.equal(result.length, count);
  assert.equal(result.every(item => item.code === "HSON_EXPECT_ERROR_UNUSED"), true);
});

check("only standalone real line comments create expectations", () => {
  const payloads = [
    'const x = "// @hson-expect-error CODE_A";',
    'const x = `// @hson-expect-error CODE_A`;',
    'const x = `prefix${37}\n// @hson-expect-error CODE_A`;',
    'Hson.canonical`"// @hson-expect-error CODE_A"`;',
    'Hson.canonical`// @hson-expect-error CODE_A\n37`;',
    String.raw`const x = /\/\/ @hson-expect-error CODE_A/;`,
    '/* @hson-expect-error CODE_A */',
    '/**\n// @hson-expect-error CODE_A\n*/',
    'const x = 37; // @hson-expect-error CODE_A',
    '// @hson-expect-error-extra CODE_A',
  ];
  for (const payload of payloads) {
    const text = prefix + payload + "\n" + target;
    assert.deepEqual(create_hson_source_program("/workspace/expectations.ts", text).getSyntacticDiagnostics(), [], payload);
    const original = [spec(text, "CODE_A")];
    assert.strictEqual(apply(text, original), original, payload);
  }
  const jsx = prefix + 'const x = <div>\n// @hson-expect-error CODE_A\n</div>;\n' + target;
  const original = [spec(jsx, "CODE_A")];
  assert.strictEqual(apply(jsx, original, "/workspace/expectations.tsx"), original);
  const indented = prefix + "  \t// @hson-expect-error CODE_A   \n" + target;
  assert.deepEqual(apply(indented, [spec(indented, "CODE_A")]), []);
  const literalTrivia = prefix + 'const x = (\n// @hson-expect-error CODE_A\n"literal");';
  assert.deepEqual(produce(literalTrivia).map(item => item.code), ["HSON_EXPECT_ERROR_UNUSED"]);
  const substitutionTrivia = prefix + 'const x = `payload${37\n// @hson-expect-error CODE_A\n}`;';
  assert.deepEqual(produce(substitutionTrivia).map(item => item.code), ["HSON_EXPECT_ERROR_UNUSED"]);
});

check("independent targets and copied host bytes behave locally", () => {
  const text = prefix + `// @hson-expect-error ${canonicalCode}\nHson.canonical` + '`${{}}`;\n'
    + `// @hson-expect-error ${canonicalCode}\nHson.canonical` + '`${[]}`;';
  assert.deepEqual(produce(text), []);
  assert.deepEqual(produce(text, "/workspace/tmp/namespace-audit-frozen-copy/fixture.ts"), []);
  const wrong = text.replaceAll(canonicalCode, "WRONG_CODE");
  assert.deepEqual(produce(wrong).map(item => item.code), [canonicalCode, canonicalCode, "HSON_EXPECT_ERROR_UNUSED", "HSON_EXPECT_ERROR_UNUSED"]);
});

check("ignore-file hides ordinary diagnostics but still fails expectations", () => {
  const text = `// @hson-diagnostics-ignore-file\n${prefix}// @hson-expect-error ${canonicalCode}\nHson.canonical` + '`${{}}`;';
  const result = produce(text);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.code, "HSON_EXPECT_ERROR_UNUSED");
});

check("ordinary diagnostics retain exact parity with no real directive", () => {
  const bodies = ['Hson.canonical`+1`;', 'Hson.document`<main attr=${bad}/>`;',
    'Hson.canonical`${{}}`;', 'hsonTransform.fromHson("+1");'];
  for (const body of bodies) {
    const text = prefix + body;
    const ordinary = produce(text);
    assert.equal(ordinary.length, 1, body);
    assert.deepEqual(produce(text + '\nconst marker = "// @hson-expect-error CODE_A";'), ordinary);
    const { file, regions } = context(text);
    assert.strictEqual(apply_hson_diagnostic_expectations(file, regions, ordinary), ordinary);
  }
});

check("one processor handles complete-template and positional codes but does not broaden targets or Schema scope", () => {
  for (const [code, body] of [
    ["HSON_NUMBER_LEADING_PLUS", 'Hson.canonical`+1`;'],
    ["HSON_INTERPOLATION_POSITION_INVALID", 'Hson.document`<main attr=${bad}/>`;'],
    ["HSON_QUOTED_INTERPOLATION_PARTIAL", 'Hson.canonical`"prefix${bad}"`;'],
    ["HSON_SCHEMA_INTERPOLATION_FORBIDDEN", 'Hson.schema`${bad}`;'],
  ]) {
    assert.deepEqual(produce(prefix + `// @hson-expect-error ${code}\n` + body), []);
  }
  const ordinaryCall = prefix + '// @hson-expect-error HSON_NUMBER_LEADING_PLUS\nhsonTransform.fromHson("+1");';
  assert.deepEqual(produce(ordinaryCall).map(item => item.code), ["HSON_NUMBER_LEADING_PLUS", "HSON_EXPECT_ERROR_UNUSED"]);
  const schema = prefix + '// @hson-expect-error UNKNOWN_SCHEMA_MEMBER\nconst S = Hson.schema`<type "data" content <name <literal "x">>>`;';
  assert.deepEqual(produce(schema).map(item => item.code), ["HSON_EXPECT_ERROR_UNUSED"]);
  assert.deepEqual(local_hson_schema_diagnostics("/workspace/expectations.ts", schema).map(item => item.code), ["UNKNOWN_SCHEMA_MEMBER"]);
});

check("unsupported diagnostic hosts do not acquire directive semantics", () => {
  const text = `// @hson-expect-error ${canonicalCode}\nHson.canonical` + '`${{}}`;';
  for (const [languageId, fileName] of [["javascript", "a.js"], ["javascriptreact", "a.jsx"],
    ["typescript", "a.mts"], ["typescript", "a.cts"], ["markdown", "a.md"]]) {
    assert.deepEqual(produce_document_diagnostics({ languageId, fileName, text: prefix + text }), []);
  }
  const standalone = produce_document_diagnostics({ languageId: "hson", fileName: "a.hson", text: "// @hson-expect-error HSON_NUMBER_LEADING_PLUS\n+1" });
  assert.deepEqual(standalone.map(item => item.code), ["HSON_NUMBER_LEADING_PLUS"]);
});

check("tracked public-entrypoint expectations consume exactly the five intentional negatives", () => {
  const fileName = resolve("../../tests/entrypoints/public/public-entrypoints.ts");
  const text = readFileSync(fileName, "utf8");
  const result = produce(text, fileName);
  assert.equal(result.some(item => item.code === "HSON_EXPECT_ERROR_UNUSED" || item.code === "HSON_EXPECT_ERROR_INVALID"), false);
  const unannotated = text.replace(/^\/\/ @hson-expect-error HSON_INTERPOLATION_CANONICAL_STATIC_TYPE\r?\n/gm, "");
  const ordinary = produce(unannotated, fileName);
  for (const expression of ['${undefined}', '${1n}', '${{}}', '${[]}', '${() => {}}']) {
    const start = unannotated.indexOf(expression) + 2;
    assert.ok(start > 1, expression);
    const expected = ordinary.filter(item => item.code === canonicalCode && item.range.start === start);
    assert.equal(expected.length, 1, expression);
    const annotatedStart = text.indexOf(expression) + 2;
    assert.equal(result.some(item => item.code === canonicalCode && item.range.start === annotatedStart), false, expression);
  }
  assert.equal(ordinary.filter(item => item.code === canonicalCode).length, 5);
  const symbolStart = text.indexOf('${Symbol()}') + 2;
  assert.equal(result.some(item => item.range.start === symbolStart), false);
  assert.equal(text.includes('// @hson-expect-error ' + canonicalCode + '\nHson.canonical`${Symbol()}`'), false);
  const symbolOnly = prefix + `// @hson-expect-error ${canonicalCode}\nHson.canonical` + '`${Symbol()}`;';
  assert.deepEqual(produce(symbolOnly).map(item => item.code), ["HSON_EXPECT_ERROR_UNUSED"]);
});
