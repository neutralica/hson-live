import assert from "node:assert/strict";
import { join } from "node:path";

import * as vscode from "vscode";

async function localSchemaCompletions(document: vscode.TextDocument, offset: number): Promise<vscode.CompletionItem[]> {
  const result = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset), undefined, 100);
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

async function waitFor(condition: () => boolean | Promise<boolean>, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await condition()) {
    if (Date.now() >= deadline) throw new Error(label);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function runSchemaConsumer(workspace: string): Promise<void> {
  const source = vscode.Uri.file(join(workspace, "src", "app", "state", "shell.schema.ts"));
  const artifact = vscode.Uri.file(join(workspace, ".hson", "compiler-input", "tsconfig.json", "evidence", "src", "app", "state", "shell.schema.ts", "DEMO_LIVEMAP_SCHEMA.hson-schema.generated.ts"));
  const metadata = vscode.Uri.file(join(workspace, ".hson", "compiler-input", "tsconfig.json", "evidence", "src", "app", "state", "shell.schema.ts", "DEMO_LIVEMAP_SCHEMA.hson-schema.generated.json"));
  const diagnosticProbe = vscode.Uri.file(join(workspace, "hson-schema-watch-diagnostic-probe.hson"));
  const read = async (uri: vscode.Uri): Promise<string> => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString();
  const write = async (uri: vscode.Uri, text: string): Promise<void> => vscode.workspace.fs.writeFile(uri, Buffer.from(text));
  const originalSource = await read(source);
  const initialDocument = await vscode.workspace.openTextDocument(source);
  assert.match(initialDocument.getText(), /Hson\.schema/, "Editor opened authored Schema source");
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
      assert.match(document.getText(), /Hson.schema/, `${relativeFile} remains authored Schema source`);
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
    assert.equal(sourceDocument.getText(), originalSource, "Generate changed authored source");
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

async function runProtectedSourceFormatting(workspace: string): Promise<void> {
  const uri = vscode.Uri.file(join(workspace, 'protected-formatting.ts'));
  const settings = [
    { section: 'editor', key: 'formatOnSave', value: false },
    { section: 'typescript.format', key: 'enable', value: false },
    { section: 'hson.formatting', key: 'formatOnSave', value: true },
    { section: 'files', key: 'trimTrailingWhitespace', value: false },
    { section: 'files', key: 'insertFinalNewline', value: false },
  ].map(setting => ({ ...setting, previous: vscode.workspace.getConfiguration(setting.section, uri).inspect(setting.key)?.workspaceValue }));
  try {
    for (const setting of settings) await vscode.workspace.getConfiguration(setting.section, uri).update(setting.key, setting.value, vscode.ConfigurationTarget.Workspace);
    for (const eol of ['\n', '\r\n']) {
      const target = vscode.Uri.file(join(workspace, eol === '\n' ? 'protected-formatting-lf.ts' : 'protected-formatting-crlf.ts'));
      const prefix = 'import { Hson } from "hson-live/hson";' + eol + 'const value = Hson.data`';
      const hole = '${' + eol + '  1' + eol + '}';
      const input = prefix + '<value' + eol + hole + ' >`;';
      const expected = prefix + '<' + eol + '  value' + eol + '  ' + hole + eol + '>`;';
      await vscode.workspace.fs.writeFile(target, Buffer.from(input + ' '));
      const document = await vscode.workspace.openTextDocument(target);
      const editor = await vscode.window.showTextDocument(document);
      const replace = async (): Promise<void> => {
        if (document.eol !== (eol === '\r\n' ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF)) {
          assert.ok(await editor.edit(edit => edit.setEndOfLine(eol === '\r\n' ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF)));
        }
        assert.ok(await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), input)));
        assert.equal(document.getText(), input);
      };
      await replace();
      assert.equal(document.isDirty, true, 'exercise an actual Save participant');
      assert.equal(await document.save(), true);
      assert.equal(document.getText(), expected, `Save preserves exact ${JSON.stringify(eol)} expression`);
      assert.equal(Buffer.from(await vscode.workspace.fs.readFile(target)).toString(), expected, 'saved bytes preserve the complete expression');
      await replace();
      await vscode.commands.executeCommand('hson.formatDocument');
      assert.equal(document.getText(), expected, 'Format Document preserves the exact source');
      assert.ok(document.getText().includes(hole));
      process.stdout.write(`ok - isolated Save and Format Document preserve exact protected source (${JSON.stringify(eol)})\n`);
    }
  } finally {
    for (const setting of settings) await vscode.workspace.getConfiguration(setting.section, uri).update(setting.key, setting.previous, vscode.ConfigurationTarget.Workspace);
    await vscode.workspace.fs.delete(uri).then(undefined, () => undefined);
    for (const name of ['protected-formatting-lf.ts', 'protected-formatting-crlf.ts']) await vscode.workspace.fs.delete(vscode.Uri.file(join(workspace, name))).then(undefined, () => undefined);
  }
}

async function runTypingConveniences(workspace: string): Promise<void> {
  const uri = vscode.Uri.file(join(workspace, "typing-conveniences.ts"));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(""));
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const prefix = 'import { Hson } from "hson-live/hson";\nconst x=Hson.';
  const setup = async (marked: string): Promise<{ text: string; offset: number }> => {
    const eol = marked.includes('\r\n') ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF;
    marked = marked.replace(/\r\n|\r|\n/g, eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
    if (document.eol !== eol) assert.ok(await editor.edit(edit => edit.setEndOfLine(eol)));
    const offset = marked.indexOf('|');
    assert.ok(offset >= 0);
    const text = marked.replace('|', '');
    assert.ok(await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text)));
    assert.equal(document.getText(), text, 'fixture source and EOL must match before computing cursor positions');
    editor.selection = new vscode.Selection(document.positionAt(offset), document.positionAt(offset));
    return { text, offset };
  };
  const selectionAt = (offset: number): void => {
    assert.ok(editor.selection.isEmpty);
    assert.equal(document.offsetAt(editor.selection.anchor), offset);
    assert.equal(document.offsetAt(editor.selection.active), offset);
  };
  const cases = [
    { label: 'attribute', body: 'document`<span title|/>`;', typed: '=', inserted: '=""', delta: 2, close: '"' },
    { label: 'interpolation', body: 'document`<span $|/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'placeholder', body: 'document`<span title="%|"/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'attribute after partial quote', body: 'document`<span title="${first} partial" next|/>`;', typed: '=', inserted: '=""', delta: 2, close: '"' },
    { label: 'partial quoted content', body: 'document`<span "before $|"/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'partial quoted attribute', body: 'document`<span title="$|after"/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'adjacent partial quoted expression', body: 'document`<span title="pre${first}$|suffix"/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'placeholder after partial quote', body: 'document`<span "${first} %|"/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
  ];
  for (const fixture of cases) {
    const before = await setup(prefix + fixture.body);
    await vscode.commands.executeCommand('type', { text: fixture.typed });
    const expected = before.text.slice(0, before.offset) + fixture.inserted + before.text.slice(before.offset);
    assert.equal(document.getText(), expected, fixture.label + ' exact snippet source');
    selectionAt(before.offset + fixture.delta);
    // Insertion at the snippet cursor is observable without graphical focus.
    await editor.insertSnippet(new vscode.SnippetString('value'), editor.selection);
    assert.equal(document.getText(), expected.slice(0, before.offset + fixture.delta) + 'value' + expected.slice(before.offset + fixture.delta));
    selectionAt(before.offset + fixture.delta + 5);
    process.stdout.write(`ok - ${fixture.label}: native SnippetString source and collapsed cursor, including interior insertion\n`);
  }
  for (const [body, typed, inserted, delta] of [
    ['document`<main @:root <span @:label data-title| />/>`;', '=', '=""', 2],
    ['document`<hson-part lib| at="card"/>`;', '=', '=""', 2],
    ['data`<value $|>`;', '{', '{}', 1],
    ['document`<span title="$|"/>`;', '{', '{}', 1],
    ['document`<span "Hello %|"/>`;', '{', '{}', 1],
    ['document`<main @:root |/>`;', '<', '</>', 1],
    ['data`|`;', '[', '«»', 1],
  ] satisfies readonly (readonly [string, string, string, number])[]) {
    const before = await setup(prefix + body);
    await vscode.commands.executeCommand('type', { text: typed });
    assert.equal(document.getText(), before.text.slice(0, before.offset) + inserted + before.text.slice(before.offset), body);
    selectionAt(before.offset + delta);
  }
  const multilineHole = '${\r\n fragment("😀")\r\n}';
  for (const [body, typed, inserted, delta] of [
    ['<main ' + multilineHole + ' <span title|/>/>', '=', '=""', 2],
    ['<main ' + multilineHole + ' "Hello %|"/>', '{', '{}', 1],
    ['<main ' + multilineHole + ' <span title="%|"/>/>', '{', '{}', 1],
  ] satisfies readonly (readonly [string, string, string, number])[]) {
    const before = await setup(prefix + 'document`' + body + '`;');
    await vscode.commands.executeCommand('type', { text: typed });
    assert.equal(document.getText(), before.text.slice(0, before.offset) + inserted + before.text.slice(before.offset));
    selectionAt(before.offset + delta);
    assert.ok(document.getText().includes(multilineHole));
  }
  for (const [inner, typed, inserted, delta] of [
    ['Hson.document`<span title|/>`', '=', '=""', 2],
    ['Hson.document`<span $|/>`', '{', '{}', 1],
    ['Hson.document`<span "%|"/>`', '{', '{}', 1],
    ['Hson.data`$|`', '{', '{}', 1],
  ] satisfies readonly (readonly [string, string, string, number])[]) {
    const before = await setup(prefix + 'document`<main ${Hson.document`<div ${' + inner + '}/>`}/>`;');
    await vscode.commands.executeCommand('type', { text: typed });
    assert.equal(document.getText(), before.text.slice(0, before.offset) + inserted + before.text.slice(before.offset));
    selectionAt(before.offset + delta);
  }
  process.stdout.write('ok - current host: multiline CRLF/astral and nested template source/cursor regressions\n');
  process.stdout.write('ok - current host: QUAD/hyphenated/Part attributes, Data and quoted interpolation, text placeholders, existing structural and «» snippets\n');
  // Existing closers use one opener snippet and leave the existing brace intact.
  for (const body of ['data`$|}`;', 'document`<span "%|}"/>`;', 'data`$|fn({ value: 1 })}`;', 'document`<span "%|name}"/>`;',
    'document`<span title="pre$|}suffix"/>`;', 'document`<span title="pre$|name}suffix"/>`;']) {
    const before = await setup(prefix + body);
    await vscode.commands.executeCommand('type', { text: '{' });
    assert.equal(document.getText(), before.text.slice(0, before.offset) + '{' + before.text.slice(before.offset));
    selectionAt(before.offset + 1);
  }
  // Probe each native command separately: editor actions may be available even
  // when default:type has no focused code editor. No unchanged command verifies
  // a lifecycle behavior, and observable mismatches always fail the test.
  await setup('abc|');
  await vscode.commands.executeCommand('deleteLeft');
  const nativeDelete = document.getText() !== 'abc';
  if (nativeDelete) { assert.equal(document.getText(), 'ab'); selectionAt(2); }
  else process.stdout.write('UNVERIFIED - native Backspace command unavailable in this host\n');

  const undoBefore = await setup('abc|');
  await editor.insertSnippet(new vscode.SnippetString('x'), editor.selection, { undoStopBefore: true, undoStopAfter: true });
  assert.equal(document.getText(), 'abcx');
  selectionAt(4);
  await vscode.commands.executeCommand('undo');
  const nativeUndoRedo = document.getText() !== 'abcx';
  if (nativeUndoRedo) {
    assert.equal(document.getText(), undoBefore.text);
    selectionAt(undoBefore.offset);
    await vscode.commands.executeCommand('redo');
    assert.equal(document.getText(), 'abcx');
    selectionAt(4);
  } else process.stdout.write('UNVERIFIED - native undo/redo commands unavailable in this host\n');

  // Compare pair registration independently of Hson activation. The equivalent
  // replacement replaces exactly the authored closing brace in one snippet.
  let authoredCloserConflict = false;
  for (const mode of ['complete', 'opener-only', 'replace-closer']) {
    const authoredClose = mode !== 'complete';
    const before = await setup(prefix + 'data`$|' + (authoredClose ? '}' : '') + '`;');
    const range = new vscode.Range(document.positionAt(before.offset), document.positionAt(before.offset + (mode === 'replace-closer' ? 1 : 0)));
    await editor.insertSnippet(new vscode.SnippetString(mode === 'opener-only' ? '{$0' : '{$0}'), range);
    const expected = before.text.slice(0, before.offset) + '{}' + before.text.slice(before.offset + (authoredClose ? 1 : 0));
    assert.equal(document.getText(), expected, mode + ' produces identical visible source');
    selectionAt(before.offset + 1);
    if (nativeDelete) {
      await vscode.commands.executeCommand('deleteLeft');
      if (mode === 'complete') {
        assert.equal(document.getText(), before.text, 'new complete pair deletes both newly inserted delimiters');
        selectionAt(before.offset);
      } else {
        // Observe existing-closer behavior without inventing a native contract.
        // A changed result that loses the authored brace requires human review.
        const result = document.getText();
        const changed = result !== expected;
        const preserved = result.slice(before.offset).startsWith('}');
        if (changed && !preserved) authoredCloserConflict = true;
        process.stdout.write('REUSED_CLOSER_OBSERVATION ' + JSON.stringify({ mode, result, cursor: document.offsetAt(editor.selection.active),
          status: changed ? 'observed' : 'UNVERIFIED', authoredCloserPreserved: changed ? preserved : undefined }) + '\n');
        if (changed && !preserved) process.stdout.write('HUMAN DECISION REQUIRED - native Backspace removed a previously authored closer; production behavior is unchanged\n');
      }
    }
  }
  process.stdout.write('UNVERIFIED - reused-closer Backspace/overtyping contract is not established; insertion source and cursor are verified\n');

  const lifecycleCases = [
    ...cases,
    { label: 'adjacent attribute', body: 'document`<span first="one" next|/>`;', typed: '=', inserted: '=""', delta: 2, close: '"' },
    { label: 'adjacent interpolation', body: 'document`<span ${first}$|/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'adjacent placeholder', body: 'document`<span "%{first}%|"/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'nested attribute', body: 'document`<main ${Hson.document`<span title|/>`}/>`;', typed: '=', inserted: '=""', delta: 2, close: '"' },
    { label: 'nested interpolation', body: 'document`<main ${Hson.document`<span $|/>`}/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'nested placeholder', body: 'document`<main ${Hson.document`<span "%|"/>`}/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
  ];
  for (const fixture of lifecycleCases) {
    const before = await setup(prefix + fixture.body);
    await vscode.commands.executeCommand('type', { text: fixture.typed });
    const paired = document.getText();
    assert.equal(paired, before.text.slice(0, before.offset) + fixture.inserted + before.text.slice(before.offset));
    selectionAt(before.offset + fixture.delta);
    if (nativeDelete) {
      await vscode.commands.executeCommand('deleteLeft');
      assert.equal(document.getText(), paired.slice(0, before.offset + fixture.delta - 1) + paired.slice(before.offset + fixture.delta + 1), fixture.label + ' deletes untouched native pair');
      selectionAt(before.offset + fixture.delta - 1);
      await setup(prefix + fixture.body);
      await vscode.commands.executeCommand('type', { text: fixture.typed });
      await editor.insertSnippet(new vscode.SnippetString('x'), editor.selection);
      await vscode.commands.executeCommand('deleteLeft');
      assert.equal(document.getText(), paired, fixture.label + ' native Backspace deletes inserted interior content');
      selectionAt(before.offset + fixture.delta);
      await vscode.commands.executeCommand('deleteLeft');
      assert.equal(document.getText(), paired.slice(0, before.offset + fixture.delta - 1) + paired.slice(before.offset + fixture.delta + 1), fixture.label + ' pair deletion after interior edit');
      selectionAt(before.offset + fixture.delta - 1);
    }
    if (nativeUndoRedo) {
      await setup(prefix + fixture.body);
      await vscode.commands.executeCommand('type', { text: fixture.typed });
      await vscode.commands.executeCommand('undo');
      assert.equal(document.getText(), before.text, fixture.label + ' one undo restores preceding source');
      selectionAt(before.offset);
      await vscode.commands.executeCommand('redo');
      assert.equal(document.getText(), paired, fixture.label + ' redo restores pair');
      selectionAt(before.offset + fixture.delta);
    }
  }
  // Nest and adjoin real snippet pairs; assert their native deletion boundaries.
  if (nativeDelete) {
    for (const marked of ['const x=Hson.data`$|`;', 'const x=Hson.document`<span "%{first}%|"/>`;']) {
      const before = await setup(prefix.slice(0, prefix.indexOf('const x=')) + marked);
      await vscode.commands.executeCommand('type', { text: '{' });
      const outer = document.getText();
      await editor.insertSnippet(new vscode.SnippetString('{$0}'), editor.selection);
      assert.equal(document.getText(), outer.slice(0, before.offset + 1) + '{}' + outer.slice(before.offset + 1));
      selectionAt(before.offset + 2);
      await vscode.commands.executeCommand('deleteLeft');
      assert.equal(document.getText(), outer);
      selectionAt(before.offset + 1);
    }
  }
  await setup('const probe = "|";');
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  const probe = document.getText();
  await vscode.commands.executeCommand('default:type', { text: 'z' });
  const nativeTyping = document.getText() !== probe;
  if (!nativeTyping) {
    process.stdout.write(`UNVERIFIED - graphical native typing/overtyping unavailable (window focused=${vscode.window.state.focused}); no typing or overtype behavior inferred\n`);
  } else {
    assert.equal(document.getText(), 'const probe = "z";');
    for (const fixture of lifecycleCases) {
      const before = await setup(prefix + fixture.body);
      await vscode.commands.executeCommand('type', { text: fixture.typed });
      const paired = document.getText();
      await vscode.commands.executeCommand('type', { text: 'x' });
      const content = paired.slice(0, before.offset + fixture.delta) + 'x' + paired.slice(before.offset + fixture.delta);
      assert.equal(document.getText(), content, fixture.label + ' native interior typing');
      selectionAt(before.offset + fixture.delta + 1);
      await vscode.commands.executeCommand('type', { text: fixture.close });
      assert.equal(document.getText(), content, fixture.label + ' native closing-delimiter overtype');
      selectionAt(before.offset + fixture.delta + 2);
    }
  }
  process.stdout.write('HSON_TYPING_ACCEPTANCE ' + JSON.stringify({ sourceCursor: 'passed', nativeDelete, nativeUndoRedo, nativeTyping,
    reusedCloserLifecycle: 'UNVERIFIED', authoredCloserConflict, windowFocused: vscode.window.state.focused,
    newPairAcceptance: vscode.window.state.focused && nativeTyping && nativeDelete && nativeUndoRedo ? 'passed' : 'UNVERIFIED',
    graphicalAcceptance: authoredCloserConflict ? 'human-decision-required' : 'UNVERIFIED' }) + '\n');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await vscode.workspace.fs.delete(uri);
}

async function runPartCompletions(workspace: string): Promise<void> {
  const uri = vscode.Uri.file(join(workspace, "declarative-schema", "part-authoring.ts"));
  const producer = vscode.Uri.file(join(workspace, "declarative-schema", "parts.ts"));
  const parts = 'import { Hson } from "hson-live";\nexport const parts = { heading: { kind: "document", document: Hson.document`<h1 title="%{Title-Case}" "%{content}"/>` }, nav: { kind: "document", document: Hson.document`<nav "%{current}"/>` } } as const;';
  await vscode.workspace.fs.writeFile(producer, Buffer.from(parts));
  const prefix = 'import { Hson, hsonLiveMap } from "hson-live";\r\nimport { parts } from "./parts.js";\r\nconst loc = hsonLiveMap.locus.create({ components: { parts } });\r\nconst page = Hson.document`';
  const suffix = '`;\r\nconst untouched = "keep";';
  await vscode.workspace.fs.writeFile(uri, Buffer.from(prefix + '<main/>' + suffix));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  const replace = async (doc: vscode.TextDocument, text: string): Promise<void> => {
    const edit = new vscode.WorkspaceEdit(); edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
  };
  const completions = async (offset: number, label: string): Promise<vscode.CompletionItem> => {
    let found: vscode.CompletionItem | undefined;
    await waitFor(async () => {
      const result = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', uri, document.positionAt(offset), undefined, 100);
      found = result?.items.find(item => (typeof item.label === "string" ? item.label : item.label.label) === label
        && /Parts Library|Part member|Part argument|Part parameter/.test(item.detail ?? ""));
      return found !== undefined;
    }, `Missing Part completion ${label}`);
    assert.ok(found); return found;
  };
  for (const [body, label, expected] of [
    ['<hson-part lib=|/>', 'components', '<hson-part lib="components"/>'],
    ['<hson-part lib=|"co"/>', 'components', '<hson-part lib="components"/>'],
    ['<hson-part lib="components" at=|"he"/>', 'heading', '<hson-part lib="components" at="heading"/>'],
    ['<hson-part lib="co|', 'components', '<hson-part lib="components"'],
    ['<hson-part lib="components" at="\\u0068e|ading"/>', 'heading', '<hson-part lib="components" at="heading"/>'],
    ['<hson-part lib="components" at="heading" Ti|tle-old="x" content="kept"/>', 'Title-Case', '<hson-part lib="components" at="heading" Title-Case="x" content="kept"/>'],
    ['<main ${Hson.document`<hson-part lib="components" at="he|"/>`}/>', 'heading', '<main ${Hson.document`<hson-part lib="components" at="heading"/>`}/>'],
  ]) {
    await replace(document, prefix + body.replace("|", "") + suffix);
    const item = await completions(prefix.length + body.indexOf("|"), label);
    const range = item.textEdit?.range ?? (item.range instanceof vscode.Range ? item.range : item.range?.replacing);
    const insertText = item.textEdit?.newText ?? item.insertText;
    assert.ok(range); assert.equal(typeof insertText, "string");
    const edit = new vscode.WorkspaceEdit(); edit.replace(uri, range, String(insertText));
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    assert.equal(document.getText(), prefix + expected + suffix);
  }
  for (const [body, label, expected] of [
    ['<h1 "%{Title-Case}" "%{Ti|}"/>', 'Title-Case', '<h1 "%{Title-Case}" "%{Title-Case}"/>'],
    ['<h1 title="%{content}" id=%{co|}/>', 'content', '<h1 title="%{content}" id=%{content}/>'],
    [String.raw`<h1 title="%{content}" id="%{\u0063o|}"/>`, 'content', '<h1 title="%{content}" id="%{content}"/>'],
    ['<script src="/app.js" title="%{content}" id="%{co|}"/>', 'content', '<script src="/app.js" title="%{content}" id="%{content}"/>'],
    ['<style media="%{content}" id=%{co|}/>', 'content', '<style media="%{content}" id=%{content}/>'],
  ]) {
    const before = 'import { Hson, hsonLiveMap } from "hson-live";\r\nconst page = Hson.document`';
    const after = '`;\r\nconst loc = hsonLiveMap.fromLibraries({ components: { parts: { heading: { kind: "document", document: page } } } });';
    const marked = before + body + after;
    await replace(document, marked.replace('|', ''));
    const spelling = await completions(marked.indexOf('|'), label);
    const range = spelling.textEdit?.range ?? (spelling.range instanceof vscode.Range ? spelling.range : spelling.range?.replacing);
    assert.ok(range);
    const edit = new vscode.WorkspaceEdit(); edit.replace(uri, range, String(spelling.textEdit?.newText ?? spelling.insertText));
    assert.equal(await vscode.workspace.applyEdit(edit), true); assert.equal(document.getText(), before + expected + after);
  }
  const body = '<hson-part lib="components" at="he|"/>';
  await replace(document, prefix + body.replace("|", "") + suffix);
  await completions(prefix.length + body.indexOf("|"), "heading");
  const imported = await vscode.workspace.openTextDocument(producer);
  await replace(imported, parts.replace('heading:', 'hero:'));
  await completions(prefix.length + body.indexOf("|"), "hero");
  const result = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', uri, document.positionAt(prefix.length + body.indexOf("|")));
  assert.ok(!result?.items.some(item => (typeof item.label === "string" ? item.label : item.label.label) === "heading"));
  for (const body of ['<main lib="co|"/>', '<main // at="he|"\n/>', '<main "at=he|"/>', '<main ${(() => { /* at=he| */ return "x"; })()}/>',
    '<hson-part lib=|"co', String.raw`<hson-part lib=|"co\q"/>`, '<script title="%{content}" <span id="%{co|}"/>/>', '<style media="%{content}" <span "%{co|}"/>/>', String.raw`<h1 title="%{content}" id="%{\u00|63o}"/>`]) {
    await replace(document, prefix + body.replace("|", "") + suffix + '\r\nconst owned = hsonLiveMap.fromLibraries({ own: { parts: { item: { kind: "document", document: page } } } });');
    const result = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', uri, document.positionAt(prefix.length + body.indexOf("|")), undefined, 100);
    assert.ok(!result?.items.some(item => /Parts Library|Part member|Part argument|Part parameter/.test(item.detail ?? "")), body);
  }
  process.stdout.write("ok - real VS Code Part completion applies exact edits in four contexts and refreshes unsaved imported Parts\n");
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("terminal-gothic.hson-language");
  assert.ok(extension, "Hson extension was not discovered by the extension host");
  await extension.activate();
  const workspace = process.env.HSON_TEST_WORKSPACE;

  assert.ok(workspace);
  if (process.env.HSON_PART_COMPLETION_TEST_ONLY === "1") { await runPartCompletions(workspace); return; }
  if (process.env.HSON_RESTRICTED_TEST !== "1") {
    await runProtectedSourceFormatting(workspace);
    await runTypingConveniences(workspace);
  }
  if (process.env.HSON_TYPING_TEST_ONLY === "1") return;
  const commands = await vscode.commands.getCommands(true);
  for (const command of ["hson.actions", "hson.formatDocument", "hson.formatSelection", "hson.runAll", "hson.stopAll", "hson.startLocalHost", "hson.runAndOpenLocalApp", "hson.stopLocalHost", "hson.restartLocalHost", "hson.openLocalApp", "hson.copyLocalAppUrl", "hson.showLocalHostOutput"]) {
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

  for (const extension of ['mts', 'cts']) {
    const uri = vscode.Uri.file(join(workspace, 'static-project', `lifecycle.${extension}`));
    const renamed = vscode.Uri.file(join(workspace, 'static-project', `renamed.${extension}`));
    const invalid = 'import { Hson } from "hson-live";\nHson.data`+1`;\nHson.document`<main @:x @:y/>`;';
    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(invalid));
      const diagnostics = await diagnosticsFor(uri, 2);
      assert.deepEqual(diagnostics.map(value => value.code), ['HSON_NUMBER_LEADING_PLUS', 'HSON_LIBRARY_QUAD_DUPLICATE']);
      assert.equal(diagnostics[1]?.relatedInformation?.length, 1);
      assert.equal(vscode.workspace.textDocuments.some(document => document.uri.toString() === uri.toString()), false);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(invalid.replace('+1', '1').replace(' @:y', '')));
      assert.equal((await diagnosticsFor(uri, 0)).length, 0);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(invalid));
      assert.equal((await diagnosticsFor(uri, 2)).length, 2);
      await vscode.workspace.fs.rename(uri, renamed);
      assert.equal((await diagnosticsFor(uri, 0)).length, 0);
      assert.equal((await diagnosticsFor(renamed, 2)).length, 2);
      await vscode.workspace.fs.delete(renamed);
      assert.equal((await diagnosticsFor(renamed, 0)).length, 0);
    } finally {
      await vscode.workspace.fs.delete(uri).then(undefined, () => undefined);
      await vscode.workspace.fs.delete(renamed).then(undefined, () => undefined);
    }
  }
  process.stdout.write('ok - unopened MTS/CTS filesystem diagnostic lifecycle\n');

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

  const libraryUri = vscode.Uri.file(join(workspace, "declarative-schema", "libraries.ts"));
  const libraryPrefix = `import { Hson, hsonLiveMap } from "hson-live";
import { UserSchema } from "./schema.js";
const loc = hsonLiveMap.locus.create({
  deck: { data: { user: { age: 37 } }, schema: UserSchema },
  page: { document: Hson.document\`<main/>\` },
  components: { parts: { submit: { kind: "document", document: Hson.document\`<button/>\` } } },
});
`;
  await vscode.workspace.fs.writeFile(libraryUri, Buffer.from(libraryPrefix));
  const libraryDocument = await vscode.workspace.openTextDocument(libraryUri);
  await vscode.window.showTextDocument(libraryDocument);
  for (const [expression, present, absent] of [
    ["loc.", ["doc", "data", "parts", "admit"], ["lib", "addLibraries"]],
    ["loc.data.", ["deck", "must"], ["page", "components"]],
    ["loc.doc.page.", ["snap", "hson", "render"], ["data"]],
    ["loc.parts.components.", ["submit", "snap", "hson"], ["render"]],
    ['loc.data.must("deck", UserSchema).snap().user.', ["age"], []],
    ["loc.doc.page.at([0]).must.", ["snap", "hson"], ["render", "data"]],
    ["loc.parts.components.schema.", ["get"], ["use"]],
  ] satisfies readonly (readonly [string, readonly string[], readonly string[]])[]) {
    const text = libraryPrefix + expression;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(libraryUri, new vscode.Range(libraryDocument.positionAt(0), libraryDocument.positionAt(libraryDocument.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    let names: string[] = [];
    await waitFor(async () => {
      const completions = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider", libraryUri, libraryDocument.positionAt(text.length));
      names = completions?.items.map(item => typeof item.label === "string" ? item.label : item.label.label) ?? [];
      return present.every(name => names.includes(name));
    }, `Library completion ${expression}: missing ${present.join(", ")}`);
    for (const name of absent) assert.ok(!names.includes(name), `${expression}: unsupported completion ${name}`);
  }
  const invalidAdmission = libraryPrefix + 'loc.admit({ incoming: { data: { user: { age: "wrong" } }, schema: UserSchema } });';
  const replaceLibrary = async (text: string): Promise<void> => {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(libraryUri, new vscode.Range(libraryDocument.positionAt(0), libraryDocument.positionAt(libraryDocument.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
  };
  const admissionDiagnostics = () => vscode.languages.getDiagnostics(libraryUri).filter(diagnostic => diagnostic.source === "hson-schema" && diagnostic.code === 95002
    && diagnostic.message.startsWith("Static Hson does not satisfy UserSchema:"));
  await replaceLibrary(invalidAdmission);
  await waitFor(async () => admissionDiagnostics().length === 1, "flat admission candidate diagnostic", 30_000);
  await replaceLibrary(invalidAdmission.replace('age: "wrong"', "age: 38"));
  await waitFor(async () => admissionDiagnostics().length === 0, "unsaved admission correction", 30_000);
  process.stdout.write("ok - real VS Code final Library families, Parts, checked Schema selection, required reads and flat admission diagnostics\n");

  const structuralUri = vscode.Uri.file(join(workspace, "hson-structural-editing.ts"));
  const markdownStructuralUri = vscode.Uri.file(join(workspace, "hson-structural-editing.md"));
  const saveTypeScriptUri = vscode.Uri.file(join(workspace, "hson-format-on-save.ts"));
  const documentTypeScriptUri = vscode.Uri.file(join(workspace, "hson-document-format-on-save.ts"));
  const saveMarkdownUri = vscode.Uri.file(join(workspace, "hson-format-on-save.md"));
  const invalidSaveUri = vscode.Uri.file(join(workspace, "hson-format-on-save-invalid.ts"));
  try {
    const replaceDocument = async (document: vscode.TextDocument, text: string): Promise<void> => {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      assert.equal(document.isDirty, true);
    };
    const formattingConfiguration = vscode.workspace.getConfiguration("hson.formatting", folder.uri);
    assert.equal(formattingConfiguration.get<boolean>("formatOnSave"), true, "Hson format-on-save defaults on in real VS Code");

    const documentInput = [
      'import { Hson, hsonLiveMap, type LiveHostApplication } from "hson-live";',
      'const pulsePage = "/pulse";',
      "const ordinary =  1;",
      "const unrelated = `  untouched`;",
      "const mainShell = Hson.document`",
      "<html",
      "<head",
      '<style ".pulse-mount{position:fixed;left:0;bottom:0}"/>',
      "/>",
      "<body",
      "<iframe",
      'src="${pulsePage}"',
      'title="Pulse diagnostics"',
      "/>",
      "<main",
      '<h1 "Deck"/>',
      "/>",
      "/>",
      "/>",
      "`;",
      "",
    ].join("\n");
    const documentExpected = documentInput.replace(
      '\n<html\n<head\n<style ".pulse-mount{position:fixed;left:0;bottom:0}"/>\n/>\n<body\n<iframe\nsrc="${pulsePage}"\ntitle="Pulse diagnostics"\n/>\n<main\n<h1 "Deck"/>\n/>\n/>\n/>\n',
      '\n<html\n  <head\n    <style ".pulse-mount{position:fixed;left:0;bottom:0}"/>\n  />\n  <body\n    <iframe\n      src="${pulsePage}"\n      title="Pulse diagnostics"\n    />\n    <main\n      <h1 "Deck"/>\n    />\n  />\n/>\n',
    );
    await vscode.workspace.fs.writeFile(documentTypeScriptUri, Buffer.from("// document format fixture\n"));
    const documentTypeScript = await vscode.workspace.openTextDocument(documentTypeScriptUri);
    const documentEditor = await vscode.window.showTextDocument(documentTypeScript);
    documentEditor.options = { ...documentEditor.options, insertSpaces: true, tabSize: 2 };
    await replaceDocument(documentTypeScript, documentInput);
    await vscode.commands.executeCommand("hson.formatDocument");
    assert.equal(documentTypeScript.getText().slice(documentTypeScript.getText().indexOf("Hson.document`")),
      documentExpected.slice(documentExpected.indexOf("Hson.document`")), "manual Hson Format Document indents the authored document and preserves CSS");
    await replaceDocument(documentTypeScript, documentInput);
    assert.equal(await documentTypeScript.save(), true);
    assert.equal(documentTypeScript.getText(), documentExpected, "save indents the authored Hson.document region without changing surrounding TypeScript");

    const typeScriptInput = [
      'import { Hson } from "hson-live/hson";',
      "const host =  1;",
      "const ordinaryArray = [1, 2];",
      "const unrelated = `  untouched`;",
      "const runtime = fromHson(`",
      ' <runtime       "runtime  spaces"    />',
      "`);",
      "const x = Hson.canonical`",
      " <",
      "a <",
      "b      <c   1>>",
      "d 2",
      'items ["[literal]",[1,2]]',
      ">",
      "`;",
      "",
    ].join("\n");
    const typeScriptExpected = typeScriptInput.replace("\n <\na <\nb      <c   1>>\nd 2\nitems [\"[literal]\",[1,2]]\n>", "\n<\n  a <\n    b <c 1>\n  >\n  d 2\n  items «\"[literal]\",«1,2»»\n>");
    await vscode.workspace.fs.writeFile(saveTypeScriptUri, Buffer.from("// format-on-save fixture\n"));
    const saveTypeScript = await vscode.workspace.openTextDocument(saveTypeScriptUri);
    const saveTypeScriptEditor = await vscode.window.showTextDocument(saveTypeScript);
    saveTypeScriptEditor.options = { ...saveTypeScriptEditor.options, insertSpaces: true, tabSize: 2 };
    await replaceDocument(saveTypeScript, typeScriptInput);
    assert.equal(await saveTypeScript.save(), true);
    assert.equal(saveTypeScript.getText(), typeScriptExpected, `save formats only the binding-recognized Hson template: ${JSON.stringify(saveTypeScript.getText())}`);
    assert.ok(saveTypeScript.getText().includes("const host =  1;"), "save leaves ordinary TypeScript byte-stable");
    assert.ok(saveTypeScript.getText().includes("const ordinaryArray = [1, 2];"), "save leaves ordinary TypeScript arrays byte-stable");
    assert.ok(saveTypeScript.getText().includes("const unrelated = `  untouched`;"), "save leaves unrelated templates byte-stable");
    assert.ok(saveTypeScript.getText().includes('fromHson(`\n <runtime       "runtime  spaces"    />\n`)'), "save leaves fromHson runtime strings byte-stable");
    const onceFormatted = saveTypeScript.getText();
    await replaceDocument(saveTypeScript, typeScriptInput);
    assert.equal(await saveTypeScript.save(), true);
    assert.equal(saveTypeScript.getText(), onceFormatted, "save formatting remains idempotent");

    const markdownInput = "Prose  stays\n```hson\n <main\n<section\n/>\n />\n```\n```hson\n <\na <\nb      <c   1>>\nd 2\n>\n```\n```json\n  untouched\n```\n```Hson\n <also-untouched/>\n```\n";
    const markdownExpected = markdownInput
      .replace("```hson\n <main\n<section\n/>\n />\n```", "```hson\n<main\n  <section\n  />\n/>\n```")
      .replace("```hson\n <\na <\nb      <c   1>>\nd 2\n>\n```", "```hson\n<\n  a <\n    b <c 1>\n  >\n  d 2\n>\n```");
    await vscode.workspace.fs.writeFile(saveMarkdownUri, Buffer.from("# format-on-save fixture\n"));
    const saveMarkdown = await vscode.workspace.openTextDocument(saveMarkdownUri);
    const saveMarkdownEditor = await vscode.window.showTextDocument(saveMarkdown);
    saveMarkdownEditor.options = { ...saveMarkdownEditor.options, insertSpaces: true, tabSize: 2 };
    await replaceDocument(saveMarkdown, markdownInput);
    assert.equal(await saveMarkdown.save(), true);
    assert.equal(saveMarkdown.getText(), markdownExpected, "save formats canonical Markdown hson fences without changing prose or unrelated fences");

    const invalidInput = 'import { Hson } from "hson-live/hson";\nconst invalid = Hson.canonical`\n <data 1\n<data2 2>\n>\n`;\n';
    await vscode.workspace.fs.writeFile(invalidSaveUri, Buffer.from("// invalid format-on-save fixture\n"));
    const invalidSave = await vscode.workspace.openTextDocument(invalidSaveUri);
    await vscode.window.showTextDocument(invalidSave);
    await replaceDocument(invalidSave, invalidInput);
    assert.equal(await invalidSave.save(), true, "invalid Hson does not block a real save");
    assert.equal(invalidSave.getText(), invalidInput, "invalid Hson is skipped without rewriting");

    await formattingConfiguration.update("formatOnSave", false, vscode.ConfigurationTarget.WorkspaceFolder);
    await vscode.window.showTextDocument(documentTypeScript);
    await replaceDocument(documentTypeScript, documentInput);
    assert.equal(await documentTypeScript.save(), true);
    assert.equal(documentTypeScript.getText(), documentInput, "disabled Hson format-on-save leaves Hson.document unchanged");
    await vscode.window.showTextDocument(saveTypeScript);
    await replaceDocument(saveTypeScript, typeScriptInput);
    assert.equal(await saveTypeScript.save(), true);
    assert.equal(saveTypeScript.getText(), typeScriptInput, "disabled Hson format-on-save leaves recognized regions unchanged");
    await formattingConfiguration.update("formatOnSave", true, vscode.ConfigurationTarget.WorkspaceFolder);
    process.stdout.write("ok - real VS Code save formats recognized TypeScript and Markdown Hson only; invalid input skips; disabled setting bypasses\n");

    await vscode.workspace.fs.writeFile(structuralUri, Buffer.from('import { Hson } from "hson-live/hson";\nconst host =  1;\nconst inline=Hson.canonical`<solo/>`;\nconst page=Hson.canonical`\n <main\n<section\n/>\n />\n`;\n'));
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
    assert.ok(structural.getText().includes("\n  \n/>"), `real Enter used two-space Hson indentation and dedented the closer: ${JSON.stringify(structural.getText())}`);
    await vscode.commands.executeCommand("undo");

    const hostPrefix = 'import { Hson } from "hson-live/hson";\n';
    for (const body of ['<main |/>', '<main @:main |/>', '<main <p @:label/> |/>', '<main @:main ${fragment} |/>']) {
      const marked = hostPrefix + 'const x=Hson.document`' + body + '`;\nconst untouched = "keep";';
      const before = await replaceMarked(marked);
      await vscode.commands.executeCommand('type', { text: '<' });
      assert.equal(structural.getText(), before.clean.slice(0, before.offset) + '</>' + before.clean.slice(before.offset), body);
      assert.equal(structural.offsetAt(structuralEditor.selection.active), before.offset + 1, 'Closer cursor remains inside the pair');
      await replaceMarked(marked);
      await vscode.commands.executeCommand('hson.insertLineBreak');
      assert.equal(structural.getText(), before.clean.slice(0, before.offset) + '\n  \n' + before.clean.slice(before.offset), body);
      assert.equal(structural.offsetAt(structuralEditor.selection.active), before.offset + 3, 'Enter cursor is on the indented inner line');
    }
    const typeArray = async (label: string, marked: string, paired: boolean): Promise<void> => {
      const before = await replaceMarked(marked);
      await vscode.commands.executeCommand("type", { text: "[" });
      const insertion = paired ? ["«»"] : ["[", "[]"];
      assert.ok(insertion.some(value => structural.getText() === before.clean.slice(0, before.offset) + value + before.clean.slice(before.offset)), label);
      assert.equal(structural.offsetAt(structuralEditor.selection.active), before.offset + 1, `${label} cursor position`);
    };
    await typeArray("Hson empty array inserts one canonical pair", hostPrefix + 'const x=Hson.canonical`|`;', true);
    assert.ok(structural.getText().includes("«»"));
    await vscode.commands.executeCommand("type", { text: "1" });
    assert.ok(structural.getText().includes("«1»"), "content enters the generated pair");
    await vscode.commands.executeCommand("undo");
    assert.ok(!structural.getText().includes("«1»"), "undo removes the inserted content coherently");
    await typeArray("Hson nested array", hostPrefix + 'const x=Hson.canonical`«|»`;', true);
    await typeArray("Hson object array value", hostPrefix + 'const x=Hson.canonical`<items |>`;', true);
    await typeArray("Hson multiline array", hostPrefix + 'const x=Hson.canonical`\n<\n  items |\n>\n`;', true);
    await typeArray("Hson completed string stays literal", hostPrefix + 'const x=Hson.canonical`"ab|c"`;', false);
    await typeArray("Hson incomplete string stays literal", hostPrefix + 'const x=Hson.canonical`"abc|`;', false);
    await typeArray("Hson escaped string stays literal", hostPrefix + 'const x=Hson.canonical`"a\\"b|"`;', false);
    await typeArray("TypeScript substitution stays literal", hostPrefix + 'const x=Hson.canonical`<data ${[|1,2]}>`;', false);
    await typeArray("ordinary TypeScript stays literal", 'const values = |;', false);
    await typeArray("unrelated template stays literal", 'const value = `|`;', false);
    await typeArray("lookalike Hson stays literal", 'const Hson=String.raw; const x=Hson.canonical`|`;', false);
    await typeArray("non-array Hson position stays literal", hostPrefix + 'const x=Hson.canonical`<tag |/>`;', false);
    await ordinaryEnter("incomplete Hson", hostPrefix + 'const x=Hson.canonical`<data 1|`;');
    await ordinaryEnter("parser-invalid Hson", hostPrefix + 'const x=Hson.canonical`<data 1\n  <data2 2|>\n>`;');
    await ordinaryEnter("tokenizer-invalid Hson", hostPrefix + 'const x=Hson.canonical`<a "bad\\q"|>`;');
    await ordinaryEnter("delimiter-deleted Hson", hostPrefix + 'const x=Hson.canonical`<main <child/>|`;');
    await ordinaryEnter("Hson string", hostPrefix + 'const x=Hson.canonical`<a "te|xt">`;');
    await ordinaryEnter("Hson comment", hostPrefix + 'const x=Hson.canonical`<a 1 // no|te\nb 2>`;');
    await ordinaryEnter("Hson interpolation", hostPrefix + 'const value=1; const x=Hson.canonical`<a ${val|ue}>`;');
    await ordinaryEnter("ordinary TypeScript", 'const ordinary = 1;|');

    await replaceMarked(hostPrefix + 'const x=Hson.canonical`<main|/>`;');
    await vscode.commands.executeCommand("hson.insertLineBreak");
    assert.ok(structural.getText().includes("<main\n  \n/>"), "valid Hson receives smart Enter");
    await ordinaryEnter("invalid phase of valid-invalid-valid recovery", hostPrefix + 'const x=Hson.canonical`<data 1\n  <data2 2|>\n>`;');
    await replaceMarked(hostPrefix + 'const x=Hson.canonical`<main|/>`;');
    await vscode.commands.executeCommand("hson.insertLineBreak");
    assert.ok(structural.getText().includes("<main\n  \n/>"), "smart Enter resumes after Hson repair");

    await replaceMarked('const ordinary = 12|;');
    await vscode.commands.executeCommand("hson.deleteLeft");
    assert.equal(structural.getText(), "const ordinary = 1;", "non-pair Backspace fallback remains usable outside Hson");

    await replaceMarked(hostPrefix + 'const x=Hson.canonical`<data 1|>`;');
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
    assert.match(authoredLines.find(line => line.includes("data2")) ?? "", /^ {2}data2 2/, authoredDump);
    assert.match(authoredLines.find(line => line.includes("data3")) ?? "", /^ {2}data3 </, authoredDump);
    assert.match(authoredLines.find(line => line.includes("data4")) ?? "", /^ {4}data4 4/, authoredDump);
    assert.match(authoredLines.find(line => line.includes("data5")) ?? "", /^ {4}data5 5/, authoredDump);

    await replaceMarked('import { Hson } from "hson-live/hson";\nconst host =  1;\nconst inline=Hson.canonical`<solo      />`;\nconst page=Hson.canonical`\n <main\n<section\n/>\n />\n`;\nconst data=Hson.canonical`\n <data      1\ndata2 2\n>\n`;\nconst balanced=Hson.canonical`\n <\na <\nb      <c   1>>\nd 2\n>\n`;\nconst trailing=Hson.canonical`\n<\na <\nb <\nc <\nvalue 1>>>\nd 2\n>\n`;\n|');
    await vscode.commands.executeCommand("hson.deleteLeft");
    await vscode.commands.executeCommand("hson.formatDocument");
    assert.ok(structural.getText().includes("const host = 1;"), "Hson Format Document retained normal TypeScript formatting");
    assert.ok(structural.getText().includes("Hson.canonical`<solo/>`"), "Hson Format Document normalized same-line Hson trivia");
    assert.ok(structural.getText().includes("\n<main\n  <section\n  />\n/>"), `Hson Format Document composed Hson indentation edits: ${JSON.stringify(structural.getText())}`);
    assert.ok(structural.getText().includes("\n<\n  data 1\n  data2 2\n>"), `Hson Format Document applied multiline object layout: ${JSON.stringify(structural.getText())}`);
    assert.ok(structural.getText().includes("balanced = Hson.canonical`\n<\n  a <\n    b <c 1>\n  >\n  d 2\n>"), `Hson Format Document detached the multiline owner's closer while preserving its inline child: ${JSON.stringify(structural.getText())}`);
    assert.ok(structural.getText().includes("trailing = Hson.canonical`\n<\n  a <\n    b <\n      c <\n        value 1\n      >\n    >\n  >\n  d 2\n>"), `Hson Format Document separated parser-owned trailing closers: ${JSON.stringify(structural.getText())}`);
    await replaceDocument(structural, 'import { Hson } from "hson-live/hson";\nconst ordinary = [1, 2];\nconst arrays = Hson.canonical`[[1,2],"[literal]"]`;\n');
    await vscode.commands.executeCommand("hson.formatDocument");
    assert.ok(structural.getText().includes('Hson.canonical`««1,2»,"[literal]"»`'), "Hson Format Document canonicalizes only Hson array delimiters");
    assert.ok(structural.getText().includes("const ordinary = [1, 2];"), "Hson Format Document retains ordinary TypeScript arrays");
    await replaceDocument(structural, 'import { Hson } from "hson-live/hson";\nconst first = Hson.canonical`[1,2]`;\nconst second = Hson.canonical`[3,4]`;\n');
    const arraySelectionStart = structural.getText().indexOf("[1,2]");
    structuralEditor.selection = new vscode.Selection(structural.positionAt(arraySelectionStart), structural.positionAt(arraySelectionStart + 5));
    await vscode.commands.executeCommand("hson.formatSelection");
    assert.ok(structural.getText().includes("first = Hson.canonical`«1,2»`"), "Hson Format Selection canonicalizes the selected array");
    assert.ok(structural.getText().includes("second = Hson.canonical`[3,4]`"), "Hson Format Selection leaves the other array unchanged");

    const selectionInput = hostPrefix
      + "const first=Hson.canonical`\n <\na <\nb      <c   1>>\nd 2\n>\n`;\n"
      + "const second=Hson.canonical`\n <c 3\nd 4\n>\n`;\n";
    await replaceDocument(structural, selectionInput);
    const selectedStart = selectionInput.indexOf("\n <\n") + 1;
    const selectedEnd = selectionInput.indexOf("`;", selectedStart);
    structuralEditor.selection = new vscode.Selection(structural.positionAt(selectedStart), structural.positionAt(selectedEnd));
    await vscode.commands.executeCommand("hson.formatSelection");
    assert.ok(structural.getText().includes("first=Hson.canonical`\n<\n  a <\n    b <c 1>\n  >\n  d 2\n>"), `Hson Format Selection detached the selected multiline object's closer: ${JSON.stringify(structural.getText())}`);
    assert.ok(structural.getText().includes("second=Hson.canonical`\n <c 3\nd 4\n>"), "Hson Format Selection left the unselected object unchanged");

    await vscode.workspace.fs.writeFile(markdownStructuralUri, Buffer.from("Before\n```hson\n <data 1\ndata2 2\n>\n```\nAfter\n"));
    const markdownStructural = await vscode.workspace.openTextDocument(markdownStructuralUri);
    const markdownEdits = await vscode.commands.executeCommand<vscode.TextEdit[]>("vscode.executeFormatDocumentProvider", markdownStructural.uri, { insertSpaces: true, tabSize: 2 });
    const markdownEdit = new vscode.WorkspaceEdit();
    for (const edit of markdownEdits ?? []) markdownEdit.replace(markdownStructural.uri, edit.range, edit.newText);
    assert.equal(await vscode.workspace.applyEdit(markdownEdit), true);
    assert.ok(markdownStructural.getText().includes("```hson\n<\n  data 1\n  data2 2\n>\n```"), "Markdown format document used the shared multiline object layout");
    process.stdout.write("ok - real VS Code structural editing: valid/incomplete/parser-invalid/tokenizer-invalid/delimiter/string/comment/interpolation/outside Enter fallback; valid-invalid-valid recovery; pair and ordinary Backspace; formatting\n");
  } finally {
    await vscode.workspace.getConfiguration("hson.formatting", folder.uri)
      .update("formatOnSave", true, vscode.ConfigurationTarget.WorkspaceFolder).then(undefined, () => undefined);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.workspace.fs.delete(structuralUri).then(undefined, () => undefined);
    await vscode.workspace.fs.delete(markdownStructuralUri).then(undefined, () => undefined);
    await vscode.workspace.fs.delete(saveTypeScriptUri).then(undefined, () => undefined);
    await vscode.workspace.fs.delete(documentTypeScriptUri).then(undefined, () => undefined);
    await vscode.workspace.fs.delete(saveMarkdownUri).then(undefined, () => undefined);
    await vscode.workspace.fs.delete(invalidSaveUri).then(undefined, () => undefined);
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

  await localHostConfiguration.update("buildCommand", `${process.env.HSON_TEST_NODE_EXECUTABLE ?? "node"} build-local-app.mjs`, vscode.ConfigurationTarget.WorkspaceFolder);
  await localHostConfiguration.update("restartOnSave", true, vscode.ConfigurationTarget.WorkspaceFolder);
  await localHostConfiguration.update("sourceDirectory", "app-src", vscode.ConfigurationTarget.WorkspaceFolder);
  const buildUri = vscode.Uri.file(join(workspace, "local-app-build.txt"));
  const buildLog = async (): Promise<string[]> => {
    try { return Buffer.from(await vscode.workspace.fs.readFile(buildUri)).toString().trim().split("\n").filter(Boolean); }
    catch { return []; }
  };
  const source = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "app-src", "value.txt")));
  const saveValue = async (value: string): Promise<void> => {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(source.uri, new vscode.Range(source.positionAt(0), source.positionAt(source.getText().length)), `${value}\n`);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    assert.equal(await source.save(), true);
  };
  await vscode.commands.executeCommand("hson.startLocalHost", folder.uri);
  await saveValue("one");
  await waitFor(async () => (await lifecycle()).at(-1) === "start:one", "saved source did not produce a fresh Local App restart");
  assert.deepEqual((await buildLog()).slice(-2), ["build-start:one", "build-end:one"]);
  await saveValue("two");
  await saveValue("three");
  await waitFor(async () => (await lifecycle()).at(-1) === "start:three", "rapid saves did not settle on the latest output");
  const beforeFailure = await lifecycle();
  await saveValue("FAIL");
  await waitFor(async () => (await buildLog()).at(-1) === "build-fail", "failed build was not reported");
  assert.deepEqual(await lifecycle(), beforeFailure, "failed build restarted stale output");
  const beforeStop = await buildLog();
  await saveValue("after-stop");
  await vscode.commands.executeCommand("hson.stopLocalHost", folder.uri);
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.deepEqual(await buildLog(), beforeStop, "Stop left a pending save build active");
  assert.equal((await lifecycle()).at(-1), "stop");
  await vscode.commands.executeCommand("hson.startLocalHost", folder.uri);
  await vscode.commands.executeCommand("hson.copyLocalAppUrl", folder.uri);
  assert.match(await vscode.env.clipboard.readText(), /^http:\/\/127\.0\.0\.1:\d+\/$/);
  await vscode.commands.executeCommand("hson.stopAll");
  assert.equal((await lifecycle()).at(-1), "stop");
  await localHostConfiguration.update("restartOnSave", false, vscode.ConfigurationTarget.WorkspaceFolder);
  await localHostConfiguration.update("buildCommand", "", vscode.ConfigurationTarget.WorkspaceFolder);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(join(workspace, "dist", "local-app.mjs")), Buffer.from(`
import { appendFileSync } from "node:fs";
const lifecycle = ${JSON.stringify(lifecycleUri.fsPath)};
export function application() {
  appendFileSync(lifecycle, "start\\n");
  return { name: "vscode-integration", dispose() { appendFileSync(lifecycle, "stop\\n"); } };
}
`));
  process.stdout.write("ok - real VS Code save builds before restart, coalesces saves, keeps stale output on failure, cancels on Stop, and copies the current URL\n");

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
  assert.match(generatedSchemaDocument.getText(), /UserSchema = Hson\.schema`/);
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
  process.stdout.write("ok - real VS Code authored HsonSchema remains discoverable for completion, definition, references, rename, and hover without reload\n");

  const fixturePath = join(workspace, "diagnostics-alias.ts");
  const alias = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath));
  await vscode.window.showTextDocument(alias);
  const aliasDiagnostics = await diagnosticsFor(alias.uri, 1);
  assert.equal(aliasDiagnostics.length, 1);
  assert.equal(alias.getText(aliasDiagnostics[0]?.range), "+");

  const smokePath = join(workspace, "diagnostics-smoke.ts");
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
  await vscode.commands.executeCommand("vscode.executeHoverProvider", declarative.uri, new vscode.Position(0, 0));
  const associationDiagnostics = () => vscode.languages.getDiagnostics(declarative.uri)
    .filter(diagnostic => diagnostic.source === "hson-schema" && diagnostic.code === 95002
      && diagnostic.message.startsWith("Static Hson does not satisfy UserSchema:"));
  const waitAssociationDiagnostics = async (count: number): Promise<readonly vscode.Diagnostic[]> => {
    const deadline = Date.now() + 30_000;
    while (associationDiagnostics().length !== count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(associationDiagnostics().length, count, `declarative Schema association diagnostics: ${JSON.stringify({ diagnostics: vscode.languages.getDiagnostics(declarative.uri).map(diagnostic => ({ source: diagnostic.source, code: diagnostic.code, message: diagnostic.message })), language: declarative.languageId, validate: vscode.workspace.getConfiguration("typescript", declarative.uri).get("validate.enable"), extension: vscode.extensions.getExtension("vscode.typescript-language-features")?.isActive, folder: vscode.workspace.getWorkspaceFolder(declarative.uri)?.uri.fsPath })}`);
    return associationDiagnostics();
  };
  const invalidAssociation = (await waitAssociationDiagnostics(1))[0]!;
  assert.match(invalidAssociation.message, /Static Hson does not satisfy UserSchema/);
  const invalidValue = declarative.getText().indexOf('"37"');
  assert.ok(invalidValue >= 0);
  const correct = new vscode.WorkspaceEdit();
  correct.replace(declarative.uri, new vscode.Range(declarative.positionAt(invalidValue), declarative.positionAt(invalidValue + 4)), "37");
  assert.equal(await vscode.workspace.applyEdit(correct), true);
  assert.equal(declarative.isDirty, true, "declarative candidate correction remains unsaved");
  await vscode.commands.executeCommand("typescript.restartTsServer");
  await waitAssociationDiagnostics(0);
  process.stdout.write("ok - real VS Code authored HsonSchema: candidate diagnostic clears after unsaved correction\n");

  await vscode.commands.executeCommand("hson.startLocalHost", folder.uri);
  await waitFor(async () => (await lifecycle()).at(-1) === "start", "local host did not start for extension deactivation coverage");
  process.stdout.write("ok - real VS Code local host left running for extension deactivation cleanup\n");

}
