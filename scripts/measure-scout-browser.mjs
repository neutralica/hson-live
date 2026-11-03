import { readFileSync } from "node:fs";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { build_scout_browser } from "./scout-browser-build.mjs";

const pair = await build_scout_browser();
const sizes = {};
for (const [name, result] of Object.entries(pair)) {
  const output = result.outputFiles[0];
  const bytes = readFileSync(output.path);
  if (!bytes.equals(Buffer.from(output.contents))) throw new Error(`Stale Scout artifact: ${output.path}`);
  sizes[name] = { minified: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes).length };
}
sizes.total = Object.fromEntries(Object.keys(sizes.bootstrap).map(key => [key, sizes.bootstrap[key] + sizes.runtime[key]]));
console.log(JSON.stringify({ bytes: sizes, staticClosure: Object.keys(pair.bootstrap.metafile.inputs),
  deferredImports: Object.values(pair.bootstrap.metafile.outputs).flatMap(output => output.imports),
  runtimeInputModules: Object.keys(pair.runtime.metafile.inputs).length }, null, 2));
