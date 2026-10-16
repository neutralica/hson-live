import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { generate_hson_schema_evidence } from "../src/internal/hson-schema/generated-evidence.ts";
import { admit_hson_tagged_template } from "../src/internal/embedded-hson/hson-tagged-source-admission.ts";
import { discover_hson_schema_declarations } from "../src/internal/hson-schema/schema-discovery.ts";
import { generate_schema_compiler_project } from "../src/internal/hson-schema/compiler-project.ts";
function unwrap_tagged_schema(node: ts.Expression): ts.TaggedTemplateExpression | undefined {
  if (ts.isTaggedTemplateExpression(node)) return node;
  return ts.isAsExpression(node) || ts.isParenthesizedExpression(node) ? unwrap_tagged_schema(node.expression) : undefined;
}
import { capture_schema_compiler_project, verify_schema_compiler_project } from "../src/internal/hson-schema/compiler-project-watch.ts";
import { check_schema_project } from "../src/internal/hson-schema/compiler-project-build.ts";
import { SchemaProjectSnapshot } from "../src/internal/hson-schema/project-snapshot.ts";
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
  base.compilerOptions.paths["hson-live/livemap"] = [join(root, "dist/api/livemap/index.d.ts")];
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
  return spawnSync(process.execPath, [join(root, "dist/hson-schema.mjs"), "generate", "--project", join(project, "tsconfig.json")], { cwd: root, encoding: "utf8", timeout: 120_000 });
}
function succeed(result: ReturnType<typeof generate>): void { assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message ?? "")); }
function stock_check(project: string, extra: readonly string[] = []) {
  return spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--project", project, "--pretty", "false", ...extra], { cwd: root, encoding: "utf8", timeout: 120_000 });
}

const project = prepare("application");
const before = snapshot(project);
const stable = join(project, ".hson/compiler-input/tsconfig.json");
const generatedConfig = join(stable, "tsconfig.json");
let output = stable;
type Manifest = Readonly<{
  owner: string;
  files: readonly Readonly<{ path: string; digest: string }>[];
  sources: readonly Readonly<{ source: string; generated: string; edits: readonly Readonly<{ start: number; end: number; text: string }>[]; schemas: readonly Readonly<{ name: string; start: number; end: number; evidence: string }>[] }>[];
}>;
const manifest = (): Manifest => JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));

check("package includes the source and build inputs needed for derived tooling identity", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json", "--cache", join(temporary, "npm-cache")], { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const files = new Set(JSON.parse(result.stdout)[0].files.map((file: { path: string }) => file.path));
  for (const file of ["scripts/hson-schema.mts", "scripts/build-hson-schema-cli.mjs", "tsconfig.json", "src/internal/hson-schema/tooling-fingerprint.ts", "dist/internal/hson-schema/tooling-fingerprint.js"]) assert.ok(files.has(file), file);
});

check("authored document assignments never generate canonical proof overlays", () => {
  const directory = prepare("authored-boundary");
  const consumer = join(directory, "consumer.ts");
  const original = readFileSync(consumer, "utf8");
  for (const body of ["<main/>", "<main @:main/>"]) {
    writeFileSync(consumer, original.replace('slideSchema.certify(Hson.document`<main/>`)', `Hson.document\`${body}\``));
    const result = generate(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /HsonAuthored.*canonical document Schema evidence requires explicit/);
    const generated = join(directory, ".hson/compiler-input/tsconfig.json/sources/consumer.ts");
    if (existsSync(generated)) {
      const text = readFileSync(generated, "utf8");
      assert.doesNotMatch(text.slice(text.indexOf("const authoredDocument:")), /as unknown as HsonDocument/);
    }
  }
});
check("packaged current CLI generates a complete compiler project without touching authored bytes", () => {
  const result = generate(project);
  succeed(result);
  const summary = JSON.parse(result.stdout.trim());
  output = dirname(summary.manifest);
  assert.equal(summary.schemas, 12);
  assert.equal(summary.project, generatedConfig);
  assert.deepEqual(snapshot(project), before);
  assert.match(readFileSync(join(output, "sources/schema.ts"), "utf8"), /Generated by Hson Schema compiler project/);
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

check("post-hoc attachment proof is compiler-view only", () => {
  const generated = readFileSync(join(output, "sources/consumer.ts"), "utf8");
  assert.match(generated, /__hson_assert_library_schema\(attachedDocument, "home", PageSchema\)/);
  assert.match(generated, /attachedDocument\.lib\("home"\)\.schema\.use\(PageSchema\)/);
  const current = verify_schema_compiler_project(join(project, "tsconfig.json"));
  check_schema_project(join(project, "tsconfig.json"), current, true);
  const runtime = readFileSync(join(project, "out/consumer.js"), "utf8");
  assert.match(runtime, /schema\.use\(PageSchema\)/);
  assert.doesNotMatch(runtime, /__hson_assert_library_schema/);
  const declaration = readFileSync(join(project, "out/consumer.d.ts"), "utf8");
  assert.doesNotMatch(declaration, /__hson_assert_library_schema|\.hson\//);
  assert.match(declaration, /refinedHomeLibrary\(\): import\("hson-live\/livemap"\)\.LiveMapDocumentLibrary</);
  assert.match(declaration, /refinedHome: import\("hson-live\/livemap"\)\.LiveMapDocumentLibrary/);
  assert.match(declaration, /refinedSecond: import\("hson-live\/livemap"\)\.LiveMapDocumentLibrary/);
  assert.match(declaration, /refinedTitle: import\("hson-live\/livemap"\)\.LiveMapDocumentLocation/);
  assert.match(declaration, /getRefinedTitle\(\): import\("hson-live\/livemap"\)\.LiveMapDocumentLocation/);
  assert.doesNotMatch(declaration, /dist\/types|liveMapLibrarySchemaRefinementsType|__hson|SchemaType|DocumentSchemaGraph|DataSchemaValue/);
  assert.match(declaration, /HsonSchema<infer TGraph, "document">/);
  const downstream = join(temporary, "published-document-consumer");
  mkdirSync(downstream);
  writeFileSync(join(downstream, "package.json"), '{"type":"module"}');
  writeFileSync(join(downstream, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, noEmit: true,
    target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", types: [],
    paths: { "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")], "hson-live/livemap": [join(root, "dist/api/livemap/index.d.ts")] },
  }, files: ["consumer.ts"] }));
  writeFileSync(join(downstream, "consumer.ts"), `
import { refinedHomeLibrary, refinedTitle, getRefinedTitle } from "../application/out/consumer.js";
import { PageSchema } from "../application/out/schema.js";
const home = refinedHomeLibrary();
const schema: typeof PageSchema = home.schema.get();
const text: string = refinedTitle.snap();
const returnedText: string = getRefinedTitle().snap();
home.at([0, 0]).replace("new body");
// @ts-expect-error Published document paths retain their bounds.
home.at([1]);
// @ts-expect-error Published text locations do not acquire element capabilities.
refinedTitle.attrs;
// @ts-expect-error Published text replacement remains text-only.
refinedTitle.replace(home.root());
void schema; void text; void returnedText;
`);
  succeed(stock_check(join(downstream, "tsconfig.json")));
  rmSync(join(project, "out"), { recursive: true, force: true });
});

check("canonical LiveMap namespace generates the same compiler attachment proof", () => {
  const other = prepare("namespace-attachment");
  const basePath = join(other, "tsconfig.base.json");
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  base.compilerOptions.paths["hson-live/livemap"] = [join(root, "dist/api/livemap/index.d.ts")];
  writeFileSync(basePath, JSON.stringify(base, null, 2));
  writeFileSync(join(other, "namespace-proof.ts"), `import { Hson } from "hson-live/hson";
import * as maps from "hson-live/livemap";
const Page = Hson.schema\`<type "document" tag "main" content "string">\`;
const empty = maps.create();
const map = maps.fromLibraries({ home: { document: '<main "hello"/>' } });
map.lib("home").schema.use(Page);
const exact: typeof Page = map.lib("home").schema.get();
void empty; void exact;
`);
  succeed(generate(other));
  const generated = readFileSync(join(other, ".hson/compiler-input/tsconfig.json/sources/namespace-proof.ts"), "utf8");
  assert.match(generated, /__hson_assert_library_schema\(map, "home", Page\)/);
  succeed(stock_check(join(other, ".hson/compiler-input/tsconfig.json/tsconfig.json")));
});

check("flow-refined exported map bindings fail with an intentional tooling diagnostic", () => {
  const other = prepare("unsupported-exported-map");
  writeFileSync(join(other, "flow-map.ts"), `import { Hson, hsonLiveMap } from "hson-live";
export const S = Hson.schema\`<type "data" content <value "number">>\`;
export const map = hsonLiveMap.fromLibraries({ state: { data: { value: 1 } } });
map.lib("state").schema.use(S);
`);
  succeed(generate(other));
  const current = verify_schema_compiler_project(join(other, "tsconfig.json"));
  assert.throws(() => check_schema_project(join(other, "tsconfig.json"), current, false), /HSON_SCHEMA_FLOW_REFINED_EXPORTED_MAP_UNSUPPORTED/);
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
      const expected = generate_hson_schema_evidence(schema.name, admit_hson_tagged_template(ts, tag, "schema"), `${record.source}#${schema.name}`);
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
  const mtimes = [...first.keys()].map(path => statSync(join(output, path)).mtimeMs);
  succeed(generate(project));
  assert.deepEqual(snapshot(output, false), first);
  assert.deepEqual([...first.keys()].map(path => statSync(join(output, path)).mtimeMs), mtimes);
  assert.equal(existsSync(join(output, "revisions")), false);
  const neighbor = join(output, "sources/user-notes.txt");
  writeFileSync(neighbor, "Not owned by the generator.");
  succeed(generate(project));
  assert.equal(readFileSync(neighbor, "utf8"), "Not owned by the generator.");
  assert.deepEqual(snapshot(project), before);
});

check("an edited generated file is never overwritten", () => {
  output = stable;
  const file = join(output, "sources/schema.ts");
  const original = readFileSync(file);
  writeFileSync(file, Buffer.concat([original, Buffer.from("\n// user edit\n")]));
  const edited = readFileSync(file);
  const result = generate(project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unowned\/edited/i);
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
  assert.match(result.stderr, /Invalid generated path|Edited/);
  assert.deepEqual(snapshot(project), before);
  writeFileSync(path, original);
});

check("a first run refuses existing unowned destinations", () => {
  const other = prepare("unowned");
  const collision = join(other, ".hson/compiler-input/tsconfig.json/tsconfig.json");
  mkdirSync(dirname(collision), { recursive: true });
  writeFileSync(collision, "user-owned bytes");
  const original = snapshot(other, false);
  const result = generate(other);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unowned Hson compiler project/);
  assert.deepEqual(snapshot(other, false), original);
});

check("finite regeneration removes obsolete owned evidence without history", () => {
  const temporarySource = join(project, "extra.ts");
  writeFileSync(temporarySource, 'import { Hson } from "hson-live"; export const Extra = Hson.schema`<type "data">`;\n');
  succeed(generate(project));
  output = stable;
  const artifact = join(output, "evidence/extra.ts/Extra.hson-schema.generated.ts");
  assert.ok(existsSync(artifact));
  unlinkSync(temporarySource);
  succeed(generate(project));
  assert.equal(existsSync(artifact), false);
  output = stable;
  assert.equal(existsSync(join(output, "sources/extra.ts")), false);
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
  assert.equal(existsSync(join(other, ".hson/compiler-input/tsconfig.json/tsconfig.json")), true);
});

check("CLI duplicate Schema names withdraw all ambiguous evidence", () => {
  const other = prepare("duplicate-schema");
  writeFileSync(join(other, "duplicate.ts"), `import { Hson } from "hson-live";
export const S = Hson.schema\`<type "data" content <a "string">\`;
export const S = Hson.schema\`<type "data" content <b "number">\`;
`);
  const result = generate(other);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Duplicate Schema declaration S; precise evidence withdrawn/);
  const evidenceRoot = join(other, ".hson/compiler-input/tsconfig.json/evidence/duplicate.ts");
  assert.equal(existsSync(evidenceRoot), false);
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

check("existing Schema fixtures use the same evidence and transformation without rewriting current authored source", () => {
  const fixture = join(temporary, "fixture");
  cpSync(join(root, "tests/fixtures/hson-schema-mvp"), fixture, { recursive: true, filter: path => !path.split(sep).includes(".hson") });
  const configPath = join(fixture, "tsconfig.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.compilerOptions.paths["hson-live"] = [join(root, "dist/index.d.ts")];
  config.compilerOptions.paths["hson-live/hson"] = [join(root, "dist/hson-authoring.d.ts")];
  writeFileSync(configPath, JSON.stringify(config));
  const original = snapshot(fixture);
  succeed(generate(fixture));
  succeed(stock_check(join(fixture, ".hson/compiler-input/tsconfig.json/tsconfig.json")));
  assert.deepEqual(snapshot(fixture), original);
});


check("capture racing publication fails clearly and captured compiler reads never fall through to disk", () => {
  const config = join(project, "tsconfig.json");
  const prior = verify_schema_compiler_project(config);
  const captured = new SchemaProjectSnapshot({ root: prior.selected, files: prior.files });
  const schema = join(project, "schema.ts"), original = readFileSync(schema);
  let changed = false;
  assert.throws(() => capture_schema_compiler_project(config, () => {
    if (changed) return;
    changed = true;
    writeFileSync(schema, Buffer.concat([original, Buffer.from("\n// new publication\n")]));
    succeed(generate(project));
  }), /publication changed during capture/);
  if (!ts.sys.useCaseSensitiveFileNames) {
    assert.equal(captured.readFile(prior.project.toUpperCase()), captured.readFile(prior.project));
    assert.equal(captured.fileExists(prior.project.toUpperCase()), true);
    assert.equal(captured.directoryExists(prior.selected.toUpperCase()), true);
  }
  const read = ts.readConfigFile(prior.project, captured.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, captured.host, prior.selected, undefined, prior.project);
  const program = ts.createProgram(parsed.fileNames, parsed.options, captured.compilerHost(parsed.options));
  assert.equal(ts.getPreEmitDiagnostics(program).length, 0);
  assert.equal(captured.readFile(join(prior.selected, "sources/schema.ts")), prior.files.get(join(prior.selected, "sources/schema.ts"))!.toString());
  assert.throws(() => check_schema_project(config, prior, false), /revision changed/);
  assert.throws(() => check_schema_project(config, prior, true), /revision changed/);
  writeFileSync(schema, original); succeed(generate(project));
  assert.deepEqual(snapshot(project), before);
});

check("incomplete publication refuses verify and cannot authorize overwriting neighbors", () => {
  const marker = join(stable, ".publishing.json");
  writeFileSync(marker, '{"owner":"hson-schema-publication"}');
  const saved = snapshot(stable, false);
  assert.throws(() => verify_schema_compiler_project(join(project, "tsconfig.json")), /incomplete or in progress/);
  const result = generate(project); assert.notEqual(result.status, 0); assert.match(result.stderr, /incomplete or in progress/);
  assert.deepEqual(snapshot(stable, false), saved);
  unlinkSync(marker);
  verify_schema_compiler_project(join(project, "tsconfig.json"));
});

check("symlink and unowned final destinations are refused before any current replacement", () => {
  const extra = join(project, "extra.ts"), destination = join(stable, "sources/extra.ts");
  writeFileSync(extra, "export const extra = 1;");
  symlinkSync(extra, destination);
  const manifestBytes = readFileSync(join(stable, "manifest.json"));
  assert.notEqual(generate(project).status, 0);
  assert.deepEqual(readFileSync(join(stable, "manifest.json")), manifestBytes);
  assert.equal(readFileSync(extra, "utf8"), "export const extra = 1;");
  unlinkSync(destination); writeFileSync(destination, "user owned");
  assert.notEqual(generate(project).status, 0);
  assert.equal(readFileSync(destination, "utf8"), "user owned");
  unlinkSync(destination); unlinkSync(extra); succeed(generate(project));
});

check("producer admission gates CLI evidence, attachments and regenerated governed reads", () => {
  const directory = join(temporary, "producer-admission"); mkdirSync(directory);
  const configPath = join(directory, "tsconfig.json");
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(configPath, JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
    target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", types: [], paths: {
      "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")],
      "hson-live/livemap": [join(root, "dist/api/livemap/index.d.ts")],
    } }, files: ["index.ts"] }));
  const body = '<type "data" content <name "string">>';
  const valid = `import { Hson, hsonLiveMap } from "hson-live";\r\nconst Bad = Hson.schema\`${body}\`;\r\nconst map = hsonLiveMap.fromLibraries({ state: { data: { name: "Ada" } } });\r\nmap.lib("state").schema.use(Bad);\r\nconst name: string = map.lib("state").at(["name"]).snap();\r\nconst wrong: number = map.lib("state").at(["name"]).snap();\r\n`;
  const currentRoot = join(directory, ".hson/compiler-input/tsconfig.json");
  const current = () => JSON.parse(readFileSync(join(currentRoot, "manifest.json"), "utf8")) as Manifest & { diagnostics: readonly string[] };
  const mirrored = () => readFileSync(join(currentRoot, "sources/index.ts"), "utf8");
  const assertValid = (): void => {
    writeFileSync(join(directory, "index.ts"), valid); succeed(generate(directory));
    assert.equal(current().sources.flatMap(source => source.schemas).length, 1);
    assert.match(mirrored(), /__hson_assert_library_schema\(map, "state", Bad\)/);
    const result = stock_check(join(currentRoot, "tsconfig.json"));
    assert.notEqual(result.status, 0); assert.match(result.stdout, /Type 'string' is not assignable to type 'number'/);
    assert.doesNotMatch(result.stdout, /JsonValue.*string/);
  };
  assertValid();
  for (const initializer of [`Hson.schema\`// \\8\r\n${body}\``, `Hson?.schema\`${body}\``, `Hson.schema?.\`${body}\``, `(Hson?.schema\`${body}\`)`, `(Hson.schema?.\`${body}\`)`]) {
    const rejected = valid.replace(`Hson.schema\`${body}\``, initializer);
    writeFileSync(join(directory, "index.ts"), rejected);
    assert.notEqual(generate(directory).status, 0, initializer);
    const manifest = current();
    assert.equal(manifest.sources.flatMap(source => source.schemas).length, 0, initializer);
    assert.ok(manifest.diagnostics.some(message => /invalid Hson tagged template|optional chain|non-optional/.test(message)), JSON.stringify(manifest.diagnostics));
    assert.equal(manifest.files.some(file => file.path.startsWith("evidence/")), false);
    assert.doesNotMatch(mirrored(), /__hson_assert_library_schema/);
    assert.match(stock_check(join(currentRoot, "tsconfig.json")).stdout, /JsonValue.*string/);
    assertValid();
  }
  // The same source-generation admission boundary must protect assignment
  // overlays even when its Schema producer is valid.
  for (const tag of ['Hson.data`// \\8\r\n<name "Ada">`', 'Hson?.data`<name "Ada">`', 'Hson.data?.`<name "Ada">`']) {
    writeFileSync(join(directory, "index.ts"), valid + '\r\nimport type { HsonData } from "hson-live";\r\n' + `const candidate: HsonData<typeof Bad> = ${tag};\r\n`);
    assert.notEqual(generate(directory).status, 0, tag);
    assert.doesNotMatch(mirrored().slice(mirrored().indexOf("const candidate:")), /as unknown as HsonData/);
  }
  // A custom watch-analysis callback cannot bypass producer eligibility at
  // materialization by supplying a raw-compilable rejected producer record.
  writeFileSync(join(directory, "index.ts"), valid.replace(`Hson.schema\`${body}\``, `Hson.schema\`// \\8\r\n${body}\``));
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const config = ts.parseJsonConfigFileContent(read.config, ts.sys, directory);
  const snapshot = new SchemaProjectSnapshot();
  const program = ts.createProgram(config.fileNames, config.options, snapshot.compilerHost(config.options));
  const file = program.getSourceFile(join(directory, "index.ts"))!;
  const declaration = file.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]).find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "Bad")!;
  const blockedRoot = join(directory, ".hson/blocked");
  assert.throws(() => generate_schema_compiler_project(configPath, config, program, [{ sourceFile: file, declaration, name: "Bad", source: `// \\8\n${body}` }], [], { outputRoot: blockedRoot, snapshot, diagnostics: [] }), /not eligible for generated proof/);
  assert.equal(existsSync(blockedRoot), false);
});

check("materialization binds every producer field to its admitted source and AST identity", () => {
  const directory = join(temporary, "producer-identity"); mkdirSync(directory);
  const configPath = join(directory, "tsconfig.json");
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(configPath, JSON.stringify({ compilerOptions: { strict: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", types: [],
    paths: { "hson-live": [join(root, "dist/index.d.ts")] } }, files: ["good.ts", "bad.ts", "other.ts"] }));
  const text = 'import { Hson } from "hson-live";\r\nexport const S = Hson.schema`// ok\r\n<type "data" content <name "string">>`;\r\nconst ordinary = 1;\r\nexport const Extra = Hson.schema`<type "data" content <count "number">>`;\r\n';
  writeFileSync(join(directory, "good.ts"), text);
  writeFileSync(join(directory, "other.ts"), text);
  writeFileSync(join(directory, "bad.ts"), text.replace("// ok", "// \\8"));
  const snapshot = new SchemaProjectSnapshot();
  const read = ts.readConfigFile(configPath, snapshot.readFile);
  const config = ts.parseJsonConfigFileContent(read.config, snapshot.host, directory, undefined, configPath);
  const program = ts.createProgram(config.fileNames, config.options, snapshot.compilerHost(config.options));
  const checker = program.getTypeChecker();
  const file = (name: string) => program.getSourceFile(join(directory, name))!;
  const good = discover_hson_schema_declarations(ts, file("good.ts"), checker)[0]!;
  const extra = discover_hson_schema_declarations(ts, file("good.ts"), checker)[1]!;
  const other = discover_hson_schema_declarations(ts, file("other.ts"), checker)[0]!;
  const bad = discover_hson_schema_declarations(ts, file("bad.ts"), checker)[0]!;
  assert.equal(good.eligible, true); assert.equal(other.eligible, true); assert.equal(bad.eligible, false);
  assert.equal(good.sourceFile.text.length, bad.sourceFile.text.length);
  assert.equal(good.declaration.getStart(), bad.declaration.getStart());
  assert.equal(good.declaration.getEnd(), bad.declaration.getEnd());
  const admitted = { sourceFile: good.sourceFile, declaration: good.declaration, name: good.name, source: good.source! };
  const copy = ts.createSourceFile(good.sourceFile.fileName, text, ts.ScriptTarget.Latest, true);
  const copiedDeclaration = copy.statements.filter(ts.isVariableStatement)[0]!.declarationList.declarations[0]!;
  assert.equal(copiedDeclaration.getStart(), good.declaration.getStart());
  const ordinary = good.sourceFile.statements.filter(ts.isVariableStatement)[1]!.declarationList.declarations[0]!;
  const mismatches = [
    { ...admitted, sourceFile: bad.sourceFile },
    { ...admitted, sourceFile: other.sourceFile },
    { ...admitted, declaration: other.declaration },
    { ...admitted, sourceFile: copy },
    { ...admitted, declaration: copiedDeclaration },
    { ...admitted, declaration: ordinary },
    { ...admitted, declaration: extra.declaration },
    { ...admitted, name: "Extra" },
    { ...admitted, source: extra.source! },
  ];
  for (const [index, record] of mismatches.entries()) {
    const outputRoot = join(directory, `.hson/rejected-${index}`);
    assert.throws(() => generate_schema_compiler_project(configPath, config, program, [record], [], { outputRoot, snapshot, diagnostics: [] }), /not eligible for generated proof/, `mismatch ${index}`);
    assert.equal(existsSync(outputRoot), false, `mismatch ${index} must fail before writing proof`);
  }
  const outputRoot = join(directory, ".hson/valid"); mkdirSync(outputRoot, { recursive: true });
  const result = generate_schema_compiler_project(configPath, config, program, [admitted,
    { sourceFile: extra.sourceFile, declaration: extra.declaration, name: extra.name, source: extra.source! },
    { sourceFile: other.sourceFile, declaration: other.declaration, name: other.name, source: other.source! },
  ], [], { outputRoot, snapshot, diagnostics: [] });
  assert.equal(result.schemas, 3);
  const generated: Manifest = JSON.parse(readFileSync(result.manifest, "utf8"));
  assert.deepEqual(generated.sources.map(source => [source.source, source.schemas.map(schema => schema.name)]).sort(), [["bad.ts", []], ["good.ts", ["S", "Extra"]], ["other.ts", ["S"]]]);
  assert.doesNotMatch(readFileSync(join(outputRoot, "sources/bad.ts"), "utf8"), /as unknown as __HsonSchema/);
});

events.terminal("pass");
console.log(JSON.stringify({ hsonSchemaCompilerProjectAcceptance: "passed", checks, typescript: ts.version }));
