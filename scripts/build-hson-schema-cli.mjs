import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const sourcePath = resolve("scripts/hson-schema.mts");
const outputPath = resolve("dist/hson-schema.mjs");
const result = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    sourceMap: false,
  },
  fileName: sourcePath,
});

writeFileSync(outputPath, result.outputText);
chmodSync(outputPath, 0o755);

// Publish the standard browser entry through the existing distribution writer.
const { build_scout_browser } = await import("./scout-browser-build.mjs");
const { bootstrap, runtime } = await build_scout_browser();
for (const output of [...bootstrap.outputFiles, ...runtime.outputFiles]) {
  writeFileSync(output.path, output.text);
}
