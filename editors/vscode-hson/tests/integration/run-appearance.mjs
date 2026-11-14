import { mkdir, mkdtemp, writeFile, readFile, symlink, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { binding_color_port, monitor_binding_colors } from "./binding-colors.mjs";
import { monitor_appearance_ui } from "./appearance-driver.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const runs = resolve(root, "../../tmp/appearance-runs");
await mkdir(runs, { recursive: true });
const testRoot = await mkdtemp(join(runs, "run-"));
// macOS Unix sockets require a short spelling. The owner authorized this one
// temporary alias; every file still lands inside the isolated feature worktree.
const alias = "/tmp/hson-appearance-" + randomUUID().slice(0, 8);
const workspace = join(testRoot, "workspace");
await mkdir(join(workspace, ".vscode"), { recursive: true });
await mkdir(join(testRoot, "extensions"));
await writeFile(join(workspace, ".vscode/settings.json"), JSON.stringify({
  "workbench.colorTheme": "Hson House Dark", "workbench.startupEditor": "none",
  "editor.minimap.enabled": false, "editor.fontSize": 14, "editor.wordWrap": "off",
  "editor.semanticHighlighting.enabled": true, "editor.bracketPairColorization.enabled": true,
  "editor.renderValidationDecorations": "off", "hson.formatting.formatOnSave": false,
  "window.title": "Hson Appearance isolated verification",
  "git.enabled": false, "chat.disableAIFeatures": true,
}));
await writeFile(join(workspace, "proof.ts"), 'import { Hson } from "hson-live/hson";\nconst hostValue = "native";\nconst doc = Hson.document`\n<p data:input="%{input}" title="attribute text"\n  "content text ${hostValue.toUpperCase()}"/>\n`;\n');
await writeFile(join(workspace, "hson-authoring.d.ts"), 'declare module "hson-live/hson" { export const Hson: { document(s: TemplateStringsArray, ...v: unknown[]): string; data(s: TemplateStringsArray, ...v: unknown[]): unknown; }; }');
await writeFile(join(workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", strict: true }, include: ["*.ts"] }));
const port = await binding_color_port();
const colors = monitor_binding_colors(workspace, port);
const ui = monitor_appearance_ui(workspace, port);
console.log("APPEARANCE_TEST_ROOT=" + testRoot);
try {
  await symlink(testRoot, alias);
  await new Promise((accept, reject) => {
    const child = spawn(process.env.HSON_VSCODE_EXECUTABLE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code", [
      workspace, "--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-workspace-trust",
      "--user-data-dir=" + join(alias, "user"), "--extensions-dir=" + join(alias, "extensions"),
      "--remote-debugging-port=" + port, "--extensionDevelopmentPath=" + root,
      "--extensionTestsPath=" + join(root, ".test-dist/appearance-integration.cjs"),
    ], { stdio: "inherit", env: { ...process.env, TMPDIR: alias, HSON_APPEARANCE_WORKSPACE: workspace } });
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 ? accept() : reject(new Error(`Appearance tests exited ${code} (${signal})`)));
  });
} finally { colors.stop(); ui.stop(); await Promise.all([colors.done, ui.done]); await unlink(alias).catch(() => {}); }
console.log(await readFile(join(workspace, "binding-color-report.json"), "utf8"));
