import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

const here = dirname(fileURLToPath(import.meta.url));
const testRoot = await realpath(await mkdtemp(join(tmpdir(), "hson-vscode-")));
const userDataDir = join(testRoot, "user");
const extensionsDir = join(testRoot, "extensions");
const restrictedUserDataDir = join(testRoot, "restricted-user");
const restrictedExtensionsDir = join(testRoot, "restricted-extensions");
const workspaceDir = join(testRoot, "workspace");
await mkdir(userDataDir);
await mkdir(extensionsDir);
await mkdir(restrictedUserDataDir);
await mkdir(restrictedExtensionsDir);
await mkdir(workspaceDir);
await mkdir(join(workspaceDir, "static-project"));
await writeFile(join(workspaceDir, "static-project", "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext" }, include: ["**/*.ts"] }));
await writeFile(join(workspaceDir, "static-project", "unopened-invalid.ts"), 'import { Hson } from "hson-live";\nexport const unopened = Hson`+1`;\n');
await writeFile(join(workspaceDir, "unopened-invalid.hson"), "+1\n");
await writeFile(join(workspaceDir, "pragma-invalid.hson"), "// @hson-diagnostics-ignore-file\n+1\n");
await writeFile(join(workspaceDir, "static-syntax.ts"), 'import { hsonTransform } from "hson-live/transform";\nhsonTransform.fromHson("\\x2b1").toNode();\n');
await writeFile(join(workspaceDir, "schema-symbols.ts"), 'import { Hson, type HsonSchema } from "hson-live";\nexport const SymbolSchema: HsonSchema = Hson`<type "data" defs <Age <number <int true min 0>> User <content <age <ref "Age">>>> content <ref "User">>`;\nconst ordinary = "Age";\n');
await writeFile(join(workspaceDir, "schema-symbols.SymbolSchema.hson-schema.generated.ts"), "export {};\n");
await writeFile(join(workspaceDir, "schema-symbols.SymbolSchema.hson-schema.generated.json"), "{}\n");
const declarativeFixture = resolve(here, "../fixtures/declarative-schema");
const declarativeWorkspace = join(workspaceDir, "declarative-schema");
await mkdir(declarativeWorkspace);
for (const name of ["schema.ts", "schema.UserSchema.hson-schema.generated.ts", "schema.UserSchema.hson-schema.generated.json", "candidate.ts"]) {
  await writeFile(join(declarativeWorkspace, name), await readFile(join(declarativeFixture, name)));
}
await writeFile(join(declarativeWorkspace, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    baseUrl: ".",
    paths: {
      "hson-live": [resolve(here, "../../../../src/index.ts")],
      "hson-live/hson": [resolve(here, "../../../../src/hson-authoring.ts")],
    },
  },
  include: ["./*.ts"],
}));
try {
  await runTests({
    extensionDevelopmentPath: resolve(here, "../.."),
    extensionTestsPath: resolve(here, "../../.test-dist/integration.cjs"),
    ...(process.env.HSON_VSCODE_EXECUTABLE === undefined
      ? { version: "1.95.3" }
      : { vscodeExecutablePath: process.env.HSON_VSCODE_EXECUTABLE }),
    launchArgs: [
      workspaceDir,
      "--disable-workspace-trust",
      "--disable-extensions",
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
    ],
    extensionTestsEnv: { HSON_TEST_WORKSPACE: workspaceDir },
  });
  const executable = process.env.HSON_VSCODE_EXECUTABLE ?? await downloadAndUnzipVSCode("1.95.3");
  const restrictedArgs = [
    "--no-sandbox", "--disable-gpu-sandbox", "--disable-updates", "--skip-welcome", "--skip-release-notes",
    `--extensionDevelopmentPath=${resolve(here, "../..")}`,
    `--extensionTestsPath=${resolve(here, "../../.test-dist/integration.cjs")}`,
    workspaceDir, "--disable-extensions",
    `--user-data-dir=${restrictedUserDataDir}`,
    `--extensions-dir=${restrictedExtensionsDir}`,
  ];
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, restrictedArgs, { env: { ...process.env, HSON_TEST_WORKSPACE: workspaceDir, HSON_RESTRICTED_TEST: "1" } });
    child.stdout.on("data", data => process.stdout.write(data));
    child.stderr.on("data", data => process.stderr.write(data));
    child.once("error", rejectRun);
    child.once("close", code => code === 0 ? resolveRun() : rejectRun(new Error(`Restricted VS Code integration exited with ${code}.`)));
  });
} finally {
  await rm(testRoot, { recursive: true, force: true });
}
