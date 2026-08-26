import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
await rm(new URL("../.test-dist", import.meta.url), { recursive: true, force: true });
await build({
  absWorkingDir: extensionRoot,
  entryPoints: {
    unit: "tests/runtime.test.ts",
    integration: "tests/integration/suite.ts",
    benchmark: "tests/benchmark.ts",
  },
  outdir: ".test-dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  legalComments: "none",
  logLevel: "warning",
});
