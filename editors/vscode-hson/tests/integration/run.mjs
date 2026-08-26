import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runTests } from "@vscode/test-electron";

const here = dirname(fileURLToPath(import.meta.url));
const testRoot = await mkdtemp(join(tmpdir(), "hson-vscode-"));
const userDataDir = join(testRoot, "user");
const extensionsDir = join(testRoot, "extensions");
await mkdir(userDataDir);
await mkdir(extensionsDir);
try {
  await runTests({
    extensionDevelopmentPath: resolve(here, "../.."),
    extensionTestsPath: resolve(here, "../../.test-dist/integration.cjs"),
    version: "1.95.3",
    launchArgs: [
      "--disable-extensions",
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
    ],
  });
} finally {
  await rm(testRoot, { recursive: true, force: true });
}
