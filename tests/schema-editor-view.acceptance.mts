import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
import { static_schema_candidate_diagnostics } from "../src/internal/hson-schema/candidate-diagnostics.ts";
import { library_source_definitions } from "../src/internal/hson-schema/library-source.ts";
import { create_schema_language_service } from "../editors/vscode-hson/src/schema-language-service.ts";
import { SchemaSourceMapping } from "../src/internal/hson-schema/source-mapping.ts";
import { discover_hson_tagged_templates, read_supported_hson_import_symbols } from "../src/internal/embedded-hson/discover-hson-tagged-templates.ts";
import { generate_hson_schema_evidence } from "../src/internal/hson-schema/generated-evidence.ts";
import { compile_hson_schema } from "../src/internal/hson-schema/compiler.ts";
import { admit_hson_tagged_source } from "../src/internal/embedded-hson/hson-tagged-source-admission.ts";
import { local_hson_schema_completion } from "../editors/vscode-hson/src/hson-schema-symbols.ts";
import { local_hson_schema_diagnostics } from "../editors/vscode-hson/src/hson-schema-local.ts";
import { Hson } from "../src/hson-authoring.ts";
import { hson } from "../src/hson.ts";
import { hsonLiveMap } from "../src/api/livemap/livemap.facade.ts";
import { spawnSync } from "node:child_process";
import { create_test_event_emitter } from "./test-events.mjs";
import { produce_document_diagnostics } from "../editors/vscode-hson/src/document-diagnostics.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "tooling.schema-editor-view", title: "Schema editor compiler view", category: "Tooling", runtime: "node", tags: Object.freeze(["schema", "editor", "typescript", "source-integrity"]) });
const events = create_test_event_emitter("tooling.schema-editor-view");
let checks = 0;
function check(name: string, body: () => void): void {
  events.case_begin(name, name);
  try { body(); checks++; events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}

assert.equal(ts.version, "5.9.3");
const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, "tmp"), { recursive: true });
const temporary = mkdtempSync(join(root, "tmp", "schema-editor-view-"));
process.once("exit", () => rmSync(temporary, { recursive: true, force: true }));

function bytes(directory: string): Map<string, Buffer> {
  const output = new Map<string, Buffer>();
  const visit = (path: string): void => { for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name); if (entry.isDirectory()) visit(file); else output.set(relative(directory, file), readFileSync(file));
  } };
  visit(directory); return output;
}
function project(name: string, files: Record<string, string>, extraOptions: ts.CompilerOptions = {}, typescript: typeof ts = ts) {
  const directory = join(temporary, name); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  for (const [file, source] of Object.entries(files)) { mkdirSync(dirname(join(directory, file)), { recursive: true }); writeFileSync(join(directory, file), source); }
  const options: ts.CompilerOptions = { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, noEmit: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.NodeNext, moduleResolution: typescript.ModuleResolutionKind.NodeNext, types: [], baseUrl: directory,
    paths: { "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")], "hson-live/livemap": [join(root, "dist/api/livemap/index.d.ts")] }, ...extraOptions };
  const live = new Map<string, string>(); const versions = new Map<string, number>(); let revision = 0;
  const roots = Object.keys(files).filter(file => /\.[cm]?tsx?$/.test(file)).map(file => join(directory, file));
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options, getScriptFileNames: () => roots, getProjectVersion: () => String(revision),
    getScriptVersion: file => String(versions.get(file) ?? 0),
    getScriptSnapshot: file => { const text = live.get(file) ?? (existsSync(file) ? readFileSync(file, "utf8") : undefined); return text === undefined ? undefined : typescript.ScriptSnapshot.fromString(text); },
    getCurrentDirectory: () => directory, getDefaultLibFileName: typescript.getDefaultLibFilePath, useCaseSensitiveFileNames: () => true,
    fileExists: typescript.sys.fileExists, readFile: typescript.sys.readFile, readDirectory: typescript.sys.readDirectory, directoryExists: typescript.sys.directoryExists, getDirectories: typescript.sys.getDirectories,
  };
  const underlying = typescript.createLanguageService(host);
  const service = create_schema_language_service(typescript, underlying, host, join(directory, "tsconfig.json"));
  const file = (name: string) => join(directory, name);
  const text = (name: string) => live.get(file(name)) ?? readFileSync(file(name), "utf8");
  return { directory, service, underlying, host, file, text, options,
    edit(name: string, source: string) { live.set(file(name), source); versions.set(file(name), (versions.get(file(name)) ?? 0) + 1); revision++; },
    errors(name: string) { return service.getSemanticDiagnostics(file(name)); },
  };
}
const producer = '\uFEFFimport { Hson, type JsonFromSchema } from "hson-live";\r\n// before\r\nconst before: number = "wrong-before";\r\nexport const Thing = Hson.schema`<type "data" content <name "string" status <exact "ready">>>`;\r\n// between\r\nconst between: number = "wrong-between";\r\nexport const Slide = Hson.schema`<type "document">`;\r\nexport const Twin = Hson.schema`<type "document">`;\r\nconst after: number = "wrong-after";\r\ndeclare const local: JsonFromSchema<typeof Thing>;\r\nconst localName: string = local.name;\r\nlocal.na';
const consumer = 'import { type JsonFromSchema, type HsonSchema, type HsonData, type HsonDocument } from "hson-live";\nimport { Thing, Slide, Twin } from "./schema.js";\nimport { imported } from "./second.js";\ndeclare const value: JsonFromSchema<typeof Thing>;\nconst name: string = value.name;\nconst status: "ready" = value.status;\nconst wrong: number = value.name;\ntype WrongMode = HsonData<typeof Slide>;\ndeclare const doc: HsonDocument<typeof Slide>;\nconst wrongIdentity: HsonDocument<typeof Twin> = doc;\nconst sameIdentity: HsonDocument<typeof Slide> = imported;\n';
const app = project("live", { "schema.ts": producer, "consumer.ts": consumer, "second.ts": 'import { type HsonDocument } from "hson-live"; import { Slide } from "./schema.js"; export declare const imported: HsonDocument<typeof Slide>;\n' });
const originalBytes = bytes(app.directory);
const messages = (values: readonly ts.Diagnostic[]) => values.map(value => `${value.code}@${value.start}: ${ts.flattenDiagnosticMessageText(value.messageText, "\n")}`).join("\n");

check("verified proof diagnostics and correction work on each supplied TypeScript host", () => {
  const hostPath = process.env["HSON_TEST_HOST_TYPESCRIPT"];
  const hosts: readonly (typeof ts)[] = hostPath === undefined ? [ts] : [ts, createRequire(import.meta.url)(hostPath)];
  for (const host of hosts) {
    const source = 'import { Hson, type HsonData } from "hson-live";\nconst S = Hson.schema`\n  <type "data" content <name "string">>\n`;\nconst bad: HsonData<typeof S> = Hson.data`<name 3>`;';
    const app = project(`proof-host-${host.version}`, { 'app.ts': source }, {}, host);
    const errors = app.errors('app.ts');
    assert.deepEqual(errors.map(error => error.code), [95002], `${host.version}: ${messages(errors)}`);
    assert.equal(errors[0]?.start, source.lastIndexOf('3'));
    assert.equal(errors[0]?.length, 1);
    assert.match(messages(errors), /expected string; received number/);
    app.edit('app.ts', source.replace('<name 3>', '<name "Ada">'));
    assert.deepEqual(app.errors('app.ts'), [], host.version);
    const unsafe = source + '\nconst unrelated: number = "wrong";\nconst wrongFamily: HsonData<typeof S> = Hson.document`<main/>`;\ndeclare const opaque: string;\nconst unverified: HsonData<typeof S> = opaque;';
    app.edit('app.ts', unsafe);
    const retained = app.errors('app.ts');
    assert.equal(retained.filter(error => error.code === 95002).length, 1, messages(retained));
    for (const name of ['unrelated', 'wrongFamily', 'unverified']) assert.ok(retained.some(error => error.code === 2322 && error.start === unsafe.indexOf(`const ${name}:`) + 6), `${host.version} ${name}: ${messages(retained)}`);
    app.service.dispose();
    console.log(`ok - proof diagnostics and correction on TypeScript ${host.version}`);
  }
});

check("alias assignments and targeted Hson problems use the live editor view", () => {
  const aliases = project("annotation-aliases", {
    "schema.ts": `import { Hson, type HsonFromSchema, type HsonData, type HsonDocument } from "hson-live";
export const DataSchema = Hson.schema\`<type "data" content <name "string">>\`;
export const DocSchema = Hson.schema\`<type "document" tag "main" content "empty">\`;
export type Imported = HsonData<typeof DataSchema>;
export type ImportedDoc = HsonDocument<typeof DocSchema>;
export type ImportedHsonDoc = HsonFromSchema<typeof DocSchema>;
`,
    "consumer.ts": `import { Hson, type HsonFromSchema, type HsonData, type JsonFromSchema } from "hson-live";
import { DataSchema, DocSchema, type Imported, type ImportedDoc, type ImportedHsonDoc } from "./schema.js";
type Local = HsonData<typeof DataSchema>; export type Chain = Local;
const direct: HsonData<typeof DataSchema> = Hson.data\`<name "Ada">\`;
const local: Chain = Hson.data\`<name "Ada">\`;
const imported: Imported = Hson.data\`<name "Ada">\`;
const document: ImportedDoc = DocSchema.certify(Hson.document\`<main/>\`);
type HsonLocal = HsonFromSchema<typeof DataSchema>; type HsonChain = HsonLocal;
const hsonDirect: HsonFromSchema<typeof DataSchema> = Hson.data\`<name "Ada">\`;
const hsonAlias: HsonChain = Hson.data\`<name "Ada">\`;
const hsonDocument: HsonFromSchema<typeof DocSchema> = DocSchema.certify(Hson.document\`<main/>\`);
const hsonDocumentAlias: ImportedHsonDoc = DocSchema.certify(Hson.document\`<main/>\`);
const hsonInvalid: HsonChain = Hson.data\`<name 37>\`;
const hsonDocumentInvalid: ImportedHsonDoc = DocSchema.certify(Hson.document\`<aside/>\`);
const invalid: Chain = Hson.data\`<name 37>\`;
type Value = JsonFromSchema<typeof DataSchema>;
const projected: Value = Hson.data\`<name "Ada">\`;
type Missing = HsonData<typeof MissingSchema>;
const unresolved: Missing = Hson.data\`<name "Ada">\`;
`,
    "lookalike.ts": `import { Hson } from "hson-live";
import { DataSchema } from "./schema.js";
type HsonData<S> = string; type Alias = HsonData<typeof DataSchema>;
const fake: Alias = Hson.data\`<name 37>\`;
`,
    "binding.ts": `import { Hson } from "hson-live";
import type { Imported } from "./schema.js";
const DataSchema = Hson.schema\`<type "data" content <name "number">>\`;
const correct: Imported = Hson.data\`<name "Ada">\`;
const incorrect: Imported = Hson.data\`<name 37>\`;
`,
  });
  const errors = aliases.errors("consumer.ts");
  const problems = errors.filter(error => error.source === "hson-schema");
  assert.equal(problems.length, 5, messages(errors));
  assert.match(messages(problems), /Static Hson does not satisfy DataSchema/);
  assert.match(messages(problems), /JSON\/JS value representation.*HsonFromSchema<typeof DataSchema>/);
  assert.match(messages(problems), /Unable to resolve the Schema proof/);
  const source = aliases.text("consumer.ts");
  for (const name of ["direct", "local", "imported", "document", "hsonDirect", "hsonAlias", "hsonDocument", "hsonDocumentAlias"]) {
    const start = source.indexOf(`const ${name}:`) + 6;
    assert.ok(!errors.some(error => error.start === start), `${name}: ${messages(errors)}`);
  }
  assert.equal(aliases.errors("lookalike.ts").length, 0, "Shadowed local spelling establishes no Schema relationship");
  const bindingErrors = aliases.errors("binding.ts");
  assert.equal(bindingErrors.length, 1, messages(bindingErrors));
  assert.match(messages(bindingErrors), /Static Hson does not satisfy DataSchema.*expected string/);
  assert.ok(bindingErrors[0]!.start! > aliases.text("binding.ts").indexOf("const incorrect:"), "Imported aliases retain their defining Schema binding despite a same-name consumer binding");
  aliases.service.dispose();
});

check("producer and cross-module consumers have precise value, mode and declaration identity", () => {
  assert.deepEqual(local_hson_schema_diagnostics(app.file("schema.ts"), app.text("schema.ts")), []);
  const errors = app.errors("consumer.ts");
  assert.equal(errors.length, 3, messages(errors));
  assert.ok(!messages(errors).includes("/.hson/"), messages(errors));
  for (const marker of ["wrong:", "WrongMode", "wrongIdentity:"]) assert.ok(errors.some(error => (error.start ?? -1) >= consumer.indexOf(marker) && (error.start ?? -1) < consumer.indexOf(marker) + 45), marker);
  assert.equal(app.errors("second.ts").length, 0);
  const hover = app.service.getQuickInfoAtPosition(app.file("schema.ts"), producer.indexOf("Thing ="));
  assert.ok(hover); assert.equal(hover.textSpan.start, producer.indexOf("Thing ="));
  assert.match(ts.displayPartsToString(hover.displayParts), /HsonSchema/);
  const source = app.service.getProgram()?.getSourceFile(app.file("schema.ts")); assert.ok(source);
  assert.match(source.text, /Evidence/); assert.equal(app.text("schema.ts"), producer);
});

check("real diagnostics before, between and after generated insertions map to authored bytes", () => {
  const errors = app.errors("schema.ts");
  assert.equal(errors.length, 4, messages(errors));
  for (const name of ["before", "between", "after"]) {
    const expected = producer.indexOf(`const ${name}:`) + 6;
    const error = errors.find(item => item.start === expected); assert.ok(error, messages(errors));
    assert.equal(error.length, name.length); assert.equal(error.file?.text, producer);
  }
  assert.ok(errors.every(error => !ts.flattenDiagnosticMessageText(error.messageText, "\n").includes("__HsonSchema")));
});

check("definitions, bound spans, references and rename use authored coordinates", () => {
  const offset = consumer.indexOf("typeof Thing") + 7;
  const definition = app.service.getDefinitionAtPosition(app.file("consumer.ts"), offset)?.find(item => item.fileName === app.file("schema.ts"));
  assert.ok(definition); assert.equal(definition.textSpan.start, producer.indexOf("Thing =")); assert.equal(definition.textSpan.length, 5);
  const bound = app.service.getDefinitionAndBoundSpan(app.file("consumer.ts"), offset); assert.equal(bound?.textSpan.start, offset);
  const references = app.service.getReferencesAtPosition(app.file("schema.ts"), producer.indexOf("Thing ="));
  assert.ok(references?.some(item => item.fileName === app.file("consumer.ts") && item.textSpan.start === offset));
  const rename = app.service.findRenameLocations(app.file("schema.ts"), producer.indexOf("Thing ="), false, false, {});
  assert.ok(rename && rename.length >= 4);
  for (const location of rename) { assert.ok(!location.fileName.includes("/.hson/")); assert.equal(app.text(relative(app.directory, location.fileName)).slice(location.textSpan.start, location.textSpan.start + location.textSpan.length), "Thing"); }
});

check("member completion replacement spans remain authored after multiple transforms", () => {
  const result = app.service.getCompletionsAtPosition(app.file("schema.ts"), producer.length, {});
  assert.ok(result); assert.ok(result.entries.some(entry => entry.name === "name"));
  const range = result.optionalReplacementSpan ?? result.entries.find(entry => entry.name === "name")?.replacementSpan;
  assert.ok(range); assert.equal(producer.slice(range.start, range.start + range.length), "na");
});

check("unsaved valid edits update consumers immediately and preserve identity module names", () => {
  const before = app.service.getProgram()?.getSourceFiles().filter(file => file.fileName.includes("/editor-evidence/")).map(file => file.fileName).sort();
  const slideFile = before?.find(file => file.endsWith("Slide.hson-schema.generated.ts")); assert.ok(slideFile);
  const slideSnapshot = app.host.getScriptSnapshot(slideFile);
  app.edit("schema.ts", producer.replace('name "string"', 'name "number"'));
  const errors = app.errors("consumer.ts");
  assert.ok(errors.some(error => error.start === consumer.indexOf("name: string")), messages(errors));
  assert.ok(!errors.some(error => error.start === consumer.indexOf("wrong: number")), messages(errors));
  assert.equal(app.errors("second.ts").length, 0);
  assert.deepEqual(app.service.getProgram()?.getSourceFiles().filter(file => file.fileName.includes("/editor-evidence/")).map(file => file.fileName).sort(), before);
  assert.equal(app.host.getScriptSnapshot(slideFile), slideSnapshot, "Unchanged declarations reuse the identical evidence snapshot.");
});

check("invalid and unterminated unsaved Schemas withdraw proof and recover without saves", () => {
  for (const source of [producer.replace('content <name "string"', 'content <name "broken"'), producer.slice(0, producer.indexOf('content <name')) + 'content <']) {
    app.edit("schema.ts", source);
    const local = local_hson_schema_diagnostics(app.file("schema.ts"), source);
    assert.ok(local.length > 0 || app.service.getSyntacticDiagnostics(app.file("schema.ts")).length > 0);
    assert.ok(local.every(error => !error.code.startsWith("HSON_SCHEMA_GENERATED_EVIDENCE")));
    const errors = app.errors("consumer.ts");
    assert.ok(errors.some(error => ts.flattenDiagnosticMessageText(error.messageText, " ").includes("unknown")), messages(errors));
    assert.ok(!app.service.getProgram()?.getSourceFiles().some(file => file.fileName.endsWith("Thing.hson-schema.generated.ts")));
  }
  app.edit("schema.ts", producer);
  assert.deepEqual(local_hson_schema_diagnostics(app.file("schema.ts"), producer), []);
  assert.equal(app.errors("consumer.ts").length, 3, messages(app.errors("consumer.ts")));
});

check("duplicate unsaved Schema names withdraw all ambiguous evidence and recover", () => {
  const single = 'import { Hson } from "hson-live";\nexport const S = Hson.schema`<type "data" content <a "string">>`;\n';
  const duplicate = `${single}export const S = Hson.schema\`<type "data" content <b "number">\`;\n`;
  const test = project("duplicate-live", {
    "schema.ts": single,
    "consumer.ts": 'import { type JsonFromSchema } from "hson-live"; import { S } from "./schema.js"; declare const value: JsonFromSchema<typeof S>; const a: string = value.a;\n',
  });
  assert.equal(test.errors("consumer.ts").length, 0, messages(test.errors("consumer.ts")));
  assert.ok(test.service.getProgram()?.getSourceFiles().some(file => file.fileName.endsWith("S.hson-schema.generated.ts")));
  test.edit("schema.ts", duplicate);
  assert.ok(test.errors("schema.ts").some(error => error.code === 2451), messages(test.errors("schema.ts")));
  assert.ok(test.errors("consumer.ts").some(error => error.code === 2344), messages(test.errors("consumer.ts")));
  assert.ok(!test.service.getProgram()?.getSourceFiles().some(file => file.fileName.endsWith("S.hson-schema.generated.ts")));
  test.edit("schema.ts", single);
  assert.equal(test.errors("consumer.ts").length, 0, messages(test.errors("consumer.ts")));
  assert.ok(test.service.getProgram()?.getSourceFiles().some(file => file.fileName.endsWith("S.hson-schema.generated.ts")));
  test.service.dispose();
});

check("edits before, between and after declarations update all position mappings", () => {
  const updated = producer.replace('// before', '// more text before\r\n// before').replace('// between', '// extra between\r\n// between').replace('const after:', '// after too\r\nconst after:');
  app.edit("schema.ts", updated);
  const errors = app.errors("schema.ts");
  for (const name of ["before", "between", "after"]) assert.ok(errors.some(error => error.start === updated.indexOf(`const ${name}:`) + 6), messages(errors));
  const definition = app.service.getDefinitionAtPosition(app.file("consumer.ts"), consumer.indexOf("typeof Thing") + 7)?.find(item => item.fileName === app.file("schema.ts"));
  assert.equal(definition?.textSpan.start, updated.indexOf("Thing ="));
  app.edit("schema.ts", producer);
});

check("mapping handles generated-only, copied and boundary-crossing ranges deterministically", () => {
  const mapping = new SchemaSourceMapping("abcdef", [{ start: 1, end: 1, text: "GEN" }, { start: 3, end: 5, text: "TYPE" }]);
  assert.equal(mapping.text, "aGENbcTYPEf");
  assert.equal(mapping.to_transformed(1), 4);
  assert.deepEqual(mapping.to_authored({ start: 4, length: 2 }), { start: 1, length: 2 });
  assert.equal(mapping.to_authored({ start: 1, length: 3 }), undefined);
  assert.deepEqual(mapping.to_authored({ start: 0, length: 5 }), { start: 0, length: 2 });
  assert.equal(mapping.authored_edit({ start: 0, length: 5 }), undefined);
});

check("the diagnostic boundary suppresses generated-only spans while preserving crossing application spans", () => {
  const program = app.service.getProgram(); const source = program?.getSourceFile(app.file("schema.ts")); assert.ok(source);
  const original = app.underlying.getSemanticDiagnostics;
  const tagStart = source.text.indexOf("Hson.schema`");
  const importStart = source.text.lastIndexOf("import type");
  app.underlying.getSemanticDiagnostics = () => [
    { file: source, start: importStart, length: 11, code: 99991, category: ts.DiagnosticCategory.Error, messageText: "Generated-only test diagnostic" },
    { file: source, start: tagStart - 1, length: 5, code: 99992, category: ts.DiagnosticCategory.Error, messageText: "Boundary-spanning test diagnostic" },
  ];
  try {
    const errors = app.errors("schema.ts"); assert.equal(errors.length, 1); assert.equal(errors[0]?.code, 99992);
    assert.equal(errors[0]?.start, producer.indexOf("Hson.schema`")); assert.equal(errors[0]?.length, 4);
  } finally { app.underlying.getSemanticDiagnostics = original; }
});

check("formatting and refactor edit services see only authored source", () => {
  const changes = app.service.getFormattingEditsForDocument(app.file("schema.ts"), { indentSize: 2, tabSize: 2, convertTabsToSpaces: true });
  assert.ok(changes.every(change => change.span.start + change.span.length <= producer.length && !change.newText.includes("__Hson")));
  const organized = app.service.organizeImports({ type: "file", fileName: app.file("schema.ts") }, {}, {});
  assert.ok(organized.every(file => file.textChanges.every(change => !change.newText.includes("Evidence") && !change.newText.includes("__Hson"))));
});

check("a Schema at end of file needs neither a semicolon nor a trailing newline", () => {
  const test = project("eof", { "schema.ts": 'import { Hson } from "hson-live"; export const S = Hson.schema`<type "data">`' });
  assert.equal(test.errors("schema.ts").length, 0); assert.equal(test.service.getSyntacticDiagnostics(test.file("schema.ts")).length, 0);
  test.service.dispose();
});

check("unsaved direct Schema attachment refines immediately and stale proofs are withdrawn", () => {
  const declaration = 'export const Page = Hson.schema`<type "document" tag "main" content "string">`;';
  const prefix = 'import { Hson, hsonLiveMap } from "hson-live";\n';
  const map = 'const map = hsonLiveMap.fromLibraries({ home: { document: `<main "hello"/>` } });\n';
  const exact = 'const exact: typeof Page = map.doc.must("home").schema.get();\nconst text: string = map.doc.must("home").at([0]).snap();\n';
  const attached = `${prefix}${declaration}\n${map}map.doc.must("home").schema.use(Page);\n${exact}`;
  const broad = `${prefix}${declaration}\n${map}${exact}`;
  const test = project("attachment-live", { "index.ts": broad });
  assert.ok(test.errors("index.ts").some(error => error.code === 2322), messages(test.errors("index.ts")));

  test.edit("index.ts", attached);
  assert.equal(test.errors("index.ts").length, 0, messages(test.errors("index.ts")));

  test.edit("index.ts", attached.replaceAll('doc.must("home")', "doc.home"));
  assert.equal(test.errors("index.ts").length, 0, messages(test.errors("index.ts")));

  test.edit("index.ts", attached.replaceAll('doc.must("home")', 'doc["home"]'));
  assert.equal(test.errors("index.ts").length, 0, messages(test.errors("index.ts")));

  test.edit("index.ts", attached.replaceAll('doc.must("home")', '["doc"]["must"]("home")').replaceAll("map.[", "map["));
  assert.equal(test.errors("index.ts").length, 0, messages(test.errors("index.ts")));

  test.edit("index.ts", broad);
  assert.ok(test.errors("index.ts").some(error => error.code === 2322), messages(test.errors("index.ts")));

  const dynamic = `${prefix}${declaration}\n${map}declare const name: string;\nmap.doc.must(name).schema.use(Page);\n${exact}`;
  test.edit("index.ts", dynamic);
  assert.ok(test.errors("index.ts").some(error => error.code === 2322), messages(test.errors("index.ts")));

  test.edit("index.ts", attached.replace('content "string"', 'content <'));
  assert.ok(test.errors("index.ts").length > 0, "Invalid unsaved Schema text must withdraw attachment evidence.");
  test.service.dispose();
});

check("final Library authoring uses source and emitted entrypoints under both strict optional modes", () => {
  for (const output of ["src", "dist"]) for (const exactOptionalPropertyTypes of [false, true]) {
    const extension = output === "src" ? "ts" : "d.ts";
    const prefix = `import { Hson, hsonLiveMap, type HsonData, type HsonDocument } from "hson-live";
const S = Hson.schema\`<type "data" content <name "string" values <array "number">>>\`;
const P = Hson.schema\`<type "document" tag "main" content "string">\`;
const loc = hsonLiveMap.locus.create({
  deck: { data: { name: "Ada", values: [1] }, schema: S },
  page: { document: Hson.document\`<main "body"/>\`, schema: P, access: "shared" },
  components: { parts: { submit: { kind: "document", document: Hson.document\`<button hson:part "submit"/>\` }, snap: { kind: "document", document: Hson.document\`<span hson:part/>\` } } },
});
const selected = loc.data.must("deck", S);
const optional = loc.data("deck", S);
const value: string = selected.snap().name;
const numbers: readonly number[] = selected.at(["values"]).snap();
const leaf: number | undefined = selected.at(["values", 0]).snap();
const required: number = selected.at(["values", 0]).must.snap();
const canonical: HsonData = selected.hson();
const markup: string = loc.doc["page"].snap();
const document: HsonDocument = loc.doc.page.hson();
const complete: string = loc.doc.page.render();
const fragment: string = loc.doc.page.at([0]).must.snap();
const fragmentHson: HsonDocument = loc.doc.page.at([0]).must.hson();
loc.parts.components.submit.snap();
loc.parts.components.at(["snap"]).snap();
// @ts-expect-error Optional lookup does not prove presence.
optional.snap();
// @ts-expect-error Checked selection cannot change the permanent owner evidence.
loc.data.deck.at(["missing"]);
// @ts-expect-error Part definitions cannot render independently.
loc.parts.components.submit.render();
// @ts-expect-error Parts cannot attach a supplemental Schema.
loc.parts.components.schema.use(S);
// @ts-expect-error Locus does not expose local Schema mutation.
loc.data.deck.schema.use(S);
// @ts-expect-error Selected document locations do not render.
loc.doc.page.at([0]).render();
// @ts-expect-error Removed family-neutral selectors stay removed.
loc.lib;
// @ts-expect-error Removed admission batching stays removed.
loc.admit.batch;
async function admit() {
  const receipt = await loc.admit({ incoming: { data: { name: "new", values: [] }, schema: S } });
  // @ts-expect-error Admission does not return a selection receipt.
  receipt.libraries;
  // @ts-expect-error Runtime admission does not rewrite construction-time names.
  loc.data.incoming;
  const incoming: string = loc.data.must("incoming", S).snap().name;
}
`;
    const test = project(`library-final-${output}-${exactOptionalPropertyTypes}`, { "index.ts": prefix }, {
      exactOptionalPropertyTypes, noPropertyAccessFromIndexSignature: true,
      paths: Object.fromEntries([
        ["hson-live", `${output}/index.${extension}`],
        ["hson-live/hson", `${output}/hson-authoring.${extension}`],
        ["hson-live/livemap", `${output}/api/livemap/index.${extension}`],
      ].map(([name, path]) => [name!, [join(root, path!)]])),
    });
    assert.equal(test.errors("index.ts").length, 0, messages(test.errors("index.ts")));
    const completions = (expression: string) => {
      const text = prefix + expression;
      test.edit("index.ts", text);
      return test.service.getCompletionsAtPosition(test.file("index.ts"), text.length, {})?.entries.map(entry => entry.name) ?? [];
    };
    for (const name of ["doc", "data", "parts"]) assert.ok(completions("loc.").includes(name), name);
    assert.ok(!completions("loc.").includes("lib"));
    assert.ok(completions("loc.data.").includes("deck"));
    assert.ok(!completions("loc.data.").includes("page"));
    assert.ok(!completions("loc.data.").includes("incoming"));
    assert.ok(completions("loc.parts.components.").includes("submit"));
    for (const name of ["snap", "hson"]) assert.ok(completions('loc.doc.page.at([0]).must.').includes(name));
    assert.ok(completions('loc.data.must("deck", S).snap().').includes("name"));
    assert.ok(completions('loc.data.must("deck", S).snap().').includes("values"));
    assert.ok(!completions("loc.parts.components.submit.").includes("render"));
    assert.ok(!completions("loc.parts.components.schema.").includes("use"));
    test.service.dispose();
  }
});

check("flat construction and admission candidates share official source evidence without certifying checked lookups", () => {
  const prefix = `import { Hson, hsonLiveMap } from "hson-live";
const S = Hson.schema\`<type "data" content <name "string">>\`;
const P = Hson.schema\`<type "document" tag "main" content "empty">\`;
`;
  const cases: readonly (readonly [string, number])[] = [
    ['hsonLiveMap.locus.create({ deck: { data: { name: 42 }, schema: S } });', 1],
    ['hsonLiveMap.locus.create({ page: { document: Hson.document`<aside/>`, schema: P } }, {});', 1],
    ['hsonLiveMap.locus.resume({ deck: { data: { name: 42 }, schema: S } }, {});', 1],
    ['const loc = hsonLiveMap.locus.create({}); loc.admit({ deck: { data: { name: 42 }, schema: S } });', 1],
    ['const map = hsonLiveMap.create(); map.addLibraries({ deck: { data: { name: 42 }, schema: S } });', 1],
    ['const map = hsonLiveMap.fromLibraries({ deck: { data: { name: 42 } } }); map.data["deck"].schema.use(S);', 1],
    ['const loc = hsonLiveMap.locus.create({ deck: { data: { name: 42 } } }); loc.data.must("deck", S);', 0],
    ['const map = hsonLiveMap.fromLibraries({ deck: { data: { name: 42 } } }); map.data("deck", S);', 0],
    ['const map = hsonLiveMap.fromLibraries({ deck: { data: { name: 42 } } }); map.data("deck")?.schema.use(S);', 0],
    ['declare const rest: object; const map = hsonLiveMap.fromLibraries({ deck: { data: { name: 42 }, ...rest } }); map.data.deck.schema.use(S);', 0],
    ['declare const value: unknown; hsonLiveMap.locus.create({ deck: { data: value, schema: S } });', 0],
    ['const loc = { admit(defs: unknown) {} }; loc.admit({ deck: { data: { name: 42 }, schema: S } });', 0],
    ['const other = { locus: { create(defs: unknown) {} } }; other.locus.create({ deck: { data: { name: 42 }, schema: S } });', 0],
    ['const value = Hson.data`<name 42>`;', 0],
  ];
  for (const [index, [body, expected]] of cases.entries()) {
    const test = project(`library-candidate-${index}`, { "index.ts": prefix + body });
    const errors = test.errors("index.ts").filter(error => ts.flattenDiagnosticMessageText(error.messageText, "\n").startsWith("Static Hson"));
    assert.equal(errors.length, expected, `${body}\n${messages(test.errors("index.ts"))}`);
    test.service.dispose();
  }
});

check("official candidates reject consumer filename collisions with the supplied host AST", () => {
  const hostPath = process.env["HSON_TEST_HOST_TYPESCRIPT"];
  const hosts: readonly (typeof ts)[] = hostPath === undefined ? [ts] : [ts, createRequire(import.meta.url)(hostPath)];
  for (const host of hosts) for (const entrypoint of ["hson-live", "hson-live/livemap"]) {
    const test = project(`host-ownership-${host.version}-${entrypoint.replaceAll("/", "-")}`, {
      "src/types/locus.core.types.ts": 'export interface Other { admit(definitions: unknown): void }',
      "dist/types/livemap.types.d.ts": 'export interface OtherMap { addLibraries(definitions: unknown): void }',
      "index.ts": `import { Hson, type HsonData } from "hson-live/hson";
import { hsonLiveMap } from "${entrypoint}";
import type { Other } from "./src/types/locus.core.types.js";
import type { OtherMap } from "./dist/types/livemap.types.js";
const S = Hson.schema\`<type "data" content <name "string">>\`;
declare const other: Other;
declare const otherMap: OtherMap;
other.admit({ fake: { data: { name: 42 }, schema: S } });
otherMap.addLibraries({ fake: { data: { name: 42 }, schema: S } });
const loc = hsonLiveMap.locus.create({});
loc.admit({ actual: { data: { name: 42 }, schema: S } });
const map = hsonLiveMap.fromLibraries({ actual: { data: { name: 42 } } });
map.data["actual"].schema.use(S);
const exact: typeof S = map.data.actual.schema.get();
const value: HsonData<typeof S> = Hson.data\`<name 42>\`;
S.certify(Hson.data\`<name 43>\`);
`,
    }, {}, host);
    const diagnostics = test.errors("index.ts");
    const candidates = diagnostics.filter(diagnostic => diagnostic.code === 95002);
    assert.equal(candidates.length, 4, `${host.version}: ${messages(diagnostics)}`);
    assert.ok(candidates.every(diagnostic => diagnostic.source === "hson-schema"
      && diagnostic.start !== undefined && diagnostic.start >= test.text("index.ts").indexOf("loc.admit")));
    assert.ok(!diagnostics.some(diagnostic => diagnostic.code !== 95002), messages(diagnostics));
    const program = host.createProgram(test.host.getScriptFileNames(), test.options);
    const staticCandidates = static_schema_candidate_diagnostics(host, program);
    assert.equal(staticCandidates.length, 4, `${host.version}: ${JSON.stringify(staticCandidates)}`);
    assert.ok(staticCandidates.every(diagnostic => diagnostic.start >= test.text("index.ts").indexOf("loc.admit")));
    if (host === ts) {
      const config = test.file("tsconfig.json");
      writeFileSync(config, JSON.stringify({ compilerOptions: { ...test.options, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext" }, files: [test.file("index.ts")] }));
      for (const cli of [["--import=tsx", "scripts/hson-schema.mts"], ["dist/hson-schema.mjs"]]) {
        const generated = spawnSync(process.execPath, [...cli, "generate", "--project", config], { cwd: root, encoding: "utf8" });
        assert.notEqual(generated.status, 0, "Official invalid candidates still fail generation");
        const manifest = JSON.parse(readFileSync(test.file(".hson/compiler-input/tsconfig.json/manifest.json"), "utf8"));
        assert.equal(manifest.diagnostics.filter((message: string) => message.includes("Static Hson does not satisfy")).length, 4, JSON.stringify(manifest.diagnostics));
      }
    }
    test.edit("index.ts", test.text("index.ts").replaceAll('name: 42', 'name: "ok"').replace('<name 42>', '<name "ok">').replace('<name 43>', '<name "ok">'));
    assert.equal(test.errors("index.ts").length, 0, messages(test.errors("index.ts")));
    const completionSource = 'import { Hson, type HsonData } from "hson-live"; const S = Hson.schema`<type "data" defs <Age "number" User <content <age <ref "Age">>>> content <ref "User">>`; const value: HsonData<typeof S> = Hson.data`<ag`;';
    test.edit("index.ts", completionSource);
    const complete = (offset: number) => test.service.getCompletionsAtPosition(test.file("index.ts"), offset, {})?.entries.map(entry => entry.name) ?? [];
    assert.deepEqual(complete(completionSource.indexOf('<ref "Age"') + 6), ["Age", "User"], `${host.version}: Schema reference completion`);
    assert.deepEqual(complete(completionSource.indexOf('<ag`') + 3), ["age"], `${host.version}: governed data completion`);
    test.service.dispose();
  }
});

check("constructor ownership uses official called declarations without instantiating signatures", () => {
  const hostPath = process.env["HSON_TEST_HOST_TYPESCRIPT"];
  const hosts: readonly (typeof ts)[] = hostPath === undefined ? [ts] : [ts, createRequire(import.meta.url)(hostPath)];
  for (const host of hosts) for (const installation of ["source", "package", "symlink", "reexport", "lookalike", "typed-replacement", "dynamic"] as const) {
    const official = !["lookalike", "typed-replacement", "dynamic"].includes(installation);
    const calls: readonly (readonly [string, boolean])[] = [
      ['api.locus.create({ bad: { data: { name: 42 }, schema: S } })', official],
      ['api["locus"]["resume"]({ bad: { data: { name: 42 }, schema: S } }, {})', official],
      ['api.fromLibraries({ bad: { data: { name: 42 }, schema: S } })', official],
      ['namespace.locus.create({ bad: { data: { name: 42 }, schema: S } })', official],
      ['namespace.fromLibraries({ bad: { data: { name: 42 }, schema: S } })', official],
      ['rootApi.locus.create({ bad: { data: { name: 42 }, schema: S } })', true],
      ['unrelated.locus.create({ bad: { data: { name: 42 }, schema: S } })', false],
      ['unrelated.create({ bad: { data: { name: 42 }, schema: S } })', false],
      ['collision.create({ bad: { data: { name: 42 }, schema: S } })', false],
      ['collision.resume({ bad: { data: { name: 42 }, schema: S } }, {})', false],
      ['collision.fromLibraries({ bad: { data: { name: 42 }, schema: S } })', false],
      ['typed.locus.create({ bad: { data: { name: 42 }, schema: S } })', false],
      ['api["locus"][key]({ bad: { data: { name: 42 }, schema: S } })', false],
    ];
    const test = project(`constructor-${host.version}-${installation}`, {
      "src/api/locus/locus.public.ts": `export const collision = {
  create(definitions: unknown) {}, resume(definitions: unknown, options: unknown) {}, fromLibraries(definitions: unknown) {}
};`,
      "bridge.ts": `import { hsonLiveMap as mapValue, locus as locusValue, fromLibraries as localValue } from ${JSON.stringify(join(root, "dist/api/livemap/index.js"))};
export { mapValue as hsonLiveMap, locusValue as locus, localValue as fromLibraries };`,
      "replacement.ts": `import { hsonLiveMap as original } from ${JSON.stringify(join(root, "dist/api/livemap/index.js"))};
const unrelated: typeof original.locus.create = () => { throw new Error("This is not a Hson operation"); };
const unrelatedResume: typeof original.locus.resume = () => { throw new Error("Not Hson"); };
const unrelatedLocal: typeof original.fromLibraries = () => { throw new Error("Not Hson"); };
const replacement = { ...original, locus: { ...original.locus, create: unrelated, resume: unrelatedResume }, fromLibraries: unrelatedLocal };
declare const uncertain: boolean;
export const hsonLiveMap: typeof original = ${installation === "dynamic" ? "uncertain ? original : replacement" : "replacement"};
export const locus = ${installation === "dynamic" ? "uncertain ? original.locus : replacement.locus" : "replacement.locus"};
export const fromLibraries = ${installation === "dynamic" ? "uncertain ? original.fromLibraries : unrelatedLocal" : "unrelatedLocal"};`,
      "node_modules/lookalike/package.json": '{"name":"hson-lookalike","type":"module"}',
      "node_modules/lookalike/dist/api/locus/locus.public.d.ts": `export declare const locus: {
  create(definitions: unknown): unknown; resume(definitions: unknown, options: unknown): unknown;
};
export declare function fromLibraries(definitions: unknown): unknown;
export declare const hsonLiveMap: { locus: typeof locus; fromLibraries: typeof fromLibraries };`,
      "index.ts": `import { Hson, hsonLiveMap as rootApi } from "hson-live";
import { hsonLiveMap as api } from "hson-live/livemap";
import * as namespace from "hson-live/livemap";
import { collision } from "./src/api/locus/locus.public.js";
const S = Hson.schema\`<type "data" content <name "string">>\`;
const unrelated = { create(definitions: unknown) {}, locus: collision };
declare const typed: typeof rootApi;
declare const key: "create";
${calls.map(([call], index) => `const probe${index} = ${call};`).join("\n")}
function shadow(rootApi: typeof import("hson-live").hsonLiveMap) {
  const probeShadow = rootApi.locus.create({ bad: { data: { name: 42 }, schema: S } });
}
const loc = rootApi.locus.create({});
loc.admit({ bad: { data: { name: 42 }, schema: S } });
const local = rootApi.fromLibraries({});
local.addLibraries({ bad: { data: { name: 42 }, schema: S } });
`,
    }, { paths: installation === "symlink" ? {} : {
      "hson-live": [join(root, installation === "source" ? "src/index.ts" : "dist/index.d.ts")],
      "hson-live/livemap": [installation === "reexport" ? "./bridge.ts"
        : installation === "typed-replacement" || installation === "dynamic" ? "./replacement.ts"
        : installation === "lookalike" ? "./node_modules/lookalike/dist/api/locus/locus.public.d.ts"
        : join(root, installation === "source" ? "src/api/livemap/index.ts" : "dist/api/livemap/index.d.ts")],
    } }, host);
    if (installation === "symlink") symlinkSync(root, test.file("node_modules/hson-live"), "dir");
    const program = host.createProgram(test.host.getScriptFileNames(), test.options);
    const source = program.getSourceFile(test.file("index.ts"))!;
    const checker = program.getTypeChecker();
    const bindings = read_supported_hson_import_symbols(source, checker, [], "hsonLiveMap", host);
    const resolveSignature = checker.getResolvedSignature;
    const signatureCalls: string[] = [];
    checker.getResolvedSignature = (...args) => {
      signatureCalls.push(args[0].getText(source));
      return resolveSignature(...args);
    };
    try {
      const visit = (node: ts.Node): void => {
        if (host.isVariableDeclaration(node) && host.isIdentifier(node.name) && node.name.text.startsWith("probe") && node.initializer !== undefined) {
          const index = Number(node.name.text.slice(5));
          const selected = library_source_definitions(node.initializer, checker, bindings, false, host);
          assert.equal(selected !== undefined, node.name.text === "probeShadow" ? false : calls[index]![1],
            `${host.version}/${installation}: ${node.initializer.getText(source)}`);
        }
        host.forEachChild(node, visit);
      };
      visit(source);
      assert.equal(signatureCalls.length, 0, "Constructor identity does not resolve generic call signatures");
      for (const statement of source.statements) if (host.isExpressionStatement(statement)) {
        assert.ok(library_source_definitions(statement.expression, checker, bindings, false, host), statement.getText(source));
      }
      assert.equal(signatureCalls.length, 2, "Both official admission forms still resolve signatures");
      assert.ok(signatureCalls[0]!.startsWith("loc.admit("));
      assert.ok(signatureCalls[1]!.startsWith("local.addLibraries("));
    } finally {
      checker.getResolvedSignature = resolveSignature;
    }
    const diagnostics = static_schema_candidate_diagnostics(host, program);
    assert.equal(diagnostics.length, calls.filter(([, recognized]) => recognized).length + 2,
      `${host.version}/${installation}: ${JSON.stringify(diagnostics)}`);
    if (host === ts && ["package", "reexport", "lookalike", "typed-replacement", "dynamic"].includes(installation)) {
      const config = test.file("tsconfig.json");
      writeFileSync(config, JSON.stringify({ compilerOptions: {
        ...test.options, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext",
      }, files: test.host.getScriptFileNames() }));
      for (const cli of [["--import=tsx", "scripts/hson-schema.mts"], ["dist/hson-schema.mjs"]]) {
        const generated = spawnSync(process.execPath, [...cli, "generate", "--project", config], { cwd: root, encoding: "utf8" });
        assert.notEqual(generated.status, 0, "Official invalid constructors/admissions still fail generation");
        const manifest = JSON.parse(readFileSync(test.file(".hson/compiler-input/tsconfig.json/manifest.json"), "utf8"));
        assert.equal(manifest.diagnostics.filter((message: string) => message.includes("Static Hson does not satisfy")).length,
          diagnostics.length, `${installation}: ${JSON.stringify(manifest.diagnostics)}`);
      }
      if (installation === "typed-replacement" || installation === "dynamic") {
        // Isolate the reviewer's counterexample: only the substituted operations
        // receive invalid candidates, so both CLIs must succeed without diagnostics.
        writeFileSync(test.file("index.ts"), `import { Hson } from "hson-live";
import { hsonLiveMap as api } from "hson-live/livemap";
import * as namespace from "hson-live/livemap";
const S = Hson.schema\`<type "data" content <name "string">>\`;
api.locus.create({ bad: { data: { name: 42 }, schema: S } });
namespace.locus.create({ bad: { data: { name: 42 }, schema: S } });
api.fromLibraries({ bad: { data: { name: 42 }, schema: S } });
namespace.fromLibraries({ bad: { data: { name: 42 }, schema: S } });
`);
        const isolated = host.createProgram(test.host.getScriptFileNames(), test.options);
        assert.deepEqual(host.getPreEmitDiagnostics(isolated), [], "Replacement fixture is valid TypeScript");
        assert.deepEqual(static_schema_candidate_diagnostics(host, isolated), []);
        assert.equal(test.errors("index.ts").filter(diagnostic => diagnostic.code === 95002).length, 0);
        for (const cli of [["--import=tsx", "scripts/hson-schema.mts"], ["dist/hson-schema.mjs"]]) {
          const generated = spawnSync(process.execPath, [...cli, "generate", "--project", config], { cwd: root, encoding: "utf8" });
          assert.equal(generated.status, 0, generated.stdout + generated.stderr);
          const manifest = JSON.parse(readFileSync(test.file(".hson/compiler-input/tsconfig.json/manifest.json"), "utf8"));
          assert.deepEqual(manifest.diagnostics, []);
        }
      }
    }
    test.service.dispose();
  }
});

check("canonical LiveMap namespace and aliases establish the same import binding as named imports", () => {
  for (const [name, imported, recognized] of [
    ["named-root", 'import { hsonLiveMap as mapApi } from "hson-live";', true],
    ["named-subpath", 'import { hsonLiveMap as mapApi } from "hson-live/livemap";', true],
    ["namespace", 'import * as hsonLiveMap from "hson-live/livemap";', true],
    ["namespace-alias", 'import * as mapApi from "hson-live/livemap";', true],
    ["root-namespace", 'import * as mapApi from "hson-live";', false],
    ["unrelated-namespace", 'import * as mapApi from "hson-live/echo";', false],
  ] as const) {
    const binding = name === "namespace" ? "hsonLiveMap" : "mapApi";
    const test = project(`livemap-import-${name}`, { "index.ts": `${imported}\nvoid ${binding}.create();\n` });
    const program = test.service.getProgram();
    const source = program?.getSourceFile(test.file("index.ts"));
    assert.ok(program && source);
    const declaration = source.statements.find(statement => ts.isImportDeclaration(statement));
    assert.ok(declaration && ts.isImportDeclaration(declaration));
    const imports = declaration.importClause?.namedBindings;
    assert.ok(imports);
    const local = ts.isNamespaceImport(imports) ? imports.name : imports.elements.find(element => (element.propertyName?.text ?? element.name.text) === "hsonLiveMap")?.name;
    assert.ok(local);
    const symbol = program.getTypeChecker().getSymbolAtLocation(local);
    assert.ok(symbol);
    assert.equal(read_supported_hson_import_symbols(source, program.getTypeChecker(), [], "hsonLiveMap").has(symbol), recognized, name);
    if (recognized) assert.equal(test.errors("index.ts").length, 0, `${name}\n${messages(test.errors("index.ts"))}`);
    test.service.dispose();
  }
});

check("LiveMap namespace construction receives named-import candidate diagnostics and attachment proofs", () => {
  const schema = 'import { Hson } from "hson-live/hson";\nconst Page = Hson.schema`<type "document" tag "main" content "string">`;\n';
  for (const [name, imported, binding] of [
    ["named", 'import { hsonLiveMap as mapApi } from "hson-live/livemap";', "mapApi"],
    ["namespace", 'import * as hsonLiveMap from "hson-live/livemap";', "hsonLiveMap"],
    ["alias", 'import * as mapApi from "hson-live/livemap";', "mapApi"],
  ] as const) {
    const prefix = `${schema}${imported}\n`;
    const map = `const empty = ${binding}.create();\nvoid empty;\nconst map = ${binding}.fromLibraries({ home: { document: '<main "hello"/>' } });\n`;
    const exact = 'const exact: typeof Page = map.doc.must("home").schema.get();\n';
    const test = project(`livemap-namespace-${name}`, { "index.ts": prefix + map + exact });
    assert.ok(test.errors("index.ts").some(error => error.code === 2322), name);
    test.edit("index.ts", prefix + map + 'map.doc.must("home").schema.use(Page);\n' + exact);
    assert.equal(test.errors("index.ts").length, 0, `${name}\n${messages(test.errors("index.ts"))}`);
    assert.match(test.service.getProgram()?.getSourceFile(test.file("index.ts"))?.text ?? "", /__hson_assert_library_schema\(map, "home", Page\)/, name);
    test.edit("index.ts", prefix + `const bad = Hson.document\`<aside "hello"/>\`;\nconst map = ${binding}.fromLibraries({ home: { document: bad } });\nmap.doc.must("home").schema.use(Page);\n`);
    assert.equal(test.errors("index.ts").filter(error => error.code === 95002).length, 1, `${name}\n${messages(test.errors("index.ts"))}`);
    test.service.dispose();
  }
  const unrelated = project("livemap-namespace-unrelated", { "index.ts": `${schema}import * as mapApi from "hson-live/echo";\nconst bad = Hson.document\`<aside "hello"/>\`;\nconst map = mapApi.fromLibraries({ home: { document: bad } });\nmap.doc.must("home").schema.use(Page);\n` });
  assert.equal(unrelated.errors("index.ts").filter(error => error.code === 95002).length, 0);
  assert.doesNotMatch(unrelated.service.getProgram()?.getSourceFile(unrelated.file("index.ts"))?.text ?? "", /__hson_assert_library_schema\(map, "home", Page\)/);
  unrelated.service.dispose();
});

check("unbraced attachment proofs stay in their authored control-flow owner", () => {
  const declaration = 'export const Page = Hson.schema`<type "document" tag "main" content "string">`;';
  const prefix = 'import { Hson, hsonLiveMap } from "hson-live";\n';
  const map = 'const map = hsonLiveMap.fromLibraries({ home: { document: `<main "hello"/>` } });\n';
  const use = 'map.doc.must("home").schema.use(Page);';
  const after = 'const exact: typeof Page = map.doc.must("home").schema.get();\n';
  const cases = {
    if: `declare const condition: boolean;\nif (condition)\n  ${use}\n${after}`,
    ifElse: `declare const condition: boolean;\nif (condition)\n  ${use}\nelse\n  void 0;\n${after}`,
    while: `declare const condition: boolean;\nwhile (condition)\n  ${use}\n${after}`,
    for: `for (let index = 0; index < 1; index += 1)\n  ${use}\n${after}`,
    nested: `declare const a: boolean, b: boolean;\nif (a)\n  if (b)\n    ${use}\n  else\n    void 0;\n${after}`,
  };
  for (const [name, control] of Object.entries(cases)) {
    const test = project(`attachment-${name}`, { "index.ts": `${prefix}${declaration}\n${map}${control}` });
    assert.equal(test.service.getSyntacticDiagnostics(test.file("index.ts")).length, 0, name);
    assert.ok(test.errors("index.ts").some(error => error.code === 2322), `${name}\n${messages(test.errors("index.ts"))}`);
    const generated = test.service.getProgram()?.getSourceFile(test.file("index.ts"))?.text ?? "";
    assert.match(generated, /\{map\.doc\.must\("home"\)\.schema\.use\(Page\);\n__hson_assert_library_schema/);
    test.service.dispose();
  }
  const labeled = project("attachment-label", { "index.ts": `${prefix}${declaration}\n${map}label:\n  ${use}\n${after}` });
  assert.equal(labeled.service.getSyntacticDiagnostics(labeled.file("index.ts")).length, 0);
  assert.equal(labeled.errors("index.ts").length, 0, messages(labeled.errors("index.ts")));
  labeled.service.dispose();
});

check("Phase 1 precision fixture passes entirely through the in-memory view", () => {
  const directory = join(temporary, "precision"); cpSync(join(root, "tests/fixtures/hson-schema-compiler-project"), directory, { recursive: true, filter: source => !source.split(/[\\/]/).some(part => part === ".hson" || part === "dist") });
  const files: Record<string, string> = {};
  for (const [name, contents] of bytes(directory)) files[name] = contents.toString();
  const exact = project("precision-live", files, { paths: { "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")], "hson-live/livemap": [join(root, "dist/api/livemap/index.d.ts")], "@support/*": ["./support/*"] }, types: ["node"] });
  const before = bytes(exact.directory);
  for (const name of Object.keys(files).filter(name => /\.[cm]?tsx?$/.test(name))) assert.equal(exact.errors(name).length, 0, `${name}\n${messages(exact.errors(name))}`);
  const evidence = exact.service.getProgram()?.getSourceFiles().filter(file => file.fileName.includes("/editor-evidence/"));
  assert.equal(evidence?.length, 12);
  const slide = evidence?.find(file => file.fileName.endsWith("slideSchema.hson-schema.generated.ts"));
  assert.equal(slide?.text, generate_hson_schema_evidence("slideSchema", '\n<type "document">\n', "schema.ts#slideSchema").declaration);
  assert.deepEqual(bytes(exact.directory), before); exact.service.dispose();
});

check("direct certification and attachment diagnostics share authored compiler locations and runtime authority", () => {
  const schema = '<type "document" tag "html" content <sequence «<tag "head">, <tag "body">»>>';
  const missing = '<html <body/>/>', order = '<html <body/> <head/>/>', valid = '<html <head/> <body/>/>';
  const source = `import { Hson, hsonLiveMap, type HsonDocument } from "hson-live";
export const Schema = Hson.schema\`${schema}\`;
const badMissingHead = Hson.document\`${missing}\`;
const badOrder = Hson.document\`${order}\`;
const valid = Hson.document\`${valid}\`;
const alias = badMissingHead;
Schema.certify(alias);
Schema.certify(badOrder);
Schema.certify(valid);
Schema.certify(Hson.document\`${missing}\`);
declare function getPage(): HsonDocument;
Schema.certify(getPage());
declare const condition: boolean;
Schema.certify(condition ? badMissingHead : valid);
Schema.certify(condition ? badMissingHead : badOrder);
hsonLiveMap.fromLibraries({ page: { document: badMissingHead, schema: Schema } });
hsonLiveMap.fromLibraries({ page: { document: valid, schema: Schema } });
const map = hsonLiveMap.fromLibraries({ page: { document: badOrder } });
map.doc.must("page").schema.use(Schema);
const mutated = hsonLiveMap.fromLibraries({ page: { document: badOrder } });
getPage();
mutated.doc.must("page").schema.use(Schema);
export const Data = Hson.schema\`<type "data" content <name "string">>\`;
hsonLiveMap.fromLibraries({ state: { data: { name: 42 }, schema: Data } });
hsonLiveMap.fromLibraries({ state: { data: { name: "Ada" }, schema: Data } });
const knownData = { name: 42 };
hsonLiveMap.fromLibraries({ state: { data: knownData, schema: Data } });
const escapedData = { name: 42 }; getPage(); void escapedData;
hsonLiveMap.fromLibraries({ state: { data: escapedData, schema: Data } });
`;
  const test = project("candidate-diagnostics", { "index.ts": source });
  const errors = test.errors("index.ts").filter(error => error.code === 95002);
  assert.equal(errors.length, 6, messages(errors));
  assert.ok(errors.some(error => ts.flattenDiagnosticMessageText(error.messageText, "\n").includes("missing required")));
  assert.ok(errors.some(error => ts.flattenDiagnosticMessageText(error.messageText, "\n").includes("wrong tag")));
  for (const error of errors) {
    assert.equal(error.file?.fileName, test.file("index.ts"));
    assert.ok(error.start !== undefined && error.length && error.start + error.length <= source.length);
    assert.ok(!ts.flattenDiagnosticMessageText(error.messageText, "\n").includes(".hson/"));
  }
  assert.ok(errors.some(error => source.slice(error.start, error.start! + error.length!).includes('body')), errors.map(error => source.slice(error.start, error.start! + error.length!)).join("\n"));
  const config = test.file("tsconfig.json");
  writeFileSync(config, JSON.stringify({ compilerOptions: { ...test.options, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext" }, files: [test.file("index.ts")] }));
  const generated = spawnSync(process.execPath, ["--import=tsx", "scripts/hson-schema.mts", "generate", "--project", config], { cwd: root, encoding: "utf8" });
  assert.notEqual(generated.status, 0);
  const manifest = JSON.parse(readFileSync(test.file(".hson/compiler-input/tsconfig.json/manifest.json"), "utf8"));
  const candidateErrors: string[] = manifest.diagnostics.filter((message: string) => message.includes("Static Hson does not satisfy"));
  assert.equal(candidateErrors.length, errors.length);
  for (const error of errors) {
    const location = error.file!.getLineAndCharacterOfPosition(error.start!);
    assert.ok(candidateErrors.includes(`${test.file("index.ts")}:${location.line + 1}:${location.character + 1}: ${error.messageText}`));
  }
  test.edit("index.ts", source.replaceAll(missing, valid).replaceAll(order, valid).replaceAll('name: 42', 'name: "Ada"'));
  assert.equal(test.errors("index.ts").filter(error => error.code === 95002).length, 0);
  const prefix = `import { Hson, hsonLiveMap, ANY_DOCUMENT, type HsonDocument } from "hson-live";\nconst S = Hson.schema\`${schema}\`;\nconst bad = Hson.document\`${missing}\`;\nconst good = Hson.document\`${valid}\`;\ndeclare const condition: boolean;\ndeclare function getPage(): HsonDocument;\n`;
  const cases: readonly [string, number][] = [
    ['hsonLiveMap.fromLibraries({ page: { document: bad, schema: S } });', 1],
    ['hsonLiveMap.fromLibraries({ page: { document: good, schema: S } });', 0],
    ['const map = hsonLiveMap.fromLibraries({ page: { document: bad, schema: ANY_DOCUMENT } }); map.doc.must("page").schema.use(S);', 1],
    ['const map = hsonLiveMap.fromLibraries({ page: { document: good } }); map.doc.must("page").schema.use(S);', 0],
    ['const map = hsonLiveMap.fromLibraries({ page: { document: bad } }); const alias = map; map.doc.must("page").schema.use(S);', 0],
    ['const map = hsonLiveMap.fromLibraries({ page: { document: bad } }); getPage(); map.doc.must("page").schema.use(S);', 0],
    ['const map = hsonLiveMap.fromLibraries({ page: { document: bad } }); declare const name: string; map.doc.must(name).schema.use(S);', 0],
    ['S.certify(condition ? bad : getPage());', 0],
    ['S.certify(await Promise.resolve(bad));', 0],
    ['const D = Hson.schema`<type "data" content <name "string">>`; D.certify(Hson.data`<name 42>`);', 1],
    ['const A = S; hsonLiveMap.fromLibraries({ page: { document: bad, schema: A } });', 1],
    ['const A = S; const map = hsonLiveMap.fromLibraries({ page: { document: bad } }); map.doc.must("page").schema.use(A);', 1],
    ['let A = S; const map = hsonLiveMap.fromLibraries({ page: { document: bad } }); map.doc.must("page").schema.use(A);', 0],
    ['const D = Hson.schema`<type "data" content <name "string">>`; const A = D; const map = hsonLiveMap.fromLibraries({ state: { data: { name: 42 } } }); map.data.must("state").schema.use(A);', 1],
    ['const D = Hson.schema`<type "data" content <name "string">>`; hsonLiveMap.fromLibraries({ data: { data: \'{"name":42}\', schema: D } });', 1],
    ['const D = Hson.schema`<type "data" content <name "string">>`; const data = condition ? { name: 42 } : { name: 7 }; Reflect.set(data, "name", "Ada"); hsonLiveMap.fromLibraries({ state: { data, schema: D } });', 0],
  ];
  for (const [body, expected] of cases) {
    test.edit("index.ts", prefix + body);
    const diagnostics = test.errors("index.ts").filter(error => error.code === 95002);
    assert.equal(diagnostics.length, expected, `${body}\n${messages(diagnostics)}`);
  }
  test.edit("index.ts", prefix.replace(schema, '<type "document" content <') + cases[0][0]);
  assert.equal(test.errors("index.ts").filter(error => error.code === 95002).length, 0);
  test.service.dispose();
  const runtime = Hson.schema`<type "document" tag "html" content <sequence «<tag "head">, <tag "body">»>>`;
  const bad = Hson.document`<html <body/>/>`;
  assert.throws(() => runtime.certify(bad), /Schema validation failed/);
  assert.throws(() => runtime.certify(Hson.document`<html <body/> <head/>/>`), /Schema validation failed/);
  assert.doesNotThrow(() => runtime.certify(Hson.document`<html <head/> <body/>/>`));
  assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: bad, schema: runtime } }), /Schema validation failed/);
  const map = hsonLiveMap.fromLibraries({ page: { document: bad } });
  assert.throws(() => Reflect.apply(map.doc.must("page").schema.use, undefined, [runtime]), /Schema validation failed/);
});

check("document candidates judge realized same-batch Parts and withdraw uncertain composition", () => {
  const prefix = 'import { Hson, hsonLiveMap, type HsonDocument } from "hson-live";\n'
    + 'const Page = Hson.schema`<type "document" tag "main" content <sequence «<tag "h1">»>>`;\n'
    + 'const shell = Hson.document`<main <hson-part lib="bits" at="title"/>/>`;\n';
  const good = 'bits: { parts: { title: { kind: "document", document: Hson.document`<h1 hson:part "Hello"/>` } } }';
  const bad = good.replace('<h1', '<p');
  const source = prefix + [
    `hsonLiveMap.fromLibraries({ page: { document: shell, schema: Page }, ${good} });`,
    `hsonLiveMap.fromLibraries({ ${good}, page: { document: shell, schema: Page } });`,
    `hsonLiveMap.fromLibraries({ page: { document: shell, schema: Page }, ${bad} });`,
    `const map = hsonLiveMap.fromLibraries({ page: { document: Hson.document\`<main <hson-part lib="bits" at="title"/>/>\` }, ${bad} });`,
    'map.doc.must("page").schema.use(Page);',
    // These receiving contexts cannot borrow inventory from another call.
    'const known = hsonLiveMap.fromLibraries({ bits: { parts: { title: { kind: "document", document: "<p hson:part/>" } } } });',
    'known.addLibraries({ page: { document: shell, schema: Page } });',
    'declare const dynamic: typeof known; dynamic.addLibraries({ page: { document: shell, schema: Page } });',
    'hsonLiveMap.fromLibraries({ page: { document: shell, schema: Page } });',
    'Page.certify(shell);',
    'const unproven: HsonDocument<typeof Page> = Hson.document`<main <hson-part lib="bits" at="title"/>/>`;',
    // Independent non-Part failures still get their precise source ranges.
    'Page.certify(Hson.document`<main <aside/>/>`);',
  ].join('\n');
  const test = project("part-candidates", { "index.ts": source });
  const before = bytes(test.directory);
  const errors = test.errors("index.ts");
  const candidates = errors.filter(error => error.code === 95002);
  assert.equal(candidates.length, 3, messages(errors));
  assert.equal(candidates.filter(error => String(error.messageText).includes('received "p"')).length, 2);
  assert.ok(!messages(candidates).includes('received "hson-part"'));
  assert.ok(errors.some(error => error.code === 2322 && error.start === source.indexOf("unproven:")), messages(errors));
  assert.ok(candidates.some(error => source.slice(error.start, error.start! + error.length!) === 'aside'));
  assert.ok(candidates.filter(error => String(error.messageText).includes('received "p"'))
    .every(error => source.slice(error.start, error.start! + error.length!) === 'Hson.document`<main <hson-part lib="bits" at="title"/>/>`'));
  assert.deepEqual(bytes(test.directory), before);

  const config = test.file("tsconfig.json");
  writeFileSync(config, JSON.stringify({ compilerOptions: { ...test.options, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext" }, files: [test.file("index.ts")] }));
  const generated = spawnSync(process.execPath, ["--import=tsx", "scripts/hson-schema.mts", "generate", "--project", config], { cwd: root, encoding: "utf8" });
  assert.notEqual(generated.status, 0);
  const manifest = JSON.parse(readFileSync(test.file(".hson/compiler-input/tsconfig.json/manifest.json"), "utf8"));
  const failures: string[] = manifest.diagnostics.filter((message: string) => message.includes("Static Hson does not satisfy"));
  assert.equal(failures.length, candidates.length, failures.join("\n"));
  for (const error of candidates) {
    const location = error.file!.getLineAndCharacterOfPosition(error.start!);
    assert.ok(failures.includes(`${test.file("index.ts")}:${location.line + 1}:${location.character + 1}: ${error.messageText}`));
  }
  const compilerSource = readFileSync(test.file(".hson/compiler-input/tsconfig.json/sources/index.ts"), "utf8");
  assert.match(compilerSource, /const shell = Hson.document`<main <hson-part/);
  assert.doesNotMatch(compilerSource.slice(compilerSource.indexOf("const unproven:")), /as unknown as HsonDocument/);

  const unknown = [
    'bits: { parts: opaque }',
    'bits: { parts: { ...opaque } }',
    'bits: { parts: { [key]: { kind: "document", document: "<p hson:part/>" } } }',
    'bits: { parts: { title: { kind: "document", document: getDocument() } } }',
    'bits: { parts: { title: { kind: "document", document: "<p hson:part/>" }, broken: { kind: "document", document: "<p" } } }',
    'bits: { parts: aliased }',
  ];
  for (const inventory of unknown) {
    test.edit("index.ts", prefix + 'declare const opaque: Record<string, { kind: "document"; document: string }>; declare const key: string; declare function getDocument(): string;\n'
      + 'const aliased = { title: { kind: "document" as const, document: "<p hson:part/>" } };\n'
      + `hsonLiveMap.fromLibraries({ page: { document: shell, schema: Page }, ${inventory} });`);
    assert.equal(test.errors("index.ts").filter(error => error.code === 95002).length, 0, inventory);
  }
  // Complete reference failures are now editor errors, while composition Schema
  // proof still withdraws rather than judging an unexpanded connector as markup.
  for (const { inventory, message } of [
    { inventory: 'bits: { data: { title: { kind: "document", document: "<p hson:part/>" } } }', message: /Unknown Parts Library "bits"/ },
    { inventory: 'bits: { parts: { other: { kind: "document", document: "<p hson:part/>" } } }', message: /Unknown Part member "title"/ },
  ]) {
    test.edit("index.ts", prefix + `hsonLiveMap.fromLibraries({ page: { document: shell, schema: Page }, ${inventory} });`);
    const errors = test.errors("index.ts").filter(error => error.code === 95002);
    assert.equal(errors.length, 1, messages(errors)); assert.match(messages(errors), message);
    assert.doesNotMatch(messages(errors), /Static Hson does not satisfy/);
  }
  for (const operation of ["addLibraries", "admit"]) {
    test.edit("index.ts", prefix + (operation === "admit" ? 'const receiver = hsonLiveMap.locus.create({});\n' : 'const receiver = hsonLiveMap.fromLibraries({});\n')
      + `receiver.${operation}({ page: { document: shell, schema: Page }, ${bad} });`);
    const errors = test.errors("index.ts").filter(error => error.code === 95002);
    assert.equal(errors.length, 1, `${operation}: ${messages(errors)}`);
  }
  const independent = prefix + 'hsonLiveMap.fromLibraries({ page: { document: Hson.document`<main @:same <hson-part @:same lib="bits" at="title"/>/>`, schema: Page } });\n'
    + 'hsonLiveMap.fromLibraries({ page: { document: Hson.document`<main <hson-part lib="bits" at="title"/>`, schema: Page } });';
  test.edit("index.ts", independent);
  const authoring = produce_document_diagnostics({ fileName: test.file("index.ts"), languageId: "typescript", text: independent });
  assert.ok(authoring.some(issue => issue.code === "HSON_LIBRARY_QUAD_DUPLICATE"), JSON.stringify(authoring));
  assert.ok(authoring.some(issue => issue.code !== "HSON_LIBRARY_QUAD_DUPLICATE"), JSON.stringify(authoring));
  assert.equal(test.errors("index.ts").filter(error => error.code === 95002).length, 0);
  test.service.dispose();
});

check("rejected Part producers retain source errors without receiving Schema conclusions", () => {
  const prefix = 'import { Hson, hsonLiveMap } from "hson-live";\n'
    + 'const Page = Hson.schema`<type "document" tag "h1">`;\n';
  const receiving = (producer: string) => 'hsonLiveMap.fromLibraries({ page: { document: Hson.document`<hson-part lib="bits" at="title"/>`, schema: Page },'
    + ` bits: { parts: { title: { kind: "document", document: ${producer} } } } });\n`;
  const test = project("rejected-part-producers", { "index.ts": prefix });
  const config = test.file("tsconfig.json");
  writeFileSync(config, JSON.stringify({ compilerOptions: { ...test.options, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext" }, files: [test.file("index.ts")] }));
  const rejected = ['Hson.document`// \\8\n<p/>`', 'Hson?.document`<p/>`', 'Hson.document?.`<p/>`'];
  for (const producer of rejected) for (const alias of [false, true]) {
    const source = prefix + (alias ? `const title = (${producer});\n` : '') + receiving(alias ? "title" : producer);
    test.edit("index.ts", source);
    const errors = test.errors("index.ts");
    assert.equal(errors.filter(error => error.code === 95002).length, 0, messages(errors));
    const authoring = produce_document_diagnostics({ fileName: test.file("index.ts"), languageId: "typescript", text: source });
    if (producer.includes("\\8")) {
      const issue = authoring.find(issue => issue.code === "HSON_TAGGED_TEMPLATE_REQUIRED");
      assert.ok(issue, JSON.stringify(authoring));
      assert.ok(issue.range.start >= source.indexOf(producer) && issue.range.end <= source.indexOf(producer) + producer.length);
    } else {
      assert.equal(errors.filter(error => error.code === 1358).length, 1, messages(errors));
    }
    if (alias) {
      writeFileSync(test.file("index.ts"), source);
      const generated = spawnSync(process.execPath, [join(root, "dist/hson-schema.mjs"), "generate", "--project", config], { cwd: root, encoding: "utf8" });
      assert.equal(generated.error, undefined);
      const manifest = JSON.parse(readFileSync(test.file(".hson/compiler-input/tsconfig.json/manifest.json"), "utf8"));
      const diagnostics = manifest.diagnostics.join("\n");
      assert.doesNotMatch(diagnostics, /Static Hson does not satisfy Page/);
      // General escape admission belongs to authoring diagnostics above; the
      // Schema CLI also retains TypeScript's optional-chain grammar diagnostic.
      if (!producer.includes("\\8")) {
        assert.notEqual(generated.status, 0, generated.stdout + generated.stderr);
        assert.match(diagnostics, /optional chain/);
      }
    }
    // Repair only the producer: valid forward composition still proves a real
    // mismatch, and then the expected realized element clears that mismatch.
    const repaired = source.replace(producer, 'Hson.document`<p hson:part/>`');
    test.edit("index.ts", repaired);
    const failures = test.errors("index.ts").filter(error => error.code === 95002);
    assert.equal(failures.length, 1, messages(failures));
    assert.match(messages(failures), /expected "h1"; received "p"/);
    test.edit("index.ts", repaired.replace('<p hson:part/>', '<h1 hson:part/>'));
    assert.deepEqual(test.errors("index.ts"), []);
  }
  test.service.dispose();
});

check("annotation proof, certification, aliases and generated diagnostics converge", () => {
  const source = `import { Hson, hsonLiveMap, type HsonAuthored, type HsonData, type HsonDocument } from "hson-live";
const Text = Hson.schema\`<type "document" content "string">\`;
const authoredText: HsonAuthored = Hson.document\`"hello"\`;
const text: HsonDocument<typeof Text> = Text.certify(authoredText);
Text.certify(text);
const Page = Hson.schema\`<type "document" tag "main" content "string">\`;
const document: HsonDocument<typeof Page> = Page.certify(Hson.document\`<main "hello"/>\`);
Page.certify(document);
const S = Hson.schema\`<type "data" content <name "string">>\`;
const A = S;
const bad: HsonData<typeof A> = Hson.data\`<name 42>\`;
S.certify(bad); A.certify(bad);
const PageAlias = Page;
const invalidMap = hsonLiveMap.fromLibraries({ page: { document: '<aside "hello"/>' } });
invalidMap.doc.must("page").schema.use(PageAlias);
const map = hsonLiveMap.fromLibraries({ page: { document: '<main "hello"/>' } });
map.doc.must("page").schema.use(PageAlias);
const exact: typeof Page = map.doc.must("page").schema.get();
const snap: string = map.doc.must("page").at([0]).snap();
const unrelated: number = "wrong";
`;
  const test = project("candidate-convergence", { "index.ts": source });
  const errors = test.errors("index.ts");
  const schemaErrors = errors.filter(error => error.code === 95002);
  assert.equal(schemaErrors.length, 2, messages(errors));
  assert.equal(schemaErrors.filter(error => String(error.messageText).includes("does not satisfy S")).length, 1);
  assert.equal(errors.filter(error => error.code === 2322).length, 1, messages(errors));
  assert.equal(errors.find(error => error.code === 2322)?.start, source.indexOf("unrelated:"));
  assert.ok(!errors.some(error => (error.start ?? -1) === source.indexOf("text:") || (error.start ?? -1) === source.indexOf("document:")));
  const config = test.file("tsconfig.json");
  writeFileSync(config, JSON.stringify({ compilerOptions: { ...test.options, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext" }, files: [test.file("index.ts")] }));
  const generate = () => spawnSync(process.execPath, [join(root, "dist/hson-schema.mjs"), "generate", "--project", config], { cwd: root, encoding: "utf8" });
  assert.notEqual(generate().status, 0);
  const manifest = JSON.parse(readFileSync(test.file(".hson/compiler-input/tsconfig.json/manifest.json"), "utf8"));
  const candidateErrors: string[] = manifest.diagnostics.filter((message: string) => message.includes("Static Hson does not satisfy"));
  assert.equal(candidateErrors.length, 2, candidateErrors.join("\n"));
  for (const error of schemaErrors) {
    const location = error.file!.getLineAndCharacterOfPosition(error.start!);
    assert.ok(candidateErrors.includes(`${test.file("index.ts")}:${location.line + 1}:${location.character + 1}: ${error.messageText}`));
  }
  const valid = source.replace("<name 42>", '<name "Ada">').replace("<aside", "<main").replace('const unrelated: number = "wrong";', 'const unrelated: number = 42;');
  writeFileSync(test.file("index.ts"), valid); test.edit("index.ts", valid);
  assert.equal(test.errors("index.ts").length, 0, messages(test.errors("index.ts")));
  const regenerated = generate();
  assert.equal(regenerated.status, 0, regenerated.stdout + regenerated.stderr);
  const checked = spawnSync(process.execPath, [join(root, "dist/hson-schema.mjs"), "check", "--project", config], { cwd: root, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  test.edit("index.ts", valid + '\nconst Wrong = Hson.schema`<type "data" content <name "number">>`; Wrong.certify(bad);');
  assert.equal(test.errors("index.ts").filter(error => error.code === 95002).length, 1, "Distinct Schema identity must retain its own failure");
  test.edit("index.ts", valid.replace('Hson.document`"hello"`', 'Hson.data`"hello"`'));
  assert.ok(test.errors("index.ts").some(error => error.code === 2322), "Wrong-family assignment errors remain visible");
  test.service.dispose();
});

check("document issue ranges follow canonical candidate item paths", () => {
  const prefix = 'import { Hson } from "hson-live";\n';
  const cases: readonly [string, string, string][] = [
    ['<type "document" tag "html" content <sequence «<tag "head">, <tag "body">»>>', '<html <head/>/>', '/>'],
    ['<type "document" tag "html" content <sequence «<tag "head">, <tag "body">»>>', '<html <body/> <head/>/>', 'body'],
    ['<type "document" tag "main">', '<aside/>', 'aside'],
    ['<type "document" content <sequence «<tag "head">, <tag "body">»>>', '<head/> <aside/>', 'aside'],
  ];
  for (const [index, [schema, candidate, expected]] of cases.entries()) {
    const source = `${prefix}const S = Hson.schema\`${schema}\`; S.certify(Hson.document\`${candidate}\`);`;
    const test = project(`document-ranges-${index}`, { "index.ts": source });
    const errors = test.errors("index.ts").filter(error => error.code === 95002);
    assert.equal(errors.length, 1, messages(errors));
    assert.equal(source.slice(errors[0]!.start, errors[0]!.start! + errors[0]!.length!), expected);
    test.service.dispose();
  }
});

check("canonical diagnostic details and collision provenance reach authored editor locations", () => {
  const source = '\uFEFF' + [
    'import { Hson, type HsonData } from "hson-live";',
    'const Union = Hson.schema`<type "data" content <value <union [<content <kind <exact "title">>>, <content <kind <exact "code"> language "string" body "string">>, <content <kind <exact "image"> url "string">>]>>>`;',
    'const missing: HsonData<typeof Union> = Hson.data`<value <kind "code">>`;',
    'const Doc = Hson.schema`<type "document" tag "main" attrs <props <lang <exact "en">>> content "empty">`;',
    'Doc.certify(Hson.document`<main\r\n lang="fr"/>`);',
    'const Unique = Hson.schema`<type "data" content <items <array <content <content <kind "string">> unique <by "kind" cases [["a", ["K"]], ["b", ["K"]]]>>>>>`;',
    'const collision = Hson.data`<items [\r\n <kind "a">,\r\n <kind "b">]>`;',
    'Unique.certify(collision);',
  ].join('\r\n');
  const test = project("diagnostic-fidelity", { "index.ts": source });
  const all = test.errors("index.ts");
  assert.equal(all.filter(error => error.code === 2322).length, 0, messages(all));
  const errors = all.filter(error => error.code === 95002);
  assert.equal(errors.length, 3, messages(all));
  const union = errors.find(error => String(error.messageText).includes("satisfy Union"))!;
  assert.match(String(union.messageText), /missing required.*value.language; expected string; received missing/);
  assert.equal(source.slice(union.start, union.start! + union.length!), ">");
  const attr = errors.find(error => String(error.messageText).includes("satisfy Doc"))!;
  assert.match(String(attr.messageText), /at 0 attribute "lang"; expected "en"; received "fr"/);
  assert.equal(source.slice(attr.start, attr.start! + attr.length!), '"fr"');
  const collision = errors.find(error => String(error.messageText).includes("satisfy Unique"))!;
  assert.match(String(collision.messageText), /items.1.kind.*expected unique derived key; received "K"/);
  assert.equal(source.slice(collision.start, collision.start! + collision.length!), '"b"');
  assert.equal(collision.relatedInformation?.length, 1);
  const earlier = collision.relatedInformation![0]!;
  assert.equal(earlier.file?.fileName, test.file("index.ts"));
  assert.equal(earlier.file?.text, source);
  assert.equal(source.slice(earlier.start, earlier.start! + earlier.length!), '"a"');
  assert.match(String(earlier.messageText), /items.0.kind.*"K"/);
  test.service.dispose();
  const values = 'import { Hson } from "hson-live";\r\nexport const collision = Hson.data`<items [\r\n<kind "a">, <kind "b">]>`;\r\n';
  const consumer = 'import { Hson } from "hson-live";\r\nimport { collision } from "./values.js";\r\n'
    + source.slice(source.indexOf('const Unique ='), source.indexOf('const collision =')) + 'Unique.certify(collision);';
  const imported = project("imported-collision", { "index.ts": consumer, "values.ts": values });
  const importedErrors = imported.errors("index.ts").filter(error => error.code === 95002);
  assert.equal(importedErrors.length, 1, messages(imported.errors("index.ts")));
  const importedEarlier = importedErrors[0]!.relatedInformation?.[0];
  assert.equal(importedEarlier?.file?.fileName, imported.file("values.ts"));
  assert.equal(values.slice(importedEarlier?.start, importedEarlier!.start! + importedEarlier!.length!), '"a"');
  imported.service.dispose();
});

check("malformed initializers suppress only redundant proof errors and recover on unsaved edits", () => {
  const initial = '\uFEFF' + [
    'import { Hson, type HsonData, type HsonDocument, type HsonFromSchema, type JsonFromSchema } from "hson-live";',
    'const S = Hson.schema`<type "data" content <name "string">>`;',
    'const D = Hson.schema`<type "document" tag "main" content "empty">`;',
    'type Alias = HsonFromSchema<typeof S>;',
    'const malformed: Alias = Hson.data`\r\n <name "Ada"`;',
    'const doc: HsonDocument<typeof D> = D.certify(Hson.document`\r\n <main`);',
    'const unrelated: number = "wrong";',
    'const field: JsonFromSchema<typeof S> = { name: 37 };',
    'declare const dynamic: HsonData;',
    'const unproven: HsonData<typeof S> = dynamic;',
    'const wrongFamily: HsonData<typeof S> = Hson.document`<main/>`;',
  ].join('\r\n');
  const test = project("malformed-proof", { "index.ts": initial });
  for (const source of [initial, initial.replace('<name "Ada"', '<name +1>'), initial.replace('<name "Ada"', '<name [')]) {
    test.edit("index.ts", source);
    const syntax = produce_document_diagnostics({ fileName: test.file("index.ts"), languageId: "typescript", text: source });
    assert.equal(syntax.length, 2);
    assert.ok(syntax.every(issue => issue.code?.startsWith("HSON_")));
    const dataIssue = syntax.find(issue => issue.range.start < source.indexOf("const doc:"))!;
    const expected = source.includes('<name +1>') ? "+" : "<";
    assert.equal(source.slice(dataIssue.range.start, dataIssue.range.end), expected);
    const errors = test.errors("index.ts");
    assert.equal(errors.length, 4, messages(errors));
    for (const name of ["unrelated:", "name: 37", "unproven:", "wrongFamily:"]) {
      assert.ok(errors.some(error => error.code === 2322 && error.start === source.indexOf(name)), `${name}\n${messages(errors)}`);
    }
    assert.ok(!errors.some(error => error.start === source.indexOf("malformed:") || error.start === source.indexOf("doc:")), messages(errors));
    const underlying = test.underlying.getSemanticDiagnostics(test.file("index.ts"));
    for (const name of ["malformed:", "unproven:"]) {
      assert.ok(underlying.some(error => error.start !== undefined
        && error.file?.text.slice(error.start, error.start + name.length) === name
        && ts.flattenDiagnosticMessageText(error.messageText, "\n").includes("[HSON_SCHEMA_PROOF]")),
        `${name} must retain its underlying TypeScript proof diagnostic: ${messages(underlying)}`);
    }
  }
  const invalid = initial.replace('<name "Ada"', '<name 37>').replace('<main`', '<aside/>`');
  test.edit("index.ts", invalid);
  assert.equal(produce_document_diagnostics({ fileName: test.file("index.ts"), languageId: "typescript", text: invalid }).length, 0);
  const invalidErrors = test.errors("index.ts");
  assert.equal(invalidErrors.filter(error => error.code === 95002).length, 2, messages(invalidErrors));
  assert.equal(invalidErrors.filter(error => error.code === 2322).length, 4, messages(invalidErrors));
  const repaired = initial.replace('<name "Ada"', '<name "Ada">').replace('<main`', '<main/>`');
  test.edit("index.ts", repaired);
  assert.equal(test.errors("index.ts").length, 4, messages(test.errors("index.ts")));
  const interpolated = repaired.replace('<name "Ada">', '<name +1> ${missingValue}');
  test.edit("index.ts", interpolated);
  assert.ok(produce_document_diagnostics({ fileName: test.file("index.ts"), languageId: "typescript", text: interpolated }).some(issue => issue.code === "HSON_NUMBER_LEADING_PLUS"));
  const interpolationErrors = test.errors("index.ts");
  assert.equal(interpolationErrors.filter(error => error.code === 2322).length, 4, messages(interpolationErrors));
  assert.ok(interpolationErrors.some(error => error.code === 2304 && error.start === interpolated.indexOf("missingValue")), messages(interpolationErrors));
  // An opaque interpolation with no authoring failure still needs Schema proof.
  const opaque = repaired.replace('<name "Ada">', '<name ${"Ada"}>');
  test.edit("index.ts", opaque);
  assert.ok(test.errors("index.ts").some(error => error.code === 2322 && error.start === opaque.indexOf("malformed:")), messages(test.errors("index.ts")));
  test.service.dispose();
});

check("proof filtering requires admission evidence owned by the exact assigned template", () => {
  const source = '\uFEFF' + [
    'import { Hson, type HsonData, type JsonFromSchema } from "hson-live";',
    'const S = Hson.schema`<type "data" content <name "string">>`;',
    'declare const dynamic: string;',
    'const unused: HsonData<typeof S> = Hson.data`<name ${(() => {\r\n// @hson-expect-error HSON_NUMBER_LEADING_PLUS\r\nreturn "Ada";\r\n})()}>`;',
    'const nested: HsonData<typeof S> = Hson.data`<name ${Hson.data`+1`}>`;',
    'const own: HsonData<typeof S> = Hson.data`+1 ${missing}`;',
    'const escaped: HsonData<typeof S> = Hson.data`// \\8\r\n<name "Ada">`;',
    'const admitted: HsonData<typeof S> = Hson.data`<name "\\\\n">`;',
    'const outer: HsonData<typeof S> = Hson.data`<name ${dynamic}>`;',
    'const unrelated: number = "wrong";',
    'const field: JsonFromSchema<typeof S> = { name: 37 };',
  ].join('\r\n');
  const test = project("exact-template-proof", { "index.ts": source });
  const assertErrors = (text: string, ownProof: boolean): void => {
    const errors = test.errors("index.ts");
    const starts = errors.filter(error => error.code === 2322).map(error => error.start).sort((a, b) => a! - b!);
    assert.deepEqual(starts, ["unused:", "nested:", ...(ownProof ? ["own:"] : []), "outer:", "unrelated:", "name: 37"].map(name => text.indexOf(name)), messages(errors));
    assert.ok(errors.some(error => error.code === 2304 && error.start === text.indexOf("missing")), messages(errors));
    assert.ok(errors.every(error => error.file?.text === text), "All locations use the current authored snapshot");
  };
  const syntax = produce_document_diagnostics({ fileName: test.file("index.ts"), text: source, languageId: "typescript" });
  assert.equal(syntax.filter(issue => issue.code === "HSON_EXPECT_ERROR_UNUSED").length, 1);
  assert.equal(syntax.filter(issue => issue.code === "HSON_NUMBER_LEADING_PLUS").length, 2);
  assert.equal(syntax.filter(issue => issue.code === "HSON_TAGGED_TEMPLATE_REQUIRED").length, 1);
  for (const issue of syntax.filter(issue => issue.code === "HSON_NUMBER_LEADING_PLUS")) assert.equal(source.slice(issue.range.start, issue.range.end), "+");
  assertErrors(source, false);
  // Removing the owner's syntax error restores its ordinary proof diagnostic;
  // repairing a nested error never changes the outer template's proof status.
  const repaired = source.replace('Hson.data`+1`', 'Hson.data`<name "Ada">`').replace('+1 ${missing}', '<name ${missing}>').replace('\\8', '\\\\8');
  test.edit("index.ts", repaired);
  const repairedSyntax = produce_document_diagnostics({ fileName: test.file("index.ts"), text: repaired, languageId: "typescript" });
  assert.deepEqual(repairedSyntax.map(issue => issue.code), ["HSON_EXPECT_ERROR_UNUSED"]);
  assertErrors(repaired, true);
  test.service.dispose();
});

check("optional-chain tags retain syntax errors and cannot establish candidate or producer proof", () => {
  const schema = '<type "data" content <name "string">>';
  const lines = ['import { Hson, type HsonData } from "hson-live";', `const S = Hson.schema\`${schema}\`;`,
    'const valid: HsonData<typeof S> = Hson.data`<name "Ada">`;'];
  const invalidNames: string[] = [];
  for (const parenthesized of [false, true]) for (const [index, tag] of ["Hson?.data", "Hson.data?.", "Hson?.schema", "Hson.schema?."].entries()) {
    const name = `value${parenthesized ? "Wrapped" : "Direct"}${index}`;
    invalidNames.push(name);
    const producer = index >= 2;
    const template = `${tag}\`${producer ? schema : '<name "Ada">'}\``;
    const initializer = parenthesized ? `(${template})` : template;
    if (producer) lines.push(`const ${name}Schema = ${initializer};`, `const ${name}: HsonData<typeof ${name}Schema> = Hson.data\`<name "Ada">\`;`);
    else lines.push(`const ${name}: HsonData<typeof S> = ${initializer};`);
  }
  lines.push('const unrelated: number = "wrong";');
  const source = '\uFEFF' + lines.join('\r\n');
  const test = project("optional-chain-proof", { "index.ts": source });
  const errors = test.errors("index.ts");
  const grammar = errors.filter(error => error.code === 1358);
  assert.equal(grammar.length, 8, messages(errors));
  for (const error of grammar) {
    assert.equal(error.file?.text, source);
    const body = source.slice(error.start, error.start! + error.length!);
    assert.ok(body === '`<name "Ada">`' || body === `\`${schema}\``, body);
  }
  for (const name of invalidNames.slice(0, 2)) assert.ok(errors.some(error => error.code === 2322 && error.start === source.indexOf(`${name}:`)), `${name}\n${messages(errors)}`);
  for (const name of invalidNames.slice(2, 4)) assert.ok(errors.some(error => error.code === 2344 && error.start === source.indexOf(`typeof ${name}Schema`)), `${name}\n${messages(errors)}`);
  assert.ok(!errors.some(error => error.start === source.indexOf("valid:")), messages(errors));
  const repaired = source.replaceAll("Hson?.", "Hson.").replaceAll("?.`", "`");
  test.edit("index.ts", repaired);
  const repairedErrors = test.errors("index.ts");
  assert.equal(repairedErrors.filter(error => error.code === 1358).length, 0, messages(repairedErrors));
  for (const name of invalidNames.slice(0, 4)) assert.ok(!repairedErrors.some(error => error.start === repaired.indexOf(`${name}:`)), `${name}\n${messages(repairedErrors)}`);
  assert.ok(repairedErrors.some(error => error.code === 2322 && error.start === repaired.indexOf("unrelated:")), messages(repairedErrors));
  test.service.dispose();
});

check("rejected Schema producers withdraw generated evidence, attachment assertions and governed reads", () => {
  const body = '<type "data" content <name "string">>';
  const valid = `import { Hson } from "hson-live";\r\nexport const Bad = Hson.schema\`${body}\`;\r\n`;
  const consumer = 'import { hsonLiveMap } from "hson-live";\r\nimport { Bad } from "./schema.js";\r\nconst map = hsonLiveMap.fromLibraries({ state: { data: { name: "Ada" } } });\r\nmap.data.must("state").schema.use(Bad);\r\nconst name: string = map.data.must("state").at(["name"]).snap();\r\nconst wrong: number = map.data.must("state").at(["name"]).snap();\r\n';
  const test = project("producer-proof-eligibility", { "schema.ts": valid, "index.ts": consumer });
  const evidence = () => test.service.getProgram()!.getSourceFiles().filter(file => file.fileName.endsWith("/Bad.hson-schema.generated.ts"));
  const attachment = () => { const snapshot = test.host.getScriptSnapshot(test.file("index.ts"))!; return snapshot.getText(0, snapshot.getLength()).includes('__hson_assert_library_schema(map, "state", Bad)'); };
  const assertCurrent = (): void => {
    const errors = test.errors("index.ts");
    assert.equal(evidence().length, 1, messages(errors)); assert.ok(attachment());
    assert.equal(errors.length, 1, messages(errors));
    assert.equal(errors[0]?.code, 2322); assert.equal(errors[0]?.start, consumer.indexOf("wrong:"));
    assert.match(messages(errors), /string.*number/);
  };
  assertCurrent();
  for (const initializer of [
    `Hson.schema\`// \\8\r\n${body}\``, `Hson.schema\`// \\unicode\r\n${body}\``,
    `Hson?.schema\`${body}\``, `Hson.schema?.\`${body}\``,
    `(Hson?.schema\`${body}\`)`, `(Hson.schema?.\`${body}\`)`,
  ]) {
    const rejected = `import { Hson } from "hson-live";\r\nexport const Bad = ${initializer};\r\n`;
    test.edit("schema.ts", rejected);
    const errors = test.errors("index.ts");
    assert.equal(evidence().length, 0, initializer); assert.equal(attachment(), false, initializer);
    assert.ok(errors.some(error => error.code === 2322 && error.start === consumer.indexOf("const name:") + 6), `${initializer}\n${messages(errors)}`);
    assert.ok(errors.some(error => error.code === 2322 && error.start === consumer.indexOf("wrong:")), messages(errors));
    if (initializer.includes("?.")) assert.ok(test.errors("schema.ts").some(error => error.code === 1358), initializer);
    else assert.ok(produce_document_diagnostics({ fileName: test.file("schema.ts"), languageId: "typescript", text: rejected }).some(issue => issue.code === "HSON_TAGGED_TEMPLATE_REQUIRED"), initializer);
    test.edit("schema.ts", valid);
    assertCurrent();
  }
  test.service.dispose();
});

check("editor operations never change disk bytes or materialize a generated project", () => {
  assert.deepEqual(bytes(app.directory), originalBytes); assert.equal(existsSync(join(app.directory, ".hson")), false);
});
app.service.dispose();
check("production completion bounds unfinished references to their active templates", () => {
  const prefix = 'import { Hson } from "hson-live"; const S = Hson.schema`<type "data" defs <Title "string" Total "number"> content <ref "';
  const suffix = '`;\nconst after = 123;\n// keep this comment\nconst other = "untouched"; const next = Hson.data`<title "other">`;';
  const source = prefix + 'Ti' + suffix;
  const app = project("completion-ranges", { "app.ts": source });
  const entries = (text: string, offset: number) => {
    app.edit("app.ts", text);
    return app.service.getCompletionsAtPosition(app.file("app.ts"), offset, {})?.entries.filter(entry => entry.replacementSpan?.start === prefix.length) ?? [];
  };
  const suggestions = entries(source, prefix.length + 2);
  assert.deepEqual(suggestions.map(entry => entry.name), ["Title", "Total"]);
  for (const entry of suggestions) {
    assert.deepEqual(entry.replacementSpan, { start: prefix.length, length: 2 });
    const edited = source.slice(0, prefix.length) + entry.insertText + source.slice(prefix.length + 2);
    assert.ok(edited.endsWith(suffix));
  }
  // Empty strings, missing containers, and a closed value with the cursor in
  // its middle keep their exact interior; no closing delimiters are inserted.
  for (const tail of ['', 'Ti', 'Title"', 'Title">>']) {
    const text = prefix + tail + suffix;
    const cursor = prefix.length + Math.min(tail.indexOf('"') < 0 ? tail.length : tail.indexOf('"'), 2);
    const result = entries(text, cursor);
    assert.ok(result.some(entry => entry.name === "Title"), tail);
    const length = tail.indexOf('"') < 0 ? tail.length : tail.indexOf('"');
    assert.deepEqual(result[0]?.replacementSpan, { start: prefix.length, length });
  }
  for (const tail of ['Ti> next', 'Ti\nother', 'Ti\\', 'Ti\\u12', 'Ti\\q']) {
    assert.deepEqual(entries(prefix + tail + suffix, prefix.length + tail.length), [], tail);
  }
  assert.deepEqual(entries(prefix + 'Ti suffix' + suffix, prefix.length + 2), [], "ambiguous unfinished suffix is not replaced");
  assert.deepEqual(entries(prefix + 'Ti', prefix.length + 2), [], "unterminated host template is not recovered");
  app.service.dispose();
});

check("production reference completion uses compiler capabilities, decoded names and diagnostics", () => {
  const source = 'import { Hson } from "hson-live"; const S = Hson.schema`<type "document" defs <Title "string" Card <tag "article" content "empty"> \'display "card"\' <tag "aside" content "empty">> tag "main" content <sequence «<ref "Missing">»>>`;';
  const app = project("completion-reference-facts", { "app.ts": source });
  const cursor = source.indexOf('"Missing"') + 3;
  const result = app.service.getCompletionsAtPosition(app.file("app.ts"), cursor, {})?.entries ?? [];
  assert.deepEqual(result.map(entry => entry.name), ["Card", 'display "card"']);
  assert.deepEqual(result.map(entry => entry.sortText), ["0000", "0001"]);
  const quoted = result.find(entry => entry.name === 'display "card"');
  assert.ok(quoted?.replacementSpan);
  assert.equal(quoted.insertText, 'display \\"card\\"');
  assert.equal(source.slice(quoted.replacementSpan.start, quoted.replacementSpan.start + quoted.replacementSpan.length), "Missing");
  assert.ok(local_hson_schema_diagnostics(app.file("app.ts"), source).some(issue => /reference|definition/i.test(issue.message)));
  const escaped = source.replace('Missing', 'display \\"card\\"');
  app.edit("app.ts", escaped);
  const escapedEntries = app.service.getCompletionsAtPosition(app.file("app.ts"), escaped.indexOf('display \\"card') + 11, {})?.entries ?? [];
  assert.deepEqual(escapedEntries.map(entry => entry.name), ["Card", 'display "card"']);
  assert.equal(local_hson_schema_diagnostics(app.file("app.ts"), escaped).length, 0);
  const dataSlot = source.replace('tag "main" content <sequence «<ref "Missing">»>', 'tag "main" attrs <props <title <ref "Missing">>> content "empty"');
  app.edit("app.ts", dataSlot);
  assert.deepEqual(app.service.getCompletionsAtPosition(app.file("app.ts"), dataSlot.indexOf('"Missing"') + 2, {})?.entries.map(entry => entry.name), ["Title"]);
  for (const sequence of [source, source.replace('sequence «', 'sequence [').replace('»', ']')]) {
    const incomplete = sequence.slice(0, sequence.indexOf('Missing') + 2) + '`; const after = 1;';
    app.edit("app.ts", incomplete);
    assert.deepEqual(app.service.getCompletionsAtPosition(app.file("app.ts"), incomplete.indexOf('"Mi') + 3, {})?.entries.map(entry => entry.name), ["Card", 'display "card"']);
  }
  app.service.dispose();
});

check("production Schema associations share annotations and imported source identity in every TS authoring extension", () => {
  const producer = 'import { Hson, type HsonSchema, type HsonFromSchema, type HsonData } from "hson-live"; export const S: HsonSchema = Hson.schema`<type "data" content <count "number" color "string" presentation <content <theme "string">>>>`; export const Alias = S; export type Imported = HsonFromSchema<typeof Alias>; export type Generic<T> = HsonData<T>;';
  const forms = ["HsonData<typeof S>", "HsonFromSchema<typeof S>", "Chain", "Generic<typeof Alias>", "Imported"];
  const files: Record<string, string> = { "schema.ts": producer,
    "binding.ts": 'import { Hson as H } from "hson-live"; import type { Imported } from "./schema.js"; const S = H.schema`<type "data" content <wrong "number">>`; const value: Imported = H.data`<co`;',
  };
  for (const ext of ["ts", "tsx", "mts", "cts"]) {
    files[`app.${ext}`] = 'import { Hson, type HsonData, type HsonFromSchema } from "hson-live"; import { S, Alias, type Generic, type Imported } from "./schema.js"; type Local<T> = HsonFromSchema<T>; type Chain = (Local<typeof Alias>);\n'
      + forms.map((form, index) => `const value${index}: ${form} = Hson.data\`<co\`;`).join('\n');
  }
  const app = project("completion-associations", files);
  for (const ext of ["ts", "tsx", "mts", "cts"]) {
    const file = `app.${ext}`, text = app.text(file);
    let start = 0;
    for (const form of forms) {
      const offset = text.indexOf('<co`', start) + 3; start = offset;
      const entries = app.service.getCompletionsAtPosition(app.file(file), offset, {})?.entries ?? [];
      assert.deepEqual(entries.map(entry => entry.name), ["count", "color"], `${ext}: ${form}`);
      assert.deepEqual(entries[0]?.replacementSpan, { start: offset - 2, length: 2 });
    }
    const valid = text.replaceAll('<co`', '<count 1 color "blue" presentation <theme "dark">>`');
    app.edit(file, valid);
    assert.equal(app.errors(file).filter(error => error.source === "hson-schema").length, 0);
    app.edit(file, valid.replaceAll('count 1', 'count "wrong"'));
    assert.equal(app.errors(file).filter(error => error.source === "hson-schema").length, forms.length, ext);
  }
  const binding = app.text("binding.ts");
  assert.deepEqual(app.service.getCompletionsAtPosition(app.file("binding.ts"), binding.lastIndexOf('`'), {})?.entries.map(entry => entry.name), ["count", "color"],
    "An imported annotation retains its author's Schema despite a same-named consumer binding");
  app.service.dispose();
});

check("production completion refreshes imported and local Schemas after unsaved edits and correction", () => {
  const producer = 'import { Hson } from "hson-live"; export const S = Hson.schema`<type "data" content <count "number" color "string" presentation <content <theme "string">>>>`;';
  const source = 'import { Hson, type HsonFromSchema } from "hson-live"; import { S } from "./schema.js"; const x: HsonFromSchema<typeof S> = Hson.data`<co`;';
  const app = project("completion-refresh", { "schema.ts": producer, "app.ts": source });
  const complete = (text = source) => app.service.getCompletionsAtPosition(app.file("app.ts"), text.lastIndexOf('`'), {})?.entries.map(entry => entry.name) ?? [];
  assert.deepEqual(complete(), ["count", "color"]);
  for (const invalid of [producer.replace('"number"', '"broken"'), producer.slice(0, producer.indexOf('content <')), producer + producer.replace('import { Hson } from "hson-live";', ''), producer.replace('const S', 'let S')]) {
    app.edit("schema.ts", invalid);
    assert.deepEqual(complete(), []);
    app.edit("schema.ts", producer);
    assert.deepEqual(complete(), ["count", "color"]);
  }
  app.edit("schema.ts", producer.replace('count "number"', 'cost "number"'));
  assert.deepEqual(complete(), ["cost", "color"]);
  const nested = source.replace('<co`', '<presentation <th`');
  app.edit("app.ts", nested); assert.deepEqual(complete(nested), ["theme"]);
  const used = source.replace('<co`', '<cost 1 co`');
  app.edit("app.ts", used); assert.deepEqual(complete(used), ["color"]);
  const local = producer.replace('export ', '') + source.replace('import { S } from "./schema.js";', '');
  app.edit("app.ts", local); assert.deepEqual(complete(local), ["count", "color"]);
  app.edit("app.ts", local.replace('color "string"', 'copper "string"'));
  assert.deepEqual(complete(local.replace('color "string"', 'copper "string"')), ["count", "copper"]);
  app.service.dispose();
});

check("production completion ignores comments, strings, expressions and unreliable associations", () => {
  const prefix = 'import { Hson, type HsonFromSchema, type HsonData, type JsonFromSchema } from "hson-live"; const S = Hson.schema`<type "data" content <color "string">>`; ';
  const sources = [
    '// Hson.data`<co|`', 'const plain = "Hson.data<co|";',
    'const x: HsonFromSchema<typeof S> = Hson.data`<color "co|">`;',
    'const x: HsonFromSchema<typeof S> = Hson.data`< // co|\n>`;',
    'const x: HsonFromSchema<typeof S> = Hson.data`<color ${Mat|}>`;',
    'const x: HsonFromSchema<typeof Missing> = Hson.data`<co|`;',
    'type Fake<T> = string; const x: Fake<typeof S> = Hson.data`<co|`;',
    'const x: JsonFromSchema<typeof S> = Hson.data`<co|`;',
    'type Cycle = Cycle; const x: Cycle = Hson.data`<co|`;',
    'const x = Hson.data`<co|`;',
    'const literal = "<ref \\"co|\\">";',
    'const S2 = Hson.schema`<type "data" defs <Title "string"> // <ref "Ti|\ncontent "string">`;',
    'const S2 = Hson.schema`<type "data" defs <Title "string"> content <exact "<ref \\"Ti|">>`;',
  ];
  const app = project("completion-nonslots", { "app.ts": prefix });
  for (const marked of sources) {
    const offset = prefix.length + marked.indexOf('|');
    app.edit("app.ts", prefix + marked.replace('|', ''));
    const entries = app.service.getCompletionsAtPosition(app.file("app.ts"), offset, {})?.entries ?? [];
    assert.ok(!entries.some(entry => ["color", "Title"].includes(entry.name)), marked);
    if (marked.includes('Mat|')) assert.ok(entries.some(entry => entry.name === "Math"), "ordinary expression completions survive");
  }
  app.edit("app.ts", prefix + 'const ordinary = { name: 1 }; ordinary.na');
  assert.ok(app.service.getCompletionsAtPosition(app.file("app.ts"), (prefix + 'const ordinary = { name: 1 }; ordinary.na').length, {})?.entries.some(entry => entry.name === "name"));
  app.service.dispose();
});

check("reference completion retains forward definitions and their authored ranges", () => {
  const data = '<type "data" defs <First <ref "|"> Title "string"> content <ref "First">>';
  const document = '<type "document" defs <First <tag "main" content <sequence «<ref "|">»>> Title "string" Card <tag "article" content "empty">> content <sequence «<ref "First">»>>';
  const app = project("completion-forward-definitions", { "app.ts": '' });
  const contexts: readonly (readonly [string, readonly [string, string]])[] = [[data, ["First", "Title"]], [document, ["First", "Card"]]];
  for (const [body, expected] of contexts) {
    for (const name of ["", "Missing", expected[1]]) {
      const marked = 'import { Hson } from "hson-live"; const S = Hson.schema`' + body + '`;\nconst after = "untouched";';
      const offset = marked.indexOf('|');
      const source = marked.replace('|', name);
      app.edit("app.ts", source);
      const entries = app.service.getCompletionsAtPosition(app.file("app.ts"), offset + name.length, {})?.entries ?? [];
      assert.deepEqual(entries.map(entry => entry.name), expected);
      for (const entry of entries) assert.deepEqual(entry.replacementSpan, { start: offset, length: name.length });
      const local = local_hson_schema_completion(app.file("app.ts"), source, offset + name.length);
      assert.deepEqual(local.map(entry => entry.name), expected);
      for (const definition of local) assert.equal(source.slice(definition.range.start, definition.range.end), definition.name,
        "Probe coordinates must not shift the authored ranges of later definitions");
      if (name !== expected[1]) assert.ok(local_hson_schema_diagnostics(app.file("app.ts"), source).some(issue => /ref|definition/i.test(issue.message)));
    }
  }
  app.service.dispose();
});

check("reference insertions round trip through TypeScript raw templates and the Hson Schema parser", () => {
  // Authored spellings are independent fixtures, not the completion encoder.
  const names = [
    { name: 'tick`name', authored: "'tick\\u0060name'" },
    { name: '${Math.random()}', authored: "'\\u0024{Math.random()}'" },
    { name: 'say "hi"', authored: "'say \"hi\"'" },
    { name: 'slash\\tail', authored: "'slash\\\\tail'" },
    { name: 'literal\\u0060', authored: "'literal\\\\u0060'" },
    { name: 'unicode Ω😀', authored: "'unicode \\u03a9\\ud83d\\ude00'" },
    { name: 'line\n\t\u0000end', authored: "'line\\n\\t\\u0000end'" },
    { name: '\\`${literal}', authored: "'\\\\\\u0060\\u0024{literal}'" },
  ];
  const body = '<type "data" defs <' + names.map(item => item.authored + ' "string"').join(' ') + '> content <ref "">>';
  const prefix = 'import { Hson } from "hson-live";\nconst S = Hson.schema`';
  const suffix = '`;\nconst after = "untouched"; // preserve this\nconst adjacent = Hson.data`<value "keep">`;';
  const source = prefix + body + suffix;
  const cursor = source.lastIndexOf('<ref "') + 6;
  const app = project("completion-template-encoding", { "app.ts": source });
  const entries = app.service.getCompletionsAtPosition(app.file("app.ts"), cursor, {})?.entries ?? [];
  assert.deepEqual(entries.map(entry => entry.name), names.map(item => item.name));
  for (const entry of entries) {
    assert.deepEqual(entry.replacementSpan, { start: cursor, length: 0 });
    assert.ok(entry.insertText !== undefined);
    const repaired = source.slice(0, cursor) + entry.insertText + source.slice(cursor);
    assert.ok(repaired.startsWith(source.slice(0, cursor)));
    assert.ok(repaired.endsWith(source.slice(cursor)), "Every host byte beyond the reference survives");
    app.edit("app.ts", repaired);
    assert.deepEqual(app.service.getSyntacticDiagnostics(app.file("app.ts")), [], entry.name);
    const discovered = discover_hson_tagged_templates(app.file("app.ts"), repaired);
    assert.equal(discovered.interpolated.length, 0, "Inserted names cannot become TS interpolation expressions");
    assert.equal(discovered.sources.length, 2, "Inserted names cannot terminate the Schema template");
    const site = discovered.sources.find(site => site.authoringKind === "schema");
    assert.ok(site);
    const raw = admit_hson_tagged_source(site);
    const parsed = compile_hson_schema(raw);
    assert.ok(parsed.ok, entry.name);
    const reference = parsed.value.symbols.references[0];
    assert.equal(reference?.name, entry.name, "Hson must decode exactly the original name, including literal escape sequences");
    assert.equal(reference?.targetId, parsed.value.symbols.definitions.find(definition => definition.name === entry.name)?.id);
    assert.deepEqual(parsed.value.symbols.definitions.map(definition => definition.name), names.map(item => item.name));
    assert.equal(local_hson_schema_diagnostics(app.file("app.ts"), repaired).length, 0);
  }
  app.service.dispose();
});

const contextual: { schema: string; cases: { name: string; body: string; expected: string[] }[] } = JSON.parse(readFileSync(join(root, "tests/fixtures/contextual-completion.json"), "utf8"));
check("production contextual completions use collection positions, branch facts and literal domains", () => {
  const producer = 'import { Hson } from "hson-live"; export const S = Hson.schema`' + contextual.schema + '`;';
  const files: Record<string, string> = { "schema.ts": producer };
  const requests: { file: string; offset: number; name: string; expected: string[] }[] = [];
  for (const ext of ["ts", "tsx", "mts", "cts", "local.ts"]) {
    const file = `app.${ext}`;
    let source = 'import { Hson, type HsonFromSchema } from "hson-live";\n'
      + (ext === "local.ts" ? 'const S = Hson.schema`' + contextual.schema + '`;' : 'import { S } from "./schema.js";')
      + '\ntype Alias<T> = HsonFromSchema<T>;\n';
    contextual.cases.forEach(({ name, body, expected }, i) => {
      source += `const value${i}: Alias<typeof S> = Hson.data\``;
      requests.push({ file, offset: source.length + body.indexOf("|"), name, expected });
      source += body.replace("|", "") + '`;\n';
    });
    files[file] = source;
  }
  const app = project("contextual-completion", files);
  for (const { file, offset, name, expected } of requests) {
    const entries = app.service.getCompletionsAtPosition(app.file(file), offset, {})?.entries ?? [];
    assert.deepEqual(entries.map(entry => entry.name), expected, `${file}: ${name}`);
    for (const entry of entries) {
      const span = entry.replacementSpan;
      assert.ok(span && span.start <= offset && span.start + span.length >= offset, name);
      const source = app.text(file);
      const repaired = source.slice(0, span.start) + entry.insertText + source.slice(span.start + span.length);
      assert.ok(repaired.endsWith(source.slice(span.start + span.length)), name);
    }
  }
  const file = "app.ts";
  const marked = 'import { Hson, type HsonData } from "hson-live"; import { S } from "./schema.js"; declare const dynamic: string; const x: HsonData<typeof S> = Hson.data`<blocks [<kind ${dynamic} | >]>`;';
  const source = marked.replace("|", "");
  app.edit(file, source);
  assert.deepEqual(app.service.getCompletionsAtPosition(app.file(file), marked.indexOf("|"), {})?.entries.map(entry => entry.name) ?? [], [], "An opaque authored discriminator cannot select a branch or be duplicated");
  const expression = source.indexOf("dynamic}") + 3;
  const host = app.service.getCompletionsAtPosition(app.file(file), expression, {})?.entries ?? [];
  assert.ok(host.some(entry => entry.name === "dynamic"), "Ordinary TypeScript completion remains available inside interpolation");
  assert.ok(!host.some(entry => ["title", "language", "items", "kind"].includes(entry.name)));
  const prefix = source.slice(0, source.indexOf('Hson.data`') + 10);
  for (const body of ['<tones [${dynamic}, |]>', '<blocks [<kind "${dynamic}" |>]>']) {
    const marked = prefix + body + '`;';
    app.edit(file, marked.replace("|", ""));
    const names = app.service.getCompletionsAtPosition(app.file(file), marked.indexOf("|"), {})?.entries.map(entry => entry.name) ?? [];
    assert.deepEqual(names, body.startsWith('<tones') ? ['"Warm"', '"cool"'] : []);
  }
  app.service.dispose();
});

check("contextual literal edits preserve exact decoded identity and every surrounding source byte", () => {
  const values = ['tick`name', '${Math.random()}', 'quote"\\u0060\\Ω\n', 'e\u0301', '\u00e9', ''];
  const escaped = (value: string) => JSON.stringify(value).replace(/`/g, "\\u0060").replace(/\$\{/g, "\\u0024{");
  const schema = '<type "data" content <value <union [' + values.map(value => '<exact ' + escaped(value) + '>').join(', ') + ']>>>';
  const prefix = '\uFEFFimport { Hson, type HsonData } from "hson-live";\r\nconst S = Hson.schema`' + schema + '`;\r\nconst x: HsonData<typeof S> = Hson.data`<value ';
  const suffix = '`;\r\nconst untouched = "keep"; // keep\r\nconst adjacent = Hson.data`<value "keep">`;';
  const app = project("contextual-literal-insertion", { "app.ts": prefix + '>' + suffix });
  for (const [body, from, to] of [['|>', 0, 0], ['"|old">', 1, 4], ['"|', 1, 1]] as const) {
    const source = prefix + body.replace("|", "") + suffix;
    app.edit("app.ts", source);
    const offset = prefix.length + body.indexOf("|");
    const entries = app.service.getCompletionsAtPosition(app.file("app.ts"), offset, {})?.entries ?? [];
    assert.deepEqual(entries.map(entry => entry.name), values.map(value => JSON.stringify(value)));
    for (const [i, entry] of entries.entries()) {
      assert.deepEqual(entry.replacementSpan, { start: prefix.length + from, length: to - from });
      assert.equal(entry.insertText, body.startsWith('"') ? escaped(values[i]).slice(1, -1) : escaped(values[i]));
      const repaired = source.slice(0, prefix.length + from) + entry.insertText + source.slice(prefix.length + to);
      assert.ok(repaired.endsWith(suffix));
      app.edit("app.ts", repaired);
      assert.deepEqual(app.service.getSyntacticDiagnostics(app.file("app.ts")), []);
      const discovery = discover_hson_tagged_templates(app.file("app.ts"), repaired);
      assert.equal(discovery.interpolated.length, 0);
      assert.equal(discovery.sources.length, 3);
      if (body !== '"|') {
        const site = discovery.sources.find(site => site.authoringKind === "data");
        assert.ok(site);
        const value = admit_hson_tagged_source(site);
        assert.deepEqual(JSON.parse(hson.fromHson(value).toJson().serialize()), { value: values[i] }, "The inserted value has the original decoded identity");
      }
    }
  }
  app.service.dispose();
});

check("contextual completion refreshes branches and literals while reusing program evidence", () => {
  const producer = 'import { Hson } from "hson-live"; export const S = Hson.schema`' + contextual.schema + '`;';
  const source = 'import { Hson, type HsonData } from "hson-live"; import { S } from "./schema.js"; const x: HsonData<typeof S> = Hson.data`<blocks [<kind "code" language >]>`;';
  const app = project("contextual-refresh", { "schema.ts": producer, "app.ts": source });
  const cursor = source.indexOf('language >') + 9;
  const complete = () => app.service.getCompletionsAtPosition(app.file("app.ts"), cursor, {})?.entries.map(entry => entry.name) ?? [];
  const counters: unknown = Reflect.get(ts, "performance");
  assert.ok(counters !== null && typeof counters === "object" && "enable" in counters && typeof counters.enable === "function"
    && "disable" in counters && typeof counters.disable === "function" && "getCount" in counters && typeof counters.getCount === "function");
  counters.enable();
  try {
    assert.deepEqual(complete(), ['"ts"', '"tsx"']);
    const before: unknown = counters.getCount("beforeProgram");
    for (let i = 0; i < 30; i++) assert.deepEqual(complete(), ['"ts"', '"tsx"']);
    assert.equal(counters.getCount("beforeProgram"), before);
    app.edit("schema.ts", producer.replace('<exact "tsx">', '<exact "js">'));
    assert.deepEqual(complete(), ['"ts"', '"js"']);
    const refreshed: unknown = counters.getCount("beforeProgram");
    for (let i = 0; i < 30; i++) assert.deepEqual(complete(), ['"ts"', '"js"']);
    assert.equal(counters.getCount("beforeProgram"), refreshed);
    app.edit("schema.ts", producer.replace('<exact "code">', '<exact "program">'));
    assert.deepEqual(complete(), [], "The old discriminator cannot retain a stale branch");
    app.edit("schema.ts", producer.replace('"data"', '"broken"'));
    assert.deepEqual(complete(), [], "Unresolved Schema values cannot fall back to generic suggestions");
    app.edit("schema.ts", producer);
    assert.deepEqual(complete(), ['"ts"', '"tsx"']);
  } finally { counters.disable(); app.service.dispose(); }
});

check("unchanged production reference requests construct zero independent TypeScript programs", () => {
  const source = 'import { Hson } from "hson-live"; const S = Hson.schema`<type "data" defs <First <ref ""> Title "string"> content <ref "First">>`;';
  const app = project("completion-program-reuse", { "app.ts": source });
  const cursor = source.indexOf('<ref "') + 6;
  const complete = () => app.service.getCompletionsAtPosition(app.file("app.ts"), cursor, {})?.entries.map(entry => entry.name);
  // TypeScript exposes these counters at runtime but omits their declaration.
  const counters: unknown = Reflect.get(ts, "performance");
  assert.ok(counters !== null && typeof counters === "object"
    && "enable" in counters && typeof counters.enable === "function"
    && "disable" in counters && typeof counters.disable === "function"
    && "getCount" in counters && typeof counters.getCount === "function");
  counters.enable();
  try {
    for (let index = 0; index < 5; index++) assert.deepEqual(complete(), ["First", "Title"]);
    const before: unknown = counters.getCount("beforeProgram");
    assert.equal(typeof before, "number");
    for (let index = 0; index < 30; index++) assert.deepEqual(complete(), ["First", "Title"]);
    assert.equal(counters.getCount("beforeProgram"), before, "Thirty unchanged requests must build zero new programs");
    app.edit("app.ts", source.replace('Title "string"', 'Later "string"'));
    assert.deepEqual(complete(), ["First", "Later"], "A new authored program refreshes completion evidence");
    const refreshed: unknown = counters.getCount("beforeProgram");
    for (let index = 0; index < 30; index++) assert.deepEqual(complete(), ["First", "Later"]);
    assert.equal(counters.getCount("beforeProgram"), refreshed, "The edited program is reused too");
  } finally { counters.disable(); app.service.dispose(); }
});

events.terminal("pass"); console.log(JSON.stringify({ schemaEditorView: "passed", checks, typescript: ts.version }));
