import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  const source = specifiers
    .map((specifier) => `await import(${JSON.stringify(specifier)});`)
    .join("\n");
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(
    child.status,
    0,
    `fresh import failed for ${specifiers.join(" -> ")}\n${child.stderr || child.stdout}`,
  );
}

const publicSpecifiers = Object.keys(manifest.exports)
  .map(package_specifier)
  .sort();

for (const specifier of publicSpecifiers) {
  import_in_fresh_process([specifier]);
}

import_in_fresh_process(["hson-live/livetree", "hson-live/reflect"]);
import_in_fresh_process(["hson-live/reflect", "hson-live/livetree"]);

console.log(JSON.stringify({
  publicEntrypointRuntime: "ok",
  freshProcesses: publicSpecifiers.length + 2,
  entrypoints: publicSpecifiers,
  importOrders: [
    ["hson-live/livetree", "hson-live/reflect"],
    ["hson-live/reflect", "hson-live/livetree"],
  ],
}));
