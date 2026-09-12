import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "core.production-dependency-boundary",
  title: "Production dependency boundary",
  category: "Core",
  runtime: "node",
  tags: Object.freeze(["dependencies", "production", "removals", "public-api"]),
});

const testEvents = create_test_event_emitter("core.production-dependency-boundary");

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(repositoryRoot, "src");
const excludedSourceDirectories = new Set(["_refactor", "_tests", "diagnostics"]);
const sourceExtensions = new Set([".ts", ".mts", ".js", ".mjs"]);
const importSpecifierPattern = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
const testOnlySpecifierPattern = /(?:^|\/)(?:_tests|tests?|fixtures?)(?:\/|$)|(?:^|\/)(?:test-exports|transform-test-oracle|test-circuit)(?:\.[cm]?[jt]s)?$/;

function extension(path: string): string {
  const match = /\.[^.\/]+$/.exec(path);
  return match?.[0] ?? "";
}

function production_source_files(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedSourceDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...production_source_files(path));
    else if (entry.isFile() && sourceExtensions.has(extension(entry.name))) files.push(path);
  }
  return files;
}

const violations: string[] = [];
const files = production_source_files(sourceRoot);
const require = createRequire(new URL("../editors/vscode-hson/package.json", import.meta.url));
type BundleOutput = Readonly<{
  entryPoint?: string;
  imports: readonly Readonly<{ path: string; kind: string; external?: boolean }>[];
  inputs: Readonly<Record<string, Readonly<{ bytesInOutput: number }>>>;
}>;
type BundleResult = Readonly<{
  metafile?: Readonly<{ outputs: Readonly<Record<string, BundleOutput>> }>;
  outputFiles?: readonly Readonly<{ path: string; contents: Uint8Array }>[];
}>;
const esbuild: Readonly<{ buildSync: (options: object) => BundleResult }> = require("esbuild");
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(importSpecifierPattern)) {
    const specifier = match[1];
    if (specifier !== undefined && testOnlySpecifierPattern.test(specifier)) {
      violations.push(`${relative(repositoryRoot, file)} -> ${specifier}`);
    }
  }
}

function check(name: string, run: () => void): void {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
}

check("production runtime modules do not import test-only modules", () => {
  assert.deepEqual(
    violations,
    [],
    `production runtime modules must not import test-only modules:\n${violations.join("\n")}`,
  );
});

check("endpoint-only Echo has no replica, LiveMap, Reflect, or LiveTree runtime dependency", () => {
  const endpointClient = readFileSync(resolve(sourceRoot, "api", "echo", "echo.client.ts"), "utf8");
  const specifiers = [...endpointClient.matchAll(importSpecifierPattern)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined);
  for (const forbidden of ["livemap", "locus.protocol", "recovery", "aggregate", "echo.solo", "reflect", "livetree"]) {
    assert.equal(
      specifiers.some((specifier) => specifier.toLowerCase().includes(forbidden)),
      false,
      `endpoint-only Echo must not import ${forbidden} runtime machinery`,
    );
  }
});

check("public endpoint-only Echo initial browser graph excludes deferred replica families", () => {
  const build = esbuild.buildSync({
    absWorkingDir: repositoryRoot,
    stdin: {
      contents: `
        import { create_echo } from "hson-live/echo";
        const socket = {
          send() {}, close() {}, onMessage() {}, onClose() {},
        };
        globalThis.__endpoint_echo_boundary__ = create_echo({ socket });
      `,
      resolveDir: repositoryRoot,
      sourcefile: "endpoint-only-public.mjs",
    },
    bundle: true,
    splitting: true,
    write: false,
    outdir: "dependency-boundary-out",
    format: "esm",
    platform: "browser",
    target: "es2022",
    treeShaking: true,
    minify: true,
    legalComments: "none",
    metafile: true,
  });
  const outputs = build.metafile?.outputs;
  assert.ok(outputs !== undefined, "endpoint-only browser proof requires an esbuild metafile");
  const entry = Object.entries(outputs).find(([, output]) => output.entryPoint?.endsWith("endpoint-only-public.mjs"));
  assert.ok(entry !== undefined, "endpoint-only browser proof could not locate its entry output");
  const byAbsolutePath = new Map(Object.keys(outputs).map((path) => [resolve(repositoryRoot, path), path]));
  const initialOutputs = new Set<string>();
  const visit = (path: string): void => {
    if (initialOutputs.has(path)) return;
    initialOutputs.add(path);
    const output = outputs[path];
    if (output === undefined) return;
    for (const imported of output.imports) {
      if (imported.kind === "dynamic-import" || imported.external) continue;
      const target = byAbsolutePath.get(resolve(repositoryRoot, imported.path))
        ?? byAbsolutePath.get(resolve(repositoryRoot, dirname(path), imported.path));
      if (target !== undefined) visit(target);
    }
  };
  visit(entry[0]);
  const initialInputs = new Set<string>();
  for (const outputPath of initialOutputs) {
    const output = outputs[outputPath];
    if (output === undefined) continue;
    for (const [input, contribution] of Object.entries(output.inputs)) {
      if (contribution.bytesInOutput > 0) initialInputs.add(input);
    }
  }
  const prohibited = [
    /echo\.solo/i,
    /echo\.aggregate-replica/i,
    /echo\.multi-library/i,
    /api\/livemap\//i,
    /api\/reflect\//i,
    /api\/livetree\//i,
    /api\/transform\//i,
    /schema-hson-validation/i,
    /htmlparser2/i,
    /node_modules\/entities\//i,
    /dompurify/i,
  ];
  const retainedProhibited = [...initialInputs].filter((input) => prohibited.some((pattern) => pattern.test(input)));
  assert.deepEqual(
    retainedProhibited,
    [],
    `endpoint-only static browser graph retained deferred implementation modules:\n${retainedProhibited.join("\n")}`,
  );
  const initialBytes = Buffer.concat([...initialOutputs].flatMap((outputPath) => {
    const absolute = resolve(repositoryRoot, outputPath);
    const file = build.outputFiles?.find((candidate) => resolve(candidate.path) === absolute);
    return file === undefined ? [] : [file.contents, Buffer.from("\n")];
  }));
  const initialGzipBytes = gzipSync(initialBytes, { level: 9 }).length;
  assert.ok(
    initialGzipBytes <= 20_000,
    `endpoint-only public initial browser graph exceeds the 20 KiB gzip guard: ${initialGzipBytes} bytes`,
  );
  const dynamicImports = Object.values(outputs).flatMap((output) => output.imports.filter((item) => item.kind === "dynamic-import"));
  assert.ok(dynamicImports.length >= 2, "browser proof should retain deferred solo and aggregate chunks");
});

check("local document continuation tree-shakes hosted Echo and Locus machinery", () => {
  const build = esbuild.buildSync({
    absWorkingDir: repositoryRoot,
    stdin: {
      contents: `
        import { continue_document } from "./dist/api/continuation/continue-document.js";
        globalThis.__continue_document__ = continue_document;
      `,
      resolveDir: repositoryRoot,
      sourcefile: "local-document-continuation-public.mjs",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    treeShaking: true,
    minify: true,
    legalComments: "none",
    metafile: true,
  });
  const outputs = build.metafile?.outputs;
  assert.ok(outputs !== undefined, "local continuation proof requires an esbuild metafile");
  const retainedInputs = Object.values(outputs).flatMap((output) => Object.entries(output.inputs))
    .filter(([, contribution]) => contribution.bytesInOutput > 0)
    .map(([input]) => input);
  const prohibited = retainedInputs.filter((input) => /\/api\/(?:locus|livehost)\//.test(input)
    || /\/api\/echo\/(?!echo\.document-authority-registry\.js$)/.test(input));
  assert.deepEqual(
    prohibited,
    [],
    `local continuation retained hosted authority modules:\n${prohibited.join("\n")}`,
  );
  const outputText = build.outputFiles?.map((file) => Buffer.from(file.contents).toString("utf8")).join("\n") ?? "";
  assert.equal(outputText.includes("continue_hosted_document"), false);

  const rootBuild = esbuild.buildSync({
    absWorkingDir: repositoryRoot,
    stdin: {
      contents: `
        import { continue_document } from "hson-live";
        globalThis.__continue_document__ = continue_document;
      `,
      resolveDir: repositoryRoot,
      sourcefile: "local-document-continuation-root-public.mjs",
    },
    bundle: true,
    splitting: true,
    write: false,
    outdir: "dependency-boundary-continuation-out",
    format: "esm",
    platform: "browser",
    target: "es2022",
    treeShaking: true,
    minify: true,
    legalComments: "none",
    metafile: true,
  });
  const rootOutputs = rootBuild.metafile?.outputs ?? {};
  const rootEntry = Object.entries(rootOutputs).find(([, output]) => output.entryPoint?.endsWith("local-document-continuation-root-public.mjs"));
  assert.ok(rootEntry !== undefined, "root continuation proof could not locate its entry output");
  const rootInputs = Object.entries(rootEntry[1].inputs)
    .filter(([, contribution]) => contribution.bytesInOutput > 0)
    .map(([input]) => input);
  assert.equal(
    rootInputs.some((input) => input.includes("/api/continuation/continue-hosted-document")),
    false,
    "the root umbrella must tree-shake the unused hosted continuation implementation",
  );
});

check("removed LiveTree construction engine and graft_body stay absent", () => {
  const productionSource = files.map((path) => readFileSync(path, "utf8")).join("\n");
  assert.equal(
    productionSource.includes("construct_tree") || productionSource.includes("construct-tree"),
    false,
    "the obsolete LiveTree construction engine must not remain reachable in source",
  );
  assert.equal(
    productionSource.includes("graft_body"),
    false,
    "the obsolete graft_body compatibility alias must not remain reachable",
  );
  assert.equal(existsSync(resolve(repositoryRoot, "dist", "api", "livetree", "creation", "construct-tree.js")), false);
  assert.equal(existsSync(resolve(repositoryRoot, "dist", "api", "livetree", "creation", "construct-tree.d.ts")), false);
});

check("removed constructor declarations stay absent", () => {
  const declarations = readFileSync(
    resolve(repositoryRoot, "dist", "types", "constructor.types.d.ts"),
    "utf8",
  );
  for (const symbol of [
    "TreeConstructor_Source",
    "DomQuerySourceConstructor",
    "DomQueryLiveTreeConstructor",
    "LiveTreeConstructor_3",
  ]) {
    assert.equal(
      declarations.includes(symbol),
      false,
      `built declarations must not retain obsolete constructor symbol ${symbol}`,
    );
  }
});

console.log(JSON.stringify({
  productionDependencyBoundary: "ok",
  filesScanned: files.length,
  excludedDiagnosticAndTestRoots: [...excludedSourceDirectories].sort(),
}));
testEvents.terminal("pass");
