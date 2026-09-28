import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Content identity of the shipped Schema CLI and its transitive tooling inputs.
 * Source is included in the package, so source and compiled CLI invocations use
 * the same identity. Include emitted implementations when present as well as
 * type-only source imports that affect generated declaration proof.
 * Re-read on each check: a running watcher must observe tooling edits too.
 */
export function schema_tooling_fingerprint(root = packageRoot, typescriptVersion = ts.version): string {
  const inputs = new Map<string, string>();
  const visit = (path: string): void => {
    path = resolve(path);
    const name = relative(root, path).split(sep).join("/");
    if (name.startsWith("../") || name === "..") throw new Error("Schema tooling input escapes its package.");
    if (inputs.has(name)) return;
    const bytes = readFileSync(path);
    inputs.set(name, createHash("sha256").update(bytes).digest("hex"));
    const emitted = name === "scripts/hson-schema.mts" ? "dist/hson-schema.mjs"
      : name.startsWith("src/") && !name.endsWith(".d.ts")
        ? name.replace(/^src\//, "dist/").replace(/\.mts$/, ".mjs").replace(/\.cts$/, ".cjs").replace(/\.ts$/, ".js") : undefined;
    if (emitted !== undefined && existsSync(resolve(root, emitted))) {
      inputs.set(emitted, createHash("sha256").update(readFileSync(resolve(root, emitted))).digest("hex"));
    }
    if (path.endsWith(".json")) return;
    for (const dependency of ts.preProcessFile(bytes.toString("utf8"), true, true).importedFiles) {
      if (!dependency.fileName.startsWith(".")) continue;
      const target = resolve(dirname(path), dependency.fileName);
      const source = target.replace(/\.(?:mjs|cjs|js)$/, extension => extension === ".mjs" ? ".mts" : extension === ".cjs" ? ".cts" : ".ts");
      visit(existsSync(source) ? source : target);
    }
  };
  visit(resolve(root, "scripts/hson-schema.mts"));
  visit(resolve(root, "scripts/build-hson-schema-cli.mjs"));
  visit(resolve(root, "tsconfig.json"));
  return createHash("sha256").update(JSON.stringify({ typescript: typescriptVersion,
    inputs: [...inputs].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
  })).digest("hex");
}
