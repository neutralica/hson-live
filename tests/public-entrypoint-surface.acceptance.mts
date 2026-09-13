import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "core.public-entrypoint-surface",
  title: "Curated public entrypoint surface",
  category: "Core",
  runtime: "node",
  tags: Object.freeze(["entrypoints", "exports", "ownership", "public-api"]),
});

const testEvents = create_test_event_emitter("core.public-entrypoint-surface");
const repositoryRoot = resolve(import.meta.dirname, "..");

const ROOT_EXPORTS = `
activate_interactions add_interaction AsyncLiveTree AsyncLiveTreeAttrs AsyncLiveTreeClasslist
AsyncLiveTreeFlags AsyncLiveTreeForm AsyncLiveTreeId AsyncLiveTreeText
AuthoritativeInteractionDescriptor BinaryDecodeOptions BrowserRealizationHtml ClassifiedLiveMap
continue_document continue_hosted_document create_echo create_livehost_locus_registry create_locus
create_locus_bootstrap_echo DataLiveMapMode DataLocusOptions decode_ssr_bootstrap DecodedSsrBootstrap
DetachedLiveContent DocumentContinuation DocumentContinuationError DocumentLiveMap DocumentLiveMapMode
DocumentReflect DocumentReflectError DocumentReflectStatus DocumentSsr DocumentSsrError Echo EchoActionFn
EchoActionPromise EchoActionRequest EchoActionStatusResult EchoOptions EchoRecoveryError EchoRetryActionFn
EchoSession EchoSessionError EchoSessionFailure EchoSessionOptions EchoSessionResult EchoSessionStatus
enable_interactions encode_ssr_bootstrap EncodedSsrBootstrap HostedDocumentContinuation HostedDocumentSsr
HostedLibrariesDocumentSsr hson Hson hsonCalc HsonData hsonEcho HsonFacade hsonLiveMap hsonLiveTree
hsonLocus HsonNumber hsonReflect HsonSchema HsonSchemaMutationCandidate HsonSchemaValue hsonTransform
InteractionActionDispatcher InteractionActivationOptions InteractionDescriptor InteractionFailure
InteractionListener InteractionLocalBehavior InteractionLocalBehaviors is_transform_error LibrariesDocumentSsr
link_livemap LiveHost LiveHostApplication LiveHostApplicationContext LiveHostConnection
LiveHostConnectionRoute LiveHostLocusAcquisition LiveHostLocusEvictionResult LiveHostLocusRegistry
LiveHostLocusRegistryOptions LiveHostLocusRegistryResult LiveHostPrincipal LiveHostRequestRoute LiveMap
LiveMapDataLibrary LiveMapDataLibraryInput LiveMapDocumentAttributeNotFoundError
LiveMapDocumentIdentityProvenanceError LiveMapDocumentIdentityRegistrationError LiveMapDocumentInstallError
LiveMapDocumentLibrary LiveMapDocumentLibraryInput LiveMapDocumentMutationError LiveMapDocumentStagingError
LiveMapLibraries LiveMapLibrariesInput LiveMapLibraryInput LiveTree LiveTreeAlreadyAttachedError
LiveTreeAttributeError LiveTreeBatchError LiveTreeDisposedError LiveTreeLifecycleResult
LiveTreeLinkedIdentityRequiredError LiveTreeProtectedRootError LiveTreeQuidReuseError
LocalInteractionDescriptor Locus LocusActionContext LocusActionHandler LocusActionName LocusActionPayloads
LocusActions LocusActivity LocusActivityKind LocusActivitySnapshot LocusActivityState LocusAuthorityError
LocusBootstrapEcho LocusConnection LocusDisconnectedError LocusDuplicateActionIdError LocusEventListener
LocusMultiLibrary LocusMultiLibraryActionContext LocusMultiLibraryActionHandler LocusMultiLibraryActions
LocusMultiLibraryOptions LocusOptions LocusRecoveryError LocusResult LocusSocketLike
read_transform_error_details Reflect reflect_document remove_interaction render_document
render_hosted_document replace_interaction SsrBootstrapCodecError SsrBootstrapCodecOptions SsrBootstrapKind
TransformBinarySerialize TransformError TransformErrorDetails TransformErrorRelated TransformErrorSource
TreeSelector
`.trim().split(/\s+/).sort();

const DIAGNOSTICS_EXPORTS = `
begin_livetree_materialization_profile create_live_inspector create_live_trace_collector
create_live_trace_console_sink hsonInspect LIVE_INSPECTOR_DISPOSED_ERROR_CODE
LIVE_INSPECTOR_DUPLICATE_ARRAY_KEY_ERROR_CODE LIVE_INSPECTOR_EXPAND_LIMIT_ERROR_CODE
LIVE_INSPECTOR_INVALID_PATH_ERROR_CODE LIVE_INSPECTOR_INVALID_ROOT_ERROR_CODE
LIVE_INSPECTOR_MISSING_ARRAY_KEY_ERROR_CODE LIVE_INSPECTOR_NON_STRUCTURAL_EXPANSION_ERROR_CODE
LIVE_INSPECTOR_OBSERVER_ERROR_CODE LIVE_INSPECTOR_PROJECTION_ERROR_CODE
LIVE_INSPECTOR_RENDERER_HOOK_ERROR_CODE LIVE_INSPECTOR_SOURCE_REPLACEMENT_ERROR_CODE
LIVE_INSPECTOR_SPECIALIZATION_ERROR_CODE LIVE_INSPECTOR_UNREPRESENTABLE_CONVERSION_ERROR_CODE
LIVE_INSPECTOR_UNSUPPORTED_SERIALIZATION_ERROR_CODE LIVE_INSPECTOR_UNSUPPORTED_SOURCE_ERROR_CODE
LiveInspector LiveInspectorArrayIdentity LiveInspectorArrayKeyContext LiveInspectorArrayKeyResolver
LiveInspectorBranchRole LiveInspectorDiagnostics LiveInspectorError LiveInspectorErrorCode LiveInspectorHsonMode
LiveInspectorListener LiveInspectorMappingSummary LiveInspectorOptions LiveInspectorOwnedHsonOptions
LiveInspectorOwnedJsonOptions LiveInspectorReadHandle LiveInspectorRendererResult LiveInspectorRenderers
LiveInspectorRendererUpdate LiveInspectorSelection LiveInspectorSemanticContext LiveInspectorSemanticRenderer
LiveInspectorSerializationTarget LiveInspectorSnapshot LiveInspectorSource LiveInspectorSpecialization
LiveInspectorStatus LiveInspectorValueKind LiveTraceCollector LiveTraceCollectorOptions
LiveTraceConsoleSinkOptions LiveTraceConsoleWriter LiveTraceDetails LiveTraceDetailValue LiveTraceEvent
LiveTraceSink LiveTraceStatus LiveTraceSubsystem LiveTreeMaterializationProfile
`.trim().split(/\s+/).sort();

const PACKAGE_EXPORTS = `
.
./diagnostics
./diagnostics/transform-test-oracle
./diagnostics/universal-circuit
./echo
./hson
./livehost
./livehost/node
./livemap
./livetree
./locus
./locus/node
./number
./reflect
./ssr
./transform
`.trim().split(/\s+/).sort();

const declarationFiles = [
  "dist/index.d.ts",
  "dist/diagnostics/index.d.ts",
  "dist/hson-authoring.d.ts",
  "dist/api/transform/index.d.ts",
  "dist/number.d.ts",
  "dist/api/livemap/index.d.ts",
  "dist/api/livetree/index.d.ts",
  "dist/api/reflect/index.d.ts",
  "dist/api/echo/index.d.ts",
  "dist/api/locus/index.d.ts",
  "dist/api/locus/node/index.d.ts",
  "dist/api/ssr/index.d.ts",
  "dist/api/livehost/index.d.ts",
  "dist/api/livehost/node/index.d.ts",
  "dist/diagnostics/transform-test-oracle.d.ts",
].map((file) => resolve(repositoryRoot, file));
const program = ts.createProgram(declarationFiles, {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  skipLibCheck: false,
});
const checker = program.getTypeChecker();

function declaration_exports(relativeFile: string): string[] {
  const source = program.getSourceFile(resolve(repositoryRoot, relativeFile));
  assert.ok(source !== undefined, `missing declaration ${relativeFile}`);
  const symbol = checker.getSymbolAtLocation(source);
  assert.ok(symbol !== undefined, `missing declaration module symbol ${relativeFile}`);
  return checker.getExportsOfModule(symbol).map((item) => item.getName()).sort();
}

function check(name: string, run: () => void | Promise<void>): Promise<void> {
  testEvents.case_begin(name, name);
  return Promise.resolve().then(run).then(
    () => testEvents.case_end(name, "pass"),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "Check failed.";
      testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
      testEvents.case_end(name, "fail");
      testEvents.terminal("fail");
      throw error;
    },
  );
}

await check("root declaration exports match the reviewed allowlist", () => {
  assert.deepEqual(declaration_exports("dist/index.d.ts"), ROOT_EXPORTS);
});

await check("diagnostics declaration exports match the reviewed allowlist", () => {
  assert.deepEqual(declaration_exports("dist/diagnostics/index.d.ts"), DIAGNOSTICS_EXPORTS);
});

await check("package exports match the reviewed allowlist", () => {
  const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
    exports: Readonly<Record<string, unknown>>;
  };
  assert.deepEqual(Object.keys(manifest.exports).sort(), PACKAGE_EXPORTS);
});

await check("LiveTree declarations expose styling capabilities without runtime machinery", () => {
  const cssManager = readFileSync(resolve(repositoryRoot, "dist/api/livetree/managers/css-manager.d.ts"), "utf8");
  const cssHandles = readFileSync(resolve(repositoryRoot, "dist/types/css.types.d.ts"), "utf8");
  const keyframes = readFileSync(resolve(repositoryRoot, "dist/types/keyframes.types.d.ts"), "utf8");
  const properties = readFileSync(resolve(repositoryRoot, "dist/types/at-property.types.d.ts"), "utf8");
  const content = readFileSync(resolve(repositoryRoot, "dist/api/livetree/managers/content-manager.d.ts"), "utf8");
  const livetree = readFileSync(resolve(repositoryRoot, "dist/api/livetree/index.d.ts"), "utf8");

  for (const retained of ["class CssManager", "static api(): CssManagerApi", "atProperty", "keyframes"]) {
    assert.equal(cssManager.includes(retained), true, `${retained} must remain reachable`);
  }
  for (const hidden of [
    "CssRuntimeManager", "invoke()", "forRuntime", "selectorForQuid", "getForQuid",
    "setForQuid", "releaseOwnedCssForQuid", "syncNow", "snapshot", "debug_hardReset",
  ]) assert.equal(cssManager.includes(hidden), false, `${hidden} leaked through CssManager`);
  assert.equal(cssHandles.includes("devSnapshot"), false, "tree CSS diagnostics leaked through CssTreeHandle");
  for (const hidden of ["setOwned", "releaseOwner", "listOwned", "renderOne", "renderAll", "KeyframesOwner", "KeyframesSource"]) {
    assert.equal(keyframes.includes(hidden), false, `${hidden} leaked through keyframes declarations`);
  }
  for (const hidden of ["renderOne", "renderAll", "PropertyRegistry"]) {
    assert.equal(properties.includes(hidden), false, `${hidden} leaked through property declarations`);
  }
  assert.equal(content.includes("export interface ContentManager"), true);
  assert.equal(content.includes("constructor("), false, "tree.content exposes an independent constructor");
  assert.equal(livetree.includes("export { ContentManager"), false, "ContentManager leaked as a runtime value");
  assert.equal(livetree.includes("export type { ContentManager"), true, "tree.content capability type is missing");
  assert.equal(livetree.includes("CssRuntimeManager"), false, "runtime CSS implementation leaked from owning subpath");
});

const ownerProofs = Object.freeze({
  "dist/hson-authoring.d.ts": ["HsonNode", "HsonAttrs", "HsonMeta", "NodeContent", "JsonValue", "Primitive"],
  "dist/api/livetree/index.d.ts": ["CssManager", "make_tree_selector", "LiveTreeAttributeErrorCode", "LIVETREE_DISPOSED_ERROR_CODE"],
  "dist/api/livemap/index.d.ts": ["make_livemap_core", "make_livemap_store_api", "LiveMapCapture", "LiveMapReplay", "LiveMapCommitObserver", "snap_live_path"],
  "dist/api/reflect/index.d.ts": ["reflect_collection", "CollectionReflect", "CollectionReflectErrorCode", "DOCUMENT_REFLECT_DISPOSED_ERROR_CODE"],
  "dist/api/echo/index.d.ts": ["EchoRecovery", "EchoRecoveryCursor", "EchoRecoveryOptions", "EchoRecoveryStrategy"],
  "dist/api/locus/index.d.ts": ["decode_locus_message", "encode_locus_message", "make_locus_recovery_planner", "LocusClientMessage", "LocusRecoveryPlan", "LocusPersistenceAdapter"],
  "dist/api/locus/node/index.d.ts": ["create_node_locus_socket", "NodeLocusSocketOptions"],
  "dist/api/ssr/index.d.ts": ["render_document", "DocumentSsr"],
  "dist/api/livehost/index.d.ts": ["create_livehost_locus_registry", "LiveHost"],
  "dist/api/livehost/node/index.d.ts": ["start_node_application_host", "NodeApplicationHostOptions"],
  "dist/diagnostics/index.d.ts": ["hsonInspect", "create_live_inspector", "LiveInspector", "create_live_trace_collector"],
});

await check("specialist contracts remain available from owning entrypoints", () => {
  const root = new Set(ROOT_EXPORTS);
  for (const [file, expected] of Object.entries(ownerProofs)) {
    const actual = new Set(declaration_exports(file));
    for (const name of expected) {
      assert.equal(actual.has(name), true, `${name} must remain exported by ${file}`);
      if (!["render_document", "DocumentSsr", "create_livehost_locus_registry", "LiveHost"].includes(name)) {
        assert.equal(root.has(name), false, `${name} must not leak back into the root`);
      }
    }
  }
});

await check("retired entrypoints fail package resolution", () => {
  for (const specifier of ["hson-live/types", "hson-live/diagnostics/test-exports"]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(specifier)})`], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.notEqual(child.status, 0, `${specifier} unexpectedly resolved`);
    assert.match(child.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
  }
  assert.equal(existsSync(resolve(repositoryRoot, "dist/types/index.d.ts")), false);
  assert.equal(existsSync(resolve(repositoryRoot, "dist/_tests/test-exports.d.ts")), false);
});

await check("packed consumer resolves only curated package entrypoints", () => {
  const temporaryParent = resolve(repositoryRoot, "tmp");
  mkdirSync(temporaryParent, { recursive: true });
  const consumerRoot = mkdtempSync(join(temporaryParent, "public-entrypoint-consumer-"));
  try {
    const packed = spawnSync("npm", [
      "pack",
      "--json",
      "--pack-destination",
      consumerRoot,
      "--cache",
      join(consumerRoot, "npm-cache"),
    ], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.equal(packed.status, 0, packed.stderr);
    const packedReport = JSON.parse(packed.stdout) as ReadonlyArray<{ filename?: unknown }>;
    const archiveName = packedReport[0]?.filename;
    assert.equal(typeof archiveName, "string", "npm pack did not report an artifact filename");

    const packageRoot = join(consumerRoot, "node_modules", "hson-live");
    mkdirSync(packageRoot, { recursive: true });
    const extracted = spawnSync("tar", ["-xzf", join(consumerRoot, archiveName as string), "--strip-components=1", "-C", packageRoot], {
      cwd: consumerRoot,
      encoding: "utf8",
    });
    assert.equal(extracted.status, 0, extracted.stderr);
    writeFileSync(join(consumerRoot, "package.json"), JSON.stringify({ private: true, type: "module" }));

    const accepted = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      const entrypoints = ${JSON.stringify(PACKAGE_EXPORTS.map((entrypoint) => entrypoint === "." ? "hson-live" : `hson-live/${entrypoint.slice(2)}`))};
      await Promise.all(entrypoints.map((entrypoint) => import(entrypoint)));
    `], { cwd: consumerRoot, encoding: "utf8" });
    assert.equal(accepted.status, 0, accepted.stderr);

    for (const specifier of ["hson-live/types", "hson-live/diagnostics/test-exports"]) {
      const rejected = spawnSync(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(specifier)})`], {
        cwd: consumerRoot,
        encoding: "utf8",
      });
      assert.notEqual(rejected.status, 0, `${specifier} unexpectedly resolved from packed consumer`);
      assert.match(rejected.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
    }
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true });
  }
});

await check("all retained overlapping runtime values preserve strict identity", async () => {
  const root = await import("hson-live");
  const owners = {
    hson: await import("hson-live/hson"),
    transform: await import("hson-live/transform"),
    number: await import("hson-live/number"),
    livetree: await import("hson-live/livetree"),
    livemap: await import("hson-live/livemap"),
    reflect: await import("hson-live/reflect"),
    echo: await import("hson-live/echo"),
    locus: await import("hson-live/locus"),
    ssr: await import("hson-live/ssr"),
    livehost: await import("hson-live/livehost"),
  } as const;
  const overlap = {
    hson: ["Hson", "HsonData", "TransformError", "is_transform_error", "read_transform_error_details"],
    transform: ["HsonData", "hsonTransform", "TransformError", "is_transform_error", "read_transform_error_details"],
    number: ["hsonCalc"],
    livetree: ["hsonLiveTree", "LiveTree", "TreeSelector", "LiveTreeAlreadyAttachedError", "LiveTreeAttributeError", "LiveTreeBatchError", "LiveTreeDisposedError", "LiveTreeProtectedRootError", "LiveTreeQuidReuseError", "LiveTreeLinkedIdentityRequiredError"],
    livemap: ["hsonLiveMap", "link_livemap", "LiveMapDocumentAttributeNotFoundError", "LiveMapDocumentIdentityProvenanceError", "LiveMapDocumentIdentityRegistrationError", "LiveMapDocumentInstallError", "LiveMapDocumentMutationError", "LiveMapDocumentStagingError"],
    reflect: ["hsonReflect", "reflect_document", "DocumentReflectError"],
    echo: ["hsonEcho", "create_echo", "create_locus_bootstrap_echo", "EchoRecoveryError", "EchoSessionError"],
    locus: ["hsonLocus", "create_locus", "LocusDisconnectedError", "LocusDuplicateActionIdError", "LocusRecoveryError", "LocusAuthorityError"],
    ssr: ["decode_ssr_bootstrap", "DocumentSsrError", "encode_ssr_bootstrap", "render_document", "render_hosted_document", "SsrBootstrapCodecError"],
    livehost: ["create_livehost_locus_registry"],
  } as const;
  for (const [owner, names] of Object.entries(overlap)) {
    for (const name of names) {
      assert.equal(Reflect.get(root, name), Reflect.get(owners[owner as keyof typeof owners], name), `${name} identity diverged`);
    }
  }
});

process.stdout.write("# curated public entrypoint surface checks passed\n");
testEvents.terminal("pass");
