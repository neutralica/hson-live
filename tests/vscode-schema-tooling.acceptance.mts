import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { discover_schema_project, resolve_workspace_hson_schema_tool } from "../editors/vscode-hson/src/schema-tooling.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

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
const config = join(project, "tsconfig.json");
writeFileSync(config, JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext" }, include: ["./schema.ts"] }, null, 2));
writeFileSync(source, 'import { Hson, type HsonSchema } from "hson-live";\nexport const UserSchema: HsonSchema = Hson`<type "data" content <name "string">>`;\n');

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

await new Promise<void>((resolveWatch, rejectWatch) => {
  const watcher = spawn(process.execPath, [tool.executable, "watch", "--project", config], { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  watcher.stdout?.on("data", chunk => { output += String(chunk); });
  watcher.stderr?.on("data", chunk => { output += String(chunk); });
  const original = readFileSync(source, "utf8");
  const deadline = Date.now() + 10_000;
  const tick = (): void => {
    if (!output.includes("Hson Schema watch active")) { if (Date.now() < deadline) return void setTimeout(tick, 50); watcher.kill(); return rejectWatch(new Error(output)); }
    writeFileSync(source, original.replace('name "string"', 'name "string" age "number"'));
    const artifact = join(project, "schema.UserSchema.hson-schema.generated.ts");
    const waitGenerated = (): void => {
      if (existsSync(artifact) && /readonly age:/.test(readFileSync(artifact, "utf8"))) {
        writeFileSync(source, readFileSync(source, "utf8").replaceAll("UserSchema", "AccountSchema"));
        const renamedArtifact = join(project, "schema.AccountSchema.hson-schema.generated.ts");
        const waitRename = (): void => {
          if (existsSync(renamedArtifact) && !existsSync(artifact) && !readFileSync(source, "utf8").includes("UserSchema")) { watcher.kill("SIGTERM"); return resolveWatch(); }
          if (Date.now() < deadline) return void setTimeout(waitRename, 50);
          watcher.kill("SIGTERM"); rejectWatch(new Error(output));
        };
        return waitRename();
      }
      if (Date.now() < deadline) return void setTimeout(waitGenerated, 50);
      watcher.kill("SIGTERM"); rejectWatch(new Error(output));
    };
    waitGenerated();
  };
  tick();
});
check("packed consumer watch regenerates changed and renamed Schema evidence, then stops cleanly", () => assert.equal(run("check").status, 0));

emit_hson_live_test_completion("vscode-schema-tooling", checks, checks, 0);
