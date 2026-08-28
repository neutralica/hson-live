import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { hson_highlights, load_hson_grammar, hsonTokenScopes } from "../src/highlighting.js";
import { produce_document_diagnostics } from "../src/document-diagnostics.js";
import { start_diagnostics, type DiagnosticDocument, type DiagnosticHost } from "../src/diagnostics.js";
import { HSON } from "../../../src/hson-authoring.js";
import { hson_authoring_marker_parts, hsonAuthoringMarker } from "../src/authoring-marker.js";

async function run(): Promise<void> {
  const grammar = await load_hson_grammar(resolve(__dirname, ".."));
  let checks = 0;
  const check = (name: string, body: () => void) => { body(); console.log(`ok ${++checks} - ${name}`); };
  const source = (body: string, imported = "HSON", tag = "HSON", pkg = "hson-live/hson") => `import { ${imported} } from "${pkg}";\nconst source = ${tag}\`${body}\`;`;
  const tokens = (text: string, fileName = "/workspace/baseline.ts") => hson_highlights(grammar, fileName, text);
  const diagnose = (text: string) => produce_document_diagnostics({ fileName: "/workspace/baseline.ts", languageId: "typescript", text });
  const nameToken = (text: string) => tokens(text).some(token => text.slice(token.range.start, token.range.end) === "thing" && token.scopes.includes("entity.name.type.hson"));
  const markers = (text: string) => hson_authoring_marker_parts("/workspace/baseline.ts", text);

  check("official narrow /hson binding is a grammar-backed island", () => assert.ok(nameToken(source('<thing 1>'))));
  check("official root binding is a grammar-backed island", () => assert.ok(nameToken(source('<thing 1>', "HSON", "HSON", "hson-live"))));
  check("renamed official import highlights and diagnoses", () => {
    assert.ok(nameToken(source('<thing 1>', "HSON as author", "author")));
    assert.equal(diagnose(source('+1', "HSON as author", "author")).length, 1);
  });
  check("literal official HSON tag has four exact branded letter ranges", () => {
    const text = source('<thing 1>');
    assert.deepEqual(markers(text).map(part => ({
      text: text.slice(part.range.start, part.range.end), colorId: part.colorId,
    })), hsonAuthoringMarker.map(marker => ({ text: marker.letter, colorId: marker.colorId })));
  });
  check("root HSON tag receives the same branded marker", () => {
    assert.equal(markers(source('<thing 1>', "HSON", "HSON", "hson-live")).length, 4);
  });
  check("renamed official import keeps normal tag presentation without a fabricated marker", () => {
    assert.deepEqual(markers(source('<thing 1>', "HSON as author", "author")), []);
  });
  check("unrelated local HSON is excluded", () => {
    const text = 'const HSON=String.raw; HSON`<thing !!!`;';
    assert.deepEqual(tokens(text), []); assert.deepEqual(markers(text), []); assert.deepEqual(diagnose(text), []);
  });
  check("shadowed official binding is excluded", () => {
    const text = 'import { HSON } from "hson-live/hson"; function f(HSON: any){ HSON`<thing !!!`; }';
    assert.deepEqual(tokens(text), []); assert.deepEqual(markers(text), []); assert.deepEqual(diagnose(text), []);
  });
  check("wrong package is excluded", () => { const text = source('<thing !!!', "HSON", "HSON", "other"); assert.deepEqual(tokens(text), []); assert.deepEqual(markers(text), []); assert.deepEqual(diagnose(text), []); });
  check("lowercase aggregate and ordinary HSON references have no marker", () => {
    const text = 'import { HSON, hson } from "hson-live"; const a=hson; const b=HSON;';
    assert.deepEqual(markers(text), []);
  });
  check("wrappers and copied tag functions do not acquire authority", () => {
    const text = 'import { HSON } from "hson-live/hson"; const copy=HSON; const wrap=(...x:any[])=>HSON(...x); copy`+1`; wrap`+1`;';
    assert.deepEqual(tokens(text), []); assert.deepEqual(diagnose(text), []);
  });
  check("invalid HSON remains highlighted", () => assert.ok(nameToken(source('<thing !!!'))));
  check("embedded body preserves distinct theme-facing syntax categories", () => {
    const text = source('// note\n<thing class=card "text" 12 true null @012345678 _hson_bad>');
    const emitted = tokens(text);
    const has = (slice: string, type: string) => emitted.some(token =>
      text.slice(token.range.start, token.range.end).includes(slice) && token.type === type);
    assert.ok(has('thing', 'hsonType'));
    assert.ok(has('class', 'hsonProperty'));
    assert.ok(has('card', 'hsonString'));
    assert.ok(has('text', 'hsonString'));
    assert.ok(has('12', 'hsonNumber'));
    assert.ok(has('true', 'hsonKeyword'));
    assert.ok(has('null', 'hsonKeyword'));
    assert.ok(has('@012345678', 'hsonQuid'));
    assert.ok(has('_hson_bad', 'hsonInvalid'));
    assert.ok(has(' note', 'hsonComment'));
    assert.ok(has('<', 'hsonDelimiter'));
  });
  check("valid readable noncanonical source is admitted by the real tag", () => {
    assert.equal(HSON` <thing 1 > `, '<thing 1>');
    assert.deepEqual(diagnose(source(' <thing 1 > ')), []);
  });
  check("malformed zero-Schema HSON is diagnosed", () => assert.equal(diagnose(source('<thing !!!')).length, 1));
  check("invalid to valid clears", () => { assert.equal(diagnose(source('+1')).length, 1); assert.deepEqual(diagnose(source('<thing 1>')), []); });
  check("valid to invalid publishes", () => { assert.deepEqual(diagnose(source('<thing 1>')), []); assert.equal(diagnose(source('+1')).length, 1); });
  check("no trusted provider or Schema association enters baseline production", () => {
    const text = source('+1'); assert.doesNotMatch(text, /Schema|validate|schema.use/); assert.equal(diagnose(text).length, 1);
  });
  check("Restricted Mode capability and unconditional baseline registration are packaged", () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    assert.equal(manifest.capabilities.untrustedWorkspaces.supported, 'limited');
    assert.deepEqual(manifest.contributes.semanticTokenScopes[0].scopes, hsonTokenScopes);
    assert.equal(manifest.contributes.grammars.length, 1, 'no spelling-only injection');
    assert.deepEqual(manifest.contributes.colors.map((color: { id: string }) => color.id), hsonAuthoringMarker.map(marker => marker.colorId));
    assert.deepEqual(manifest.contributes.colors.map((color: { defaults: object }) => color.defaults), [
      { dark: '#74A7D8', light: '#356A9A', highContrast: '#66B3FF', highContrastLight: '#005FB8' },
      { dark: '#D2B45F', light: '#786422', highContrast: '#FFD166', highContrastLight: '#8A6200' },
      { dark: '#D789AE', light: '#8E4768', highContrast: '#FF80BF', highContrastLight: '#B0005A' },
      { dark: '#78B996', light: '#3E7256', highContrast: '#6EE7A8', highContrastLight: '#147A3D' },
    ]);
  });
  check("interpolation preserves literal highlighting and excludes expressions", () => {
    const text = source('<thing ${dangerous()} other 1>'), start = text.indexOf('${'), end = text.indexOf('}', start)+1;
    assert.ok(nameToken(text));
    assert.ok(tokens(text).every(token => token.range.end <= start || token.range.start >= end));
  });
  check("secure mode never executes interpolation or invents values", () => {
    const text = source('<thing ${(()=>{throw new Error("must not execute")})()}>');
    assert.deepEqual(diagnose(text), []);
  });
  check("irrevocable prefix lexer failure is diagnosed without a completed candidate", () => {
    const text = source('+1 ${value}'); assert.equal(diagnose(text)[0]?.code, 'HSON_NUMBER_LEADING_PLUS');
  });
  check("incomplete prefix is not guessed invalid", () => assert.deepEqual(diagnose(source('<thing ${value}>')), []));
  check("raw escape spelling is not cooked into HSON", () => {
    const text = source('<thing "\\n">'); assert.deepEqual(diagnose(text), []);
    assert.equal(HSON`<thing "\n">`, '<thing "\\n">');
  });
  check("undefined cooked segment rejects even in an HSON comment", () => {
    const text = source('// \\unicode\n<thing 1>');
    assert.equal(diagnose(text)[0]?.code, 'HSON_TAGGED_TEMPLATE_REQUIRED');
  });
  check("CRLF normalization maps primary and related evidence to authored offsets", () => {
    const text = source('\r\n<thing 1\r\n thing 2>'); const d = diagnose(text)[0]!;
    assert.equal(text.slice(d.range.start,d.range.end), 't');
    assert.equal(text.slice(d.related[0]!.range.start,d.related[0]!.range.end), 't');
  });
  check("Unicode and UTF-16 ranges survive raw template mapping", () => {
    const text = source('\r\n😀'); const d = diagnose(text)[0]!;
    assert.equal(text.slice(d.range.start,d.range.end), '😀');
  });
  check("TSX near JSX receives only binding-selected grammar tokens", () => {
    const text = 'import { HSON } from "hson-live/hson"; const view=<main>{HSON`<thing 1>`}</main>;';
    assert.ok(tokens(text, '/workspace/a.tsx').some(token => text.slice(token.range.start, token.range.end)==='thing'));
    assert.ok(tokens(text, '/workspace/a.tsx').every(token => token.range.start > text.indexOf('HSON`')));
  });
  check("stale document results do not publish", () => {
    let doc: DiagnosticDocument = { uri:'file:///a.ts', version:1, languageId:'typescript', fileName:'/a.ts', text:source('+1') };
    let published = false;
    const noEvent = () => ({ dispose() {} });
    const host: DiagnosticHost = { openDocuments:()=>[doc], onDidOpen:noEvent, onDidChange:noEvent, onDidClose:noEvent,
      setTimer:()=>0, clearTimer(){}, reportUnexpected(error){throw error;} };
    const controller = start_diagnostics(host, { set(){ published=true; }, delete(){} }, { produce(input){
      const result=produce_document_diagnostics(input); doc={...doc,version:2,text:source('<thing 1>')}; return result;
    }});
    assert.equal(published,false); controller.dispose();
  });
  console.log(`# ${checks} zero-Schema HSON baseline checks passed`);
}
run().catch(error => { console.error(error); process.exitCode=1; });
