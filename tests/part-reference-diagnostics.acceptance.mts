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
const parts = '{ heading: { kind: "document", document: Hson.document`<h1 hson:part title="%{Title-Case}" "%{content}"/>` }, plain: { kind: "document", document: "<p hson:part/>" } }';
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
check("qualified selector diagnostics share runtime coordinates and original value locations", () => {
  assert.deepEqual(inspect(application(valid.replace('lib="components" at="heading"', 'at="components/heading"'))).codes, []);
  for (const selector of ['/heading', 'components/', 'components//heading', 'components/heading/extra', '/', '//']) {
    const result = inspect(application(`<hson-part at="${selector}"/>`));
    assert.deepEqual(result.codes, ['HSON_PART_COORDINATES_INVALID']);
    assert.deepEqual(result.slices, [JSON.stringify(selector)]);
  }
  for (const body of ['<hson-part/>', '<hson-part at="heading"/>', '<hson-part lib="components"/>', '<hson-part lib="components" at="components/heading"/>']) {
    assert.deepEqual(inspect(application(body)).codes, ['HSON_PART_COORDINATES_INVALID']);
  }
  const missing = inspect(application('<hson-part at="components/absent"/>'));
  assert.deepEqual(missing.codes, ['HSON_PART_MEMBER_UNKNOWN']);
  assert.deepEqual(missing.slices, ['"components/absent"']);
  const escaped = inspect(application(String.raw`<hson-part at="components\u002fabsent"/>`));
  assert.deepEqual(escaped.codes, ['HSON_PART_MEMBER_UNKNOWN']);
  assert.deepEqual(escaped.slices, [String.raw`"components\u002fabsent"`]);
  assert.deepEqual(inspect(application('<hson-part at="absent/heading"/>')).codes, ['HSON_PART_LIBRARY_UNKNOWN']);
  assert.match(inspect(application('<hson-part at="components/heading"/>')).diagnostics[0]!.message, /components\/heading/);
  assert.deepEqual(inspect(application('<hson-part at="components/${dynamic}"/>')).codes, []);
});

check("missing Library diagnostics distinguish Part, ordinary Document and unknown receiving contexts", () => {
  const source = '<main hson:part <hson-part at="plain"/>/>';
  const detached = imports + 'export const definition=Hson.document`' + source + '`;';
  const unknown = inspect(detached);
  assert.deepEqual(unknown.codes, []);
  assert.deepEqual(unknown.facts.documents[0]!.receivers, [], 'an unregistered source has no proven receiving context');
  const registered = inspect(detached + 'const loc=maps.fromLibraries({components:{parts:{'
    + 'host:{kind:"document",document:definition},plain:{kind:"document",document:Hson.document`<p hson:part/>`}}}});');
  assert.deepEqual(registered.codes, []);
  assert.equal(registered.facts.documents[0]!.receivers[0]!.library?.family, 'parts');
  const ordinary = inspect(application('<main <hson-part at="plain"/>/>'));
  assert.deepEqual(ordinary.codes, ['HSON_PART_COORDINATES_INVALID']);
  assert.ok(ordinary.facts.documents[0]!.receivers.some(receiver => receiver.library?.family === 'document' && receiver.certainty === 'certain'));
  const dynamic = inspect(application('<main title="${dynamic}" <hson-part at="plain"/>/>'));
  assert.deepEqual(dynamic.codes, ['HSON_PART_COORDINATES_INVALID']);
  assert.ok(dynamic.facts.documents[0]!.receivers.some(receiver => receiver.placementCertain && receiver.certainty === 'possible'),
    'opaque values do not withdraw proven ordinary Document placement');
  const conditional = inspect(application('<main <hson-part at="plain"/>/>').replace('document: page }', 'document: condition ? page : dynamic }'));
  assert.deepEqual(conditional.codes, []);
  assert.ok(conditional.facts.documents[0]!.receivers.every(receiver => receiver.certainty === 'possible' && !receiver.placementCertain),
    'conditional placement cannot prove the enclosing Library is absent');
  assert.deepEqual(inspect(imports + 'export const definition=Hson.document`<hson-part at="components/plain"/>`;').codes, []);
  assert.doesNotThrow(() => hsonLiveMap.fromLibraries({ components: { parts: {
    host: { kind: 'document', document: source }, plain: { kind: 'document', document: '<p hson:part/>' },
  } }, page: { document: '<hson-part at="components/host"/>' } }));
  assert.throws(() => hsonLiveMap.fromLibraries({ components: { parts: { plain: { kind: 'document', document: '<p hson:part/>' } } },
    page: { document: '<hson-part at="plain"/>' } }), /Unqualified hson-part at requires/);
});

check("unknown registration withholds context errors but retains independent coordinate errors", () => {
  for (const attributes of [
    'at="/plain"', 'at="components/"', 'at="components//plain"', 'at="components/plain/extra"',
    'lib="components" at="components/plain"', 'lib="other" at="components/plain"',
    'lib="" at="plain"', 'lib="bad/name" at="plain"',
  ]) {
    const result = inspect(imports + 'export const definition=Hson.document`<main hson:part <hson-part ' + attributes + '/>/>`;');
    assert.deepEqual(result.codes, ['HSON_PART_COORDINATES_INVALID'], attributes);
    assert.deepEqual(result.facts.documents[0]!.receivers, [], attributes);
  }
  for (const body of ['<main hson:part <hson-part at="plain"', '<main hson:part <hson-part at="components/']) {
    const result = inspect(imports + 'export const definition=Hson.document`' + body + '`;');
    assert.deepEqual(result.codes, [], body);
    assert.equal(result.facts.documents[0]!.admission, 'unknown', 'incomplete source is not promoted to validity');
    assert.deepEqual(result.facts.documents[0]!.receivers, []);
  }
});

check("imported and aliased Part sources retain unknown context until a supported receiver is proven", () => {
  edit('inherited-definition.ts', 'import { Hson as Text } from "hson-live/hson";'
    + 'export const definition=Text.document`<main hson:part <hson-part at="plain"/>/>`;');
  const imported = imports + 'import { definition as shared } from "./inherited-definition.js"; const alias=shared;';
  const unknown = inspect(imported);
  assert.deepEqual(unknown.codes, []);
  assert.deepEqual(unknown.facts.documents.find(document => document.location.file === file('inherited-definition.ts'))!.receivers, []);
  const registration = 'maps.fromLibraries({components:{parts:{host:{kind:"document",document:alias},'
    + 'plain:{kind:"document",document:Hson.document`<p hson:part/>`}}}});';
  const known = inspect(imported + registration);
  assert.deepEqual(known.codes, []);
  assert.equal(known.facts.documents.find(document => document.location.file === file('inherited-definition.ts'))!.receivers[0]!.library?.family, 'parts');
  const recovered = inspect(imported + registration.replace('components:', 'broken: , components:'));
  assert.deepEqual(recovered.codes, []);
  assert.ok(recovered.program.getSyntacticDiagnostics().length > 0);
  assert.ok(recovered.facts.documents.find(document => document.location.file === file('inherited-definition.ts'))!.receivers.every(receiver => receiver.certainty === 'possible'));
  edit('inherited-definition.ts', 'import { Hson as Text } from "hson-live/hson";'
    + 'export const definition=Text.document`<main <hson-part at="plain"/>/>`;');
  const ordinary = inspect(imported + 'maps.fromLibraries({page:{document:alias}});');
  assert.deepEqual(ordinary.codes, ['HSON_PART_COORDINATES_INVALID']);
  assert.equal(ordinary.diagnostics[0]!.file, file('inherited-definition.ts'));
  edit('inherited-definition.ts', 'export {};');
});

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
  const components: LiveMapPartsLibraryInput = { parts: { heading: { kind: "document", document: Hson.document`<h1 hson:part title="%{Title-Case}" "%{content}"/>` } } };
  assert.doesNotThrow(() => hsonLiveMap.fromLibraries({ components, page: { document: valid } }));
  assert.throws(() => hsonLiveMap.fromLibraries({ components, page: { document: valid.replace(' Title-Case="Title"', '') } }), /missing scalar input Title-Case/);
  assert.throws(() => hsonLiveMap.fromLibraries({ components, page: { document: valid.replace('/>', ' extra="x"/>') } }), /unexpected scalar input extra/);
  for (const body of ['<h1 hson:part onclick="%{bad}"/>', '<style hson:part "%{bad}"/>', '<script hson:part "%{bad}"/>', '<h1 hson:part style="color:%{bad}"/>', '<h1 hson:part "%{bad!}"/>']) {
    const result = inspect(application('<hson-part lib="components" at="heading" extra="x"/>', '{ heading: { kind: "document", document: Hson.document`' + body + '` } }'));
    assert.deepEqual(result.codes, body.includes("%{bad!}") ? ["HSON_PART_REFERENCE_INVALID"] : [], body);
    assert.equal(result.facts.batches[0]!.libraries[1]!.members[0]!.documents[0]!.parameterCompleteness, "unknown");
  }
  for (const body of ['<hson-part lib="components" at="heading" style="color:red"/>', '<hson-part lib="components" at="heading" bad.name="x"/>']) {
    assert.deepEqual(inspect(application(body)).codes, body.includes("bad.name") ? ["HSON_PART_ARGUMENT_INVALID"] : [], body);
  }
  const reserved = inspect(application('<hson-part lib="components" at="heading"/>', '{ heading: { kind: "document", document: Hson.document`<h1 hson:part "%{lib} %{at}"/>` } }'));
  assert.deepEqual(reserved.codes, ['HSON_PART_ARGUMENT_MISSING', 'HSON_PART_ARGUMENT_MISSING']);
  const script = inspect(application('<hson-part lib="components" at="heading"/>', '{ heading: { kind: "document", document: Hson.document`<script hson:part src="%{source}"/>` } }'));
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
  const stored = imports + 'maps.fromLibraries({ components: { parts: { stored: { kind: "document", document: Hson.document`<main hson:part ' + missingLibrary + '/>` } } } });';
  assert.deepEqual(inspect(stored).codes, [], 'stored Parts have no initial composition receiver');
  assert.doesNotThrow(() => hsonLiveMap.fromLibraries({ components: { parts: { stored: { kind: 'document', document: '<main hson:part ' + missingLibrary + '/>' } } } }));
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
    const collection = parts.replace('Hson.document`<h1 hson:part title="%{Title-Case}" "%{content}"/>`', 'condition ? Hson.document`<p hson:part/>` : ' + branch);
    assert.deepEqual(inspect(application(missingMember, collection)).codes, [], branch);
  }
});
check("malformed producers and provenance withdraw without suppressing independent syntax errors", () => {
  for (const producer of ['Hson?.document`<p/>`', 'Hson.document?.`<p/>`', 'Hson.canonical`<p/>`', 'Hson.document`<p/><p/>`', 'Hson.document`// \\8\n<p/>`', 'Hson.document`<p`']) {
    const result = inspect(application(missingMember, '{ heading: { kind: "document", document: ' + producer + ' } }'));
    assert.deepEqual(result.codes, [], producer);
  }
  for (const body of ['<hson-part lib="absent" at="heading"', '<hson-part lib="absent" at="hea', missingLibrary + '<bad attr="', missingLibrary + '<p']) {
    const result = inspect(application(body)); assert.deepEqual(result.codes, body.includes("%{bad!}") ? ["HSON_PART_REFERENCE_INVALID"] : [], body);
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
    assert.deepEqual(inspect(application(body)).codes, body.includes("bad.name") ? ["HSON_PART_ARGUMENT_INVALID"] : [], body);
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
    edit('definition.ts', 'import { Hson } from "hson-live/hson"; export const heading = Hson.document`<h1 hson:part "%{content}"/>`;');
    edit('app.ts', imports + 'import { heading } from "./definition.js";\nconst loc = maps.fromLibraries({ page: { document: Hson.document`<hson-part lib="components" at="heading"/>` }, components: { parts: { heading: { kind: "document", document: heading } } } });');
    const published = () => editor.getSemanticDiagnostics(file('app.ts')).filter(diagnostic => diagnostic.code === 95002);
    assert.equal(published().length, 1); assert.match(String(published()[0]!.messageText), /Missing Part parameter "content"/);
    edit('definition.ts', 'import { Hson } from "hson-live/hson"; export const heading = Hson.document`<h1 hson:part/>`;');
    assert.deepEqual(published(), []);
    edit('definition.ts', 'import { Hson } from "hson-live/hson"; export const heading = Hson.document`<h1 hson:part "%{next}"/>`;');
    assert.equal(published().length, 1); assert.match(String(published()[0]!.messageText), /Missing Part parameter "next"/);
  } finally { editor.dispose(); }
});
check("structured arguments normalize bindings, diagnose conflicts and keep literal placeholders opaque", () => {
  const definition = '{ x: {kind:"document", document:Hson.document`<p hson:part slide:data="%{slide}" "^{slide.title}"/>`} }';
  const invoke = (attrs: string) => application('<hson-part lib="components" at="x" ' + attrs + '/>', definition);
  assert.deepEqual(inspect(invoke('data:slide="<title \\\"%{literal}\\\">"')).codes, []);
  assert.deepEqual(inspect(invoke('')).codes, ['HSON_PART_ARGUMENT_MISSING']);
  for (const attrs of ['slide="x" data:slide="null"', 'data:slide="null" slide="x"']) {
    assert.ok(inspect(invoke(attrs)).codes.includes('HSON_PART_ARGUMENT_CONFLICT'));
  }
  for (const name of ['data:', 'data:lib', 'data:at', 'Data:slide']) assert.ok(inspect(invoke(name + '="null"')).codes.includes('HSON_PART_ARGUMENT_INVALID'));
  assert.ok(inspect(invoke('data:slide="malformed"')).codes.includes('HSON_PART_DATA_INVALID'));
  assert.deepEqual(inspect(invoke('data:slide="${dynamic}"')).codes, []);
  const bad = '{ x: {kind:"document", document:Hson.document`<p hson:part slide:data="%{slide}" "^{slide[-1]}"/>`} }';
  assert.ok(inspect(application('<hson-part lib="components" at="x" data:slide="null"/>', bad)).codes.includes('HSON_PART_REFERENCE_INVALID'));
  const forwarding = '{ x: {kind:"document", document:Hson.document`<p hson:part slide:data="%{slide}" <hson-part at="child" data:payload="^{slide.details}"/>/>`}, child:{kind:"document",document:Hson.document`<b hson:part payload:data="%{payload}" "^{payload.title}"/>`} }';
  assert.deepEqual(inspect(application('<hson-part lib="components" at="x" data:slide="<details <title \\\"ok\\\">>"/>', forwarding)).codes, []);
});
check("structured receiving interfaces diagnose local errors and retain dynamic uncertainty", () => {
  const collection = (body: string) => '{x:{kind:"document",document:Hson.document`' + body + '`}}';
  const valid = '<p hson:part slide:data="%{payload}" "^{slide.title}"/>';
  const invocation = (attrs: string) => '<hson-part lib="components" at="x" ' + attrs + '/>';
  assert.deepEqual(inspect(application(invocation('data:payload="<title 0>"'), collection(valid))).codes, []);
  assert.ok(inspect(application(invocation('payload="scalar"'), collection(valid))).codes.includes('HSON_PART_ARGUMENT_INVALID'));
  assert.ok(inspect(application(invocation('data:payload="null" slide="conflict"'), collection(valid))).codes.includes('HSON_PART_ARGUMENT_UNKNOWN'));
  assert.ok(inspect(application(invocation('data:payload="null"'), collection('<p hson:part "%{payload}"/>'))).codes.includes('HSON_PART_ARGUMENT_INVALID'));
  for (const body of ['<p hson:part slide:data="%{payload.title}" "%{slide}"/>', '<p hson:part slide:data="before%{payload}" "%{slide}"/>',
    '<p hson:part <b slide:data="%{payload}" "^{slide}"/>/>', '<p hson:part slide:data="%{payload}" "%{payload}"/>', '<p hson:part slide:data="%{payload}"/>']) {
    const result = inspect(application(invocation('data:payload="null"'), collection(body)));
    assert.ok(result.codes.includes('HSON_PART_REFERENCE_INVALID'), body);
    assert.ok(result.slices.some(slice => slice.includes('%{')), body);
  }
  const dynamic = inspect(application(invocation('data:payload="${dynamic}"'), collection(valid)));
  assert.deepEqual(dynamic.codes, []);
  assert.deepEqual(inspect(application(invocation('data:payload="null"'), collection('<p hson:part slide:data="${dynamic}" "%{slide.title}"/>'))).codes, []);
  const nested = '{x:{kind:"document",document:Hson.document`<p hson:part local:data="%{payload}" <hson-part at="y" data:data="^{local}"/>/>`},y:{kind:"document",document:Hson.document`<b hson:part data:data="%{data}" "^{data.title}"/>`}}';
  assert.deepEqual(inspect(application(invocation('data:payload="<title 0>"'), nested)).codes, []);
});
check("optional diagnostics validate flags and preserve omitted forwarding uncertainty", () => {
  const definition = '{x:{kind:"document",document:Hson.document`<section hson:part part:optional d:data="%{payload}" <p part:optional "^{d.title}"/> <hson-part part:optional at="leaf" data:payload="^{d.child}"/>/>`},leaf:{kind:"document",document:Hson.document`<b hson:part part:optional d:data="%{payload}" "^{d.value}"/>`}}';
  const invocation = '<hson-part lib="components" at="x" data:payload="<>"/>';
  assert.deepEqual(inspect(application(invocation, definition)).codes, []);
  assert.deepEqual(inspect(application(invocation.replace('data:payload="<>"', 'data:payload="${dynamic}"'), definition)).codes, []);
  for (const body of ['<p hson:part part:optional="false"/>', '<p hson:part <b part:optional=""/>/>']) {
    const result = inspect(application('', '{x:{kind:"document",document:Hson.document`' + body + '`}}'));
    assert.ok(result.codes.includes('HSON_PART_OPTIONAL_INVALID'));
    assert.ok(result.slices.includes('part:optional'));
  }
  assert.ok(inspect(application('<p part:optional/>')).codes.includes('HSON_PART_OPTIONAL_INVALID'));
  const unknown = definition.replace('^{d.title}', '%{unknown.title}');
  assert.ok(inspect(application(invocation, unknown)).codes.includes('HSON_PART_REFERENCE_INVALID'));
  assert.ok(inspect(application(invocation.replace('data:payload="<>"', ''), definition)).codes.includes('HSON_PART_ARGUMENT_MISSING'));
  const empty = '{x:{kind:"document",document:Hson.document`<p hson:part part:optional d:data="%{payload}"/>`}}';
  assert.deepEqual(inspect(application(invocation, empty)).codes, []);
  assert.deepEqual(inspect(application(invocation.replace('data:payload="<>"', ''), empty)).codes, []);
});
check("Document bindings diagnose representation, namespace and required optional inputs", () => {
  const definition = (body: string) => '{x:{kind:"document",document:Hson.document`' + body + '`}}';
  const body = '<main hson:part c:doc="%{control}" d:data="%{payload}" "^{d.label}" <hson-part ^{c}/>/>';
  const invocation = '<hson-part lib="components" at="x" doc:control="<b/>" data:payload="<label 0>"/>';
  assert.deepEqual(inspect(application(invocation, definition(body))).codes, []);
  assert.ok(inspect(application(invocation.replace('doc:control', 'data:control'), definition(body))).codes.includes('HSON_PART_ARGUMENT_INVALID'));
  assert.ok(inspect(application(invocation.replace('<b/>', 'broken'), definition(body))).codes.includes('HSON_PART_DOCUMENT_INVALID'));
  for (const invalid of [body.replace('^{d.label}', '%{d.label}'), body.replace('^{c}', '^{d}'),
    body.replace('d:data="%{payload}"', 'c:data="%{payload}"'), body.replace('^{d.label}', '^{unknown.label}'),
    body.replace('<hson-part ^{c}/>', '<hson-part at="child" data:control="^{c}"/>')]) {
    assert.ok(inspect(application(invocation, definition(invalid))).codes.includes('HSON_PART_REFERENCE_INVALID'), invalid);
  }
  const optional = '<main hson:part part:optional c:doc="%{control}"/>';
  assert.ok(inspect(application('<hson-part lib="components" at="x"/>', definition(optional))).codes.includes('HSON_PART_ARGUMENT_MISSING'));
  assert.deepEqual(inspect(application(invocation.replace('doc:control="<b/>"', 'doc:control="${dynamic}"'), definition(body))).codes, []);
});
check("Part declarations diagnose known ownership and local form with exact source ranges", () => {
  const definition = (body: string) => '{ x: { kind:"document", document:Hson.document`' + body + '` } }';
  for (const body of ['<button/>', '<p part:optional/>']) {
    const result = inspect(application('<main/>', definition(body)));
    assert.deepEqual(result.codes, ['HSON_PART_DECLARATION_MISSING']);
    assert.deepEqual(result.slices, [body.slice(0, -2)]);
  }
  assert.deepEqual(inspect(application('<main/>', definition('<button hson:part/>'))).codes, []);
  for (const body of ['<p hson:part=""/>', '<p hson:part="hson:part"/>', '<p hson:part="true"/>', '<p HSON:PART/>',
    '<p hson:part <b hson:part/>/>', '<p hson:part <hson-part hson:part at="x"/>/>']) {
    const result = inspect(application('<main/>', definition(body)));
    assert.ok(result.codes.includes('HSON_PART_DECLARATION_INVALID'), body);
    assert.ok(result.slices.some(slice => slice.toLowerCase() === 'hson:part'), body);
  }
  assert.deepEqual(inspect(application('<p hson:part/>')).codes, ['HSON_PART_DECLARATION_INVALID']);
  assert.deepEqual(inspect(application('<hson-part hson:part lib="components" at="plain"/>')).codes, ['HSON_PART_DECLARATION_INVALID']);
  for (const body of ['<p/>', '<p hson:part/>']) {
    assert.deepEqual(inspect(imports + 'const source = Hson.document`' + body + '`;').codes, []);
  }
  assert.deepEqual(inspect(imports + 'const source = Hson.document`<main <p hson:part/>/>`;').codes, ['HSON_PART_DECLARATION_INVALID']);
  assert.ok(produce_document_diagnostics({fileName: file('app.ts'), text: imports + 'Hson.document`<p hson:part=/>`;', languageId: 'typescript'}).length > 0);
});
check("iterator source facts use shared lexical validation and source-located diagnostics", () => {
  const definition = (body: string) => '{ list: { kind: "document", document: Hson.document`' + body + '` } }';
  const body = '<ul hson:part items:data="%{items}" <li for:item:i="^{items}" "^{i}:^{item.title}"/>/>';
  const good = inspect(application('<main/>', definition(body)));
  assert.deepEqual(good.codes, []);
  const source = good.facts.documents.find(document => document.iteratorDeclarations.length)!;
  assert.equal(source.parameterCompleteness, 'complete');
  assert.deepEqual(source.parameters.map(parameter => parameter.name), ['items']);
  assert.equal(source.iteratorDeclarations[0]!.declaration!.index, 'i');
  for (const invalid of ['for:', 'for:item:', 'for:item:item', 'for:item:i:extra']) {
    const result = inspect(application('<main/>', definition(body.replace('for:item:i', invalid))));
    assert.ok(result.codes.includes('HSON_PART_REFERENCE_INVALID'));
    assert.ok(result.slices.includes(invalid));
  }
  const outside = inspect(application('<main/>', definition(body.replace('/>/>', '/> <b "^{item}"/>/>'))));
  assert.deepEqual(outside.codes, ['HSON_PART_REFERENCE_INVALID']); assert.deepEqual(outside.slices, ['"^{item}"']);
  const shadow = inspect(application('<main/>', definition('<ul hson:part items:data="%{items}" <li for:item="^{items}" <b for:item:i="^{item.children}" "^{item.name}:^{i}"/> "^{item.title}"/>/>')));
  assert.deepEqual(shadow.codes, []);
  const unused = inspect(application('<main/>', definition('<ul hson:part item:data="%{unused}" items:data="%{items}" <li for:item="^{items}" "^{item}"/>/>')));
  assert.deepEqual(unused.codes, ['HSON_PART_REFERENCE_INVALID']);
  assert.ok(unused.diagnostics[0]!.message.includes('Unused'));
  const optionalShadow = '<ul hson:part part:optional x:data="%{unused}" items:data="%{items}" <li for:x="^{items}" "^{x}"/>/>';
  const omitted = inspect(application('<hson-part lib="components" at="list" data:items="«»"/>', definition(optionalShadow)));
  assert.deepEqual(omitted.codes, [], 'an inner alias use is not a use of the shadowed incoming parameter');
  assert.deepEqual(omitted.facts.documents.find(document => document.iteratorDeclarations.length)!.parameters.find(parameter => parameter.name === 'unused')!.uses, []);
  assert.deepEqual(inspect(application('<main/>', definition(body))).codes, [], 'repairs discard stale diagnostics');
});
check('quoted interpolation retains provable lexical errors and exact offending-use locations', () => {
  const definition = (body: string) => '{ list: { kind: "document", document: Hson.document`' + body + '` } }';
  const prefix = '<ul hson:part class="${dynamic}" items:data="%{items}" ';
  const good = inspect(application('<main/>', definition(prefix + '<li for:item:i="^{items}" "^{i}:^{item.title}"/>/>')));
  assert.deepEqual(good.codes, []);
  const invalid = inspect(application('<main/>', definition(prefix + '<li for:item:i="^{items}" "^{unknown}"/>/>')));
  assert.deepEqual(invalid.codes, ['HSON_PART_REFERENCE_INVALID']);
  assert.deepEqual(invalid.slices, ['"^{unknown}"']);
  const sibling = inspect(application('<main/>', definition(prefix + '<li for:item="^{items}"/> <b "^{item}"/>/>')));
  assert.deepEqual(sibling.slices, ['"^{item}"']);
  const forwarded = inspect(application('<main/>', definition(prefix + '<hson-part for::items="^{items}" at="leaf" data:arg="^{items}"/>/>')));
  assert.deepEqual(forwarded.codes, ['HSON_PART_REFERENCE_INVALID']);
  assert.equal(forwarded.diagnostics[0]!.start, forwarded.text.indexOf('data:arg="^{items}"') + 'data:arg='.length);
  const fragmented = inspect(application('<main/>', definition(prefix + '<li for:item="^{items}" title="^{unk${dynamic}nown}" "${dynamic}"/>/>')));
  assert.deepEqual(fragmented.codes, [], 'a dynamic value cannot manufacture a provable reference');
  const opaque = inspect(application('<main/>', definition('<ul hson:part ${dynamic} <li for:item="^{items}" "^{unknown}"/>/>')));
  assert.deepEqual(opaque.codes, [], 'structural slots withhold lexical proof');
  const dynamicSource = inspect(application('<main/>', definition('<ul hson:part items:data="%{items}" <li for:item="${dynamic}" "^{item}"/>/>')));
  assert.deepEqual(dynamicSource.codes, [], 'an interpolated directive source cannot prove invalid syntax');
  assert.deepEqual(inspect(application('<main <li for:item="${dynamic}"/>/>')).codes, ['HSON_PART_REFERENCE_INVALID'], 'ordinary Document placement is invalid regardless of its source value');
});
check('Part conflicts retain the offending attribute through unrelated interpolation and repeated spellings', () => {
  const definition = (body: string) => '{ list: { kind: "document", document: Hson.document`' + body + '` } }';
  for (const unrelated of ['', ' class="${dynamic}"']) {
    for (const [body, attribute, message] of [
      [`<ul hson:part${unrelated} items:data="%{items}" title="%{items}" <li for:item="^{items}" "^{item}"/>/>`, 'title', 'Conflicting Part input "items".'],
      [`<ul hson:part${unrelated} items:data="%{items}" extra:data="%{items}" title="%{items}" <li for:item="^{items}" data-extra="^{extra[0]}" "^{item}"/>/>`, 'title', 'Conflicting Part input "items".'],
      [`<ul hson:part${unrelated} items:data="%{items}" items:doc="%{other}" <hson-part ^{items}/>/>`, 'items:doc', 'Conflicting Part local binding "items".'],
      [`<ul hson:part${unrelated} items:data="%{items}" content:doc="%{items}" <li for:item="^{items}" "^{item}"/> <hson-part ^{content}/>/>`, 'content:doc', 'Conflicting Part input "items".'],
    ]) {
      const result = inspect(application('<main/>', definition(body)));
      const value = attribute === 'items:doc' ? '"%{other}"' : '"%{items}"';
      const start = result.text.indexOf(`${attribute}=${value}`) + attribute.length + 1;
      assert.deepEqual(result.diagnostics.filter(diagnostic => diagnostic.message === message), [{
        file: file('app.ts'), start, end: start + value.length, code: 'HSON_PART_REFERENCE_INVALID', message,
      }], body);
      const source = result.facts.documents.find(document => document.partDeclarations.length > 0);
      assert.ok(source);
      assert.equal(source.parameterCompleteness, 'unknown');
      if (unrelated) assert.equal(source.admission, 'unknown');
    }
  }
});
check('Part conflict provenance does not upgrade incomplete or dynamically authored evidence', () => {
  const definition = (body: string) => '{ list: { kind: "document", document: Hson.document`' + body + '` } }';
  for (const body of [
    '<ul hson:part items:data="%{items}" title="%{items}',
    '<ul hson:part ${dynamic} items:data="%{items}" title="%{items}" <li for:item="^{items}" "^{item}"/>/>',
    '<ul hson:part items:data="${dynamic}" title="%{items}" <li for:item="^{items}" "^{item}"/>/>',
    '<ul hson:part items:data="%{items}" title="%{it${dynamic}ems}" <li for:item="^{items}" "^{item}"/>/>',
  ]) {
    const result = inspect(application('<main/>', definition(body)));
    assert.deepEqual(result.codes, [], body);
    const source = result.facts.documents.find(document => document.partDeclarations.length > 0);
    assert.ok(source);
    assert.equal(source.parameterCompleteness, 'unknown');
  }
});
check('iterator directives diagnose known ordinary Document receivers without interpreting literal text', () => {
  for (const body of ['<main <li for:item="^{items}"/>/>', '<main for:item="^{items}"/>', '<main <li for:item:item="^{items}"/>/>']) {
    const result = inspect(application(body));
    assert.deepEqual(result.codes, ['HSON_PART_REFERENCE_INVALID']);
    assert.ok(result.slices[0]!.startsWith('for:'));
  }
  assert.deepEqual(inspect(application('<main title="for:item" "for:item=\\"#{literal}\\""/>')).codes, []);
  assert.deepEqual(inspect(imports + 'const unconnected = Hson.document`<main <li for:item="^{items}"/>/>`;').codes, []);
});
check("object iterator diagnostics share syntax validation and exact lexical ranges", () => {
  const definition = (body: string) => '{ list: { kind: "document", document: Hson.document`' + body + '` } }';
  const body = '<ul hson:part items:data="%{items}" <li per:key:value="^{items}" "^{key}:^{value.title}"/>/>';
  for (const invalid of ['per:', 'per::', 'per:key:', 'per:key:key', 'per:key:value:extra', 'per:bad.name', 'per:0key']) {
    const result = inspect(application('<main/>', definition(body.replace('per:key:value', invalid))));
    assert.ok(result.codes.includes('HSON_PART_REFERENCE_INVALID')); assert.ok(result.slices.includes(invalid));
  }
  for (const unrelated of ['', 'class="${dynamic}" ']) {
    const source = body.replace('<ul hson:part ', '<ul hson:part ' + unrelated);
    assert.deepEqual(inspect(application('<main/>', definition(source))).codes, []);
    const outside = inspect(application('<main/>', definition(source.replace('/>/>', '/> <b "^{value}"/>/>'))));
    assert.deepEqual(outside.codes, ['HSON_PART_REFERENCE_INVALID']); assert.deepEqual(outside.slices, ['"^{value}"']);
    const scalar = inspect(application('<main/>', definition(source.replace('^{key}:^{value.title}', '^{key.value}'))));
    assert.deepEqual(scalar.codes, ['HSON_PART_REFERENCE_INVALID']); assert.deepEqual(scalar.slices, ['"^{key.value}"']);
  }
  const duplicate = inspect(application('<main/>', definition(body.replace('per:key:value=', 'for:item="^{items}" per:key:value='))));
  assert.ok(duplicate.slices.includes('per:key:value')); assert.ok(duplicate.diagnostics.some(issue => /one Part iterator/.test(issue.message)));
  assert.deepEqual(inspect(application('<main/>', definition(body))).codes, []);
  const ordinary = inspect(application('<main <b per:key="^{items}"/>/>'));
  assert.deepEqual(ordinary.codes, ['HSON_PART_REFERENCE_INVALID']); assert.deepEqual(ordinary.slices, ['per:key']);
});
check("collection source diagnostics belong to proven invocations, never a universal Part Schema", () => {
  const body = '<ul hson:part items:data="%{items}" <li per:key:value="^{items}" "^{key}"/>/>';
  const definition = '{ list: { kind: "document", document: Hson.document`' + body + '` } }';
  const literal = (data: string) => application('<hson-part lib="components" at="list" data:items="' + data + '"/>', definition);
  for (const data of ['«»', 'null', 'false', '2']) {
    const result = inspect(literal(data));
    assert.deepEqual(result.codes, ['HSON_PART_REFERENCE_INVALID']); assert.deepEqual(result.slices, ['"' + data + '"']);
    assert.match(result.diagnostics[0]!.message, /requires object Data for this invocation/);
  }
  assert.deepEqual(inspect(literal('<>')).codes, []);
  const annotated = (shape: string, input = '${records}', definitionBody = body) => imports
    + 'import type { HsonData } from "hson-live"; const Records=Hson.schema`<type "data" defs <Input ' + shape + '> content <ref "Input">>`;'
    + 'declare const records: HsonData<typeof Records>; const loc=maps.fromLibraries({components:{parts:{list:{kind:"document",document:Hson.document`' + definitionBody + '`}}},'
    + 'page:{document:Hson.document`<hson-part lib="components" at="list" data:items="' + input + '"/>`}});';
  for (const shape of ['"number"', '<array "string">']) {
    const result = inspect(annotated(shape));
    assert.ok(result.facts.documents.some(document => document.connectors.some(connector => connector.attributes.some(attribute => attribute.dataSchema !== undefined))));
    assert.deepEqual(result.codes, ['HSON_PART_REFERENCE_INVALID']);
    assert.deepEqual(result.slices, ['data:items'], 'dynamic values use the exact sending attribute name');
  }
  for (const shape of ['<content <first "string" second "number">>', '"any"']) assert.deepEqual(inspect(annotated(shape)).codes, []);
  assert.deepEqual(inspect(annotated('"number"', '${dynamic}')).codes, []);
  const nested = '<ul hson:part items:data="%{items}" <li per::value="^{items}" <b per:key="^{value}" "^{key}"/>/>/>';
  assert.deepEqual(inspect(annotated('<content <first <optional "number">>>', '${records}', nested)).codes, [], 'possibly empty outer iteration cannot prove execution');
  assert.deepEqual(inspect(application('<main/>', definition)).codes, [], 'an uninvoked reusable Part has no inferred source type');
});
check("nested iterator value diagnostics require enclosing execution across for and per", () => {
  for (const outer of ['for', 'per']) for (const inner of ['for', 'per']) {
    const empty = outer === 'for' ? '«»' : '<>';
    const nonempty = outer === 'for' ? '«0»' : '<first 0>';
    const correct = inner === 'for' ? '«1»' : '<second 1>';
    for (const unrelated of ['', ' class="${dynamic}"']) for (const shadow of [false, true]) {
      const outerDirective = outer === 'for' ? 'for:alias' : 'per:key:alias';
      const innerDirective = inner === 'for' ? `for:${shadow ? 'alias' : 'value'}` : `per:${shadow ? 'key' : 'name'}:${shadow ? 'alias' : 'value'}`;
      const body = `<ul hson:part${unrelated} items:data="%{items}" other:data="%{other}" <li ${outerDirective}="^{items}" <b ${innerDirective}="^{other}" "^{${shadow ? 'alias' : 'value'}}"/>/>/>`;
      const definition = '{list:{kind:"document",document:Hson.document`' + body + '`}}';
      for (const items of [empty, nonempty]) for (const other of [correct, '2']) {
        const invocation = `<hson-part lib="components" at="list" data:items="${items}" data:other="${other}"/>`;
        const result = inspect(application(invocation, definition));
        const invalid = items === nonempty && other === '2';
        assert.deepEqual(result.codes, invalid && !unrelated ? ['HSON_PART_REFERENCE_INVALID'] : [], `${outer}/${inner}: ${items}, ${other}, shadow=${shadow}${unrelated}`);
        if (invalid && !unrelated) assert.deepEqual(result.slices, ['"2"']);
        const source = result.facts.documents.find(document => document.iteratorDeclarations.length === 2)!;
        if (unrelated) assert.equal(source.parameterCompleteness, 'unknown', 'quoted definition slots retain existing interface uncertainty');
        assert.deepEqual(source.iteratorDeclarations.map(iterator => iterator.enclosingIterators?.length), [0, 1]);
        assert.deepEqual(source.iteratorDeclarations[1]!.enclosingIterators, [source.iteratorDeclarations[0]!.location]);
        if (!unrelated) {
          const run = () => hsonLiveMap.fromLibraries({ components: { parts: { list: { kind: 'document', document: body } } }, page: { document: invocation } });
          if (invalid) assert.throws(run, /(?:requires|resolve to) .* Data/);
          else {
            const map = run();
            if (items === empty) assert.equal(map.doc.must('page').render(), '<ul></ul>');
          }
        }
      }
      // A value interpolation in the outer input cannot prove nested execution.
      assert.deepEqual(inspect(application('<hson-part lib="components" at="list" data:items="${dynamic}" data:other="2"/>', definition)).codes, []);
    }
    const body = `<ul hson:part items:data="%{items}" other:data="%{other}" <li ${outer}:item="^{items}" <b ${inner}:value="^{other}"/>/>/>`;
    const invocation = `<main title="${'${dynamic}'}" <hson-part lib="components" at="list" data:items="${nonempty}" data:other="2"/>/>`;
    assert.deepEqual(inspect(application(invocation, '{list:{kind:"document",document:Hson.document`' + body + '`}}')).codes, ['HSON_PART_REFERENCE_INVALID'], 'unrelated receiving interpolation does not hide a proven invocation error');
  }
});
check("nested iterator structural diagnostics survive skipped execution", () => {
  for (const outer of ['for:item', 'per:key:item']) for (const inner of ['for:value', 'per:name:value']) {
    const empty = outer.startsWith('for:') ? '«»' : '<>';
    const body = `<ul hson:part class="${'${dynamic}'}" items:data="%{items}" other:data="%{other}" <li ${outer}="^{items}" <b ${inner}="^{other}" "^{value}"/>/>/>`;
    const invocation = `<hson-part lib="components" at="list" data:items="${empty}" data:other="2"/>`;
    for (const invalid of [body.replace(inner, inner + ':extra:invalid'), body.replace('^{other}', '^{unknown}'),
      body.replace('"^{value}"', '"^{missing}"'), body.replace(`${inner}=`, `for:duplicate="^{other}" ${inner}=`)]) {
      const result = inspect(application(invocation, '{list:{kind:"document",document:Hson.document`' + invalid + '`}}'));
      assert.ok(result.codes.includes('HSON_PART_REFERENCE_INVALID'), invalid);
      assert.ok(result.diagnostics.every(issue => !issue.message.includes('requires ') || !issue.message.includes('Data for this invocation')), 'structural errors do not borrow a skipped value error');
    }
  }
});
check("nested collection projections preserve source-before-shadow and conservative Schema multiplicity", () => {
  for (const outer of ['for', 'per']) for (const inner of ['for', 'per']) {
    const outerDirective = outer === 'for' ? 'for:items' : 'per:key:items';
    const innerDirective = inner === 'for' ? 'for:items' : 'per:key:items';
    const body = `<ul hson:part items:data="%{items}" <li ${outerDirective}="^{items}" <b ${innerDirective}="^{items}"/>/>/>`;
    const definition = '{list:{kind:"document",document:Hson.document`' + body + '`}}';
    const correct = inner === 'for' ? '«»' : '<>';
    const data = (value: string) => outer === 'for' ? `«${value}»` : `<first ${value}>`;
    for (const value of [correct, '2']) {
      const result = inspect(application(`<hson-part lib="components" at="list" data:items="${data(value)}"/>`, definition));
      assert.deepEqual(result.codes, value === '2' ? ['HSON_PART_REFERENCE_INVALID'] : [], `${outer}/${inner} shadowed collection`);
    }
    const shape = outer === 'for' ? '<array "number">' : '<content <first <optional "number">>>';
    const annotated = imports + 'import type { HsonData } from "hson-live"; const Items=Hson.schema`<type "data" defs <Input ' + shape + '> content <ref "Input">>`;'
      + 'declare const items: HsonData<typeof Items>; const loc=maps.fromLibraries({components:{parts:' + definition + '},page:{document:Hson.document`<hson-part lib="components" at="list" data:items="${items}"/>`}});';
    assert.deepEqual(inspect(annotated).codes, [], 'Schema collection elements do not establish outer execution');
  }
});
check("independent inner Schemas require literal outer execution and deeper correlations remain conservative", () => {
  for (const outer of ['for:item', 'per:key:item']) for (const inner of ['for:value', 'per:name:value']) {
    const body = `<ul hson:part items:data="%{items}" other:data="%{other}" <li ${outer}="^{items}" <b ${inner}="^{other}"/>/>/>`;
    const prefix = imports + 'import type { HsonData } from "hson-live"; const Other=Hson.schema`<type "data" defs <Input "number"> content <ref "Input">>`; declare const other:HsonData<typeof Other>;';
    for (const nonempty of [false, true]) {
      const items = outer.startsWith('for:') ? nonempty ? '«0»' : '«»' : nonempty ? '<first 0>' : '<>';
      const result = inspect(prefix + 'const loc=maps.fromLibraries({components:{parts:{list:{kind:"document",document:Hson.document`' + body
        + '`}}},page:{document:Hson.document`<hson-part lib="components" at="list" data:items="' + items + '" data:other="${other}"/>`}});');
      assert.deepEqual(result.codes, nonempty ? ['HSON_PART_REFERENCE_INVALID'] : []);
      if (nonempty) assert.deepEqual(result.slices, ['data:other']);
    }
  }
  const body = '<ul hson:part items:data="%{items}" <li for:item="^{items}" <b for:unused="^{item.children}" <i per:key="^{item.other}" "^{key}"/>/>/>/>';
  const invocation = '<hson-part lib="components" at="list" data:items="«<children «» other 2>,<children «0» other <>>»"/>';
  const result = inspect(application(invocation, '{list:{kind:"document",document:Hson.document`' + body + '`}}'));
  assert.deepEqual(result.codes, [], 'a different element cannot establish execution for a skipped source');
  assert.doesNotThrow(() => hsonLiveMap.fromLibraries({components:{parts:{list:{kind:'document',document:body}}},page:{document:invocation}}));
  const boundedBody = body.replace('for:unused="^{item.children}"', 'for:child="^{item.children}" <em for:unused="^{child.children}"').replace('/>/>/>/>', '/>/>/>/>/>');
  const children = Array.from({length: 512}, () => '<children «0»>').join(',');
  const boundedInvocation = `<hson-part lib="components" at="list" data:items="«<children «${children}» other <>>,<children «<children «»>» other 2>»"/>`;
  const bounded = inspect(application(boundedInvocation, '{list:{kind:"document",document:Hson.document`' + boundedBody + '`}}'));
  assert.deepEqual(bounded.codes, [], 'truncated projections cannot prove all execution contexts');
  assert.doesNotThrow(() => hsonLiveMap.fromLibraries({components:{parts:{list:{kind:'document',document:boundedBody}}},page:{document:boundedInvocation}}));
});
check("old executable hash references produce actionable migration diagnostics with source ranges", () => {
  for (const body of [
    '<p hson:part d:data="%{payload}" "#{d.title}"/>',
    '<p hson:part d:data="%{payload}" title="#{d.title}"/>',
    '<main hson:part d:data="%{payload}" <hson-part at="child" data:payload="#{d}"/>/>',
    '<main hson:part d:doc="%{payload}" <hson-part at="child" doc:payload="#{d}"/>/>',
    '<ul hson:part d:data="%{payload}" <li for:item="#{d}" "^{item}"/>/>',
    '<dl hson:part d:data="%{payload}" <dd per:key:value="#{d}" "^{key}"/>/>',
  ]) {
    for (const producer of ['Hson.document`' + body + '`', JSON.stringify(body)]) {
      const result = inspect(application('<main/>', '{x:{kind:"document",document:' + producer + '}}'));
      const migration = result.diagnostics.filter(issue => issue.message.includes('Local Part references use ^{'));
      assert.ok(migration.length > 0, body);
      assert.ok(migration.every(issue => issue.code === 'HSON_PART_REFERENCE_INVALID'));
      assert.ok(migration.some(issue => result.text.slice(issue.start, issue.end).includes('#{')), body);
    }
  }
  const bare = '<main hson:part c:doc="%{control}" <hson-part #{c}/>/>';
  for (const [languageId, fileName, text] of [
    ['hson', 'old.hson', bare], ['typescript', 'old.ts', imports + 'Hson.document`' + bare + '`;'],
  ]) {
    const diagnostics = produce_document_diagnostics({ languageId: languageId!, fileName: file(fileName!), text: text! });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]!.code, 'HSON_PART_REFERENCE_INVALID');
    assert.equal(text![diagnostics[0]!.range.start], '#');
    assert.match(diagnostics[0]!.message, /Local Part references use \^\{/);
  }
  assert.deepEqual(inspect(application('<p title="#{literal} ^{literal}" "#{literal} ^{literal}"/>')).codes, []);
});
check("explicit optional references share requiredness and retain exact source facts", () => {
  const definition = '{x:{kind:"document",document:Hson.document`<main hson:part model:data="%{payload?}" control:doc="%{content?}" title="%{title?}" "^{model.label?}" <hson-part ^{control?}/>/ >`}}'.replace('/ >', '/>');
  const result = inspect(application('<hson-part at="components/x"/>', definition));
  assert.deepEqual(result.codes, []);
  const source = result.facts.documents.find(document => document.parameters.some(parameter => parameter.name === 'payload'))!;
  assert.equal(source.parameterCompleteness, 'complete');
  assert.deepEqual([...source.signature!.requiredness.values()], ['optional', 'optional', 'optional']);
  assert.ok(source.parameters.flatMap(parameter => parameter.uses).every(use => use.optional));
  assert.ok(source.parameters.flatMap(parameter => parameter.uses).some(use => result.text.slice(use.location.start, use.location.end).includes('^{model.label?}')));
  const strict = inspect(application('<hson-part at="components/x"/>', definition.replace('%{title?}', '%{title}')));
  assert.deepEqual(strict.codes, ['HSON_PART_ARGUMENT_MISSING']);
  assert.match(strict.diagnostics[0]!.message, /title/);
  const invalid = inspect(application('<hson-part at="components/x"/>', definition.replace('^{model.label?}', '^{unknown.label?}')));
  assert.ok(invalid.codes.includes('HSON_PART_REFERENCE_INVALID'));
  assert.ok(invalid.slices.some(slice => slice.includes('^{unknown.label?}')));
});
check("conditional Data beneath empty and nested iterators does not invent missing inputs", () => {
  for (const child of ['<i for:row="^{rows}" "^{model.title}"/>',
    '<i for:row="^{rows}" <b per:key:value="^{model}" "^{value}"/>/>']) {
    const definition = '{x:{kind:"document",document:Hson.document`<main hson:part part:optional rows:data="%{rows}" model:data="%{payload}" ' + child + '/>`}}';
    const result = inspect(application('<hson-part at="components/x" data:rows="«»"/>', definition));
    assert.deepEqual(result.codes, []);
    const source = result.facts.documents.find(document => document.signature?.parameters.has('payload'))!;
    assert.equal(source.signature!.requiredness.get('payload'), 'conditional');
    assert.deepEqual(inspect(application('<hson-part at="components/x" data:rows="«0»"/>', definition)).codes, [], 'composition determines executed conditional reads');
    const required = inspect(application('<hson-part at="components/x" data:rows="«»"/>', definition.replace(' part:optional', '')));
    assert.deepEqual(required.codes, ['HSON_PART_ARGUMENT_MISSING']);
    assert.match(required.diagnostics[0]!.message, /payload/);
  }
});
check("known names and representation mismatches survive dynamically evaluated values", () => {
  const definition = '{x:{kind:"document",document:Hson.document`<h1 hson:part "%{content?}"/>`}}';
  for (const [argument, code, slice] of [
    ['data:block="${dynamic}"', 'HSON_PART_ARGUMENT_UNKNOWN', 'data:block'],
    ['data:content="${dynamic}"', 'HSON_PART_ARGUMENT_INVALID', 'data:content'],
    ['doc:content="${dynamic}"', 'HSON_PART_ARGUMENT_INVALID', 'doc:content'],
    ['wrong="${dynamic}"', 'HSON_PART_ARGUMENT_UNKNOWN', 'wrong'],
  ]) {
    const result = inspect(application('<hson-part at="components/x" ' + argument + '/>', definition));
    assert.deepEqual(result.codes, [code]);
    assert.deepEqual(result.slices, [slice]);
  }
  const uncertain = application('<hson-part at="components/${dynamic}" data:block="${dynamic}"/>', definition);
  assert.deepEqual(inspect(uncertain).codes, []);
  const missing = inspect(application('<hson-part at="components/x" content="${dynamic}"/>', definition.replace('%{content?}', '%{content?} %{title}')));
  assert.deepEqual(missing.codes, ['HSON_PART_ARGUMENT_MISSING']);
  assert.deepEqual(missing.slices, ['at']);
  assert.match(missing.diagnostics[0]!.message, /title/);
  const duplicate = application('<main @:same <hson-part @:same at="components/x" wrong="${dynamic}"/>/>', definition);
  assert.deepEqual(inspect(duplicate).codes, [], 'invalid QUAD ownership withdraws value-independent contract evidence');
});
service.dispose();
events.terminal("pass");
