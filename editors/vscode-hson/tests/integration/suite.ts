import assert from "node:assert/strict";
import { join } from "node:path";

import * as vscode from "vscode";

async function localSchemaCompletions(document: vscode.TextDocument, offset: number): Promise<vscode.CompletionItem[]> {
  const result = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset));
  return result?.items.filter(item => item.detail === 'Hson Schema definition') ?? [];
}

async function diagnosticsFor(
  uri: vscode.Uri,
  count: number,
): Promise<readonly vscode.Diagnostic[]> {
  const timeout = Date.now() + 5_000;
  while (Date.now() < timeout) {
    const diagnostics = vscode.languages.getDiagnostics(uri)
      .filter((diagnostic) => diagnostic.source === "Hson");
    if (diagnostics.length === count) return diagnostics;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return vscode.languages.getDiagnostics(uri)
    .filter((diagnostic) => diagnostic.source === "Hson");
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("terminal-gothic.hson-language");
  assert.ok(extension, "Hson extension was not discovered by the extension host");
  await extension.activate();
  const workspace = process.env.HSON_TEST_WORKSPACE;

  assert.ok(workspace);
  const unopenedTypeScript = vscode.Uri.file(join(workspace, "static-project", "unopened-invalid.ts"));
  const unopenedStandalone = vscode.Uri.file(join(workspace, "unopened-invalid.hson"));
  const pragmaStandalone = vscode.Uri.file(join(workspace, "pragma-invalid.hson"));
  assert.equal((await diagnosticsFor(unopenedTypeScript, 1)).length, 1, "startup diagnoses unopened configured TypeScript");
  assert.equal((await diagnosticsFor(unopenedStandalone, 1)).length, 1, "startup diagnoses unopened standalone Hson");
  assert.equal(vscode.languages.getDiagnostics(pragmaStandalone).filter(diagnostic => diagnostic.source === "Hson").length, 0, "startup suppresses pragma-marked unopened standalone Hson");
  assert.equal(vscode.workspace.textDocuments.some(document => document.uri.toString() === unopenedTypeScript.toString()), false);
  assert.equal(vscode.workspace.textDocuments.some(document => document.uri.toString() === unopenedStandalone.toString()), false);
  process.stdout.write("ok - real VS Code workspace diagnostics: unopened TS and Hson appear at startup with Schema Watch off\n");

  if (process.env.HSON_RESTRICTED_TEST === "1") {
    assert.equal(vscode.workspace.isTrusted, false, "restricted integration workspace must remain untrusted");
    const source = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "static-syntax.ts")));
    await vscode.window.showTextDocument(source);
    const diagnostics = await diagnosticsFor(source.uri, 1);
    assert.equal(source.getText(diagnostics[0]?.range), "\\x2b");
    process.stdout.write("ok - real VS Code Restricted Mode: secure static fromHson syntax diagnostics remain active without trust\n");
    return;
  }

  const standalone = await vscode.workspace.openTextDocument({ language: "hson", content: "+1" });
  await vscode.window.showTextDocument(standalone);
  const standaloneDiagnostics = await diagnosticsFor(standalone.uri, 1);
  assert.equal(standaloneDiagnostics.length, 1);
  assert.equal(standaloneDiagnostics[0]?.source, "Hson");
  assert.equal(standaloneDiagnostics[0]?.range.start.character, 0);

  const pragma = await vscode.workspace.openTextDocument(pragmaStandalone);
  await vscode.window.showTextDocument(pragma);
  assert.equal((await diagnosticsFor(pragma.uri, 0)).length, 0, "open pragma-marked document remains suppressed");
  const removePragma = new vscode.WorkspaceEdit();
  removePragma.delete(pragma.uri, new vscode.Range(pragma.positionAt(0), pragma.positionAt(pragma.getText().indexOf("\n") + 1)));
  assert.equal(await vscode.workspace.applyEdit(removePragma), true);
  assert.equal((await diagnosticsFor(pragma.uri, 1)).length, 1, "removing pragma restores ordinary diagnostics");
  const restorePragma = new vscode.WorkspaceEdit();
  restorePragma.insert(pragma.uri, pragma.positionAt(0), "// @hson-diagnostics-ignore-file\n");
  assert.equal(await vscode.workspace.applyEdit(restorePragma), true);
  assert.equal((await diagnosticsFor(pragma.uri, 0)).length, 0, "restoring pragma clears ordinary diagnostics");
  assert.equal(await pragma.save(), true);
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  const reopenedPragma = await vscode.workspace.openTextDocument(pragmaStandalone);
  await vscode.window.showTextDocument(reopenedPragma);
  assert.equal((await diagnosticsFor(reopenedPragma.uri, 0)).length, 0, "closing and reopening does not resurrect diagnostics");
  process.stdout.write("ok - real VS Code diagnostic-ignore-file: unopened, open, edited, closed, and reopened lifecycle\n");

  const symbolDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "schema-symbols.ts")));
  await vscode.window.showTextDocument(symbolDocument);
  const ageDefinition = symbolDocument.getText().indexOf('Age <number');
  const ageReference = symbolDocument.getText().indexOf('"Age"') + 2;
  assert.deepEqual((await localSchemaCompletions(symbolDocument, ageReference)).map(item => item.label), ["Age", "User"]);
  const definitions = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', symbolDocument.uri, symbolDocument.positionAt(ageReference));
  assert.equal(symbolDocument.getText(definitions?.[0]?.range), "Age");
  const references = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', symbolDocument.uri, symbolDocument.positionAt(ageDefinition));
  assert.equal(references?.filter(location => symbolDocument.getText(location.range) === '"Age"').length, 1);
  const hover = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', symbolDocument.uri, symbolDocument.positionAt(ageReference));
  const hoverContent = hover?.[0]?.contents[0];
  assert.ok(hoverContent instanceof vscode.MarkdownString);
  assert.match(hoverContent.value, /Age/);
  const rename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', symbolDocument.uri, symbolDocument.positionAt(ageDefinition), "Years");
  assert.ok(rename);
  assert.equal(await vscode.workspace.applyEdit(rename), true);
  assert.match(symbolDocument.getText(), /Years <number/);
  assert.match(symbolDocument.getText(), /<ref "Years">/);
  assert.match(symbolDocument.getText(), /const ordinary = "Age"/);
  const generated = vscode.Uri.file(join(workspace, "schema-symbols.SymbolSchema.hson-schema.generated.ts"));
  assert.equal(Buffer.from(await vscode.workspace.fs.readFile(generated)).toString(), "export {};\n");
  process.stdout.write("ok - real VS Code Schema defs/ref: completion, definition, references, rename, hover, and generated source remains untouched\n");

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

  const staticSyntax = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "static-syntax.ts")));
  await vscode.window.showTextDocument(staticSyntax);
  const staticSyntaxDiagnostics = await diagnosticsFor(staticSyntax.uri, 1);
  assert.equal(staticSyntax.getText(staticSyntaxDiagnostics[0]?.range), "\\x2b");
  const syntaxBodyStart = staticSyntax.getText().indexOf("\\x2b1");
  const syntaxFix = new vscode.WorkspaceEdit(); syntaxFix.replace(staticSyntax.uri,
    new vscode.Range(staticSyntax.positionAt(syntaxBodyStart), staticSyntax.positionAt(syntaxBodyStart + "\\x2b1".length)), "<a/>");
  await vscode.workspace.applyEdit(syntaxFix);
  assert.equal((await diagnosticsFor(staticSyntax.uri, 0)).length, 0);
  process.stdout.write("ok - real VS Code secure syntax: escaped Transform literal exact range and unsaved correction clearing\n");

  const declarativePath = join(workspace, "declarative-schema", "candidate.ts");
  const declarative = await vscode.workspace.openTextDocument(vscode.Uri.file(declarativePath));
  await vscode.window.showTextDocument(declarative);
  await vscode.commands.executeCommand("typescript.restartTsServer");
  const associationDiagnostics = () => vscode.languages.getDiagnostics(declarative.uri)
    .filter(diagnostic => diagnostic.source === "ts" && diagnostic.code === 2322);
  const waitAssociationDiagnostics = async (count: number): Promise<readonly vscode.Diagnostic[]> => {
    const deadline = Date.now() + 10_000;
    while (associationDiagnostics().length !== count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(associationDiagnostics().length, count, `declarative Schema association diagnostics: ${JSON.stringify(associationDiagnostics().map(diagnostic => diagnostic.message))}`);
    return associationDiagnostics();
  };
  const invalidAssociation = (await waitAssociationDiagnostics(1))[0]!;
  assert.match(invalidAssociation.message, /UserSchemaHson/);
  const invalidValue = declarative.getText().indexOf('"37"');
  assert.ok(invalidValue >= 0);
  const correct = new vscode.WorkspaceEdit();
  correct.replace(declarative.uri, new vscode.Range(declarative.positionAt(invalidValue), declarative.positionAt(invalidValue + 4)), "37");
  assert.equal(await vscode.workspace.applyEdit(correct), true);
  assert.equal(declarative.isDirty, true, "declarative candidate correction remains unsaved");
  await vscode.commands.executeCommand("typescript.restartTsServer");
  await waitAssociationDiagnostics(0);
  process.stdout.write("ok - real VS Code declarative HsonSchema: fresh generated association diagnoses invalid Hson and clears after unsaved correction\n");

}
