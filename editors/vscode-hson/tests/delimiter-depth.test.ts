import assert from "node:assert/strict";
import { resolve } from "node:path";
import { load_hson_grammar } from "../src/highlighting.js";
import { HSON_DEPTH_COLOR_IDS, HsonDelimiterDepthCache, HsonDepthDecorationSet, hson_delimiter_depths } from "../src/delimiter-depth.js";
import { StructuralDocumentEvidenceCache, structural_document_evidence } from "../src/structural-editing.js";

async function run(): Promise<void> {
  const grammar = await load_hson_grammar(resolve(__dirname, ".."));
  let checks = 0;
  const check = (name: string, body: () => void) => { body(); console.log(`ok ${++checks} - ${name}`); };
  const prefix = 'import { Hson } from "hson-live/hson";\n';
  const template = (body: string) => prefix + 'const value=Hson.canonical`' + body + '`;';
  const depths = (text: string, language: "typescript" | "typescriptreact" | "markdown" = "typescript") =>
    hson_delimiter_depths(grammar, structural_document_evidence(`/workspace/source.${language === "typescriptreact" ? "tsx" : "ts"}`, language, text));
  const shape = (text: string, language: "typescript" | "typescriptreact" = "typescript") => depths(text, language)
    .map(token => [text.slice(token.range.start, token.range.end), token.depth, token.unexpected]);

  check("angles, guillemets, and legacy arrays share explicit source depth", () => {
    assert.deepEqual(shape(template('<\n x «\n <\n y [\n ]\n >\n »\n>')),
      [['<', 1, false], ['«', 2, false], ['<', 3, false], ['[', 4, false],
        [']', 4, false], ['>', 3, false], ['»', 2, false], ['>', 1, false]]);
    assert.deepEqual(shape(template('<a 1 b 2 c <> d «»>')).map(token => token[1]), [1, 2, 2, 2, 2, 1]);
  });
  check("document closers color only their angle, retaining the separate slash", () => {
    const text = template('<main\n <section\n <div\n <p "hello"/>\n />\n />\n/>');
    assert.deepEqual(shape(text).map(token => token[1]), [1, 2, 3, 4, 4, 3, 2, 1]);
    assert.ok(depths(text).every(token => text[token.range.start] !== '/'));
  });
  check("defs, union, ref, and array schema delimiters share the same stack", () => {
    const text = prefix + 'const schema=Hson.schema`<type "data" defs <Text "string" Block <union «<ref "Text">, <array <ref "Text">>»>> content <ref "Block">>`;';
    assert.deepEqual(shape(text).map(token => token[1]), [1, 2, 3, 4, 5, 5, 5, 6, 6, 5, 4, 3, 2, 2, 2, 1]);
    assert.ok(depths(text).every(token => !token.unexpected));
  });
  check("strings, escapes, comments, and quoted names never contribute depth", () => {
    const text = template('<\n\'name < « [ > » ]\' "string < « > »"\n// < « [ > » ]\nreal «"escaped \\\" <", 1»\n>');
    assert.deepEqual(shape(text).map(token => token[0]), ['<', '«', '»', '>']);
    const document = template('<p title="< « > »" "literal"/>');
    assert.deepEqual(shape(document).map(token => token[0]), ['<', '>']);
  });
  check("multiline quote state ignores delimiter-looking body lines for every newline kind", () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const text = template('<a "' + eol + '<not structure>' + eol + '«still text» // [' + eol + '" b «1»>');
      assert.deepEqual(shape(text).map(token => token[0]), ['<', '«', '»', '>']);
    }
  });
  check("substitution expressions are masked, including quotes and multiline expressions", () => {
    for (const body of ['<a «${["<", "»"]}, <b 1>»>', '<a "before ${"< «"} after" b <c 1>>', '<a ${\n ["<", "«"]\n} b <c 1>>']) {
      assert.deepEqual(shape(template(body)).map(token => token[1]), body.includes('«${') ? [1, 2, 3, 3, 2, 1] : [1, 2, 2, 1]);
    }
  });
  check("binding aliases work in TS and TSX while namespace imports and shadows retain their exclusion", () => {
    const languages: readonly ("typescript" | "typescriptreact")[] = ['typescript', 'typescriptreact'];
    for (const language of languages) {
      const alias = 'import { Hson as Alias } from "hson-live/hson"; const x=Alias.data`<a 1>`;';
      const namespace = 'import * as lib from "hson-live/hson"; const x=lib.Hson.document`<p/>`;';
      assert.equal(depths(alias, language).length, 2);
      assert.deepEqual(depths(namespace, language), []);
      assert.deepEqual(depths('import * as lib from "hson-live/hson"; function f(lib:any){ return lib.Hson.data`<a 1>`; }', language), []);
      assert.deepEqual(depths('import * as lib from "other"; const x=lib.Hson.data`<a 1>`;', language), []);
      assert.deepEqual(depths('import type * as lib from "hson-live/hson"; const x=lib.Hson.data`<a 1>`;', language), []);
      assert.deepEqual(depths('import * as lib from "hson-live/hson"; const x=lib?.Hson.data`<a 1>`;', language), []);
      assert.deepEqual(depths(prefix + 'function f(Hson:any){ return Hson.data`<a 1>`; }', language), []);
      assert.deepEqual(depths('const Hson=String.raw; const x=Hson.data`<a 1>`;', language), []);
    }
  });
  check("separate regions reset both quote state and malformed delimiter stacks", () => {
    const text = prefix + 'const a=Hson.data`<a «`; const b=Hson.data`<b 1>`; const c=Hson.data`"unclosed <`; const d=Hson.data`<d 1>`;';
    assert.deepEqual(shape(text), [['<', 1, true], ['«', 2, true], ['<', 1, false], ['>', 1, false], ['<', 1, false], ['>', 1, false]]);
    assert.deepEqual(shape(template('«]»')).map(token => token[2]), [false, true, false]);
  });
  check("non-template calls, ordinary host text, and native Markdown receive no custom colors", () => {
    assert.deepEqual(depths(prefix + 'const x=["<", "«"]; const y=`<a 1>`; Hson.data.fromHson("<a 1>");'), []);
    assert.deepEqual(depths('```hson\n<a «1»>\n```', 'markdown'), []);
  });
  check("depth results reuse bounded document/version evidence and disappear with the region", () => {
    const documents = new StructuralDocumentEvidenceCache(2);
    const cache = new HsonDelimiterDepthCache();
    const text = template('<a 1>');
    const evidence = documents.get('file:///source.ts', 1, '/workspace/source.ts', 'typescript', text);
    const first = cache.get(grammar, evidence);
    assert.equal(cache.get(grammar, documents.get('file:///source.ts', 1, '/workspace/source.ts', 'typescript', text)), first);
    const next = documents.get('file:///source.ts', 2, '/workspace/source.ts', 'typescript', 'const ordinary=1;');
    assert.deepEqual(cache.get(grammar, next), []);
  });
  check("deep regions use an iterative stack with no cross-region depth carry", () => {
    const text = template('«'.repeat(2000) + '»'.repeat(2000)) + 'const other=Hson.data`<>`;';
    const result = depths(text);
    assert.equal(result.length, 4002);
    assert.equal(result[1999].depth, 2000);
    assert.equal(result[2000].depth, 2000);
    assert.equal(result[4000].depth, 1);
    assert.ok(result.every(token => !token.unexpected));
  });
  check("theme-referenced decorations share a cycle, clear on disable, and rebuild on high contrast", () => {
    let theme = 'dark';
    const created: { colorId: string; theme: string; disposed: boolean; dispose(): void }[] = [];
    const decorations = new HsonDepthDecorationSet(colorId => {
      const decoration = { colorId, theme, disposed: false, dispose() { this.disposed = true; } };
      created.push(decoration);
      return decoration;
    });
    const presented = new Map<string, readonly { start: number; end: number }[]>();
    const set = (decoration: typeof created[number], ranges: readonly { start: number; end: number }[]) => presented.set(decoration.colorId, ranges);
    const tokens = depths(template('<a «<b [1]>»>'));
    decorations.apply(set, tokens, true);
    assert.deepEqual([...presented.keys()], HSON_DEPTH_COLOR_IDS);
    assert.equal(presented.get(HSON_DEPTH_COLOR_IDS[0])?.length, 4); // depths 1 and 4, both endpoints
    assert.equal(presented.get(HSON_DEPTH_COLOR_IDS[1])?.length, 2);
    assert.equal(presented.get(HSON_DEPTH_COLOR_IDS[2])?.length, 2);
    decorations.apply(set, tokens, false);
    assert.ok([...presented.values()].every(ranges => ranges.length === 0));
    theme = 'high contrast';
    decorations.refresh();
    assert.ok(created.slice(0, 4).every(decoration => decoration.disposed));
    assert.deepEqual(created.slice(4).map(decoration => decoration.colorId), HSON_DEPTH_COLOR_IDS);
    assert.ok(created.slice(4).every(decoration => decoration.theme === theme));
    decorations.apply(set, tokens, true);
    assert.equal(presented.get(HSON_DEPTH_COLOR_IDS[0])?.length, 4);
    decorations.apply(set, [], true);
    assert.ok([...presented.values()].every(ranges => ranges.length === 0));
    decorations.dispose();
    assert.ok(created.every(decoration => decoration.disposed));
  });
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
