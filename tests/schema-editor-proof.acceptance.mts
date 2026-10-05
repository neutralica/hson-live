import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { filter_verified_schema_assignment_diagnostics, verified_schema_assignment_ranges as assignment_ranges } from "../editors/vscode-hson/src/schema-editor-proof.ts";
import { install_live_schema_view } from "../editors/vscode-hson/src/schema-editor-view.ts";
import { static_schema_candidate_diagnostics } from "../src/internal/hson-schema/candidate-diagnostics.ts";
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
assert.equal(schema_assignment_errors(document, documentConsumer).length, 3);
assert.equal(filtered_schema_assignment_errors(document, documentConsumer).length, 0);
assert.equal(verified_schema_assignment_ranges(ts, document, documentConsumer).length, 3);

const consumerText = readFileSync(mvpConsumer, "utf8");
const mvpProducer = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/producer.ts");
const aliases = `
import type { HsonSchema, HsonData as Data } from "hson-live";
import type { ImportedDeck } from "./producer.js";
type Deck = HsonData<typeof UserSchema>;
export type ExportedDeck = Deck;
type Chain = ExportedDeck;
type Wrapped<S extends HsonSchema<unknown, "data">> = Data<S>;
type WrappedAgain<S extends HsonSchema<unknown, "data">> = Wrapped<S>;
`;
for (const annotation of ["Deck", "ExportedDeck", "Chain", "WrappedAgain<typeof UserSchema>", "ImportedDeck"]) {
  const text = consumerText.replace("const authored: HsonData<typeof UserSchema>", `const authored: ${annotation}`) + aliases;
  const aliasProgram = program_for(mvpConfig, new Map([[mvpConsumer, text], [mvpProducer,
    readFileSync(mvpProducer, "utf8") + '\nimport type { HsonData } from "hson-live"; export type ImportedDeck = HsonData<typeof UserSchema>;\n']]));
  assert.equal(verified_schema_assignment_ranges(ts, aliasProgram, mvpConsumer).length, 5, annotation);
  assert.equal(filtered_schema_assignment_errors(aliasProgram, mvpConsumer).length, 0, annotation);
}
const documentText = readFileSync(documentConsumer, "utf8");
const documentAliases = program_for(documentConfig, new Map([[documentConsumer,
  documentText.replace(/HsonDocument<typeof (\w+)>/g, "DocumentAlias<typeof $1>")
  + '\nimport type { HsonSchema } from "hson-live"; type DocumentBase<S extends HsonSchema<unknown, "document">> = HsonDocument<S>; export type DocumentAlias<S extends HsonSchema<unknown, "document">> = DocumentBase<S>;\n']]));
assert.equal(verified_schema_assignment_ranges(ts, documentAliases, documentConsumer).length, 3);
assert.equal(filtered_schema_assignment_errors(documentAliases, documentConsumer).length, 0);

// Identical candidate failures and proof withdrawal through a transparent alias.
const directInvalid = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace('<name "Ada"', "<name 37")]]));
const aliasInvalid = program_for(mvpConfig, new Map([[mvpConsumer,
  consumerText.replace('<name "Ada"', "<name 37").replace("const authored: HsonData<typeof UserSchema>", "const authored: Chain") + aliases]]));
const failures = (program: ts.Program) => static_schema_candidate_diagnostics(ts, authoredPrograms.get(program)!)
  .filter(entry => entry.file === mvpConsumer).map(({ code, message }) => ({ code, message }));
assert.deepEqual(failures(aliasInvalid), failures(directInvalid));
assert.equal(failures(aliasInvalid).length, 1);
assert.equal(verified_schema_assignment_ranges(ts, aliasInvalid, mvpConsumer).length, 4);

const safetyText = consumerText.replace("const authored: HsonData<typeof UserSchema>", "const authored: Unresolved") + `
type Unresolved = HsonData<typeof MissingSchema>;
type Unrelated = string;
type CycleA = CycleB; type CycleB = CycleA;
type Shadow = Fake.HsonData<typeof UserSchema>;
declare namespace Fake { type HsonData<S> = string; }
type Value = SchemaType<typeof UserSchema>;
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
assert.match(targeted[1]!.message, /projected JavaScript value.*HsonData<typeof UserSchema>/);
const safetySource = safety.getSourceFile(mvpConsumer)!;
for (const statement of safetySource.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
  if (ts.isIdentifier(declaration.name) && ["unrelated", "cyclic", "shadowed", "bounded"].includes(declaration.name.text)) {
    assert.equal(resolve_hson_schema_annotation(ts, safety.getTypeChecker(), declaration.type!), undefined, declaration.name.text);
  }
}
const invalid = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace('<name "Ada"', "<name 37")]]));
assert.equal(verified_schema_assignment_ranges(ts, invalid, mvpConsumer).length, 4);
assert.equal(filtered_schema_assignment_errors(invalid, mvpConsumer).length, 1);

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

const failedRange = [{ start: 10, end: 15, failed: true as const }];
const schemaProof: ts.DiagnosticMessageChain = { messageText: "Types of property '[HSON_SCHEMA_PROOF]' are incompatible.", category: ts.DiagnosticCategory.Error, code: 2326 };
const assignment = (messageText: string | ts.DiagnosticMessageChain): ts.Diagnostic => ({ file: undefined, start: 10, length: 3, category: ts.DiagnosticCategory.Error, code: 2322, messageText });
assert.equal(filter_verified_schema_assignment_diagnostics([assignment(schemaProof)], failedRange).length, 0);
assert.equal(filter_verified_schema_assignment_diagnostics([assignment("Unrelated assignment failure")], failedRange).length, 1);
assert.equal(filter_verified_schema_assignment_diagnostics([assignment({ messageText: "Assignment failure", category: ts.DiagnosticCategory.Error, code: 2322, next: [schemaProof, { messageText: "Property other is incompatible", category: ts.DiagnosticCategory.Error, code: 2326 }] })], failedRange).length, 1);
console.log(JSON.stringify({ schemaEditorProofAcceptance: "ok", aliasForms: 5, targetedDiagnosticKinds: 2 }));

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
