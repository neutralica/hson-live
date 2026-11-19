import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import {
  audit_editor_parity,
  audit_coverage,
  aggregate_project_results,
  read_observability_manifest,
  resolved_project_inventory,
  run_selected_project_comparisons,
  tracked_typescript_files,
  type ProjectDiagnosticResult,
  type EditorSelection,
  type Exemption,
  type ProjectOwnership,
  type ProjectSpec,
} from "../scripts/typescript-observability.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "tooling.typescript-observability",
  title: "TypeScript observability",
  category: "Tooling",
  runtime: "node",
  tags: Object.freeze(["typescript", "tooling", "coverage", "editor"]),
});

const testEvents = create_test_event_emitter("tooling.typescript-observability");
const observabilityCase = "TypeScript sources remain covered by explicit compiler projects";
testEvents.case_begin(observabilityCase, observabilityCase);
try {

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

const expectedPrimaryProjects = new Map<string, string>([
  ["src/api/transform/parsers/tokenize-hson.ts", "tsconfig.json"],
  ["editors/vscode-hson/src/extension.ts", "editors/vscode-hson/tsconfig.json"],
  ["editors/vscode-hson/src/tsserver-plugin/tsserver-plugin.ts", "editors/vscode-hson/src/tsserver-plugin/tsconfig.json"],
  ["scripts/hson-schema.mts", "scripts/tsconfig.json"],
  ["scripts/typescript-observability.mts", "scripts/tsconfig.json"],
  ["tests/entrypoints/public/public-entrypoints.ts", "tests/entrypoints/public/tsconfig.json"],
  ["tests/entrypoints/public/root-compatibility.ts", "tests/entrypoints/public/tsconfig.json"],
  ["tests/entrypoints/worker/hson-worker.ts", "tests/entrypoints/worker/tsconfig.json"],
  ["tests/entrypoints/worker/livemap-worker.ts", "tests/entrypoints/worker/tsconfig.json"],
  ["tests/entrypoints/worker/locus-worker.ts", "tests/entrypoints/worker/tsconfig.json"],
  ["tests/entrypoints/worker/ssr-worker.ts", "tests/entrypoints/worker/tsconfig.json"],
  ["tests/entrypoints/worker/transform-worker.ts", "tests/entrypoints/worker/tsconfig.json"],
  ["tests/entrypoints/node/livehost-node.ts", "tests/entrypoints/node/tsconfig.json"],
  ["tests/entrypoints/browser/livetree-browser.ts", "tests/entrypoints/browser/tsconfig.json"],
]);
const schema2Directory = "experiments/schema2";
const schema2Project = `${schema2Directory}/tsconfig.json`;
const schema2Files = tracked.filter((file) => dirname(file) === schema2Directory);
assert.ok(schema2Files.length > 0, "Expected TypeScript sources in the private Schema 2.0 project.");
for (const file of schema2Files) {
  const owners = inventory.owners.get(file) ?? [];
  assert.ok(owners.some((owner) => owner.project === schema2Project && owner.role === "primary" && owner.inclusion === "root"),
    `${file} must be a root of the primary Schema 2.0 project.`);
  assert.equal(owners.some((owner) => owner.project === "tsconfig.json"), false,
    `${file} must stay outside the production TypeScript program.`);
  expectedPrimaryProjects.set(file, schema2Project);
}

const repairedAudit = audit_editor_parity(repositoryRoot, [...expectedPrimaryProjects.keys()], manifest.projects, inventory);
assert.deepEqual(repairedAudit.errors, []);
assert.equal(repairedAudit.configuredOrdinary, expectedPrimaryProjects.size);
assert.equal(repairedAudit.parityOrdinary, expectedPrimaryProjects.size);
assert.deepEqual(repairedAudit.primaryProjects, expectedPrimaryProjects);

const aggregationSelection: EditorSelection = Object.freeze({
  primaryProjects: new Map([["a.ts", "one/tsconfig.json"], ["b.ts", "one/tsconfig.json"], ["c.ts", "two/tsconfig.json"]]),
  editorDiagnostics: new Map([["a.ts", []], ["b.ts", []], ["c.ts", []]]),
  configuredOrdinary: 3,
  classifiedProjects: { negative: { configured: 0, inferred: 0 }, artifact: { configured: 0, inferred: 0 } },
  errors: [],
});
const projectResult = (project: string, files: readonly string[]): ProjectDiagnosticResult => Object.freeze({
  project,
  files,
  parityFiles: files,
  errors: [],
});
const comparisonCalls: string[] = [];
const aggregated = run_selected_project_comparisons(aggregationSelection, (project) => {
  comparisonCalls.push(project);
  return project === "one/tsconfig.json"
    ? projectResult(project, ["a.ts", "b.ts"])
    : projectResult(project, ["c.ts"]);
});
assert.deepEqual(comparisonCalls, ["one/tsconfig.json", "two/tsconfig.json"]);
assert.equal(aggregated.configuredOrdinary, 3);
assert.equal(aggregated.parityOrdinary, 3);
assert.deepEqual(aggregated.primaryProjects, aggregationSelection.primaryProjects);
const mismatch = aggregate_project_results(aggregationSelection, [
  Object.freeze({ ...projectResult("one/tsconfig.json", ["a.ts", "b.ts"]), parityFiles: ["b.ts"], errors: ["a.ts: editor diagnostics differ"] }),
  projectResult("two/tsconfig.json", ["c.ts"]),
]);
assert.equal(mismatch.parityOrdinary, 2);
assert.deepEqual(mismatch.errors, ["a.ts: editor diagnostics differ"]);
assert.throws(() => aggregate_project_results(aggregationSelection, [projectResult("one/tsconfig.json", ["a.ts", "b.ts"])]), /Missing TypeScript project diagnostic result/);
assert.throws(() => aggregate_project_results(aggregationSelection, [
  projectResult("one/tsconfig.json", ["a.ts", "b.ts"]),
  projectResult("one/tsconfig.json", ["a.ts", "b.ts"]),
  projectResult("two/tsconfig.json", ["c.ts"]),
]), /Duplicate TypeScript project diagnostic result/);
assert.throws(() => aggregate_project_results(aggregationSelection, [
  { project: "one/tsconfig.json" },
]), /Malformed TypeScript project diagnostic result/);
const attemptedProjects: string[] = [];
assert.throws(() => run_selected_project_comparisons(aggregationSelection, (project) => {
  attemptedProjects.push(project);
  throw new Error(`child failed: ${project}`);
}), /child failed: one\/tsconfig\.json/);
assert.deepEqual(attemptedProjects, ["one/tsconfig.json"]);
const laterFailureProjects: string[] = [];
assert.throws(() => run_selected_project_comparisons(aggregationSelection, (project) => {
  laterFailureProjects.push(project);
  if (project === "two/tsconfig.json") throw new Error(`child failed: ${project}`);
  return projectResult(project, ["a.ts", "b.ts"]);
}), /child failed: two\/tsconfig\.json/);
assert.deepEqual(laterFailureProjects, ["one/tsconfig.json", "two/tsconfig.json"]);

const pluginConfigPath = join(repositoryRoot, "editors/vscode-hson/src/tsserver-plugin/tsconfig.json");
const pluginConfig = ts.parseJsonConfigFileContent(ts.readConfigFile(pluginConfigPath, ts.sys.readFile).config, ts.sys, join(repositoryRoot, "editors/vscode-hson/src/tsserver-plugin"));
assert.equal(pluginConfig.options.module, ts.ModuleKind.CommonJS);
const toolingConfigPath = join(repositoryRoot, "scripts/tsconfig.json");
const toolingConfig = ts.parseJsonConfigFileContent(ts.readConfigFile(toolingConfigPath, ts.sys.readFile).config, ts.sys, join(repositoryRoot, "scripts"));
assert.equal(toolingConfig.options.types?.includes("node"), true);

const temporary = mkdtempSync(join(tmpdir(), "hson-observability-"));
try {
  const git = spawnSync("git", ["init", "--quiet", "--template="], { cwd: temporary, encoding: "utf8" });
  assert.equal(git.status, 0, git.error?.message ?? git.stderr);
  writeFileSync(join(temporary, "latent-error.mts"), "const value: string = 1;\nvoid value;\n");
  writeFileSync(join(temporary, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, files: ["latent-error.mts"] }));
  const temporaryFiles = tracked_typescript_files(temporary);
  assert.deepEqual(temporaryFiles, ["latent-error.mts"]);
  const temporaryProjects: readonly ProjectSpec[] = [{ path: "tsconfig.json", role: "primary", authority: "acceptance test" }];
  const temporaryInventory = resolved_project_inventory(temporary, temporaryProjects);
  assert.deepEqual(audit_coverage(temporaryFiles, temporaryInventory.owners, []).errors, []);
  const editorAudit = audit_editor_parity(temporary, temporaryFiles, temporaryProjects, temporaryInventory);
  assert.deepEqual(editorAudit.errors, []);
  assert.equal(editorAudit.configuredOrdinary, 1);
  assert.equal(editorAudit.parityOrdinary, 1);

  const compiler = spawnSync(process.execPath, [resolve(repositoryRoot, "node_modules/typescript/bin/tsc"), "-p", join(temporary, "tsconfig.json")], { encoding: "utf8" });
  assert.notEqual(compiler.status, 0, "A latent error injected into an observed .mts project must fail TypeScript.");
  assert.match(compiler.stdout, /TS2322/);

  rmSync(join(temporary, "tsconfig.json"));
  const orphanInventory = resolved_project_inventory(temporary, []);
  assert.deepEqual(audit_coverage(temporaryFiles, orphanInventory.owners, []).errors,
    ["Ordinary TypeScript file has no authoritative project: latent-error.mts"]);
  const inferredAudit = audit_editor_parity(temporary, temporaryFiles, [], orphanInventory);
  assert.match(inferredAudit.errors[0] ?? "", /inferred or missing project/);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({ typescriptObservabilityAcceptance: "ok", projectAssignments: expectedPrimaryProjects.size }));
  testEvents.case_end(observabilityCase, "pass");
  testEvents.terminal("pass");
} catch (error) {
  const message = error instanceof Error ? error.message : "Check failed.";
  testEvents.diagnostic(observabilityCase, "assertion", message.slice(0, 1_000));
  testEvents.case_end(observabilityCase, "fail");
  testEvents.terminal("fail");
  throw error;
}
