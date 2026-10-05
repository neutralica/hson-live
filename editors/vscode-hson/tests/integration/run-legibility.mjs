import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../..", import.meta.url));
const executable = process.env.HSON_VSCODE_EXECUTABLE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const testRoot = await realpath(await mkdtemp("/tmp/hson-legibility-"));
try {
  const workspace = join(testRoot, "workspace");
  await mkdir(join(workspace, ".vscode"), { recursive: true });
  await mkdir(join(testRoot, "extensions"));
  await writeFile(join(workspace, ".vscode/settings.json"), JSON.stringify({ 'editor.detectIndentation': false, 'editor.formatOnSave': false }));
  await new Promise((accept, reject) => {
    const child = spawn(executable, [workspace, "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-workspace-trust",
      "--user-data-dir=" + join(testRoot, "user"), "--extensions-dir=" + join(testRoot, "extensions"),
      "--extensionDevelopmentPath=" + root, "--extensionTestsPath=" + join(root, ".test-dist/legibility-integration.cjs")],
    { env: { ...process.env, HSON_LEGIBILITY_WORKSPACE: workspace }, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 ? accept() : reject(new Error(`VS Code legibility tests exited ${code} (${signal ?? 'no signal'})`)));
  });
} finally {
  await rm(testRoot, { recursive: true, force: true });
}
