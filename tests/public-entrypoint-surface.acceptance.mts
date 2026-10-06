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
ANY_DATA ANY_DOCUMENT AsyncLiveTree AsyncLiveTreeAttrs AsyncLiveTreeClasslist AsyncLiveTreeFlags AsyncLiveTreeForm AsyncLiveTreeId AsyncLiveTreeText LocusInteractionDescriptor
AuthorityProjectionSnapshot BinaryDecodeOptions BrowserRealizationHtml DataLiveMapMode DecodedSsrBootstrap DetachedLiveContent DocumentContinuation DocumentContinuationError
DocumentMirror DocumentMirrorError DocumentMirrorStatus DocumentSsrError Echo EchoActionFn EchoActionPromise EchoActionRequest
EchoActionStatusResult EchoAttachmentEvent EchoEndpointTransport EchoReplicaTransport EchoSubmission EchoHttpTransport EchoHttpTransportOptions EchoWebSocketConstructor EchoWebSocketLike EchoWebSocketTransport EchoWebSocketTransportOptions EchoOptions EchoReplicaOptions EchoSyncError EchoRetryActionFn EchoSession EchoSessionError EchoSessionFailure EchoSessionOptions
EchoSessionResult EchoSessionStatus EncodedSsrBootstrap HostedDocumentContinuation LocusLocalInitializer LocusSessionApi LocusSession LocusSessionCreateOptions LocusSessionNow LocusSessionHtmlNow Hson HsonCanonical
HsonData HsonDocument HsonFacade HsonNumber HsonSchema HsonSchemaData InteractionActionDispatcher
InteractionActivationOptions InteractionDescriptor InteractionFailure InteractionListener InteractionLocalBehavior InteractionLocalBehaviors LiveHost
LiveHostApplication LiveHostApplicationContext LiveHostRuntime LiveHostConnection LiveHostConnectionRoute LiveHostCreateInput LiveHostLocusAcquisition LiveHostLocusEvictionResult LiveHostLocusRegistry LiveHostLocusRegistryOptions
LiveHostLocusRegistryResult LiveHostPrincipal LiveHostRequestRoute LiveMap LiveMapDataLibrary LiveMapDataLibraryInput LiveMapDocumentAttributeNotFoundError LiveMapDocumentIdentityProvenanceError
LiveMapDocumentIdentityRegistrationError LiveMapDocumentInstallError LiveMapDocumentLibrary LiveMapDocumentLibraryInput LiveMapDocumentLocation LiveMapDocumentMode LiveMapDocumentMutationError LiveMapDocumentStagingError LiveMapInput
LiveMapLibraryAddOperation LiveMapLibraryDefinition LiveMapDefinitions LiveMapDynamicLibrary LiveMapKnownNames LiveMapLibraryInput LiveMapLibrarySchemaUseOperation LiveMapStagedWriter LiveMapWithLibrarySchema LiveTree LiveTreeAlreadyAttachedError LiveTreeAttributeError LiveTreeBatchError LiveTreeDisposedError LiveTreeLifecycleResult LiveTreeLinkedIdentityRequiredError
LiveTreeProtectedRootError LiveTreeQuidReuseError BrowserInteractionDescriptor Locus LocusActionContext LocusActionHandler LocusActionName LocusActionPayloads
LocusActions LocusActivity LocusActivityKind LocusActivitySnapshot LocusActivityState LocusAuthorityError LocusDisconnectedError LocusHttpBinding
LocusDuplicateActionIdError LocusAuthorityLibraryDefinition LocusLocalLibraryDefinition LocusRuntimeLibraryAdditions LocusDefinitionOptions LocusResumeOptions LocusResult LocusStage LocusWebSocketLike Mirror HsonFromSchema JsonFromSchema SsrBootstrapCodecError SsrBootstrapCodecOptions
SsrBootstrapKind TransformBinarySerialize TransformError TransformErrorDetails TransformErrorRelated TransformErrorSource TreeSelector activate_interactions
add_interaction bind_locus_http bind_locus_websocket continue_document continue_hosted_document create_livehost_locus_registry decode_ssr_bootstrap enable_interactions
encode_ssr_bootstrap hson hsonCalc hsonLiveMap hsonLiveTree hsonMirror hsonLiveHost
hsonTransform is_transform_error read_transform_error_details reflect_document remove_interaction replace_interaction
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
./mirror
./scout
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
  "dist/api/mirror/index.d.ts",
  "dist/api/scout/index.d.ts",
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

await check("Scout declaration exposes only its provider and configuration call", () => {
  assert.deepEqual(declaration_exports("dist/api/scout/index.d.ts"), ["ScoutProvider", "configure_scout"]);
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

  assert.equal(cssManager.includes("class CssManager"), false, "retired public manager remains declared");
  for (const retained of ["global: CssGlobalHandle", "snapshot: () => string"]) {
    assert.equal(cssHandles.includes(retained), true, `${retained} missing from tree CSS`);
  }
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
  assert.equal(livetree.includes("CssManager"), false, "retired CSS manager leaked from owning subpath");
});

const ownerProofs = Object.freeze({
  "dist/hson-authoring.d.ts": ["HsonDocument", "HsonNode", "HsonAttrs", "HsonMeta", "NodeContent", "JsonValue", "Primitive"],
  "dist/api/livetree/index.d.ts": ["make_tree_selector", "LiveTreeAttributeErrorCode", "LIVETREE_DISPOSED_ERROR_CODE"],
  "dist/api/livemap/index.d.ts": ["LiveMapGraphCommit", "LiveMapRegistryCommitObserverApi", "LiveMapSnapshot", "snap_live_path"],
  "dist/api/mirror/index.d.ts": ["reflect_collection", "CollectionMirror", "CollectionMirrorErrorCode", "DocumentMirrorErrorCode", "DOCUMENT_MIRROR_DISPOSED_ERROR_CODE"],
  "dist/api/echo/index.d.ts": ["EchoSync", "EchoSyncStrategy"],
  "dist/api/locus/index.d.ts": ["LocusDefinitionOptions", "LocusResumeOptions", "LocusPersistenceAdapter"],
  "dist/api/locus/node/index.d.ts": ["bind_node_locus_websocket", "NodeLocusWebSocketOptions"],
  "dist/api/ssr/index.d.ts": ["BrowserRealizationHtml", "DocumentSsrError"],
  "dist/api/livehost/index.d.ts": ["create_livehost_locus_registry", "LiveHost", "LiveHostRuntime", "hsonLiveHost"],
  "dist/api/livehost/node/index.d.ts": ["start_node_application_host", "NodeApplicationHostOptions"],
  "dist/diagnostics/index.d.ts": ["hsonInspect", "create_live_inspector", "LiveInspector", "create_live_trace_collector"],
});

await check("specialist contracts remain available from owning entrypoints", () => {
  const root = new Set(ROOT_EXPORTS);
  for (const [file, expected] of Object.entries(ownerProofs)) {
    const actual = new Set(declaration_exports(file));
    for (const name of expected) {
      assert.equal(actual.has(name), true, `${name} must remain exported by ${file}`);
      if (!["HsonDocument", "BrowserRealizationHtml", "DocumentSsrError", "create_livehost_locus_registry", "LiveHost", "LiveHostRuntime", "hsonLiveHost", "LocusDefinitionOptions", "LocusResumeOptions"].includes(name)) {
        assert.equal(root.has(name), false, `${name} must not leak back into the root`);
      }
    }
  }
});

await check("retired entrypoints fail package resolution", () => {
  for (const specifier of ["hson-live/reflect", "hson-live/types", "hson-live/diagnostics/test-exports"]) {
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

    // Bundle the installed tarball, so the proof exercises published exports
    // and side-effect metadata rather than a source-relative import.
    for (const [name, call] of [
      ["create", "hsonLiveMap.create()"],
      ["fromLibraries", "hsonLiveMap.fromLibraries({ state: { data: { value: 1 } } })"],
      ["echo", "hsonLiveMap.echo.create({ transport: { operations: { async submit() { return { kind: 'not-submitted' }; } }, attachment: { observe() { return () => {}; } } } })"],
      ["locus", "hsonLiveMap.locus.create({ shared: [{ name: 'state', definition: { data: { value: 1 } } }] })"],
    ] as const) {
      const fixture = join(consumerRoot, `${name}.mjs`);
      writeFileSync(fixture, `import * as hsonLiveMap from "hson-live/livemap"; globalThis.result = ${call};`);
      const bundle = spawnSync(resolve(repositoryRoot, "node_modules/.bin/esbuild"), [
        fixture, "--bundle", "--splitting", "--format=esm", "--platform=browser", "--minify",
        `--outdir=${join(consumerRoot, `${name}-out`)}`, `--metafile=${join(consumerRoot, `${name}-meta.json`)}`,
      ], { cwd: consumerRoot, encoding: "utf8" });
      assert.equal(bundle.status, 0, bundle.stderr);
      const metadata = JSON.parse(readFileSync(join(consumerRoot, `${name}-meta.json`), "utf8")) as {
        outputs: Record<string, { entryPoint?: string; imports: { path: string; kind: string }[]; inputs: Record<string, { bytesInOutput: number }> }>;
      };
      const entry = Object.entries(metadata.outputs).find(([, output]) => output.entryPoint?.endsWith(`${name}.mjs`));
      assert.ok(entry !== undefined, `${name} packed consumer entry output is missing`);
      const staticOutputs = new Set<string>();
      const visit = (path: string): void => {
        if (staticOutputs.has(path)) return;
        staticOutputs.add(path);
        for (const imported of metadata.outputs[path]?.imports ?? []) {
          if (imported.kind !== "dynamic-import" && metadata.outputs[imported.path] !== undefined) visit(imported.path);
        }
      };
      visit(entry[0]);
      const inputs = [...staticOutputs].flatMap((path) => Object.entries(metadata.outputs[path]?.inputs ?? {}))
        .filter(([, contribution]) => contribution.bytesInOutput > 0).map(([input]) => input);
      const subsystem = (part: "livemap" | "echo" | "locus") => inputs.filter((input) => input.includes(`/api/${part}/`));
      if (name === "create" || name === "fromLibraries") {
        assert.ok(subsystem("livemap").length > 8, `${name} packed consumer omitted LiveMap construction`);
        assert.deepEqual(subsystem("echo"), [], `${name} packed consumer retained Echo`);
        assert.deepEqual(subsystem("locus"), [], `${name} packed consumer retained Locus`);
      } else if (name === "echo") {
        assert.ok(subsystem("echo").length > 0, "packed Echo endpoint is missing");
        assert.ok(subsystem("livemap").length <= 8, "packed Echo retained full LiveMap construction");
        assert.ok(subsystem("locus").length <= 4, "packed Echo retained Locus authority/session/persistence");
        assert.deepEqual(subsystem("locus").filter((input) =>
          /(?:authority|session|persist|registry|projection|stage|action|activity)/i.test(input)), [],
          "packed Echo retained a Locus authority/session/persistence family");
      } else {
        assert.ok(subsystem("locus").length > 8, "packed Locus authority is missing");
        assert.deepEqual(subsystem("echo"), [], "packed Locus retained Echo client/transports");
      }
      const allInputs = Object.values(metadata.outputs).flatMap((output) => Object.keys(output.inputs));
      assert.deepEqual(allInputs.filter((input) => /api\/(?:locus|livehost)\/node\//i.test(input)), [],
        `${name} packed browser graph retained Node adapters`);
    }

    for (const specifier of ["hson-live/reflect", "hson-live/types", "hson-live/diagnostics/test-exports"]) {
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
    mirror: await import("hson-live/mirror"),
    echo: await import("hson-live/echo"),
    locus: await import("hson-live/locus"),
    ssr: await import("hson-live/ssr"),
    livehost: await import("hson-live/livehost"),
  } as const;
  const overlap = {
    hson: ["ANY_DATA", "ANY_DOCUMENT", "Hson", "TransformError", "is_transform_error", "read_transform_error_details"],
    transform: ["hsonTransform", "TransformError", "is_transform_error", "read_transform_error_details"],
    number: ["hsonCalc"],
    livetree: ["hsonLiveTree", "LiveTree", "TreeSelector", "LiveTreeAlreadyAttachedError", "LiveTreeAttributeError", "LiveTreeBatchError", "LiveTreeDisposedError", "LiveTreeProtectedRootError", "LiveTreeQuidReuseError", "LiveTreeLinkedIdentityRequiredError"],
    livemap: ["hsonLiveMap", "LiveMapDocumentAttributeNotFoundError", "LiveMapDocumentIdentityProvenanceError", "LiveMapDocumentIdentityRegistrationError", "LiveMapDocumentInstallError", "LiveMapDocumentMutationError", "LiveMapDocumentStagingError"],
    mirror: ["hsonMirror", "reflect_document", "DocumentMirrorError"],
    echo: ["EchoSyncError", "EchoSessionError"],
    locus: ["LocusDisconnectedError", "LocusDuplicateActionIdError", "LocusAuthorityError"],
    ssr: ["decode_ssr_bootstrap", "DocumentSsrError", "encode_ssr_bootstrap", "SsrBootstrapCodecError"],
    livehost: ["create_livehost_locus_registry", "hsonLiveHost"],
  } as const;
  for (const [owner, names] of Object.entries(overlap)) {
    for (const name of names) {
      assert.equal(Reflect.get(root, name), Reflect.get(owners[owner as keyof typeof owners], name), `${name} identity diverged`);
    }
  }
  assert.equal(root.hson.liveMap, root.hsonLiveMap);
  assert.equal(root.hson.liveHost, root.hsonLiveHost);
  assert.equal(root.hsonLiveMap, owners.livemap.hsonLiveMap);
  assert.equal(root.hsonLiveMap.locus.create, root.hson.liveMap.locus.create);
  assert.equal(root.hsonLiveMap.echo.create, root.hson.liveMap.echo.create);
  assert.equal("create_echo" in root, false);
  assert.equal("create_echo" in owners.echo, false);
  assert.equal(Object.isFrozen(root.hsonLiveMap.locus), true);
  assert.equal(Object.isFrozen(root.hsonLiveMap.echo), true);
  assert.equal(Object.isFrozen(root.hsonLiveHost), true);
  for (const name of ["hsonLocus", "hsonEcho", "liveHost"]) {
    assert.equal(name in root, false);
    assert.equal(name in owners.locus, false);
    assert.equal(name in owners.echo, false);
  }
  for (const module of [root, owners.hson, owners.transform]) {
    assert.equal(Object.hasOwn(module, "HsonData"), false);
    assert.equal(Object.hasOwn(module, "HsonDocument"), false);
  }
});

process.stdout.write("# curated public entrypoint surface checks passed\n");
testEvents.terminal("pass");
