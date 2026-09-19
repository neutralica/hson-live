import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { filter_verified_schema_assignment_diagnostics, install_live_schema_proof_mask, mask_stale_schema_producer_evidence, verified_schema_assignment_ranges } from "../editors/vscode-hson/src/schema-editor-proof.ts";
import { local_hson_schema_declarations } from "../editors/vscode-hson/src/hson-schema-local.ts";
import { generate_hson_schema_evidence } from "../src/internal/hson-schema/generated-evidence.ts";

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
const mvpGenerated = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/producer.UserSchema.hson-schema.generated.ts");
const mvpProducer = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/producer.ts");
const mvpProofs = resolve(repositoryRoot, "tests/fixtures/hson-schema-mvp/proof.types.ts");
const documentConfig = resolve(repositoryRoot, "tests/fixtures/hson-schema-document/tsconfig.json");
const documentConsumer = resolve(repositoryRoot, "tests/fixtures/hson-schema-document/consumer.ts");

const mvp = program_for(mvpConfig, new Map());
assert.equal(schema_assignment_errors(mvp, mvpConsumer).length, 4);
assert.equal(filtered_schema_assignment_errors(mvp, mvpConsumer).length, 0);
assert.equal(verified_schema_assignment_ranges(ts, mvp, mvpConsumer).length, 4);

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

const staleGenerated = program_for(mvpConfig, new Map([[mvpGenerated, `${readFileSync(mvpGenerated, "utf8")}\n`]]));
assert.equal(verified_schema_assignment_ranges(ts, staleGenerated, mvpConsumer).length, 3);
assert.equal(filtered_schema_assignment_errors(staleGenerated, mvpConsumer).length, 1);
assert.equal(verified_schema_assignment_ranges(ts, mvp, mvpProofs).length, 0);

const producerText = readFileSync(mvpProducer, "utf8");
const readCurrent = (path: string): string | undefined => {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
};
assert.equal(mask_stale_schema_producer_evidence(ts, mvpProducer, producerText, mvpConfig, readCurrent), producerText);
const changedProducer = producerText.replace('name "string"', 'name "number"');
const maskedProducer = mask_stale_schema_producer_evidence(ts, mvpProducer, changedProducer, mvpConfig, readCurrent);
assert.notEqual(maskedProducer, changedProducer);
assert.equal(maskedProducer.length, changedProducer.length);
assert.match(maskedProducer, /UserSchema: __HsonSchema\s+=/);
assert.match(maskedProducer, /TreeSchema: __HsonSchema</);
for (const stale of [
  producerText.replace('name "string"', 'name  "string"'),
  producerText.replace('type "data"', 'type "document"'),
  producerText.replaceAll('UserSchema', 'RenamedSchema'),
  changedProducer.replaceAll("__HsonSchema<", "__HsonSchema <"),
]) assert.notEqual(mask_stale_schema_producer_evidence(ts, mvpProducer, stale, mvpConfig, readCurrent), stale);
const changedRecord = local_hson_schema_declarations(changedProducer, mvpProducer).find(record => record.name === "UserSchema");
if (changedRecord === undefined) throw new Error("Missing changed Schema declaration.");
const refreshed = generate_hson_schema_evidence("UserSchema", changedRecord.template, "producer.ts#UserSchema");
assert.equal(mask_stale_schema_producer_evidence(ts, mvpProducer, changedProducer, mvpConfig, path =>
  path === mvpGenerated ? refreshed.declaration
    : path.endsWith("producer.UserSchema.hson-schema.generated.json") ? refreshed.metadata : readCurrent(path)), changedProducer);
const repairedProducer = mask_stale_schema_producer_evidence(ts, mvpProducer, producerText, mvpConfig, readCurrent);
assert.equal(repairedProducer, producerText);
const augmentedConsumer = `${consumerText}\nconst oldShape: { name: string } = {} as SchemaType<typeof UserSchema>;\nconst oldCertificate: HsonData<typeof UserSchema> = UserSchema.certify(Hson.canonical\`<name "Ada">\`);\n`;
const currentLive = program_for(mvpConfig, new Map([[mvpConsumer, augmentedConsumer]]));
assert.equal(ts.getPreEmitDiagnostics(currentLive).filter(d => d.file?.fileName === mvpConsumer && (d.start ?? 0) >= consumerText.length).length, 0);
const staleLive = program_for(mvpConfig, new Map([[mvpProducer, maskedProducer], [mvpConsumer, augmentedConsumer]]));
assert.ok(ts.getPreEmitDiagnostics(staleLive).some(d => d.file?.fileName === mvpConsumer && (d.start ?? 0) >= consumerText.length));
assert.notEqual(mask_stale_schema_producer_evidence(ts, mvpProducer, producerText, mvpConfig,
  path => path === mvpGenerated ? undefined : readCurrent(path)), producerText);

const configRead = ts.readConfigFile(mvpConfig, ts.sys.readFile);
if (configRead.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(configRead.error.messageText, "\n"));
const parsedConfig = ts.parseJsonConfigFileContent(configRead.config, ts.sys, dirname(mvpConfig));
let liveOptions = parsedConfig.options;
const lookalikePath = resolve(dirname(mvpConfig), "lookalike-hson.ts");
const lookalikeSource = 'export * from "../../../dist/index.js"; export declare const Hson: typeof import("hson-live/hson").Hson;\n';
const liveFiles = new Map<string, string>([[mvpConsumer, augmentedConsumer]]);
const liveVersions = new Map<string, number>();
const host: ts.LanguageServiceHost = {
  getCompilationSettings: () => liveOptions,
  getScriptFileNames: () => parsedConfig.fileNames,
  getScriptVersion: fileName => String(liveVersions.get(resolve(fileName)) ?? 0),
  getScriptSnapshot: fileName => {
    const content = resolve(fileName) === lookalikePath ? lookalikeSource : liveFiles.get(resolve(fileName)) ?? readCurrent(fileName);
    return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
  },
  getCurrentDirectory: () => dirname(mvpConfig),
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: fileName => resolve(fileName) === lookalikePath || ts.sys.fileExists(fileName),
  readFile: fileName => resolve(fileName) === lookalikePath ? lookalikeSource : ts.sys.readFile(fileName),
  readDirectory: ts.sys.readDirectory,
};
const service = ts.createLanguageService(host);
install_live_schema_proof_mask(ts, host, mvpConfig);
const editor = service;
const liveTailErrors = () => editor.getSemanticDiagnostics(mvpConsumer).filter(d => (d.start ?? 0) >= consumerText.length);
assert.equal(liveTailErrors().length, 0);
liveFiles.set(mvpProducer, changedProducer);
liveVersions.set(mvpProducer, 1);
assert.match(editor.getProgram()?.getSourceFile(mvpProducer)?.text ?? "", /UserSchema: __HsonSchema\s+=/);
assert.ok(liveTailErrors().length > 0);
liveFiles.set(mvpProducer, producerText);
liveVersions.set(mvpProducer, 2);
assert.equal(liveTailErrors().length, 0);
liveOptions = { ...parsedConfig.options, paths: { ...parsedConfig.options.paths, "hson-live": [lookalikePath] } };
const retargetedProducer = editor.getProgram()?.getSourceFile(mvpProducer)?.text ?? "";
assert.match(retargetedProducer, /UserSchema: __HsonSchema\s+=/);
const retargetedDiagnostics = liveTailErrors();
assert.ok(retargetedDiagnostics.some(d => (d.start ?? 0) >= augmentedConsumer.indexOf("const oldShape:")
  && (d.start ?? 0) < augmentedConsumer.indexOf("const oldCertificate:")));
assert.ok(retargetedDiagnostics.some(d => (d.start ?? 0) >= augmentedConsumer.indexOf("const oldCertificate:")));
liveOptions = parsedConfig.options;
assert.equal(liveTailErrors().length, 0);
service.dispose();

const invalidRelationalUnique = program_for(mvpConfig, new Map([[mvpConsumer, consumerText.replace(
  '<position "top-left" body "b">',
  '<position "top-half" body "b">',
)]]));
assert.equal(verified_schema_assignment_ranges(ts, invalidRelationalUnique, mvpConsumer).length, 3);
assert.equal(filtered_schema_assignment_errors(invalidRelationalUnique, mvpConsumer).length, 1);

console.log(JSON.stringify({ schemaEditorProofAcceptance: "ok", checks: 32 }));

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
  testEvents.case_end(editorProofCase, "pass");
  testEvents.terminal("pass");
} catch (error) {
  const message = error instanceof Error ? error.message : "Check failed.";
  testEvents.diagnostic(editorProofCase, "assertion", message.slice(0, 1_000));
  testEvents.case_end(editorProofCase, "fail");
  testEvents.terminal("fail");
  throw error;
}
