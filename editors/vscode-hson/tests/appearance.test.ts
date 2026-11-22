import { Hson } from "../../../src/hson-authoring.js";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { load_hson_grammar } from "../src/highlighting.js";
import { initialAppearance, readAppearance, housePalette, duplicatePalette, deletePalette, resolveStyle, blend, roleCatalog } from "../src/appearance-model.js";
import { AppearanceSpanCache, appearanceColor, type AppearanceRole } from "../src/appearance-spans.js";
import { HsonBindingCache } from "../src/binding-intelligence.js";
import { event_source_imports } from "../src/event-source-evidence.js";
import { discover_typescript_projects } from "../src/typescript-project-discovery.js";

async function run() {
  const grammar = await load_hson_grammar(resolve(__dirname, ".."));
  const cache = new AppearanceSpanCache();
  const eventText = 'import { Hson } from "hson-live"; Hson.event`<div/>`; Hson.document`<aside/>`;';
  const eventDocument = { uri: "/event.ts", fileName: "/event.ts", languageId: "typescript", version: 1, text: eventText };
  const official = new Set([eventText.indexOf("Hson")]);
  let imports = official;
  const bindings = new HsonBindingCache(() => imports);
  const appearance = new AppearanceSpanCache(bindings);
  const initial = appearance.get(grammar, eventDocument);
  const bodySpans = (spans: typeof initial, start: number, length: number) =>
    spans.filter(span => start <= span.range.start && span.range.end <= start + length);
  const eventStart = eventText.indexOf("<div/>"), adjacent = eventText.indexOf("<aside/>");
  assert.equal(bodySpans(initial, eventStart, 6).length, 4);
  imports = new Set();
  bindings.forget(eventDocument.uri);
  const withdrawn = appearance.get(grammar, eventDocument);
  assert.deepEqual(bodySpans(withdrawn, eventStart, 6), []);
  assert.deepEqual(bodySpans(withdrawn, adjacent, 8), bodySpans(initial, adjacent, 8));
  assert.equal(appearance.get(grammar, eventDocument), withdrawn, "reuse with unchanged evidence");
  imports = official;
  bindings.forget(eventDocument.uri);
  assert.deepEqual(appearance.get(grammar, eventDocument), initial, "restoration at the same version");
  console.log("ok - a shared appearance cache follows Event evidence withdrawal and restoration");

  const workspace = mkdtempSync(join(tmpdir(), "hson-utf16-appearance-"));
  try {
    const packagePath = join(workspace, "node_modules/hson-live");
    mkdirSync(join(packagePath, "dist"), { recursive: true });
    writeFileSync(join(packagePath, "package.json"), '{"name":"hson-live","exports":{".":"./dist/index.d.ts"}}');
    writeFileSync(join(packagePath, "dist/index.d.ts"), "export declare const Hson: { event: typeof String.raw };");
    writeFileSync(join(workspace, "package.json"), '{"type":"module"}');
    writeFileSync(join(workspace, "tsconfig.json"), '{"compilerOptions":{"module":"NodeNext","types":[]},"files":["event.ts"]}');
    const fileName = join(workspace, "event.ts");
    const authored = 'import { Hson } from "hson-live";\r\nHson.event`<div title="é🧪" name="eventword"/>`;';
    writeFileSync(fileName, Buffer.from("\uFEFF" + authored, "utf16le"));
    const decorations = (text: string, snapshots: ReadonlyMap<string, string>) => {
      const proof = discover_typescript_projects([workspace], snapshots).sources.find(source => source.fileName === fileName)?.eventEvidence;
      assert.ok(proof);
      const imports = event_source_imports([proof], ts.sys.useCaseSensitiveFileNames);
      return new AppearanceSpanCache(new HsonBindingCache(imports)).get(grammar, { uri: fileName, fileName, languageId: "typescript", version: 1, text });
    };
    const decoded = ts.sys.readFile(fileName);
    assert.equal(decoded, authored);
    const closed = decorations(decoded, new Map());
    const reopened = decorations(authored, new Map([[fileName, authored]]));
    assert.deepEqual(reopened, closed);
    const start = authored.indexOf("eventword");
    assert.ok(closed.some(span => span.role === "value.attributeString" && span.range.start === start && span.range.end === start + "eventword".length));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
  console.log("ok - Event appearance uses the same exact UTF-16 ranges from disk and open snapshots");

  const body = '<p data:input="%{input}" title="attribute 😀"\r\n "content text ^{input}" <hson-part at="library/member"/>/>';
  for (const [languageId, fileName, text] of [
    ["hson", "/appearance.hson", body],
    ["markdown", "/appearance.md", '# Outside "native"\r\n```hson\r\n' + body + '\r\n```'],
    ["typescript", "/appearance.ts", 'import { Hson } from "hson-live/hson";\r\nHson.document`' + body + '`;'],
    ["typescriptreact", "/appearance.tsx", 'import { Hson } from "hson-live/hson";\r\nHson.document`' + body + '`;'],
  ]) {
    const document = { uri: fileName!, fileName: fileName!, languageId: languageId!, version: 1, text: text! };
    const spans = cache.get(grammar, document);
    const at = (needle: string) => spans.find(span => span.range.start <= text!.indexOf(needle) && span.range.end > text!.indexOf(needle));
    for (const [needle, role] of [["attribute 😀", "value.attributeString"], ["content text", "value.string"],
      ['"attribute', "punctuation.attributeQuotes"], ['"content', "punctuation.quoteOpen"]]) assert.equal(at(needle!)?.role, role, languageId);
    for (const [needle, role] of [["input}","reference.incoming.content"], ["library/member","part.selector.library"], ["<p","punctuation.tagOpen"]])
      assert.equal(at(needle!)?.role, role, "shared catalog: " + needle);
    assert.equal(cache.get(grammar, document), spans, "color-only reuse");
    const edited = { ...document, version: 2, text: text!.replace('title="attribute 😀"', 'title=^{input}') };
    const changed = cache.get(grammar, edited);
    assert.notEqual(changed, spans, "source edits invalidate");
    assert.ok(!changed.some(span => span.role === "value.attributeString"));
    for (const span of spans) assert.ok(!/[\r\n]/.test(text!.slice(span.range.start, span.range.end)), "physical UTF-16 ranges");
  }
  const text = 'import { Hson, hson } from "hson-live"; const native = "outside";\n'
    + 'Hson.document`<p title="before ${native.toUpperCase()} after" "text ${native}"/>`;\n'
    + 'hson.fromHson("<p title=\\"mapped\\" \\"cooked\\"/>");';
  const document = { uri: "/mapped.ts", fileName: "/mapped.ts", languageId: "typescript", version: 1, text };
  const spans = cache.get(grammar, document);
  for (const match of text.matchAll(/\$\{[^}]*\}/g)) assert.ok(!spans.some(span => span.range.start < match.index + match[0].length && span.range.end > match.index), "native hole is wholly excluded");
  for (const [needle, role] of [["before ", "value.attributeString"], [" after", "value.attributeString"], ["mapped", "value.attributeString"], ["cooked", "value.string"]] satisfies [string, AppearanceRole][])
    assert.ok(spans.some(span => span.range.start === text.indexOf(needle) && span.role === role), needle);
  assert.ok(!spans.some(span => span.range.start <= text.indexOf("outside") && span.range.end > text.indexOf("outside")));
  const shadow = 'const Hson = { document: String.raw }; Hson.document`<p title="native" "native"/>`;';
  assert.equal(cache.get(grammar, { ...document, version: 2, text: shadow }).length, 0, "unrecognized host tag stays native");
  for (const value of ["#000", "#0000", "#101820", "#10182000", "#ffffff"]) assert.ok(appearanceColor(value));
  for (const value of ["red", "#12345", "", 1, null]) assert.equal(appearanceColor(value), undefined);
  const dataSource = '<true true false false null null>';
  assert.doesNotThrow(() => Hson.data.parse(dataSource));
  const mixed="import { Hson, hson } from \"hson-live\"; Hson.data`" + dataSource + "`; Hson.document`<p \"doc\"/>`; hson.fromHson('<p title=\"ambiguous\"/>');";
  const mixedSpans=cache.get(grammar,{...document,version:3,text:mixed});
  for(const key of ['true','false','null']) {
    const start=mixed.indexOf(dataSource)+dataSource.indexOf(key);
    assert.equal(mixedSpans.find(s=>s.range.start===start)?.role,'element.name');
    assert.equal(mixedSpans.find(s=>s.range.start===start)?.family,'data');
    assert.equal(mixedSpans.find(s=>s.range.start===start+key.length+1)?.role,'value.primitive');
  }
  assert.equal(mixedSpans.find(s=>s.range.start===mixed.indexOf('doc"'))?.family,'document');
  assert.equal(mixedSpans.find(s=>s.range.start===mixed.indexOf('ambiguous'))?.family,'all');
  assert.equal(cache.get(grammar,{...document,version:4,languageId:'hson',text:'<p title="text"/>'})[0]?.family,'all','attributes do not imply Document');
  const bindingText='<section hson:part data:message=%{message} title="Attribute text" <h1 "Content text"/> <p title=^{message} "Hello"/>/>';
  const bindingSpans=cache.get(grammar,{...document,languageId:'hson',version:5,text:bindingText});
  for(const start of [bindingText.indexOf('data:message')+5,bindingText.indexOf('^{message}')+2])
    assert.equal(bindingSpans.find(s=>s.range.start===start)?.role,'part.receivingArgument','resolved local roots retain their declaration role');
  testModel();
  const load = Reflect.get(Module, '_load');
  const api = {ConfigurationTarget: {Global: 1, Workspace: 2}, ColorThemeKind: {Light: 1, HighContrastLight: 4},
    window: {activeColorTheme: {kind: 2}, visibleTextEditors: []}, ViewColumn: {Two: 2},
    workspace: {workspaceFolders: [{}], getConfiguration: () => ({get: (_key: string, fallback: unknown) => fallback})}};
  Reflect.set(Module, '_load', function(this: unknown, name: string, ...args: unknown[]) {
    return name === 'vscode' ? api : Reflect.apply(load, this, [name, ...args]);
  });
  try {await (await import('./appearance-transitions.test.js')).checkAppearanceTransitions();}
  finally {Reflect.set(Module, '_load', load);}
  console.log("ok - four contextual appearance roles, native/binding ownership, mapped UTF-16 ranges, source invalidation and unrestricted color values");
}
void run();

function testModel(): void {
  const state=initialAppearance(); assert.deepEqual(resolveStyle(state,'all','value.string','dark').style,{});
  const palette=duplicatePalette(state,'house','draft-palette','Named'); state.assignments.all=palette.id;
  const id=palette.id;palette.name='Renamed';assert.equal(palette.id,id);
  assert.deepEqual(readAppearance(JSON.parse(JSON.stringify(state))),state,'readable configuration round trip');
  for(const mode of ['dark','light'] as const)for(const role of Object.keys(roleCatalog))
    assert.deepEqual(resolveStyle(state,'all',role,mode).style,resolveStyle({...state,assignments:{all:'house'}},'all',role,mode).style,'House copy parity');
  palette.roles['value.string']={dark:{foreground:'#123456',intensity:.5,italic:true},light:{foreground:'#fff'}};
  palette.roles['value.attributeString']={inherits:'value.string',dark:{bold:true}};
  let resolved=resolveStyle(state,'data','value.attributeString','dark');
  assert.equal(resolved.style.foreground,blend('#123456',housePalette.blendBackground.dark,.5));assert.equal(resolved.style.italic,true);assert.equal(resolved.style.bold,true);
  state.overrides.all={'value.attributeString':{dark:{foreground:'#808080'}}};
  state.overrides.data={'value.attributeString':{dark:{intensity:1,italic:false}}};
  resolved=resolveStyle(state,'data','value.attributeString','dark');assert.equal(resolved.style.foreground,'#808080');assert.equal(resolved.style.italic,false);assert.equal(resolved.style.bold,true);
  assert.equal(resolveStyle(state,'document','value.attributeString','dark').style.italic,true,'family overrides are isolated');
  state.overrides.data['value.attributeString']!.dark!.foreground='native';
  assert.equal(resolveStyle(state,'data','value.attributeString','dark').style.foreground,undefined,'Native blocks lower property');
  delete state.overrides.data['value.attributeString']!.dark!.foreground;
  assert.equal(resolveStyle(state,'data','value.attributeString','dark').style.foreground,'#808080','reset reveals lower property');
  state.assignments.document='native';
  assert.deepEqual(resolveStyle(state,'document','element.name','dark').style,{});
  delete state.assignments.document;assert.ok(resolveStyle(state,'document','element.name','dark').style.foreground);
  assert.throws(()=>deletePalette(state,'house'),/built in/);assert.throws(()=>deletePalette(state,id),/Reassign/);
  state.assignments.all='native';deletePalette(state,id);assert.equal(state.palettes.length,0);
  const bad=initialAppearance(); duplicatePalette(bad,'house','cycle','Cycle').roles['value.string']={inherits:'value.attributeString'};
  assert.throws(()=>readAppearance(bad),/cycle/);
  for(const color of ['#000','#fff','#808080','#010203',housePalette.blendBackground.dark]) {
    const ugly=initialAppearance(),p=duplicatePalette(ugly,'house','ugly','Ugly');ugly.assignments.all=p.id;
    for(const role of Object.keys(p.roles))p.roles[role]={light:{foreground:color},dark:{foreground:color,intensity:1,fontStyle:'bold italic underline strikethrough',bold:false}};
    assert.doesNotThrow(()=>readAppearance(ugly));assert.equal(resolveStyle(ugly,'all','value.string','dark').style.foreground,appearanceColor(color)?.toLowerCase());
  }
  for(const value of [-1,1.1,NaN,Infinity]){const bad=initialAppearance();bad.overrides.all={'value.string':{dark:{intensity:value}}};assert.throws(()=>readAppearance(bad),/Invalid/);}
  assert.throws(()=>readAppearance({...initialAppearance(),assignments:{all:'missing'}}),/Unknown palette/);
  const shipped=JSON.stringify(housePalette);
  const edited=readAppearance({...initialAppearance(),palettes:[{id:housePalette.id,name:housePalette.name,blendBackground:structuredClone(housePalette.blendBackground),roles:structuredClone(housePalette.roles)}]});
  edited.assignments.all='house';
  edited.palettes[0]!.roles['value.string']!.dark!.foreground='#123abc';
  assert.equal(resolveStyle(edited,'all','value.string','dark').style.foreground,'#123abc');
  assert.equal(JSON.stringify(housePalette),shipped);
  assert.ok(Object.isFrozen(housePalette.roles['value.string']!.dark));
  assert.deepEqual(readAppearance(JSON.parse(JSON.stringify(edited))),edited);
  assert.throws(()=>readAppearance({...edited,palettes:[edited.palettes[0],edited.palettes[0]]}),/Duplicate/);
  const complete=structuredClone(edited);
  for(const role of Object.keys(roleCatalog))complete.palettes[0]!.roles[role]={light:{foreground:'#ffffff',intensity:.25,fontStyle:'bold italic underline strikethrough',bold:false,italic:'native',underline:true,strikethrough:false},dark:{foreground:'#000000',intensity:1,fontStyle:'',bold:true,italic:false,underline:'native',strikethrough:true}};
  assert.deepEqual(readAppearance(JSON.parse(JSON.stringify(complete))),complete,'all 47 roles and seven properties survive both modes');
  console.log('ok - palette CRUD, stable identity, readable persistence, sparse property inheritance, explicit Native, reset, cycles and unrestricted colors/styles');
}
