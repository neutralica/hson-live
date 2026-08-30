import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  audit_coverage,
  read_observability_manifest,
  resolved_project_coverage,
  tracked_typescript_files,
  type Exemption,
} from "../scripts/typescript-observability.mts";

const owned = new Map<string, readonly string[]>([["owned.ts", ["tsconfig.json"]]]);
assert.deepEqual(audit_coverage(["owned.ts"], owned, []).errors, []);
assert.match(audit_coverage(["orphan.ts"], new Map(), []).errors[0] ?? "", /orphan\.ts/);
assert.match(audit_coverage(["orphan.mts"], new Map(), []).errors[0] ?? "", /orphan\.mts/);

const negative: Exemption = {
  file: "negative.ts",
  kind: "negative-compile-fixture",
  authority: "fixture diagnostic assertion",
  reason: "Synthetic negative fixture for the observability guard.",
};
const classified = audit_coverage(["negative.ts"], new Map(), [negative]);
assert.deepEqual(classified.errors, []);
assert.deepEqual(classified.classes.negative, ["negative.ts"]);

const stale = audit_coverage([], new Map(), [negative]);
assert.match(stale.errors[0] ?? "", /missing or untracked/);
const deletedArtifact: Exemption = { ...negative, file: "deleted.ts", kind: "non-typechecked-artifact" };
assert.match(audit_coverage([], new Map(), [deletedArtifact]).errors[0] ?? "", /deleted\.ts/);

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifest = read_observability_manifest(join(repositoryRoot, "typescript-observability.json"));
const tracked = tracked_typescript_files(repositoryRoot);
const projectOwners = resolved_project_coverage(repositoryRoot, manifest.projects);
assert.equal(tracked.includes("tests/typescript-observability.acceptance.mts"), true);
assert.equal(projectOwners.has("tests/typescript-observability.acceptance.mts"), true);

const temporary = mkdtempSync(join(tmpdir(), "hson-observability-"));
try {
  writeFileSync(join(temporary, "latent-error.mts"), "const value: string = 1;\nvoid value;\n");
  writeFileSync(join(temporary, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, files: ["latent-error.mts"] }));
  const compiler = spawnSync(process.execPath, [resolve(repositoryRoot, "node_modules/typescript/bin/tsc"), "-p", join(temporary, "tsconfig.json")], { encoding: "utf8" });
  assert.notEqual(compiler.status, 0, "A latent error injected into an observed .mts project must fail TypeScript.");
  assert.match(compiler.stdout, /TS2322/);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({ typescriptObservabilityAcceptance: "ok", checks: 9 }));
