import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { representation_required_cases } from "./fixtures/representation-required-cases.mts";
import { representation_markup_cases } from "./fixtures/representation-markup-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "representation-required", title: "Representations and required endpoint reads", category: "LiveMap", runtime: "node",
  tags: Object.freeze(["public-api", "document", "declarations", "worker", "authority"]),
});
const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "hson-representation-required-"));
try {
  const compiler = join(root, "node_modules/typescript/bin/tsc");
  execFileSync(process.execPath, [compiler, "-p", join(root, "tsconfig.json"), "--outDir", join(temporary, "dist"),
    "--declarationMap", "false", "--sourceMap", "false"], { stdio: "inherit" });
  cpSync(join(root, "package.json"), join(temporary, "package.json"));
  cpSync(join(root, "tests/representation-required.types.ts"), join(temporary, "consumer.ts"));
  symlinkSync(join(root, "node_modules"), join(temporary, "node_modules"), "dir");
  for (const exact of ["false", "true"]) {
    execFileSync(process.execPath, [compiler, "--noEmit", "--strict", "--noUncheckedIndexedAccess",
      "--noPropertyAccessFromIndexSignature", "--target", "ESNext", "--module", "NodeNext",
      "--exactOptionalPropertyTypes", exact, join(temporary, "consumer.ts")], { stdio: "inherit" });
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
await representation_required_cases();
const count = representation_markup_cases();
const worker = repository_typescript_worker(new URL("./fixtures/representation-required.worker.mts", import.meta.url));
try {
  assert.deepEqual(await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(Error(`Worker exited ${code}`)));
  }), { isMainThread: false, hasDocument: false, markupCases: count });
} finally { await worker.terminate(); }
console.log(`Required reads, ${count} contextual markup cases, Node, actual Worker, and strict emitted declarations in both optional modes passed.`);
