import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runTests } from "@vscode/test-electron";

const here = dirname(fileURLToPath(import.meta.url));
const testRoot = await mkdtemp(join(tmpdir(), "hson-vscode-consumer-"));
const userDataDir = join(testRoot, "user");
const extensionsDir = join(testRoot, "extensions");
const workspace = resolve(here, "../../../../../hson-demo2");
const exec = promisify(execFile);
await mkdir(userDataDir);
await mkdir(extensionsDir);
try {
  await runTests({
    extensionDevelopmentPath: resolve(here, "../.."),
    extensionTestsPath: resolve(here, "../../.test-dist/integration.cjs"),
    ...(process.env.HSON_VSCODE_EXECUTABLE === undefined
      ? { version: "1.95.3" }
      : { vscodeExecutablePath: process.env.HSON_VSCODE_EXECUTABLE }),
    launchArgs: [
      workspace,
      "--disable-workspace-trust",
      "--disable-extensions",
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
    ],
    extensionTestsEnv: { HSON_TEST_WORKSPACE: workspace, HSON_SCHEMA_CONSUMER_TEST: "1" },
  });
  if (process.platform !== "win32") {
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
    const { stdout } = await exec("ps", ["-axo", "command="]);
    const zombie = stdout.split("\n").find(line => line.includes("hson-schema.mjs watch") && line.includes(workspace));
    if (zombie !== undefined) throw new Error(`Extension disposal left a Schema watcher running: ${zombie.trim()}`);
  }
} finally {
  await rm(testRoot, { recursive: true, force: true });
}
