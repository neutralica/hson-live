import assert from "node:assert/strict";
import { join } from "node:path";
import * as vscode from "vscode";

async function pause(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 100)); }

export async function run(): Promise<void> {
  const workspace = process.env.HSON_BASELINE_WORKSPACE!;
  const probe = process.env.HSON_BASELINE_PROBE === "1";
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "baseline.ts")));
  await vscode.window.showTextDocument(doc);
  const extension = vscode.extensions.getExtension("terminal-gothic.hson-language");
  assert.ok(extension);
  // Do not activate explicitly: exercise the installed activation event.
  for (let n = 0; n < 100 && !extension.isActive; n++) await pause();
  assert.equal(extension.isActive, true);
  assert.equal(vscode.workspace.isTrusted, process.env.HSON_BASELINE_RESTRICTED !== "1");
  const markerColors = extension.packageJSON.contributes.colors;
  assert.deepEqual(markerColors.map((color: { id: string }) => color.id), [
    "hson.libraryMarker.h", "hson.libraryMarker.s", "hson.libraryMarker.o", "hson.libraryMarker.n",
    "hson.authoringMarker.h", "hson.authoringMarker.s", "hson.authoringMarker.o", "hson.authoringMarker.n",
  ]);
  assert.ok(markerColors.every((color: { defaults: object }) =>
    ["dark", "light", "highContrast", "highContrastLight"].every(key => key in color.defaults)));
  const override = { "hson.libraryMarker.h": "#123456", "hson.authoringMarker.h": "#123456CC" };
  await vscode.workspace.getConfiguration("workbench").update("colorCustomizations", override, vscode.ConfigurationTarget.Global);
  assert.deepEqual(vscode.workspace.getConfiguration("workbench").get("colorCustomizations"), override);
  const syntax = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", doc.uri);
  const grammarHighlighted = JSON.stringify(syntax).includes("entity.name.type.hson");
  const semantic = await vscode.commands.executeCommand<vscode.SemanticTokens>("vscode.provideDocumentSemanticTokens", doc.uri);
  const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>("vscode.provideDocumentSemanticTokensLegend", doc.uri);
  const semanticHighlighted = !!semantic?.data.length && !!legend?.tokenTypes.some(type => type.startsWith("hson"));
  const diagnostics = () => vscode.languages.getDiagnostics(doc.uri).filter(d => d.source === "HSON");
  const edit = async (body: string) => {
    const text = doc.getText(), start = text.indexOf("HSON`") + 5, end = text.indexOf("`", start);
    const change = new vscode.WorkspaceEdit();
    change.replace(doc.uri, new vscode.Range(doc.positionAt(start), doc.positionAt(end)), body);
    assert.equal(await vscode.workspace.applyEdit(change), true);
  };
  const waitFor = async (count: number) => {
    for (let n = 0; n < 50 && diagnostics().length !== count; n++) await pause();
    return diagnostics().length;
  };
  assert.equal(diagnostics().length, 0);
  await edit("<thing !!!");
  const invalidCount = await waitFor(1);
  if (!probe) {
    assert.ok(grammarHighlighted || semanticHighlighted, "official HSON must receive grammar-backed highlighting");
    assert.equal(invalidCount, 1, "zero-Schema invalid HSON must be diagnosed");
  }
  await edit('\n <thing "readable" >\n');
  const correctedCount = await waitFor(0);
  assert.equal(correctedCount, 0);
  assert.equal(doc.isDirty, true, "correction is unsaved");
  await edit("+1");
  const republishedCount = await waitFor(1);
  if (!probe) assert.equal(republishedCount, 1);
  if (!probe) {
    const replace = async (text: string) => {
      const change = new vscode.WorkspaceEdit();
      change.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
      assert.equal(await vscode.workspace.applyEdit(change), true);
    };
    const hsonTokens = async () => {
      const values = await vscode.commands.executeCommand<vscode.SemanticTokens>("vscode.provideDocumentSemanticTokens", doc.uri);
      const types = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>("vscode.provideDocumentSemanticTokensLegend", doc.uri);
      const result: { text: string; start: number; end: number }[] = [];
      let line = 0, column = 0;
      for (let i = 0; values && i < values.data.length; i += 5) {
        const deltaLine = values.data[i]!; line += deltaLine;
        column = deltaLine ? values.data[i + 1]! : column + values.data[i + 1]!;
        if (!types?.tokenTypes[values.data[i+3]!]?.startsWith("hson")) continue;
        const start = doc.offsetAt(new vscode.Position(line, column)), end = start + values.data[i+2]!;
        result.push({ text: doc.getText().slice(start,end), start, end });
      }
      return result;
    };
    for (const [imported, tag, pkg] of [["HSON", "HSON", "hson-live/hson"], ["HSON", "HSON", "hson-live"], ["HSON as author", "author", "hson-live/hson"]]) {
      for (const body of ['<thing 1>', '<thing !!!', '<thing ${dangerous()} other 1>']) {
        await replace(`import { ${imported} } from "${pkg}"; const value=${tag}\`${body}\`;`);
        const tokens = await hsonTokens();
        assert.ok(tokens.some(token => token.text === 'thing'), `real HSON token: ${tag} ${body}`);
        const hole = doc.getText().indexOf('${'), end = doc.getText().indexOf('}',hole)+1;
        if (hole >= 0) assert.ok(tokens.every(token => token.end <= hole || token.start >= end));
      }
    }
    for (const text of ['const HSON=String.raw; HSON`<thing !!!`;',
      'import { HSON } from "other"; HSON`<thing !!!`;',
      'import { HSON } from "hson-live/hson"; function f(HSON:any){ HSON`<thing !!!`; }']) {
      await replace(text); assert.deepEqual(await hsonTokens(), [], 'unsupported binding must not keep stale HSON tokens');
      assert.equal(await waitFor(0),0);
    }
    console.log('ok - real baseline tokens: narrow/root/alias; valid/invalid/interpolated; expressions/local/wrong-package/shadow excluded; unsaved token refresh');
  }
  assert.equal(vscode.languages.getDiagnostics(doc.uri).filter(d => d.source === "HSON Schema").length, 0);
  await assert.rejects(Promise.resolve(vscode.workspace.fs.stat(vscode.Uri.file(join(workspace, "provider-executed")))));
  console.log("# HSON baseline " + JSON.stringify({ version: extension.packageJSON.version, extensionPath: extension.extensionPath,
    active: extension.isActive, trusted: vscode.workspace.isTrusted, grammarHighlighted, semanticHighlighted,
    invalidCount, correctedCount, republishedCount, providerExecuted: false }));
}
