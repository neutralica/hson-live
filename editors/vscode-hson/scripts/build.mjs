import { rm, copyFile, mkdir, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { generateThemes } from "./generate-themes.mjs";

await generateThemes({ check: true });

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
  entryPoints: ["src/local-host-runner.ts"],
  outfile: "dist/local-host-runner.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  sourcemap: true,
  sourcesContent: true,
  legalComments: "none",
  logLevel: "info",
});
await build({
  absWorkingDir: extensionRoot,
  entryPoints: ["src/tsserver-plugin/tsserver-plugin.ts"],
  outfile: "node_modules/hson-schema-typescript-plugin/dist/index.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  sourcesContent: true,
  legalComments: "none",
  logLevel: "info",
});
await mkdir(new URL("../node_modules/hson-schema-typescript-plugin", import.meta.url), { recursive: true });
if (await realpath(new URL("../typescript-plugin", import.meta.url)) !== await realpath(new URL("../node_modules/hson-schema-typescript-plugin", import.meta.url))) {
  await copyFile(new URL("../typescript-plugin/package.json", import.meta.url), new URL("../node_modules/hson-schema-typescript-plugin/package.json", import.meta.url));
}
await copyFile(createRequire(import.meta.url).resolve("vscode-oniguruma/release/onig.wasm"), new URL("../dist/onig.wasm", import.meta.url));
// TypeScript looks for its standard declarations beside the compiler bundle.
const lib = new URL(".", pathToFileURL(createRequire(import.meta.url).resolve("typescript")));
for (const name of await readdir(lib)) {
  if (/^lib(?:\..+)?\.d\.ts$/.test(name)) await copyFile(new URL(name, lib), new URL("../dist/" + name, import.meta.url));
}
