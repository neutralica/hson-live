import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const hsonPath = resolve(here, "../../../../dist/hson.js");
const contracts = `import { hson } from ${JSON.stringify(pathToFileURL(hsonPath).href)};
export { hson };
export const UserSchema = hson.liveMap.schema.define(s => s.object({ user: s.object({ age: s.number }) }));
export const trustedSchemas = { runtimeHandle: UserSchema };
`;
await writeFile(join(workspaceDir, "contracts.mjs"), contracts);
const d3Source = 'import { HSON } from "hson-live/hson";\nimport { hsonLiveMap } from "hson-live/livemap";\nimport { UserSchema } from "./contracts.mjs";\nconst source = HSON`<user <age "37">>`;\nconst map = hsonLiveMap.fromHson(source);\nmap.schema.use(UserSchema);\n';
await writeFile(join(workspaceDir, "map-user.ts"), d3Source);
const d4Source = 'import { hsonLiveMap } from "hson-live/livemap";\nimport { UserSchema } from "./contracts.mjs";\nconst source = "<user <age \\x2237\\x22>>";\nconst map = hsonLiveMap.fromHson(source);\nmap.schema.use(UserSchema);\n';
const d4Mutated = 'import { hsonLiveMap } from "hson-live/livemap";\nimport { UserSchema } from "./contracts.mjs";\nconst source = `<user <age "37">>`;\nconst map = hsonLiveMap.fromHson(source);\nmap.set(["user", "age"], 37);\nmap.schema.use(UserSchema);\n';
await writeFile(join(workspaceDir, "static-map-user.ts"), d4Source);
await writeFile(join(workspaceDir, "static-mutated.ts"), d4Mutated);
await writeFile(join(workspaceDir, "static-syntax.ts"), 'import { hsonTransform } from "hson-live/transform";\nhsonTransform.fromHson("\\x2b1").toNode();\n');
const instrumenter = pathToFileURL(resolve(here, "../../../../dist/internal/trusted-schema-diagnostics/instrument-map-sources.js")).href;
const helper = pathToFileURL(resolve(here, "../../../../dist/internal/trusted-schema-diagnostics/source-lifecycle.js")).href;
await writeFile(join(workspaceDir, "trusted-schema.mjs"), `
export * from "./contracts.mjs";
import { instrument_trusted_schema_map_sources } from ${JSON.stringify(instrumenter)};
const contractsUrl = new URL("./contracts.mjs", import.meta.url).href;
export const trustedSchemaBindings = [{ schemaId: "runtimeHandle", binding: { moduleUrl: contractsUrl, exportName: "UserSchema" } }];
const source = ${JSON.stringify(d3Source)};
const cases = [
  [${JSON.stringify(join(workspaceDir, "map-user.ts"))}, source],
  [${JSON.stringify(join(workspaceDir, "static-map-user.ts"))}, ${JSON.stringify(d4Source)}],
  [${JSON.stringify(join(workspaceDir, "static-mutated.ts"))}, ${JSON.stringify(d4Mutated)}],
];
for (const [fileName, caseSource] of cases) {
const code = instrument_trusted_schema_map_sources(fileName, caseSource, ${JSON.stringify(helper)})
  .replaceAll('"hson-live"', ${JSON.stringify(JSON.stringify(pathToFileURL(resolve(here, "../../../../dist/index.js")).href))})
  .replaceAll('"hson-live/hson"', ${JSON.stringify(JSON.stringify(pathToFileURL(resolve(here, "../../../../dist/hson-authoring.js")).href))})
  .replaceAll('"hson-live/livemap"', ${JSON.stringify(JSON.stringify(pathToFileURL(resolve(here, "../../../../dist/api/livemap/livemap.facade.js")).href))})
  .replaceAll('"./contracts.mjs"', JSON.stringify(contractsUrl));
await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}
`);
await writeFile(join(workspaceDir, "user.ts"), 'import { HSON, hson } from "hson-live";\nimport { UserSchema } from "./trusted-schema.mjs";\nconst user = HSON`<user <age "37">>`;\nHSON.validate(UserSchema, user);\n');
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
    extensionTestsEnv: { HSON_D2_TEST_WORKSPACE: workspaceDir, HSON_D2_TEST_HSON: hsonPath },
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
    const child = spawn(executable, restrictedArgs, { env: { ...process.env, HSON_D2_TEST_WORKSPACE: workspaceDir, HSON_D4_RESTRICTED: "1" } });
    child.stdout.on("data", data => process.stdout.write(data));
    child.stderr.on("data", data => process.stderr.write(data));
    child.once("error", rejectRun);
    child.once("close", code => code === 0 ? resolveRun() : rejectRun(new Error(`Restricted VS Code integration exited with ${code}.`)));
  });
} finally {
  await rm(testRoot, { recursive: true, force: true });
}
