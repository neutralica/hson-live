import { mkdtemp, mkdir, writeFile, realpath, symlink } from "node:fs/promises";
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
  'const go = A.event`<hson:event on:click local:go value:str=^{missing} <> >`;',
  'A.event`<div/>`;',
  'maps.fromLibraries({ bits: { parts: { card: { kind: "document", document: Hson.document`<button hson:part event:go event:imported/>`, events: {go, imported} } } } });',
  'Hson.canonical`+1`;',
  'const ordinary: number = "TypeScript";',
].join("\n"));
await writeFile(join(workspace, "events/bridge.js"), 'export { go } from "./producer.js";');
await writeFile(join(workspace, "events/producer.ts"), 'import { Hson } from "hson-live"; export const go = Hson.event`<hson:event on:key:down local:go a:str=^{key.nope} <> >`;');
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
  await launch(executable, [workspace, "--skip-welcome", "--skip-release-notes", "--disable-updates",
    "--user-data-dir=" + join(testRoot, restricted ? "restricted-user" : "user"), "--extensions-dir=" + extensions,
    "--extensionDevelopmentPath=" + development,
    "--extensionTestsPath=" + (process.env.HSON_BASELINE_TESTS_PATH ?? join(root,".test-dist/baseline-integration.cjs")),
    ...restricted ? [] : ["--disable-workspace-trust"]],
  { HSON_BASELINE_WORKSPACE: workspace, HSON_BASELINE_RESTRICTED: restricted ? "1" : "0" });
}
