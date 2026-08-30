import { rm, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
  define: { "import.meta.url": "__hson_bundle_url" },
  banner: { js: 'const __hson_bundle_url = require("node:url").pathToFileURL(__filename).href;' },
  platform: "node",
  target: "node20",
  sourcemap: true,
  sourcesContent: true,
  legalComments: "none",
  logLevel: "info",
});
await build({
  absWorkingDir: extensionRoot,
  entryPoints: ["src/tsserver-plugin.ts"],
  outfile: "typescript-plugin/dist/index.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  sourcesContent: true,
  legalComments: "none",
  logLevel: "info",
});
await copyFile(createRequire(import.meta.url).resolve("vscode-oniguruma/release/onig.wasm"), new URL("../dist/onig.wasm", import.meta.url));
