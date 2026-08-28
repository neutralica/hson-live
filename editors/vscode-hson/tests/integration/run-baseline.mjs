import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
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
await writeFile(join(workspace, "baseline.ts"), 'import { hson, hson as library, HSON, HSON as authored } from "hson-live";\nhson; hson.fromJson(""); library.liveMap;\nHSON; HSON.validate(undefined, "");\nconst source = HSON`<thing "readable" >`;\nconst alias = authored`<alias 1>`;\nfunction local(HSON, hson) { HSON; hson; }\n');
await writeFile(join(workspace, "provider.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync(new URL("./provider-executed",import.meta.url),"unexpected");');
await mkdir(join(workspace, ".vscode"));
await writeFile(join(workspace, ".vscode/settings.json"), JSON.stringify({
  "hson.trustedSchemaDiagnostics.enabled": false,
  "hson.trustedSchemaDiagnostics.module": "provider.mjs",
  "hson.trustedSchemaDiagnostics.hsonModule": "provider.mjs",
}));
const launch = (binary, args, env = {}) => new Promise((accept, reject) => {
  const child = spawn(binary, args, { env: { ...process.env, ...env }, stdio: "inherit" });
  child.on("error", reject); child.on("exit", code => code === 0 ? accept() : reject(new Error(`VS Code exit ${code}`)));
});
let development = root;
if (process.env.HSON_BASELINE_VSIX) {
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(executable);
  await launch(cli, [...args, "--user-data-dir", join(testRoot, "install-user"), "--extensions-dir", extensions,
    "--install-extension", resolve(process.env.HSON_BASELINE_VSIX), "--force"]);
  // Only the empty test driver is a development extension. HSON is loaded from
  // the ordinary installed VSIX, without a source/development override.
  development = join(testRoot, "driver"); await mkdir(development);
  await writeFile(join(development, "package.json"), JSON.stringify({name:"baseline-driver",publisher:"hson-tests",version:"0.0.0",engines:{vscode:"^1.95.0"}}));
}
for (const restricted of [false, true]) {
  await launch(executable, [workspace, "--skip-welcome", "--skip-release-notes", "--disable-updates",
    "--user-data-dir=" + join(testRoot, restricted ? "restricted-user" : "user"), "--extensions-dir=" + extensions,
    "--extensionDevelopmentPath=" + development, "--extensionTestsPath=" + join(root,".test-dist/baseline-integration.cjs"),
    ...restricted ? [] : ["--disable-workspace-trust"]],
  { HSON_BASELINE_WORKSPACE: workspace, HSON_BASELINE_RESTRICTED: restricted ? "1" : "0" });
}
