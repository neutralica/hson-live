import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import { AppearanceRenderer } from "../../src/appearance-renderer.js";
import { load_hson_grammar } from "../../src/highlighting.js";
import { appearanceRoles } from "../../src/appearance-spans.js";
import { document_semantic_tokens, hsonSemanticLegend } from "../../src/semantic-tokens.js";

const pause = () => new Promise(resolve => setTimeout(resolve, 100));
let sequence = 0;
type UiState = { status: string; saved: string; draft: Record<string, string> };
async function ui<T = UiState>(workspace: string, request: Record<string, unknown>): Promise<T> {
  const id = ++sequence;
  await writeFile(join(workspace, "appearance-ui-request.json"), JSON.stringify({ ...request, id }));
  for (let attempt = 0; attempt < 150; attempt++) {
    const response = await readFile(join(workspace, "appearance-ui-response.json"), "utf8").then(JSON.parse, () => undefined);
    if (response?.id === id) { assert.equal(response.error, undefined, "Rendered UI: " + request.action); return response.value; }
    await pause();
  }
  assert.fail("Rendered UI probe timed out");
}
const rgb = (hex: string) => `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;
export async function rendered(workspace: string, document: vscode.TextDocument, label: string,
  samples: readonly { needle: string; length?: number; offset?: number; expected?: string }[]) {
  const id = ++sequence, text = document.getText();
  const tokens = samples.map(sample => {
    const start = text.indexOf(sample.needle);
    assert.ok(start >= 0, sample.needle);
    const position = document.positionAt(start + (sample.offset ?? 0));
    return { lineText: document.lineAt(position.line).text, character: position.character,
      length: sample.length ?? sample.needle.length, expected: sample.expected };
  });
  await writeFile(join(workspace, "binding-color-request.json"), JSON.stringify({ id, label, tokens, pairs: [] }));
  for (let attempt = 0; attempt < 180; attempt++) {
    const response = await readFile(join(workspace, "binding-color-response.json"), "utf8").then(JSON.parse, () => undefined);
    if (response?.id === id) { assert.equal(response.error, undefined, label); const colors: string[] = response.colors; return colors; }
    await pause();
  }
  assert.fail("Rendered color probe timed out: " + label);
}

export async function run(): Promise<void> {
  const workspace = process.env.HSON_APPEARANCE_WORKSPACE!;
  const extension = vscode.extensions.getExtension("terminal-gothic.hson-language")!;
  await extension.activate();
  const grammar = load_hson_grammar(extension.extensionPath);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "proof.ts")));
  const editor = await vscode.window.showTextDocument(document);
  const cancellation = new vscode.CancellationTokenSource();
  let semantic: vscode.SemanticTokens | undefined;
  for (let attempt = 0; attempt < 100 && !semantic; attempt++) {
    semantic = await document_semantic_tokens(document, cancellation.token, grammar);
    if (!semantic) await pause();
  }
  cancellation.dispose();
  assert.ok(semantic, "production native/Hson semantic composition is active");
  const types = [...semantic.data].filter((_, index) => index % 5 === 3).map(index => hsonSemanticLegend.tokenTypes[index]);
  assert.ok(types.includes("hsonString") && types.includes("hsonQuote") && types.includes("variable"));
  await vscode.workspace.getConfiguration("editor").update("semanticTokenColorCustomizations", { rules: { hsonString: "#223344", hsonQuote: "#334455" } }, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration("editor").update("tokenColorCustomizations", { textMateRules: [{ scope: ["string.quoted.double.hson", "string.template.ts"], settings: { foreground: "#112233" } }] }, vscode.ConfigurationTarget.Workspace);
  await rendered(workspace, document, "semantic tokens override TextMate before appearance", [
    { needle: "attribute text", expected: "rgb(34, 51, 68)" }, { needle: '"content text', length: 1, expected: "rgb(51, 68, 85)" },
  ]);
  const native = [
    { needle: "hostValue", offset: 0, length: 9 },
    { needle: "${hostValue", offset: 2, length: 9 },
    { needle: "${", offset: 1, length: 1 },
    { needle: "<p", length: 1 },
    { needle: "Hson.document", length: 1 },
    { needle: "%{input}", offset: 2, length: 5 },
  ];
  const before = await rendered(workspace, document, "native before", native);
  const renderer = new AppearanceRenderer(grammar);
  await renderer.attach(document);
  await renderer.setColors({ attributeString: "#ff0000", contentString: "#00ff00", attributeQuotes: "#0000ff", contentQuotes: "#ff00ff" });
  await rendered(workspace, document, "four independent rendered roles", [
    { needle: "attribute text", expected: "rgb(255, 0, 0)" },
    { needle: "content text", expected: "rgb(0, 255, 0)" },
    { needle: '"attribute text', length: 1, expected: "rgb(0, 0, 255)" },
    { needle: '"content text', length: 1, expected: "rgb(255, 0, 255)" },
    ...native.map((sample, i) => ({ ...sample, expected: before[i] })),
  ]);
  assert.equal(editor.document, document);
  await vscode.workspace.getConfiguration("editor").update("semanticHighlighting.enabled", false, vscode.ConfigurationTarget.Workspace);
  await rendered(workspace, document, "appearance also overrides TextMate with semantic tokens disabled", [
    { needle: "attribute text", expected: "rgb(255, 0, 0)" }, { needle: "content text", expected: "rgb(0, 255, 0)" },
  ]);
  renderer.dispose();
  renderer.dispose();
  await rendered(workspace, document, "disposal restores TextMate styling", [{ needle: "attribute text", expected: "rgb(17, 34, 51)" }]);
  await vscode.workspace.getConfiguration("editor").update("semanticHighlighting.enabled", true, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration("editor").update("semanticTokenColorCustomizations", undefined, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration("editor").update("tokenColorCustomizations", undefined, vscode.ConfigurationTarget.Workspace);
  console.log("ok - actual native editor colors: four independent roles, host/branding/bracket preservation, disposable renderer");
  await runEditor(workspace, extension.extensionPath);
}

async function runEditor(workspace: string, extensionPath: string): Promise<void> {
  const settingsPath = join(workspace, ".vscode/settings.json");
  const settings = await readFile(settingsPath, "utf8");
  await vscode.commands.executeCommand("hson.openAppearance");
  let state = await ui(workspace, { action: "inspect" });
  assert.match(state.status, /Viewing Draft.*House dark/);
  let scratch = vscode.window.visibleTextEditors.find(editor => editor.document.isUntitled && editor.document.languageId === "hson")!;
  assert.ok(scratch, "real native untitled document");
  assert.equal(scratch.viewColumn, vscode.ViewColumn.Two);
  const layout = await ui<{ x: number; y: number; width: number; height: number; controls: boolean; native: boolean }[]>(workspace, { action: "layout" });
  const left = layout.find(group => group.controls)!;
  assert.ok(left, JSON.stringify(layout));
  const right = layout.find(group => group.native && group.x > left.x)!;
  assert.ok(left && right && left.width >= 250 && right.width >= 350, JSON.stringify(layout));
  assert.ok(Math.abs(left.y - right.y) < 2 && left.x + left.width <= right.x + 2, "controls and editor side by side");
  const theme = JSON.parse(await readFile(join(extensionPath, "themes/hson-house-dark-color-theme.json"), "utf8"));
  const baseline = { attributeString: theme.semanticTokenColors.hsonString, contentString: theme.semanticTokenColors.hsonString,
    attributeQuotes: theme.semanticTokenColors.hsonQuote, contentQuotes: theme.semanticTokenColors.hsonQuote };
  const samples = [
    { needle: "Attribute text" }, { needle: "Content text" },
    { needle: '"Attribute text', length: 1 }, { needle: '"Content text', length: 1 },
  ];
  await rendered(workspace, scratch.document, "Saved baseline uses committed effective House colors", samples.map((sample, i) => ({ ...sample, expected: rgb(baseline[appearanceRoles[i]!]) })));
  const brackets = [{ needle: "<section", length: 1 }, { needle: "<h1", length: 1 }];
  const bracketColors = await rendered(workspace, scratch.document, "native standalone bracket colors", brackets);
  const colors = { attributeString: "#d01020", contentString: "#20d030", attributeQuotes: "#3050d0", contentQuotes: "#d040c0" };
  const started = Date.now();
  for (const role of appearanceRoles) await ui(workspace, { action: "input", control: role, value: colors[role] });
  await rendered(workspace, scratch.document, "actual input events immediately recolor four roles", samples.map((sample, i) => ({ ...sample, expected: rgb(colors[appearanceRoles[i]!]) })));
  await rendered(workspace, scratch.document, "closing quotes and native bracket ownership", [
    { needle: 'Attribute text"', offset: 14, length: 1, expected: rgb(colors.attributeQuotes) },
    { needle: 'Content text"', offset: 12, length: 1, expected: rgb(colors.contentQuotes) },
    ...brackets.map((sample, i) => ({ ...sample, expected: bracketColors[i] })),
  ]);
  const inputToRenderMs = Date.now() - started;
  await ui(workspace, { action: "screenshot", name: "appearance-draft" });

  await vscode.window.showTextDocument(scratch.document, vscode.ViewColumn.Two);
  const original = scratch.document.getText();
  // Native paste/edit, then retain selection and native undo through A/B.
  await scratch.edit(edit => edit.insert(new vscode.Position(0, 0), '// User edit 😀\n'));
  scratch.selection = new vscode.Selection(2, 3, 2, 15);
  const selection = scratch.selection;
  const version = scratch.document.version, edited = scratch.document.getText();
  await ui(workspace, { action: "click", control: "saved" });
  await rendered(workspace, scratch.document, "Saved A/B rendering", samples.map((sample, i) => ({ ...sample, expected: rgb(baseline[appearanceRoles[i]!]) })));
  state = await ui(workspace, { action: "inspect" });
  assert.equal(state.saved, "true");
  assert.deepEqual(state.draft, colors, "Saved view preserves unsaved draft values");
  await ui(workspace, { action: "click", control: "draft" });
  await rendered(workspace, scratch.document, "Draft A/B rendering", samples.map((sample, i) => ({ ...sample, expected: rgb(colors[appearanceRoles[i]!]) })));
  assert.equal(scratch.document.getText(), edited);
  assert.equal(scratch.document.version, version);
  assert.ok(scratch.selection.isEqual(selection), "selection survives A/B");
  await vscode.window.showTextDocument(scratch.document, vscode.ViewColumn.Two);
  await vscode.commands.executeCommand("workbench.action.focusSecondEditorGroup");
  console.log("Native undo focus", await ui(workspace, { action: "focus-editor" }));
  await pause();
  await vscode.commands.executeCommand("undo");
  for (let attempt = 0; attempt < 30 && scratch.document.version === version; attempt++) await pause();
  assert.equal(scratch.document.getText(), original, "native undo stack survives A/B");

  // Reclassify changed syntax, including when the same text switches ownership.
  const replacement = '<p title="pasted attribute" "pasted content"/>\n';
  await scratch.edit(edit => edit.replace(new vscode.Range(scratch.document.positionAt(0), scratch.document.positionAt(original.length)), replacement));
  await rendered(workspace, scratch.document, "arbitrary pasted Hson", [
    { needle: "pasted attribute", expected: rgb(colors.attributeString) }, { needle: "pasted content", expected: rgb(colors.contentString) },
  ]);
  await scratch.edit(edit => edit.delete(new vscode.Range(0, 3, 0, 9)));
  await rendered(workspace, scratch.document, "source edit changes attribute string to content string", [{ needle: "pasted attribute", expected: rgb(colors.contentString) }]);
  await scratch.edit(edit => edit.replace(new vscode.Range(scratch.document.positionAt(0), scratch.document.positionAt(scratch.document.getText().length)), original));

  // Native scrolling persists through appearance changes too.
  await scratch.edit(edit => edit.insert(scratch.document.positionAt(original.length), '\n'.repeat(80) + '<p "scroll target"/>'));
  const bottom = new vscode.Range(scratch.document.lineCount - 1, 0, scratch.document.lineCount - 1, 1);
  scratch.revealRange(bottom, vscode.TextEditorRevealType.AtTop);
  await pause();
  const visibleLine = scratch.visibleRanges[0]!.start.line;
  await ui(workspace, { action: "click", control: "saved" });
  await ui(workspace, { action: "click", control: "draft" });
  assert.equal(scratch.visibleRanges[0]!.start.line, visibleLine, "native scroll position survives A/B");
  scratch.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
  await pause();

  for (const role of appearanceRoles) await ui(workspace, { action: "input", control: role, value: "#0f141a" });
  await rendered(workspace, scratch.document, "identical background-colored draft is accepted", samples.map(sample => ({ ...sample, expected: "rgb(15, 20, 26)" })));
  await ui(workspace, { action: "click", control: "revert" });
  await rendered(workspace, scratch.document, "Revert Draft restores committed baseline", samples.map((sample, i) => ({ ...sample, expected: rgb(baseline[appearanceRoles[i]!]) })));
  assert.match((await ui(workspace, { action: "inspect" })).status, /No draft changes/);

  // Switching examples reuses the native documents; user edits remain.
  const retained = scratch.document.getText();
  await ui(workspace, { action: "click", control: "example-Data" });
  const data = vscode.window.visibleTextEditors.find(editor => editor.document.isUntitled && editor.document !== scratch.document)!;
  assert.ok(data?.document.getText().includes("Data content"));
  await ui(workspace, { action: "input", control: "contentString", value: "#21a2b3" });
  await rendered(workspace, data.document, "Data scratchpad uses same renderer", [{ needle: "Data content", expected: "rgb(33, 162, 179)" }]);
  await ui(workspace, { action: "click", control: "example-Document" });
  scratch = vscode.window.visibleTextEditors.find(editor => editor.document === scratch.document)!;
  assert.equal(scratch.document.getText(), retained);
  await rendered(workspace, scratch.document, "Document scratchpad retained on return", [{ needle: "Content text", expected: "rgb(33, 162, 179)" }]);

  await ui(workspace, { action: "click", control: "example-Interpolation" });
  const interpolation = vscode.window.visibleTextEditors.find(editor => editor.document.isUntitled && editor.document.languageId === "typescript")!;
  assert.ok(interpolation);
  await rendered(workspace, interpolation.document, "native interpolation scratchpad", [{ needle: "Content text", length: 12, expected: "rgb(33, 162, 179)" }]);
  await ui(workspace, { action: "click", control: "example-Document" });

  const panel = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.label === "Hson Appearance")!;
  assert.ok(panel);
  await vscode.window.tabGroups.close(panel);
  scratch = vscode.window.visibleTextEditors.find(editor => editor.document === scratch.document)!;
  await rendered(workspace, scratch.document, "closing panel disposes decorations", [{ needle: "Content text", expected: rgb(baseline.contentString) }]);
  await scratch.edit(edit => edit.insert(new vscode.Position(0, 0), '// After disposal\n'));
  await rendered(workspace, scratch.document, "disposed renderer never reapplies on edits", [{ needle: "Content text", expected: rgb(baseline.contentString) }]);
  await vscode.commands.executeCommand("hson.openAppearance");
  await rendered(workspace, scratch.document, "reopen retains session draft and edited scratchpad", [{ needle: "Content text", expected: "rgb(33, 162, 179)" }]);
  assert.equal(await readFile(settingsPath, "utf8"), settings, "preview never writes configuration");
  await verifyModes(workspace, extensionPath, scratch.document);
  const report = { vscodeVersion: vscode.version, layout, inputToRenderMs, tests: ["rendered controls", "native editable Document/Data", "independent four colors", "Saved/Draft", "text/version/selection/undo", "scroll", "source invalidation", "identical background colors", "revert", "disposal/reopen", "no settings writes"] };
  await writeFile(join(workspace, "appearance-report.json"), JSON.stringify(report, null, 2));
  console.log("ok - live appearance editor: " + JSON.stringify(report));
}

async function verifyModes(workspace: string, extensionPath: string, document: vscode.TextDocument): Promise<void> {
  await vscode.workspace.getConfiguration("workbench").update("colorTheme", "Hson House Light", vscode.ConfigurationTarget.Workspace);
  const light = JSON.parse(await readFile(join(extensionPath, "themes/hson-house-light-color-theme.json"), "utf8"));
  await rendered(workspace, document, "light mode uses its own committed House baseline", [{ needle: "Content text", expected: rgb(light.semanticTokenColors.hsonString) }]);
  assert.match((await ui(workspace, { action: "inspect" })).status, /House light.*No draft changes/);
  await ui(workspace, { action: "input", control: "contentString", value: "#abc" });
  await rendered(workspace, document, "light draft accepts shorthand hex", [{ needle: "Content text", expected: "rgb(170, 187, 204)" }]);
  await ui(workspace, { action: "click", control: "saved" });
  await rendered(workspace, document, "light Saved A/B", [{ needle: "Content text", expected: rgb(light.semanticTokenColors.hsonString) }]);
  await ui(workspace, { action: "click", control: "draft" });
  await ui(workspace, { action: "screenshot", name: "appearance-light" });
  await vscode.workspace.getConfiguration("workbench").update("colorTheme", "Default Dark Modern", vscode.ConfigurationTarget.Workspace);
  await rendered(workspace, document, "non-House theme retains dark draft", [{ needle: "Content text", expected: "rgb(33, 162, 179)" }]);
  assert.equal(vscode.workspace.getConfiguration("workbench").get("colorTheme"), "Default Dark Modern", "preview never replaces global theme");
  await ui(workspace, { action: "click", control: "saved" });
  const dark = JSON.parse(await readFile(join(extensionPath, "themes/hson-house-dark-color-theme.json"), "utf8"));
  await rendered(workspace, document, "Saved uses the same renderer under non-House theme", [{ needle: "Content text", expected: rgb(dark.semanticTokenColors.hsonString) }]);
  await ui(workspace, { action: "click", control: "draft" });
}
