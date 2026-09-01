import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(repositoryRoot, "src");
const excludedSourceDirectories = new Set(["_refactor", "_tests", "diagnostics"]);
const sourceExtensions = new Set([".ts", ".mts", ".js", ".mjs"]);
const importSpecifierPattern = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
const testOnlySpecifierPattern = /(?:^|\/)(?:_tests|tests?|fixtures?)(?:\/|$)|(?:^|\/)(?:test-exports|test-launchers|transform-test-oracle|test-circuit)(?:\.[cm]?[jt]s)?$/;

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

assert.deepEqual(
  violations,
  [],
  `production runtime modules must not import test-only modules:\n${violations.join("\n")}`,
);

console.log(JSON.stringify({
  productionDependencyBoundary: "ok",
  filesScanned: files.length,
  excludedDiagnosticAndTestRoots: [...excludedSourceDirectories].sort(),
}));
