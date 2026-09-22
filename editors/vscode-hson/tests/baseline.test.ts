import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { hson_document_self_closing_slash_ranges, hson_highlights, load_hson_grammar, hsonTokenScopes } from "../src/highlighting.js";
import { produce_document_diagnostics } from "../src/document-diagnostics.js";
import { start_diagnostics, type DiagnosticDocument, type DiagnosticHost } from "../src/diagnostics.js";
import { Hson } from "../../../src/hson-authoring.js";
import {
  HSON_LIBRARY_SEPARATOR_COLOR_ID,
  hson_identity_marker_parts,
  hson_identity_presentation,
  hson_library_separator_parts,
  hsonIdentityMarkers,
} from "../src/authoring-marker.js";
import { markdown_hson_fence_marker_parts } from "../src/markdown-fence-marker.js";

async function run(): Promise<void> {
  const grammar = await load_hson_grammar(resolve(__dirname, ".."));
  let checks = 0;
  const check = (name: string, body: () => void) => { body(); console.log(`ok ${++checks} - ${name}`); };
  const source = (body: string, imported = "Hson", tag = "Hson", pkg = "hson-live/hson") => `import { ${imported} } from "${pkg}";\nconst source = ${tag}.canonical\`${body}\`;`;
  const tokens = (text: string, fileName = "/workspace/baseline.ts") => hson_highlights(grammar, fileName, text);
  const diagnose = (text: string) => produce_document_diagnostics({ fileName: "/workspace/baseline.ts", languageId: "typescript", text });
  const nameToken = (text: string) => tokens(text).some(token => text.slice(token.range.start, token.range.end) === "thing" && token.scopes.includes("entity.name.type.hson"));
  const markers = (text: string) => hson_identity_marker_parts("/workspace/baseline.ts", text);
  const separators = (text: string) => hson_library_separator_parts("/workspace/baseline.ts", text);
  const referenceParts = (text: string, spelling: "Hson" | "hson", start = text.lastIndexOf(spelling)) =>
    markers(text).filter(part => part.range.start >= start && part.range.end <= start + spelling.length);
  const expectedMarker = (spelling: "Hson" | "hson") => hsonIdentityMarkers
    .filter(marker => marker.publicName === spelling)
    .map(marker => ({ text: marker.letter, colorId: marker.colorId, strength: marker.strength }));

  check("official narrow /hson binding is a grammar-backed island", () => assert.ok(nameToken(source('<thing 1>'))));
  check("official root binding is a grammar-backed island", () => assert.ok(nameToken(source('<thing 1>', "Hson", "Hson", "hson-live"))));
  check("document self-closing slash evidence is exact across standalone, Markdown, and tagged Hson", () => {
    const standalone = '<article <p "a/b"/>/> <data "/">';
    assert.deepEqual(hson_document_self_closing_slash_ranges(grammar, "/workspace/a.hson", "hson", standalone)
      .map(range => standalone.slice(range.start, range.end)), ["/", "/"]);

    const markdown = 'before\n```hson\n<p "a/b"/>\n```\nafter';
    assert.deepEqual(hson_document_self_closing_slash_ranges(grammar, "/workspace/a.md", "markdown", markdown)
      .map(range => markdown.slice(range.start, range.end)), ["/"]);

    const tagged = source('<p "a/b"/>');
    const ranges = hson_document_self_closing_slash_ranges(grammar, "/workspace/a.ts", "typescript", tagged);
    assert.deepEqual(ranges.map(range => tagged.slice(range.start, range.end)), ["/"]);
    assert.ok(ranges.every(range => tagged[range.end] === ">"));
  });
  check("canonical LiveMap fromHson literals are grammar-backed islands", () => {
    const prefix = 'import { hson, hsonLiveMap } from "hson-live";\n';
    for (const expression of [
      'hson.liveMap.fromHson(`<main <section <p "hello"/>/>/>`)',
      'hson.liveMap.fromHson("<main/>")',
      'hson.liveMap.fromHson("<main <p \\"hello\\"/>/>")',
      "hson.liveMap.fromHson('<main/>')",
      'hsonLiveMap.fromHson(`<main/>`)',
      'hsonLiveMap.fromHson("<main/>")',
    ]) {
      const text = prefix + expression;
      assert.ok(tokens(text).some(token => text.slice(token.range.start, token.range.end) === "main"
        && token.scopes.includes("entity.name.type.hson")), expression);
      if (expression.includes("hello")) {
        assert.ok(tokens(text).some(token => text.slice(token.range.start, token.range.end) === "hello"
          && token.scopes.includes("string.quoted.double.hson")), expression);
      }
    }
  });
  check("all current direct string fromHson facades reuse the Hson grammar", () => {
    const text = 'import { hson, hsonTransform, hsonLiveMap, hsonLiveTree } from "hson-live";\n'
      + 'hson.fromHson("<rootShortcut/>"); hson.transform.fromHson("<rootTransform/>"); '
      + 'hsonTransform.fromHson("<transform/>"); hsonLiveMap.fromHson("<map/>"); hsonLiveTree.fromHson("<tree/>");';
    for (const name of ["rootShortcut", "rootTransform", "transform", "map", "tree"]) {
      assert.ok(tokens(text).some(token => text.slice(token.range.start, token.range.end) === name
        && token.scopes.includes("entity.name.type.hson")), name);
    }
  });
  check("renamed official fromHson imports retain binding-aware highlighting", () => {
    const text = 'import { hsonLiveMap as maps } from "hson-live/livemap"; maps.fromHson("<renamed/>");';
    assert.ok(tokens(text).some(token => text.slice(token.range.start, token.range.end) === "renamed"
      && token.scopes.includes("entity.name.type.hson")));
  });
  check("fromHson interpolation alternates Hson literals with an untouched TypeScript hole", () => {
    const text = 'import { hson } from "hson-live"; hson.liveMap.fromHson(`<p "${value}"/>`);';
    const start = text.indexOf("${"), end = text.indexOf("}", start) + 1;
    const emitted = tokens(text);
    assert.ok(emitted.some(token => text.slice(token.range.start, token.range.end) === "p"
      && token.scopes.includes("entity.name.type.hson")));
    assert.ok(emitted.some(token => token.range.start >= end && text.slice(token.range.start, token.range.end).includes('"')));
    assert.ok(emitted.every(token => token.range.end <= start || token.range.start >= end));
  });
  check("cooked fromHson interpolation is conservatively left to TypeScript", () => {
    const text = 'import { hson } from "hson-live"; hson.liveMap.fromHson(`<p "\\n${value}"/>`);';
    assert.deepEqual(tokens(text), []);
  });
  check("unrelated and similarly named fromHson bindings remain ordinary host strings", () => {
    const cases = [
      'const someUnrelatedObject={fromHson(value:string){return value;}}; someUnrelatedObject.fromHson("<fake/>");',
      'const hsonLiveMap={fromHson(value:string){return value;}}; hsonLiveMap.fromHson("<local/>");',
      'import { hsonLiveMap } from "other"; hsonLiveMap.fromHson("<wrongPackage/>");',
      'import { hson } from "hson-live"; function f(hson:any){ hson.liveMap.fromHson("<shadowed/>"); }',
      'const ordinary="<ordinary/>";',
    ];
    for (const text of cases) assert.deepEqual(tokens(text), [], text);
  });
  check("fromHson highlighting follows the existing ts/tsx-only host policy", () => {
    const text = 'import { hson } from "hson-live"; hson.liveMap.fromHson("<thing/>");';
    assert.ok(nameToken('import { Hson } from "hson-live"; Hson.canonical`<thing/>`;'));
    assert.ok(tokens(text, "/workspace/a.tsx").length > 0);
    for (const extension of ["mts", "cts", "js", "jsx", "mjs", "cjs"]) {
      assert.deepEqual(tokens(text, `/workspace/a.${extension}`), []);
    }
  });
  check("fromHson highlighting leaves current diagnostic behavior unchanged", () => {
    const prefix = 'import { hson } from "hson-live"; ';
    assert.deepEqual(diagnose(prefix + 'hson.liveMap.fromHson("<valid/>");'), []);
    assert.equal(diagnose(prefix + 'hson.liveMap.fromHson("+1");').length, 1);
    assert.deepEqual(diagnose('const fake={fromHson(x:string){return x;}}; fake.fromHson("+1");'), []);
  });
  check("renamed official import highlights and diagnoses", () => {
    assert.ok(nameToken(source('<thing 1>', "Hson as author", "author")));
    assert.equal(diagnose(source('+1', "Hson as author", "author")).length, 1);
  });
  check("literal official Hson tag has four exact soft letter ranges", () => {
    const text = source('<thing 1>');
    const start = text.lastIndexOf('Hson');
    const parts = referenceParts(text, 'Hson', start);
    assert.deepEqual(parts.map(part => ({
      text: text.slice(part.range.start, part.range.end), colorId: part.colorId, strength: part.strength,
    })), expectedMarker('Hson'));
    assert.deepEqual(parts.map(part => part.range), [0, 1, 2, 3].map(index => ({ start: start + index, end: start + index + 1 })));
    assert.ok(parts.every((part, index) => index === 0 || parts[index - 1]!.range.end <= part.range.start));
  });
  check("root Hson tag receives the same branded marker", () => {
    assert.equal(markers(source('<thing 1>', "Hson", "Hson", "hson-live")).length, 4);
  });
  check("Schema authoring keeps soft Hson colors while lowercase hson alone owns the violet period", () => {
    const text = 'import { Hson, hson } from "hson-live"; const S = Hson.schema`<type "data" content <name "string">>`; Hson.schema.fromHson(S, Hson.canonical`<name "Ada">`); hson.liveMap;';
    const authoringStarts = [text.indexOf("Hson.canonical`"), text.indexOf("Hson.schema.fromHson"), text.lastIndexOf("Hson.canonical`")];
    for (const start of authoringStarts) {
      const parts = referenceParts(text, "Hson", start);
      assert.deepEqual(parts.map(part => text.slice(part.range.start, part.range.end)), ["H", "s", "o", "n"]);
      assert.deepEqual(parts.map(part => part.strength), ["soft", "soft", "soft", "soft"]);
    }
    assert.deepEqual(separators(text).map(part => part.range.start), [text.indexOf(".liveMap")]);
    assert.ok(!separators(text).some(part => part.range.start === text.indexOf(".validate")));
    const backticks = [...text].map((character, index) => character === "`" ? index : -1).filter(index => index >= 0);
    assert.ok(backticks.every(index => !markers(text).some(part => part.range.start <= index && part.range.end > index)));
  });
  check("renamed official import keeps normal tag presentation without a fabricated marker", () => {
    assert.deepEqual(markers(source('<thing 1>', "Hson as author", "author")), []);
  });
  check("unrelated local Hson is excluded", () => {
    const text = 'const Hson=String.raw; Hson.canonical`<thing !!!`;';
    assert.deepEqual(tokens(text), []); assert.deepEqual(markers(text), []); assert.deepEqual(diagnose(text), []);
  });
  check("shadowed official binding is excluded", () => {
    const text = 'import { Hson } from "hson-live/hson"; function f(Hson: any){ Hson.canonical`<thing !!!`; }';
    assert.deepEqual(tokens(text), []); assert.deepEqual(markers(text), []); assert.deepEqual(diagnose(text), []);
  });
  check("wrong package is excluded", () => { const text = source('<thing !!!', "Hson", "Hson", "other"); assert.deepEqual(tokens(text), []); assert.deepEqual(markers(text), []); assert.deepEqual(diagnose(text), []); });
  check("official imports and re-exports remain ordinary presentation", () => {
    assert.deepEqual(markers('import { Hson, hson } from "hson-live";'), []);
    assert.deepEqual(markers('import { Hson } from "hson-live/hson";'), []);
    assert.deepEqual(markers('import { Hson as authored } from "hson-live/hson";'), []);
    assert.deepEqual(markers('import { hson as library } from "hson-live";'), []);
    assert.deepEqual(markers('export { Hson, hson } from "hson-live";'), []);
    assert.deepEqual(markers('import { Hson, hson } from "hson-live"; export { Hson, hson };'), []);
    assert.deepEqual(markers('import { Hson } from "hson-live"; export default Hson;'), []);
  });
  check("official bare and member-root references receive family markers", () => {
    const text = 'import { Hson, hson } from "hson-live"; void Hson; void hson; Hson.schema.fromHson(x,y); hson.fromBinary(x); hson.liveMap;';
    assert.equal(markers(text).length, 20);
    assert.deepEqual(referenceParts(text, 'Hson', text.indexOf('Hson', text.indexOf(';') + 1)).map(part => part.strength), ['soft', 'soft', 'soft', 'soft']);
    const hsonStart = text.indexOf('hson', text.indexOf(';') + 1);
    const lower = referenceParts(text, 'hson', hsonStart);
    assert.deepEqual(lower.map(part => ({ text: text.slice(part.range.start, part.range.end), colorId: part.colorId, strength: part.strength })), expectedMarker('hson'));
    assert.deepEqual(lower.map(part => part.range), [0, 1, 2, 3].map(index => ({ start: hsonStart + index, end: hsonStart + index + 1 })));
  });
  check("only the first official lowercase member period receives the violet separator identity", () => {
    const text = 'import { hson } from "hson-live"; hson.liveMap.fromJson(x); hson.fromJson("{}"); hson.transform;';
    const parts = separators(text);
    assert.deepEqual(parts.map(part => text.slice(part.range.start, part.range.end)), [".", ".", "."]);
    assert.deepEqual(parts.map(part => part.range.start), [
      text.indexOf(".liveMap"), text.lastIndexOf(".fromJson"), text.indexOf(".transform"),
    ]);
    assert.ok(parts.every(part => part.colorId === HSON_LIBRARY_SEPARATOR_COLOR_ID && part.strength === "strong"));
    assert.ok(!parts.some(part => part.range.start === text.indexOf(".fromJson")));
  });
  check("separator authority excludes aliases, fakes, shadows, properties, wrong packages, imports, and uppercase Hson", () => {
    const cases = [
      'import { hson as library } from "hson-live"; library.liveMap;',
      'const hson={}; hson.liveMap;',
      'import { hson } from "hson-live"; function f(hson:any){ hson.liveMap; }',
      'const obj={hson:{}}; obj.hson.liveMap;',
      'import { hson } from "other"; hson.liveMap;',
      'import { hson } from "hson-live";',
      'import { Hson } from "hson-live"; Hson.schema.fromHson(x,y);',
    ];
    for (const text of cases) assert.deepEqual(separators(text), []);
  });
  check("lowercase color toggle removes lowercase markers and separator without affecting uppercase Hson", () => {
    const text = 'import { hson, Hson } from "hson-live"; hson.liveMap; Hson.schema.fromHson(x,y);';
    const enabled = hson_identity_presentation("/workspace/baseline.ts", text, true);
    const disabled = hson_identity_presentation("/workspace/baseline.ts", text, false);
    assert.equal(enabled.markers.length, 8); assert.equal(enabled.separators.length, 1);
    assert.equal(disabled.markers.length, 4); assert.equal(disabled.separators.length, 0);
    assert.ok(disabled.markers.every(part => part.publicName === "Hson"));
  });
  check("canonical Markdown hson fences receive the existing four strong library markers", () => {
    const text = [
      "Before hson prose and `hson` inline code.",
      "```hson",
      "<first/>",
      "```",
      "~~~hson title",
      "<second/>",
      "~~~~",
    ].join("\n");
    const parts = markdown_hson_fence_marker_parts(text);
    const starts = [text.indexOf("hson", text.indexOf("```")), text.indexOf("hson", text.indexOf("~~~"))];
    assert.equal(parts.length, 8);
    for (const start of starts) {
      const marker = parts.filter(part => part.range.start >= start && part.range.end <= start + 4);
      assert.deepEqual(marker.map(part => ({
        text: text.slice(part.range.start, part.range.end), colorId: part.colorId, strength: part.strength,
      })), expectedMarker("hson"));
    }
  });
  check("Markdown fence markers preserve indentation and fence-width structure", () => {
    const text = [
      "   ````hson",
      "```hson",
      "````",
      "~~~json",
      "```hson",
      "~~~",
      "~~~hson",
      "<after/>",
      "~~~",
    ].join("\n");
    const parts = markdown_hson_fence_marker_parts(text);
    const first = text.indexOf("hson");
    const last = text.lastIndexOf("hson");
    assert.deepEqual([...new Set(parts.map(part => part.range.start - "hson".indexOf(part.letter)))], [first, last]);
  });
  check("Markdown near-matches, other fences, prose, inline code, and disabled coloring stay untouched", () => {
    const text = [
      "hson `hson`",
      "```json",
      "hson",
      "```",
      "```Hson",
      "```",
      "```HSON",
      "```",
      "```hson-extra",
      "```",
      "``` hson",
      "```",
    ].join("\n");
    assert.deepEqual(markdown_hson_fence_marker_parts(text), []);
    assert.deepEqual(markdown_hson_fence_marker_parts("```hson\n<x/>\n```", false), []);
  });
  check("editing a Markdown fence away from and into canonical hson updates marker evidence", () => {
    const canonical = "```hson\n<thing/>\n```";
    const other = "```json\n<thing/>\n```";
    assert.equal(markdown_hson_fence_marker_parts(canonical).length, 4);
    assert.equal(markdown_hson_fence_marker_parts(canonical.replace("hson", "json")).length, 0);
    assert.equal(markdown_hson_fence_marker_parts(canonical.replace("hson", "Hson")).length, 0);
    assert.equal(markdown_hson_fence_marker_parts(other.replace("json", "hson")).length, 4);
  });
  check("Markdown remains outside every Hson diagnostic producer", () => {
    const text = "```hson\n+1\n```";
    assert.deepEqual(produce_document_diagnostics({ fileName: "/workspace/readme.md", languageId: "markdown", text }), []);
  });
  check("aliases stay ordinary while alias-tag body semantics remain recognized", () => {
    const upper = source('<thing 1>', 'Hson as authored', 'authored');
    const lower = 'import { hson as library } from "hson-live"; library.liveMap;';
    assert.deepEqual(markers(upper), []); assert.ok(nameToken(upper)); assert.deepEqual(markers(lower), []);
  });
  check("fake, wrong-package, shadowed, and property-name lookalikes stay ordinary", () => {
    const cases = [
      'const hson={}; hson.fromBinary;',
      'const Hson=String.raw; Hson.canonical`x`;',
      'import { hson } from "other"; hson.liveMap;',
      'import { Hson } from "other"; Hson.schema.fromHson(x,y);',
      'import { hson, Hson } from "hson-live"; function f(hson:any,Hson:any){ hson.liveMap; Hson.schema.fromHson(x,y); }',
      'const obj={Hson:1,hson:2}; obj.Hson; obj.hson;',
      'const text="Hson hson"; // Hson hson',
    ];
    for (const text of cases) assert.deepEqual(markers(text), []);
  });
  check("wrappers and copied tag functions do not acquire authority", () => {
    const text = 'import { Hson } from "hson-live/hson"; const copy=Hson; const wrap=(...x:any[])=>Hson(...x); copy`+1`; wrap`+1`;';
    assert.deepEqual(tokens(text), []); assert.deepEqual(diagnose(text), []);
  });
  check("invalid Hson remains highlighted", () => assert.ok(nameToken(source('<thing !!!'))));
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
    assert.equal(Hson.canonical` <thing 1 > `, '<thing 1>');
    assert.deepEqual(diagnose(source(' <thing 1 > ')), []);
  });
  check("malformed zero-Schema Hson is diagnosed", () => assert.equal(diagnose(source('<thing !!!')).length, 1));
  check("invalid to valid clears", () => { assert.equal(diagnose(source('+1')).length, 1); assert.deepEqual(diagnose(source('<thing 1>')), []); });
  check("valid to invalid publishes", () => { assert.deepEqual(diagnose(source('<thing 1>')), []); assert.equal(diagnose(source('+1')).length, 1); });
  check("no trusted provider or Schema association enters baseline production", () => {
    const text = source('+1'); assert.doesNotMatch(text, /Schema|validate|schema.use/); assert.equal(diagnose(text).length, 1);
  });
  check("Restricted Mode capability and unconditional baseline registration are packaged", () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    assert.equal(manifest.capabilities.untrustedWorkspaces.supported, 'limited');
    assert.deepEqual(manifest.contributes.semanticTokenScopes[0].scopes, hsonTokenScopes);
    assert.deepEqual(
      manifest.contributes.grammars.filter((grammar: { injectTo?: string[] }) => grammar.injectTo !== undefined)
        .map((grammar: { injectTo: string[] }) => grammar.injectTo),
      [["text.html.markdown"]],
      'the only host injection is the explicitly declared Markdown fence',
    );
    assert.deepEqual(manifest.contributes.colors.map((color: { id: string }) => color.id), [
      ...hsonIdentityMarkers.map(marker => marker.colorId), HSON_LIBRARY_SEPARATOR_COLOR_ID,
    ]);
    assert.deepEqual(manifest.contributes.colors.map((color: { defaults: object }) => color.defaults), [
      ...["#00adf6", "#c9d100", "#ff4a8c", "#39a500", "#00adf6", "#c9d100", "#ff4a8c", "#39a500", "#7247d4"]
        .map(color => ({ dark: color, light: color, highContrast: color, highContrastLight: color })),
    ]);
  });
  check("Hson tag interpolation preserves literal highlighting and excludes expressions", () => {
    const text = source('<thing ${dangerous()} other 1>'), start = text.indexOf('${'), end = text.indexOf('}', start)+1;
    assert.ok(nameToken(text));
    assert.ok(tokens(text).every(token => token.range.end <= start || token.range.start >= end));
  });
  check("quoted interpolation retains Hson string highlighting outside the expression", () => {
    const text = 'import { Hson } from "hson-live"; Hson.document`<body "${fragment}"/>`;';
    const hole = text.indexOf('${');
    const emitted = tokens(text);
    assert.ok(emitted.some(token => token.range.start <= hole - 1 && token.range.end > hole - 1));
    assert.ok(emitted.every(token => token.range.end <= hole || token.range.start >= text.indexOf('}', hole) + 1));
  });
  check("secure mode never executes interpolation or invents values", () => {
    const text = source('<thing ${(()=>{throw new Error("must not execute")})()}>');
    assert.deepEqual(diagnose(text), []);
  });
  check("irrevocable prefix lexer failure is diagnosed without a completed candidate", () => {
    const text = source('+1 ${value}'); assert.equal(diagnose(text)[0]?.code, 'HSON_NUMBER_LEADING_PLUS');
  });
  check("incomplete prefix is not guessed invalid", () => assert.deepEqual(diagnose(source('<thing ${value}>')), []));
  check("raw escape spelling is not cooked into Hson", () => {
    const text = source('<thing "\\n">'); assert.deepEqual(diagnose(text), []);
    assert.equal(Hson.canonical`<thing "\n">`, '<thing "\\n">');
  });
  check("undefined cooked segment rejects even in an Hson comment", () => {
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
    const text = 'import { Hson } from "hson-live/hson"; const view=<main>{Hson.canonical`<thing 1>`}</main>;';
    assert.ok(tokens(text, '/workspace/a.tsx').some(token => text.slice(token.range.start, token.range.end)==='thing'));
    assert.ok(tokens(text, '/workspace/a.tsx').every(token => token.range.start > text.indexOf('Hson.canonical`')));
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
  console.log(`# ${checks} zero-Schema Hson baseline checks passed`);
}
run().catch(error => { console.error(error); process.exitCode=1; });
