import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runTests } from "@vscode/test-electron";

const here = dirname(fileURLToPath(import.meta.url));
const testRoot = await realpath(await mkdtemp(join(tmpdir(), "hson-vscode-")));
const userDataDir = join(testRoot, "user");
const extensionsDir = join(testRoot, "extensions");
const workspaceDir = join(testRoot, "workspace");
await mkdir(userDataDir);
await mkdir(extensionsDir);
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
const instrumenter = pathToFileURL(resolve(here, "../../../../dist/internal/trusted-schema-diagnostics/instrument-map-sources.js")).href;
const helper = pathToFileURL(resolve(here, "../../../../dist/internal/trusted-schema-diagnostics/source-lifecycle.js")).href;
await writeFile(join(workspaceDir, "trusted-schema.mjs"), `
export * from "./contracts.mjs";
import { instrument_trusted_schema_map_sources } from ${JSON.stringify(instrumenter)};
const contractsUrl = new URL("./contracts.mjs", import.meta.url).href;
export const trustedSchemaBindings = [{ schemaId: "runtimeHandle", binding: { moduleUrl: contractsUrl, exportName: "UserSchema" } }];
const source = ${JSON.stringify(d3Source)};
const code = instrument_trusted_schema_map_sources(${JSON.stringify(join(workspaceDir, "map-user.ts"))}, source, ${JSON.stringify(helper)})
  .replaceAll('"hson-live"', ${JSON.stringify(JSON.stringify(pathToFileURL(resolve(here, "../../../../dist/index.js")).href))})
  .replaceAll('"hson-live/hson"', ${JSON.stringify(JSON.stringify(pathToFileURL(resolve(here, "../../../../dist/hson-authoring.js")).href))})
  .replaceAll('"hson-live/livemap"', ${JSON.stringify(JSON.stringify(pathToFileURL(resolve(here, "../../../../dist/api/livemap/livemap.facade.js")).href))})
  .replaceAll('"./contracts.mjs"', JSON.stringify(contractsUrl));
await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
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
} finally {
  await rm(testRoot, { recursive: true, force: true });
}
