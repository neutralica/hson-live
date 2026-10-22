import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { Hson } from "../dist/hson-authoring.js";
import { compile_hson_schema } from "../dist/internal/hson-schema/compiler.js";
import { discover_hson_tagged_templates } from "../dist/internal/embedded-hson/discover-hson-tagged-templates.js";
import { admit_hson_tagged_source } from "../dist/internal/embedded-hson/hson-tagged-source-admission.js";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "tooling.schema-editor-tsserver", title: "Schema bundled tsserver integration", category: "Tooling", runtime: "node", tags: Object.freeze(["schema", "editor", "typescript", "source-integrity"]) });
const events = create_test_event_emitter("tooling.schema-editor-tsserver");
let checks = 0;
async function check(name, body) {
  events.case_begin(name, name);
  try { await body(); checks++; events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
assert.equal(ts.version, "5.9.3");
const require = createRequire(import.meta.url);
const hostPath = process.env.HSON_TEST_HOST_TYPESCRIPT;
const hostTypeScript = hostPath === undefined ? ts : require(hostPath);
const serverPath = hostPath === undefined ? require.resolve("typescript/lib/tsserver.js") : join(dirname(require.resolve(hostPath)), "tsserver.js");
const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, "tmp"), { recursive: true });
const directory = mkdtempSync(join(root, "tmp/schema-editor-tsserver-"));
const extension = join(root, "editors/vscode-hson");
const manifest = JSON.parse(readFileSync(join(extension, "package.json"), "utf8"));
const plugin = manifest.contributes.typescriptServerPlugins[0].name;
const schema = 'import { Hson, type JsonFromSchema } from "hson-live";\nconst before: number = "before";\nexport const Thing = Hson.schema`<type "data" content <name "string">>`;\nconst between: number = "between";\nexport const Slide = Hson.schema`<type "document">`;\nexport const Twin = Hson.schema`<type "document">`;\nexport const Page = Hson.schema`<type "document" tag "main" content "string">`;\nconst after: number = "after";\ndeclare const local: JsonFromSchema<typeof Thing>;\nlocal.na';
const consumer = 'import { hsonLiveMap, type JsonFromSchema, type HsonData, type HsonDocument } from "hson-live";\nimport { Thing, Slide, Twin, Page } from "./schema.js";\nimport { imported } from "./second.js";\ndeclare const value: JsonFromSchema<typeof Thing>;\nconst wrong: number = value.name;\ndeclare const doc: HsonDocument<typeof Slide>;\nconst wrongIdentity: HsonDocument<typeof Twin> = doc;\nconst sameIdentity: HsonDocument<typeof Slide> = imported;\ntype WrongMode = HsonData<typeof Slide>;\nconst map = hsonLiveMap.fromLibraries({ home: { document: `<main "hello"/>` } });\nmap.doc.must("home").schema.use(Page);\nconst exactPage: typeof Page = map.doc.must("home").schema.get();\nconst pageText: string = map.doc.must("home").at([0]).snap();\n';
const file = name => join(directory, name);
writeFileSync(file("package.json"), '{"type":"module"}');
writeFileSync(file("schema.ts"), schema);
writeFileSync(file("consumer.ts"), consumer);
writeFileSync(file("second.ts"), 'import { type HsonDocument } from "hson-live"; import { Slide } from "./schema.js"; export declare const imported: HsonDocument<typeof Slide>;\n');
writeFileSync(file("tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", types: [], paths: { "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")], "hson-live/livemap": [join(root, "dist/api/livemap/index.d.ts")] } }, include: ["*.ts", "*.tsx", "*.mts", "*.cts"] }));
const completionSource = 'import { Hson, type HsonFromSchema } from "hson-live"; import { Thing as S } from "./schema.js"; type Alias<T> = HsonFromSchema<T>; const x: Alias<typeof S> = Hson.data`<na`;';
for (const ext of ["ts", "tsx", "mts", "cts"]) writeFileSync(file(`completion-${ext}.${ext}`), completionSource);
const contextual = JSON.parse(readFileSync(join(root, "tests/fixtures/contextual-completion.json"), "utf8"));
const contextualProducer = 'import { Hson } from "hson-live"; export const S = Hson.schema`' + contextual.schema + '`;';
writeFileSync(file("contextual-schema.ts"), contextualProducer);
const contextualRequests = [];
for (const ext of ["ts", "tsx", "mts", "cts", "local.ts"]) {
  const name = ext === "local.ts" ? "contextual-local.ts" : `contextual-${ext}.${ext}`;
  const prefix = 'import { Hson, type HsonFromSchema } from "hson-live";\n'
    + (ext === "local.ts" ? 'const S = Hson.schema`' + contextual.schema + '`;' : 'import { S } from "./contextual-schema.js";')
    + '\ntype Alias<T> = HsonFromSchema<T>;\nconst value: Alias<typeof S> = Hson.data`';
  for (const { name: title, body, expected } of contextual.cases) {
    const source = prefix + body.replace("|", "") + '`;\n';
    contextualRequests.push({ file: name, source, offset: prefix.length + body.indexOf("|"), title, expected });
  }
  writeFileSync(file(name), 'export {};\n');
}
const proofSource = 'import { Hson, type HsonData } from "hson-live";\nconst S = Hson.schema`<type "data" content <name "string">>`;\nconst bad: HsonData<typeof S> = Hson.data`<name 3>`;';
writeFileSync(file("proof.ts"), proofSource);
const partProducer = 'import { Hson } from "hson-live";\nexport const parts = { heading: { kind: "document", document: Hson.document`<h1 title="%{Title-Case}" "%{content}"/>` }, nav: { kind: "document", document: Hson.document`<nav "%{current}"/>` } } as const;';
writeFileSync(file("parts.ts"), partProducer);
const originals = new Map(readdirSync(directory).map(name => [name, readFileSync(file(name))]));
const child = spawn(process.execPath, [serverPath, "--globalPlugins", plugin, "--pluginProbeLocations", extension, "--disableAutomaticTypingAcquisition", "--logVerbosity", "verbose", "--logFile", file("server.log")], { stdio: ["pipe", "pipe", "pipe"] });
let sequence = 0, buffered = Buffer.alloc(0), stderr = "";
const pending = new Map();
child.stderr.on("data", data => { stderr += data; });
child.stdout.on("data", data => {
  buffered = Buffer.concat([buffered, data]);
  for (;;) {
    const boundary = buffered.indexOf("\r\n\r\n"); if (boundary < 0) return;
    const length = Number(buffered.subarray(0, boundary).toString().match(/Content-Length: (\d+)/)?.[1]);
    if (buffered.length < boundary + 4 + length) return;
    const value = JSON.parse(buffered.subarray(boundary + 4, boundary + 4 + length));
    buffered = buffered.subarray(boundary + 4 + length);
    if (value.type === "response") { const callback = pending.get(value.request_seq); pending.delete(value.request_seq); callback?.(value); }
  }
});
function request(command, args) {
  return new Promise((resolveRequest, reject) => {
    const seq = ++sequence;
    const timeout = setTimeout(() => reject(new Error(`tsserver timed out: ${command}\n${stderr}`)), 30_000);
    pending.set(seq, response => { clearTimeout(timeout); response.success ? resolveRequest(response.body) : reject(new Error(response.message)); });
    child.stdin.write(`${JSON.stringify({ seq, type: "request", command, arguments: args })}\n`);
  });
}
function location(text, offset) {
  const source = ts.createSourceFile("source.ts", text, ts.ScriptTarget.Latest);
  const position = source.getLineAndCharacterOfPosition(offset);
  return { line: position.line + 1, offset: position.character + 1 };
}
let live = schema;
async function edit(text) {
  await request("updateOpen", { changedFiles: [{ fileName: file("schema.ts"), textChanges: [{ start: { line: 1, offset: 1 }, end: location(live, live.length), newText: text }] }] });
  live = text;
}
let liveConsumer = consumer;
async function editConsumer(text) {
  await request("updateOpen", { changedFiles: [{ fileName: file("consumer.ts"), textChanges: [{ start: { line: 1, offset: 1 }, end: location(liveConsumer, liveConsumer.length), newText: text }] }] });
  liveConsumer = text;
}
const diagnostics = name => request("semanticDiagnosticsSync", { file: file(name) });
try {
  await check("contributed plugin activates in stock tsserver and supplies precise cross-module types", async () => {
    await request("open", { file: file("consumer.ts") }); await request("open", { file: file("schema.ts") });
    assert.match(readFileSync(file("server.log"), "utf8"), /Plugin validation succeeded/);
    const errors = await diagnostics("consumer.ts"); assert.equal(errors.length, 3, JSON.stringify(errors));
    assert.deepEqual(errors[0].start, location(consumer, consumer.indexOf("wrong:")));
    assert.equal(errors[0].code, 2322); assert.match(errors[0].text, /string.*number/);
    assert.equal((await diagnostics("second.ts")).length, 0);
    const hover = await request("quickinfo", { file: file("schema.ts"), ...location(schema, schema.indexOf("Slide =")) });
    assert.match(hover.displayString, /"document"/); assert.match(hover.displayString, /unique symbol/);
    assert.deepEqual(hover.start, location(schema, schema.indexOf("Slide =")));
  });
  await check("proof-only assignment errors are precise and clear after correction", async () => {
    await request("open", { file: file("proof.ts") });
    const errors = await diagnostics("proof.ts");
    assert.deepEqual(errors.map(error => error.code), [95002], JSON.stringify(errors));
    assert.deepEqual(errors[0].start, location(proofSource, proofSource.lastIndexOf("3")));
    const repaired = proofSource.replace("<name 3>", '<name "Ada">');
    await request("updateOpen", { changedFiles: [{ fileName: file("proof.ts"), textChanges: [{ start: { line: 1, offset: 1 }, end: location(proofSource, proofSource.length), newText: repaired }] }] });
    assert.deepEqual(await diagnostics("proof.ts"), []);
    await request("close", { file: file("proof.ts") });
  });
  await check("protocol diagnostics, definitions, references, rename and completions use authored ranges", async () => {
    const errors = await diagnostics("schema.ts"); assert.equal(errors.length, 4, JSON.stringify(errors));
    for (const name of ["before", "between", "after"]) assert.ok(errors.some(error => JSON.stringify(error.start) === JSON.stringify(location(schema, schema.indexOf(`const ${name}:`) + 6))));
    const definitions = await request("definition", { file: file("consumer.ts"), ...location(consumer, consumer.indexOf("typeof Slide") + 7) });
    assert.equal(definitions[0].file, file("schema.ts")); assert.deepEqual(definitions[0].start, location(schema, schema.indexOf("Slide =")));
    const refs = await request("references", { file: file("schema.ts"), ...location(schema, schema.indexOf("Slide =")) });
    assert.ok(refs.refs.some(reference => reference.file === file("consumer.ts") && reference.lineText.includes("HsonDocument")));
    assert.ok(refs.refs.every(reference => !reference.file.includes("/.hson/")));
    const rename = await request("rename", { file: file("schema.ts"), ...location(schema, schema.indexOf("Slide =")), findInComments: false, findInStrings: false });
    assert.equal(rename.info.canRename, true); assert.ok(rename.locs.every(group => !group.file.includes("/.hson/")));
    const completions = await request("completionInfo", { file: file("schema.ts"), ...location(schema, schema.length), includeExternalModuleExports: false });
    assert.ok(completions.entries.some(entry => entry.name === "name"));
    assert.deepEqual(completions.optionalReplacementSpan.start, location(schema, schema.length - 2));
  });
  await check("bundled production Hson completion resolves authored aliases and imports in all TS extensions", async () => {
    const offset = completionSource.indexOf('<na`') + 3;
    for (const ext of ["ts", "tsx", "mts", "cts"]) {
      const path = file(`completion-${ext}.${ext}`);
      await request("open", { file: path });
      const result = await request("completionInfo", { file: path, ...location(completionSource, offset), includeExternalModuleExports: false });
      assert.deepEqual(result.entries.map(entry => entry.name), ["name"], ext);
      assert.deepEqual(result.entries[0].replacementSpan, { start: location(completionSource, offset - 2), end: location(completionSource, offset) });
      const details = await request("completionEntryDetails", { file: path, ...location(completionSource, offset), entryNames: ["name"] });
      assert.match(details[0].displayParts.map(part => part.text).join(""), /required data member/);
    }
    await edit(schema.replace('name "string"', 'name "broken"'));
    const invalid = await request("completionInfo", { file: file("completion-ts.ts"), ...location(completionSource, offset) }).catch(() => undefined);
    assert.ok(!invalid?.entries.some(entry => entry.name === "name"));
    await edit(schema);
    const repaired = await request("completionInfo", { file: file("completion-ts.ts"), ...location(completionSource, offset) });
    assert.deepEqual(repaired.entries.map(entry => entry.name), ["name"]);
  });
  await check("packaged contextual completion covers collections, tuples, unions and literals in all TS extensions", async () => {
    for (const name of new Set(contextualRequests.map(item => item.file))) {
      await request("open", { file: file(name) });
      let previous = readFileSync(file(name), "utf8");
      for (const { source, offset, title, expected } of contextualRequests.filter(item => item.file === name)) {
        await request("updateOpen", { changedFiles: [{ fileName: file(name), textChanges: [{ start: { line: 1, offset: 1 }, end: location(previous, previous.length), newText: source }] }] });
        previous = source;
        const result = await request("completionInfo", { file: file(name), ...location(source, offset) }).catch(error => {
          if (!/No content available/.test(error.message)) throw error;
        });
        assert.deepEqual(result?.entries.map(entry => entry.name) ?? [], expected, `${name}: ${title}`);
        for (const entry of result?.entries ?? []) assert.ok(entry.replacementSpan, title);
      }
      await request("close", { file: file(name) });
    }
  });
  await check("packaged literal insertion preserves escaped identity, quotes and neighboring TypeScript", async () => {
    const values = ['tick`name', '${Math.random()}', 'quote"\\u0060\\Ω\n', 'e\u0301', '\u00e9', ''];
    const escaped = value => JSON.stringify(value).replace(/`/g, "\\u0060").replace(/\$\{/g, "\\u0024{");
    const schema = '<type "data" content <value <union [' + values.map(value => '<exact ' + escaped(value) + '>').join(', ') + ']>>>';
    const prefix = '\uFEFFimport { Hson, type HsonData } from "hson-live";\r\nconst S = Hson.schema`' + schema + '`;\r\nconst x: HsonData<typeof S> = Hson.data`<value ';
    const suffix = '`;\r\nconst untouched = "keep"; // keep\r\nconst adjacent = Hson.data`<value "keep">`;';
    for (const [body, from, to] of [['|>', 0, 0], ['"|old">', 1, 4], ['"|', 1, 1]]) {
      const source = prefix + body.replace("|", "") + suffix;
      await editConsumer(source);
      const offset = prefix.length + body.indexOf("|");
      const result = await request("completionInfo", { file: file("consumer.ts"), ...location(source, offset) });
      assert.deepEqual(result.entries.map(entry => entry.name), values.map(value => JSON.stringify(value)));
      for (const [i, entry] of result.entries.entries()) {
        assert.deepEqual(entry.replacementSpan, { start: location(source, prefix.length + from), end: location(source, prefix.length + to) });
        assert.equal(entry.insertText, body.startsWith('"') ? escaped(values[i]).slice(1, -1) : escaped(values[i]));
        const repaired = source.slice(0, prefix.length + from) + entry.insertText + source.slice(prefix.length + to);
        assert.ok(repaired.endsWith(suffix));
        await editConsumer(repaired);
        assert.deepEqual(await request("syntacticDiagnosticsSync", { file: file("consumer.ts") }), []);
        const discovery = discover_hson_tagged_templates(file("consumer.ts"), repaired);
        assert.equal(discovery.interpolated.length, 0);
        assert.equal(discovery.sources.length, 3);
        if (body !== '"|') {
          const site = discovery.sources.find(site => site.authoringKind === "data");
          assert.ok(site);
          assert.deepEqual(Hson.data.materialize(Hson.data.fromHson(admit_hson_tagged_source(site))), { value: values[i] });
        }
      }
    }
    await editConsumer(consumer);
  });
  await check("packaged contextual requests refresh imported Schema edits and preserve interpolation completion", async () => {
    const prefix = 'import { Hson, type HsonData } from "hson-live"; import { S } from "./contextual-schema.js"; declare const dynamic: string; const x: HsonData<typeof S> = Hson.data`';
    const marked = prefix + '<blocks [<kind "code" language |>]>`;';
    const source = marked.replace("|", "");
    await editConsumer(source);
    const complete = async () => (await request("completionInfo", { file: file("consumer.ts"), ...location(source, marked.indexOf("|")) }).catch(error => {
      if (!/No content available/.test(error.message)) throw error;
    }))?.entries.map(entry => entry.name) ?? [];
    assert.deepEqual(await complete(), ['"ts"', '"tsx"']);
    await request("open", { file: file("contextual-schema.ts") });
    let previous = contextualProducer;
    for (const [next, expected] of [
      [contextualProducer.replace('<exact "tsx">', '<exact "js">'), ['"ts"', '"js"']],
      [contextualProducer.replace('<exact "code">', '<exact "program">'), []],
      [contextualProducer.replace('"data"', '"broken"'), []],
      [contextualProducer, ['"ts"', '"tsx"']],
    ]) {
      await request("updateOpen", { changedFiles: [{ fileName: file("contextual-schema.ts"), textChanges: [{ start: { line: 1, offset: 1 }, end: location(previous, previous.length), newText: next }] }] });
      previous = next;
      for (let i = 0; i < 3; i++) assert.deepEqual(await complete(), expected);
    }
    const interpolated = prefix + '<blocks [<kind ${dynamic} >]>`;';
    await editConsumer(interpolated);
    const result = await request("completionInfo", { file: file("consumer.ts"), ...location(interpolated, interpolated.indexOf("dynamic}") + 3) });
    assert.ok(result.entries.some(entry => entry.name === "dynamic"));
    assert.ok(!result.entries.some(entry => ["title", "language", "items", "kind"].includes(entry.name)));
    for (const [body, expected] of [['<tones [${dynamic}, |]>', ['"Warm"', '"cool"']], ['<blocks [<kind "${dynamic}" |>]>', []]]) {
      const marked = prefix + body + '`;';
      const source = marked.replace("|", "");
      await editConsumer(source);
      const result = await request("completionInfo", { file: file("consumer.ts"), ...location(source, marked.indexOf("|")) }).catch(error => {
        if (!/No content available/.test(error.message)) throw error;
      });
      assert.deepEqual(result?.entries.map(entry => entry.name) ?? [], expected);
    }
    await editConsumer(consumer);
  });
  await check("bundled reference completion cannot replace host statements and filters document capabilities", async () => {
    const prefix = 'import { Hson } from "hson-live"; const S = Hson.schema`<type "document" defs <Title "string" Card <tag "article" content "empty">> tag "main" content <sequence «<ref "';
    const suffix = '`;\nconst after = 123;\n// untouched\nconst adjacent = Hson.data`<value "keep">`;';
    const source = prefix + 'Ca' + suffix;
    await editConsumer(source);
    const result = await request("completionInfo", { file: file("consumer.ts"), ...location(source, prefix.length + 2) });
    assert.deepEqual(result.entries.map(entry => entry.name), ["Card"]);
    assert.deepEqual(result.entries[0].replacementSpan, { start: location(source, prefix.length), end: location(source, prefix.length + 2) });
    assert.ok((source.slice(0, prefix.length) + result.entries[0].name + source.slice(prefix.length + 2)).endsWith(suffix));
    await editConsumer(consumer);
  });
  await check("bundled reference completion retains empty and nonempty forward definitions", async () => {
    for (const [body, expected] of [
      ['<type "data" defs <First <ref "|"> Title "string"> content <ref "First">>', ["First", "Title"]],
      ['<type "document" defs <First <tag "main" content <sequence «<ref "|">»>> Title "string" Card <tag "article" content "empty">> content <sequence «<ref "First">»>>', ["First", "Card"]],
    ]) {
      for (const name of ["", "Missing"]) {
        const marked = 'import { Hson } from "hson-live"; const S = Hson.schema`' + body + '`;\nconst after = "untouched";';
        const offset = marked.indexOf('|'), source = marked.replace('|', name);
        await editConsumer(source);
        const result = await request("completionInfo", { file: file("consumer.ts"), ...location(source, offset + name.length) });
        assert.deepEqual(result.entries.map(entry => entry.name), expected);
        for (const entry of result.entries) assert.deepEqual(entry.replacementSpan, { start: location(source, offset), end: location(source, offset + name.length) });
        // Schema declaration diagnostics belong to the existing authoring
        // provider; tsserver separately owns candidate/TypeScript diagnostics.
        const invalid = compile_hson_schema(body.replace('|', name));
        assert.ok(!invalid.ok && invalid.issues.some(issue => /ref|definition/i.test(issue.message)), "The original invalid reference retains its Schema diagnostic");
      }
    }
    await editConsumer(consumer);
  });
  await check("bundled inserted names survive TypeScript syntax and Hson Schema decoding exactly", async () => {
    const names = [
      ['tick`name', "'tick\\u0060name'"],
      ['${Math.random()}', "'\\u0024{Math.random()}'"],
      ['quote"\\u0060\\Ω\n', "'quote\"\\\\u0060\\\\\\u03a9\\n'"],
    ];
    const body = '<type "data" defs <' + names.map(([, authored]) => authored + ' "string"').join(' ') + '> content <ref "">>';
    const source = 'import { Hson } from "hson-live"; const S = Hson.schema`' + body + '`;\nconst after = "untouched"; // keep\nconst adjacent = Hson.data`<value "keep">`;';
    const offset = source.indexOf('<ref "') + 6;
    await editConsumer(source);
    const result = await request("completionInfo", { file: file("consumer.ts"), ...location(source, offset) });
    assert.deepEqual(result.entries.map(entry => entry.name), names.map(([name]) => name));
    for (const entry of result.entries) {
      assert.equal(typeof entry.insertText, "string");
      assert.deepEqual(entry.replacementSpan, { start: location(source, offset), end: location(source, offset) });
      const repaired = source.slice(0, offset) + entry.insertText + source.slice(offset);
      assert.ok(repaired.endsWith(source.slice(offset)), "Host statements and the adjacent template survive unchanged");
      await editConsumer(repaired);
      assert.deepEqual(await request("syntacticDiagnosticsSync", { file: file("consumer.ts") }), []);
      const discovered = discover_hson_tagged_templates(file("consumer.ts"), repaired);
      assert.equal(discovered.interpolated.length, 0);
      assert.equal(discovered.sources.length, 2);
      const schema = discovered.sources.find(site => site.authoringKind === "schema");
      assert.ok(schema);
      const parsed = compile_hson_schema(admit_hson_tagged_source(schema));
      assert.ok(parsed.ok, entry.name);
      const reference = parsed.value.symbols.references[0];
      assert.equal(reference.name, entry.name);
      assert.equal(reference.targetId, parsed.value.symbols.definitions.find(definition => definition.name === entry.name).id);
      assert.equal((await diagnostics("consumer.ts")).length, 0);
    }
    await editConsumer(consumer);
  });
  await check("unsaved edits refresh evidence, invalid text withdraws proof, and repair restores it", async () => {
    await edit(schema.replace('name "string"', 'name "number"'));
    const valid = await diagnostics("consumer.ts"); assert.equal(valid.length, 2, JSON.stringify(valid));
    assert.equal((await diagnostics("second.ts")).length, 0);
    await edit(schema.replace('name "string"', 'name "broken"'));
    const invalid = await diagnostics("consumer.ts"); assert.ok(invalid.some(error => error.code === 2344 && error.text.includes("HsonSchemaMode")), JSON.stringify(invalid));
    await edit(schema.slice(0, schema.indexOf('content <name')) + 'content <');
    assert.ok((await diagnostics("consumer.ts")).some(error => error.code === 2344 && error.text.includes("HsonSchemaMode")));
    await edit(schema); assert.equal((await diagnostics("consumer.ts")).length, 3);
    const shifted = schema.replace("const before", "// inserted before\nconst before").replace("const between", "// inserted between\nconst between");
    await edit(shifted);
    const definitions = await request("definition", { file: file("consumer.ts"), ...location(consumer, consumer.indexOf("typeof Slide") + 7) });
    assert.deepEqual(definitions[0].start, location(shifted, shifted.indexOf("Slide =")));
  });
  await check("unsaved duplicate Schema names withdraw all proof and repair without restart", async () => {
    const duplicate = `${schema}\nexport const Thing = Hson.schema\`<type "data" content <other "number">>\`;\n`;
    await edit(duplicate);
    assert.ok((await diagnostics("schema.ts")).some(error => error.code === 2451));
    assert.ok((await diagnostics("consumer.ts")).some(error => error.code === 2344 && error.text.includes("HsonSchemaMode")));
    await edit(schema);
    assert.equal((await diagnostics("consumer.ts")).length, 3);
  });
  await check("unsaved Schema attachment refines immediately and removal withdraws the proof", async () => {
    const withoutAttachment = consumer.replace('map.doc.must("home").schema.use(Page);\n', "");
    await editConsumer(withoutAttachment);
    const broad = await diagnostics("consumer.ts");
    assert.ok(broad.some(error => JSON.stringify(error.start) === JSON.stringify(location(withoutAttachment, withoutAttachment.indexOf("exactPage:")))), JSON.stringify(broad));
    await editConsumer(consumer);
    assert.equal((await diagnostics("consumer.ts")).length, 3);
    await editConsumer(consumer.replaceAll('doc.must("home")', 'doc["home"]'));
    assert.equal((await diagnostics("consumer.ts")).length, 3);
    await editConsumer(consumer);
  });
  await check("bundled tsserver completes final Library families, members and required reads", async () => {
    const prefix = `import { Hson, hsonLiveMap } from "hson-live";
import { Thing, Page } from "./schema.js";
const loc = hsonLiveMap.locus.create({
  deck: { data: { name: "Ada" }, schema: Thing },
  page: { document: Hson.document\`<main "hello"/>\`, schema: Page },
  components: { parts: { submit: { kind: "document", document: Hson.document\`<button/>\` } } },
});
`;
    for (const [expression, present, absent] of [
      ["loc.", ["doc", "data", "parts", "admit"], ["lib", "addLibraries"]],
      ["loc.data.", ["deck", "must"], ["page", "components"]],
      ["loc.doc.", ["page"], ["deck"]],
      ["loc.parts.components.", ["submit", "snap", "hson"], ["render"]],
      ['loc.data.must("deck", Thing).snap().', ["name"], []],
      ["loc.doc.page.at([0]).must.", ["snap", "hson"], ["render", "data"]],
      ["loc.parts.components.schema.", ["get"], ["use"]],
    ]) {
      const text = prefix + expression;
      await editConsumer(text);
      const completion = await request("completionInfo", { file: file("consumer.ts"), ...location(text, text.length) });
      const names = completion.entries.map(entry => entry.name);
      for (const name of present) assert.ok(names.includes(name), `${expression}: missing ${name}`);
      for (const name of absent) assert.ok(!names.includes(name), `${expression}: obsolete/unsupported ${name}`);
    }
    const invalid = prefix + 'loc.admit({ incoming: { data: { name: 42 }, schema: Thing } });';
    await editConsumer(invalid);
    assert.equal((await diagnostics("consumer.ts")).filter(error => error.code === 95002).length, 1);
    await editConsumer(invalid.replace('name: 42', 'name: "new"'));
    assert.equal((await diagnostics("consumer.ts")).length, 0);
    await editConsumer(consumer);
  });
  await check("bundled diagnostics underline authored static candidates and clear on unsaved repair", async () => {
    const text = 'import { Hson, hsonLiveMap, type HsonAuthored, type HsonFromSchema } from "hson-live";\nconst S = Hson.schema`<type "document" tag "html" content <sequence «<tag "head">, <tag "body">»>>`;\ntype PageHson = HsonFromSchema<typeof S>; const bad: HsonAuthored = Hson.document`<html <body/>/>`;\nconst certified: PageHson = S.certify(bad); S.certify(bad);\nhsonLiveMap.fromLibraries({ page: { document: Hson.document`<html <body/> <head/>/>`, schema: S } });\n';
    await editConsumer(text);
    const all = await diagnostics("consumer.ts");
    assert.ok(!all.some(error => error.code === 2322), JSON.stringify(all));
    const errors = all.filter(error => error.code === 95002);
    assert.equal(errors.length, 2, JSON.stringify(errors));
    assert.ok(errors.some(error => /missing required/.test(error.text)), JSON.stringify(errors));
    assert.ok(errors.some(error => /wrong tag/.test(error.text)), JSON.stringify(errors));
    assert.ok(errors.every(error => error.start.line === 3 || error.start.line === 5));
    assert.ok(errors.every(error => !error.text.includes(".hson/")));
    await editConsumer(text.replace('<html <body/>/>', '<html <head/> <body/>/>').replace('<html <body/> <head/>/>', '<html <head/> <body/>/>'));
    assert.equal((await diagnostics("consumer.ts")).length, 0);
    await editConsumer(consumer);
  });
  await check("bundled proof filtering follows malformed initializers through CRLF unsaved edits", async () => {
    const text = '\uFEFFimport { Hson, type HsonData, type JsonFromSchema } from "hson-live";\r\nconst S = Hson.schema`<type "data" content <name "string">>`;\r\nconst malformed: HsonData<typeof S> = Hson.data`\r\n <name "Ada"`;\r\nconst unrelated: number = "wrong";\r\nconst field: JsonFromSchema<typeof S> = { name: 37 };\r\ndeclare const dynamic: HsonData;\r\nconst unproven: HsonData<typeof S> = dynamic;\r\n';
    await editConsumer(text);
    const errors = await diagnostics("consumer.ts");
    assert.equal(errors.length, 3, JSON.stringify(errors));
    for (const name of ["unrelated:", "name: 37", "unproven:"]) assert.ok(errors.some(error => error.code === 2322
      && JSON.stringify(error.start) === JSON.stringify(location(text, text.indexOf(name)))), JSON.stringify(errors));
    const invalid = text.replace('<name "Ada"', '<name 37>');
    await editConsumer(invalid);
    const invalidErrors = await diagnostics("consumer.ts");
    const candidate = invalidErrors.find(error => error.code === 95002);
    assert.ok(candidate, JSON.stringify(invalidErrors));
    assert.deepEqual(candidate.start, location(invalid, invalid.indexOf("37>")));
    assert.deepEqual(candidate.end, location(invalid, invalid.indexOf("37>") + 2));
    assert.equal(invalidErrors.filter(error => error.code === 2322).length, 3);
    await editConsumer(text.replace('<name "Ada"', '<name "Ada">'));
    assert.equal((await diagnostics("consumer.ts")).length, 3);
    await editConsumer(consumer);
  });
  await check("bundled attribute and uniqueness diagnostics preserve collision locations", async () => {
    const text = 'import { Hson } from "hson-live";\r\nconst Doc = Hson.schema`<type "document" tag "main" attrs <props <lang <exact "en">>> content "empty">`;\r\nDoc.certify(Hson.document`<main\r\n lang="fr"/>`);\r\nconst Unique = Hson.schema`<type "data" content <items <array <content <content <kind "string">> unique <by "kind" cases [["a", ["K"]], ["b", ["K"]]]>>>>>`;\r\nUnique.certify(Hson.data`<items [\r\n<kind "a">,\r\n<kind "b">]>`);\r\n';
    await editConsumer(text);
    const errors = await diagnostics("consumer.ts");
    assert.equal(errors.length, 2, JSON.stringify(errors));
    const attr = errors.find(error => error.text.includes("satisfy Doc"));
    assert.match(attr.text, /at 0 attribute "lang"; expected "en"; received "fr"/);
    assert.deepEqual(attr.start, location(text, text.indexOf('"fr"')));
    const collision = errors.find(error => error.text.includes("satisfy Unique"));
    assert.deepEqual(collision.start, location(text, text.lastIndexOf('"b"')));
    const earlier = collision.relatedInformation?.[0];
    assert.equal(earlier.span.file, file("consumer.ts"));
    assert.deepEqual(earlier.span.start, location(text, text.lastIndexOf('"a"')));
    assert.deepEqual(earlier.span.end, location(text, text.lastIndexOf('"a"') + 3));
    assert.match(earlier.message, /items.0.kind.*"K"/);
    await editConsumer(consumer);
  });
  await check("bundled proof errors stay independent of expectation and nested-template failures", async () => {
    const text = '\uFEFFimport { Hson, type HsonData } from "hson-live";\r\nconst S = Hson.schema`<type "data" content <name "string">>`;\r\ndeclare const dynamic: string;\r\nconst unused: HsonData<typeof S> = Hson.data`<name ${(() => {\r\n// @hson-expect-error HSON_NUMBER_LEADING_PLUS\r\nreturn "Ada";\r\n})()}>`;\r\nconst nested: HsonData<typeof S> = Hson.data`<name ${Hson.data`+1`}>`;\r\nconst own: HsonData<typeof S> = Hson.data`+1 ${missing}`;\r\nconst escaped: HsonData<typeof S> = Hson.data`// \\8\r\n<name "Ada">`;\r\nconst outer: HsonData<typeof S> = Hson.data`<name ${dynamic}>`;\r\nconst unrelated: number = "wrong";\r\n';
    const assertErrors = async (source, ownProof) => {
      const errors = await diagnostics("consumer.ts");
      const assignments = errors.filter(error => error.code === 2322);
      assert.equal(assignments.length, ownProof ? 5 : 4, JSON.stringify(errors));
      for (const name of ["unused:", "nested:", ...(ownProof ? ["own:"] : []), "outer:", "unrelated:"]) {
        assert.ok(assignments.some(error => JSON.stringify(error.start) === JSON.stringify(location(source, source.indexOf(name)))), `${name}: ${JSON.stringify(errors)}`);
      }
      assert.ok(errors.some(error => error.code === 2304 && JSON.stringify(error.start) === JSON.stringify(location(source, source.indexOf("missing")))), JSON.stringify(errors));
    };
    await editConsumer(text);
    await assertErrors(text, false);
    const repaired = text.replace('Hson.data`+1`', 'Hson.data`<name "Ada">`').replace('+1 ${missing}', '<name ${missing}>').replace('\\8', '\\\\8');
    await editConsumer(repaired);
    await assertErrors(repaired, true);
    await editConsumer(consumer);
  });
  await check("optional-chain candidate and producer tags retain grammar diagnostics until repaired", async () => {
    const schema = '<type "data" content <name "string">>';
    const text = '\uFEFF' + ['import { Hson, type HsonData } from "hson-live";', `const S = Hson.schema\`${schema}\`;`,
      'const access: HsonData<typeof S> = Hson?.data`<name "Ada">`;',
      'const tagged: HsonData<typeof S> = Hson.data?.`<name "Ada">`;',
      `const AccessSchema = Hson?.schema\`${schema}\`;`, 'const fromAccess: HsonData<typeof AccessSchema> = Hson.data`<name "Ada">`;',
      `const TaggedSchema = Hson.schema?.\`${schema}\`;`, 'const fromTagged: HsonData<typeof TaggedSchema> = Hson.data`<name "Ada">`;',
      'const valid: HsonData<typeof S> = Hson.data`<name "Ada">`;', 'const unrelated: number = "wrong";',
    ].join('\r\n');
    await editConsumer(text);
    const errors = await diagnostics("consumer.ts");
    assert.equal(errors.filter(error => error.code === 1358).length, 4, JSON.stringify(errors));
    for (const name of ["access:", "tagged:", "unrelated:"]) {
      assert.ok(errors.some(error => error.code === 2322 && JSON.stringify(error.start) === JSON.stringify(location(text, text.indexOf(name)))), `${name}: ${JSON.stringify(errors)}`);
    }
    for (const name of ["AccessSchema", "TaggedSchema"]) assert.ok(errors.some(error => error.code === 2344
      && JSON.stringify(error.start) === JSON.stringify(location(text, text.indexOf(`typeof ${name}`)))), JSON.stringify(errors));
    const repaired = text.replaceAll("Hson?.", "Hson.").replaceAll("?.`", "`");
    await editConsumer(repaired);
    const repairedErrors = await diagnostics("consumer.ts");
    assert.equal(repairedErrors.length, 1, JSON.stringify(repairedErrors));
    assert.equal(repairedErrors[0].code, 2322);
    assert.deepEqual(repairedErrors[0].start, location(repaired, repaired.indexOf("unrelated:")));
    await editConsumer(consumer);
  });
  await check("upstream Schema producer rejection withdraws attachment precision and recovers unsaved", async () => {
    const body = '<type "data" content <name "string">>';
    const valid = `import { Hson, hsonLiveMap } from "hson-live";\r\nconst Bad = Hson.schema\`${body}\`;\r\nconst map = hsonLiveMap.fromLibraries({ state: { data: { name: "Ada" } } });\r\nmap.data.must("state").schema.use(Bad);\r\nconst name: string = map.data.must("state").at(["name"]).snap();\r\nconst wrong: number = map.data.must("state").at(["name"]).snap();\r\n`;
    const assertValid = async () => {
      const errors = await diagnostics("consumer.ts");
      assert.equal(errors.length, 1, JSON.stringify(errors));
      assert.equal(errors[0].code, 2322); assert.deepEqual(errors[0].start, location(valid, valid.indexOf("wrong:")));
      assert.match(errors[0].text, /string.*number/);
    };
    await editConsumer(valid); await assertValid();
    for (const initializer of [`Hson.schema\`// \\8\r\n${body}\``, `Hson?.schema\`${body}\``, `Hson.schema?.\`${body}\``, `(Hson?.schema\`${body}\`)`]) {
      const source = valid.replace(`Hson.schema\`${body}\``, initializer);
      await editConsumer(source);
      const errors = await diagnostics("consumer.ts");
      assert.ok(errors.some(error => error.code === 2322 && JSON.stringify(error.start) === JSON.stringify(location(source, source.indexOf("const name:") + 6))), JSON.stringify(errors));
      if (initializer.includes("?.")) assert.ok(errors.some(error => error.code === 1358), JSON.stringify(errors));
      await editConsumer(valid); await assertValid();
    }
    await editConsumer(consumer);
  });
  await check("bundled Part completion applies exact edits in all four contexts and refreshes imported inventories", async () => {
    const prefix = '\uFEFFimport { Hson, hson } from "hson-live";\r\nimport { parts } from "./parts.js";\r\ndeclare const dynamic: any;\r\nconst loc = hson.liveMap.locus.create({ components: { parts } });\r\nconst page = Hson.document`';
    const suffix = '`;\r\nconst untouched = "keep";';
    const fixtures = [
      ['<hson-part lib=|/>', 'components', '<hson-part lib="components"/>'],
      ['<hson-part lib=|"co"/>', 'components', '<hson-part lib="components"/>'],
      ['<hson-part lib="components" at=|"he"/>', 'heading', '<hson-part lib="components" at="heading"/>'],
      ['<hson-part lib="co|', 'components', '<hson-part lib="components"'],
      ['<hson-part lib="components" at="\\u0068e|ading"/>', 'heading', '<hson-part lib="components" at="heading"/>'],
      ['<hson-part lib="components" at="heading" Ti|tle-old="x" content="kept"/>', 'Title-Case', '<hson-part lib="components" at="heading" Title-Case="x" content="kept"/>'],
      ['<main ${Hson.document`<hson-part lib="components" at="he|"/>`}/>', 'heading', '<main ${Hson.document`<hson-part lib="components" at="heading"/>`}/>'],
    ];
    const offsetAt = (source, position) => ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest).getPositionOfLineAndCharacter(position.line - 1, position.offset - 1);
    for (const [body, label, expected] of fixtures) {
      const source = prefix + body.replace("|", "") + suffix;
      const offset = prefix.length + body.indexOf("|"); await editConsumer(source);
      const result = await request("completionInfo", { file: file("consumer.ts"), ...location(source, offset) });
      const entry = result.entries.find(entry => entry.name === label); assert.ok(entry, JSON.stringify(result));
      const from = offsetAt(source, entry.replacementSpan.start), to = offsetAt(source, entry.replacementSpan.end);
      assert.equal(source.slice(0, from) + entry.insertText + source.slice(to), prefix + expected + suffix);
      const details = await request("completionEntryDetails", { file: file("consumer.ts"), ...location(source, offset), entryNames: [label] });
      assert.match(details[0].displayParts.map(part => part.text).join(""), /possible source context/);
    }
    for (const [body, label, expected] of [
      ['<h1 "%{Title-Case}" "%{Ti|}"/>', 'Title-Case', '<h1 "%{Title-Case}" "%{Title-Case}"/>'],
      ['<h1 title="%{content}" id=%{co|}/>', 'content', '<h1 title="%{content}" id=%{content}/>'],
      [String.raw`<h1 title="%{content}" id="%{\u0063o|}"/>`, 'content', '<h1 title="%{content}" id="%{content}"/>'],
      ['<script src="/app.js" title="%{content}" id="%{co|}"/>', 'content', '<script src="/app.js" title="%{content}" id="%{content}"/>'],
      ['<style media="%{content}" id=%{co|}/>', 'content', '<style media="%{content}" id=%{content}/>'],
    ]) {
      const before = 'import { Hson, hsonLiveMap } from "hson-live";\r\nconst page = Hson.document`';
      const after = '`;\r\nconst loc = hsonLiveMap.fromLibraries({ components: { parts: { heading: { kind: "document", document: page } } } });';
      const marked = before + body + after, source = marked.replace('|', ''); await editConsumer(source);
      const spelling = (await request("completionInfo", { file: file("consumer.ts"), ...location(source, marked.indexOf("|")) })).entries.find(entry => entry.name === label);
      assert.ok(spelling, body);
      assert.equal(source.slice(0, offsetAt(source, spelling.replacementSpan.start)) + spelling.insertText + source.slice(offsetAt(source, spelling.replacementSpan.end)), before + expected + after);
    }
    for (const body of ['<hson-part lib=|"co', String.raw`<hson-part lib=|"co\q"/>`, '<script title="%{content}" <span id="%{co|}"/>/>', '<style media="%{content}" <span "%{co|}"/>/>', String.raw`<h1 title="%{content}" id="%{\u00|63o}"/>`]) {
      const after = '`;\r\nconst owned = hson.liveMap.fromLibraries({ parts: { parts: { item: { kind: "document", document: page } } } });';
      const source = prefix + body.replace('|', '') + after; await editConsumer(source);
      const result = await request('completionInfo', { file: file('consumer.ts'), ...location(source, prefix.length + body.indexOf('|')) }).catch(error => {
        if (!/No content available/.test(error.message)) throw error;
      });
      assert.ok(!result?.entries.some(entry => ['content', 'components'].includes(entry.name)), body);
    }
    const body = '<hson-part lib="components" at="|"/>';
    const consumerSource = prefix + body.replace("|", "") + suffix;
    await editConsumer(consumerSource); await request("open", { file: file("parts.ts") });
    const names = async () => (await request("completionInfo", { file: file("consumer.ts"), ...location(consumerSource, prefix.length + body.indexOf("|")) })).entries.map(entry => entry.name);
    assert.deepEqual(await names(), ["heading", "nav"]);
    const changed = partProducer.replace('heading:', 'hero:');
    await request("updateOpen", { changedFiles: [{ fileName: file("parts.ts"), textChanges: [{ start: { line: 1, offset: 1 }, end: location(partProducer, partProducer.length), newText: changed }] }] });
    assert.deepEqual(await names(), ["hero", "nav"]);
    await request("close", { file: file("parts.ts") });
    await editConsumer(consumer);
  });
  await check("real tsserver never writes authored source or generated evidence to disk", async () => {
    for (const [name, original] of originals) assert.deepEqual(readFileSync(file(name)), original);
    assert.equal(existsSync(file(".hson")), false);
    assert.deepEqual(readdirSync(directory).sort(), [...originals.keys(), "server.log"].sort());
  });
  events.terminal("pass"); console.log(JSON.stringify({ schemaEditorTsserver: "passed", checks, typescript: hostTypeScript.version }));
} finally {
  const stopped = new Promise(resolveStop => child.once("exit", resolveStop)); child.kill(); await stopped;
  rmSync(directory, { recursive: true, force: true });
}
