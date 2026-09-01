import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import {
  audit_editor_parity,
  audit_coverage,
  read_observability_manifest,
  resolved_project_inventory,
  tracked_typescript_files,
  type Exemption,
  type ProjectOwnership,
  type ProjectSpec,
} from "../scripts/typescript-observability.mts";

const primaryRoot: ProjectOwnership = { project: "tsconfig.json", role: "primary", inclusion: "root" };
const owned = new Map<string, readonly ProjectOwnership[]>([["owned.ts", [primaryRoot]]]);
assert.deepEqual(audit_coverage(["owned.ts"], owned, []).errors, []);
assert.match(audit_coverage(["orphan.ts"], new Map(), []).errors[0] ?? "", /orphan\.ts/);
assert.match(audit_coverage(["orphan.mts"], new Map(), []).errors[0] ?? "", /orphan\.mts/);

const negative: Exemption = {
  file: "negative.ts",
  kind: "negative-compile-fixture",
  authority: "fixture diagnostic assertion",
  reason: "Synthetic negative fixture for the observability guard.",
};
const classified = audit_coverage(["negative.ts"], new Map([["negative.ts", [primaryRoot]]]), [negative]);
assert.deepEqual(classified.errors, []);
assert.deepEqual(classified.classes.negative, ["negative.ts"]);

const stale = audit_coverage([], new Map(), [negative]);
assert.match(stale.errors[0] ?? "", /missing or untracked/);
const deletedArtifact: Exemption = { ...negative, file: "deleted.ts", kind: "non-typechecked-artifact" };
assert.match(audit_coverage([], new Map(), [deletedArtifact]).errors[0] ?? "", /deleted\.ts/);

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifest = read_observability_manifest(join(repositoryRoot, "typescript-observability.json"));
const tracked = tracked_typescript_files(repositoryRoot);
const inventory = resolved_project_inventory(repositoryRoot, manifest.projects);
assert.equal(tracked.includes("tests/typescript-observability.acceptance.mts"), true);
assert.equal(inventory.owners.has("tests/typescript-observability.acceptance.mts"), true);
assert.equal(inventory.owners.get("scripts/hson-schema.mts")?.some((owner) => owner.project === "scripts/tsconfig.json" && owner.role === "primary" && owner.inclusion === "root"), true);

const repairedPrimaryProjects = new Map<string, string>([
  ["editors/vscode-hson/src/tsserver-plugin/tsserver-plugin.ts", "editors/vscode-hson/src/tsserver-plugin/tsconfig.json"],
  ["scripts/hson-schema.mts", "scripts/tsconfig.json"],
  ["scripts/typescript-observability.mts", "scripts/tsconfig.json"],
  ["tests/entrypoints/public/public-entrypoints.ts", "tests/entrypoints/public/tsconfig.json"],
  ["tests/entrypoints/public/root-compatibility.ts", "tests/entrypoints/public/tsconfig.json"],
  ["tests/entrypoints/worker/hson-worker.ts", "tests/entrypoints/worker/tsconfig.json"],
  ["tests/entrypoints/worker/livemap-worker.ts", "tests/entrypoints/worker/tsconfig.json"],
  ["tests/entrypoints/worker/locus-worker.ts", "tests/entrypoints/worker/tsconfig.json"],
  ["tests/entrypoints/worker/transform-worker.ts", "tests/entrypoints/worker/tsconfig.json"],
  ["tests/entrypoints/node/livehost-node.ts", "tests/entrypoints/node/tsconfig.json"],
  ["tests/entrypoints/browser/livetree-browser.ts", "tests/entrypoints/browser/tsconfig.json"],
]);
const repairedAudit = audit_editor_parity(repositoryRoot, [...repairedPrimaryProjects.keys()], manifest.projects, inventory);
assert.deepEqual(repairedAudit.errors, []);
assert.equal(repairedAudit.configuredOrdinary, 11);
assert.equal(repairedAudit.parityOrdinary, 11);
assert.deepEqual(repairedAudit.primaryProjects, repairedPrimaryProjects);

const pluginConfigPath = join(repositoryRoot, "editors/vscode-hson/src/tsserver-plugin/tsconfig.json");
const pluginConfig = ts.parseJsonConfigFileContent(ts.readConfigFile(pluginConfigPath, ts.sys.readFile).config, ts.sys, join(repositoryRoot, "editors/vscode-hson/src/tsserver-plugin"));
assert.equal(pluginConfig.options.module, ts.ModuleKind.CommonJS);
const toolingConfigPath = join(repositoryRoot, "scripts/tsconfig.json");
const toolingConfig = ts.parseJsonConfigFileContent(ts.readConfigFile(toolingConfigPath, ts.sys.readFile).config, ts.sys, join(repositoryRoot, "scripts"));
assert.equal(toolingConfig.options.types?.includes("node"), true);

const temporary = mkdtempSync(join(tmpdir(), "hson-observability-"));
try {
  writeFileSync(join(temporary, "latent-error.mts"), "const value: string = 1;\nvoid value;\n");
  writeFileSync(join(temporary, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, files: ["latent-error.mts"] }));
  const temporaryProjects: readonly ProjectSpec[] = [{ path: "tsconfig.json", role: "primary", authority: "acceptance test" }];
  const temporaryInventory = resolved_project_inventory(temporary, temporaryProjects);
  const editorAudit = audit_editor_parity(temporary, ["latent-error.mts"], temporaryProjects, temporaryInventory);
  assert.deepEqual(editorAudit.errors, []);
  assert.equal(editorAudit.configuredOrdinary, 1);
  assert.equal(editorAudit.parityOrdinary, 1);

  const compiler = spawnSync(process.execPath, [resolve(repositoryRoot, "node_modules/typescript/bin/tsc"), "-p", join(temporary, "tsconfig.json")], { encoding: "utf8" });
  assert.notEqual(compiler.status, 0, "A latent error injected into an observed .mts project must fail TypeScript.");
  assert.match(compiler.stdout, /TS2322/);

  rmSync(join(temporary, "tsconfig.json"));
  const inferredAudit = audit_editor_parity(temporary, ["latent-error.mts"], [], { owners: new Map() });
  assert.match(inferredAudit.errors[0] ?? "", /inferred or missing project/);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({ typescriptObservabilityAcceptance: "ok", checks: 20 }));
