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
const eventConfig = {
  extends: "../tsconfig.json", compilerOptions: { allowJs: true },
  files: ["consumer.ts"], include: [],
};
await writeFile(join(workspace, "events/tsconfig.json"), JSON.stringify(eventConfig));
await writeFile(join(workspace, "events/consumer.ts"), 'import { go } from "./bridge.js"; export { go };');
await writeFile(join(workspace, "events/bridge.js"), 'export { go } from "./producer.js";');
const producer = 'import { Hson } from "hson-live";\r\n'
  + 'export const go = Hson.event`<hson:event on:key:down local:go note:str="é🧪" a:str=^{key.nope} <> >`;';
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
  await writeFile(join(workspace, "events/producer.ts"), Buffer.from("\uFEFF" + producer, "utf16le"));
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
  { HSON_BASELINE_WORKSPACE: workspace, HSON_BASELINE_RESTRICTED: restricted ? "1" : "0" });
}
