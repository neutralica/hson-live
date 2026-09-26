import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { generate_hson_schema_evidence } from "../src/internal/hson-schema/generated-evidence.ts";
import { create_test_event_emitter } from "./test-events.mjs";
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "hson-schema-cutover", title: "Hson Schema default cutover and publishing", category: "Tooling", runtime: "node", tags: Object.freeze(["hson-schema", "typescript", "source-integrity", "publishing"]) });
const events = create_test_event_emitter("hson-schema-cutover");
let checks = 0;
function check(name: string, body: () => void): void {
  events.case_begin(name, name);
  try { body(); events.case_end(name, "pass"); console.log(`ok ${++checks} - ${name}`); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
assert.equal(ts.version, "5.9.3");
const root = resolve("."); mkdirSync(join(root, "tmp"), { recursive: true });
const project = mkdtempSync(join(root, "tmp/schema-cutover-"));
process.once("exit", () => rmSync(project, { recursive: true, force: true }));
const config = join(project, "tsconfig.json");
const schema = '<type "data" content <phase <exact "ready"> age <number <int true min 0>>>>';
const authored = new Map<string, Buffer>();
function source(name: string, text: string): void { const bytes = Buffer.from(text); authored.set(name, bytes); writeFileSync(join(project, name), bytes); }
source("schema.ts", '\uFEFF// preserve this comment\r\nimport { Hson } from "hson-live";\r\nimport type { HsonSchema } from "hson-live";\r\nconst unrelated  : number = 37; void unrelated;\r\n' + `export const S: HsonSchema = Hson.schema\`${schema}\`;\r\nexport const Twin = Hson.schema\`${schema}\`;\r\nexport function getSchema() { return S; }\r\nexport const arrow = () => S;\r\nexport const holder = { schema: S, method() { return S; } };`);
source("contract.d.ts", "export interface Contract { readonly label: string }\n//# sourceMappingURL=unpublished-development.map\n");
source("helper.ts", 'import type { Contract } from "./contract.js";\nexport const contract: Contract = { label: "test" };\nimport { S } from "./schema.js";\nexport const Alias = S;\nexport function imported() { return S; }\n');
source("index.ts", 'export * from "./schema.js";\nexport * from "./helper.js";\n');
writeFileSync(join(project, "package.json"), '{"type":"module"}');
writeFileSync(config, JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ESNext", types: [], rootDir: ".", outDir: "dist", declaration: true, declarationMap: true, sourceMap: true, inlineSources: true, paths: { "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")] } }, include: ["*.ts"] }));
function run(mode: string, extra: string[] = []) { return spawnSync(process.execPath, [join(root, "dist/hson-schema.mjs"), mode, "--project", config, ...extra], { encoding: "utf8", timeout: 120_000 }); }
function pass(result: ReturnType<typeof run>): void { assert.equal(result.status, 0, result.stdout + result.stderr); }
function preserve(): void { for (const [path, bytes] of authored) assert.deepEqual(readFileSync(join(project, path)), bytes, path); }
const stable = join(project, ".hson/compiler-input/tsconfig.json/tsconfig.json");
function selected(): string { return dirname(resolve(dirname(stable), JSON.parse(readFileSync(stable, "utf8")).extends)); }
check("missing verification fails without generating or modifying source", () => { const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stderr, /Missing/); preserve(); });
for (const mode of ["generate", "verify", "check", "build"]) check(`${mode} preserves BOM, CRLF, comments, spacing, annotations and missing newline`, () => { pass(run(mode)); preserve(); });
check("published selected state is checkable by stock TypeScript", () => {
  pass(spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", stable], { encoding: "utf8" }));
});
check("source and config edits fail read-only freshness; incompatible tooling fails clearly", () => {
  const selector = readFileSync(stable);
  writeFileSync(join(project, "helper.ts"), `${authored.get("helper.ts")!.toString()}\n// changed`);
  const stale = run("verify"); assert.notEqual(stale.status, 0); assert.match(stale.stderr, /Stale/); assert.deepEqual(readFileSync(stable), selector);
  writeFileSync(join(project, "helper.ts"), authored.get("helper.ts")!);
  const prior = readFileSync(config); writeFileSync(config, `${prior.toString()}\n`); assert.notEqual(run("verify").status, 0); writeFileSync(config, prior);
  // Selector's manifest digest also protects compatibility metadata from edits.
  const manifest = join(selected(), "manifest.json"), original = readFileSync(manifest);
  const incompatible = original.toString().replace('compiler-project-4', 'compiler-project-0');
  writeFileSync(manifest, incompatible);
  const oldSelector = JSON.parse(selector.toString()); oldSelector.$hsonSchema.manifestDigest = createHash("sha256").update(incompatible).digest("hex");
  writeFileSync(stable, JSON.stringify(oldSelector));
  const mismatch = run("verify"); assert.notEqual(mismatch.status, 0); assert.match(mismatch.stderr, /Incompatible/);
  writeFileSync(manifest, original); writeFileSync(stable, selector);
  pass(run("verify")); preserve();
});
function files(directory: string): string[] { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]); }
check("separate runtime matches stock authored emit; declarations and maps contain no development layout", () => {
  const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => { throw new Error(String(d.messageText)); } })!;
  const options = { ...parsed.options, declaration: false, declarationMap: false, noEmitOnError: false };
  const program = ts.createProgram(parsed.fileNames, options);
  program.emit(undefined, (path, text, bom) => assert.equal(readFileSync(path, "utf8"), (bom ? "\uFEFF" : "") + text));
  const emitted = files(join(project, "dist"));
  for (const path of emitted) assert.doesNotMatch(readFileSync(path, "utf8"), /\.hson[\/\\]|compiler-input|revision-[A-Za-z0-9]+/);
  assert.equal(emitted.filter(path => /\.[cm]?js$/.test(path)).length, 3);
  assert.equal(emitted.filter(path => path.includes("/internal/") && /\.[cm]?js$/.test(path)).length, 0);
  const map = JSON.parse(readFileSync(join(project, "dist/schema.d.ts.map"), "utf8"));
  assert.deepEqual(map.sources, ["../schema.ts"]);
  assert.ok(map.mappings.length > 0);
  assert.match(readFileSync(join(project, "dist/schema.d.ts"), "utf8"), /getSchema\(\).*HsonSchema/s);
});
check("a separate stock compiler consumes package declarations with one origin and private proofs", () => {
  const consumer = join(project, "consumer-project"), pkg = join(consumer, "node_modules/schema-package"); mkdirSync(pkg, { recursive: true });
  cpSync(join(project, "dist"), join(pkg, "dist"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "schema-package", type: "module", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./schema": { types: "./dist/schema.d.ts", import: "./dist/schema.js" } } }));
  writeFileSync(join(consumer, "package.json"), '{"type":"module"}');
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, noEmit: true, types: [], target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", paths: { "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")] } }, files: ["consumer.ts"] }));
  writeFileSync(join(consumer, "consumer.ts"), `import { S, Twin, Alias, getSchema, imported, arrow, holder, contract } from "schema-package";
import { S as Direct } from "schema-package/schema";
import type { HsonData, SchemaType } from "hson-live";
const label: string = contract.label;
const a: typeof S = getSchema(); const b: typeof S = imported(); const c: typeof S = arrow();
const d: typeof S = holder.schema; const e: typeof S = holder.method(); const alias: typeof S = Alias;
declare const data: HsonData<typeof S>; const same: HsonData<typeof Direct> = data;
// @ts-expect-error identical schemas from separate declarations have distinct identities
const other: HsonData<typeof Twin> = data;
declare const value: SchemaType<typeof S>; const exact: "ready" = value.phase;
// @ts-expect-error refinement proof cannot be fabricated
const age: SchemaType<typeof S>["age"] = 3;
void [a,b,c,d,e,alias,same,other,exact,age];`);
  pass(spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(consumer, "tsconfig.json")], { encoding: "utf8", timeout: 120_000 }));
});
check("named Schema reexports remain rejected without changing authored bytes", () => {
  source("named.ts", 'export { S } from "./schema.js";'); const result = run("generate"); assert.notEqual(result.status, 0); assert.match(result.stderr, /cannot be reexported/); preserve();
  rmSync(join(project, "named.ts")); authored.delete("named.ts"); pass(run("generate"));
});
check("default watch start/update/stop preserves the same authored byte fixture", () => {
  const driver = join(project, "watch-driver.mjs");
  writeFileSync(driver, `import {spawn} from 'node:child_process'; import {readFileSync,writeFileSync} from 'node:fs';
const file = ${JSON.stringify(join(project, "schema.ts"))}; const before = readFileSync(file); const after = Buffer.concat([before, Buffer.from('\\r\\n// current edit')]);
const child = spawn(process.execPath, [${JSON.stringify(join(root, "dist/hson-schema.mjs"))}, 'watch', '--project', ${JSON.stringify(config)}], {stdio:['ignore','pipe','pipe']});
let lines='', count=0, failed=false; const timer=setTimeout(()=>{failed=true; child.kill('SIGTERM');},60000);
child.stderr.pipe(process.stderr);
child.stdout.on('data', chunk=>{lines+=chunk; while(lines.includes('\\n')) {const end=lines.indexOf('\\n'); const text=lines.slice(0,end); lines=lines.slice(end+1); if(!text.startsWith('{'))continue; const event=JSON.parse(text); if(event.state!=='current')continue;
if(event.diagnostics.length) {failed=true; child.kill('SIGTERM'); break;}
if(!readFileSync(file).equals(count===0?before:after))failed=true;
if(count++===0)writeFileSync(file,after); else child.kill('SIGTERM'); }});
child.on('exit', code=>{clearTimeout(timer); if(code!==0||count!==2||failed)process.exitCode=1;});`);
  const original = authored.get("schema.ts")!;
  const result = spawnSync(process.execPath, [driver], { encoding: "utf8", timeout: 90_000 });
  pass(result);
  assert.deepEqual(readFileSync(join(project, "schema.ts")), Buffer.concat([original, Buffer.from('\r\n// current edit')]));
  writeFileSync(join(project, "schema.ts"), original); pass(run("generate")); preserve();
});
check("explicit legacy migration previews, safely removes known syntax and refuses ambiguous edits", () => {
  const evidence = generate_hson_schema_evidence("Legacy", schema, "legacy.ts#Legacy");
  const type = '__HsonSchema<__LegacyEvidence["value"], __LegacyEvidence["mode"], __LegacyEvidence["identity"]>';
  const text = `\uFEFF// user comment\r\nimport { Hson } from "hson-live";\r\nexport const Legacy: ${type} = (Hson.schema\`${schema}\` as unknown as ${type});\r\n// @hson-schema generated type exports\r\nimport type { HsonSchema as __HsonSchema } from "hson-live";\r\nimport type { Evidence as __LegacyEvidence } from "./legacy.Legacy.hson-schema.generated.js";\r\n// @hson-schema end generated type exports`;
  writeFileSync(join(project, "legacy.ts"), text);
  // Missing old colocated files do not require destructive migration to check current source.
  pass(run("generate")); pass(run("check"));
  assert.equal(readFileSync(join(project, "legacy.ts"), "utf8"), text);
  writeFileSync(join(project, "legacy.Legacy.hson-schema.generated.ts"), evidence.declaration);
  writeFileSync(join(project, "legacy.Legacy.hson-schema.generated.json"), evidence.metadata);
  pass(run("generate")); pass(run("build"));
  assert.ok(!files(join(project, "dist")).some(path => path.endsWith("legacy.Legacy.hson-schema.generated.js")));
  writeFileSync(join(project, "legacy.Legacy.hson-schema.generated.ts"), "this is edited invalid TypeScript !!!");
  pass(run("generate")); pass(run("check"));
  assert.notEqual(run("migrate", ["--write"]).status, 0);
  assert.equal(readFileSync(join(project, "legacy.ts"), "utf8"), text);
  writeFileSync(join(project, "legacy.Legacy.hson-schema.generated.ts"), evidence.declaration);
  pass(run("migrate")); assert.equal(readFileSync(join(project, "legacy.ts"), "utf8"), text);
  writeFileSync(join(project, "legacy.ts"), text.replace('as unknown', 'as /* user */ unknown'));
  assert.notEqual(run("migrate", ["--write"]).status, 0);
  assert.match(readFileSync(join(project, "legacy.ts"), "utf8"), /user/);
  writeFileSync(join(project, "legacy.ts"), text); pass(run("migrate", ["--write"]));
  const clean = readFileSync(join(project, "legacy.ts"), "utf8");
  assert.equal(clean, `\uFEFF// user comment\r\nimport { Hson } from "hson-live";\r\nexport const Legacy = Hson.schema\`${schema}\`;\r\n`);
  assert.ok(!files(project).includes(join(project, "legacy.Legacy.hson-schema.generated.ts")));
  pass(run("generate")); pass(run("check")); preserve();
});
events.terminal("pass");
console.log(JSON.stringify({ hsonSchemaCutover: "passed", checks, typescript: ts.version }));
