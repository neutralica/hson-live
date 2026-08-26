import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
await build({
  absWorkingDir: extensionRoot,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  sourcesContent: true,
  legalComments: "none",
  logLevel: "info",
});
