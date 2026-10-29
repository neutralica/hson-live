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
const { build } = await import("esbuild");
const browser = await build({ entryPoints: ["dist/api/scout/auto.js"], bundle: true,
  format: "esm", platform: "browser", target: "es2022", minify: true,
  write: false, metafile: true, legalComments: "none" });
if (browser.outputFiles.length !== 1 || Object.values(browser.metafile.outputs).some(output => output.imports.length)) {
  throw new Error("Scout must publish one self-contained browser module.");
}
if (Object.keys(browser.metafile.inputs).some(path => /(?:node:|api\/livehost\/node|node_modules\/ws\/)/.test(path))) {
  throw new Error("Server dependencies entered the Scout browser asset.");
}
writeFileSync(resolve("dist/scout-auto.js"), browser.outputFiles[0].text);
