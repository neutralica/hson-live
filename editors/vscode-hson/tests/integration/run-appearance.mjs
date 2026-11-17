import { mkdir, mkdtemp, writeFile, readFile, symlink, unlink, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from 'node:os';
import { binding_color_port, monitor_binding_colors } from "./binding-colors.mjs";
import { monitor_appearance_ui } from "./appearance-driver.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const runs = join(tmpdir(), "hson-appearance-runs");
await mkdir(runs, { recursive: true });
const testRoot = await mkdtemp(join(runs, "run-"));
// macOS Unix sockets require a short spelling. The profile is entirely temporary.
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
  "files.simpleDialog.enable": true, "git.enabled": false, "chat.disableAIFeatures": true,
}));
await writeFile(join(workspace, "proof.ts"), 'import { Hson } from "hson-live/hson";\nconst hostValue = "native";\nconst doc = Hson.document`\n<p data:input="%{input}" title="attribute text"\n  "content text ${hostValue.toUpperCase()}"/>\n`;\n');
await writeFile(join(workspace, "hson-authoring.d.ts"), 'declare module "hson-live/hson" { export const Hson: { document(s: TemplateStringsArray, ...v: unknown[]): string; data(s: TemplateStringsArray, ...v: unknown[]): unknown; }; }');
await writeFile(join(workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", strict: true }, include: ["*.ts"] }));
const port = await binding_color_port();
const persistent = process.argv.includes('--scratchpads');
const driver = join(testRoot, 'driver');
if (persistent) {
  // --extensionTestsPath deliberately uses in-memory VS Code storage. A small
  // test-only extension runs the same assertions in a normal development window
  // so restart tests exercise actual workspace Memento and hot-exit recovery.
  await mkdir(driver);
  await writeFile(join(driver,'package.json'),JSON.stringify({name:'hson-scratchpad-test-driver',publisher:'hson-tests',version:'1.0.0',engines:{vscode:'^1.95.0'},main:'./index.cjs',activationEvents:['onStartupFinished']}));
  await writeFile(join(driver,'index.cjs'),`const vscode=require('vscode');const fs=require('node:fs/promises');
exports.activate=async(context)=>{let result;const suite=require(${JSON.stringify(join(root,'.test-dist/appearance-integration.cjs'))});try{await suite.run(context.workspaceState);result={ok:true};}catch(error){result={ok:false,error:String(error.stack??error),tabs:vscode.window.tabGroups.all.flatMap(group=>group.tabs).map(tab=>({label:tab.label,viewType:tab.input.viewType})),editors:vscode.window.visibleTextEditors.map(editor=>({file:editor.document.fileName,language:editor.document.languageId}))};try{await suite.ui(process.env.HSON_APPEARANCE_WORKSPACE,{action:'screenshot',name:'scratchpad-failure'});}catch{}}
await fs.writeFile(process.env.HSON_APPEARANCE_RESULT,JSON.stringify(result));await vscode.commands.executeCommand('workbench.action.quit');};`);
}

console.log("APPEARANCE_TEST_ROOT=" + testRoot);
try {
  await symlink(testRoot, alias);
  for(const phase of ["initial","reload"]){
    if(persistent&&phase==='reload')await rm(join(testRoot,'user/Backups'),{recursive:true,force:true});
    for (const name of ['appearance-ui-request.json','appearance-ui-response.json','binding-color-request.json','binding-color-response.json']) await unlink(join(workspace,name)).catch(()=>{});
    const colors=monitor_binding_colors(workspace,port),ui=monitor_appearance_ui(workspace,port);
    try{await new Promise((accept, reject) => {
    const child = spawn(process.env.HSON_VSCODE_EXECUTABLE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code", [
      workspace, "--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-workspace-trust",
      "--user-data-dir=" + join(alias, "user"), "--extensions-dir=" + join(alias, "extensions"),
      "--remote-debugging-port=" + port, "--extensionDevelopmentPath=" + root,
      ...(persistent ? ["--extensionDevelopmentPath=" + driver] : ["--extensionTestsPath=" + join(root, ".test-dist/appearance-integration.cjs")]),
    ], { stdio: "inherit", env: { ...process.env, TMPDIR: alias, HSON_SCRATCHPAD_TESTS:persistent?'1':'0', HSON_APPEARANCE_RESULT:join(workspace,`result-${phase}.json`),HSON_APPEARANCE_WORKSPACE: workspace, HSON_APPEARANCE_RELOAD: phase==="reload"?"1":"0" } });
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 ? accept() : reject(new Error(`Appearance tests exited ${code} (${signal})`)));
    });
      if(persistent){const result=JSON.parse(await readFile(join(workspace,`result-${phase}.json`),'utf8'));if(!result.ok)throw new Error(result.error);}
      await writeFile(join(workspace,`appearance-${phase}-colors.json`),await readFile(join(workspace,"binding-color-report.json")));
    }finally{colors.stop();ui.stop();await Promise.all([colors.done,ui.done]);}
  }
} finally { await unlink(alias).catch(() => {}); }
console.log(await readFile(join(workspace, "binding-color-report.json"), "utf8"));
