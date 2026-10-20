import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { family_selector_cases, family_selector_echo_cases } from "./fixtures/family-selectors-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "family-selectors", title: "Direct family selectors and checked Schema evidence", category: "LiveMap", runtime: "node",
  tags: Object.freeze(["public-api", "libraries", "typescript", "declarations", "worker", "authority"]),
});

// Compile current source outside the repository. Strict consumer proofs must exercise
// its declarations, without changing tracked distribution or imposing consumer flags on implementation code.
const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "hson-family-selectors-"));
try {
  const compiler = join(root, "node_modules/typescript/bin/tsc");
  execFileSync(process.execPath, [compiler, "-p", join(root, "tsconfig.json"), "--outDir", join(temporary, "src"),
    "--emitDeclarationOnly", "--declarationMap", "false"], { stdio: "inherit" });
  mkdirSync(join(temporary, "tests"));
  cpSync(join(root, "tests/family-selectors.types.ts"), join(temporary, "tests/family-selectors.types.ts"));
  writeFileSync(join(temporary, "package.json"), '{"type":"module"}\n');
  symlinkSync(join(root, "node_modules"), join(temporary, "node_modules"), "dir");
  for (const exact of ["false", "true"]) {
    execFileSync(process.execPath, [compiler, "--noEmit", "--strict", "--noUncheckedIndexedAccess",
      "--noPropertyAccessFromIndexSignature", "--target", "ESNext", "--module", "NodeNext",
      "--exactOptionalPropertyTypes", exact, join(temporary, "tests/family-selectors.types.ts")], { stdio: "inherit" });
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
await family_selector_cases();
await family_selector_echo_cases();
const worker = repository_typescript_worker(new URL("./fixtures/family-selectors.worker.mts", import.meta.url));
try {
  assert.equal(await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(Error(`Worker exited ${code}`)));
  }), "pass");
} finally { await worker.terminate(); }
console.log("Direct family selectors: strict declarations (both optional modes), Node and Worker passed.");
