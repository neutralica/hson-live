import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { static_part_reference_diagnostics, static_schema_candidate_diagnostics } from "../src/internal/hson-schema/candidate-diagnostics.ts";
import { collect_part_source_facts } from "../src/internal/hson-schema/part-source.ts";
import { create_schema_language_service } from "../editors/vscode-hson/src/schema-language-service.ts";
import { produce_document_diagnostics } from "../editors/vscode-hson/src/document-diagnostics.ts";
import { Hson } from "../src/hson-authoring.ts";
import { hsonLiveMap } from "../src/api/livemap/livemap.facade.ts";
import type { LiveMapPartsLibraryInput } from "../src/types/livemap.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "part-reference-diagnostics", title: "Conservative static Part references", category: "Tooling", runtime: "node", tags: Object.freeze(["parts", "editor", "provenance"]) });
const events = create_test_event_emitter(HSON_LIVE_TEST_METADATA.id);
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, "tmp"), { recursive: true });
const directory = mkdtempSync(join(root, "tmp", "part-reference-diagnostics-"));
process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
writeFileSync(join(directory, "package.json"), '{"type":"module"}');
const files = new Map<string, string>();
let revision = 0;
const file = (name: string) => join(directory, name);
const edit = (name: string, text: string) => { files.set(file(name), text); revision++; };
const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, noEmit: true, types: [], baseUrl: root,
  paths: { "hson-live": ["src/index.ts"], "hson-live/hson": ["src/hson-authoring.ts"], "hson-live/livemap": ["src/api/livemap/index.ts"] } };
const host: ts.LanguageServiceHost = {
  getCompilationSettings: () => options, getScriptFileNames: () => [...files.keys()], getProjectVersion: () => String(revision),
  getScriptVersion: () => String(revision), getScriptSnapshot: path => {
    const text = files.get(path) ?? ts.sys.readFile(path); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  }, getCurrentDirectory: () => directory, getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: path => files.has(path) || ts.sys.fileExists(path), readFile: path => files.get(path) ?? ts.sys.readFile(path),
  directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories, readDirectory: ts.sys.readDirectory,
};
const service = ts.createLanguageService(host);
const imports = 'import { Hson, hson, hsonLiveMap as maps } from "hson-live";\n'
  + 'declare const dynamic: any, condition: boolean, key: string;\n';
const parts = '{ heading: { kind: "document", document: Hson.document`<h1 title="%{Title-Case}" "%{content}"/>` }, plain: { kind: "document", document: "<p/>" } }';
function application(body: string, collection = parts, constructor = 'maps.fromLibraries'): string {
  return imports + 'const page = Hson.document`' + body + '`;\nconst loc = ' + constructor
    + '({ page: { document: page }, components: { parts: ' + collection + ' } });';
}
function inspect(text: string) {
  edit("app.ts", text);
  const program = service.getProgram()!, facts = collect_part_source_facts(ts, program);
  const certainty = facts.documents.map(document => [document.admission, document.parameterCompleteness,
    document.receivers.map(receiver => receiver.certainty)]);
  const diagnostics = static_part_reference_diagnostics(facts);
  assert.deepEqual(facts.documents.map(document => [document.admission, document.parameterCompleteness,
    document.receivers.map(receiver => receiver.certainty)]), certainty, "diagnostics never change source-fact certainty");
  assert.deepEqual(static_part_reference_diagnostics(facts), diagnostics, "repeat queries are stable");
  assert.equal(new Set(diagnostics.map(diagnostic => JSON.stringify(diagnostic))).size, diagnostics.length);
  return { text, program, facts, diagnostics, codes: diagnostics.map(diagnostic => diagnostic.code),
    slices: diagnostics.map(diagnostic => program.getSourceFile(diagnostic.file)!.text.slice(diagnostic.start, diagnostic.end)) };
}
const valid = '<hson-part lib="components" at="heading" content="Hello" Title-Case="Title"/>';
const missingLibrary = '<hson-part lib="absent" at="heading"/>';
const missingMember = '<hson-part lib="components" at="absent"/>';
check("complete initial inventories diagnose only the failing coordinate or argument", () => {
  assert.deepEqual(inspect(application(valid)).codes, []);
  assert.deepEqual(inspect(application('<hson-part lib="components" at="plain"/>')).codes, []);
  const library = inspect(application(missingLibrary));
  assert.deepEqual(library.codes, ["HSON_PART_LIBRARY_UNKNOWN"]); assert.deepEqual(library.slices, ['"absent"']);
  const member = inspect(application(missingMember));
  assert.deepEqual(member.codes, ["HSON_PART_MEMBER_UNKNOWN"]); assert.deepEqual(member.slices, ['"absent"']);
  assert.deepEqual(inspect(application('<hson-part lib="page" at="heading"/>')).codes, ["HSON_PART_LIBRARY_UNKNOWN"]);
  const missing = inspect(application('<hson-part lib="components" at="heading" content="Hello"/>'));
  assert.deepEqual(missing.codes, ["HSON_PART_ARGUMENT_MISSING"]);
  assert.deepEqual(missing.slices, ['<hson-part lib="components" at="heading" content="Hello"']);
  assert.match(missing.diagnostics[0]!.message, /Title-Case/);
  const extra = inspect(application(valid.replace('/>', ' unexpected="x"/>')));
  assert.deepEqual(extra.codes, ["HSON_PART_ARGUMENT_UNKNOWN"]); assert.deepEqual(extra.slices, ['unexpected']);
  const both = inspect(application('<hson-part lib="components" at="heading" extra="x"/>'));
  assert.deepEqual(both.codes, ["HSON_PART_ARGUMENT_MISSING", "HSON_PART_ARGUMENT_MISSING", "HSON_PART_ARGUMENT_UNKNOWN"]);
  assert.deepEqual(both.slices.slice(-1), ['extra']);
});
check("runtime parameter validation remains the authority, including coordinates and placement", () => {
  const components: LiveMapPartsLibraryInput = { parts: { heading: { kind: "document", document: Hson.document`<h1 title="%{Title-Case}" "%{content}"/>` } } };
  assert.doesNotThrow(() => hsonLiveMap.fromLibraries({ components, page: { document: valid } }));
  assert.throws(() => hsonLiveMap.fromLibraries({ components, page: { document: valid.replace(' Title-Case="Title"', '') } }), /Missing Part parameter "Title-Case"/);
  assert.throws(() => hsonLiveMap.fromLibraries({ components, page: { document: valid.replace('/>', ' extra="x"/>') } }), /Unknown Part parameter "extra"/);
  for (const body of ['<h1 onclick="%{bad}"/>', '<style "%{bad}"/>', '<script "%{bad}"/>', '<h1 style="color:%{bad}"/>', '<h1 "%{bad!}"/>']) {
    const result = inspect(application('<hson-part lib="components" at="heading" extra="x"/>', '{ heading: { kind: "document", document: Hson.document`' + body + '` } }'));
    assert.deepEqual(result.codes, [], body);
    assert.equal(result.facts.batches[0]!.libraries[1]!.members[0]!.documents[0]!.parameterCompleteness, "unknown");
  }
  for (const body of ['<hson-part lib="components" at="heading" style="color:red"/>', '<hson-part lib="components" at="heading" bad.name="x"/>']) {
    assert.deepEqual(inspect(application(body)).codes, [], body);
  }
  const reserved = inspect(application('<hson-part lib="components" at="heading"/>', '{ heading: { kind: "document", document: Hson.document`<h1 "%{lib} %{at}"/>` } }'));
  assert.deepEqual(reserved.codes, ['HSON_PART_ARGUMENT_MISSING', 'HSON_PART_ARGUMENT_MISSING']);
  const script = inspect(application('<hson-part lib="components" at="heading"/>', '{ heading: { kind: "document", document: Hson.document`<script src="%{source}"/>` } }'));
  assert.deepEqual(script.codes, ['HSON_PART_ARGUMENT_MISSING']);
});
check("same-batch forward references and all supported official constructor aliases work", () => {
  const aliases = '\nimport { hsonLiveMap as direct } from "hson-live/livemap";\nimport * as namespace from "hson-live/livemap";\n';
  for (const constructor of ['maps.fromLibraries', 'maps.locus.create', 'hson.liveMap.fromLibraries', 'hson.liveMap.locus.create', 'direct.fromLibraries', 'direct.locus.create', 'namespace.fromLibraries', 'namespace.locus.create']) {
    const text = application(missingMember, parts, constructor).replace(imports, imports + aliases);
    assert.deepEqual(inspect(text).codes, ["HSON_PART_MEMBER_UNKNOWN"], constructor);
    const reversed = text.replace('page: { document: page }, components: { parts: ' + parts + ' }', 'components: { parts: ' + parts + ' }, page: { document: page }');
    assert.deepEqual(inspect(reversed).codes, ["HSON_PART_MEMBER_UNKNOWN"], constructor);
  }
  assert.deepEqual(inspect(application(missingMember).replaceAll('Hson.', 'Text.').replace('{ Hson,', '{ Hson as Text,')).codes, ['HSON_PART_MEMBER_UNKNOWN']);
});
check("open-world later admissions and resume cannot establish absence", () => {
  for (const [initial, admission] of [
    ['maps.fromLibraries({})', 'loc.addLibraries'], ['maps.locus.create({})', 'loc.admit'],
  ]) {
    const text = imports + 'const page = Hson.document`' + missingLibrary + '`;\nconst loc = ' + initial + ';\n'
      + admission + '({ page: { document: page }, components: { parts: ' + parts + ' } });';
    assert.deepEqual(inspect(text).codes, [], admission);
  }
  assert.deepEqual(inspect(application(missingLibrary, parts, 'maps.locus.resume').replace(' });', ' }, dynamic);')).codes, []);
  const stored = imports + 'maps.fromLibraries({ components: { parts: { stored: { kind: "document", document: Hson.document`<main ' + missingLibrary + '/>` } } } });';
  assert.deepEqual(inspect(stored).codes, [], 'stored Parts have no initial composition receiver');
  assert.doesNotThrow(() => hsonLiveMap.fromLibraries({ components: { parts: { stored: { kind: 'document', document: '<main ' + missingLibrary + '/>' } } } }));
});
check("partial, mutable, imported and unsupported inventories never prove absence", () => {
  edit('parts.ts', 'import { Hson } from "hson-live/hson"; export const parts = ' + parts + ';');
  const baseline = application(missingLibrary);
  for (const text of [
    baseline.replace('({ page:', '({ ...dynamic, page:'),
    baseline.replace('components: { parts: ' + parts + ' }', '[key]: { parts: ' + parts + ' }'),
    baseline.replace('components: { parts: ' + parts + ' }', 'components: { parts: { ...dynamic } }'),
    baseline.replace('({ page:', '({ ["unknown"]: dynamic, page:'),
    baseline.replace('const loc =', 'const definitions = { page: { document: page } };\nconst loc =').replace('({ page: { document: page }, components: { parts: ' + parts + ' } })', '(definitions)'),
    baseline.replace('const page =', 'let page ='),
    baseline.replace('const loc =', 'import { parts as imported } from "./parts.js";\nconst loc =').replace('parts: ' + parts, 'parts: imported'),
    baseline.replace('const loc =', 'const fake: typeof maps = dynamic;\nconst loc =').replace('maps.fromLibraries', 'fake.fromLibraries'),
  ]) assert.deepEqual(inspect(text).codes, [], text);
  for (const body of [valid, missingMember, '<hson-part lib="components" at="heading" extra="x"/>']) {
    assert.deepEqual(inspect(application(body, parts.replace('plain:', '...dynamic, plain:'))).codes, [], body);
  }
});
check("conditional or ambiguous receivers retain every alternative and withdraw diagnostics", () => {
  for (const choice of ['condition ? page : dynamic', 'condition ? dynamic : page', 'condition ? page : Hson.document`<p/>`', 'condition ? page : page']) {
    const result = inspect(application(missingLibrary).replace('document: page }', 'document: ' + choice + ' }'));
    assert.deepEqual(result.codes, [], choice);
    assert.ok(result.facts.documents.find(document => document.producer.getText().includes('absent'))!.receivers.every(receiver => receiver.certainty === "possible"));
  }
  assert.deepEqual(inspect(application(missingLibrary) + '\nmaps.fromLibraries({ again: { document: page } });').codes, []);
  assert.deepEqual(inspect(application(missingLibrary).replace('page: { document: page }, ', '')).codes, []);
  for (const branch of ['dynamic', 'Hson.canonical`<p/>`']) {
    const collection = parts.replace('Hson.document`<h1 title="%{Title-Case}" "%{content}"/>`', 'condition ? Hson.document`<p/>` : ' + branch);
    assert.deepEqual(inspect(application(missingMember, collection)).codes, [], branch);
  }
});
check("malformed producers and provenance withdraw without suppressing independent syntax errors", () => {
  for (const producer of ['Hson?.document`<p/>`', 'Hson.document?.`<p/>`', 'Hson.canonical`<p/>`', 'Hson.document`<p/><p/>`', 'Hson.document`// \\8\n<p/>`', 'Hson.document`<p`']) {
    const result = inspect(application(missingMember, '{ heading: { kind: "document", document: ' + producer + ' } }'));
    assert.deepEqual(result.codes, [], producer);
  }
  for (const body of ['<hson-part lib="absent" at="heading"', '<hson-part lib="absent" at="hea', missingLibrary + '<bad attr="', missingLibrary + '<p']) {
    const result = inspect(application(body)); assert.deepEqual(result.codes, [], body);
    assert.ok(produce_document_diagnostics({ fileName: file('app.ts'), text: result.text, languageId: 'typescript' }).length > 0, body);
  }
  assert.deepEqual(inspect(application(missingLibrary).replace('"hson-live";', '"hson-live;')).codes, []);
  assert.deepEqual(inspect(application(missingLibrary).replace('components: {', 'broken: , components: {')).codes, []);
  const duplicate = inspect(application('<main @:same <hson-part @:same lib="absent" at="heading"/>/>'));
  assert.deepEqual(duplicate.codes, []);
  const document = duplicate.facts.documents.find(document => document.connectors.length > 0)!;
  assert.equal(document.admission, 'qualified'); assert.equal(document.librarySourceAdmission, 'unknown');
  assert.equal(document.receivers[0]!.certainty, 'certain', 'existing completion evidence is unchanged');
  assert.ok(produce_document_diagnostics({ fileName: file('app.ts'), text: duplicate.text, languageId: 'typescript' })
    .some(diagnostic => diagnostic.code === 'HSON_LIBRARY_QUAD_DUPLICATE'));
});
check("literal coordinates and original ranges respect JS escapes, CRLF and nested templates", () => {
  const escaped = inspect(application(String.raw`<main` + '\r\n ' + String.raw`<hson-part lib="\u0061bsent" at="heading"/>` + '\r\n/>').replaceAll('\n', '\r\n').replaceAll('\r\r\n', '\r\n'));
  assert.deepEqual(escaped.codes, ['HSON_PART_LIBRARY_UNKNOWN']); assert.deepEqual(escaped.slices, ['"\\u0061bsent"']);
  const literal = imports + 'const loc = maps.fromLibraries({ page: { document: ' + String.raw`'<main\r\n <hson-part lib="components" at="\u0061bsent"/>/>'` + ' }, components: { parts: ' + parts + ' } });';
  const js = inspect(literal); assert.deepEqual(js.codes, ['HSON_PART_MEMBER_UNKNOWN']); assert.deepEqual(js.slices, ['"\\u0061bsent"']);
  const quoted = inspect(imports + 'maps.fromLibraries({ page: { document: ' + JSON.stringify(missingMember) + ' }, components: { parts: ' + parts + ' } });');
  assert.deepEqual(quoted.codes, ['HSON_PART_MEMBER_UNKNOWN']); assert.deepEqual(quoted.slices, ['\\"absent\\"']);
  const nested = inspect(imports + 'const outer = Hson.document`<main ${(() => { ' + application(missingMember).slice(imports.length) + 'return page; })()}/>`;');
  assert.deepEqual(nested.codes, ['HSON_PART_MEMBER_UNKNOWN']); assert.deepEqual(nested.slices, ['"absent"']);
  assert.equal(nested.diagnostics[0]!.start, nested.text.indexOf('at="absent"') + 3);
  for (const body of ['<hson-part lib="${key}" at="heading"/>', '<hson-part lib="components" at="${key}"/>', '<hson-part lib="com${key}ponents" at="heading"/>', '<hson-part lib="%{library}" at="heading"/>', '<main ${Hson.document`' + missingLibrary + '`}/>']) {
    assert.deepEqual(inspect(application(body)).codes, [], body);
  }
});
check("Schema and composition diagnostics remain independently provable and unduplicated", () => {
  const schema = 'const S = Hson.schema`<type "document" tag "article">`;\nS.certify(Hson.document`<aside/>`);\n';
  const result = inspect(application(missingLibrary).replace('const page =', schema + 'const page ='));
  assert.deepEqual(result.codes, ['HSON_PART_LIBRARY_UNKNOWN']);
  const independent = static_schema_candidate_diagnostics(ts, result.program);
  assert.equal(independent.length, 1); assert.match(independent[0]!.message, /received "aside"/);
  const composed = application('<main ' + valid + '/>').replace('const page =', 'const S = Hson.schema`<type "document" tag "main" content <sequence «<tag "p">»>>`;\nconst page =').replace('document: page }', 'document: page, schema: S }');
  const composition = inspect(composed); assert.deepEqual(composition.codes, []);
  const errors = static_schema_candidate_diagnostics(ts, composition.program);
  assert.equal(errors.length, 1); assert.match(errors[0]!.message, /received "h1"/); assert.doesNotMatch(errors[0]!.message, /hson-part/);
});
check("existing editor candidate publication refreshes on unsaved upstream edits", () => {
  const editorHost = { ...host };
  const editor = create_schema_language_service(ts, ts.createLanguageService(editorHost), editorHost, file('tsconfig.json'));
  try {
    edit('definition.ts', 'import { Hson } from "hson-live/hson"; export const heading = Hson.document`<h1 "%{content}"/>`;');
    edit('app.ts', imports + 'import { heading } from "./definition.js";\nconst loc = maps.fromLibraries({ page: { document: Hson.document`<hson-part lib="components" at="heading"/>` }, components: { parts: { heading: { kind: "document", document: heading } } } });');
    const published = () => editor.getSemanticDiagnostics(file('app.ts')).filter(diagnostic => diagnostic.code === 95002);
    assert.equal(published().length, 1); assert.match(String(published()[0]!.messageText), /Missing Part parameter "content"/);
    edit('definition.ts', 'import { Hson } from "hson-live/hson"; export const heading = Hson.document`<h1/>`;');
    assert.deepEqual(published(), []);
    edit('definition.ts', 'import { Hson } from "hson-live/hson"; export const heading = Hson.document`<h1 "%{next}"/>`;');
    assert.equal(published().length, 1); assert.match(String(published()[0]!.messageText), /Missing Part parameter "next"/);
  } finally { editor.dispose(); }
});
service.dispose();
events.terminal("pass");
