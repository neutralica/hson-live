import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
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
const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, "tmp"), { recursive: true });
const directory = mkdtempSync(join(root, "tmp/schema-editor-tsserver-"));
const extension = join(root, "editors/vscode-hson");
const manifest = JSON.parse(readFileSync(join(extension, "package.json"), "utf8"));
const plugin = manifest.contributes.typescriptServerPlugins[0].name;
const schema = 'import { Hson, type SchemaType } from "hson-live";\nconst before: number = "before";\nexport const Thing = Hson.schema`<type "data" content <name "string">>`;\nconst between: number = "between";\nexport const Slide = Hson.schema`<type "document">`;\nexport const Twin = Hson.schema`<type "document">`;\nexport const Page = Hson.schema`<type "document" tag "main" content "string">`;\nconst after: number = "after";\ndeclare const local: SchemaType<typeof Thing>;\nlocal.na';
const consumer = 'import { hsonLiveMap, type SchemaType, type HsonData, type HsonDocument } from "hson-live";\nimport { Thing, Slide, Twin, Page } from "./schema.js";\nimport { imported } from "./second.js";\ndeclare const value: SchemaType<typeof Thing>;\nconst wrong: number = value.name;\ndeclare const doc: HsonDocument<typeof Slide>;\nconst wrongIdentity: HsonDocument<typeof Twin> = doc;\nconst sameIdentity: HsonDocument<typeof Slide> = imported;\ntype WrongMode = HsonData<typeof Slide>;\nconst map = hsonLiveMap.fromLibraries({ home: { document: `<main "hello"/>` } });\nmap.lib("home").schema.use(Page);\nconst exactPage: typeof Page = map.lib("home").schema.get();\nconst pageText: string = map.lib("home").at([0]).snap();\n';
const file = name => join(directory, name);
writeFileSync(file("package.json"), '{"type":"module"}');
writeFileSync(file("schema.ts"), schema);
writeFileSync(file("consumer.ts"), consumer);
writeFileSync(file("second.ts"), 'import { type HsonDocument } from "hson-live"; import { Slide } from "./schema.js"; export declare const imported: HsonDocument<typeof Slide>;\n');
writeFileSync(file("tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", types: [], paths: { "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")] } }, include: ["*.ts"] }));
const originals = new Map(readdirSync(directory).map(name => [name, readFileSync(file(name))]));
const child = spawn(process.execPath, [join(root, "node_modules/typescript/lib/tsserver.js"), "--globalPlugins", plugin, "--pluginProbeLocations", extension, "--disableAutomaticTypingAcquisition", "--logVerbosity", "verbose", "--logFile", file("server.log")], { stdio: ["pipe", "pipe", "pipe"] });
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
  await check("unsaved edits refresh evidence, invalid text withdraws proof, and repair restores it", async () => {
    await edit(schema.replace('name "string"', 'name "number"'));
    const valid = await diagnostics("consumer.ts"); assert.equal(valid.length, 2, JSON.stringify(valid));
    assert.equal((await diagnostics("second.ts")).length, 0);
    await edit(schema.replace('name "string"', 'name "broken"'));
    const invalid = await diagnostics("consumer.ts"); assert.ok(invalid.some(error => error.code === 18046), JSON.stringify(invalid));
    await edit(schema.slice(0, schema.indexOf('content <name')) + 'content <');
    assert.ok((await diagnostics("consumer.ts")).some(error => error.code === 18046));
    await edit(schema); assert.equal((await diagnostics("consumer.ts")).length, 3);
    const shifted = schema.replace("const before", "// inserted before\nconst before").replace("const between", "// inserted between\nconst between");
    await edit(shifted);
    const definitions = await request("definition", { file: file("consumer.ts"), ...location(consumer, consumer.indexOf("typeof Slide") + 7) });
    assert.deepEqual(definitions[0].start, location(shifted, shifted.indexOf("Slide =")));
  });
  await check("unsaved Schema attachment refines immediately and removal withdraws the proof", async () => {
    const withoutAttachment = consumer.replace('map.lib("home").schema.use(Page);\n', "");
    await editConsumer(withoutAttachment);
    const broad = await diagnostics("consumer.ts");
    assert.ok(broad.some(error => JSON.stringify(error.start) === JSON.stringify(location(withoutAttachment, withoutAttachment.indexOf("exactPage:")))), JSON.stringify(broad));
    await editConsumer(consumer);
    assert.equal((await diagnostics("consumer.ts")).length, 3);
  });
  await check("real tsserver never writes authored source or generated evidence to disk", async () => {
    for (const [name, original] of originals) assert.deepEqual(readFileSync(file(name)), original);
    assert.equal(existsSync(file(".hson")), false);
    assert.deepEqual(readdirSync(directory).sort(), [...originals.keys(), "server.log"].sort());
  });
  events.terminal("pass"); console.log(JSON.stringify({ schemaEditorTsserver: "passed", checks, typescript: ts.version }));
} finally {
  const stopped = new Promise(resolveStop => child.once("exit", resolveStop)); child.kill(); await stopped;
  rmSync(directory, { recursive: true, force: true });
}
