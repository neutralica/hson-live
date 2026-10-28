import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { create_schema_language_service } from "../editors/vscode-hson/src/schema-language-service.ts";
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
  + 'heading: { kind: "document", document: Hson.document`<h1 hson:part title="%{Title-Case}" "%{content}"/>` },\n'
  + 'para: { kind: "document", document: Hson.document`<p hson:part "%{content}"/>` },\n'
  + 'title: { kind: "document", document: Hson.document`<h1 hson:part "%{content}"/>` },\n'
  + 'nav: { kind: "document", document: Hson.document`<nav hson:part title="%{prev}" "%{current} %{next}"/>` },\n'
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

check("qualified selectors complete Libraries, members and arguments with existing replacement ranges", () => {
  for (const [body, label, expected] of [
    ['<hson-part at="co|"/>', 'components/', '<hson-part at="components/"/>'],
    ['<hson-part at="co|mponents/title"/>', 'components/', '<hson-part at="components/title"/>'],
    ['<hson-part at="components/he|ading"/>', 'heading', '<hson-part at="components/heading"/>'],
    ['<hson-part at="components/|"/>', 'title', '<hson-part at="components/title"/>'],
    ['<hson-part at="components/heading" co|/>', 'content', '<hson-part at="components/heading" content/>'],
  ]) {
    const result = complete(authored(body!));
    assert.equal(applied(result, label!), authored(expected!));
  }
  assert.deepEqual(complete(authored('<hson-part at="components//|"/>')).labels, []);
  const unfinished = complete(authored('<hson-part at="components/he|'));
  assert.equal(applied(unfinished, 'heading'), authored('<hson-part at="components/heading"'));
  assert.equal(applied(complete(authored('<hson-part at="components/|')), 'title'), authored('<hson-part at="components/title"'));
});

check("Library completion preserves scanner-proven member suffixes without resolving dynamic targets", () => {
  const suffix = '\nconst loc=maps.fromLibraries({components:{parts:{...parts,list:{kind:"document",document:page}}}});';
  const body = (attribute: string) => '<main hson:part blocks:data="%{blocks}" <hson-part for:block="^{blocks}" '
    + attribute + ' data:block="^{block}"/>/>';
  for (const [marked, expected] of [
    ['at="co|mponents/^{block.kind}"', 'at="components/^{block.kind}"'],
    ['at="co|mponents/title"', 'at="components/title"'],
    ['at="co|mponents/ti"', 'at="components/ti"'],
    ['at="co|mponents/"', 'at="components/"'],
    ['at="components|/"', 'at="components/"'],
    ['at="co|"', 'at="components/"'],
    ['at=|"components/^{block.kind}"', 'at="components/^{block.kind}"'],
    [String.raw`at="co|mponents\u002f^{block.kind}"`, 'at="components/^{block.kind}"'],
    [String.raw`at="co|mponents/^{block[\"a/b\"]}"`, String.raw`at="components/^{block[\"a/b\"]}"`],
  ]) {
    const result = complete(authored(body(marked!), suffix));
    assert.equal(applied(result, 'components/'), authored(body(expected!), suffix));
    const definition = collect_part_source_facts(ts, result.program).documents.find(document => document.connectors.length > 0)!;
    const selection = definition.connectors[0]!.attributes.find(attribute => attribute.name === 'at');
    if (expected!.includes('^{')) assert.equal(selection?.value, undefined, 'preserved references never establish a static target');
  }
  for (const attribute of [
    'at="co|mponents/^{block.kind"', 'at="co|mponents/^{block..kind}"',
    'at="co|mponents/#{block.kind}"', 'at="co|mponents/${dynamic}"',
    'at="co|mponents/${dynamic"', 'at="co|mponents/${}"',
    'at="co|^{block.library}/title"', String.raw`at=|"^{block[\"a/b\"]}/title"`,
    String.raw`at="co|mponents/\q"`,
  ]) assert.deepEqual(complete(authored(body(attribute), suffix)).labels, [], attribute);
  assert.deepEqual(complete(authored('<hson-part at="co|mponents/^{block.kind')).labels, []);
});

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
  const fresh = '\nconst loc = maps.fromLibraries({ page: { document: page }, components: { parts: { heading: { kind: "document", document: Hson.document`<h1 hson:part "%{content}"/>` } } } });';
  const known = complete(authored('<hson-part lib="|"/>', fresh));
  assert.equal(known.entries[0]?.candidate.certainty, "certain");
  const alternatives = fresh.replace('document: page', 'document: condition ? page : dynamic');
  assert.ok(complete(authored('<hson-part lib="|"/>', alternatives)).entries.every(entry => entry.candidate.certainty === "possible"));
  const multiple = application + '\nconst other = maps.fromLibraries({ components: { parts: { extra: { kind: "document", document: "<p hson:part/>" } } } });';
  const possible = complete(authored('<hson-part lib="components" at="|"/>', multiple));
  assert.deepEqual(possible.labels, ["extra", "heading", "nav", "para", "title"]);
  assert.ok(possible.entries.every(entry => entry.candidate.certainty === "possible"));
  assert.deepEqual(complete(authored('<hson-part lib="|"/>', multiple)).labels, ["components"]);
});

check("partial collections offer grounded members and parameters while keeping unknown members unknown", () => {
  const partial = '\nconst loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Hson.document`<h1 hson:part "%{content}"/>` }, ...dynamic } } });';
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
    '\nconst loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Hson?.document`<p hson:part/>` } } } });',
    '\nconst loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Hson.canonical`<p/>` } } } });',
    '\nconst loc = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Hson.document`<p hson:part/><p/>` } } } });',
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
  const definition = '{ x: {kind:"document", document:Hson.document`<p hson:part slide:data="%{payload}" title="^{slide.title}" "^{slide.items[0].label}"/>`} }';
  const app = (body: string) => imports + 'const loc = maps.fromLibraries({ components:{parts:' + definition + '}, page:{document:Hson.document`' + body + '`} });';
  assert.ok(complete(app('<hson-part lib="components" at="x" |/>')).labels.includes('data:payload'));
  assert.deepEqual(complete(app('<hson-part lib="components" at="x" payload="old" |/>')).labels, []);
  assert.deepEqual(complete(app('<hson-part lib="components" at="x" data:payload="null" |/>')).labels, []);
  const prefix = imports + 'const loc = maps.fromLibraries({components:{parts:{ x:{kind:"document", document:Hson.document`';
  const suffix = '`} }}});';
  const result = complete(prefix + '<p slide:data="%{payload}" title="^{slide.items[0].label}" "^{slide.it|}"/>' + suffix);
  assert.deepEqual(result.labels, ['slide.it', 'slide.items[0].label']);
  assert.ok(applied(result, 'slide.items[0].label').includes('"^{slide.items[0].label}"/>'));
  assert.deepEqual(complete(prefix + '<p slide:data="%{payload}" title="^{slide.title}" "^{slide.unknown|}"/>' + suffix).labels, ['slide.unknown']);
  assert.deepEqual(complete(prefix + '<p slide:data="%{payload}" title="^{slide.title}" <hson-part at="x" data:x="<text \\\"%{sl|}\\\" >"/>/>' + suffix).labels, []);
  const forwarded = complete(prefix + '<p slide:data="%{payload}" title="^{slide.items[0].label}" <hson-part at="child" data:payload="^{slide.it|}"/>/>' + suffix);
  assert.ok(forwarded.labels.includes('slide.items[0].label'));
  const bracket = complete(prefix + '<p slide:data="%{payload}" title=' + JSON.stringify('^{slide["odd}key"]}') + ' "^{slide[|}"/>' + suffix);
  assert.ok(bracket.labels.includes('slide["odd}key"]'));
  const repaired = applied(bracket, 'slide["odd}key"]');
  const markup = repaired.slice(repaired.indexOf('<p'), repaired.lastIndexOf('/>') + 2);
  assert.doesNotThrow(() => hson_grammar_checkpoint(markup, markup.length, "document"));
  assert.ok(repaired.includes(JSON.stringify('^{slide["odd}key"]}') + '/>'));
  const reference = '^{slide["odd}key"]}', body = '<p ' + JSON.stringify(reference) + '/>';
  const cursor = body.indexOf('key') + 3;
  const checkpoint = hson_grammar_checkpoint(body, cursor, "document");
  assert.equal(checkpoint?.kind, "parameter");
  assert.equal(checkpoint?.parameter?.prefix, 'slide["odd}key');
});
check("structured receiving declarations keep incoming and local completion namespaces separate", () => {
  const prefix = imports + 'const loc = maps.fromLibraries({components:{parts:{ x:{kind:"document", document:Hson.document`';
  const suffix = '`} }}});';
  const body = complete(prefix + '<p slide:data="%{payload}" title="^{slide.title}" "^{|}"/>' + suffix);
  assert.ok(body.labels.includes('slide'));
  assert.ok(body.labels.includes('slide.title'));
  assert.ok(!body.labels.includes('payload'));
  const declaration = complete(prefix + '<p slide:data="%{payload}" another:data="%{pay|}" "^{slide.title}"/>' + suffix);
  assert.ok(declaration.labels.includes('payload'));
  assert.ok(!declaration.labels.some(label => label.startsWith('slide')));
  assert.deepEqual(complete(prefix + '<p slide:data="%{payload}" <b nested:data="%{pay|}"/>/>' + suffix).labels, []);
  const forwarded = complete(prefix + '<p slide:data="%{payload}" <hson-part at="child" data:data="^{sl|}"/>/>' + suffix);
  assert.ok(forwarded.labels.includes('slide'));
  const whole = '{ x: {kind:"document", document:Hson.document`<p hson:part local:data="%{incoming}" "^{local}"/>`} }';
  const app = imports + 'const loc = maps.fromLibraries({components:{parts:' + whole + '},page:{document:Hson.document`<hson-part lib="components" at="x" |/>`}});';
  assert.deepEqual(complete(app).labels, ['data:incoming']);
});
check("Part declaration completes only at a known definition root", () => {
  const result = complete(authored('<button hson:pa|/>', memberApplication));
  assert.deepEqual(result.labels, ['hson:part']);
  assert.equal(applied(result, 'hson:part'), authored('<button hson:part/>', memberApplication));
  for (const body of ['<button hson:part hson:pa|/>', '<main <b hson:pa|/>/>',
    '<hson-part hson:pa|/>', '<main hson:part="hson:pa|"/>']) {
    assert.deepEqual(complete(authored(body, memberApplication)).labels, []);
  }
  assert.deepEqual(complete(authored('<button hson:pa|/>')).labels, []);
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
check("local Document references complete in structural frames and prefix-free write records", () => {
  const prefix = imports + 'const loc=maps.fromLibraries({components:{parts:{x:{kind:"document",document:Hson.document`';
  const suffix = '`}}}});';
  const structural = complete(prefix + '<main c:doc="%{control}" d:data="%{payload}" <hson-part ^{|}/>/>' + suffix);
  assert.deepEqual(structural.labels, ['c']);
  assert.ok(applied(structural, 'c').includes('<hson-part ^{c}/>'));
  const unfinished = complete(prefix + '<main c:doc="%{control}" <hson-part ^{c|' + suffix);
  assert.deepEqual(unfinished.labels, ['c']);
  assert.ok(applied(unfinished, 'c').includes('^{c}'));
  const locals = complete(prefix + '<main c:doc="%{control}" title="^{|}" <hson-part ^{c}/>/>' + suffix);
  assert.ok(locals.labels.includes('c')); assert.ok(!locals.labels.includes('control'));
  const incoming = complete(prefix + '<main c:doc="%{control}" class="%{title}" title="%{|}" <hson-part ^{c}/>/>' + suffix);
  assert.ok(incoming.labels.includes('title')); assert.ok(!incoming.labels.includes('c')); assert.ok(!incoming.labels.includes('control'));
  assert.deepEqual(complete(prefix + '<main c:doc="%{control}" <hson-part lib="components" at="x" ^{c|}/>/>' + suffix).labels, []);
  assert.deepEqual(complete(prefix + '<main c:doc="%{control}" <hson-part^{c|}/>/>' + suffix).labels, []);
  assert.deepEqual(complete(prefix + '<main c:doc="%{control}" <hson-part at="y" data:value="^{c|}"/>/>' + suffix).labels, []);
  assert.deepEqual(complete(prefix + '<main d:data="%{payload}" <hson-part at="y" doc:value="^{d|}"/>/>' + suffix).labels, []);
  const app = imports + 'const loc=maps.fromLibraries({components:{parts:{x:{kind:"document",document:Hson.document`<p hson:part d:data="%{payload}" c:doc="%{control}" title="%{title}" "^{d.label}" <hson-part ^{c}/>/ >`}}}});';
  const record = complete(app.replace('/ >', '/>') + 'const components=loc.parts.components;components.x.write({ tit| });');
  assert.deepEqual(record.labels, ['title']);
  assert.equal(record.entries[0]!.candidate.certainty, 'possible');
});
check("Data paths use observed authored input shapes and withhold unknown properties", () => {
  const prefix = imports + 'const loc=maps.fromLibraries({components:{parts:{x:{kind:"document",document:Hson.document`';
  const suffix = '`}}},page:{document:Hson.document`<hson-part lib="components" at="x" data:payload="<title 0 items «<label false>» odd true>"/>`}});';
  const shape = complete(prefix + '<p d:data="%{payload}" "^{d.|}"/>' + suffix);
  assert.ok(shape.labels.includes('d.title'));
  assert.ok(shape.labels.includes('d.items[0].label'));
  const dynamic = complete(prefix + '<p d:data="%{payload}" "^{d.|}"/>' + suffix.replace('<title 0 items «<label false>» odd true>', '${dynamic}'));
  assert.deepEqual(dynamic.labels, []);
  const bare = complete(prefix + '<main c:doc="%{control}" <hson-part |/>/>' + '`}}}});');
  assert.ok(bare.labels.includes('^{c}'));
});
check("write key edits preserve JavaScript names, values, quotes, ranges and cursors", () => {
  const prefix = imports + 'const loc=maps.fromLibraries({components:{parts:{page:{kind:"document",document:Hson.document`<p hson:part "%{Title-Case}:%{title}:%{default}:%{await}"/>`}}}});loc.parts.components.page.write({ ';
  for (const [input, label, expected, replaced] of [
    ['Tit|', 'Title-Case', '"Title-Case": "|"', 'Tit'],
    ['|', 'Title-Case', '"Title-Case": "|"', ''],
    ['Tit|leOld: "kept"', 'Title-Case', '"Title-Case"|: "kept"', 'TitleOld'],
    ['"Tit|leOld": "kept"', 'Title-Case', '"Title-Case|": "kept"', 'TitleOld'],
    ["'Tit|leOld': \"kept\"", 'Title-Case', "'Title-Case|': \"kept\"", 'TitleOld'],
    [String.raw`"\u0054it|": "kept"`, 'Title-Case', '"Title-Case|": "kept"', String.raw`\u0054it`],
    [String.raw`'Title\x2dC|': "kept"`, 'Title-Case', "'Title-Case|': \"kept\"", String.raw`Title\x2dC`],
    [String.raw`\u0054it|: "kept"`, 'Title-Case', '"Title-Case"|: "kept"', String.raw`\u0054it`],
    ['tit|', 'title', 'title|', 'tit'],
    ['"tit|": "kept"', 'title', '"title|": "kept"', 'tit'],
    ['def|', 'default', '"default": "|"', 'def'],
    ['aw|', 'await', '"await": "|"', 'aw'],
  ]) {
    const result = complete(prefix + input + ' });');
    const entry = result.entries.find(entry => entry.candidate.label === label); assert.ok(entry, input);
    assert.equal(result.text.slice(entry.range.start, entry.range.end), replaced, input);
    const marker = entry.candidate.insertText.indexOf('$0');
    const insertion = entry.isSnippet ? entry.candidate.insertText.replace('$0', '') : entry.candidate.insertText;
    const output = result.text.slice(0, entry.range.start) + insertion + result.text.slice(entry.range.end);
    const expectedText = prefix + expected.replace('|', '') + ' });';
    assert.equal(output, expectedText, input);
    assert.equal(entry.range.start + (entry.isSnippet ? marker : insertion.length), prefix.length + expected.indexOf('|'), input);
    edit('app.ts', output);
    assert.deepEqual(service.getSyntacticDiagnostics(file('app.ts')), [], input);
  }
  for (const input of [String.raw`"\u00|54it": "kept"`, 'title: "va|lue"', '[dynamic]: "kept", |']) {
    assert.deepEqual(complete(prefix + input + ' });').labels, [], input);
  }
  // An already quoted key without a colon remains an intentionally unfinished
  // property: complete only its interior, then let ordinary value entry finish it.
  const unfinished = complete(prefix + '"Tit|" });');
  const completed = applied(unfinished, 'Title-Case');
  assert.equal(completed, prefix + '"Title-Case" });');
  edit('app.ts', completed.replace('"Title-Case" });', '"Title-Case": "" });'));
  assert.deepEqual(service.getSyntacticDiagnostics(file('app.ts')), []);
});
check("write keys exclude methods and accessors without editing neighboring members", () => {
  const prefix = imports + 'const loc=maps.fromLibraries({components:{parts:{page:{kind:"document",document:Hson.document`<p hson:part "%{Title-Case} %{title}"/>`}}}});loc.parts.components.page.write({ ';
  for (const input of [
    'Tit|() { return "kept"; }', 'get Tit|() { return "kept"; }', 'set Tit|(value: string) { void value; }',
    '"Tit|"() { return "kept"; }', 'get "Tit|"() { return "kept"; }', "set 'Tit|'(value: string) { void value; }",
    'async Tit|<T>(value: T) { return value; }', '*Tit|() { yield "kept"; }', 'tit|() {}',
    'title: "kept", Tit|() {}, tail: 1', 'before() {}, get Tit|() { return "kept"; }, tail: 1',
  ]) {
    const result = complete(prefix + input + ' });');
    assert.deepEqual(result.labels, [], input);
    assert.equal(result.text, prefix + input.replace('|', '') + ' });');
    assert.deepEqual(service.getSyntacticDiagnostics(file('app.ts')), [], input);
  }
  for (const input of ['Tit|(', 'get Tit|(', 'set "Tit|"(', 'async Tit|<', 'title: |', 'before() {} |', '/* Tit| */', '// Tit|\n', 'Tit|:']) {
    const result = complete(prefix + input + ' });');
    if (input === 'Tit|:') {
      const entry = result.entries.find(entry => entry.candidate.label === 'Title-Case'); assert.ok(entry);
      assert.equal(entry.candidate.insertText, '"Title-Case"'); assert.equal(entry.isSnippet, undefined);
      assert.equal(applied(result, 'Title-Case'), prefix + '"Title-Case": });');
      edit('app.ts', applied(result, 'Title-Case').replace(': });', ': "finished" });'));
      assert.deepEqual(service.getSyntacticDiagnostics(file('app.ts')), []);
    } else assert.deepEqual(result.labels, [], input);
  }
  for (const [input, label, expected] of [
    ['before() { return 1; }, Tit|leOld: (1 satisfies number), get after() { return "kept"; }', 'Title-Case', 'before() { return 1; }, "Title-Case"|: (1 satisfies number), get after() { return "kept"; }'],
    ['before() {}, "Tit|leOld": "kept", set after(value: string) { void value; }', 'Title-Case', 'before() {}, "Title-Case|": "kept", set after(value: string) { void value; }'],
    [String.raw`get before() { return 1; }, '\u0054it|': "kept", tail: 1`, 'Title-Case', 'get before() { return 1; }, \'Title-Case|\': "kept", tail: 1'],
    ['before() {}, Tit|, tail: 1', 'Title-Case', 'before() {}, "Title-Case": "|", tail: 1'],
    ['before() {}, tit|, tail: 1', 'title', 'before() {}, title|, tail: 1'],
    ['before() {}, /* keep */ |, tail: 1', 'Title-Case', 'before() {}, /* keep */ "Title-Case": "|", tail: 1'],
  ]) {
    const result = complete(prefix + input + ' });');
    const entry = result.entries.find(entry => entry.candidate.label === label); assert.ok(entry, input);
    const insertion = entry.isSnippet ? entry.candidate.insertText.replace('$0', '') : entry.candidate.insertText;
    const output = result.text.slice(0, entry.range.start) + insertion + result.text.slice(entry.range.end);
    assert.equal(output, prefix + expected.replace('|', '') + ' });', input);
    assert.equal(entry.range.start + (entry.isSnippet ? entry.candidate.insertText.indexOf('$0') : insertion.length), prefix.length + expected.indexOf('|'), input);
    edit('app.ts', output); assert.deepEqual(service.getSyntacticDiagnostics(file('app.ts')), [], input);
  }
});
check("write key contexts reject recovered punctuation and modifiers", () => {
  const prefix = imports + 'const loc=maps.fromLibraries({components:{parts:{page:{kind:"document",document:Hson.document`<p hson:part "%{Title-Case} %{title}"/>`}}}});loc.parts.components.page.write({ ';
  for (const input of [
    'Tit|?', 'Tit|!', 'Tit| = "kept"', 'Tit| =', 'Tit|?: "kept"', 'Tit|!: "kept"',
    '"Tit|"?', "'Tit|'!: 1", 'readonly Tit|', 'public Tit|: 1', 'async Tit|',
    'Tit|.', 'Tit|=>', 'Tit| as string', 'Tit| satisfies string',
  ]) {
    const result = complete(prefix + input + ' });');
    assert.deepEqual(result.labels, [], input);
    assert.equal(result.text, prefix + input.replace('|', '') + ' });');
  }
  for (const [input, expected, finish] of [
    ['Tit|: /* keep */', '"Title-Case"|: /* keep */', ' 1'],
    ['"Tit|"', '"Title-Case|"', ': 1'],
    ['/** keep */ Tit|, tail: 1', '/** keep */ "Title-Case": "|", tail: 1', ''],
    ['Tit|leOld: condition ? "one" : "two", tail: dynamic!', '"Title-Case"|: condition ? "one" : "two", tail: dynamic!', ''],
    ['tit|: dynamic!, tail: "kept"', 'title|: dynamic!, tail: "kept"', ''],
  ]) {
    const result = complete(prefix + input + ' });');
    const label = input.startsWith('tit') ? 'title' : 'Title-Case';
    const entry = result.entries.find(entry => entry.candidate.label === label); assert.ok(entry, input);
    const insertion = entry.isSnippet ? entry.candidate.insertText.replace('$0', '') : entry.candidate.insertText;
    const output = result.text.slice(0, entry.range.start) + insertion + result.text.slice(entry.range.end);
    assert.equal(output, prefix + expected.replace('|', '') + ' });', input);
    assert.equal(entry.range.start + (entry.isSnippet ? entry.candidate.insertText.indexOf('$0') : insertion.length), prefix.length + expected.indexOf('|'), input);
    edit('app.ts', output.slice(0, -4) + finish + ' });');
    assert.deepEqual(service.getSyntacticDiagnostics(file('app.ts')), [], input);
  }
});
check("TypeScript language service publishes prefix-free write key evidence", () => {
  const marked = imports + 'const loc=maps.fromLibraries({components:{parts:{x:{kind:"document",document:Hson.document`<p hson:part "%{label}"/>`}}}});loc.parts.components.x.write({ lab| });';
  const offset = marked.indexOf('|'); edit('app.ts', marked.replace('|',''));
  const integrated = create_schema_language_service(ts, ts.createLanguageService(host), host, join(directory, 'tsconfig.json'));
  try {
    const result = integrated.getCompletionsAtPosition(file('app.ts'), offset, {});
    const label = result?.entries.find(entry => entry.name === 'label');
    assert.ok(label); assert.equal(label.insertText, 'label');
  } finally { integrated.dispose(); }
});
check("TypeScript write completion applies quoted assignments with and without snippet support", () => {
  const marked = imports + 'const loc=maps.fromLibraries({components:{parts:{x:{kind:"document",document:Hson.document`<p hson:part "%{Title-Case}"/>`}}}});loc.parts.components.x.write({ Tit| });';
  const offset = marked.indexOf('|'); edit('app.ts', marked.replace('|', ''));
  const integrated = create_schema_language_service(ts, ts.createLanguageService(host), host, join(directory, 'tsconfig.json'));
  try {
    for (const snippets of [true, false]) {
      const entry = integrated.getCompletionsAtPosition(file('app.ts'), offset, { includeCompletionsWithSnippetText: snippets })?.entries.find(entry => entry.name === 'Title-Case');
      assert.ok(entry?.replacementSpan); assert.ok(entry.insertText);
      assert.equal(entry.isSnippet === true, snippets);
      const insertion = snippets ? entry.insertText.replace('$0', '') : entry.insertText;
      const output = marked.replace('|', '').slice(0, entry.replacementSpan.start) + insertion
        + marked.replace('|', '').slice(entry.replacementSpan.start + entry.replacementSpan.length);
      assert.ok(output.endsWith('write({ "Title-Case": "" });'));
      edit('applied.ts', output);
      assert.deepEqual(service.getSyntacticDiagnostics(file('applied.ts')), []);
    }
  } finally { integrated.dispose(); }
});
check("iterator bindings complete at their lexical scope, with source-before-shadow and recovery", () => {
  const prefix = '<ul hson:part items:data="%{items}" <li for:item:i="^{items}" ';
  assert.deepEqual(complete(authored(prefix + '"^{|}"/>/>', memberApplication)).labels, ['i', 'item', 'items']);
  assert.deepEqual(complete(authored(prefix + '/> <b "^{|}"/>/>', memberApplication)).labels, ['items']);
  assert.deepEqual(complete(authored(prefix + '<b for:item:j="^{it|}" "^{item}"/>/>/>', memberApplication)).labels, ['item', 'items']);
  assert.deepEqual(complete(authored(prefix + '<b for:item:j="^{item.children}" "^{|}"/>/>/>', memberApplication)).labels, ['i', 'item', 'items', 'j']);
  assert.deepEqual(complete(authored('<ul hson:part items:data="%{items}" <li for::items="^{it|}" "^{items}"/>/>', memberApplication)).labels, ['items']);
  assert.deepEqual(complete(authored('<ul hson:part items:data="%{items}" <li for::items="^{items}" <b for:next="^{it|}"/>/>/>', memberApplication)).labels, []);
  assert.deepEqual(complete(authored(prefix + '<b "^{item.title}"/> "^{item.|}"/>/>', memberApplication)).labels, ['item.title']);
  assert.deepEqual(complete(authored(prefix + '<b for:item="^{item.children}" "^{item.|}"/> "^{item.title}"/>/>', memberApplication)).labels, []);
  assert.deepEqual(complete(authored('<ul hson:part items:data="%{items}" <li for:data:doc="^{items}" "^{|}"/>/>', memberApplication)).labels, ['data', 'doc', 'items']);
  // An unfinished edit must not cache the old binding, and the repaired source recovers.
  assert.deepEqual(complete(authored('<ul hson:part items:data="%{items}" <li for:new="^{items}" "^{|', memberApplication)).labels, ['items', 'new']);
  const repaired = complete(authored('<ul hson:part items:data="%{items}" <li for:new="^{items}" "^{|}"/>/>', memberApplication));
  assert.deepEqual(repaired.labels, ['items', 'new']);
  const fact = collect_part_source_facts(ts, repaired.program).documents.find(doc => doc.iteratorDeclarations.length)!;
  assert.equal(fact.iteratorDeclarations[0]!.declaration!.value, 'new');
  const span = fact.iteratorDeclarations[0]!.location;
  assert.equal(repaired.text.slice(span.start, span.end), 'for:new');
});
check("iterator element suggestions reuse literal Data and Schema provenance without inventing a Part contract", () => {
  const definition = (body: string) => 'components:{parts:{list:{kind:"document",document:Hson.document`' + body + '`}}}';
  const body = '<ul hson:part items:data="%{items}" <li for:item="^{items}" "^{item.|}"/>/>';
  const literal = complete(imports + 'const loc=maps.fromLibraries({' + definition(body)
    + ',page:{document:Hson.document`<hson-part lib="components" at="list" data:items="«<title \\\"first\\\">»"/>`}});');
  assert.ok(literal.labels.includes('item.title'));
  const schema = 'import type { HsonData } from "hson-live";\nconst Blocks = Hson.schema`<type "data" defs <Rows <array <content <title "string" children <array <content <caption "string">>>>>>> content <ref "Rows">>`;\n'
    + 'const blocks: HsonData<typeof Blocks> = Hson.data`«»`;\n';
  const application = (body: string, input = '${blocks}') => imports + schema + 'const loc=maps.fromLibraries({' + definition(body)
    + ',page:{document:Hson.document`<hson-part lib="components" at="list" data:items="' + input + '"/>`}});';
  const result = complete(application(body));
  assert.deepEqual(result.labels, ['item.children', 'item.title']);
  assert.ok(result.entries.every(entry => entry.candidate.certainty === 'possible'));
  const nested = '<ul hson:part items:data="%{items}" <li for:item="^{items}" <b for:item="^{item.children}" "^{item.|}"/>/>/>';
  assert.deepEqual(complete(application(nested)).labels, ['item.caption']);
  assert.deepEqual(complete(application(body, '${dynamic}')).labels, []);
  assert.deepEqual(complete(application(body, 'prefix ${blocks}')).labels, []);
  assert.deepEqual(complete(application(body).replace('HsonData<typeof Blocks>', 'HsonData')).labels, []);
  const repaired = complete(application(body).replace('title "string"', 'name "string"'));
  assert.deepEqual(repaired.labels, ['item.children', 'item.name']);
});
check('quoted interpolation preserves lexical iteration evidence without proving dynamic values', () => {
  const prefix = '<ul hson:part class="${dynamic}" items:data="%{items}" <li for:item:i="^{items}" ';
  assert.deepEqual(complete(authored(prefix + '"^{|}"/>/>', memberApplication)).labels, ['i', 'item', 'items']);
  assert.deepEqual(complete(authored(prefix + '<b for:item:j="^{item.children}" "^{|}"/>/>/>', memberApplication)).labels, ['i', 'item', 'items', 'j']);
  assert.deepEqual(complete(authored(prefix + '<b for:item:j="^{it|}"/>/>/>', memberApplication)).labels, ['item', 'items']);
  assert.deepEqual(complete(authored(prefix + '/> <b "^{|}"/>/>', memberApplication)).labels, ['items']);
  const incomplete = complete(authored(prefix + '"^{|', memberApplication));
  assert.deepEqual(incomplete.labels, ['i', 'item', 'items']);
  const repaired = complete(authored(prefix.replace('for:item:i', 'for:new:j') + '"^{|}"/>/>', memberApplication));
  assert.deepEqual(repaired.labels, ['items', 'j', 'new']);
  const facts = collect_part_source_facts(ts, repaired.program).documents.find(document => document.iteratorDeclarations.length)!;
  assert.equal(facts.parameterCompleteness, 'unknown');
  assert.equal(facts.admission, 'unknown');
  for (const dynamic of ['${dynamic}', 'class="x" ${dynamic}', 'items:data="${dynamic}"', 'for:item="${dynamic}"']) {
    const body = dynamic.startsWith('for:') ? `<ul hson:part items:data="%{items}" <li ${dynamic} "^{|}"/>/>`
      : `<ul hson:part ${dynamic} <li for:item="^{items}" "^{|}"/>/>`;
    assert.ok(!complete(authored(body, memberApplication)).labels.includes('item'), body);
  }
});
check('interpolated Part completion refreshes imported Schema evidence with unchanged consumer text', () => {
  const schema = (name: string) => 'import { Hson } from "hson-live"; export const Rows = Hson.schema`<type "data" defs <Rows <array <content <' + name + ' "string">>>> content <ref "Rows">>`;';
  edit('iterator-schema.ts', schema('title'));
  const source = imports + 'import type { HsonData } from "hson-live"; import { Rows } from "./iterator-schema.js";'
    + 'const rows: HsonData<typeof Rows> = Hson.data`«»`; const map = maps.fromLibraries({ components: { parts: { list: { kind: "document", document: Hson.document`'
    + '<ul hson:part class="${dynamic}" items:data="%{items}" <li for:item="^{items}" "^{item.|}"/>/>`'
    + '} } }, page: { document: Hson.document`<hson-part lib="components" at="list" data:items="${rows}"/>` } });';
  const original = complete(source);
  assert.deepEqual(original.labels, ['item.title']);
  edit('iterator-schema.ts', schema('name'));
  const next = service.getProgram()!;
  assert.notEqual(next, original.program);
  const entries = cache.complete(file('app.ts'), original.text, revision, original.offset, next);
  assert.deepEqual(entries.map(entry => entry.candidate.label), ['item.name']);
  assert.ok(entries.every(entry => entry.candidate.certainty === 'possible'));
});
check("object iterator bindings share scope, source-before-shadow and edit recovery", () => {
  const prefix = '<ul hson:part items:data="%{items}" <li per:key:value="^{items}" ';
  for (const decoration of ['', 'class="${dynamic}" ']) {
    const body = prefix.replace('<ul hson:part ', '<ul hson:part ' + decoration);
    assert.deepEqual(complete(authored(body + '"^{|}"/>/>', memberApplication)).labels, ['items', 'key', 'value']);
    assert.deepEqual(complete(authored(body + '/> <b "^{|}"/>/>', memberApplication)).labels, ['items']);
    assert.deepEqual(complete(authored(body + '<b per:value:next="^{va|}"/>/>/>', memberApplication)).labels, ['value']);
    assert.deepEqual(complete(authored(body + '<b for:value:i="^{value.children}" "^{|}"/>/>/>', memberApplication)).labels, ['i', 'items', 'key', 'value']);
    assert.deepEqual(complete(authored(body + '"^{|', memberApplication)).labels, ['items', 'key', 'value']);
  }
  assert.deepEqual(complete(authored(prefix.replace('per:key:value', 'per:key') + '"^{|}"/>/>', memberApplication)).labels, ['items', 'key']);
  assert.deepEqual(complete(authored(prefix.replace('per:key:value', 'per::value') + '"^{|}"/>/>', memberApplication)).labels, ['items', 'value']);
  assert.deepEqual(complete(authored(prefix.replace('per:key:value', 'per:data:doc') + '"^{|}"/>/>', memberApplication)).labels, ['data', 'doc', 'items']);
  assert.deepEqual(complete(authored(prefix + '"^{key.|}"/>/>', memberApplication)).labels, []);
  const repaired = complete(authored(prefix.replace('per:key:value', 'per:new:record') + '"^{|}"/>/>', memberApplication));
  assert.deepEqual(repaired.labels, ['items', 'new', 'record']);
  const fact = collect_part_source_facts(ts, repaired.program).documents.find(doc => doc.iteratorDeclarations.length)!;
  const iterator = fact.iteratorDeclarations[0]!;
  assert.equal(iterator.declaration!.kind, 'object'); assert.equal(iterator.declaration!.key, 'new'); assert.equal(iterator.declaration!.value, 'record');
  assert.equal(repaired.text.slice(iterator.location.start, iterator.location.end), 'per:new:record');
});
check("object iterator property evidence preserves keys and conservative heterogeneous alternatives", () => {
  const definition = (body: string) => 'components:{parts:{list:{kind:"document",document:Hson.document`' + body + '`}}}';
  const body = '<ul hson:part items:data="%{items}" <li per:name:record="^{items}" "^{record.|}"/>/>';
  const literal = complete(imports + 'const loc=maps.fromLibraries({' + definition(body)
    + ',page:{document:Hson.document`<hson-part lib="components" at="list" data:items="<first <title \\\"a\\\" key \\\"real\\\">>"/>`}});');
  assert.deepEqual(literal.labels, ['record.key', 'record.title']);
  const application = (body: string, shape: string, input = '${records}') => imports
    + 'import type { HsonData } from "hson-live"; const Records=Hson.schema`<type "data" content ' + shape + '>`;'
    + 'const records: HsonData<typeof Records> = Hson.data`<>`; const loc=maps.fromLibraries({' + definition(body)
    + ',page:{document:Hson.document`<hson-part lib="components" at="list" data:items="' + input + '"/>`}});';
  const shape = '<first <content <title "string" count "number" children <array <content <caption "string">>>>> second <content <title "string" active "boolean" children <array <content <caption "string">>>>>>';
  const result = complete(application(body, shape));
  assert.deepEqual(result.labels, ['record.children', 'record.title']);
  assert.ok(result.entries.every(entry => entry.candidate.certainty === 'possible'));
  assert.deepEqual(complete(application(body.replace('^{record.|}', '^{items.|}'), shape)).labels,
    ['items.first', 'items.first.children', 'items.first.count', 'items.first.title', 'items.second', 'items.second.active', 'items.second.children', 'items.second.title']);
  assert.deepEqual(complete(application(body.replace('^{record.|}', '^{record.children[0].|}'), shape)).labels, ['record.children[0].caption']);
  const nested = '<ul hson:part items:data="%{items}" <li per:name:record="^{items}" <b for:record="^{record.children}" "^{record.|}"/>/>/>';
  assert.deepEqual(complete(application(nested, shape)).labels, ['record.caption']);
  assert.deepEqual(complete(application(body, '<first <content <title "string">> second "number">')).labels, []);
  assert.deepEqual(complete(application(body, shape, '${dynamic}')).labels, []);
  assert.deepEqual(complete(application(body, shape.replaceAll('title "string"', 'name "string"'))).labels, ['record.children', 'record.name']);
});
check("qualified selection retains for/per reference scopes and literal input provenance", () => {
  const suffix = '\nconst loc=maps.fromLibraries({components:{parts:{x:{kind:"document",document:page}}}});';
  for (const iterator of ['for:block', 'per:key:block']) {
    const body = `<main hson:part blocks:data="%{blocks}" <hson-part ${iterator}="^{blocks}" at="components/^{bl|}" data:block="^{block}"/>/>`;
    const result = complete(authored(body, suffix));
    assert.deepEqual(result.labels, ['block', 'blocks']);
    assert.ok(applied(result, 'block').includes('at="components/^{block}"'));
  }
  const prefix = imports + 'const loc=maps.fromLibraries({components:{parts:{x:{kind:"document",document:Hson.document`';
  const invocation = '`}}},page:{document:Hson.document`<hson-part at="components/x" data:payload="<title 0>"/>`}});';
  assert.deepEqual(complete(prefix + '<p hson:part d:data="%{payload}" "^{d.|}"/>' + invocation).labels, ['d.title']);
});
check("old hash spelling never gains local-reference completion or recovery", () => {
  const suffix = '\nconst loc=maps.fromLibraries({components:{parts:{x:{kind:"document",document:page}}}});';
  const prefix = imports + 'const page=Hson.document`';
  for (const body of ['<p hson:part d:data="%{payload}" "#{d.|}"/>',
    '<main hson:part c:doc="%{control}" <hson-part #{c|}/>/>' ]) {
    assert.deepEqual(complete(prefix + body + '`;' + suffix).labels, []);
  }
});
check("optional references preserve markers through complete and incomplete edits", () => {
  const suffix = '\nconst loc=maps.fromLibraries({components:{parts:{x:{kind:"document",document:page}}}});';
  for (const [body, expected] of [
    ['<p hson:part "%{content?}" "%{co|?}"/>', '<p hson:part "%{content?}" "%{content?}"/>'],
    ['<p hson:part "%{content?}" "%{co?|}"/>', '<p hson:part "%{content?}" "%{content?}"/>'],
    ['<p hson:part "%{content?}" "%{co|?"/>', '<p hson:part "%{content?}" "%{content?}"/>'],
    ['<p hson:part d:data="%{payload?}" "^{d.title?}" "^{d.ti|?}"/>', '<p hson:part d:data="%{payload?}" "^{d.title?}" "^{d.title?}"/>'],
    ['<main hson:part control:doc="%{content?}" <hson-part ^{con|?}/>/>' , '<main hson:part control:doc="%{content?}" <hson-part ^{control?}/>/>' ],
    ['<main hson:part control:doc="%{content?}" <hson-part ^{con|?', '<main hson:part control:doc="%{content?}" <hson-part ^{control?}'],
  ]) {
    const label = body!.includes('^{d.ti|') ? 'd.title' : body!.includes('^{con|') ? 'control' : 'content';
    const result = complete(authored(body!, suffix));
    assert.ok(result.labels.includes(label), body);
    assert.ok(result.labels.every(name => !name.endsWith('?')), 'optionality is syntax, not part of a parameter name');
    assert.equal(applied(result, label), authored(expected!, suffix));
  }
});
service.dispose();
events.terminal("pass");
