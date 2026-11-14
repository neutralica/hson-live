import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { IGrammar } from "vscode-textmate";
import { AppearanceRenderer } from "./appearance-renderer.js";
import { AppearanceSpanCache, appearanceColor, appearanceRoles, isAppearanceRole, type AppearanceColors } from "./appearance-spans.js";
import type { HsonBindingCache } from "./binding-intelligence.js";

type Mode = "light" | "dark";
type Comparison = "saved" | "draft";
type Example = keyof typeof examples;
const labels = { attributeString: "Attribute string content", contentString: "Hson content string",
  attributeQuotes: "Attribute quotes", contentQuotes: "Content quotes" };
const examples = {
  Document: { language: "hson", content: '// Editable Document scratchpad — paste your own Hson here.\n<section title="Attribute text" class="example"\n  <h1 "Content text"/>\n  <p data:message="%{message}" "Hello ^{message}"/>\n/>\n' },
  Data: { language: "hson", content: '// Editable Data scratchpad — paste your own Hson here.\n<catalog\n  <title "Data content" >\n  <tags ["alpha", "beta"]>\n  <count 42>\n  <enabled true>\n>\n' },
  Interpolation: { language: "typescript", content: 'import { Hson } from "hson-live/hson";\nconst hostValue = "Native TypeScript";\nconst document = Hson.document`\n<section title="Attribute text"\n  <p "Content text ${hostValue.toUpperCase()}"/>\n/>`;\n' },
};
function isExample(value: unknown): value is Example { return typeof value === "string" && Object.hasOwn(examples, value); }
function currentMode(): Mode {
  return [vscode.ColorThemeKind.Light, vscode.ColorThemeKind.HighContrastLight].includes(vscode.window.activeColorTheme.kind) ? "light" : "dark";
}

/** Read the committed generator's effective colors, including its inheritance
 * and intensity blending. The editor neither edits nor regenerates House. */
async function houseColors(extensionPath: string, mode: Mode): Promise<AppearanceColors> {
  const theme = JSON.parse(await readFile(join(extensionPath, `themes/hson-house-${mode}-color-theme.json`), "utf8"));
  const color = (type: string): string => {
    const value = theme.semanticTokenColors[type];
    const result = appearanceColor(typeof value === "string" ? value : value?.foreground);
    if (!result) throw new Error(`Missing packaged House color: ${type}`);
    return result;
  };
  return { attributeString: color("hsonString"), contentString: color("hsonString"),
    attributeQuotes: color("hsonQuote"), contentQuotes: color("hsonQuote") };
}

export class HsonAppearanceEditor implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private renderer?: AppearanceRenderer;
  private opening?: Promise<void>;
  private readonly documents = new Map<Example, vscode.TextDocument>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private saved?: Record<Mode, AppearanceColors>;
  private draft?: Record<Mode, AppearanceColors>;
  private comparison: Comparison = "draft";
  private example: Example = "Document";
  private readonly scratchpadId = randomUUID().slice(0, 8);
  private disposed = false;
  constructor(private readonly extensionPath: string, private readonly grammar: Promise<IGrammar>, private readonly bindings: HsonBindingCache) {}

  async open(): Promise<void> {
    if (this.disposed) return;
    if (this.opening) return this.opening;
    this.opening = this.openPanel().finally(() => { this.opening = undefined; });
    return this.opening;
  }
  private async openPanel(): Promise<void> {
    if (!this.saved) {
      const [light, dark] = await Promise.all([houseColors(this.extensionPath, "light"), houseColors(this.extensionPath, "dark")]);
      this.saved = { light, dark };
      this.draft = { light: { ...light }, dark: { ...dark } };
    }
    if (this.disposed) return;
    if (!this.panel) {
      this.renderer = new AppearanceRenderer(this.grammar, new AppearanceSpanCache(this.bindings));
      const panel = this.panel = vscode.window.createWebviewPanel("hson.appearance", "Hson Appearance", vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
      panel.webview.html = appearanceHtml();
      this.subscriptions.push(panel.onDidDispose(() => {
        this.panel = undefined;
        this.renderer?.dispose();
        this.renderer = undefined;
        for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
      }), panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.receive(message).catch(error => { void vscode.window.showErrorMessage(`Hson Appearance: ${String(error)}`); });
      }), vscode.window.onDidChangeActiveColorTheme(() => { void this.present(); }));
      for (const document of this.documents.values()) if (!document.isClosed) await this.renderer.attach(document);
    }
    // An explicit editing arrangement: ordinary native editor groups retain
    // documents, selections and undo stacks. No user setting is changed.
    await vscode.commands.executeCommand("vscode.setEditorLayout", { orientation: 0, groups: [{ size: 0.34 }, { size: 0.66 }] });
    this.panel?.reveal(vscode.ViewColumn.One, true);
    await this.showExample(this.example);
    await this.present();
  }
  private async showExample(example: Example): Promise<void> {
    this.example = example;
    let document = this.documents.get(example);
    if (!document || document.isClosed) {
      // Existing discovery and native TS services use the filename extension.
      // Give untitled buffers a real language suffix without writing a file.
      const suffix = examples[example].language === "typescript" ? "ts" : "hson";
      const uri = vscode.Uri.from({ scheme: "untitled", path: `Hson ${example} ${this.scratchpadId}.${suffix}` });
      document = await vscode.workspace.openTextDocument(uri);
      const seed = new vscode.WorkspaceEdit();
      seed.insert(document.uri, new vscode.Position(0, 0), examples[example].content);
      if (!await vscode.workspace.applyEdit(seed)) throw new Error("Could not initialize the appearance scratchpad");
      this.documents.set(example, document);
    }
    if (!this.panel) return;
    await this.renderer?.attach(document);
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Two, preview: false, preserveFocus: true });
  }
  private async receive(message: unknown): Promise<void> {
    if (!message || typeof message !== "object" || !("type" in message) || !this.draft || !this.saved) return;
    if (message.type === "color" && "role" in message && "value" in message && isAppearanceRole(message.role)) {
      const color = appearanceColor(message.value);
      if (!color) return;
      this.draft[currentMode()][message.role] = color;
      this.comparison = "draft";
    } else if (message.type === "compare" && "value" in message && (message.value === "saved" || message.value === "draft")) {
      this.comparison = message.value;
    } else if (message.type === "revert") {
      this.draft[currentMode()] = { ...this.saved[currentMode()] };
      this.comparison = "draft";
    } else if (message.type === "example" && "value" in message && isExample(message.value)) {
      await this.showExample(message.value);
    } else if (message.type !== "ready") return;
    await this.present();
  }
  private async present(): Promise<void> {
    if (!this.saved || !this.draft || !this.panel) return;
    const mode = currentMode();
    await this.renderer?.setColors((this.comparison === "saved" ? this.saved : this.draft)[mode]);
    await this.panel?.webview.postMessage({ type: "state", mode, comparison: this.comparison, example: this.example,
      saved: this.saved[mode], draft: this.draft[mode], changed: appearanceRoles.some(role => this.saved![mode][role] !== this.draft![mode][role]) });
  }
  dispose(): void {
    this.disposed = true;
    this.panel?.dispose();
    this.renderer?.dispose();
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    this.documents.clear();
  }
}

function appearanceHtml(): string {
  const nonce = randomUUID();
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body { padding: 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
h1 { font-size: 20px; } p { line-height: 1.5; } button, input { font: inherit; }
button { padding: 6px 10px; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid transparent; }
button[aria-pressed="true"] { border-color: var(--vscode-focusBorder); color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
.buttons { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
.role { border-top: 1px solid var(--vscode-panel-border); padding: 12px 0; }
.role label { display: block; margin-bottom: 8px; }
.columns { display: grid; grid-template-columns: minmax(80px, 1fr) minmax(110px, 1fr); gap: 8px; align-items: center; }
.saved { display: flex; align-items: center; gap: 5px; font-size: 12px; }
.swatch { width: 16px; height: 16px; border: 1px solid var(--vscode-input-border, currentColor); flex-shrink: 0; }
.draft { display: flex; gap: 4px; } input[type="color"] { width: 28px; height: 28px; padding: 1px; flex-shrink: 0; }
input[type="text"] { width: 100%; min-width: 60px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px; }
input[aria-invalid="true"] { border-color: var(--vscode-inputValidation-errorBorder); }
.muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
</style></head><body>
<h1>Hson Appearance</h1>
<p id="status" role="status" aria-live="polite">Loading appearance…</p>
<div class="buttons" aria-label="Compare appearance"><button id="saved" aria-pressed="false">Saved</button><button id="draft" aria-pressed="true">Draft</button><button id="revert">Revert Draft</button></div>
<p class="muted">Saved starts from the committed House colors. Draft edits stay in this window’s session. Colors apply to these scratchpads.</p>
<div class="columns muted"><span>Saved</span><span>Draft</span></div>
${appearanceRoles.map(role => `<div class="role"><label for="${role}">${labels[role]}</label><div class="columns"><div class="saved"><span id="${role}-swatch" class="swatch"></span><span id="${role}-saved"></span></div><div class="draft"><input type="color" id="${role}-picker" aria-label="${labels[role]} color picker"><input type="text" id="${role}" aria-label="${labels[role]} hex color" spellcheck="false" maxlength="9" aria-describedby="color-help"></div></div></div>`).join("")}
<p id="color-help" class="muted">Hex colors: #RGB, #RGBA, #RRGGBB or #RRGGBBAA. Any colors may match.</p>
<div class="buttons" aria-label="Scratchpad examples">${Object.keys(examples).map(example => `<button id="example-${example}">${example}</button>`).join("")}</div>
<p class="muted">Edit or paste in the native editor on the right. Switching Saved/Draft keeps your text and undo history.</p>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
const roles = ${JSON.stringify(appearanceRoles)};
const send = message => api.postMessage(message);
for (const value of ['saved', 'draft']) document.getElementById(value).onclick = () => send({type: 'compare', value});
document.getElementById('revert').onclick = () => { document.activeElement.blur(); send({type: 'revert'}); };
for (const value of ${JSON.stringify(Object.keys(examples))}) document.getElementById('example-' + value).onclick = () => send({type: 'example', value});
for (const role of roles) {
  const input = document.getElementById(role), picker = document.getElementById(role + '-picker');
  input.oninput = () => { const valid = /^#(?:[\\da-f]{3,4}|[\\da-f]{6}|[\\da-f]{8})$/i.test(input.value); input.setAttribute('aria-invalid', String(!valid)); if (valid) send({type: 'color', role, value: input.value}); };
  picker.oninput = () => send({type: 'color', role, value: picker.value});
}
window.addEventListener('message', ({data}) => {
  if (data.type !== 'state') return;
  document.getElementById('status').textContent = (data.comparison === 'saved' ? 'Viewing Saved' : 'Viewing Draft') + ' · House ' + data.mode + (data.changed ? ' · Unsaved draft' : ' · No draft changes');
  for (const value of ['saved', 'draft']) document.getElementById(value).setAttribute('aria-pressed', String(data.comparison === value));
  for (const value of ${JSON.stringify(Object.keys(examples))}) document.getElementById('example-' + value).setAttribute('aria-pressed', String(data.example === value));
  for (const role of roles) {
    document.getElementById(role + '-swatch').style.background = data.saved[role];
    document.getElementById(role + '-saved').textContent = data.saved[role];
    const input = document.getElementById(role);
    if (document.activeElement !== input) { input.value = data.draft[role]; input.setAttribute('aria-invalid', 'false'); }
    document.getElementById(role + '-picker').value = data.draft[role].slice(0, 7);
  }
});
send({type: 'ready'});
</script></body></html>`;
}
