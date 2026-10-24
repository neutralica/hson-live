import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { HsonEditorCompletionCache, type HostCompletion } from "../editors/vscode-hson/src/editor-completion.ts";
import { collect_part_source_facts } from "../src/internal/hson-schema/part-source.ts";
import { query_hson_editor_context } from "../src/internal/editor-introspection/query.ts";
import { hson_grammar_checkpoint } from "../src/api/transform/parsers/tokenize-hson.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "part-completion", title: "Contextual authored Part completion", category: "Tooling", runtime: "node", tags: Object.freeze(["parts", "editor", "provenance"]) });
const events = create_test_event_emitter(HSON_LIVE_TEST_METADATA.id);
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, "tmp"), { recursive: true });
const directory = mkdtempSync(join(root, "tmp", "part-completion-"));
process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
writeFileSync(join(directory, "package.json"), '{"type":"module"}');
const files = new Map<string, string>();
const versions = new Map<string, number>();
let revision = 0;
const file = (name: string) => join(directory, name);
function edit(name: string, source: string): void { files.set(file(name), source); versions.set(file(name), revision++); }
const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true, skipLibCheck: true, types: [], baseUrl: root,
  paths: { "hson-live": ["src/index.ts"], "hson-live/hson": ["src/hson-authoring.ts"], "hson-live/livemap": ["src/api/livemap/index.ts"] } };
const host: ts.LanguageServiceHost = {
  getCompilationSettings: () => options, getScriptFileNames: () => [...files.keys()], getProjectVersion: () => String(revision),
  getScriptVersion: path => String(versions.get(path) ?? 0), getScriptSnapshot: path => {
    const text = files.get(path) ?? ts.sys.readFile(path); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  }, getCurrentDirectory: () => directory, getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: path => files.has(path) || ts.sys.fileExists(path), readFile: path => files.get(path) ?? ts.sys.readFile(path),
  directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories, readDirectory: ts.sys.readDirectory,
};
const service = ts.createLanguageService(host);
const cache = new HsonEditorCompletionCache();
const imports = 'import { Hson, hson, hsonLiveMap as maps } from "hson-live";\nimport { parts } from "./parts.js";\ndeclare const dynamic: any, condition: boolean;\n';
const parts = 'import { Hson } from "hson-live/hson";\nexport const parts = {\n'
  + 'heading: { kind: "document", document: Hson.document`<h1 title="%{Title-Case}" "%{content}"/>` },\n'
  + 'para: { kind: "document", document: Hson.document`<p "%{content}"/>` },\n'
  + 'title: { kind: "document", document: Hson.document`<h1 "%{content}"/>` },\n'
  + 'nav: { kind: "document", document: Hson.document`<nav title="%{prev}" "%{current} %{next}"/>` },\n'
  + '} as const;';
edit("parts.ts", parts);
const application = '\nconst loc = hson.liveMap.locus.create({ components: { parts } });';
function complete(marked: string) {
  const offset = marked.indexOf("|"); assert.ok(offset >= 0);
  const text = marked.replace("|", ""); edit("app.ts", text);
  const program = service.getProgram()!;
  const entries = cache.complete(file("app.ts"), text, revision, offset, program);
  return { entries, text, offset, program, labels: entries.map(entry => entry.candidate.label) };
}
function applied(result: ReturnType<typeof complete>, label: string): string {
  const entry = result.entries.find(entry => entry.candidate.label === label); assert.ok(entry, `${label}: ${result.labels}\n${result.text}`);
  return apply(result.text, entry);
}
const apply = (text: string, entry: HostCompletion) => text.slice(0, entry.range.start) + entry.candidate.insertText + text.slice(entry.range.end);
function authored(body: string, suffix = application): string { return imports + 'const page = Hson.document`' + body + '`;' + suffix; }

check("Deck-style imported Parts inventories support missing and unfinished coordinates with actual edits", () => {
  for (const [body, label, expected] of [
    ['<hson-part lib=|/>', 'components', '<hson-part lib="components"/>'],
    ['<hson-part lib=co|mponents at=heading/>', 'components', '<hson-part lib="components" at=heading/>'],
    ['<hson-part lib="co|', 'components', '<hson-part lib="components"'],
    ['<hson-part lib="components" at=|/>', 'heading', '<hson-part lib="components" at="heading"/>'],
    ['<hson-part at="he|" lib="components"/>', 'heading', '<hson-part at="heading" lib="components"/>'],
    ['<hson-part lib="components" at="he|', 'heading', '<hson-part lib="components" at="heading"'],
    ['<hson-part lib="components" at=he|ading/>', 'heading', '<hson-part lib="components" at="heading"/>'],
    ['<hson-part lib="co|mponents" at="heading"/>', 'components', '<hson-part lib="components" at="heading"/>'],
  ]) {
    const result = complete(authored(body!));
    assert.equal(applied(result, label!), authored(expected!));
    assert.ok(result.entries.every(entry => entry.candidate.certainty === "possible"));
  }
  assert.deepEqual(complete(authored('<hson-part lib="components" at="|"/>')).labels, ["heading", "nav", "para", "title"]);
});

check("neutral queries share production header observations and exact replacement ranges", () => {
  const body = '<hson-part lib="components" at="he|ading" content="ok"/>';
  const result = complete(authored(body));
  const facts = collect_part_source_facts(ts, result.program);
  const source = body.replace("|", ""), cursor = body.indexOf("|");
  const neutral = query_hson_editor_context({ mode: "document", source, cursor, parts: { facts, file: file("app.ts"), offset: result.offset } });
  assert.deepEqual(neutral.candidates, result.entries.map(entry => entry.candidate));
  assert.deepEqual(neutral.checkpoint?.range, { start: source.indexOf('heading'), end: source.indexOf('heading') + 7 });
  assert.equal(neutral.checkpoint?.element?.attributes.length, 3);
  const checkpoint = hson_grammar_checkpoint('<hson-part lib="co', '<hson-part lib="co'.length, "document");
  assert.equal(checkpoint?.kind, "attribute-value");
});

check("occupied quote boundaries replace scanner-proven values and suppress unsafe quotes", () => {
  for (const [body, label, expected] of [
    ['<hson-part lib=|"co"/>', 'components', '<hson-part lib="components"/>'],
    ['<hson-part lib="components" at=|"he"/>', 'heading', '<hson-part lib="components" at="heading"/>'],
    ['<hson-part lib= |"co" at="heading"/>', 'components', '<hson-part lib= "components" at="heading"/>'],
    ['<hson-part lib=|""/>', 'components', '<hson-part lib="components"/>'],
  ]) {
    const result = complete(authored(body!));
    assert.equal(applied(result, label!), authored(expected!));
    const entry = result.entries.find(entry => entry.candidate.label === label)!;
    assert.equal(result.text[entry.range.start], '"'); assert.equal(result.text[entry.range.end - 1], '"');
  }
  for (const body of ['<hson-part lib=|"co', '<hson-part lib=|"co/>', String.raw`<hson-part lib=|"co\q"/>`, '<hson-part lib=|\'co\'/>', '<hson-part lib=|"${dynamic}"/>']) {
    assert.deepEqual(complete(authored(body)).labels, [], body);
  }
});

const memberApplication = '\nconst loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: page } } } });';
check("shared placement admits script/style attributes and excludes every restricted descendant", () => {
  for (const body of ['<script src="/app.js" title="%{content}" id="%{co|}"/>', '<style media="%{content}" id=%{co|}/>', '<main <SCRIPT src="/app.js" title="%{content}" id="%{co|}"/>/>']) {
    const result = complete(authored(body, memberApplication));
    assert.equal(applied(result, 'content'), authored(body.replace('co|', 'content'), memberApplication));
  }
  for (const body of ['<main title="%{content}" <script <span id="%{co|}"/>/>/>', '<main title="%{content}" <style <span "%{co|}"/>/>/>', '<script title="%{content}" "%{co|}"/>', '<style media="%{content}" <div id=%{co|}/>/>']) {
    const result = complete(authored(body, memberApplication));
    const neutral = query_hson_editor_context({ mode: 'document', source: body.replace('|', ''), cursor: body.indexOf('|'),
      parts: { facts: collect_part_source_facts(ts, result.program), file: file('app.ts'), offset: result.offset } });
    assert.equal(neutral.checkpoint?.kind, 'parameter', 'the scanner observation remains lexical');
    assert.deepEqual(neutral.candidates, [], body);
    assert.deepEqual(result.labels, [], body);
  }
  const body = '<main title="%{Good-name}" <script title="%{Own-attr}" <span title="%{Bad-descendant}" "%{Bad-text}"/>/> <style <p id=%{Bad-style}/>/> <p "%{Go|}"/>/>';
  const result = complete(authored(body, memberApplication));
  const document = collect_part_source_facts(ts, result.program).documents.find(doc => doc.producer.getText().includes('Good-name'))!;
  assert.deepEqual(document.parameters, []); assert.equal(document.parameterCompleteness, 'unknown');
  assert.deepEqual(document.parameterSpellings.map(item => item.name).sort(), ['Go', 'Good-name', 'Own-attr']);
  assert.equal(applied(result, 'Good-name'), authored(body.replace('Go|', 'Good-name'), memberApplication));
});

check("unquoted and escaped placeholders use exact decoded/source boundaries", () => {
  for (const [body, expected, replaced] of [
    ['<h1 title="%{content}" id=%{co|}/>', '<h1 title="%{content}" id=%{content}/>', 'co'],
    [String.raw`<h1 title="%{content}" id="%{\u0063o|}"/>`, '<h1 title="%{content}" id="%{content}"/>', String.raw`\u0063o`],
    [String.raw`<h1 title="%{content}" id="%\u007b\u0063o|\u007d"/>`, String.raw`<h1 title="%{content}" id="%\u007bcontent\u007d"/>`, String.raw`\u0063o`],
    [String.raw`<h1 title="%{content}" id="%{c|\u006fntent}"/>`, '<h1 title="%{content}" id="%{content}"/>', String.raw`c\u006fntent`],
    [String.raw`<h1 title="%{Mixed-Case}" id="%{\u004dix|}"/>`, '<h1 title="%{Mixed-Case}" id="%{Mixed-Case}"/>', String.raw`\u004dix`],
    ['<h1 title="%{content}" id=%{co|', '<h1 title="%{content}" id=%{content}', 'co'],
  ]) {
    const result = complete(authored(body!, memberApplication));
    const label = body!.includes('Mixed-Case') ? 'Mixed-Case' : 'content';
    assert.equal(applied(result, label), authored(expected!, memberApplication));
    const entry = result.entries.find(entry => entry.candidate.label === label)!;
    assert.equal(result.text.slice(entry.range.start, entry.range.end), replaced);
  }
  const inner = String.raw`<h1 title="%{content}" id="%{\u0063o|}"/>`;
  const nestedPart = imports + 'const outer = Hson.document`<main ${(() => { const page = Hson.document`' + inner + '`;'
    + memberApplication + 'return page; })()}/>`;';
  const nestedResult = complete(nestedPart);
  assert.equal(applied(nestedResult, 'content'), nestedResult.text.replace('\\u0063o', 'content'));
  const nested = imports + 'const outer = Hson.document`<main ${Hson.document`' + inner + '`}/>`;\r\n'
    + 'const loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: outer } } } });';
  // The inner template needs its own actual member relationship for spelling reuse.
  const direct = authored('<main\r\n <h1 title="%{content}" id="%{\\u0063o|}"/>\r\n/>', memberApplication).replaceAll('\n', '\r\n').replaceAll('\r\r\n', '\r\n');
  const crlf = complete(direct); assert.equal(applied(crlf, 'content'), crlf.text.replace('\\u0063o', 'content'));
  assert.deepEqual(complete(nested).labels, [], 'an unrelated inner document does not borrow Part ownership');
  for (const body of [String.raw`<h1 title="%{content}" id="%{\u00|63o}"/>`, String.raw`<h1 title="%{content}" id="%{\u006|o}"/>`, '<h1 title="%{content}" id="%{co|${dynamic}}"/>', '<h1 title="%{content}" id=%{co|${dynamic}}/>']) {
    assert.deepEqual(complete(authored(body, memberApplication)).labels, [], body);
  }
});

check("connector argument names preserve case and hyphens and exclude complete header attributes on either side", () => {
  const result = complete(authored('<hson-part lib="components" at="heading" Ti|tle-bad="x" content="kept"/>'));
  assert.deepEqual(result.labels, ["Title-Case"]);
  assert.equal(applied(result, "Title-Case"), authored('<hson-part lib="components" at="heading" Title-Case="x" content="kept"/>'));
  assert.deepEqual(complete(authored('<hson-part lib="components" at="nav" | current="x"/>')).labels, ["next", "prev"]);
  assert.deepEqual(complete(authored('<hson-part lib="components" at="heading" | content="x" Title-Case="y"/>')).labels, []);
});

check("known receiving contexts remain certain; plausible contexts deduplicate without promoting certainty", () => {
  const fresh = '\nconst loc = maps.fromLibraries({ page: { document: page }, components: { parts: { heading: { kind: "document", document: Hson.document`<h1 "%{content}"/>` } } } });';
  const known = complete(authored('<hson-part lib="|"/>', fresh));
  assert.equal(known.entries[0]?.candidate.certainty, "certain");
  const alternatives = fresh.replace('document: page', 'document: condition ? page : dynamic');
  assert.ok(complete(authored('<hson-part lib="|"/>', alternatives)).entries.every(entry => entry.candidate.certainty === "possible"));
  const multiple = application + '\nconst other = maps.fromLibraries({ components: { parts: { extra: { kind: "document", document: "<p/>" } } } });';
  const possible = complete(authored('<hson-part lib="components" at="|"/>', multiple));
  assert.deepEqual(possible.labels, ["extra", "heading", "nav", "para", "title"]);
  assert.ok(possible.entries.every(entry => entry.candidate.certainty === "possible"));
  assert.deepEqual(complete(authored('<hson-part lib="|"/>', multiple)).labels, ["components"]);
});

check("partial collections offer grounded members and parameters while keeping unknown members unknown", () => {
  const partial = '\nconst loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Hson.document`<h1 "%{content}"/>` }, ...dynamic } } });';
  const result = complete(authored('<hson-part lib="components" at="|"/>', partial));
  assert.deepEqual(result.labels, ["heading"]); assert.equal(result.entries[0]?.candidate.certainty, "possible");
  assert.deepEqual(complete(authored('<hson-part lib="components" at="heading" co|/>', partial)).labels, ["content"]);
  assert.deepEqual(complete(authored('<hson-part lib="components" at="unseen" |/>', partial)).labels, []);
});

check("direct, aliased, namespace and umbrella constructors reuse official admission", () => {
  for (const constructor of ['maps.locus.create', 'maps.fromLibraries', 'hson.liveMap.locus.create', 'hson.liveMap.fromLibraries', 'direct.locus.create', 'namespace.locus.create']) {
    const extra = '\nimport { hsonLiveMap as direct } from "hson-live/livemap";\nimport * as namespace from "hson-live/livemap";\nconst loc = ' + constructor + '({ components: { parts } });';
    assert.deepEqual(complete(authored('<hson-part lib="components" at="he|"/>', extra)).labels, ["heading"], constructor);
  }
});

check("fake, malformed and unsupported producers cannot contribute member suggestions", () => {
  for (const suffix of [
    '\nconst fake = { fromLibraries: (x: any) => x }; fake.fromLibraries({ components: { parts } });',
    '\nconst fake: typeof maps = dynamic; fake.fromLibraries({ components: { parts } });',
    '\nconst loc = maps.fromLibraries({ components: { parts } },); // supported call',
    '\nconst loc = maps.fromLibraries({ components: { parts }, broken: });',
    '\nconst loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Hson?.document`<p/>` } } } });',
    '\nconst loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Hson.canonical`<p/>` } } } });',
    '\nconst loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Hson.document`<p/><p/>` } } } });',
  ]) {
    const result = complete(authored('<hson-part lib="components" at="he|"/>', suffix));
    assert.deepEqual(result.labels, suffix.includes('supported call') ? ["heading"] : [], suffix);
  }
  assert.deepEqual(complete(authored('<hson-part lib="components" at="he|"/>').replace('"hson-live";', '"hson-live;')).labels, []);
});

check("placeholder reuse uses valid spellings without making incomplete definitions authoritative", () => {
  for (const [body, expected] of [
    ['<h1 title="%{Title-Case}" "%{content}" "%{co|}"/>', '<h1 title="%{Title-Case}" "%{content}" "%{content}"/>'],
    ['<h1 title="%{Title-Case}" "%{content}" "%{Ti|}"/>', '<h1 title="%{Title-Case}" "%{content}" "%{Title-Case}"/>'],
    ['<h1 "%{content}" "%{co|"/>', '<h1 "%{content}" "%{content}"/>'],
    ['<h1 "%{content}" "%{co|', '<h1 "%{content}" "%{content}'],
    [String.raw`<h1 "%\u007bcontent}" "%{co|}"/>`, String.raw`<h1 "%\u007bcontent}" "%{content}"/>`],
  ]) {
    const suffix = '\nconst loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: page } } } });';
    const result = complete(authored(body!, suffix));
    const name = body!.includes('Ti|') ? "Title-Case" : "content";
    assert.equal(applied(result, name), authored(expected!, suffix));
    assert.match(result.entries.find(entry => entry.candidate.label === name)!.candidate.detail, /new names are allowed/);
  }
  const suffix = '\nconst loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: page } } } });';
  const incomplete = complete(authored('<h1 "%{content}" "%{co|"/>', suffix));
  const document = collect_part_source_facts(ts, incomplete.program).documents.find(doc => doc.producer.getText().includes('%{co"'))!;
  assert.equal(document.parameterCompleteness, "unknown"); assert.deepEqual(document.parameters, []);
  assert.deepEqual(document.parameterSpellings.map(parameter => parameter.name), ["content"]);
});

check("escaped coordinate text and CRLF map back to exact host edits", () => {
  const result = complete(authored(String.raw`<main title="\"escaped\""` + '\r\n  ' + String.raw`<hson-part lib="\u0063omponents" at="\u0068e|ading"/>` + '\r\n/>').replaceAll('\n', '\r\n').replaceAll('\r\r\n', '\r\n'));
  assert.deepEqual(result.labels, ["heading"]);
  assert.equal(applied(result, "heading"), result.text.replace('at="\\u0068eading"', 'at="heading"'));
  assert.equal(result.text.slice(result.entries[0]!.range.start, result.entries[0]!.range.end), '\\u0068eading');
});

check("nested authored templates select the inner site and preserve expression and template suffixes", () => {
  const result = complete(imports + 'const outer = Hson.document`<main ${Hson.document`<hson-part lib="components" at="he|"/>`} ${dynamic}/>`.trim();' + application);
  assert.equal(applied(result, "heading"), result.text.replace('at="he"', 'at="heading"'));
  const after = complete(authored('<main "${dynamic}" <hson-part lib="components" at="he|"/>/>'));
  assert.equal(applied(after, "heading"), after.text.replace('at="he"', 'at="heading"'));
  for (const body of ['<hson-part lib="components" at="he|${dynamic}"/>', '<hson-part lib="components" at="${dynamic}he|"/>', '<hson-part lib="${dynamic}" at="he|"/>']) {
    assert.deepEqual(complete(authored(body)).labels, [], body);
  }
});

check("unrelated markup, comments, expressions and unsupported placeholder placements do not leak", () => {
  for (const body of ['<main lib="co|"/>', '<main // lib="co|"\n/>', '<main "at=he|"/>', '<main ${dynamic /* he| */}/>', '<hson-part lib="components" at="heading" content="co|"/>']) assert.deepEqual(complete(authored(body)).labels, [], body);
  const member = '\nconst loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: page } } } });';
  for (const body of ['<h1 title="%{content}" onclick="%{co|}"/>', '<h1 title="%{content}" style="color:%{co|}"/>', '<script title="%{content}" "%{co|}"/>', '<main "%{content}" <style "%{co|}"/>/>']) assert.deepEqual(complete(authored(body, member)).labels, [], body);
  assert.deepEqual(complete(authored('<main "%{content}" "%{co|}"/>')).labels, [], "unrelated document is not a Part definition");
});

check("Program revisions, upstream-only edits, forget and clear invalidate facts without stale snapshots", () => {
  const result = complete(authored('<hson-part lib="components" at="|"/>'));
  const original = result.program;
  edit("parts.ts", parts.replace('heading:', 'hero:'));
  const next = service.getProgram()!; assert.notEqual(next, original);
  const entries = cache.complete(file("app.ts"), result.text, revision, result.offset, next);
  assert.deepEqual(entries.map(entry => entry.candidate.label), ["hero", "nav", "para", "title"]);
  assert.deepEqual(cache.complete(file("app.ts"), result.text + ' ', revision, result.offset, next), [], "mismatched Program text is rejected");
  cache.forget(file("app.ts")); assert.deepEqual(cache.complete(file("app.ts"), result.text, revision, result.offset, next), entries);
  cache.clear(); assert.deepEqual(cache.complete(file("app.ts"), result.text, revision, result.offset, next), entries);
  edit("parts.ts", parts);
});
check("structured arguments complete normalized names and proven selectors without inventing shape", () => {
  const definition = '{ x: {kind:"document", document:Hson.document`<p slide:data="%{payload}" title="%{slide.title}" "%{slide.items[0].label}"/>`} }';
  const app = (body: string) => imports + 'const loc = maps.fromLibraries({ components:{parts:' + definition + '}, page:{document:Hson.document`' + body + '`} });';
  assert.ok(complete(app('<hson-part lib="components" at="x" |/>')).labels.includes('data:payload'));
  assert.deepEqual(complete(app('<hson-part lib="components" at="x" payload="old" |/>')).labels, []);
  assert.deepEqual(complete(app('<hson-part lib="components" at="x" data:payload="null" |/>')).labels, []);
  const prefix = imports + 'const loc = maps.fromLibraries({components:{parts:{ x:{kind:"document", document:Hson.document`';
  const suffix = '`} }}});';
  const result = complete(prefix + '<p slide:data="%{payload}" title="%{slide.items[0].label}" "%{slide.it|}"/>' + suffix);
  assert.deepEqual(result.labels, ['slide.it', 'slide.items[0].label']);
  assert.ok(applied(result, 'slide.items[0].label').includes('"%{slide.items[0].label}"/>'));
  assert.deepEqual(complete(prefix + '<p slide:data="%{payload}" title="%{slide.title}" "%{slide.unknown|}"/>' + suffix).labels, ['slide.unknown']);
  assert.deepEqual(complete(prefix + '<p slide:data="%{payload}" title="%{slide.title}" <hson-part at="x" data:x="<text \\\"%{sl|}\\\" >"/>/>' + suffix).labels, []);
  const forwarded = complete(prefix + '<p slide:data="%{payload}" title="%{slide.items[0].label}" <hson-part at="child" data:payload="%{slide.it|}"/>/>' + suffix);
  assert.ok(forwarded.labels.includes('slide.items[0].label'));
  const bracket = complete(prefix + '<p slide:data="%{payload}" title=' + JSON.stringify('%{slide["odd}key"]}') + ' "%{slide[|}"/>' + suffix);
  assert.ok(bracket.labels.includes('slide["odd}key"]'));
  const repaired = applied(bracket, 'slide["odd}key"]');
  const markup = repaired.slice(repaired.indexOf('<p'), repaired.lastIndexOf('/>') + 2);
  assert.doesNotThrow(() => hson_grammar_checkpoint(markup, markup.length, "document"));
  assert.ok(repaired.includes(JSON.stringify('%{slide["odd}key"]}') + '/>'));
  const reference = '%{slide["odd}key"]}', body = '<p ' + JSON.stringify(reference) + '/>';
  const cursor = body.indexOf('key') + 3;
  const checkpoint = hson_grammar_checkpoint(body, cursor, "document");
  assert.equal(checkpoint?.kind, "parameter");
  assert.equal(checkpoint?.parameter?.prefix, 'slide["odd}key');
});
check("structured receiving declarations keep incoming and local completion namespaces separate", () => {
  const prefix = imports + 'const loc = maps.fromLibraries({components:{parts:{ x:{kind:"document", document:Hson.document`';
  const suffix = '`} }}});';
  const body = complete(prefix + '<p slide:data="%{payload}" title="%{slide.title}" "%{|}"/>' + suffix);
  assert.ok(body.labels.includes('slide'));
  assert.ok(body.labels.includes('slide.title'));
  assert.ok(!body.labels.includes('payload'));
  const declaration = complete(prefix + '<p slide:data="%{payload}" another:data="%{pay|}" "%{slide.title}"/>' + suffix);
  assert.ok(declaration.labels.includes('payload'));
  assert.ok(!declaration.labels.some(label => label.startsWith('slide')));
  assert.deepEqual(complete(prefix + '<p slide:data="%{payload}" <b nested:data="%{pay|}"/>/>' + suffix).labels, []);
  const forwarded = complete(prefix + '<p slide:data="%{payload}" <hson-part at="child" data:data="%{sl|}"/>/>' + suffix);
  assert.ok(forwarded.labels.includes('slide'));
  const whole = '{ x: {kind:"document", document:Hson.document`<p local:data="%{incoming}" "%{local}"/>`} }';
  const app = imports + 'const loc = maps.fromLibraries({components:{parts:' + whole + '},page:{document:Hson.document`<hson-part lib="components" at="x" |/>`}});';
  assert.deepEqual(complete(app).labels, ['data:incoming']);
});
check("optional flags complete only in governed Part headers and preserve argument suggestions", () => {
  for (const body of ['<p part:op|/>', '<p <b part:op|/>/>', '<p <hson-part at="leaf" part:op|/>/>']) {
    const result = complete(authored(body, memberApplication));
    assert.deepEqual(result.labels, ['part:optional']);
    assert.equal(applied(result, 'part:optional'), authored(body.replace('part:op|', 'part:optional'), memberApplication));
  }
  assert.deepEqual(complete(authored('<p part:op|/>')).labels, []);
  assert.deepEqual(complete(authored('<p part:optional part:op|/>', memberApplication)).labels, []);
  assert.deepEqual(complete(authored('<p part:optional="%{|}"/>', memberApplication)).labels, []);
  const result = complete(authored('<p <hson-part lib="components" at="heading" |/>/>', memberApplication));
  assert.ok(result.labels.includes('part:optional'));
});
service.dispose();
events.terminal("pass");
