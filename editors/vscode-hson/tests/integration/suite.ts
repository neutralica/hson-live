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

async function schemaEvidenceDiagnostics(uri: vscode.Uri, count: number): Promise<readonly vscode.Diagnostic[]> {
  const timeout = Date.now() + 5_000;
  while (Date.now() < timeout) {
    const diagnostics = vscode.languages.getDiagnostics(uri).filter(diagnostic => diagnostic.source === "Hson Schema" && String(diagnostic.code).startsWith("HSON_SCHEMA_GENERATED_EVIDENCE_"));
    if (diagnostics.length === count) return diagnostics;
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  return vscode.languages.getDiagnostics(uri).filter(diagnostic => diagnostic.source === "Hson Schema" && String(diagnostic.code).startsWith("HSON_SCHEMA_GENERATED_EVIDENCE_"));
}

async function waitFor(condition: () => boolean | Promise<boolean>, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await condition()) {
    if (Date.now() >= deadline) throw new Error(label);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function runSchemaConsumer(workspace: string): Promise<void> {
  const source = vscode.Uri.file(join(workspace, "src", "app", "state", "shell.schema.ts"));
  const artifact = vscode.Uri.file(join(workspace, "src", "app", "state", "shell.schema.DEMO_LIVEMAP_SCHEMA.hson-schema.generated.ts"));
  const metadata = vscode.Uri.file(join(workspace, "src", "app", "state", "shell.schema.DEMO_LIVEMAP_SCHEMA.hson-schema.generated.json"));
  const diagnosticProbe = vscode.Uri.file(join(workspace, "hson-schema-watch-diagnostic-probe.hson"));
  const read = async (uri: vscode.Uri): Promise<string> => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString();
  const write = async (uri: vscode.Uri, text: string): Promise<void> => vscode.workspace.fs.writeFile(uri, Buffer.from(text));
  const originalSource = await read(source);
  let leaveWatchForDisposal = false;
  try {
    await vscode.commands.executeCommand("hson.generateSchemaTypes", source);
    const schemaFiles = [
      "src/app/state/shell.schema.ts",
      "src/app/demos/cellsheet/cellsheet.state.ts",
      "src/app/demos/oklch/oklch.state.ts",
      "src/app/demos/towl/towl.schema.ts",
    ];
    for (const relativeFile of schemaFiles) {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, relativeFile)));
      assert.match(document.getText(), /HsonSchema<[^>]+, "data">/, `${relativeFile} is not in generated generic form`);
      assert.equal((await schemaEvidenceDiagnostics(document.uri, 0)).length, 0, `${relativeFile} evidence is not current`);
      const ref = document.getText().indexOf('<ref "');
      if (ref >= 0) {
        assert.ok((await localSchemaCompletions(document, ref + 6)).length > 0, `${relativeFile} generated generic declaration was not discovered for completion`);
        const hover = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, document.positionAt(ref + 6));
        assert.ok((hover?.length ?? 0) > 0, `${relativeFile} generated generic declaration was not discovered for hover`);
      }
      const typeMember = document.getText().indexOf('type "data"');
      assert.ok(typeMember >= 0);
      const invalidate = new vscode.WorkspaceEdit();
      invalidate.replace(document.uri, new vscode.Range(document.positionAt(typeMember), document.positionAt(typeMember + 4)), "thing");
      assert.equal(await vscode.workspace.applyEdit(invalidate), true);
      await waitFor(() => vscode.languages.getDiagnostics(document.uri).some(diagnostic => diagnostic.source === "Hson Schema" && diagnostic.code === "INVALID_ROOT"), `${relativeFile} generated generic declaration was not discovered for local diagnostics`);
      const restore = new vscode.WorkspaceEdit();
      restore.replace(document.uri, new vscode.Range(document.positionAt(typeMember), document.positionAt(typeMember + 5)), "type");
      assert.equal(await vscode.workspace.applyEdit(restore), true);
      await waitFor(() => !vscode.languages.getDiagnostics(document.uri).some(diagnostic => diagnostic.source === "Hson Schema" && diagnostic.code === "INVALID_ROOT"), `${relativeFile} local diagnostic did not clear after correction`);
      assert.equal(await document.save(), true);
    }
    const sourceDocument = await vscode.workspace.openTextDocument(source);
    await write(metadata, `${await read(metadata)}\n`);
    await waitFor(() => vscode.languages.getDiagnostics(sourceDocument.uri).some(diagnostic => diagnostic.code === "HSON_SCHEMA_GENERATED_EVIDENCE_STALE"), "pre-existing on-disk stale evidence was not diagnosed deterministically");
    await vscode.commands.executeCommand("hson.generateSchemaTypes", source);
    assert.equal((await schemaEvidenceDiagnostics(sourceDocument.uri, 0)).length, 0, "Generate did not clear stale evidence after authoritative reconciliation");
    const originalArtifact = await read(artifact);
    const originalMetadata = await read(metadata);
    const openArtifact = await vscode.workspace.openTextDocument(artifact);
    await vscode.commands.executeCommand("hson.startSchemaWatch", source);
    await vscode.commands.executeCommand("hson.startSchemaWatch", source);
    const validProbe = originalSource.replace('<exact "color-sudoku">', '<union [<exact "color-sudoku">, <exact "watch-probe">]>');
    assert.notEqual(validProbe, originalSource);
    await write(source, validProbe);
    await waitFor(async () => (await read(artifact)).includes("watch-probe") && openArtifact.getText().includes("watch-probe"), "extension watch did not refresh generated evidence in the open editor");
    const invalidProbe = validProbe.replace('<exact "watch-probe">]>', '<exact "watch-probe">]');
    await write(source, invalidProbe);
    await new Promise(resolve => setTimeout(resolve, 1_000));
    await write(source, originalSource);
    await waitFor(async () => await read(artifact) === originalArtifact && await read(metadata) === originalMetadata, "extension watch did not recover and restore current evidence");
    await vscode.commands.executeCommand("hson.stopSchemaWatch", source);
    await write(source, validProbe);
    await new Promise(resolve => setTimeout(resolve, 1_200));
    assert.equal(await read(artifact), originalArtifact, "Stop Schema Watch left an extension-owned watcher running");
    await write(source, originalSource);
    await vscode.commands.executeCommand("hson.generateSchemaTypes", source);
    await vscode.workspace.fs.writeFile(diagnosticProbe, Buffer.from("+1\n"));
    assert.equal((await diagnosticsFor(diagnosticProbe, 1)).length, 1, "ordinary Hson diagnostics stopped with Schema Watch");
    await vscode.commands.executeCommand("hson.checkSchemas", source);
    await vscode.workspace.fs.delete(diagnosticProbe);
    await vscode.commands.executeCommand("hson.startSchemaWatch", source);
    await new Promise(resolve => setTimeout(resolve, 1_000));
    leaveWatchForDisposal = true;
    process.stdout.write("ok - real hson-demo2 extension Generate/Watch/error/recovery/Stop/Check/disposal lifecycle and watch-independent diagnostics\n");
  } finally {
    if (!leaveWatchForDisposal) await vscode.commands.executeCommand("hson.stopSchemaWatch", source).then(undefined, () => undefined);
    await write(source, originalSource);
    if (!leaveWatchForDisposal) await vscode.commands.executeCommand("hson.generateSchemaTypes", source).then(undefined, () => undefined);
    await vscode.workspace.fs.delete(diagnosticProbe).then(undefined, () => undefined);
  }
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("terminal-gothic.hson-language");
  assert.ok(extension, "Hson extension was not discovered by the extension host");
  await extension.activate();
  const workspace = process.env.HSON_TEST_WORKSPACE;

  assert.ok(workspace);
  const commands = await vscode.commands.getCommands(true);
  for (const command of ["hson.startLocalHost", "hson.stopLocalHost", "hson.restartLocalHost", "hson.openLocalApp", "hson.showLocalHostOutput"]) {
    assert.ok(commands.includes(command), `${command} is registered`);
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const localHostConfiguration = vscode.workspace.getConfiguration("hson.localHost", folder.uri);
  await localHostConfiguration.update("entry", "dist/local-app.mjs", vscode.ConfigurationTarget.WorkspaceFolder);
  await localHostConfiguration.update("applicationExport", "application", vscode.ConfigurationTarget.WorkspaceFolder);
  await localHostConfiguration.update("nodeExecutable", process.env.HSON_TEST_NODE_EXECUTABLE ?? "node", vscode.ConfigurationTarget.WorkspaceFolder);
  await localHostConfiguration.update("port", 0, vscode.ConfigurationTarget.WorkspaceFolder);
  const lifecycleUri = vscode.Uri.file(join(workspace, "local-host-lifecycle.txt"));
  const lifecycle = async (): Promise<string[]> => {
    try { return Buffer.from(await vscode.workspace.fs.readFile(lifecycleUri)).toString().trim().split("\n").filter(Boolean); }
    catch { return []; }
  };
  if (process.env.HSON_SCHEMA_CONSUMER_TEST === "1") {
    await runSchemaConsumer(workspace);
    return;
  }
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
    const before = await lifecycle();
    await vscode.commands.executeCommand("hson.startLocalHost", folder.uri);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(await lifecycle(), before, "Restricted Mode did not execute the configured local application");
    process.stdout.write("ok - real VS Code local-host command is gated by Workspace Trust\n");
    const source = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "static-syntax.ts")));
    await vscode.window.showTextDocument(source);
    const diagnostics = await diagnosticsFor(source.uri, 1);
    assert.equal(source.getText(diagnostics[0]?.range), "\\x2b");
    process.stdout.write("ok - real VS Code Restricted Mode: secure static fromHson syntax diagnostics remain active without trust\n");
    return;
  }

  const structuralUri = vscode.Uri.file(join(workspace, "hson-structural-editing.ts"));
  const markdownStructuralUri = vscode.Uri.file(join(workspace, "hson-structural-editing.md"));
  try {
    await vscode.workspace.fs.writeFile(structuralUri, Buffer.from('import { Hson } from "hson-live/hson";\nconst host =  1;\nconst inline=Hson`<solo/>`;\nconst page=Hson`\n <main\n<section\n/>\n />\n`;\n'));
    const structural = await vscode.workspace.openTextDocument(structuralUri);
    const structuralEditor = await vscode.window.showTextDocument(structural);
    await vscode.commands.executeCommand("typescript.restartTsServer");
    const replaceMarked = async (marked: string): Promise<Readonly<{ clean: string; offset: number; indentation: string }>> => {
      const offset = marked.indexOf("|");
      assert.ok(offset >= 0, `missing cursor marker: ${marked}`);
      const clean = marked.slice(0, offset) + marked.slice(offset + 1);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(structural.uri, new vscode.Range(structural.positionAt(0), structural.positionAt(structural.getText().length)), clean);
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      structuralEditor.selection = new vscode.Selection(structural.positionAt(offset), structural.positionAt(offset));
      const currentLineStart = clean.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
      const currentLineEnd = clean.indexOf("\n", offset);
      const line = clean.slice(currentLineStart, currentLineEnd === -1 ? clean.length : currentLineEnd);
      return { clean, offset, indentation: /^[ \t]*/.exec(line)?.[0] ?? "" };
    };
    const ordinaryEnter = async (label: string, marked: string): Promise<void> => {
      const before = await replaceMarked(marked);
      await vscode.commands.executeCommand("hson.insertLineBreak");
      const expected = before.clean.slice(0, before.offset) + "\n" + before.indentation + before.clean.slice(before.offset);
      assert.equal(structural.getText(), expected, `${label} retained ordinary Enter editing`);
    };
    const typeOffset = structural.getText().indexOf("/>", structural.getText().indexOf("<section"));
    structuralEditor.selection = new vscode.Selection(structural.positionAt(typeOffset), structural.positionAt(typeOffset));
    await vscode.commands.executeCommand("type", { text: "<" });
    assert.ok(structural.getText().includes("<section\n</>"), "real typing inserted a nested document pair");
    await vscode.commands.executeCommand("hson.deleteLeft");
    assert.equal(structural.getText().includes("<section\n</>"), false, "backspace removed the generated structural pair");
    const inlineClose = structural.getText().indexOf("/>", structural.getText().indexOf("<solo"));
    structuralEditor.selection = new vscode.Selection(structural.positionAt(inlineClose), structural.positionAt(inlineClose));
    await vscode.commands.executeCommand("hson.insertLineBreak");
    assert.ok(structural.getText().includes("\n    \n/>"), `real Enter honored the editor indentation and dedented the closer: ${JSON.stringify(structural.getText())}`);
    await vscode.commands.executeCommand("undo");

    const hostPrefix = 'import { Hson } from "hson-live/hson";\n';
    await ordinaryEnter("incomplete Hson", hostPrefix + 'const x=Hson`<data 1|`;');
    await ordinaryEnter("parser-invalid Hson", hostPrefix + 'const x=Hson`<data 1\n  <data2 2|>\n>`;');
    await ordinaryEnter("tokenizer-invalid Hson", hostPrefix + 'const x=Hson`<a "bad\\q"|>`;');
    await ordinaryEnter("delimiter-deleted Hson", hostPrefix + 'const x=Hson`<main <child/>|`;');
    await ordinaryEnter("Hson string", hostPrefix + 'const x=Hson`<a "te|xt">`;');
    await ordinaryEnter("Hson comment", hostPrefix + 'const x=Hson`<a 1 // no|te\nb 2>`;');
    await ordinaryEnter("Hson interpolation", hostPrefix + 'const value=1; const x=Hson`<a ${val|ue}>`;');
    await ordinaryEnter("ordinary TypeScript", 'const ordinary = 1;|');

    await replaceMarked(hostPrefix + 'const x=Hson`<main|/>`;');
    await vscode.commands.executeCommand("hson.insertLineBreak");
    assert.ok(structural.getText().includes("<main\n    \n/>"), "valid Hson receives smart Enter");
    await ordinaryEnter("invalid phase of valid-invalid-valid recovery", hostPrefix + 'const x=Hson`<data 1\n  <data2 2|>\n>`;');
    await replaceMarked(hostPrefix + 'const x=Hson`<main|/>`;');
    await vscode.commands.executeCommand("hson.insertLineBreak");
    assert.ok(structural.getText().includes("<main\n    \n/>"), "smart Enter resumes after Hson repair");

    await replaceMarked('const ordinary = 12|;');
    await vscode.commands.executeCommand("hson.deleteLeft");
    assert.equal(structural.getText(), "const ordinary = 1;", "non-pair Backspace fallback remains usable outside Hson");

    await replaceMarked(hostPrefix + 'const x=Hson`<data 1|>`;');
    await vscode.commands.executeCommand("hson.insertLineBreak");
    await vscode.commands.executeCommand("type", { text: "data2 2" });
    await vscode.commands.executeCommand("hson.insertLineBreak");
    await vscode.commands.executeCommand("type", { text: "data3 " });
    await vscode.commands.executeCommand("type", { text: "<" });
    await vscode.commands.executeCommand("hson.insertLineBreak");
    await vscode.commands.executeCommand("type", { text: "data4 4" });
    await vscode.commands.executeCommand("hson.insertLineBreak");
    await vscode.commands.executeCommand("type", { text: "data5 5" });
    const authoredLines = structural.getText().split("\n");
    const authoredDump = JSON.stringify(structural.getText());
    assert.match(authoredLines.find(line => line.includes("data2")) ?? "", /^ {4}data2 2/, authoredDump);
    assert.match(authoredLines.find(line => line.includes("data3")) ?? "", /^ {4}data3 </, authoredDump);
    assert.match(authoredLines.find(line => line.includes("data4")) ?? "", /^ {8}data4 4/, authoredDump);
    assert.match(authoredLines.find(line => line.includes("data5")) ?? "", /^ {8}data5 5/, authoredDump);

    await replaceMarked('import { Hson } from "hson-live/hson";\nconst host =  1;\nconst inline=Hson`<solo/>`;\nconst page=Hson`\n <main\n<section\n/>\n />\n`;\n|');
    await vscode.commands.executeCommand("hson.deleteLeft");
    await vscode.commands.executeCommand("hson.formatDocument");
    assert.ok(structural.getText().includes("const host = 1;"), "Hson Format Document retained normal TypeScript formatting");
    assert.ok(structural.getText().includes("\n<main\n    <section\n    />\n/>"), `Hson Format Document composed Hson indentation edits: ${JSON.stringify(structural.getText())}`);

    await vscode.workspace.fs.writeFile(markdownStructuralUri, Buffer.from("Before\n```hson\n <main\n<section\n/>\n />\n```\nAfter\n"));
    const markdownStructural = await vscode.workspace.openTextDocument(markdownStructuralUri);
    const markdownEdits = await vscode.commands.executeCommand<vscode.TextEdit[]>("vscode.executeFormatDocumentProvider", markdownStructural.uri, { insertSpaces: true, tabSize: 2 });
    const markdownEdit = new vscode.WorkspaceEdit();
    for (const edit of markdownEdits ?? []) markdownEdit.replace(markdownStructural.uri, edit.range, edit.newText);
    assert.equal(await vscode.workspace.applyEdit(markdownEdit), true);
    assert.ok(markdownStructural.getText().includes("```hson\n<main\n  <section\n  />\n/>\n```"), "Markdown format document used the shared Hson formatter");
    process.stdout.write("ok - real VS Code structural editing: valid/incomplete/parser-invalid/tokenizer-invalid/delimiter/string/comment/interpolation/outside Enter fallback; valid-invalid-valid recovery; pair and ordinary Backspace; formatting\n");
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.workspace.fs.delete(structuralUri).then(undefined, () => undefined);
    await vscode.workspace.fs.delete(markdownStructuralUri).then(undefined, () => undefined);
  }

  await vscode.commands.executeCommand("hson.startLocalHost", folder.uri);
  assert.deepEqual(await lifecycle(), ["start"]);
  await vscode.commands.executeCommand("hson.startLocalHost", folder.uri);
  assert.deepEqual(await lifecycle(), ["start"], "duplicate start did not create another child");
  await vscode.commands.executeCommand("hson.restartLocalHost", folder.uri);
  assert.deepEqual(await lifecycle(), ["start", "stop", "start"]);
  await vscode.commands.executeCommand("hson.stopLocalHost", folder.uri);
  await vscode.commands.executeCommand("hson.stopLocalHost", folder.uri);
  assert.deepEqual(await lifecycle(), ["start", "stop", "start", "stop"]);
  process.stdout.write("ok - real VS Code local-host commands start, deduplicate, restart fresh, and stop idempotently\n");

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

  const generatedSchemaDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "declarative-schema", "schema.ts")));
  await vscode.window.showTextDocument(generatedSchemaDocument);
  assert.match(generatedSchemaDocument.getText(), /HsonSchema<UserSchemaType, "data">/);
  const generatedAgeDefinition = generatedSchemaDocument.getText().indexOf('Age "number"');
  const generatedAgeReference = generatedSchemaDocument.getText().indexOf('ref "Age"') + 5;
  assert.deepEqual((await localSchemaCompletions(generatedSchemaDocument, generatedAgeReference)).map(item => item.label), ["Age", "User"]);
  const generatedDefinitions = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', generatedSchemaDocument.uri, generatedSchemaDocument.positionAt(generatedAgeReference));
  assert.equal(generatedSchemaDocument.getText(generatedDefinitions?.[0]?.range), "Age");
  const generatedReferences = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', generatedSchemaDocument.uri, generatedSchemaDocument.positionAt(generatedAgeDefinition));
  assert.equal(generatedReferences?.filter(location => generatedSchemaDocument.getText(location.range) === '"Age"').length, 1);
  const generatedHover = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', generatedSchemaDocument.uri, generatedSchemaDocument.positionAt(generatedAgeReference));
  assert.ok((generatedHover?.length ?? 0) > 0);
  const generatedRename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', generatedSchemaDocument.uri, generatedSchemaDocument.positionAt(generatedAgeDefinition), "Years");
  assert.ok(generatedRename);
  process.stdout.write("ok - real VS Code generated HsonSchema generic remains discoverable for completion, definition, references, rename, and hover without reload\n");

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

  await vscode.commands.executeCommand("hson.startLocalHost", folder.uri);
  await waitFor(async () => (await lifecycle()).at(-1) === "start", "local host did not start for extension deactivation coverage");
  process.stdout.write("ok - real VS Code local host left running for extension deactivation cleanup\n");

}
