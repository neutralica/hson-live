import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { generate_hson_schema_evidence } from "../src/internal/hson-schema/generated-evidence.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson-schema-structural-reads",
  title: "Structural Schema projections and public reads",
  category: "Schema",
  runtime: "node",
  tags: Object.freeze(["schema", "typescript", "declarations", "public-api"]),
});
const events = create_test_event_emitter(HSON_LIVE_TEST_METADATA.id);
const root = resolve(import.meta.dirname, "..");
const fixture = resolve(root, "tests/fixtures/hson-schema-mvp");
function check(name: string, run: () => void) {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
check("authored aliases and keyword refs compile through safe generated names", () => {
  const ordinaryNames = ["Slide", "Tree", "$Local_2"];
  const keywords: string[] = [];
  for (let token = ts.SyntaxKind.FirstKeyword; token <= ts.SyntaxKind.LastKeyword; token++) {
    const name = ts.tokenToString(token);
    if (name !== undefined) keywords.push(name);
  }
  const files = new Map<string, string>();
  for (const name of [...ordinaryNames, ...keywords]) {
    // Exercise the reported unquoted names, too; quotes allow every other
    // TypeScript keyword to remain an ordinary name in the Schema language.
    const definition = name === "as" || name === "infer" ? name : `'${name}'`;
    const generated = generate_hson_schema_evidence("KeywordSchema",
      `<type "data" defs <${definition} "string"> content <ref "${name}">>`, `keyword#${name}`);
    assert.equal(generated.proofNodeCount, 0);
    assert.doesNotMatch(generated.declaration, /__Value|Proof\d|MutationCandidate/);
    if (ordinaryNames.includes(name)) assert.ok(generated.declaration.includes(`export type ${name} = string;`));
    files.set(resolve(fixture, `__alias-${name}.ts`), `${generated.declaration}
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type RefIsString = Assert<Equal<Evidence["value"], string>>;
const value: Evidence["value"] = "ordinary";
// @ts-expect-error Ref resolution must retain the string domain.
const invalid: Evidence["value"] = 3;
void [value, invalid];
`);
  }
  const options: ts.CompilerOptions = { strict: true, noEmit: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: [] };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) => {
    const source = files.get(file);
    return source === undefined ? getSourceFile(file, ...args) : ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true);
  };
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([...files.keys()], options, host));
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => "\n",
  }));
});
check("structural construction, reads, independent proposals and certificates typecheck", () => {
  for (const action of ["generate", "build"]) {
    const result = spawnSync(process.execPath, ["--import=tsx", "scripts/hson-schema.mts", action, "--project", resolve(fixture, "tsconfig.json")], { cwd: root, encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  // The fixture above uses exact optionals and checked indexes. These repository
  // tests also import runtime source, so use the source project's strict settings.
  const options: ts.CompilerOptions = { strict: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true, allowImportingTsExtensions: true, types: ["node"] };
  const program = ts.createProgram([resolve(root, "tests/hson-semantic-value-model.types.ts"), resolve(root, "tests/livemap-hson-schema-mutation-proof.acceptance.mts")], options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => "\n",
  }));
});
check("application declarations expose structural roots and path values", () => {
  const declaration = readFileSync(resolve(fixture, "out/structural.types.d.ts"), "utf8");
  const reads = declaration.slice(declaration.indexOf("export declare const rootSnapshot"), declaration.indexOf('import type { HsonSchema'));
  assert.doesNotMatch(reads, /__Value|__\w*Definition\d|Proof\d|HSON_SCHEMA_MUTATION_CANDIDATE|HsonSchemaMutationCandidate|\.Evidence/);
  assert.match(reads, /rootSnapshot: \{\s+readonly slides:/);
  assert.match(reads, /slideSnapshot: import\([^)]+\)\.Slide \| undefined/);
  assert.match(reads, /titleSnapshot: string \| undefined/);
  const evidence = readFileSync(resolve(fixture, "out/internal/hson-schema/structural.types.ts/DeckSchema.hson-schema.generated.d.ts"), "utf8");
  assert.doesNotMatch(evidence, /Proof\d|MutationCandidate|__Value|__\w*Definition\d/);
  assert.match(evidence, /type Slide =/);
  assert.match(evidence, /readonly id: string/);
  assert.match(evidence, /readonly language\?:.*"json".*"html".*"hson"/);
  assert.match(reads, /recursiveSnapshot: import\([^)]+\)\.Tree/);
  assert.match(reads, /mutualSnapshot: import\([^)]+\)\.A/);
  assert.match(evidence, /type Block =/);
  assert.match(evidence, /__Identity: unique symbol/);
});
check("stock TypeScript hovers contain precise ordinary application shapes", () => {
  const configPath = resolve(fixture, ".hson/compiler-input/tsconfig.json/tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  const service = ts.createLanguageService({
    getCompilationSettings: () => parsed.options, getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: () => "0", getCurrentDirectory: () => fixture, getDefaultLibFileName: ts.getDefaultLibFilePath,
    getScriptSnapshot: file => { const text = ts.sys.readFile(file); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
    fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
  });
  try {
    const file = resolve(fixture, ".hson/compiler-input/tsconfig.json/sources/structural.types.ts");
    const source = readFileSync(file, "utf8");
    for (const name of ["rootSnapshot", "slideSnapshot", "pathSnapshot", "chainedSnapshot", "titleSnapshot"]) {
      const hover = service.getQuickInfoAtPosition(file, source.indexOf(`const ${name}`) + 6);
      assert.ok(hover, name);
      const display = ts.displayPartsToString(hover.displayParts);
      assert.doesNotMatch(display, /__Value|__\w*Definition\d|Proof\d|MutationCandidate|HSON_SCHEMA/);
      assert.match(display, name === "titleSnapshot" ? /string \| undefined/ : name === "rootSnapshot" ? /readonly slides:/ : /Slide \| undefined/);
    }
  } finally { service.dispose(); }
});
events.terminal("pass");
