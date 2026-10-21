import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { static_schema_candidate_diagnostics } from "../src/internal/hson-schema/candidate-diagnostics.ts";
import { discover_hson_schema_declarations } from "../src/internal/hson-schema/schema-discovery.ts";
import { resolve_immutable_schema } from "../src/internal/hson-schema/schema-identity.ts";
import { generate_hson_schema_evidence } from "../src/internal/hson-schema/generated-evidence.ts";
import { collect_part_source_facts } from "../src/internal/hson-schema/part-source.ts";
import { library_source_definitions } from "../src/internal/hson-schema/library-source.ts";
import { read_supported_hson_import_symbols } from "../src/internal/embedded-hson/discover-hson-tagged-templates.ts";
import { verified_schema_assignment_ranges } from "../editors/vscode-hson/src/schema-editor-proof.ts";
import { HsonEditorCompletionCache } from "../editors/vscode-hson/src/editor-completion.ts";
import { library_schema_attachment_plan } from "../src/internal/hson-schema/source-transformation.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "schema-type-query-provenance", title: "Schema type-query import provenance", category: "Tooling", runtime: "node", tags: Object.freeze(["schema", "typescript", "provenance", "public-api"]) });
const events = create_test_event_emitter(HSON_LIVE_TEST_METADATA.id);
const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, "tmp"), { recursive: true });
const directory = mkdtempSync(join(root, "tmp/schema-type-query-"));
process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
writeFileSync(join(directory, "package.json"), '{"type":"module"}');
const installed = join(directory, "node_modules/hson-live");
mkdirSync(installed, { recursive: true });
cpSync(join(root, "package.json"), join(installed, "package.json"));
cpSync(join(root, "dist"), join(installed, "dist"), { recursive: true });
const schemaSource = '<type "data" content <name "string">>';
const imports = 'import { Hson, type HsonData } from "hson-live";\n';
const assignment = (name: string, schema: string, content = '"Ada"') => `const ${name}: HsonData<typeof ${schema}> = Hson.data\`<name ${content}>\`;`;
const completion = (binding: string, annotation = "HsonData<typeof S>", tag = "Hson.data") =>
  imports + binding + `\nconst value: ${annotation} = ${tag}\`<na\`;`;
const files: Readonly<Record<string, string>> = {
  "schema.ts": 'import { Hson } from "hson-live";\n'
    + `export const S = Hson.schema\`${schemaSource}\`;\nexport const Alias = (S); export const Next = Alias;`,
  // The original two-file reproduction, unchanged.
  "consumer.ts": imports + 'import type { S } from "./schema.js";\n' + assignment("value", "S"),
  "value-bridge.ts": 'import { Next } from "./schema.js"; export const Alias = Next; export const Chained = Alias;',
  "type-bridge.ts": 'export type { S as Reexported, Next } from "./schema.js"; export { type Chained } from "./value-bridge.js";',
  "type-star.ts": 'export type * from "./type-bridge.js";',
  "complete-type.ts": completion('import type { S } from "./schema.js";'),
  "complete-inline.ts": completion('import { type S } from "./schema.js";'),
  "complete-value.ts": completion('import { S } from "./schema.js";'),
  "complete-reexport.ts": completion('import type { Reexported as S } from "./type-star.js";'),
  "complete-chain.ts": completion('import type { Chained as S } from "./type-star.js";'),
  "complete-annotation-alias.ts": completion('import type { Next as S } from "./schema.js"; type Alias<T extends typeof S> = HsonData<T>;', "Alias<typeof S>"),
  "complete-bad-direct.ts": completion('import type { S } from "./schema.js\n'),
  "complete-bad-import.ts": completion('import type { S } from "./malformed-import.js";'),
  "complete-bad-export.ts": completion('import type { S } from "./malformed-export.js";'),
  "complete-bad-star.ts": completion('import type { S } from "./malformed-star.js";'),
  "complete-bad-alias.ts": completion('import type { Bad as S } from "./malformed-alias.js";'),
  "complete-invalid-value-alias.ts": completion('import type { Bad as S } from "./invalid-value-alias.js";'),
  "complete-missing.ts": completion('import type { S } from "./missing.js";'),
  "complete-type-producer.ts": completion('import type { S } from "./schema.js"; import type { Hson as TypeHson } from "hson-live";', "HsonData<typeof S>", "TypeHson.data"),
  "attachments.ts": imports + [
    'import { hsonLiveMap } from "hson-live"; import { S as Value, type S as Query } from "./schema.js";',
    'const typeTarget = hsonLiveMap.fromLibraries({ entry: { data: { name: 42 } } });',
    'typeTarget.data.must("entry").schema.use(Query);',
    'const valueTarget = hsonLiveMap.fromLibraries({ entry: { data: { name: 42 } } });',
    'valueTarget.data.must("entry").schema.use(Value);',
  ].join("\n"),
  "queries.ts": imports + [
    'import type { S as Direct } from "./schema.js";',
    'import { type S as Inline, S as Value } from "./schema.js";',
    'import type { Reexported, Next, Chained } from "./type-star.js";',
    'import { Reexported as ValueFromTypeExport } from "./type-star.js";',
    ...["Direct", "Inline", "Value", "Reexported", "Next", "Chained", "ValueFromTypeExport"].map(name => assignment(name.toLowerCase(), name)),
    assignment("invalid", "Direct", "42"),
    'const runtimeFailure = Value.certify(Hson.data`<name 42>`);',
    'const forbiddenRuntime = Direct.certify(Hson.data`<name 42>`);',
    'const forbiddenReexport = ValueFromTypeExport.certify(Hson.data`<name 42>`);',
  ].join("\n"),
  "malformed-direct.ts": imports + 'import type { S } from "./schema.js\n' + assignment("value", "S"),
  "malformed-import.ts": 'import type { S as Recovered } from "./schema.js\nexport type { Recovered as S };',
  "malformed-export.ts": 'export type { S } from "./schema.js\n',
  "malformed-star.ts": 'export type * from "./schema.js\n',
  "malformed-alias.ts": 'import { S } from "./schema.js"; export const Bad = (S as );',
  "invalid-value-alias.ts": 'import type { S } from "./schema.js"; export const Bad = S;',
  "unsupported.ts": imports + [
    'import type { S as BadImport } from "./malformed-import.js";',
    'import type { S as BadExport } from "./malformed-export.js";',
    'import type { S as BadStar } from "./malformed-star.js";',
    'import type { Bad as BadAlias } from "./malformed-alias.js";',
    'import type { Bad as InvalidValueAlias } from "./invalid-value-alias.js";',
    'import type { S as Missing } from "./missing.js";',
    ...["BadImport", "BadExport", "BadStar", "BadAlias", "InvalidValueAlias", "Missing"].map(name => assignment(name.toLowerCase(), name)),
  ].join("\n"),
  "owners.ts": 'import { Hson, hsonLiveMap } from "hson-live";'
    + 'export const receiver = hsonLiveMap.locus.create({}); export const local = hsonLiveMap.create();'
    + 'export const document = Hson.document`<main/>`;',
  "runtime.ts": imports + [
    'import { hsonLiveMap } from "hson-live";',
    'import type { Hson as TypeHson, hsonLiveMap as TypeMaps } from "hson-live";',
    'import type { receiver, local, document } from "./owners.js";',
    'const badConstructor = TypeMaps.fromLibraries({ bits: { parts: {} } });',
    'const badReceiver = receiver.admit({ bits: { parts: {} } });',
    'const alias = receiver; const badAlias = alias.admit({ bits: { parts: {} } });',
    'const badLocal = local.addLibraries({ bits: { parts: {} } });',
    'const typeDocument = TypeHson.document`<main/>`;',
    'const Invalid = TypeHson.schema`<type "data" content <name "string">>`;',
    'declare const fakeHson: typeof Hson, fakeMaps: typeof hsonLiveMap;',
    'const Impostor = fakeHson.schema`<type "data" content <name "string">>`;',
    'const fakeConstructor = fakeMaps.fromLibraries({ bits: { parts: {} } });',
    'const genuine = hsonLiveMap.fromLibraries({ bits: { parts: { heading: { kind: "document", document } } } });',
    assignment("invalidProducer", "Invalid"), assignment("impostorProducer", "Impostor"),
    'const genuineSibling = Hson.schema`<type "data" content <name "string">>`;',
    assignment("sibling", "genuineSibling"),
  ].join("\n"),
};
for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text);
const evidencePath = join(directory, "evidence.ts");
writeFileSync(evidencePath, generate_hson_schema_evidence("S", schemaSource, "editor-assignment").declaration);

function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
for (const mode of ["source", "public-package"] as const) {
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true, skipLibCheck: true,
    ...(mode === "source" ? { baseUrl: root, paths: { "hson-live": ["src/index.ts"], "hson-live/hson": ["src/hson-authoring.ts"] } } : {}) };
  const program = ts.createProgram([...Object.keys(files).map(name => join(directory, name)), evidencePath], options);
  const checker = program.getTypeChecker();
  const source = (name: string) => program.getSourceFile(join(directory, name))!;
  const diagnostics = static_schema_candidate_diagnostics(ts, program);
  const issues = (name: string) => diagnostics.filter(issue => issue.file === join(directory, name));
  const ranges = (name: string) => verified_schema_assignment_ranges(ts, program, join(directory, name),
    (producer, schema) => producer === join(directory, "schema.ts") && schema === "S" ? evidencePath : undefined);
  const schemas = discover_hson_schema_declarations(ts, source("schema.ts"), checker);
  const canonical = schemas.find(schema => schema.name === "S")!.declaration;
  const annotations = (name: string) => source(name).statements.filter(ts.isVariableStatement)
    .flatMap(statement => statement.declarationList.declarations).filter(declaration => declaration.type !== undefined);

  check(`${mode}: original reproduction restores candidate and exact editor assignment proof`, () => {
    assert.deepEqual(program.getSyntacticDiagnostics(source("consumer.ts")), []);
    assert.deepEqual(issues("consumer.ts"), []);
    const start = files["consumer.ts"]!.indexOf("const value") + "const ".length;
    assert.deepEqual(ranges("consumer.ts"), [{ start, end: start + "value".length }]);
    const resolved = ts.resolveModuleName("hson-live", join(directory, "consumer.ts"), options, ts.sys).resolvedModule;
    assert.equal(resolve(resolved!.resolvedFileName), mode === "source" ? join(root, "src/index.ts") : join(installed, "dist/index.d.ts"));
  });
  check(`${mode}: direct, inline, re-export, export-star and immutable chains retain query identity`, () => {
    assert.deepEqual(program.getSyntacticDiagnostics(source("queries.ts")), []);
    for (const declaration of annotations("queries.ts")) {
      assert.ok(declaration.type && ts.isTypeReferenceNode(declaration.type));
      const query = declaration.type.typeArguments![0]!;
      assert.ok(ts.isTypeQueryNode(query) && ts.isIdentifier(query.exprName));
      const fact = (found: ts.VariableDeclaration) => found === canonical ? canonical : undefined;
      assert.equal(resolve_immutable_schema(ts, checker, query.exprName, fact, new Set(), undefined, "type-query"), canonical);
      assert.equal(resolve_immutable_schema(ts, checker, query.exprName, fact), query.exprName.text === "Value" ? canonical : undefined);
    }
    assert.deepEqual(ranges("queries.ts").map(range => source("queries.ts").text.slice(range.start, range.end)),
      ["direct", "inline", "value", "reexported", "next", "chained", "valuefromtypeexport"]);
    assert.deepEqual(issues("queries.ts").map(issue => issue.code), ["TYPE_MISMATCH", "TYPE_MISMATCH"]);
    assert.ok(issues("queries.ts").every(issue => issue.message.includes("Static Hson does not satisfy S")));
  });
  check(`${mode}: malformed type-only imports, re-exports and aliases withdraw proof locally`, () => {
    assert.ok(program.getSyntacticDiagnostics(source("malformed-direct.ts")).length > 0);
    assert.deepEqual(issues("malformed-direct.ts").map(issue => issue.code), ["HSON_SCHEMA_PROOF_UNRESOLVED"]);
    assert.deepEqual(ranges("malformed-direct.ts"), []);
    assert.deepEqual(issues("unsupported.ts").map(issue => issue.code), Array(6).fill("HSON_SCHEMA_PROOF_UNRESOLVED"));
    assert.deepEqual(ranges("unsupported.ts"), []);
    assert.deepEqual(issues("consumer.ts"), [], "Unrelated valid imports remain eligible");
  });
  check(`${mode}: type-only runtime receivers, constructors and authored producers stay ineligible`, () => {
    const facts = collect_part_source_facts(ts, program);
    const batches = facts.batches.filter(batch => batch.location.file === join(directory, "runtime.ts"));
    assert.deepEqual(batches.filter(batch => batch.eligible).map(batch => batch.call.parent.getText().split(" = ")[0]), ["genuine"]);
    const symbols = read_supported_hson_import_symbols(source("runtime.ts"), checker, [], "hsonLiveMap", ts);
    for (const batch of batches.filter(batch => !batch.eligible)) {
      assert.equal(library_source_definitions(batch.call, checker, symbols, false, ts), undefined);
      assert.equal(batch.inventoryCompleteness, "partial");
    }
    const genuine = batches.find(batch => batch.eligible)!;
    const heading = genuine.libraries[0]!.members[0]!;
    assert.equal(heading.certainty, "possible", "A type-only document import cannot prove Part admission");
    assert.equal(genuine.libraries[0]!.memberCompleteness, "partial");
    assert.deepEqual(issues("runtime.ts").map(issue => issue.code), ["HSON_SCHEMA_PROOF_UNRESOLVED", "HSON_SCHEMA_PROOF_UNRESOLVED"]);
    assert.deepEqual(ranges("runtime.ts"), []);
    const discovered = discover_hson_schema_declarations(ts, source("runtime.ts"), checker);
    assert.deepEqual(discovered.filter(schema => schema.eligible).map(schema => schema.name), ["genuineSibling"]);
  });
  check(`${mode}: annotation completion preserves type-only query identity and exact replacement ranges`, () => {
    const cache = new HsonEditorCompletionCache(ts);
    for (const name of ["complete-type.ts", "complete-inline.ts", "complete-value.ts", "complete-reexport.ts", "complete-chain.ts", "complete-annotation-alias.ts"]) {
      const text = files[name]!, start = text.indexOf("<na") + 1, cursor = start + 2;
      const entries = cache.complete(join(directory, name), text, 0, cursor, program);
      assert.deepEqual(entries.map(entry => entry.candidate.label), ["name"], `${mode}/${name}`);
      assert.deepEqual(entries[0]!.range, { start, end: cursor }, name);
      assert.equal(entries[0]!.candidate.insertText, "name", name);
      const repaired = text.slice(0, start) + entries[0]!.candidate.insertText + text.slice(cursor);
      assert.equal(repaired, text.replace("<na`", "<name`"), name);
    }
    for (const name of ["complete-bad-direct.ts", "complete-bad-import.ts", "complete-bad-export.ts", "complete-bad-star.ts", "complete-bad-alias.ts", "complete-invalid-value-alias.ts", "complete-missing.ts", "complete-type-producer.ts"]) {
      const text = files[name]!;
      assert.deepEqual(cache.complete(join(directory, name), text, 0, text.indexOf("<na") + 3, program), [], name);
    }
    cache.clear();
  });
  check(`${mode}: runtime Schema attachment wrappers retain value provenance`, () => {
    const plan = library_schema_attachment_plan(source("attachments.ts"), checker, [{ declaration: canonical, mode: "data" }], ts);
    assert.deepEqual(plan.attachments.map(attachment => attachment.schema.text), ["Value"]);
    assert.deepEqual(issues("attachments.ts").map(issue => issue.code), ["TYPE_MISMATCH"]);
    const issue = issues("attachments.ts")[0]!;
    assert.ok(issue.start > files["attachments.ts"]!.indexOf("const valueTarget"));
  });
}
events.terminal("pass");
