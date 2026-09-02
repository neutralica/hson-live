import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "core.public-entrypoint-runtime",
  title: "Public entrypoint runtime boundary",
  category: "Core",
  runtime: "node",
  tags: Object.freeze(["entrypoints", "runtime", "exports", "built-package"]),
});

const testEvents = create_test_event_emitter("core.public-entrypoint-runtime");

type PackageManifest = Readonly<{
  name: string;
  exports: Readonly<Record<string, unknown>>;
}>;

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
) as PackageManifest;

function package_specifier(exportPath: string): string {
  return exportPath === "."
    ? manifest.name
    : `${manifest.name}/${exportPath.slice(2)}`;
}

function import_in_fresh_process(specifiers: readonly string[]): void {
  const caseId = `fresh import: ${specifiers.join(" -> ")}`;
  testEvents.case_begin(caseId, caseId);
  const source = specifiers
    .map((specifier) => `await import(${JSON.stringify(specifier)});`)
    .join("\n");
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  try {
    assert.equal(
      child.status,
      0,
      `fresh import failed for ${specifiers.join(" -> ")}\n${child.stderr || child.stdout}`,
    );
    testEvents.case_end(caseId, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(caseId, "assertion", message.slice(0, 1_000));
    testEvents.case_end(caseId, "fail");
    testEvents.terminal("fail");
    throw error;
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

const publicSpecifiers = Object.keys(manifest.exports)
  .map(package_specifier)
  .sort();

for (const specifier of publicSpecifiers) {
  import_in_fresh_process([specifier]);
}

import_in_fresh_process(["hson-live/livetree", "hson-live/reflect"]);
import_in_fresh_process(["hson-live/reflect", "hson-live/livetree"]);

check("diagnostics entrypoints exist in the package and built output", () => {
  assert.notEqual(manifest.exports["./diagnostics"], undefined);
  assert.notEqual(manifest.exports["./diagnostics/universal-circuit"], undefined);
  assert.equal(existsSync(resolve(repositoryRoot, "dist", "diagnostics", "index.js")), true);
  assert.equal(existsSync(resolve(repositoryRoot, "dist", "diagnostics", "verify-universal-circuit.js")), true);
});

check("removed LiveMap pseudo-QUID declarations and runtime modules stay absent", () => {
  const removedSymbols = [
    "LiveMapQuid",
    "LiveMapQuidOwner",
    "LiveMapQuidRef",
    "debug_livemap_quids",
    "drop_livemap_quid",
    "ensure_livemap_quid",
    "get_livemap_owner",
    "get_livemap_quid",
    "reindex_livemap_quid",
    "remint_livemap_quid",
  ];
  const declarationText = [
    resolve(repositoryRoot, "dist", "index.d.ts"),
    resolve(repositoryRoot, "dist", "api", "livemap", "index.d.ts"),
    resolve(repositoryRoot, "dist", "types", "livemap.types.d.ts"),
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  for (const symbol of removedSymbols) {
    assert.equal(
      declarationText.includes(symbol),
      false,
      `built declarations must not expose removed LiveMap pseudo-QUID symbol ${symbol}`,
    );
  }
  assert.equal(existsSync(resolve(repositoryRoot, "dist", "api", "livemap", "livemap.quid.js")), false);
  assert.equal(existsSync(resolve(repositoryRoot, "dist", "api", "livemap", "livemap.quid.d.ts")), false);
});

console.log(JSON.stringify({
  publicEntrypointRuntime: "ok",
  freshProcesses: publicSpecifiers.length + 2,
  entrypoints: publicSpecifiers,
  importOrders: [
    ["hson-live/livetree", "hson-live/reflect"],
    ["hson-live/reflect", "hson-live/livetree"],
  ],
}));
testEvents.terminal("pass");
