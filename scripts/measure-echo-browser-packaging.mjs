import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const repositoryRoot = resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../editors/vscode-hson/package.json", import.meta.url));
const { build } = require("esbuild");

const socketSource = `
  const socket = { send() {}, close() {}, onMessage() {}, onClose() {} };
`;

function outputKey(outputs, path) {
  const absolute = resolve(repositoryRoot, path);
  return Object.keys(outputs).find((candidate) => resolve(repositoryRoot, candidate) === absolute);
}

function staticClosure(outputs, start) {
  const selected = new Set();
  const visit = (path) => {
    if (selected.has(path)) return;
    selected.add(path);
    for (const imported of outputs[path]?.imports ?? []) {
      if (imported.external || imported.kind === "dynamic-import") continue;
      const target = outputKey(outputs, imported.path)
        ?? outputKey(outputs, resolve(dirname(path), imported.path));
      if (target !== undefined) visit(target);
    }
  };
  visit(start);
  return selected;
}

function metrics(result, selected) {
  const outputs = result.metafile.outputs;
  const contents = [];
  const modules = new Set();
  for (const outputPath of selected) {
    const file = result.outputFiles.find((candidate) => outputKey(outputs, candidate.path) === outputPath);
    if (file !== undefined) contents.push(file.contents);
    for (const [input, contribution] of Object.entries(outputs[outputPath]?.inputs ?? {})) {
      if (contribution.bytesInOutput > 0) modules.add(input);
    }
  }
  const bytes = Buffer.concat(contents.flatMap((content) => [content, Buffer.from("\n")]));
  return Object.freeze({
    minifiedBytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
    modules: modules.size,
    outputs: selected.size,
  });
}

async function measure(name, source) {
  const result = await build({
    absWorkingDir: repositoryRoot,
    stdin: { contents: source, resolveDir: repositoryRoot, sourcefile: `${name}.mjs` },
    bundle: true,
    splitting: true,
    write: false,
    outdir: `.echo-browser-measure/${name}`,
    entryNames: "entry",
    chunkNames: "chunk-[name]-[hash]",
    format: "esm",
    platform: "browser",
    target: "es2022",
    treeShaking: true,
    minify: true,
    legalComments: "none",
    metafile: true,
  });
  const outputs = result.metafile.outputs;
  const entry = Object.entries(outputs).find(([, output]) => output.entryPoint?.endsWith(`${name}.mjs`))?.[0];
  if (entry === undefined) throw new Error(`Could not locate ${name} entry output.`);
  const initial = staticClosure(outputs, entry);
  const deferred = new Set(Object.keys(outputs).filter((path) => !initial.has(path)));
  const aggregateRoot = Object.entries(outputs).find(([, output]) => output.entryPoint?.endsWith("/echo.multi-library.js"))?.[0];
  if (aggregateRoot === undefined) {
    throw new Error("Deferred registry replica chunk was not emitted.");
  }
  return Object.freeze({
    initial: metrics(result, initial),
    deferredTotal: metrics(result, deferred),
    aggregateDeferred: metrics(result, staticClosure(outputs, aggregateRoot)),
  });
}

const endpoint = await measure("endpoint-only-public", `
  import { create_echo } from "hson-live/echo";
  ${socketSource}
  globalThis.__echo_measure__ = create_echo({ socket });
`);
const replica = await measure("replica-bearing-public", `
  import { create_echo } from "hson-live/echo";
  ${socketSource}
  const map = globalThis.__supplied_live_map__;
  globalThis.__echo_measure__ = create_echo({ socket, map, recovery: { logicalMapId: "measure-map" } });
`);

console.log(JSON.stringify({
  methodology: Object.freeze({
    platform: "browser",
    format: "esm",
    target: "es2022",
    minified: true,
    treeShaking: true,
    gzipLevel: 9,
    brotliQuality: 11,
  }),
  endpointOnlyInitial: endpoint.initial,
  endpointDeferredReplicaTotal: endpoint.deferredTotal,
  replicaBearingPreRecoveryInitial: replica.initial,
  aggregateDeferred: replica.aggregateDeferred,
}, null, 2));
