import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { generate_hson_schema_evidence } from "../src/internal/hson-schema/generated-evidence.ts";
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
  assert.match(declaration, /refinedHomeLibrary\(\): import\("hson-live"\)\.LiveMapDocumentLibrary</);
  assert.match(declaration, /refinedHome: import\("hson-live"\)\.LiveMapDocumentLibrary/);
  assert.match(declaration, /refinedSecond: import\("hson-live"\)\.LiveMapDocumentLibrary/);
  assert.match(declaration, /refinedTitle: import\("hson-live"\)\.LiveMapDocumentLocation/);
  assert.match(declaration, /getRefinedTitle\(\): import\("hson-live"\)\.LiveMapDocumentLocation/);
  assert.doesNotMatch(declaration, /dist\/types|liveMapLibrarySchemaRefinementsType|__hson/);
  rmSync(join(project, "out"), { recursive: true, force: true });
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
  writeFileSync(marker, '{"owner":"hson-schema-publication-v1"}');
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

// Legacy generated state is a migration fixture; current source is always authoritative.
const oldProject = join(temporary, "revision-migration"); mkdirSync(oldProject);
writeFileSync(join(oldProject, "package.json"), '{"type":"module"}');
writeFileSync(join(oldProject, "schema.ts"), 'import { Hson } from "hson-live";\n// keep authored source\nexport const S = Hson.schema`<type "data" content <value "string">>`;\n');
writeFileSync(join(oldProject, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
  target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", types: [], declaration: true, outDir: "out",
  paths: { "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")] } }, files: ["schema.ts"] }));
succeed(generate(oldProject));
const legacyRoot = join(oldProject, ".hson/compiler-input/tsconfig.json");
const oldAuthored = snapshot(oldProject);
const currentState = JSON.parse(readFileSync(join(legacyRoot, "manifest.json"), "utf8"));
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const expectedCleanup: string[] = [join(legacyRoot, "tsconfig.json")];
for (const name of ["revision-oldA", "revision-oldB"]) {
  const retired = join(legacyRoot, "revisions", name); mkdirSync(retired, { recursive: true });
  const files = currentState.files.map((file: { path: string }) => {
    const text = readFileSync(join(legacyRoot, file.path), "utf8").split(legacyRoot).join(retired);
    mkdirSync(dirname(join(retired, file.path)), { recursive: true }); writeFileSync(join(retired, file.path), text);
    expectedCleanup.push(join(retired, file.path));
    return { path: file.path, digest: digest(text) };
  });
  const { publication: _publication, contentDigest: _integrity, ...old } = currentState;
  writeFileSync(join(retired, "manifest.json"), JSON.stringify({ ...old, compatibility: "compiler-project-4/obsolete", files }));
  expectedCleanup.push(join(retired, "manifest.json"));
}
for (const directory of ["sources", "evidence"]) rmSync(join(legacyRoot, directory), { recursive: true });
unlinkSync(join(legacyRoot, "manifest.json"));
const selectedLegacy = join(legacyRoot, "revisions/revision-oldB");
const selectorPath = join(legacyRoot, "tsconfig.json");
writeFileSync(selectorPath, JSON.stringify({ extends: "./revisions/revision-oldB/tsconfig.json", $hsonSchema: {
  owner: "hson-schema-compiler-selector-v1", project: join(oldProject, "tsconfig.json"), revision: currentState.revision,
  manifestDigest: digest(readFileSync(join(selectedLegacy, "manifest.json"))) } }));
writeFileSync(join(selectedLegacy, "notes.txt"), "user notes");
writeFileSync(join(selectedLegacy, "sources/notes.txt"), "nested user notes");
mkdirSync(join(selectedLegacy, "empty-user-directory"));
mkdirSync(join(legacyRoot, "revisions/user-directory"));
writeFileSync(join(legacyRoot, "revisions/user-directory/notes.txt"), "unrelated neighbor");
function legacyCommand(mode: string, args: string[] = []) {
  return spawnSync(process.execPath, [join(root, "dist/hson-schema.mjs"), mode, "--project", join(oldProject, "tsconfig.json"), ...args], { encoding: "utf8", timeout: 30_000 });
}
for (const mode of ["generate", "watch", "verify", "check", "build"]) check(`${mode} requires migration for immutable revisions without adopting or writing`, () => {
  const before = snapshot(oldProject, false), result = legacyCommand(mode);
  assert.notEqual(result.status, 0); assert.equal(result.error, undefined);
  assert.match(result.stderr, /Legacy Hson compiler-project layout detected.*migrate.*--write/);
  assert.deepEqual(snapshot(oldProject, false), before);
});
check("legacy layout preview lists exactly owned selector and revision files without writing", () => {
  const before = snapshot(oldProject, false), result = legacyCommand("migrate"); succeed(result);
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.applied, false);
  assert.deepEqual(preview.changes.map((change: { path: string }) => change.path).sort(), expectedCleanup.sort());
  assert.ok(preview.changes.every((change: { operation: string }) => change.operation === "remove-owned-artifact"));
  assert.deepEqual(snapshot(oldProject, false), before);
});
function refuseLegacy(name: string, change: () => () => void): void {
  check(`legacy cleanup refuses ${name} before any write`, () => {
    const restore = change();
    try {
      const before = snapshot(oldProject, false);
      for (const args of [[], ["--write"]]) {
        const result = legacyCommand("migrate", args); assert.notEqual(result.status, 0, result.stdout);
        assert.match(result.stderr, /refused|symlink|changed/i);
        assert.deepEqual(snapshot(oldProject, false), before);
      }
      const normal = legacyCommand("generate"); assert.notEqual(normal.status, 0);
      assert.match(normal.stderr, /Legacy Hson compiler-project layout|symlink/);
      assert.deepEqual(snapshot(oldProject, false), before);
    } finally { restore(); }
  });
}
function editLegacy(path: string, edit: (text: string) => string): () => void {
  const before = readFileSync(path); writeFileSync(path, edit(before.toString("utf8"))); return () => writeFileSync(path, before);
}
const retiredManifest = join(legacyRoot, "revisions/revision-oldA/manifest.json");
const retiredSource = join(legacyRoot, "revisions/revision-oldA/sources/schema.ts");
refuseLegacy("edited owned source", () => editLegacy(retiredSource, text => text + "\n// edited"));
refuseLegacy("file digest mismatch", () => editLegacy(retiredManifest, text => { const value = JSON.parse(text); value.files[0].digest = "0".repeat(64); return JSON.stringify(value); }));
refuseLegacy("selector manifest digest mismatch", () => editLegacy(selectorPath, text => { const value = JSON.parse(text); value.$hsonSchema.manifestDigest = "0".repeat(64); return JSON.stringify(value); }));
refuseLegacy("selector revision mismatch", () => editLegacy(selectorPath, text => { const value = JSON.parse(text); value.$hsonSchema.revision = "wrong"; return JSON.stringify(value); }));
refuseLegacy("wrong selector project identity", () => editLegacy(selectorPath, text => { const value = JSON.parse(text); value.$hsonSchema.project = join(oldProject, "other.json"); return JSON.stringify(value); }));
refuseLegacy("wrong revision project identity", () => editLegacy(retiredManifest, text => { const value = JSON.parse(text); value.project = "other.json"; return JSON.stringify(value); }));
refuseLegacy("selector escape path", () => editLegacy(selectorPath, text => { const value = JSON.parse(text); value.extends = "../outside/tsconfig.json"; return JSON.stringify(value); }));
refuseLegacy("owned manifest escape path", () => editLegacy(retiredManifest, text => { const value = JSON.parse(text); value.files[0].path = "../outside.ts"; return JSON.stringify(value); }));
const missingLegacyInputs: readonly [string, string][] = [["missing owned file", retiredSource], ["missing manifest", retiredManifest], ["missing selector", selectorPath]];
for (const [name, path] of missingLegacyInputs) {
  refuseLegacy(name, () => { const before = readFileSync(path); unlinkSync(path); return () => writeFileSync(path, before); });
}
const linkedLegacyInputs: readonly [string, string][] = [["owned file symlink", retiredSource], ["manifest symlink", retiredManifest], ["selector symlink", selectorPath]];
for (const [name, path] of linkedLegacyInputs) {
  refuseLegacy(name, () => {
    const before = readFileSync(path); unlinkSync(path); symlinkSync(join(oldProject, "schema.ts"), path);
    return () => { unlinkSync(path); writeFileSync(path, before); };
  });
}
refuseLegacy("dangling revision symlink", () => {
  const path = join(legacyRoot, "revisions/revision-dangling"); symlinkSync(join(oldProject, "missing"), path);
  return () => unlinkSync(path);
});
refuseLegacy("ambiguous revision neighbor", () => {
  const path = join(legacyRoot, "revisions/revision-unknown"); mkdirSync(path); writeFileSync(join(path, "notes.txt"), "unknown");
  return () => rmSync(path, { recursive: true });
});
refuseLegacy("mixed current and old state", () => {
  const path = join(legacyRoot, "manifest.json"); writeFileSync(path, JSON.stringify(currentState)); return () => unlinkSync(path);
});
refuseLegacy("interrupted publication", () => {
  const path = join(legacyRoot, ".publishing.json"); writeFileSync(path, "{}"); return () => unlinkSync(path);
});
refuseLegacy("ambiguous authored legacy syntax alongside old state", () => editLegacy(join(oldProject, "schema.ts"), text => text + "// @hson-schema generated type exports\n"));
check("explicit cleanup preserves neighbors and authored bytes, then current generate/check/build succeeds", () => {
  succeed(legacyCommand("migrate", ["--write"]));
  for (const path of expectedCleanup) assert.equal(existsSync(path), false, path);
  assert.equal(existsSync(join(legacyRoot, "revisions/revision-oldA")), false);
  assert.deepEqual(readdirSync(selectedLegacy).sort(), ["empty-user-directory", "notes.txt", "sources"]);
  assert.equal(readFileSync(join(selectedLegacy, "sources/notes.txt"), "utf8"), "nested user notes");
  assert.equal(readFileSync(join(selectedLegacy, "notes.txt"), "utf8"), "user notes");
  assert.equal(readFileSync(join(legacyRoot, "revisions/user-directory/notes.txt"), "utf8"), "unrelated neighbor");
  assert.deepEqual(snapshot(oldProject), oldAuthored);
  const preview = legacyCommand("migrate"); succeed(preview); assert.deepEqual(JSON.parse(preview.stdout).changes, []);
  for (const mode of ["generate", "verify", "check", "build"]) succeed(legacyCommand(mode));
  succeed(stock_check(join(legacyRoot, "tsconfig.json")));
  assert.equal(JSON.parse(readFileSync(join(legacyRoot, "manifest.json"), "utf8")).compatibility, currentState.compatibility);
  const after = snapshot(legacyRoot, false); succeed(legacyCommand("generate")); assert.deepEqual(snapshot(legacyRoot, false), after);
  const currentPreview = legacyCommand("migrate"); succeed(currentPreview); assert.deepEqual(JSON.parse(currentPreview.stdout).changes, []);
  for (const [path, bytes] of oldAuthored) assert.deepEqual(readFileSync(join(oldProject, path)), bytes);
});

events.terminal("pass");
console.log(JSON.stringify({ hsonSchemaCompilerProjectAcceptance: "passed", checks, typescript: ts.version }));
