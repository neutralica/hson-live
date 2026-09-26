import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { generate_hson_schema_evidence } from "../src/internal/hson-schema/generated-evidence.ts";
import { unwrap_tagged_schema } from "../src/internal/hson-schema/source-transformation.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson-schema-compiler-project",
  title: "Hson Schema generated compiler project",
  category: "Tooling",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "typescript", "source-integrity"]),
});

const events = create_test_event_emitter("hson-schema-compiler-project");
let checks = 0;
function check(name: string, body: () => void): void {
  events.case_begin(name, name);
  try { body(); events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
  console.log(`ok ${++checks} - ${name}`);
}

assert.equal(ts.version, "5.9.3", "Phase 1 acceptance pins the stock compiler used for the feasibility contract.");
const root = resolve(".");
mkdirSync(join(root, "tmp"), { recursive: true });
const temporary = mkdtempSync(join(root, "tmp", "schema-compiler-project-"));
process.once("exit", () => rmSync(temporary, { recursive: true, force: true }));
const fixture = join(root, "tests/fixtures/hson-schema-compiler-project");

function prepare(name: string): string {
  const project = join(temporary, name);
  cpSync(fixture, project, { recursive: true, filter: path => !path.split(sep).includes(".hson") });
  const basePath = join(project, "tsconfig.base.json");
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  base.compilerOptions.paths["hson-live"] = [join(root, "dist/index.d.ts")];
  base.compilerOptions.paths["hson-live/hson"] = [join(root, "dist/hson-authoring.d.ts")];
  writeFileSync(basePath, JSON.stringify(base, null, 2));
  // Exercise CRLF, no trailing newline, a BOM, and a shebang without normalizing comparisons.
  const schema = join(project, "schema.ts");
  writeFileSync(schema, readFileSync(schema, "utf8").replace(/\n/g, "\r\n").replace(/\r\n$/, ""));
  const support = join(project, "support/config.ts");
  writeFileSync(support, `\uFEFF${readFileSync(support, "utf8")}`);
  writeFileSync(join(project, "support/script.ts"), "#!/usr/bin/env node\nexport const executable = true;\n");
  writeFileSync(join(project, "names/package.json"), '{"type":"commonjs"}\n');
  return project;
}

function snapshot(directory: string, excludeGenerated = true): Map<string, Buffer> {
  const output = new Map<string, Buffer>();
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (excludeGenerated && entry.name === ".hson") continue;
      const file = join(path, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) output.set(relative(directory, file), readFileSync(file));
    }
  };
  visit(directory);
  return output;
}

function generate(project: string) {
  return spawnSync(process.execPath, [join(root, "dist/hson-schema.mjs"), "experimental-project", "--project", join(project, "tsconfig.json")], { cwd: root, encoding: "utf8", timeout: 120_000 });
}
function succeed(result: ReturnType<typeof generate>): void { assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message ?? "")); }
function stock_check(project: string, extra: readonly string[] = []) {
  return spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--project", project, "--pretty", "false", ...extra], { cwd: root, encoding: "utf8", timeout: 120_000 });
}

const project = prepare("application");
const before = snapshot(project);
const output = join(project, ".hson/compiler-input/tsconfig.json");
const generatedConfig = join(output, "tsconfig.json");
type Manifest = Readonly<{
  owner: string;
  files: readonly Readonly<{ path: string; digest: string }>[];
  sources: readonly Readonly<{ source: string; generated: string; edits: readonly Readonly<{ start: number; end: number; text: string }>[]; schemas: readonly Readonly<{ name: string; start: number; end: number; evidence: string }>[] }>[];
}>;
const manifest = (): Manifest => JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));

check("packaged opt-in CLI generates a complete compiler project without touching authored bytes", () => {
  const result = generate(project);
  succeed(result);
  const summary = JSON.parse(result.stdout.trim());
  assert.equal(summary.schemas, 12);
  assert.equal(summary.project, generatedConfig);
  assert.deepEqual(snapshot(project), before);
  assert.match(readFileSync(join(output, "sources/schema.ts"), "utf8"), /Generated by Hson Schema experimental compiler project/);
  assert.match(readFileSync(join(output, "sources/schema.ts"), "utf8"), /HsonSchema as __HsonSchema_1/);
  assert.match(readFileSync(join(output, "sources/schema.ts"), "utf8"), /Evidence as __slideSchemaEvidence_1/);
});

check("stock TypeScript retains value, mode, identity, refinements, recursion, document and mutation types", () => {
  const result = stock_check(generatedConfig, ["--listFiles"]);
  succeed(result);
  const files = result.stdout.split(/\r?\n/).filter(line => line.startsWith(project));
  assert.ok(files.length > 0);
  assert.ok(files.every(file => file.startsWith(output + sep)), `Original application graph leaked into the generated project:\n${files.join("\n")}`);
  assert.deepEqual(snapshot(project), before);
  assert.equal(existsSync(join(project, "authored.tsbuildinfo")), false);
  assert.equal(existsSync(join(project, "out")), false);
});

check("evidence is exactly the existing generator output and runtime tags remain unchanged", () => {
  const info = manifest();
  const evidencePaths: string[] = [];
  for (const record of info.sources) {
    const text = ts.sys.readFile(join(project, record.source));
    assert.notEqual(text, undefined);
    const original = ts.createSourceFile(record.source, text ?? "", ts.ScriptTarget.Latest, true);
    const transformed = ts.createSourceFile(record.generated, readFileSync(join(output, record.generated), "utf8"), ts.ScriptTarget.Latest, true);
    const declarations = (file: ts.SourceFile) => file.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]);
    for (const schema of record.schemas) {
      const authored = declarations(original).find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === schema.name);
      const compiled = declarations(transformed).find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === schema.name);
      assert.ok(authored?.initializer && compiled?.initializer);
      const tag = unwrap_tagged_schema(authored.initializer);
      const compiledTag = unwrap_tagged_schema(compiled.initializer);
      assert.ok(tag && compiledTag);
      assert.equal(tag.getText(original), compiledTag.getText(transformed));
      const expected = generate_hson_schema_evidence(schema.name, tag.template.getText(original).slice(1, -1), `${record.source}#${schema.name}`);
      assert.equal(readFileSync(join(output, schema.evidence), "utf8"), expected.declaration);
      assert.equal(readFileSync(join(output, schema.evidence.replace(/\.[cm]?ts$/, ".json")), "utf8"), expected.metadata);
      assert.equal(schema.start, authored.getStart(original));
      assert.equal(schema.end, authored.getEnd());
      evidencePaths.push(schema.evidence);
    }
  }
  assert.equal(new Set(evidencePaths).size, 12);
  for (const source of ["names/foo.ts", "names/foo.mts", "names/foo.cts", "elsewhere/foo.ts"]) {
    assert.ok(evidencePaths.some(path => path.startsWith(`evidence/${source}/Same.`)), source);
  }
});

check("regeneration is deterministic and leaves unowned neighbors alone", () => {
  const first = snapshot(output, false);
  succeed(generate(project));
  assert.deepEqual(snapshot(output, false), first);
  const neighbor = join(output, "sources/user-notes.txt");
  writeFileSync(neighbor, "Not owned by the generator.");
  succeed(generate(project));
  assert.equal(readFileSync(neighbor, "utf8"), "Not owned by the generator.");
  assert.deepEqual(snapshot(project), before);
});

check("an edited generated file is never overwritten", () => {
  const file = join(output, "sources/schema.ts");
  const original = readFileSync(file);
  writeFileSync(file, Buffer.concat([original, Buffer.from("\n// user edit\n")]));
  const edited = readFileSync(file);
  const result = generate(project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unowned\/edited/);
  assert.deepEqual(readFileSync(file), edited);
  assert.deepEqual(snapshot(project), before);
  writeFileSync(file, original);
});

check("ownership metadata cannot escape the generated boundary", () => {
  const path = join(output, "manifest.json");
  const original = readFileSync(path);
  const unsafe = JSON.parse(original.toString());
  unsafe.files[0].path = "../../schema.ts";
  writeFileSync(path, JSON.stringify(unsafe));
  const result = generate(project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid generated path/);
  assert.deepEqual(snapshot(project), before);
  writeFileSync(path, original);
});

check("a first run refuses existing unowned destinations", () => {
  const other = prepare("unowned");
  const collision = join(other, ".hson/compiler-input/tsconfig.json/sources/schema.ts");
  mkdirSync(dirname(collision), { recursive: true });
  writeFileSync(collision, "user-owned bytes");
  const original = snapshot(other, false);
  const result = generate(other);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unowned\/edited/);
  assert.deepEqual(snapshot(other, false), original);
});

check("finite regeneration removes only obsolete manifest-owned files", () => {
  const temporarySource = join(project, "extra.ts");
  writeFileSync(temporarySource, 'import { Hson } from "hson-live"; export const Extra = Hson.schema`<type "data">`;\n');
  succeed(generate(project));
  const artifact = join(output, "evidence/extra.ts/Extra.hson-schema.generated.ts");
  assert.ok(existsSync(artifact));
  unlinkSync(temporarySource);
  succeed(generate(project));
  assert.equal(existsSync(artifact), false);
  assert.equal(existsSync(join(output, "sources/extra.ts")), false);
  assert.ok(existsSync(join(output, "sources/user-notes.txt")));
  assert.deepEqual(snapshot(project), before);
});

check("invalid Schema compilation never falls back to rewriting source", () => {
  const other = prepare("invalid");
  const schema = join(other, "schema.ts");
  writeFileSync(schema, readFileSync(schema, "utf8").replace('<type "document">', '<type "invalid">'));
  const original = snapshot(other);
  const result = generate(other);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Schema root/);
  assert.deepEqual(snapshot(other), original);
  assert.equal(existsSync(join(other, ".hson")), false);
});

check("ordinary authored TypeScript errors remain stock compiler errors", () => {
  const other = prepare("type-error");
  writeFileSync(join(other, "unrelated.ts"), 'export const unrelated: string = 123;\n');
  const original = snapshot(other);
  succeed(generate(other));
  const result = stock_check(join(other, ".hson/compiler-input/tsconfig.json/tsconfig.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /unrelated\.ts.*TS2322/);
  assert.deepEqual(snapshot(other), original);
});

check("inherited paths without baseUrl and explicit external declaration roots remain effective", () => {
  const other = prepare("external-declarations");
  const basePath = join(other, "tsconfig.base.json");
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  delete base.compilerOptions.baseUrl;
  writeFileSync(basePath, JSON.stringify(base));
  const external = join(temporary, "external.d.ts");
  writeFileSync(external, "interface ExternalCompilerProjectFixture { readonly outside: true }\n");
  const configPath = join(other, "tsconfig.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.files = [external];
  writeFileSync(configPath, JSON.stringify(config));
  writeFileSync(join(other, "external-consumer.ts"), "export const external: ExternalCompilerProjectFixture = { outside: true };\n");
  const original = snapshot(other);
  succeed(generate(other));
  succeed(stock_check(join(other, ".hson/compiler-input/tsconfig.json/tsconfig.json")));
  assert.deepEqual(snapshot(other), original);
});

check("existing Schema fixtures use the same evidence and transformation without rewriting their legacy source", () => {
  const legacy = join(temporary, "legacy");
  cpSync(join(root, "tests/fixtures/hson-schema-mvp"), legacy, { recursive: true });
  const configPath = join(legacy, "tsconfig.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.compilerOptions.paths["hson-live"] = [join(root, "dist/index.d.ts")];
  config.compilerOptions.paths["hson-live/hson"] = [join(root, "dist/hson-authoring.d.ts")];
  writeFileSync(configPath, JSON.stringify(config));
  const original = snapshot(legacy);
  succeed(generate(legacy));
  succeed(stock_check(join(legacy, ".hson/compiler-input/tsconfig.json/tsconfig.json")));
  assert.deepEqual(snapshot(legacy), original);
});

events.terminal("pass");
console.log(JSON.stringify({ hsonSchemaCompilerProjectAcceptance: "passed", checks, typescript: ts.version }));
