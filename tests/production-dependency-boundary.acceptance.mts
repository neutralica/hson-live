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

check("side-effect metadata retains Scout registration and Schema tooling startup", () => {
  const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as { sideEffects?: unknown };
  assert.deepEqual(manifest.sideEffects, [
    "./dist/api/scout/index.js",
    "./dist/internal/hson-schema/compiler-project-watch.js",
    "./dist/hson-schema.mjs",
  ]);
  for (const path of manifest.sideEffects as string[]) {
    assert.ok(existsSync(resolve(repositoryRoot, path)), `${path} is not an emitted package path`);
  }
  const scout = browser_graph("scout-import-for-effect.mjs", 'import "hson-live/scout";');
  assert.ok(scout.inputs.some((input) => /api\/scout\/index\.js$/.test(input)), "Scout registration was discarded");
});

check("endpoint-only Echo has no replica, LiveMap, Mirror, or LiveTree runtime dependency", () => {
  const endpointClient = readFileSync(resolve(sourceRoot, "api", "echo", "echo.client.ts"), "utf8");
  const specifiers = [...endpointClient.matchAll(importSpecifierPattern)]
    .map((match) => match[1])
    // The shared socket discriminator is a constant-only module, not replica machinery.
    .filter((specifier): specifier is string => specifier !== undefined
      && specifier !== "../locus/locus.aggregate.protocol.js");
  for (const forbidden of ["livemap", "locus.protocol", "recovery", "aggregate", "echo.solo", "reflect", "livetree"]) {
    assert.equal(
      specifiers.some((specifier) => specifier.toLowerCase().includes(forbidden)),
      false,
      `endpoint-only Echo must not import ${forbidden} runtime machinery`,
    );
  }
});

function browser_graph(sourcefile: string, contents: string): Readonly<{ inputs: readonly string[]; raw: number; gzip: number }> {
  const build = esbuild.buildSync({
    absWorkingDir: repositoryRoot,
    stdin: {
      contents,
      resolveDir: repositoryRoot,
      sourcefile,
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
  assert.ok(outputs !== undefined, `${sourcefile} requires an esbuild metafile`);
  const entry = Object.entries(outputs).find(([, output]) => output.entryPoint?.endsWith(sourcefile));
  assert.ok(entry !== undefined, `${sourcefile} could not locate its entry output`);
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
  const allInputs = Object.values(outputs).flatMap((output) => Object.keys(output.inputs));
  assert.deepEqual(allInputs.filter((input) => /api\/(?:locus|livehost)\/node\//i.test(input)), [],
    `${sourcefile} retained Node adapters in an initial or lazy chunk`);
  const initialBytes = Buffer.concat([...initialOutputs].flatMap((outputPath) => {
    const absolute = resolve(repositoryRoot, outputPath);
    const file = build.outputFiles?.find((candidate) => resolve(candidate.path) === absolute);
    return file === undefined ? [] : [file.contents, Buffer.from("\n")];
  }));
  assert.ok(initialBytes.length > 0, `${sourcefile} browser bundle is empty`);
  return { inputs: [...initialInputs], raw: initialBytes.length, gzip: gzipSync(initialBytes).length };
}

check("native /livemap namespace keeps LiveMap, Echo, and Locus browser graphs separate", () => {
  const prefix = 'import * as hsonLiveMap from "hson-live/livemap";';
  const plain = browser_graph("livemap-create-public.mjs", `${prefix} globalThis.map = hsonLiveMap.create();`);
  const libraries = browser_graph("livemap-libraries-public.mjs", `${prefix}
    globalThis.map = hsonLiveMap.fromLibraries({ state: { data: { value: 1 } } });`);
  const echo = browser_graph("livemap-echo-public.mjs", `${prefix}
    const transport = { operations: { async submit() { return { kind: "not-submitted" }; } },
      attachment: { observe() { return () => {}; } } };
    globalThis.echo = hsonLiveMap.echo.create({ transport });`);
  const locus = browser_graph("livemap-locus-public.mjs", `${prefix}
    globalThis.locus = hsonLiveMap.locus.create({ shared: [{ name: "state", definition: { data: { value: 1 } } }] });`);
  const subsystem = (graph: typeof plain, name: "livemap" | "echo" | "locus"): string[] =>
    graph.inputs.filter((input) => input.includes(`/api/${name}/`));
  const noSibling = (graph: typeof plain, name: "livemap" | "echo" | "locus", label: string): void => {
    assert.deepEqual(subsystem(graph, name), [], `${label} retained ${name} implementation`);
  };
  for (const [graph, label] of [[plain, "LiveMap create"], [libraries, "LiveMap fromLibraries"]] as const) {
    assert.ok(subsystem(graph, "livemap").length > 8, `${label} construction implementation is missing`);
    noSibling(graph, "echo", label);
    noSibling(graph, "locus", label);
  }
  assert.ok(subsystem(echo, "echo").length > 0, "Echo endpoint implementation is missing");
  assert.ok(subsystem(echo, "livemap").length <= 8, "endpoint Echo retained full LiveMap construction");
  assert.ok(subsystem(echo, "locus").length <= 4, "endpoint Echo retained Locus authority/session/persistence");
  assert.deepEqual(subsystem(echo, "locus").filter((input) =>
    /(?:authority|session|persist|registry|projection|stage|action|activity)/i.test(input)), [],
    "endpoint Echo retained a Locus authority/session/persistence family");
  assert.ok(subsystem(locus, "locus").length > 8, "Locus authority implementation is missing");
  noSibling(locus, "echo", "Locus create");
  assert.ok(plain.gzip < 320 * 1024, `plain LiveMap drifted to ${plain.gzip} gzip bytes`);
  assert.ok(libraries.gzip < 320 * 1024, `LiveMap fromLibraries drifted to ${libraries.gzip} gzip bytes`);
  assert.ok(echo.gzip < 32 * 1024, `endpoint Echo drifted to ${echo.gzip} gzip bytes`);
  assert.ok(locus.gzip < 360 * 1024, `Locus drifted to ${locus.gzip} gzip bytes`);
  console.log(JSON.stringify({ livemapNamespaceBundles: {
    create: { raw: plain.raw, gzip: plain.gzip },
    fromLibraries: { raw: libraries.raw, gzip: libraries.gzip },
    echo: { raw: echo.raw, gzip: echo.gzip },
    locus: { raw: locus.raw, gzip: locus.gzip },
  } }));
});

check("specialist /echo and /locus resolve in browser bundles without Node adapters", () => {
  browser_graph("echo-contract-public.mjs", 'import { EchoSessionError } from "hson-live/echo"; globalThis.error = EchoSessionError;');
  browser_graph("locus-contract-public.mjs", 'import { LocusAuthorityError } from "hson-live/locus"; globalThis.error = LocusAuthorityError;');
  browser_graph("root-livemap-public.mjs", 'import { hsonLiveMap } from "hson-live"; globalThis.map = hsonLiveMap.create();');
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

check("SSR subpath excludes DOM realization, LiveHost, Echo, and Node adapters", () => {
  const build = esbuild.buildSync({
    absWorkingDir: repositoryRoot,
    stdin: {
      contents: `
        import { encode_ssr_bootstrap } from "hson-live/ssr";
        globalThis.__document_ssr__ = { encode_ssr_bootstrap };
      `,
      resolveDir: repositoryRoot,
      sourcefile: "document-ssr-public.mjs",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    treeShaking: true,
    minify: true,
    legalComments: "none",
    metafile: true,
  });
  const outputs = build.metafile?.outputs;
  assert.ok(outputs !== undefined, "SSR dependency proof requires an esbuild metafile");
  const retainedInputs = Object.values(outputs).flatMap((output) => Object.entries(output.inputs))
    .filter(([, contribution]) => contribution.bytesInOutput > 0)
    .map(([input]) => input);
  const prohibited = retainedInputs.filter((input) =>
    /browser-realization-dom|\/api\/(?:livehost|echo|livetree|reflect)\//i.test(input)
    || /locus\.node|node:http|node:https|node:fs|node:crypto/i.test(input)
  );
  assert.deepEqual(
    prohibited,
    [],
    `SSR public graph retained forbidden implementation modules:\n${prohibited.join("\n")}`,
  );
});

check("Transform subpath excludes browser sanitation and adjacent runtime families", () => {
  const build = esbuild.buildSync({
    absWorkingDir: repositoryRoot,
    stdin: {
      contents: `
        import { hsonTransform } from "hson-live/transform";
        globalThis.__transform_boundary__ = hsonTransform.fromJson({ ready: true }).toHson().serialize();
      `,
      resolveDir: repositoryRoot,
      sourcefile: "transform-worker-public.mjs",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    treeShaking: true,
    minify: true,
    legalComments: "none",
    metafile: true,
  });
  const outputs = build.metafile?.outputs;
  assert.ok(outputs !== undefined, "Transform dependency proof requires an esbuild metafile");
  const retainedInputs = Object.values(outputs).flatMap((output) => Object.entries(output.inputs))
    .filter(([, contribution]) => contribution.bytesInOutput > 0)
    .map(([input]) => input);
  const prohibited = retainedInputs.filter((input) =>
    /dompurify|parse-external-html|transform\.browser|browser-realization/i.test(input)
    || /\/api\/(?:livetree|reflect|livehost|echo)\//i.test(input)
    || /node:http|node:https|node:fs/i.test(input)
  );
  assert.deepEqual(
    prohibited,
    [],
    `Transform public graph retained forbidden environment modules:\n${prohibited.join("\n")}`,
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
