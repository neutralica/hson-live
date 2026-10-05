import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { create_schema_language_service } from "../editors/vscode-hson/src/schema-language-service.ts";
import { SchemaSourceMapping } from "../src/internal/hson-schema/source-mapping.ts";
import { read_supported_hson_import_symbols } from "../src/internal/embedded-hson/discover-hson-tagged-templates.ts";
import { generate_hson_schema_evidence } from "../src/internal/hson-schema/generated-evidence.ts";
import { local_hson_schema_diagnostics } from "../editors/vscode-hson/src/hson-schema-local.ts";
import { Hson } from "../src/hson-authoring.ts";
import { hsonLiveMap } from "../src/api/livemap/livemap.facade.ts";
import { spawnSync } from "node:child_process";
import { create_test_event_emitter } from "./test-events.mjs";

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
function project(name: string, files: Record<string, string>, extraOptions: ts.CompilerOptions = {}) {
  const directory = join(temporary, name); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  for (const [file, source] of Object.entries(files)) { mkdirSync(dirname(join(directory, file)), { recursive: true }); writeFileSync(join(directory, file), source); }
  const options: ts.CompilerOptions = { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [], baseUrl: directory,
    paths: { "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")], "hson-live/livemap": [join(root, "dist/api/livemap/index.d.ts")] }, ...extraOptions };
  const live = new Map<string, string>(); const versions = new Map<string, number>(); let revision = 0;
  const roots = Object.keys(files).filter(file => /\.[cm]?tsx?$/.test(file)).map(file => join(directory, file));
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options, getScriptFileNames: () => roots, getProjectVersion: () => String(revision),
    getScriptVersion: file => String(versions.get(file) ?? 0),
    getScriptSnapshot: file => { const text = live.get(file) ?? (existsSync(file) ? readFileSync(file, "utf8") : undefined); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
    getCurrentDirectory: () => directory, getDefaultLibFileName: ts.getDefaultLibFilePath, useCaseSensitiveFileNames: () => true,
    fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory, directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
  };
  const underlying = ts.createLanguageService(host);
  const service = create_schema_language_service(ts, underlying, host, join(directory, "tsconfig.json"));
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
const document: ImportedDoc = Hson.document\`<main/>\`;
type HsonLocal = HsonFromSchema<typeof DataSchema>; type HsonChain = HsonLocal;
const hsonDirect: HsonFromSchema<typeof DataSchema> = Hson.data\`<name "Ada">\`;
const hsonAlias: HsonChain = Hson.data\`<name "Ada">\`;
const hsonDocument: HsonFromSchema<typeof DocSchema> = Hson.document\`<main/>\`;
const hsonDocumentAlias: ImportedHsonDoc = Hson.document\`<main/>\`;
const hsonInvalid: HsonChain = Hson.data\`<name 37>\`;
const hsonDocumentInvalid: ImportedHsonDoc = Hson.document\`<aside/>\`;
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
  const exact = 'const exact: typeof Page = map.lib("home").schema.get();\nconst text: string = map.lib("home").at([0]).snap();\n';
  const attached = `${prefix}${declaration}\n${map}map.lib("home").schema.use(Page);\n${exact}`;
  const broad = `${prefix}${declaration}\n${map}${exact}`;
  const test = project("attachment-live", { "index.ts": broad });
  assert.ok(test.errors("index.ts").some(error => error.code === 2322), messages(test.errors("index.ts")));

  test.edit("index.ts", attached);
  assert.equal(test.errors("index.ts").length, 0, messages(test.errors("index.ts")));

  test.edit("index.ts", broad);
  assert.ok(test.errors("index.ts").some(error => error.code === 2322), messages(test.errors("index.ts")));

  const dynamic = `${prefix}${declaration}\n${map}declare const name: string;\nmap.lib(name).schema.use(Page);\n${exact}`;
  test.edit("index.ts", dynamic);
  assert.ok(test.errors("index.ts").some(error => error.code === 2322), messages(test.errors("index.ts")));

  test.edit("index.ts", attached.replace('content "string"', 'content <'));
  assert.ok(test.errors("index.ts").length > 0, "Invalid unsaved Schema text must withdraw attachment evidence.");
  test.service.dispose();
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
    const exact = 'const exact: typeof Page = map.lib("home").schema.get();\n';
    const test = project(`livemap-namespace-${name}`, { "index.ts": prefix + map + exact });
    assert.ok(test.errors("index.ts").some(error => error.code === 2322), name);
    test.edit("index.ts", prefix + map + 'map.lib("home").schema.use(Page);\n' + exact);
    assert.equal(test.errors("index.ts").length, 0, `${name}\n${messages(test.errors("index.ts"))}`);
    assert.match(test.service.getProgram()?.getSourceFile(test.file("index.ts"))?.text ?? "", /__hson_assert_library_schema\(map, "home", Page\)/, name);
    test.edit("index.ts", prefix + `const bad = Hson.document\`<aside "hello"/>\`;\nconst map = ${binding}.fromLibraries({ home: { document: bad } });\nmap.lib("home").schema.use(Page);\n`);
    assert.equal(test.errors("index.ts").filter(error => error.code === 95002).length, 1, `${name}\n${messages(test.errors("index.ts"))}`);
    test.service.dispose();
  }
  const unrelated = project("livemap-namespace-unrelated", { "index.ts": `${schema}import * as mapApi from "hson-live/echo";\nconst bad = Hson.document\`<aside "hello"/>\`;\nconst map = mapApi.fromLibraries({ home: { document: bad } });\nmap.lib("home").schema.use(Page);\n` });
  assert.equal(unrelated.errors("index.ts").filter(error => error.code === 95002).length, 0);
  assert.doesNotMatch(unrelated.service.getProgram()?.getSourceFile(unrelated.file("index.ts"))?.text ?? "", /__hson_assert_library_schema\(map, "home", Page\)/);
  unrelated.service.dispose();
});

check("unbraced attachment proofs stay in their authored control-flow owner", () => {
  const declaration = 'export const Page = Hson.schema`<type "document" tag "main" content "string">`;';
  const prefix = 'import { Hson, hsonLiveMap } from "hson-live";\n';
  const map = 'const map = hsonLiveMap.fromLibraries({ home: { document: `<main "hello"/>` } });\n';
  const use = 'map.lib("home").schema.use(Page);';
  const after = 'const exact: typeof Page = map.lib("home").schema.get();\n';
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
    assert.match(generated, /\{map\.lib\("home"\)\.schema\.use\(Page\);\n__hson_assert_library_schema/);
    test.service.dispose();
  }
  const labeled = project("attachment-label", { "index.ts": `${prefix}${declaration}\n${map}label:\n  ${use}\n${after}` });
  assert.equal(labeled.service.getSyntacticDiagnostics(labeled.file("index.ts")).length, 0);
  assert.equal(labeled.errors("index.ts").length, 0, messages(labeled.errors("index.ts")));
  labeled.service.dispose();
});

check("Phase 1 precision fixture passes entirely through the in-memory view", () => {
  const directory = join(temporary, "precision"); cpSync(join(root, "tests/fixtures/hson-schema-compiler-project"), directory, { recursive: true });
  const files: Record<string, string> = {};
  for (const [name, contents] of bytes(directory)) files[name] = contents.toString();
  const exact = project("precision-live", files, { paths: { "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")], "@support/*": ["./support/*"] }, types: ["node"] });
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
map.lib("page").schema.use(Schema);
const mutated = hsonLiveMap.fromLibraries({ page: { document: badOrder } });
getPage();
mutated.lib("page").schema.use(Schema);
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
    ['const map = hsonLiveMap.fromLibraries({ page: { document: bad, schema: ANY_DOCUMENT } }); map.lib("page").schema.use(S);', 1],
    ['const map = hsonLiveMap.fromLibraries({ page: { document: good } }); map.lib("page").schema.use(S);', 0],
    ['const map = hsonLiveMap.fromLibraries({ page: { document: bad } }); const alias = map; map.lib("page").schema.use(S);', 0],
    ['const map = hsonLiveMap.fromLibraries({ page: { document: bad } }); getPage(); map.lib("page").schema.use(S);', 0],
    ['const map = hsonLiveMap.fromLibraries({ page: { document: bad } }); declare const name: string; map.lib(name).schema.use(S);', 0],
    ['S.certify(condition ? bad : getPage());', 0],
    ['S.certify(await Promise.resolve(bad));', 0],
    ['const D = Hson.schema`<type "data" content <name "string">>`; D.certify(Hson.data`<name 42>`);', 1],
    ['const A = S; hsonLiveMap.fromLibraries({ page: { document: bad, schema: A } });', 1],
    ['const A = S; const map = hsonLiveMap.fromLibraries({ page: { document: bad } }); map.lib("page").schema.use(A);', 1],
    ['let A = S; const map = hsonLiveMap.fromLibraries({ page: { document: bad } }); map.lib("page").schema.use(A);', 0],
    ['const D = Hson.schema`<type "data" content <name "string">>`; const A = D; const map = hsonLiveMap.fromLibraries({ state: { data: { name: 42 } } }); map.lib("state").schema.use(A);', 1],
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
  assert.throws(() => Reflect.apply(map.lib("page").schema.use, undefined, [runtime]), /Schema validation failed/);
});

check("annotation proof, certification, aliases and generated diagnostics converge", () => {
  const source = `import { Hson, hsonLiveMap, type HsonData, type HsonDocument } from "hson-live";
const Text = Hson.schema\`<type "document" content "string">\`;
const text: HsonDocument<typeof Text> = Hson.document\`"hello"\`;
Text.certify(text);
const Page = Hson.schema\`<type "document" tag "main" content "string">\`;
const document: HsonDocument<typeof Page> = Hson.document\`<main "hello"/>\`;
Page.certify(document);
const S = Hson.schema\`<type "data" content <name "string">>\`;
const A = S;
const bad: HsonData<typeof A> = Hson.data\`<name 42>\`;
S.certify(bad); A.certify(bad);
const PageAlias = Page;
const invalidMap = hsonLiveMap.fromLibraries({ page: { document: '<aside "hello"/>' } });
invalidMap.lib("page").schema.use(PageAlias);
const map = hsonLiveMap.fromLibraries({ page: { document: '<main "hello"/>' } });
map.lib("page").schema.use(PageAlias);
const exact: typeof Page = map.lib("page").schema.get();
const snap: string = map.lib("page").at([0]).snap();
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

check("editor operations never change disk bytes or materialize a generated project", () => {
  assert.deepEqual(bytes(app.directory), originalBytes); assert.equal(existsSync(join(app.directory, ".hson")), false);
});
app.service.dispose();
events.terminal("pass"); console.log(JSON.stringify({ schemaEditorView: "passed", checks, typescript: ts.version }));
