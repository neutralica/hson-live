import assert from "node:assert/strict";
import { join } from "node:path";

import * as vscode from "vscode";

async function diagnosticsFor(
  uri: vscode.Uri,
  count: number,
): Promise<readonly vscode.Diagnostic[]> {
  const timeout = Date.now() + 5_000;
  while (Date.now() < timeout) {
    const diagnostics = vscode.languages.getDiagnostics(uri)
      .filter((diagnostic) => diagnostic.source === "HSON");
    if (diagnostics.length === count) return diagnostics;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return vscode.languages.getDiagnostics(uri)
    .filter((diagnostic) => diagnostic.source === "HSON");
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("terminal-gothic.hson-language");
  assert.ok(extension, "HSON extension was not discovered by the extension host");
  await extension.activate();

  const standalone = await vscode.workspace.openTextDocument({ language: "hson", content: "+1" });
  await vscode.window.showTextDocument(standalone);
  const standaloneDiagnostics = await diagnosticsFor(standalone.uri, 1);
  assert.equal(standaloneDiagnostics.length, 1);
  assert.equal(standaloneDiagnostics[0]?.source, "HSON");
  assert.equal(standaloneDiagnostics[0]?.range.start.character, 0);

  const fixturePath = join(__dirname, "..", "tests", "fixtures", "diagnostics-alias.ts");
  const alias = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath));
  await vscode.window.showTextDocument(alias);
  const aliasDiagnostics = await diagnosticsFor(alias.uri, 1);
  assert.equal(aliasDiagnostics.length, 1);
  assert.equal(alias.getText(aliasDiagnostics[0]?.range), "+");

  const smokePath = join(__dirname, "..", "tests", "fixtures", "diagnostics-smoke.ts");
  const smoke = await vscode.workspace.openTextDocument(vscode.Uri.file(smokePath));
  assert.equal(smoke.languageId, "typescript");
  assert.equal(smoke.uri.scheme, "file");
  assert.equal(smoke.fileName, smokePath);
  await vscode.window.showTextDocument(smoke);
  const smokeDiagnostics = await diagnosticsFor(smoke.uri, 1);
  assert.equal(smokeDiagnostics.length, 1);
  assert.ok(smokeDiagnostics[0]
    && smokeDiagnostics[0].range.start.line >= 8
    && smokeDiagnostics[0].range.end.line <= 10);

  const workspace = process.env.HSON_D2_TEST_WORKSPACE;
  const hsonModule = process.env.HSON_D2_TEST_HSON;
  assert.ok(workspace && hsonModule);
  const user = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "user.ts")));
  await vscode.window.showTextDocument(user);
  const schemaDiagnostics = () => vscode.languages.getDiagnostics(user.uri).filter(d => d.source === "HSON Schema");
  assert.equal(schemaDiagnostics().length, 0, "trusted diagnostics default off");
  assert.equal(vscode.workspace.isTrusted, true);
  const config = vscode.workspace.getConfiguration("hson.trustedSchemaDiagnostics", user.uri);
  await config.update("module", "trusted-schema.mjs", vscode.ConfigurationTarget.Workspace);
  await config.update("hsonModule", hsonModule, vscode.ConfigurationTarget.Workspace);
  await config.update("enabled", true, vscode.ConfigurationTarget.Workspace);
  const waitSchema = async (count: number): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (schemaDiagnostics().length !== count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(schemaDiagnostics().length, count, "D2 Schema diagnostic count");
  };
  await waitSchema(1);
  const diagnostic = schemaDiagnostics()[0]!;
  assert.equal(user.getText(diagnostic.range), '"37"');
  assert.match(diagnostic.message, /Expected `age` to be a number, but this value is an HSON string/);
  assert.match(user.getText(diagnostic.relatedInformation?.[0]?.location.range), /validate/);
  const edits = new vscode.WorkspaceEdit(); edits.replace(user.uri, diagnostic.range, "37");
  await vscode.workspace.applyEdit(edits);
  assert.equal(user.isDirty, true, "candidate remains unsaved");
  await waitSchema(0);
  // Restore invalid candidate, prove revalidation, then disable and clear.
  const index = user.getText().indexOf("age 37") + 4;
  const restore = new vscode.WorkspaceEdit(); restore.replace(user.uri, new vscode.Range(user.positionAt(index), user.positionAt(index + 2)), '"37"');
  await vscode.workspace.applyEdit(restore);
  await waitSchema(1);
  await config.update("enabled", false, vscode.ConfigurationTarget.Workspace);
  await waitSchema(0);
  process.stdout.write("ok - real VS Code D2: default off, enabled exact diagnostic, unsaved correction, revalidation, disable clearing\n");
}
