import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { filter_verified_schema_assignment_diagnostics, verified_schema_assignment_ranges as assignment_ranges } from "../editors/vscode-hson/src/schema-editor-proof.ts";
import { install_live_schema_view } from "../editors/vscode-hson/src/schema-editor-view.ts";


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
const mvp = program_for(mvpConfig, new Map());
assert.equal(schema_assignment_errors(mvp, mvpConsumer).length, 4);
assert.equal(filtered_schema_assignment_errors(mvp, mvpConsumer).length, 0);
assert.equal(verified_schema_assignment_ranges(ts, mvp, mvpConsumer).length, 4);
assert.equal(assignment_ranges(ts, mvp, mvpConsumer).length, 0, "No implicit colocated evidence fallback");

const document = program_for(documentConfig, new Map());
assert.equal(schema_assignment_errors(document, documentConsumer).length, 3);
assert.equal(filtered_schema_assignment_errors(document, documentConsumer).length, 0);
assert.equal(verified_schema_assignment_ranges(ts, document, documentConsumer).length, 3);

const consumerText = readFileSync(mvpConsumer, "utf8");
const invalid = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace('<name "Ada"', "<name 37")]]));
assert.equal(verified_schema_assignment_ranges(ts, invalid, mvpConsumer).length, 3);
assert.equal(filtered_schema_assignment_errors(invalid, mvpConsumer).length, 1);

const invalidAlphabet = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace('key "abc"', 'key "abd"')]]));
assert.equal(verified_schema_assignment_ranges(ts, invalidAlphabet, mvpConsumer).length, 3);
assert.equal(filtered_schema_assignment_errors(invalidAlphabet, mvpConsumer).length, 1);

const documentAgainstAny = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace(
  'Hson.data`<args <target "browser" options [null, true, -0, <nested []>]> payload <action "rename" values ["Ada", "Grace"]>>`',
  'Hson.document`<main/>`',
)]]));
assert.equal(verified_schema_assignment_ranges(ts, documentAgainstAny, mvpConsumer).length, 3);
assert.equal(filtered_schema_assignment_errors(documentAgainstAny, mvpConsumer).length, 1);

const wrongAssociation = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace("const authored: HsonData<typeof UserSchema>", "const authored: HsonData<typeof TreeSchema>")]]));
assert.equal(verified_schema_assignment_ranges(ts, wrongAssociation, mvpConsumer).length, 3);
assert.equal(filtered_schema_assignment_errors(wrongAssociation, mvpConsumer).length, 1);

const staleGenerated = program_for(mvpConfig, new Map([[mvpGenerated, `${mvp.getSourceFile(mvpGenerated)?.text}\n`]]));
assert.equal(verified_schema_assignment_ranges(ts, staleGenerated, mvpConsumer).length, 3);
assert.equal(filtered_schema_assignment_errors(staleGenerated, mvpConsumer).length, 1);
assert.equal(verified_schema_assignment_ranges(ts, mvp, mvpProofs).length, 0);

const invalidRelationalUnique = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace(
  '<position "top-left" body "b">',
  '<position "top-half" body "b">',
)]]));
assert.equal(verified_schema_assignment_ranges(ts, invalidRelationalUnique, mvpConsumer).length, 3);
assert.equal(filtered_schema_assignment_errors(invalidRelationalUnique, mvpConsumer).length, 1);

const failedRange = [{ start: 10, end: 15, failed: true as const }];
const schemaProof: ts.DiagnosticMessageChain = { messageText: "Types of property '[HSON_SCHEMA_PROOF]' are incompatible.", category: ts.DiagnosticCategory.Error, code: 2326 };
const assignment = (messageText: string | ts.DiagnosticMessageChain): ts.Diagnostic => ({ file: undefined, start: 10, length: 3, category: ts.DiagnosticCategory.Error, code: 2322, messageText });
assert.equal(filter_verified_schema_assignment_diagnostics([assignment(schemaProof)], failedRange).length, 0);
assert.equal(filter_verified_schema_assignment_diagnostics([assignment("Unrelated assignment failure")], failedRange).length, 1);
assert.equal(filter_verified_schema_assignment_diagnostics([assignment({ messageText: "Assignment failure", category: ts.DiagnosticCategory.Error, code: 2322, next: [schemaProof, { messageText: "Property other is incompatible", category: ts.DiagnosticCategory.Error, code: 2326 }] })], failedRange).length, 1);
console.log(JSON.stringify({ schemaEditorProofAcceptance: "ok", checks: 22 }));

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
    const text = replacements.get(resolve(file));
    return text === undefined ? original(file) : ts.ScriptSnapshot.fromString(text);
  };
  const service = ts.createLanguageService(host);
  const program = service.getProgram()!;
  evidence.set(program, view.evidence_file);
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
