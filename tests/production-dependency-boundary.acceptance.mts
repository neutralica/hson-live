import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "core.production-dependency-boundary",
  title: "Production dependency boundary",
  category: "Core",
  runtime: "node",
  tags: Object.freeze(["dependencies", "production", "removals", "public-api"]),
});

const testEvents = create_test_event_emitter("core.production-dependency-boundary");

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(repositoryRoot, "src");
const excludedSourceDirectories = new Set(["_refactor", "_tests", "diagnostics"]);
const sourceExtensions = new Set([".ts", ".mts", ".js", ".mjs"]);
const importSpecifierPattern = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
const testOnlySpecifierPattern = /(?:^|\/)(?:_tests|tests?|fixtures?)(?:\/|$)|(?:^|\/)(?:test-exports|transform-test-oracle|test-circuit)(?:\.[cm]?[jt]s)?$/;

function extension(path: string): string {
  const match = /\.[^.\/]+$/.exec(path);
  return match?.[0] ?? "";
}

function production_source_files(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedSourceDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...production_source_files(path));
    else if (entry.isFile() && sourceExtensions.has(extension(entry.name))) files.push(path);
  }
  return files;
}

const violations: string[] = [];
const files = production_source_files(sourceRoot);
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(importSpecifierPattern)) {
    const specifier = match[1];
    if (specifier !== undefined && testOnlySpecifierPattern.test(specifier)) {
      violations.push(`${relative(repositoryRoot, file)} -> ${specifier}`);
    }
  }
}

function check(name: string, run: () => void): void {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
}

check("production runtime modules do not import test-only modules", () => {
  assert.deepEqual(
    violations,
    [],
    `production runtime modules must not import test-only modules:\n${violations.join("\n")}`,
  );
});

check("removed LiveTree construction engine and graft_body stay absent", () => {
  const productionSource = files.map((path) => readFileSync(path, "utf8")).join("\n");
  assert.equal(
    productionSource.includes("construct_tree") || productionSource.includes("construct-tree"),
    false,
    "the obsolete LiveTree construction engine must not remain reachable in source",
  );
  assert.equal(
    productionSource.includes("graft_body"),
    false,
    "the obsolete graft_body compatibility alias must not remain reachable",
  );
  assert.equal(existsSync(resolve(repositoryRoot, "dist", "api", "livetree", "creation", "construct-tree.js")), false);
  assert.equal(existsSync(resolve(repositoryRoot, "dist", "api", "livetree", "creation", "construct-tree.d.ts")), false);
});

check("removed constructor declarations stay absent", () => {
  const declarations = readFileSync(
    resolve(repositoryRoot, "dist", "types", "constructor.types.d.ts"),
    "utf8",
  );
  for (const symbol of [
    "TreeConstructor_Source",
    "DomQuerySourceConstructor",
    "DomQueryLiveTreeConstructor",
    "LiveTreeConstructor_3",
  ]) {
    assert.equal(
      declarations.includes(symbol),
      false,
      `built declarations must not retain obsolete constructor symbol ${symbol}`,
    );
  }
});

console.log(JSON.stringify({
  productionDependencyBoundary: "ok",
  filesScanned: files.length,
  excludedDiagnosticAndTestRoots: [...excludedSourceDirectories].sort(),
}));
testEvents.terminal("pass");
