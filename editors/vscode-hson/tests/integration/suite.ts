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

  if (process.env.HSON_D4_RESTRICTED === "1") {
    assert.equal(vscode.workspace.isTrusted, false, "restricted integration workspace must remain untrusted");
    const workspace = process.env.HSON_D2_TEST_WORKSPACE;
    assert.ok(workspace);
    const source = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "static-syntax.ts")));
    await vscode.window.showTextDocument(source);
    const diagnostics = await diagnosticsFor(source.uri, 1);
    assert.equal(source.getText(diagnostics[0]?.range), "\\x2b");
    process.stdout.write("ok - real VS Code D4 Restricted Mode: secure static fromHson syntax diagnostics remain active without trust\n");
    return;
  }

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
  const mapUser = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "map-user.ts")));
  await vscode.window.showTextDocument(mapUser);
  const mapDiagnostics = () => vscode.languages.getDiagnostics(mapUser.uri).filter(d => d.source === "HSON Schema");
  const waitMap = async (count: number): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (mapDiagnostics().length !== count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(mapDiagnostics().length, count, "D3 Schema diagnostic count");
  };
  assert.equal(mapDiagnostics().length, 0);
  await config.update("enabled", true, vscode.ConfigurationTarget.Workspace);
  await waitMap(1);
  assert.doesNotMatch(mapUser.getText(), /schema\.validate/);
  const mapDiagnostic = mapDiagnostics()[0]!;
  assert.equal(mapUser.getText(mapDiagnostic.range), '"37"');
  assert.match(mapUser.getText(mapDiagnostic.relatedInformation?.[0]?.location.range), /map.schema.use/);
  const correction = new vscode.WorkspaceEdit(); correction.replace(mapUser.uri, mapDiagnostic.range, "37");
  await vscode.workspace.applyEdit(correction);
  await waitMap(0);
  const original = mapUser.getText();
  const bad = new vscode.WorkspaceEdit(); bad.replace(mapUser.uri, new vscode.Range(mapUser.positionAt(0), mapUser.positionAt(original.length)), original.replace('age 37', 'age "37"'));
  await vscode.workspace.applyEdit(bad);
  await waitMap(1);
  await config.update("enabled", false, vscode.ConfigurationTarget.Workspace);
  await waitMap(0);
  process.stdout.write("ok - real VS Code D3: dedicated facade, rejected attachment exact diagnostic, related use site, unsaved correction, revalidation, disable clearing\n");

  const staticSyntax = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "static-syntax.ts")));
  await vscode.window.showTextDocument(staticSyntax);
  const staticSyntaxDiagnostics = await diagnosticsFor(staticSyntax.uri, 1);
  assert.equal(staticSyntax.getText(staticSyntaxDiagnostics[0]?.range), "\\x2b");
  const syntaxBodyStart = staticSyntax.getText().indexOf("\\x2b1");
  const syntaxFix = new vscode.WorkspaceEdit(); syntaxFix.replace(staticSyntax.uri,
    new vscode.Range(staticSyntax.positionAt(syntaxBodyStart), staticSyntax.positionAt(syntaxBodyStart + "\\x2b1".length)), "<a/>");
  await vscode.workspace.applyEdit(syntaxFix);
  assert.equal((await diagnosticsFor(staticSyntax.uri, 0)).length, 0);
  process.stdout.write("ok - real VS Code D4 secure syntax: escaped Transform literal exact range and unsaved correction clearing\n");

  const staticMap = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "static-map-user.ts")));
  await vscode.window.showTextDocument(staticMap);
  const staticSchemaDiagnostics = () => vscode.languages.getDiagnostics(staticMap.uri).filter(d => d.source === "HSON Schema");
  await config.update("enabled", true, vscode.ConfigurationTarget.Workspace);
  const staticDeadline = Date.now() + 10_000;
  while (staticSchemaDiagnostics().length !== 1 && Date.now() < staticDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(staticSchemaDiagnostics().length, 1);
  assert.equal(staticMap.getText(staticSchemaDiagnostics()[0]!.range), "\\x2237\\x22");
  const staticMutated = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "static-mutated.ts")));
  await vscode.window.showTextDocument(staticMutated);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(vscode.languages.getDiagnostics(staticMutated.uri).filter(d => d.source === "HSON Schema").length, 0);
  await config.update("enabled", false, vscode.ConfigurationTarget.Workspace);
  process.stdout.write("ok - real VS Code D4 trusted Schema: static escaped literal exact diagnostic and mutation suppression\n");

}
