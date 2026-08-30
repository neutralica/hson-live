import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { filter_verified_schema_assignment_diagnostics, verified_schema_assignment_ranges } from "../editors/vscode-hson/src/schema-editor-proof.ts";

const repositoryRoot = resolve(import.meta.dirname, "..");
const mvpConfig = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/tsconfig.json");
const mvpConsumer = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/consumer.ts");
const mvpGenerated = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/producer.UserSchema.hson-schema.generated.ts");
const mvpProofs = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/proof.types.ts");
const documentConfig = resolve(repositoryRoot, "tests/fixtures/hson-schema-document/tsconfig.json");
const documentConsumer = resolve(repositoryRoot, "tests/fixtures/hson-schema-document/consumer.ts");

const mvp = program_for(mvpConfig, new Map());
assert.equal(schema_assignment_errors(mvp, mvpConsumer).length, 2);
assert.equal(filtered_schema_assignment_errors(mvp, mvpConsumer).length, 0);
assert.equal(verified_schema_assignment_ranges(ts, mvp, mvpConsumer).length, 2);

const document = program_for(documentConfig, new Map());
assert.equal(schema_assignment_errors(document, documentConsumer).length, 2);
assert.equal(filtered_schema_assignment_errors(document, documentConsumer).length, 0);
assert.equal(verified_schema_assignment_ranges(ts, document, documentConsumer).length, 2);

const consumerText = readFileSync(mvpConsumer, "utf8");
const invalid = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace('<name "Ada"', "<name 37")]]));
assert.equal(verified_schema_assignment_ranges(ts, invalid, mvpConsumer).length, 1);
assert.equal(filtered_schema_assignment_errors(invalid, mvpConsumer).length, 1);

const wrongAssociation = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace("Hson.certify(UserSchema, dynamic)", "Hson.certify(Hson, dynamic)")]]));
assert.equal(verified_schema_assignment_ranges(ts, wrongAssociation, mvpConsumer).length, 1);
assert.equal(filtered_schema_assignment_errors(wrongAssociation, mvpConsumer).length, 1);

const staleGenerated = program_for(mvpConfig, new Map([[mvpGenerated, `${readFileSync(mvpGenerated, "utf8")}\n`]]));
assert.equal(verified_schema_assignment_ranges(ts, staleGenerated, mvpConsumer).length, 0);
assert.equal(filtered_schema_assignment_errors(staleGenerated, mvpConsumer).length, 2);
assert.equal(verified_schema_assignment_ranges(ts, mvp, mvpProofs).length, 0);

console.log(JSON.stringify({ schemaEditorProofAcceptance: "ok", checks: 13 }));

function program_for(configPath: string, replacements: ReadonlyMap<string, string>): ts.Program {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath), undefined, configPath);
  if (parsed.errors.length > 0) throw new Error(parsed.errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n")).join("\n"));
  const host = ts.createCompilerHost(parsed.options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const sourceFile = original(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    const replacement = replacements.get(resolve(fileName));
    if (sourceFile === undefined || replacement === undefined) return sourceFile;
    const scriptKind = sourceFile.languageVariant === ts.LanguageVariant.JSX ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    return ts.createSourceFile(fileName, replacement, languageVersion, true, scriptKind);
  };
  return ts.createProgram(parsed.fileNames, parsed.options, host);
}

function schema_assignment_errors(program: ts.Program, fileName: string): readonly ts.Diagnostic[] {
  return ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.code === 2322 && diagnostic.file?.fileName === fileName);
}

function filtered_schema_assignment_errors(program: ts.Program, fileName: string): readonly ts.Diagnostic[] {
  const diagnostics = schema_assignment_errors(program, fileName);
  return filter_verified_schema_assignment_diagnostics(diagnostics, verified_schema_assignment_ranges(ts, program, fileName));
}
