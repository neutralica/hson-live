import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { filter_verified_schema_assignment_diagnostics, verified_schema_assignment_ranges as assignment_ranges } from "../editors/vscode-hson/src/schema-editor-proof.ts";
import { install_live_schema_view } from "../editors/vscode-hson/src/schema-editor-view.ts";
import { static_schema_candidate_diagnostics } from "../src/internal/hson-schema/candidate-diagnostics.ts";
import { produce_document_diagnostics } from "../editors/vscode-hson/src/document-diagnostics.ts";
import { resolve_hson_schema_annotation } from "../src/internal/hson-schema/schema-annotation.ts";


export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "tooling.schema-editor-proof",
  title: "Schema editor diagnostic proof",
  category: "Tooling",
  runtime: "node",
  tags: Object.freeze(["schema", "editor", "typescript", "diagnostics"]),
});

const testEvents = create_test_event_emitter("tooling.schema-editor-proof");
const editorProofCase = "verified schema assignments filter only proven editor diagnostics";
testEvents.case_begin(editorProofCase, editorProofCase);
try {

const repositoryRoot = resolve(import.meta.dirname, "..");
const mvpConfig = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/tsconfig.json");
const mvpConsumer = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/consumer.ts");
const mvpGenerated = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/.hson/editor-evidence/producer.ts/UserSchema.hson-schema.generated.ts");
const mvpProofs = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/proof.types.ts");
const documentConfig = resolve(repositoryRoot, "tests/fixtures/hson-schema-document/tsconfig.json");
const documentConsumer = resolve(repositoryRoot, "tests/fixtures/hson-schema-document/consumer.ts");

const evidence = new WeakMap<ts.Program, (producer: string, name: string) => string | undefined>();
const authoredPrograms = new WeakMap<ts.Program, ts.Program>();
const mvp = program_for(mvpConfig, new Map());
assert.equal(schema_assignment_errors(mvp, mvpConsumer).length, 5);
assert.equal(filtered_schema_assignment_errors(mvp, mvpConsumer).length, 0);
assert.equal(verified_schema_assignment_ranges(ts, mvp, mvpConsumer).length, 5);
assert.equal(assignment_ranges(ts, mvp, mvpConsumer).length, 0, "No implicit colocated evidence fallback");

const document = program_for(documentConfig, new Map());
assert.equal(schema_assignment_errors(document, documentConsumer).length, 0);
assert.equal(filtered_schema_assignment_errors(document, documentConsumer).length, 0);
assert.equal(verified_schema_assignment_ranges(ts, document, documentConsumer).length, 0);

const consumerText = readFileSync(mvpConsumer, "utf8");
const mvpProducer = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/producer.ts");
const aliases = `
import type { HsonSchema, HsonFromSchema, HsonData as Data } from "hson-live";
import type { ImportedDeck } from "./producer.js";
type HsonDeck = HsonFromSchema<typeof UserSchema>; type HsonChain = HsonDeck;
type HsonWrapped<S extends HsonSchema> = HsonFromSchema<S>;
type Deck = HsonData<typeof UserSchema>;
export type ExportedDeck = Deck;
type Chain = ExportedDeck;
type Wrapped<S extends HsonSchema<unknown, "data">> = Data<S>;
type WrappedAgain<S extends HsonSchema<unknown, "data">> = Wrapped<S>;
`;
for (const annotation of ["Deck", "ExportedDeck", "Chain", "WrappedAgain<typeof UserSchema>", "ImportedDeck", "HsonFromSchema<typeof UserSchema>", "HsonDeck", "HsonChain", "HsonWrapped<typeof UserSchema>"]) {
  const text = consumerText.replace("const authored: HsonData<typeof UserSchema>", `const authored: ${annotation}`) + aliases;
  const aliasProgram = program_for(mvpConfig, new Map([[mvpConsumer, text], [mvpProducer,
    readFileSync(mvpProducer, "utf8") + '\nimport type { HsonData } from "hson-live"; export type ImportedDeck = HsonData<typeof UserSchema>;\n']]));
  assert.equal(verified_schema_assignment_ranges(ts, aliasProgram, mvpConsumer).length, 5, annotation);
  assert.equal(filtered_schema_assignment_errors(aliasProgram, mvpConsumer).length, 0, annotation);
}
const documentText = readFileSync(documentConsumer, "utf8").replace(/(PageSchema|ListSchema|DocumentSequenceSchema)\.certify\((Hson.document`[^`]*`)\)/g, "$2");
for (const annotation of ["HsonFromSchema<typeof $1>", "HsonDocAlias<typeof $1>"]) {
  const unifiedDocument = program_for(documentConfig, new Map([[documentConsumer,
    documentText.replace(/HsonDocument<typeof (\w+)>/g, annotation)
    + '\nimport type { HsonFromSchema, HsonSchema } from "hson-live"; type HsonDocBase<S extends HsonSchema> = HsonFromSchema<S>; type HsonDocAlias<S extends HsonSchema> = HsonDocBase<S>;\n']]));
  assert.equal(verified_schema_assignment_ranges(ts, unifiedDocument, documentConsumer).length, 0, annotation);
  assert.equal(filtered_schema_assignment_errors(unifiedDocument, documentConsumer).length, 3, annotation);
}

const documentAliases = program_for(documentConfig, new Map([[documentConsumer,
  documentText.replace(/HsonDocument<typeof (\w+)>/g, "DocumentAlias<typeof $1>")
  + '\nimport type { HsonSchema } from "hson-live"; type DocumentBase<S extends HsonSchema<unknown, "document">> = HsonDocument<S>; export type DocumentAlias<S extends HsonSchema<unknown, "document">> = DocumentBase<S>;\n']]));
assert.equal(verified_schema_assignment_ranges(ts, documentAliases, documentConsumer).length, 0);
assert.equal(filtered_schema_assignment_errors(documentAliases, documentConsumer).length, 3);

// Identical candidate failures and proof withdrawal through a transparent alias.
const directInvalid = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace('<name "Ada"', "<name 37")]]));
const aliasInvalid = program_for(mvpConfig, new Map([[mvpConsumer,
  consumerText.replace('<name "Ada"', "<name 37").replace("const authored: HsonData<typeof UserSchema>", "const authored: Chain") + aliases]]));
const failures = (program: ts.Program) => static_schema_candidate_diagnostics(ts, authoredPrograms.get(program)!)
  .filter(entry => entry.file === mvpConsumer).map(({ code, message }) => ({ code, message }));
assert.deepEqual(failures(aliasInvalid), failures(directInvalid));
assert.equal(failures(aliasInvalid).length, 1);
assert.equal(verified_schema_assignment_ranges(ts, aliasInvalid, mvpConsumer).length, 4);
for (const annotation of ["HsonFromSchema<typeof UserSchema>", "HsonChain"]) {
  const unifiedInvalid = program_for(mvpConfig, new Map([[mvpConsumer,
    consumerText.replace('<name "Ada"', "<name 37").replace("const authored: HsonData<typeof UserSchema>", `const authored: ${annotation}`) + aliases]]));
  assert.deepEqual(failures(unifiedInvalid), failures(directInvalid), annotation);
  assert.equal(verified_schema_assignment_ranges(ts, unifiedInvalid, mvpConsumer).length, 4, annotation);
}
const invalidDocumentText = documentText.replace('<section "body"/>', '<aside "body"/>');
const directDocumentInvalid = program_for(documentConfig, new Map([[documentConsumer, invalidDocumentText]]));
const documentFailures = (program: ts.Program) => static_schema_candidate_diagnostics(ts, authoredPrograms.get(program)!)
  .filter(entry => entry.file === documentConsumer).map(({ code, message }) => ({ code, message }));
assert.equal(documentFailures(directDocumentInvalid).length, 1);
for (const annotation of ["HsonFromSchema<typeof $1>", "InvalidDocumentAlias<typeof $1>"]) {
  const unifiedInvalid = program_for(documentConfig, new Map([[documentConsumer,
    invalidDocumentText.replace(/HsonDocument<typeof (\w+)>/g, annotation)
    + '\nimport type { HsonFromSchema, HsonSchema } from "hson-live"; type InvalidDocumentAlias<S extends HsonSchema> = HsonFromSchema<S>;\n']]));
  assert.deepEqual(documentFailures(unifiedInvalid), documentFailures(directDocumentInvalid), annotation);
  assert.equal(verified_schema_assignment_ranges(ts, unifiedInvalid, documentConsumer).length, 0, annotation);
}


const safetyText = consumerText.replace("const authored: HsonData<typeof UserSchema>", "const authored: Unresolved") + `
type Unresolved = HsonData<typeof MissingSchema>;
type Unrelated = string;
type CycleA = CycleB; type CycleB = CycleA;
type Shadow = Fake.HsonData<typeof UserSchema>;
declare namespace Fake { type HsonData<S> = string; }
type Value = JsonFromSchema<typeof UserSchema>;
const projected: Value = Hson.data\`<name "Ada">\`;
const unrelated: Unrelated = Hson.data\`<name "Ada">\`;
const cyclic: CycleA = Hson.data\`<name "Ada">\`;
const shadowed: Shadow = Hson.data\`<name "Ada">\`;
${aliases}
${Array.from({ length: 18 }, (_, index) => `type Deep${index} = ${index === 17 ? "Deck" : `Deep${index + 1}`};`).join("\n")}
const bounded: Deep0 = Hson.data\`<name "Ada">\`;
`;
const safety = program_for(mvpConfig, new Map([[mvpConsumer, safetyText]]));
assert.equal(verified_schema_assignment_ranges(ts, safety, mvpConsumer).length, 4);
const targeted = static_schema_candidate_diagnostics(ts, authoredPrograms.get(safety)!).filter(entry => entry.file === mvpConsumer);
assert.deepEqual(targeted.map(entry => entry.code), ["HSON_SCHEMA_PROOF_UNRESOLVED", "HSON_PROJECTED_VALUE_ANNOTATION"]);
assert.match(targeted[1]!.message, /JSON\/JS value representation.*HsonFromSchema<typeof UserSchema>/);
const safetySource = safety.getSourceFile(mvpConsumer)!;
for (const statement of safetySource.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
  if (ts.isIdentifier(declaration.name) && ["unrelated", "cyclic", "shadowed", "bounded"].includes(declaration.name.text)) {
    assert.equal(resolve_hson_schema_annotation(ts, safety.getTypeChecker(), declaration.type!), undefined, declaration.name.text);
  }
}
const invalid = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace('<name "Ada"', "<name 37")]]));
assert.equal(verified_schema_assignment_ranges(ts, invalid, mvpConsumer).length, 4);
assert.equal(filtered_schema_assignment_errors(invalid, mvpConsumer).length, 1);

const malformed = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace('<name "Ada"', '<name +1')]]));
assert.equal(verified_schema_assignment_ranges(ts, malformed, mvpConsumer).length, 4, "Malformed Hson never receives verified proof");
const malformedRanges = assignment_ranges(ts, malformed, mvpConsumer, evidence.get(malformed), true);
assert.equal(malformedRanges.filter(range => range.failed).length, 1);
assert.equal(schema_assignment_errors(malformed, mvpConsumer).length, 5, "Underlying TypeScript proof failures remain intact");
assert.equal(filter_verified_schema_assignment_diagnostics(schema_assignment_errors(malformed, mvpConsumer), malformedRanges).length, 0);

const invalidAlphabet = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace('key "abc"', 'key "abd"')]]));
assert.equal(verified_schema_assignment_ranges(ts, invalidAlphabet, mvpConsumer).length, 4);
assert.equal(filtered_schema_assignment_errors(invalidAlphabet, mvpConsumer).length, 1);

const documentAgainstAny = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace(
  'Hson.data`<args <target "browser" options [null, true, -0, <nested []>]> payload <action "rename" values ["Ada", "Grace"]>>`',
  'Hson.document`<main/>`',
)]]));
assert.equal(verified_schema_assignment_ranges(ts, documentAgainstAny, mvpConsumer).length, 4);
assert.equal(filtered_schema_assignment_errors(documentAgainstAny, mvpConsumer).length, 1);

const wrongAssociation = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace("const authored: HsonData<typeof UserSchema>", "const authored: HsonData<typeof TreeSchema>")]]));
assert.equal(verified_schema_assignment_ranges(ts, wrongAssociation, mvpConsumer).length, 4);
assert.equal(filtered_schema_assignment_errors(wrongAssociation, mvpConsumer).length, 1);

const staleGenerated = program_for(mvpConfig, new Map([[mvpGenerated, `${mvp.getSourceFile(mvpGenerated)?.text}\n`]]));
assert.equal(verified_schema_assignment_ranges(ts, staleGenerated, mvpConsumer).length, 4);
assert.equal(filtered_schema_assignment_errors(staleGenerated, mvpConsumer).length, 1);
assert.equal(verified_schema_assignment_ranges(ts, mvp, mvpProofs).length, 0);

const invalidRelationalUnique = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace(
  '<position "top-left" body "b">',
  '<position "top-half" body "b">',
)]]));
assert.equal(verified_schema_assignment_ranges(ts, invalidRelationalUnique, mvpConsumer).length, 4);
assert.equal(filtered_schema_assignment_errors(invalidRelationalUnique, mvpConsumer).length, 1);

const escapeSpellings = ["\\8", "\\9", "\\unicode", "\\xG0", "\\u{110000}"];
const adversarialText = '\uFEFF' + [
  'import { Hson, type HsonData, type HsonDocument, type JsonFromSchema } from "hson-live";',
  'const S = Hson.schema`<type "data" content <name "string">>`;',
  'const Doc = Hson.schema`<type "document" tag "main" content "empty">`;',
  'declare const dynamic: string;',
  'const unused: HsonData<typeof S> = Hson.data`<name ${(() => {\r\n// @hson-expect-error HSON_NUMBER_LEADING_PLUS\r\nreturn "Ada";\r\n})()}>`;',
  'const nested: HsonData<typeof S> = Hson.data`<name ${Hson.data`+1`}>`;',
  'const ownSyntax: HsonData<typeof S> = Hson.data`+1 ${missing}`;',
  ...escapeSpellings.map((escape, index) => `const escape${index}: HsonData<typeof S> = Hson.data\`// ${escape}\r\n<name "Ada">\`;`),
  'const escapedDoc: HsonDocument<typeof Doc> = Hson.document`// \\9\r\n<main/>`;',
  'const valid: HsonData<typeof S> = Hson.data`<name "Ada">`;',
  'const raw: HsonData<typeof S> = Hson.data`<name "\\\\n">`;',
  'const validComment: HsonData<typeof S> = Hson.data`// \\n \\u0041 \\0\r\n<name "Ada">`;',
  'const outer: HsonData<typeof S> = Hson.data`<name ${dynamic}>`;',
  'const unrelated: number = "wrong";',
  'const field: JsonFromSchema<typeof S> = { name: 37 };',
].join('\r\n');
const adversarial = program_for(mvpConfig, new Map([[mvpConsumer, adversarialText]]));
const adversarialSource = adversarial.getSourceFile(mvpConsumer)!;
const rangeNames = (includeFailures: boolean) => assignment_ranges(ts, adversarial, mvpConsumer, evidence.get(adversarial), includeFailures)
  .map(range => ({ name: adversarialSource.text.slice(range.start, range.end), failed: range.failed === true }));
assert.deepEqual(rangeNames(false), ["valid", "raw", "validComment"].map(name => ({ name, failed: false })),
  "Only actually admitted, substitution-free candidates receive verified proof");
assert.deepEqual(rangeNames(true).filter(range => range.failed).map(range => range.name), ["ownSyntax", ...escapeSpellings.map((_, index) => `escape${index}`)],
  "Only the assigned template's admission failures permit proof-only filtering");
const adversarialErrors = filter_verified_schema_assignment_diagnostics(schema_assignment_errors(adversarial, mvpConsumer),
  assignment_ranges(ts, adversarial, mvpConsumer, evidence.get(adversarial), true));
assert.deepEqual(adversarialErrors.map(error => adversarialSource.text.slice(error.start, error.start! + error.length!)), ["unused", "nested", "escapedDoc", "outer", "unrelated", "name"]);
const authoring = produce_document_diagnostics({ fileName: mvpConsumer, text: adversarialText, languageId: "typescript" });
assert.equal(authoring.filter(issue => issue.code === "HSON_TAGGED_TEMPLATE_REQUIRED").length, escapeSpellings.length + 1);
assert.ok(authoring.some(issue => issue.code === "HSON_EXPECT_ERROR_UNUSED"));
for (const issue of authoring.filter(issue => issue.code === "HSON_TAGGED_TEMPLATE_REQUIRED")) {
  assert.equal(adversarialText.slice(issue.range.start, issue.range.end).startsWith("// \\"), true);
}
const invalidProducer = program_for(mvpConfig, new Map([[mvpConsumer,
  adversarialText.replace('Hson.schema`<type "data"', 'Hson.schema`// \\8\r\n<type "data"')]]));
assert.equal(verified_schema_assignment_ranges(ts, invalidProducer, mvpConsumer).length, 0, "Rejected Schema tagged admission cannot establish assignment proof either");

// Use TypeScript's tagged-expression OptionalChain flag for both consumers and
// producers. Parentheses around the expression preserve the syntax violation;
// parentheses around only the tag end the chain and are valid JS syntax.
for (const member of ["data", "schema"]) for (const tag of [`Hson?.${member}`, `Hson.${member}?.`]) for (const parenthesized of [false, true]) {
  const schema = '<type "data" content <name "string">>';
  const template = `${tag}\`${member === "schema" ? schema : '<name "Ada">'}\``;
  const initializer = parenthesized ? `(${template})` : template;
  const source = 'import { Hson, type HsonData } from "hson-live";\r\n'
    + (member === "schema" ? `const S = ${initializer};\r\nconst value: HsonData<typeof S> = Hson.data\`<name "Ada">\`;`
      : `const S = Hson.schema\`${schema}\`;\r\nconst value: HsonData<typeof S> = ${initializer};`);
  const program = program_for(mvpConfig, new Map([[mvpConsumer, source]]));
  assert.equal(assignment_ranges(ts, program, mvpConsumer, evidence.get(program)).length, 0, source);
  assert.equal(assignment_ranges(ts, program, mvpConsumer, evidence.get(program), true).length, 0, "Optional chains cannot establish filtering evidence either");
  assert.equal(program.getSemanticDiagnostics(program.getSourceFile(mvpConsumer)).filter(error => error.code === 1358).length, 1, source);
  const repaired = source.replace("Hson?.", "Hson.").replace("?.`", "`");
  const valid = program_for(mvpConfig, new Map([[mvpConsumer, repaired]]));
  assert.equal(assignment_ranges(ts, valid, mvpConsumer, evidence.get(valid)).length, parenthesized ? 0 : 1,
    "Removing the chain restores the existing direct-template proof boundary");
  assert.equal(valid.getSemanticDiagnostics(valid.getSourceFile(mvpConsumer)).filter(error => error.code === 1358).length, 0);
}
for (const parenthesizedTag of [
  'import { Hson, type HsonData } from "hson-live";\r\nconst S = Hson.schema`<type "data" content <name "string">>`;\r\nconst value: HsonData<typeof S> = (Hson?.data)`<name "Ada">`;',
  'import { Hson, type HsonData } from "hson-live";\r\nconst S = (Hson?.schema)`<type "data" content <name "string">>`;\r\nconst value: HsonData<typeof S> = Hson.data`<name "Ada">`;',
]) {
  const validParenthesizedTag = program_for(mvpConfig, new Map([[mvpConsumer, parenthesizedTag]]));
  assert.equal(validParenthesizedTag.getSemanticDiagnostics(validParenthesizedTag.getSourceFile(mvpConsumer)).filter(error => error.code === 1358).length, 0);
  assert.equal(assignment_ranges(ts, validParenthesizedTag, mvpConsumer, evidence.get(validParenthesizedTag)).length, 0,
    "A valid parenthesized tag retains the existing conservative proof boundary");
}

const failedRange = [{ start: 10, end: 15, failed: true as const }];
const schemaProof: ts.DiagnosticMessageChain = { messageText: "Types of property '[HSON_SCHEMA_PROOF]' are incompatible.", category: ts.DiagnosticCategory.Error, code: 2326 };
const assignment = (messageText: string | ts.DiagnosticMessageChain): ts.Diagnostic => ({ file: undefined, start: 10, length: 3, category: ts.DiagnosticCategory.Error, code: 2322, messageText });
assert.equal(filter_verified_schema_assignment_diagnostics([assignment(schemaProof)], failedRange).length, 0);
assert.equal(filter_verified_schema_assignment_diagnostics([assignment("Unrelated assignment failure")], failedRange).length, 1);
assert.equal(filter_verified_schema_assignment_diagnostics([assignment({ messageText: "Assignment failure", category: ts.DiagnosticCategory.Error, code: 2322, next: [schemaProof, { messageText: "Property other is incompatible", category: ts.DiagnosticCategory.Error, code: 2326 }] })], failedRange).length, 1);
console.log(JSON.stringify({ schemaEditorProofAcceptance: "ok", aliasForms: 9, targetedDiagnosticKinds: 2 }));

function program_for(configPath: string, replacements: ReadonlyMap<string, string>): ts.Program {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath), undefined, configPath);
  if (parsed.errors.length > 0) throw new Error(parsed.errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n")).join("\n"));
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => parsed.options, getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: () => "0", getCurrentDirectory: () => dirname(configPath),
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    getScriptSnapshot: file => {
      const text = replacements.get(resolve(file)) ?? ts.sys.readFile(file);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
  };
  const view = install_live_schema_view(ts, host, configPath);
  view.refresh();
  const original = host.getScriptSnapshot;
  host.getScriptSnapshot = file => {
    // Authored replacements feed the view; only evidence tampering bypasses it.
    const text = file.includes("/.hson/") ? replacements.get(resolve(file)) : undefined;
    return text === undefined ? original(file) : ts.ScriptSnapshot.fromString(text);
  };
  const service = ts.createLanguageService(host);
  const program = service.getProgram()!;
  evidence.set(program, view.evidence_file);
  authoredPrograms.set(program, view.authoredService.getProgram()!);
  return program;
}

function verified_schema_assignment_ranges(typescript: typeof ts, program: ts.Program, file: string) {
  return assignment_ranges(typescript, program, file, evidence.get(program));
}

function schema_assignment_errors(program: ts.Program, fileName: string): readonly ts.Diagnostic[] {
  return ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.code === 2322 && diagnostic.file?.fileName === fileName);
}

function filtered_schema_assignment_errors(program: ts.Program, fileName: string): readonly ts.Diagnostic[] {
  const diagnostics = schema_assignment_errors(program, fileName);
  return filter_verified_schema_assignment_diagnostics(diagnostics, verified_schema_assignment_ranges(ts, program, fileName));
}
  testEvents.case_end(editorProofCase, "pass");
  testEvents.terminal("pass");
} catch (error) {
  const message = error instanceof Error ? error.message : "Check failed.";
  testEvents.diagnostic(editorProofCase, "assertion", message.slice(0, 1_000));
  testEvents.case_end(editorProofCase, "fail");
  testEvents.terminal("fail");
  throw error;
}
