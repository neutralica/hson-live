import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { library_source_field_candidates, library_source_fields } from "../src/internal/hson-schema/library-source.ts";
import { static_source_candidates } from "../src/internal/hson-schema/source-candidates.ts";
import { collect_part_source_facts } from "../src/internal/hson-schema/part-source.ts";
import { static_part_reference_diagnostics, static_schema_candidate_diagnostics } from "../src/internal/hson-schema/candidate-diagnostics.ts";
import { create_schema_language_service } from "../editors/vscode-hson/src/schema-language-service.ts";
import { HsonEditorCompletionCache } from "../editors/vscode-hson/src/editor-completion.ts";
import { hsonLiveMap } from "../src/api/livemap/livemap.facade.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "object-literal-source-evidence", title: "Own-property source evidence", category: "Tooling", runtime: "node", tags: Object.freeze(["parts", "schema", "editor", "provenance"]) });
const events = create_test_event_emitter(HSON_LIVE_TEST_METADATA.id);
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, "tmp"), { recursive: true });
const directory = mkdtempSync(join(root, "tmp", "own-property-evidence-"));
process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
writeFileSync(join(directory, "package.json"), '{"type":"module"}');
const file = join(directory, "app.ts");
let text = "", revision = 0;
const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, noEmit: true, types: [], baseUrl: root,
  paths: { "hson-live": ["src/index.ts"] } };
const host: ts.LanguageServiceHost = {
  getCompilationSettings: () => options, getScriptFileNames: () => [file], getProjectVersion: () => String(revision),
  getScriptVersion: () => String(revision), getScriptSnapshot: path => {
    const source = path === file ? text : ts.sys.readFile(path); return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
  }, getCurrentDirectory: () => directory, getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: path => path === file || ts.sys.fileExists(path), readFile: path => path === file ? text : ts.sys.readFile(path),
  directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories, readDirectory: ts.sys.readDirectory,
};
const service = ts.createLanguageService(host), editorHost = { ...host };
const editor = create_schema_language_service(ts, ts.createLanguageService(editorHost), editorHost, join(directory, "tsconfig.json"));
const completion = new HsonEditorCompletionCache();
const imports = 'import { Hson, hsonLiveMap as maps } from "hson-live";\n';
const parts = '{ heading: { kind: "document", document: Hson.document`<h1 "%{content}"/>` } }';
function inspect(source: string) {
  text = source; revision++;
  const program = service.getProgram()!, facts = collect_part_source_facts(ts, program);
  const published = editor.getSemanticDiagnostics(file).filter(diagnostic => diagnostic.code === 95002);
  return { program, facts, published, references: static_part_reference_diagnostics(facts),
    schemas: static_schema_candidate_diagnostics(ts, program) };
}
function object(source: string): ts.ObjectLiteralExpression {
  const parsed = ts.createSourceFile("object.ts", 'const value = (' + source + ');', ts.ScriptTarget.ESNext, true);
  const statement = parsed.statements[0]; assert.ok(statement && ts.isVariableStatement(statement));
  const initial = statement.declarationList.declarations[0]!.initializer; assert.ok(initial && ts.isParenthesizedExpression(initial));
  assert.ok(ts.isObjectLiteralExpression(initial.expression)); return initial.expression;
}
check("AST own fields match JavaScript for prototype setters, computed literals and shorthand", () => {
  const value = { document: "<p/>" };
  for (const body of ['__proto__: value', '"__proto__": value', '["__proto__"]: value', '[`__proto__`]: value', '__proto__', 'ordinary: value, __proto__: value, tail: value', 'constructor: value, toString: value']) {
    // Controlled JavaScript fixtures independently establish the own-property oracle.
    const actual = Function("value", "__proto__", 'return ({' + body + '});')(value, value);
    const fields = library_source_fields(object('{' + body + '}'));
    assert.ok(fields, body); assert.deepEqual([...fields.keys()], Object.keys(actual), body);
    assert.equal(library_source_field_candidates(object('{' + body + '}')).complete, true, body);
    const found = inspect(imports + 'const value = { document: "<p/>" }; const __proto__ = value; maps.fromLibraries({' + body + '});');
    assert.deepEqual(found.facts.batches[0]!.libraries.map(library => library.name), Object.keys(actual), body);
    const map = hsonLiveMap.fromLibraries(actual);
    assert.equal(map.doc("__proto__") !== undefined, Object.hasOwn(actual, "__proto__"), body);
  }
  for (const body of ['ordinary: value, [key]: value', 'plain: value, ["plain"]: value', 'get __proto__() { return value; }', '__proto__() { return value; }']) {
    const fields = library_source_field_candidates(object('{' + body + '}'));
    assert.equal(fields.complete, false, body);
    assert.equal(library_source_fields(object('{' + body + '}')), undefined, body);
  }
});
check("prototype initializers cannot publish phantom Library, member or argument errors", () => {
  const bodies = ['<hson-part lib="absent" at="heading"/>', '<hson-part lib="components" at="absent"/>',
    '<hson-part lib="components" at="heading"/>', '<hson-part lib="components" at="heading" content="ok" extra="x"/>'];
  for (const spelling of ['__proto__', '"__proto__"']) for (const body of bodies) {
    const result = inspect(imports + 'maps.fromLibraries({ ' + spelling + ': { document: Hson.document`' + body
      + '` }, components: { parts: ' + parts + ' } });');
    const source = result.program.getSourceFile(file)!;
    assert.deepEqual(result.program.getSyntacticDiagnostics(source), []);
    assert.deepEqual(result.program.getSemanticDiagnostics(source), []);
    assert.deepEqual(result.facts.batches[0]!.libraries.map(library => library.name), ['components']);
    assert.equal(result.facts.batches[0]!.inventoryCompleteness, 'complete');
    assert.ok(result.facts.documents.filter(document => document.connectors.length > 0)
      .every(document => document.receivers.every(receiver => receiver.certainty === 'possible' && receiver.library === undefined)));
    assert.deepEqual(result.references, [], body); assert.deepEqual(result.published, [], body);
  }
});
check("known own entries and forward Parts retain certainty beside either prototype setter", () => {
  for (const spelling of ['__proto__', '"__proto__"']) for (const constructor of ['maps.fromLibraries', 'maps.locus.create']) {
    const result = inspect(imports + 'const map = ' + constructor + '({ page: { document: Hson.document`<hson-part lib="components" at="heading"/>` }, '
      + spelling + ': { ignored: true }, components: { parts: ' + parts + ' } });');
    const batch = result.facts.batches[0]!;
    assert.equal(batch.inventoryCompleteness, 'complete');
    assert.ok(batch.libraries.every(library => library.certainty === 'certain'));
    assert.deepEqual(batch.libraries.map(library => library.name), ['page', 'components']);
    assert.deepEqual(result.references.map(diagnostic => diagnostic.code), ['HSON_PART_ARGUMENT_MISSING']);
    assert.equal(result.published.length, 1); assert.match(String(result.published[0]!.messageText), /Missing Part parameter "content"/);
  }
  const computed = inspect(imports + 'maps.fromLibraries({ ["__proto__"]: { document: Hson.document`<hson-part lib="absent" at="heading"/>` } });');
  assert.equal(computed.facts.batches[0]!.libraries[0]!.certainty, 'certain');
  assert.deepEqual(computed.references.map(diagnostic => diagnostic.code), ['HSON_PART_LIBRARY_UNKNOWN']);
  assert.equal(computed.published.length, 1);
  const shorthand = inspect(imports + 'const __proto__ = { document: Hson.document`<hson-part lib="absent" at="heading"/>` }; maps.fromLibraries({ __proto__ });');
  assert.equal(shorthand.facts.batches[0]!.libraries[0]!.name, '__proto__');
  assert.equal(shorthand.facts.batches[0]!.libraries[0]!.certainty, 'possible', 'existing alias freshness rule remains authoritative');
  assert.ok(shorthand.facts.documents[0]!.receivers.some(receiver => receiver.library?.name === '__proto__'));
  assert.deepEqual(shorthand.published, []);
});
check("computed Part keys keep complete inventories and contextual completion", () => {
  const result = inspect(imports + 'maps.fromLibraries({ page: { document: Hson.document`<hson-part lib="components" at="__proto__"/>` }, '
    + 'components: { parts: { ["__proto__"]: { kind: "document", document: Hson.document`<h1 "%{content}"/>` } } } });');
  assert.equal(result.facts.batches[0]!.libraries[1]!.memberCompleteness, 'complete');
  assert.deepEqual(result.references.map(diagnostic => diagnostic.code), ['HSON_PART_ARGUMENT_MISSING']);
  assert.equal(result.published.length, 1);
  const source = imports + 'maps.fromLibraries({ __proto__: { ignored: true }, page: { document: Hson.document`<hson-part lib="components" at="he"/>` }, components: { parts: ' + parts + ' } });';
  const context = inspect(source), offset = source.indexOf('at="he"') + 6;
  const entries = completion.complete(file, source, revision, offset, context.program);
  assert.deepEqual(entries.map(entry => [entry.candidate.label, entry.candidate.certainty]), [['heading', 'certain']]);
});
check("dynamic computed keys and later admissions keep their original uncertainty", () => {
  const page = 'page: { document: Hson.document`<hson-part lib="absent" at="heading"/>` }';
  const dynamic = inspect(imports + 'declare const key: string; maps.fromLibraries({ __proto__: {}, ' + page + ', [key]: { document: "<p/>" } });');
  assert.equal(dynamic.facts.batches[0]!.inventoryCompleteness, 'partial');
  assert.ok(dynamic.facts.batches[0]!.libraries.some(library => library.name === undefined));
  assert.deepEqual(dynamic.references, []); assert.deepEqual(dynamic.published, []);
  for (const [constructor, operation] of [['maps.fromLibraries', 'addLibraries'], ['maps.locus.create', 'admit']]) {
    const result = inspect(imports + 'const map = ' + constructor + '({}); map.' + operation + '({ __proto__: {}, ' + page + ' });');
    assert.equal(result.facts.batches[1]!.receivingInventory, 'open');
    assert.deepEqual(result.references, []); assert.deepEqual(result.published, []);
  }
});
check("Schema candidates ignore phantom Libraries but retain real own-property failures", () => {
  const prefix = imports + 'const S = Hson.schema`<type "document" tag "article">`;\n';
  for (const spelling of ['__proto__', '"__proto__"']) {
    const phantom = spelling + ': { document: Hson.document`<aside/>`, schema: S }';
    const result = inspect(prefix + 'maps.fromLibraries({ ' + phantom + ', page: { document: Hson.document`<article/>`, schema: S } });');
    assert.deepEqual(result.schemas, []); assert.deepEqual(result.published, []);
    const own = inspect(prefix + 'maps.fromLibraries({ ' + phantom + ', ["page"]: { document: Hson.document`<aside/>`, schema: S } });');
    assert.equal(own.schemas.length, 1); assert.equal(own.published.length, 1);
    assert.match(String(own.published[0]!.messageText), /received "aside"/);
  }
});
check("JSON evidence preserves own __proto__ keys without admitting custom prototypes", () => {
  const program = service.getProgram()!, candidates = static_source_candidates(ts, program.getTypeChecker());
  for (const body of ['["__proto__"]: "own", ordinary: 1', '__proto__: null, ordinary: 1', '__proto__: 7, ordinary: 1']) {
    const actual = Function('return ({' + body + '});')();
    const result = candidates.jsonLiteral(object('{' + body + '}'));
    assert.equal(result.known, true, body);
    if (result.known) { assert.deepEqual(Object.keys(result.value!), Object.keys(actual)); assert.equal(Object.getPrototypeOf(result.value), null); }
  }
  for (const body of ['__proto__: {}, ordinary: 1', '"__proto__": { inherited: true }, ordinary: 1', '__proto__: dynamic, ordinary: 1']) {
    assert.deepEqual(candidates.jsonLiteral(object('{' + body + '}')), { known: false }, body);
  }
});
completion.clear(); editor.dispose(); service.dispose();
events.terminal("pass");
