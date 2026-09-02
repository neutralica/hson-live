import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { discover_schema_project, resolve_workspace_hson_schema_tool } from "../editors/vscode-hson/src/schema-tooling.ts";

let checks = 0;
function check(name: string, body: () => void): void { body(); console.log(`ok ${++checks} - ${name}`); }

const root = resolve(".");
const packed = mkdtempSync(join(tmpdir(), "hson-schema-vsix-pack-"));
const packedResult = spawnSync("npm", ["pack", "--json", "--pack-destination", packed, "--cache", join(packed, "npm-cache")], { cwd: root, encoding: "utf8" });
assert.equal(packedResult.status, 0, packedResult.stderr);
const archiveName: unknown = JSON.parse(packedResult.stdout)[0]?.filename;
if (typeof archiveName !== "string") throw new Error("npm pack did not report its artifact filename.");
const project = mkdtempSync(join(tmpdir(), "hson-schema-vscode-consumer-"));
mkdirSync(join(project, "node_modules"), { recursive: true });
const unpacked = spawnSync("tar", ["-xzf", join(packed, archiveName), "-C", join(project, "node_modules")], { encoding: "utf8" });
assert.equal(unpacked.status, 0, unpacked.stderr);
const renamed = spawnSync("mv", [join(project, "node_modules", "package"), join(project, "node_modules", "hson-live")], { encoding: "utf8" });
assert.equal(renamed.status, 0, renamed.stderr);
symlinkSync(resolve("node_modules/typescript"), join(project, "node_modules", "typescript"), "dir");
for (const dependency of ["dompurify", "htmlparser2", "ws", "@types/dompurify", "@types/ws"]) {
  const target = resolve("node_modules", dependency), link = join(project, "node_modules", dependency);
  mkdirSync(resolve(link, ".."), { recursive: true });
  symlinkSync(target, link, "dir");
}
const source = join(project, "schema.ts");
const candidate = join(project, "candidate.ts");
const config = join(project, "tsconfig.json");
const baseConfig = join(project, "tsconfig.base.json");
writeFileSync(baseConfig, JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", forceConsistentCasingInFileNames: false } }, null, 2));
writeFileSync(config, JSON.stringify({ extends: "./tsconfig.base.json", include: ["./*.ts"] }, null, 2));
writeFileSync(source, 'import { Hson, type HsonSchema } from "hson-live";\nexport const UserSchema: HsonSchema = Hson`<type "data" content <name "string">>`;\n');
writeFileSync(candidate, 'import { Hson } from "hson-live"; import type { UserSchemaHson } from "./schema.js";\nconst candidate: UserSchemaHson = Hson`<name "Ada">`; void candidate;\n');

const tool = resolve_workspace_hson_schema_tool(project);
check("packed consumer resolves its installed public hson-schema executable", () => {
  assert.equal(tool.packageRoot, resolve(project, "node_modules/hson-live"));
  assert.equal(discover_schema_project(project, source), config);
  assert.ok(tool.executable.endsWith("dist/hson-schema.mjs"));
});

const run = (mode: "generate" | "check") => spawnSync(process.execPath, [tool.executable, mode, "--project", config], { cwd: project, encoding: "utf8" });
check("packed consumer Generate creates real Type and Hson exports", () => {
  const generated = run("generate");
  assert.equal(generated.status, 0, generated.stdout + generated.stderr + generated.error?.message);
  const text = readFileSync(source, "utf8");
  assert.match(text, /UserSchemaType/); assert.match(text, /UserSchemaHson/);
  const checked = run("check");
  assert.equal(checked.status, 0, checked.stdout + checked.stderr + checked.error?.message);
});

const watcher = spawn(process.execPath, [tool.executable, "watch", "--project", config], { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
let watchOutput = "";
watcher.stdout?.on("data", chunk => { watchOutput += String(chunk); });
watcher.stderr?.on("data", chunk => { watchOutput += String(chunk); });
const waitFor = async (condition: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 20_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`${label}\n${watchOutput}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
};
const original = readFileSync(source, "utf8");
const artifact = join(project, "schema.UserSchema.hson-schema.generated.ts");
await waitFor(() => watchOutput.includes(`Hson Schema watch: checking ${config}.`) && watchOutput.includes("Hson Schema watch: current; 1 Schema;"), "watch did not report its project and initial current state");
const beforeCandidateError = watchOutput.length;
writeFileSync(candidate, readFileSync(candidate, "utf8").replace('name "Ada"', "name 1"));
await waitFor(() => watchOutput.slice(beforeCandidateError).includes("Hson Schema watch: stale/error;"), "watch did not react to an invalid separate Schema-bound candidate without a literal HsonSchema name");
const beforeCandidateRecovery = watchOutput.length;
writeFileSync(candidate, readFileSync(candidate, "utf8").replace("name 1", 'name "Ada"'));
await waitFor(() => watchOutput.slice(beforeCandidateRecovery).includes("Hson Schema watch: current; 1 Schema;"), "watch did not recover after correcting the separate Schema-bound candidate");
const beforeConfigCycle = watchOutput.length;
writeFileSync(baseConfig, readFileSync(baseConfig, "utf8").replace('"forceConsistentCasingInFileNames": false', '"forceConsistentCasingInFileNames": true'));
await waitFor(() => watchOutput.slice(beforeConfigCycle).includes("Hson Schema watch: current; 1 Schema;"), "watch did not react to the extended project configuration");
writeFileSync(source, original.replace('name "string"', 'name "string" age <optional "number">'));
await waitFor(() => existsSync(artifact) && /readonly age\?:/.test(readFileSync(artifact, "utf8")), "watch did not regenerate valid Schema evidence");
const beforeError = watchOutput.length;
writeFileSync(source, readFileSync(source, "utf8").replace('age <optional "number">', "age <broken"));
await waitFor(() => watchOutput.slice(beforeError).includes("Hson Schema watch: stale/error;"), "watch did not surface an invalid Schema");
const beforeRecovery = watchOutput.length;
writeFileSync(source, readFileSync(source, "utf8").replace("age <broken", 'age <optional "number">'));
await waitFor(() => watchOutput.slice(beforeRecovery).includes("Hson Schema watch: current; 1 Schema;"), "watch did not recover after correcting the Schema");
writeFileSync(source, readFileSync(source, "utf8").replaceAll("UserSchema", "AccountSchema"));
writeFileSync(candidate, readFileSync(candidate, "utf8").replaceAll("UserSchema", "AccountSchema"));
const renamedArtifact = join(project, "schema.AccountSchema.hson-schema.generated.ts");
await waitFor(() => existsSync(renamedArtifact) && !existsSync(artifact) && !readFileSync(source, "utf8").includes("UserSchema"), "watch did not reconcile renamed Schema evidence");
const stopped = new Promise<number | null>(resolveStopped => watcher.once("close", code => resolveStopped(code)));
watcher.kill("SIGTERM");
assert.equal(await stopped, 0, watchOutput);
check("packed consumer watch reports project/current/error/recovery, reconciles changes, and stops cleanly", () => assert.equal(run("check").status, 0));
