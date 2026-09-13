import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "core.public-entrypoint-runtime",
  title: "Public entrypoint runtime boundary",
  category: "Core",
  runtime: "node",
  tags: Object.freeze(["entrypoints", "runtime", "exports", "built-package"]),
});

const testEvents = create_test_event_emitter("core.public-entrypoint-runtime");

type PackageManifest = Readonly<{
  name: string;
  exports: Readonly<Record<string, unknown>>;
}>;

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
) as PackageManifest;

function package_specifier(exportPath: string): string {
  return exportPath === "."
    ? manifest.name
    : `${manifest.name}/${exportPath.slice(2)}`;
}

function import_in_fresh_process(specifiers: readonly string[]): void {
  const caseId = `fresh import: ${specifiers.join(" -> ")}`;
  testEvents.case_begin(caseId, caseId);
  const source = specifiers
    .map((specifier) => `await import(${JSON.stringify(specifier)});`)
    .join("\n");
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  try {
    assert.equal(
      child.status,
      0,
      `fresh import failed for ${specifiers.join(" -> ")}\n${child.stderr || child.stdout}`,
    );
    testEvents.case_end(caseId, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(caseId, "assertion", message.slice(0, 1_000));
    testEvents.case_end(caseId, "fail");
    testEvents.terminal("fail");
    throw error;
  }
}

function run_in_fresh_process(caseId: string, source: string): void {
  testEvents.case_begin(caseId, caseId);
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  try {
    assert.equal(child.status, 0, `${caseId}\n${child.stderr || child.stdout}`);
    testEvents.case_end(caseId, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(caseId, "assertion", message.slice(0, 1_000));
    testEvents.case_end(caseId, "fail");
    testEvents.terminal("fail");
    throw error;
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

const publicSpecifiers = Object.keys(manifest.exports)
  .map(package_specifier)
  .sort();

for (const specifier of publicSpecifiers) {
  import_in_fresh_process([specifier]);
}

import_in_fresh_process(["hson-live/livetree", "hson-live/reflect"]);
import_in_fresh_process(["hson-live/reflect", "hson-live/livetree"]);

check("diagnostics entrypoints exist in the package and built output", () => {
  assert.notEqual(manifest.exports["./diagnostics"], undefined);
  assert.notEqual(manifest.exports["./diagnostics/universal-circuit"], undefined);
  assert.equal(existsSync(resolve(repositoryRoot, "dist", "diagnostics", "index.js")), true);
  assert.equal(existsSync(resolve(repositoryRoot, "dist", "diagnostics", "verify-universal-circuit.js")), true);
});

check("HsonData is one nominal public value across intended entrypoints", () => {
  const source = `
    import { HsonData as RootData } from "hson-live";
    import { Hson, HsonData as AuthoredData } from "hson-live/hson";
    import { HsonData as TransformData } from "hson-live/transform";
    if (RootData !== AuthoredData || RootData !== TransformData) throw new Error("HsonData identity diverged");
    const exact = AuthoredData.fromHson(Hson\`<'10' -0 '2' <__proto__ true>>\`);
    if (!Object.is(exact.entries()[0][1].scalar(), -0)) throw new Error("signed zero was lost");
    if (exact.entries().map(([name]) => name).join(",") !== "10,2") throw new Error("object order was lost");
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

check("construction facades preserve root and subpath identity and immutability", () => {
  const source = `
    import { hson, hsonLiveMap as rootMap, hsonLiveTree as rootTree } from "hson-live";
    import { hsonLiveMap as subpathMap } from "hson-live/livemap";
    import { hsonLiveTree as subpathTree } from "hson-live/livetree";
    if (hson.liveMap !== rootMap || rootMap !== subpathMap) throw new Error("LiveMap facade identity diverged");
    if (hson.liveTree !== rootTree || rootTree !== subpathTree) throw new Error("LiveTree facade identity diverged");
    if (!Object.isFrozen(rootMap) || !Object.isFrozen(hson.liveMap)) throw new Error("LiveMap facade is mutable");
    if (!Object.isFrozen(rootTree) || !Object.isFrozen(hson.liveTree)) throw new Error("LiveTree facade is mutable");
    if ("fromTrustedHtml" in hson.liveMap || "fromUntrustedHtml" in hson.liveMap) throw new Error("browser compatibility shape remains");
    if (Reflect.set(rootMap, "replacement", null)) throw new Error("LiveMap facade accepted an addition");
    if (Reflect.deleteProperty(rootTree, "fromJson")) throw new Error("LiveTree facade accepted a deletion");
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

check("SSR root and subpath exports share runtime identity", () => {
  const source = `
    import {
      DocumentSsrError as RootError,
      SsrBootstrapEncodingError as RootBootstrapError,
      encode_ssr_bootstrap as rootEncode,
      decode_ssr_bootstrap as rootDecode,
      install_libraries_snapshot as rootLibrariesInstall,
      install_locus_libraries_snapshot as rootHostedLibrariesInstall,
            render_document as rootRender,
            render_hosted_document as rootHostedRender,
    } from "hson-live";
    import { install_libraries_snapshot as livemapLibrariesInstall } from "hson-live/livemap";
    import { install_locus_libraries_snapshot as locusLibrariesInstall } from "hson-live/locus";
    import {
      DocumentSsrError as SsrError,
      SsrBootstrapEncodingError as SsrBootstrapError,
      encode_ssr_bootstrap as ssrEncode,
      decode_ssr_bootstrap as ssrDecode,
      render_document as ssrRender,
      render_hosted_document as ssrHostedRender,
    } from "hson-live/ssr";
    if (RootError !== SsrError || RootBootstrapError !== SsrBootstrapError
      || rootEncode !== ssrEncode || rootDecode !== ssrDecode
      || rootRender !== ssrRender || rootHostedRender !== ssrHostedRender
      || rootLibrariesInstall !== livemapLibrariesInstall
      || rootHostedLibrariesInstall !== locusLibrariesInstall) {
      throw new Error("SSR entrypoint identity diverged");
    }
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

check("SSR declarations expose only the approved semantic surface", () => {
  const declaration = readFileSync(resolve(repositoryRoot, "dist", "api", "ssr", "index.d.ts"), "utf8");
  for (const approved of [
    "render_document",
    "render_hosted_document",
    "BrowserRealizationHtml",
    "DocumentSsr",
    "HostedDocumentSsr",
    "LibrariesDocumentSsr",
    "HostedLibrariesDocumentSsr",
    "DocumentSsrError",
    "SsrBootstrapKind",
    "EncodedSsrBootstrap",
    "DecodedSsrBootstrap",
    "SsrBootstrapCodecOptions",
    "SsrBootstrapEncodingError",
    "encode_ssr_bootstrap",
    "decode_ssr_bootstrap",
  ]) assert.equal(declaration.includes(approved), true, `${approved} must be exported`);
  for (const privateName of [
    "BrowserRealizationPlan",
    "BrowserRealizationIncompatibilityError",
    "plan_browser_realization",
    "serialize_browser_realization",
    "set_document_ssr_hook_for_tests",
  ]) assert.equal(declaration.includes(privateName), false, `${privateName} must remain private`);
});

const directHsonDataSources = new Map<string, string>([
  ["root", `
    import { Hson, HsonData } from "hson-live";
    const value = HsonData.fromHson(Hson\`<'10' -0 '2' <__proto__ true>>\`);
    if (!HsonData.fromHson(value.toHson()).equals(value)) throw new Error("root round trip failed");
  `],
  ["hson", `
    import { Hson, HsonData } from "hson-live/hson";
    const value = HsonData.fromHson(Hson\`<'10' -0 '2' <__proto__ true>>\`);
    if (!HsonData.fromHson(value.toHson()).equals(value)) throw new Error("Hson round trip failed");
  `],
  ["transform", `
    import { HsonData } from "hson-live/transform";
    const value = HsonData.from({ value: -0, __proto__: null });
    if (!HsonData.fromHson(value.toHson()).equals(value)) throw new Error("Transform round trip failed");
  `],
  ["livemap", `
    import { hsonLiveMap } from "hson-live/livemap";
    const value = hsonLiveMap.fromJson({ value: -0, nested: { constructor: true } }).data();
    if (value === undefined) throw new Error("LiveMap exact data unavailable");
    const roundTrip = hsonLiveMap.fromHson(value.toHson()).data();
    if (roundTrip === undefined || !roundTrip.equals(value)) throw new Error("LiveMap round trip failed");
  `],
  ["echo", `
    import { create_echo } from "hson-live/echo";
    const socket = { send() {}, close() {}, onMessage() { return () => {}; }, onClose() { return () => {}; } };
    const echo = create_echo({ socket });
    echo.connect();
    const call = echo.action("probe", { value: -0, nested: { constructor: true } });
    void call.catch(() => {});
    const value = call.request.payload;
    if (value === undefined || typeof value.toHson() !== "string") throw new Error("Echo HsonData conversion unavailable");
    echo.dispose();
  `],
  ["locus", `
    import { decode_locus_message } from "hson-live/locus";
    const wire = JSON.stringify({ type: "action", id: "a", name: "probe", payloadData: "{\\n  \\\"value\\\": -0,\\n  \\\"__proto__\\\": true\\n}" });
    const decoded = decode_locus_message(wire);
    if (!decoded.ok || decoded.value.type !== "action" || decoded.value.payload === undefined) throw new Error("Locus exact data unavailable");
    const value = decoded.value.payload;
    if (typeof value.toHson() !== "string") throw new Error("Locus HsonData conversion unavailable");
  `],
]);

for (const [entrypoint, source] of directHsonDataSources) {
  run_in_fresh_process(`HsonData conversion works from fresh ${entrypoint} entrypoint`, source);
}

for (const order of [
  ["hson-live/livemap", "hson-live"],
  ["hson-live", "hson-live/livemap"],
  ["hson-live/transform", "hson-live/hson", "hson-live"],
  ["hson-live/hson", "hson-live", "hson-live/transform"],
] as const) {
  run_in_fresh_process(`HsonData conversion is stable for ${order.join(" -> ")}`, `
    const modules = [];
    ${order.map((specifier) => `modules.push(await import(${JSON.stringify(specifier)}));`).join("\n")}
    const constructors = modules.map((module) => module.HsonData).filter(Boolean);
    if (constructors.some((candidate) => candidate !== constructors[0])) throw new Error("constructor identity changed");
    const { hsonLiveMap } = await import("hson-live/livemap");
    const value = hsonLiveMap.fromJson({ value: -0 }).data();
    if (value === undefined || typeof value.toHson() !== "string") throw new Error("conversion changed by import order");
  `);
}

check("private ordered projected carriers stay out of root declarations", () => {
  const rootDeclaration = readFileSync(resolve(repositoryRoot, "dist", "index.d.ts"), "utf8");
  for (const privateName of ["OrderedProjectedValue", "OrderedProjectedObject"]) {
    assert.equal(rootDeclaration.includes(privateName), false, `${privateName} must remain private`);
  }
});

check("removed LiveMap pseudo-QUID declarations and runtime modules stay absent", () => {
  const removedSymbols = [
    "LiveMapQuid",
    "LiveMapQuidOwner",
    "LiveMapQuidRef",
    "debug_livemap_quids",
    "drop_livemap_quid",
    "ensure_livemap_quid",
    "get_livemap_owner",
    "get_livemap_quid",
    "reindex_livemap_quid",
    "remint_livemap_quid",
  ];
  const declarationText = [
    resolve(repositoryRoot, "dist", "index.d.ts"),
    resolve(repositoryRoot, "dist", "api", "livemap", "index.d.ts"),
    resolve(repositoryRoot, "dist", "types", "livemap.types.d.ts"),
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  for (const symbol of removedSymbols) {
    assert.equal(
      declarationText.includes(symbol),
      false,
      `built declarations must not expose removed LiveMap pseudo-QUID symbol ${symbol}`,
    );
  }
  assert.equal(existsSync(resolve(repositoryRoot, "dist", "api", "livemap", "livemap.quid.js")), false);
  assert.equal(existsSync(resolve(repositoryRoot, "dist", "api", "livemap", "livemap.quid.d.ts")), false);
});

console.log(JSON.stringify({
  publicEntrypointRuntime: "ok",
  freshProcesses: publicSpecifiers.length + 2,
  entrypoints: publicSpecifiers,
  importOrders: [
    ["hson-live/livetree", "hson-live/reflect"],
    ["hson-live/reflect", "hson-live/livetree"],
  ],
}));
testEvents.terminal("pass");
