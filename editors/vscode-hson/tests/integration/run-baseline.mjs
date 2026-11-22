import { mkdtemp, mkdir, readFile, readdir, writeFile, realpath, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { resolveCliArgsFromVSCodeExecutablePath } from "@vscode/test-electron";

const root = fileURLToPath(new URL("../..", import.meta.url));
const executable = process.env.HSON_VSCODE_EXECUTABLE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const testRoot = await realpath(await mkdtemp("/tmp/hson-baseline-"));
console.log("# baseline isolated profile: " + testRoot);
const workspace = join(testRoot, "workspace"), extensions = join(testRoot, "extensions");
await mkdir(workspace); await mkdir(extensions);
const eventPackage = join(testRoot, "package");
await mkdir(eventPackage);
await symlink(fileURLToPath(new URL("../../../../src", import.meta.url)), join(eventPackage, "src"), "junction");
await writeFile(join(eventPackage, "package.json"), JSON.stringify({
  name: "hson-live", type: "module", exports: { ".": "./src/index.ts", "./hson": "./src/hson-authoring.ts" },
}));
await mkdir(join(workspace, "node_modules"));
await symlink(eventPackage, join(workspace, "node_modules/hson-live"), "junction");
await writeFile(join(workspace, "package.json"), '{"type":"module"}');
await writeFile(join(workspace, "tsconfig.json"), '{"compilerOptions":{"module":"NodeNext"},"include":["*.ts"]}');
const sdk = join(workspace, "sdk"), conditional = join(workspace, "node_modules/conditional-hson");
await mkdir(sdk); await mkdir(conditional);
await writeFile(join(sdk, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", types: [],
  paths: { "hson-live/hson": ["./bridge.ts"] } }, files: ["consumer.ts"] }));
await writeFile(join(sdk, "bridge.ts"), 'export {Hson} from "conditional-hson";');
await writeFile(join(conditional, "package.json"), JSON.stringify({ name: "conditional-hson", type: "module",
  exports: { ".": { "types@>=6.0": "./namespace.d.ts", types: "./value.d.ts" } } }));
await writeFile(join(conditional, "value.d.ts"), 'export {Hson} from "hson-live";');
await writeFile(join(conditional, "namespace.d.ts"), 'export * as Hson from "hson-live";');
await writeFile(join(sdk, "consumer.ts"), 'import {Hson} from "hson-live/hson"; Hson.event`<div/>`; const keep:number="bad";\n'
  + 'import {Hson as Root} from "hson-live"; Root.event`<div/>`;');
for (const [name, eol] of [["lf", "\n"], ["crlf", "\r\n"], ["cr", "\r"]]) {
  await writeFile(join(workspace, `event-${name}.ts`), [
    'import { Hson } from "hson-live";',
    'const event = Hson.event`<hson:event on:click host:s once',
    ' once <> >`;',
  ].join(eol));
}
await writeFile(join(workspace, "event-astral.ts"), [
  'import { Hson } from "hson-live/hson";',
  'const event = Hson.event`<hson:event on:click local:s note:str="🧪" once once <> >`;',
].join("\r"));
await mkdir(join(workspace, "events"));
await symlink(join(workspace, "events"), join(workspace, "mirror"), "junction");
await mkdir(join(workspace, "events/type-packages/overrides"), { recursive: true });
await writeFile(join(workspace, "events/type-packages/overrides/index.d.ts"),
  'declare module "hson-live/hson" { export const Hson: { event: typeof String.raw }; }');
const eventConfig = {
  extends: "../tsconfig.json", compilerOptions: { allowJs: true },
  files: ["consumer.ts", "open-consumer.ts"], include: [],
};
await writeFile(join(workspace, "events/tsconfig.json"), JSON.stringify(eventConfig));
await writeFile(join(workspace, "events/tsconfig.events.json"), JSON.stringify({
  ...eventConfig, compilerOptions: { ...eventConfig.compilerOptions, preserveSymlinks: true },
  files: ["../mirror/consumer.ts", "../mirror/open-consumer.ts"],
}));
await writeFile(join(workspace, "events/consumer.ts"), 'import { Hson as A } from "hson-live/hson"; A.event`<div/>`;');
await writeFile(join(workspace, "events/open-consumer.ts"), [
  'import { Hson, hsonLiveMap as maps } from "hson-live";',
  'import { Hson as A } from "hson-live/hson";',
  'import { go as imported } from "./bridge.js";',
  'const go = A.event`<hson:event on:click local:go value:str=^{missing} selection:data=^{row.label} <> >`;',
  'A.event`<div/>`;',
  'maps.fromLibraries({ bits: { parts: { card: { kind: "document", document: Hson.document`<button hson:part data:row=%{rows} event:go event:imported/>`, events: {go, imported} } } } });',
  'Hson.canonical`+1`;',
  'const ordinary: number = "TypeScript";',
].join("\n"));
await writeFile(join(workspace, "events/bridge.js"), 'export { go } from "./producer.js";');
const producer = 'import { Hson } from "hson-live";\r\n'
  + 'export const go = Hson.event`<hson:event on:key:down local:go note:str="é🧪" a:str=^{key.nope} <> >`;';
await writeFile(join(workspace, "events/producer.ts"), Buffer.from("\uFEFF" + producer, "utf16le"));
const membership = join(workspace, "membership");
for (const project of ["first", "second", "third"]) await mkdir(join(membership, project), { recursive: true });
await writeFile(join(membership, "first/tsconfig.json"), JSON.stringify({
  compilerOptions: { module: "NodeNext", types: [] }, files: ["consumer.ts"],
}));
const membershipConsumer = [
  'import { Hson, hsonLiveMap as maps } from "hson-live";',
  'import { Hson as author } from "hson-live/hson";',
  'export const go = author.event`<hson:event on:click local:go value:str=^{missing} selection:data=^{row.label} <> >`;',
  'author.event`<div/>`;',
  'maps.fromLibraries({ bits: { parts: { card: { kind: "document", document: Hson.document`<button hson:part data:row=%{rows} event:go/>`, events: {go} } } } });',
  'const ordinary: number = "TypeScript";',
].join("\n");
await writeFile(join(membership, "first/consumer.ts"), membershipConsumer);
await writeFile(join(membership, "third/tsconfig.json"), JSON.stringify({
  compilerOptions: { module: "NodeNext", types: [] }, files: ["independent.ts"],
}));
await writeFile(join(membership, "third/independent.ts"), membershipConsumer);
await writeFile(join(membership, "second/tsconfig.json"), JSON.stringify({
  compilerOptions: { module: "NodeNext", types: [], paths: { "hson-live/hson": ["./late-identity.ts", "./identity.ts"] } }, files: ["root.ts"],
}));
await writeFile(join(membership, "second/root.ts"), 'import "./bridge.js"; import "./identity.js";');
await writeFile(join(membership, "second/bridge.ts"), "export {};");
await writeFile(join(membership, "second/identity.ts"), 'export { Hson } from "hson-live";');
await writeFile(join(workspace, "baseline.ts"), 'import { hson, hson as library, Hson, Hson as authored } from "hson-live";\nhson; hson.fromJson(""); library.liveMap;\nHson; Hson.schema.fromHson(undefined, "");\nconst source = Hson.canonical`<thing "readable" >`;\nconst alias = authored.canonical`<alias 1>`;\nfunction local(Hson, hson) { Hson; hson; }\n');
await writeFile(join(workspace, "provider.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync(new URL("./provider-executed",import.meta.url),"unexpected");');
await mkdir(join(workspace, ".vscode"));
await writeFile(join(workspace, ".vscode/settings.json"), JSON.stringify({
  // A repository-authored preference is deliberately insufficient: the
  // extension-owned consent receipt is absent in both isolated profiles.
  "hson.trustedSchemaDiagnostics.enabled": true,
  "hson.trustedSchemaDiagnostics.module": "provider.mjs",
  "hson.trustedSchemaDiagnostics.hsonModule": "provider.mjs",
}));
const launch = (binary, args, env = {}) => new Promise((accept, reject) => {
  const child = spawn(binary, args, { env: { ...process.env, ...env }, stdio: "inherit" });
  child.on("error", reject); child.on("exit", code => code === 0 ? accept() : reject(new Error(`VS Code exit ${code}`)));
});
let development = process.env.HSON_BASELINE_EXTENSION_PATH ?? root;
const gateDiscovery = !process.env.HSON_BASELINE_EXTENSION_PATH && !process.env.HSON_BASELINE_VSIX;
if (gateDiscovery) {
  // Gate the actual tsserver reply in a disposable copy of the compiled extension.
  // The installed extension and its public surface do not expose a test hook.
  development = join(testRoot, "development");
  const dist = join(development, "dist");
  await mkdir(dist, { recursive: true });
  for (const name of await readdir(root)) {
    if (name !== "dist") await symlink(join(root, name), join(development, name));
  }
  for (const name of await readdir(join(root, "dist"))) {
    if (name !== "extension.js") await symlink(join(root, "dist", name), join(dist, name));
  }
  let bundle = await readFile(join(root, "dist/extension.js"), "utf8");
  for (const [anchor, instrumentation] of [
    ["let projects = authoritative?.projects;", "await globalThis.hsonTestHoldProjectReply?.(authoritative, request, isCurrent);"],
    ["context.subscriptions.push(sourceWatcher, projectWatcher);",
      "context.subscriptions.push(projectWatcher.onDidChange(uri => globalThis.hsonTestProjectChange?.(uri.toString())));"],
    ["const change = Object.freeze({ uri: uri.toString(), kind, affectsTypeScriptProjects: moduleSource(uri), observationOnly });",
      "globalThis.hsonTestReplayCreate ??= uri => fireSource(uri, 'create'); globalThis.hsonTestSourceChange?.(change);"],
    ["const grammar = load_hson_grammar(context.extensionPath);",
      "const testAppearance = new AppearanceSpanCache(bindingCache); globalThis.hsonTestAppearanceSpans = async document => testAppearance.get(await grammar, document);"],
  ]) {
    if (bundle.split(anchor).length !== 2) throw new Error("Missing compiled workbench test boundary: " + anchor);
    bundle = bundle.replace(anchor, anchor + "\n" + instrumentation);
  }
  await writeFile(join(dist, "extension.js"), bundle);
}
if (process.env.HSON_BASELINE_VSIX) {
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(executable);
  await launch(cli, [...args, "--user-data-dir", join(testRoot, "install-user"), "--extensions-dir", extensions,
    "--install-extension", resolve(process.env.HSON_BASELINE_VSIX), "--force"]);
  // Only the empty test driver is a development extension. Hson is loaded from
  // the ordinary installed VSIX, without a source/development override.
  development = join(testRoot, "driver"); await mkdir(development);
  await writeFile(join(development, "package.json"), JSON.stringify({name:"baseline-driver",publisher:"hson-tests",version:"0.0.0",engines:{vscode:"^1.95.0"}}));
}
for (const restricted of [false, true]) {
  const userData = join(testRoot, restricted ? "restricted-user" : "user");
  if (process.env.HSON_BASELINE_TYPESCRIPT_SDK) {
    await mkdir(join(userData, "User"), { recursive: true });
    await writeFile(join(userData, "User/settings.json"), JSON.stringify({
      "js/ts.tsdk.path": resolve(process.env.HSON_BASELINE_TYPESCRIPT_SDK),
      "typescript.tsserver.log": "terse",
    }));
  }
  await launch(executable, [workspace, "--skip-welcome", "--skip-release-notes", "--disable-updates",
    "--user-data-dir=" + userData, "--extensions-dir=" + extensions,
    "--extensionDevelopmentPath=" + development,
    "--extensionTestsPath=" + (process.env.HSON_BASELINE_TESTS_PATH ?? join(root,".test-dist/baseline-integration.cjs")),
    ...restricted ? [] : ["--disable-workspace-trust"]],
  { HSON_BASELINE_WORKSPACE: workspace, HSON_BASELINE_RESTRICTED: restricted ? "1" : "0",
    HSON_BASELINE_GATE_DISCOVERY: gateDiscovery ? "1" : "0" });
}
