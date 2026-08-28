import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runTests } from "@vscode/test-electron";

const here = dirname(fileURLToPath(import.meta.url));
const testRoot = await mkdtemp(join(tmpdir(), "hson-vscode-"));
const userDataDir = join(testRoot, "user");
const extensionsDir = join(testRoot, "extensions");
const workspaceDir = join(testRoot, "workspace");
await mkdir(userDataDir);
await mkdir(extensionsDir);
await mkdir(workspaceDir);
const hsonPath = resolve(here, "../../../../dist/hson.js");
await writeFile(join(workspaceDir, "trusted-schema.mjs"), `import { hson } from ${JSON.stringify(pathToFileURL(hsonPath).href)};\nexport { hson };\nexport const UserSchema = hson.liveMap.schema.define(s => s.object({ user: s.object({ age: s.number }) }));\nexport const trustedSchemas = { runtimeHandle: UserSchema };\n`);
await writeFile(join(workspaceDir, "user.ts"), 'import { hson } from "hson-live";\nimport { UserSchema } from "./trusted-schema.mjs";\nconst user = hson`<user <age "37">>`;\nhson.liveMap.schema.validate(UserSchema, user);\n');
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
