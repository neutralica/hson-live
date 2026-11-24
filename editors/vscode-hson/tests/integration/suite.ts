import assert from "node:assert/strict";
import { join } from "node:path";
import ts from "typescript";

import * as vscode from "vscode";
import { parse_authored_event } from "../../../../src/internal/authored-events.js";
import { nativeCompositionSupported } from "./native-composition.js";
import { ui } from "./appearance.js";

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
    { label: 'bare incoming placeholder', body: 'document`<span title=%|/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'bare local placeholder', body: 'document`<span title=^|/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'local placeholder', body: 'document`<span title="^|"/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'structural Document reference', body: 'document`<main doc:c="%{control}" <hson-part ^|/>/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'attribute after partial quote', body: 'document`<span title="${first} partial" next|/>`;', typed: '=', inserted: '=""', delta: 2, close: '"' },
    { label: 'partial quoted content', body: 'document`<span "before $|"/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'partial quoted attribute', body: 'document`<span title="$|after"/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'adjacent partial quoted expression', body: 'document`<span title="pre${first}$|suffix"/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
    { label: 'placeholder after partial quote', body: 'document`<span "${first} %|"/>`;', typed: '{', inserted: '{}', delta: 1, close: '}' },
  ];
  for (const sigil of ['%', '^']) {
    for (const name of ['style', 'hson:part']) {
      const before = await setup(prefix + 'document`<span ' + name + '=' + sigil + '|/>`;');
      selectionAt(before.offset);
      await vscode.commands.executeCommand('type', { text: '{' });
      assert.equal(document.getText(), before.text.slice(0, before.offset) + '{' + before.text.slice(before.offset), `${name}=${sigil}: native typing inserts one literal brace and preserves surrounding source`);
      selectionAt(before.offset + 1);
      assert.ok(!document.getText().includes('hson_editor_probe'));
      process.stdout.write(`ok - ${name}=${sigil}: native literal fallback source and cursor\n`);
    }
  }
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
  for (const body of ['document`<span title=%|model.items[0].label}/>`;', 'document`<span title=^|}/>`;', 'data`$|}`;', 'document`<span "%|}"/>`;', 'data`$|fn({ value: 1 })}`;', 'document`<span "%|name}"/>`;',
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
  const heading = 'Hson.document`<h1 hson:part title="%{Title-Case}" "%{content}"/>`';
  const typed = 'Hson.document`<p hson:part str:label=%{headline} "^{label}"/>`';
  const parts = 'import { Hson } from "hson-live";\nexport const parts = { heading: { kind: "document", document: ' + heading
    + ' }, nav: { kind: "document", document: Hson.document`<nav hson:part "%{current}"/>` }, structured: { kind: "document", document: Hson.document`<p hson:part data:local=%{payload} "^{local}"/>` }, structure: { kind: "document", document: Hson.document`<main hson:part doc:local=%{content} <hson-part ^{local}/>/>` },'
    + ' typed: { kind: "document", document: ' + typed + ' } } as const;';
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
    ['<hson-part at="components/structured" pay|load-old="1"/>', 'payload:data', '<hson-part at="components/structured" payload:data="1"/>'],
    ['<hson-part at="components/structure" con|tent-old="<b/>"/>', 'content:doc', '<hson-part at="components/structure" content:doc="<b/>"/>'],
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
    ['<main doc:control="%{control}" <hson-part ^{co|}/>/>' , 'control', '<main doc:control="%{control}" <hson-part ^{control}/>/>' ],
    ['<main data:d="%{payload}" "^{d.title}" "^{d.ti|}"/>' , 'd.title', '<main data:d="%{payload}" "^{d.title}" "^{d.title}"/>' ],
    ...['for:item', 'for:data', 'for:doc', 'for:item:doc', 'per:doc', 'per:key:doc'].map(directive => [
      `<main hson:part data:rows=%{rows} <hson-part ${directive}=^{ro|} at=leaf/>/>`, 'rows',
      `<main hson:part data:rows=%{rows} <hson-part ${directive}=^{rows} at=leaf/>/>`,
    ]),
    ['<main hson:part data:model=%{payload} <hson-part at=leaf one:data=^{mo|}/>/>' , 'model', '<main hson:part data:model=%{payload} <hson-part at=leaf one:data=^{model}/>/>' ],
    ['<main hson:part doc:nav=%{content} <hson-part at=leaf onload:doc=^{na|}/>/>' , 'nav', '<main hson:part doc:nav=%{content} <hson-part at=leaf onload:doc=^{nav}/>/>' ],
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
  const writeSetup = 'import { Hson, hsonLiveMap } from "hson-live";\r\nimport { parts } from "./parts.js";\r\n'
    + 'const loc = hsonLiveMap.fromLibraries({ components: { parts }, owned: { parts: {'
    + ' heading: { kind: "document", document: ' + heading + ' }, typed: { kind: "document", document: ' + typed + ' } } } });\r\n';
  const writePrefix = writeSetup + 'const owned = loc.parts.owned; owned.heading.write({ ';
  for (const [input, label, expected, finish] of [
    ['Tit|', 'Title-Case', '"Title-Case": "|"'],
    ['Tit|leOld: "kept"', 'Title-Case', '"Title-Case"|: "kept"'],
    ['"Tit|leOld": "kept"', 'Title-Case', '"Title-Case|": "kept"'],
    [String.raw`'\u0054it|': "kept"`, 'Title-Case', "'Title-Case|': \"kept\""],
    ['con|', 'content', 'content|'],
    ['before() {}, Tit|leOld: "kept", get after() { return 1; }', 'Title-Case', 'before() {}, "Title-Case"|: "kept", get after() { return 1; }'],
    ['before() {}, "Tit|leOld": "kept", set after(value: string) {}', 'Title-Case', 'before() {}, "Title-Case|": "kept", set after(value: string) {}'],
    ['Tit|: /* keep */', 'Title-Case', '"Title-Case"|: /* keep */', ' 1'],
    ['"Tit|"', 'Title-Case', '"Title-Case|"', ': 1'],
    ['Tit|leOld: true ? "one" : "two", tail: value!', 'Title-Case', '"Title-Case"|: true ? "one" : "two", tail: value!'],
  ]) {
    const marked = writePrefix + input + ' });';
    await replace(document, marked.replace('|', ''));
    const editor = await vscode.window.showTextDocument(document);
    const cursor = document.positionAt(marked.indexOf('|'));
    editor.selection = new vscode.Selection(cursor, cursor);
    const item = await completions(marked.indexOf('|'), label);
    const range = item.textEdit?.range ?? (item.range instanceof vscode.Range ? item.range : item.range?.replacing);
    const insertion = item.insertText ?? item.textEdit?.newText;
    assert.ok(range); assert.ok(insertion);
    const snippet = insertion instanceof vscode.SnippetString ? insertion : new vscode.SnippetString().appendText(insertion);
    assert.equal(await editor.insertSnippet(snippet, range), true);
    assert.equal(document.getText(), writePrefix + expected.replace('|', '') + ' });');
    assert.equal(document.offsetAt(editor.selection.active), writePrefix.length + expected.indexOf('|'));
    assert.equal(editor.selection.isEmpty, true);
    if (finish) assert.ok(await editor.edit(edit => edit.insert(document.positionAt(document.getText().length - 4), finish)));
    assert.deepEqual(ts.transpileModule(document.getText(), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }, reportDiagnostics: true }).diagnostics, []);
  }
  process.stdout.write('ok - real VS Code write key completions preserve names, values, syntax and native snippet cursors\n');
  for (const input of ['Tit|() {}', 'get Tit|() { return "kept"; }', 'set Tit|(value: string) {}', '"Tit|"() {}', 'get "Tit|"() { return 1; }', 'Tit|(',
    'Tit|?', 'Tit|!', 'Tit| = "kept"', 'Tit| =', 'Tit|?: 1', 'Tit|!: 1', '"Tit|"?', "'Tit|'!: 1",
    'readonly Tit|', 'public Tit|: 1', 'async Tit|', 'Tit|.', 'Tit|=>', 'Tit| as string', 'Tit| satisfies string']) {
    const marked = writePrefix + input + ' });';
    await replace(document, marked.replace('|', ''));
    const editor = await vscode.window.showTextDocument(document), cursor = document.positionAt(marked.indexOf('|'));
    editor.selection = new vscode.Selection(cursor, cursor);
    const result = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', uri, cursor, undefined, 100);
    assert.ok(!result?.items.some(item => /Part argument from the authored definition/.test(item.detail ?? '')), input);
    assert.equal(document.getText(), marked.replace('|', ''));
    assert.equal(document.offsetAt(editor.selection.active), marked.indexOf('|')); assert.ok(editor.selection.isEmpty);
  }
  process.stdout.write('ok - real VS Code write key completions exclude method and accessor contexts\n');

  const writes = writeSetup + 'loc.parts.components.typed.write({ headline: 41 });\r\nloc.parts.owned.typed.write({ headline: 42 });\r\n'
    + 'loc.parts.components.heading.write({ Tit });\r\nloc.parts.owned.heading.write({ Tit });';
  await replace(document, writes);
  await completions(writes.lastIndexOf("{ Tit") + "{ Tit".length, "Title-Case");
  const importedKeys = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider",
    uri, document.positionAt(writes.indexOf("{ Tit") + "{ Tit".length), undefined, 100);
  assert.ok(importedKeys);
  assert.ok(!importedKeys.items.some(item => /Part argument from the authored definition/.test(item.detail ?? "")));
  const writeDiagnostics = () => vscode.languages.getDiagnostics(uri)
    .filter(issue => issue.source === "hson-schema" && issue.message.startsWith("Part.write "));
  await waitFor(() => writeDiagnostics().some(issue => document.getText(issue.range) === "42"), "Missing inline Part.write diagnostic");
  const invalid = writes.indexOf("42");
  assert.deepEqual(writeDiagnostics().map(issue => [
    issue.code, issue.message, document.offsetAt(issue.range.start), document.offsetAt(issue.range.end),
  ]), [[95002, 'Part.write argument "headline" requires a string.', invalid, invalid + 2]]);
  process.stdout.write("ok - imported Part write authority is unavailable while the inline peer completes and diagnoses its exact value\n");

  const body = '<hson-part lib="components" at="he|"/>';
  await replace(document, prefix + body.replace("|", "") + suffix);
  await completions(prefix.length + body.indexOf("|"), "heading");
  const imported = await vscode.workspace.openTextDocument(producer);
  const definitions = async () => vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
    "vscode.executeDefinitionProvider", producer, imported.positionAt(parts.indexOf("^{local}") + 2));
  await vscode.window.showTextDocument(imported);
  await waitFor(async () => Boolean((await definitions())?.length), "Missing imported Part lexical definition");
  const declaration = parts.indexOf("data:local") + "data:".length;
  assert.deepEqual((await definitions())?.map(item => {
    const range = "targetUri" in item ? item.targetSelectionRange ?? item.targetRange : item.range;
    return [("targetUri" in item ? item.targetUri : item.uri).toString(), imported.offsetAt(range.start), imported.offsetAt(range.end)];
  }), [[producer.toString(), declaration, declaration + "local".length]]);
  await vscode.window.showTextDocument(document);
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

async function runEventAuthoring(workspace: string, extensionPath: string, rendered: boolean): Promise<void> {
  const root = vscode.Uri.file(join(workspace, "event-authoring"));
  const uri = vscode.Uri.joinPath(root, "authoring.ts");
  const entrypoint = vscode.Uri.joinPath(root, "package");
  const bridge = vscode.Uri.joinPath(entrypoint, "src/index.ts");
  const fallback = vscode.Uri.joinPath(entrypoint, "src/fallback.ts");
  const write = (file: vscode.Uri, text: string) => vscode.workspace.fs.writeFile(file, Buffer.from(text));
  const genuine = 'export { Hson } from "hson-live";';
  const substitute = 'export const Hson = { event: String.raw };';
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(entrypoint, "src"));
  await write(vscode.Uri.joinPath(entrypoint, "package.json"), '{"name":"hson-live","type":"module"}');
  await write(vscode.Uri.joinPath(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", types: [], strict: true,
      // A deleted path mapping would otherwise resolve to the genuine npm subpath.
      paths: { "hson-live/hson": ["./package/src/index.ts", "./package/src/fallback.ts"] } }, include: ["*.ts"],
  }));
  await write(vscode.Uri.joinPath(root, "package.json"), '{"type":"module"}');
  await write(fallback, substitute);
  await write(bridge, genuine);
  const prefix = 'import { Hson, hsonLiveMap } from "hson-live";\r\nimport { Hson as E } from "hson-live/hson";\r\n'
    + 'export const go = E.event`<hson:event on:pointer:d local:deck.move\r\n  note:str="é🧪" x:num=^{pointer.clientXx} selection:data=^{row.label} <>>`;\r\n';
  const attachment = 'hsonLiveMap.fromLibraries({ bits: { parts: { card: { kind: "document", document: '
    + 'Hson.document`<button hson:part data:row=%{rows} event:go/>`, events: {go} } } } });';
  await write(uri, prefix + attachment);
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const labels = async (offset: number) => {
    const result = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider",
      uri, document.positionAt(offset));
    return result?.items ?? [];
  };
  const name = (item: vscode.CompletionItem) => typeof item.label === "string" ? item.label : item.label.label;
  const offsetAfter = (text: string) => document.getText().indexOf(text) + text.length;
  const moveCursor = (offset: number) => {
    const position = document.positionAt(offset);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
  };
  const requireCompletion = async (at: number, label: string) => {
    let items: vscode.CompletionItem[] = [];
    try {
      await waitFor(async () => (items = await labels(at)).some(item => name(item) === label), `Missing Event completion ${label}`);
    } catch (error) {
      throw new Error(`Event completion at ${at} returned ${JSON.stringify(items.map(name))}`, { cause: error });
    }
    return items.find(item => name(item) === label);
  };
  type SelectedSuggestion = { id: string; label: string };
  const selectedSuggestion = async (previous?: string) => {
    const observed: { selected?: SelectedSuggestion } = {};
    await waitFor(async () => {
      const selected = await ui<SelectedSuggestion | null>(workspace, { action: "selected-suggestion" });
      if (selected === null || selected.id === previous) return false;
      observed.selected = selected;
      return true;
    }, "Completion widget did not focus a suggestion");
    assert.ok(observed.selected);
    return observed.selected;
  };
  const accept = async (at: number, label: string, expected: string, cursor: number) => {
    await requireCompletion(at, label);
    await vscode.commands.executeCommand("hideSuggestWidget");
    moveCursor(at);
    await ui(workspace, { action: "focus-editor" });
    await vscode.commands.executeCommand("editor.action.triggerSuggest");
    let selected = await selectedSuggestion();
    const visited = new Map<string, string>();
    while (selected.label !== label) {
      assert.ok(!visited.has(selected.id), `Missing widget suggestion ${label}; visited ${JSON.stringify([...visited.values()])}`);
      visited.set(selected.id, selected.label);
      await ui(workspace, { action: "editor-key", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
      selected = await selectedSuggestion(selected.id);
    }
    await ui(workspace, { action: "editor-key", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
    await waitFor(() => document.getText() === expected && document.offsetAt(editor.selection.active) === cursor,
      `Widget did not apply ${selected.label} at ${at}; expected caret ${cursor}`);
    assert.equal(document.getText(), expected, `Suggestion widget inserted ${label}`);
    assert.equal(document.offsetAt(editor.selection.active), cursor);
    assert.equal(editor.selection.isEmpty, true);
  };
  const hsonIssues = () => vscode.languages.getDiagnostics(uri).filter(issue => issue.source === "Hson");
  const replacement = async (at: number, label: string): Promise<readonly [number, number]> => {
    const item = await requireCompletion(at, label);
    assert.ok(item?.range);
    const range = "replacing" in item.range ? item.range.replacing : item.range;
    return [document.offsetAt(range.start), document.offsetAt(range.end)];
  };
  await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_EVENT_DECLARATION_INVALID"), "Missing incomplete Event diagnostic");
  let expected = document.getText().replace("on:pointer:d ", "on:pointer:down ");
  await accept(offsetAfter("on:pointer:d"), "on:pointer:down", expected, expected.indexOf("on:pointer:down") + "on:pointer:down".length);
  await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_EVENT_REFERENCE_INVALID"), "Missing invalid native path diagnostic");
  expected = expected.replace("pointer.clientXx", "pointer.clientX");
  await accept(offsetAfter("pointer.clientX"), "pointer.clientX", expected, expected.indexOf("pointer.clientX}") + "pointer.clientX}".length);
  await waitFor(() => hsonIssues().length === 0, "Event syntax diagnostics did not clear");
  const definitions = (offset: number) => vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
    "vscode.executeDefinitionProvider", uri, document.positionAt(offset));
  const partDefinition = async () => (await definitions(offsetAfter("selection:data=^{")))?.some(definition => {
    const range = "targetUri" in definition ? definition.targetSelectionRange ?? definition.targetRange : definition.range;
    const target = "targetUri" in definition ? definition.targetUri : definition.uri;
    return target.toString() === uri.toString() && document.offsetAt(range.start) === offsetAfter("data:row") - "row".length;
  }) ?? false;
  await waitFor(partDefinition, "Missing proven Event Part-local definition");
  console.log("ok - Event suggestion widget accepts a selector and mid-token native path with exact source/cursor and definition");

  const roles = [
    ["down", "hsonEventSelectorName"], ["deck.move", "hsonEventAction"],
    ["num", "hsonEventQualifier"], ["clientX", "hsonEventNativeProperty"],
  ] as const;
  const semantic = async () => {
    const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>("vscode.provideDocumentSemanticTokensLegend", uri);
    const data = await vscode.commands.executeCommand<vscode.SemanticTokens>("vscode.provideDocumentSemanticTokens", uri);
    let line = 0, character = 0;
    const tokens = new Map<number, { type: string | undefined; length: number }>();
    if (!legend || !data) return tokens;
    for (let index = 0; index < data.data.length; index += 5) {
      const delta = data.data[index]!;
      line += delta;
      character = (delta ? 0 : character) + data.data[index + 1]!;
      tokens.set(document.offsetAt(new vscode.Position(line, character)), {
        type: legend.tokenTypes[data.data[index + 3]!], length: data.data[index + 2]!,
      });
    }
    return tokens;
  };
  if (rendered) {
    await waitFor(async () => {
      const tokens = await semantic();
      return roles.every(([spelling, type]) => {
        const token = tokens.get(document.getText().indexOf(spelling));
        return token?.type === type && token.length === spelling.length;
      });
    }, "Missing exact Event semantic roles");
    const theme = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(
      join(extensionPath, "themes", "hson-house-dark-color-theme.json")))).toString()).semanticTokenColors;
    const response = vscode.Uri.file(join(workspace, "binding-color-response.json"));
    const report = async (id: string, foregrounds: readonly string[]) => {
      const tokens = roles.map(([spelling], index) => {
        const position = document.positionAt(document.getText().indexOf(spelling));
        const hex = foregrounds[index]!;
        return { lineText: document.lineAt(position.line).text, character: position.character, length: spelling.length,
          expected: `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(", ")})` };
      });
      await write(vscode.Uri.file(join(workspace, "binding-color-request.json")), JSON.stringify({ id, pairs: [], tokens }));
      let colors: { id: string; colors: string[]; error?: string } | undefined;
      await waitFor(async () => {
        try { colors = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(response)).toString()); return colors?.id === id; }
        catch { return false; }
      }, `Missing rendered Event color report: ${id}`);
      assert.equal(colors?.error, undefined);
      return colors!.colors;
    };
    const houseColors = roles.map(([, role]) => String(theme[role]));
    assert.equal(new Set(await report("event-house", houseColors)).size, roles.length);
    console.log("ok - rendered selector, Action key, qualifier and native property are distinct in the same Event");
    const appearance = vscode.workspace.getConfiguration("hson.appearance", document);
    const overrides = {
      "event.selectorName": { dark: { foreground: "#272829" } },
      "event.action": { dark: { foreground: "#272829" } },
      "event.qualifier": { dark: { foreground: "#414243" } },
      "event.nativeProperty": { dark: { foreground: "#121314" } },
    };
    await appearance.update("state", { palettes: [], assignments: { all: "native" }, overrides: { all: overrides } },
      vscode.ConfigurationTarget.Workspace);
    try {
      const colors = await report("event-appearance", Object.values(overrides).map(style => style.dark.foreground));
      assert.equal(colors[0], colors[1]);
    } finally {
      await appearance.update("state", undefined, vscode.ConfigurationTarget.Workspace);
    }
    console.log("ok - rendered Event Appearance honors identical and low-contrast overrides");
  }

  const rawOperation = '<hson:event on:formdata host:save field:str=^{formdata:ge} <>>';
  const line = 'const form = Hson.event`' + rawOperation + '`;';
  assert.equal(await editor.edit(edit => edit.insert(document.positionAt(document.getText().length), '\r\n' + line)), true);
  const operationAt = offsetAfter("formdata:ge");
  const withOperation = document.getText().replace("formdata:ge}", 'formdata:get("")}');
  await accept(operationAt, "formdata:get", withOperation, withOperation.indexOf('formdata:get("') + 'formdata:get("'.length);
  await vscode.commands.executeCommand("type", { text: "email" });
  assert.ok(document.getText().includes('^{formdata:get("email")} <>>`;'));
  await waitFor(() => hsonIssues().length === 0, "Inserted FormData operation was rejected");
  console.log("ok - raw FormData operation snippet retains quotes, brace, field cursor and native typing");

  const expectEvidence = async (admitted: boolean, label: string) => {
    let observed;
    try {
      await waitFor(async () => {
        const completion = (await labels(offsetAfter("on:pointer:d"))).some(item => name(item) === "on:pointer:down");
        const definition = await partDefinition();
        const actionToken = rendered ? (await semantic()).get(document.getText().indexOf("deck.move"))?.type === "hsonEventAction" : undefined;
        observed = { completion, definition, actionToken };
        return completion === admitted && definition === admitted && (!rendered || actionToken === admitted);
      }, label);
    } catch (error) {
      throw new Error(`${label}; expected ${admitted}, observed ${JSON.stringify(observed)}`, { cause: error });
    }
    console.log("Event dependency evidence", label, JSON.stringify(observed));
  };
  const version = document.version;
  const bindsTo = async (file: vscode.Uri) => (await definitions(offsetAfter("const go = E") - 1))?.some(definition =>
    ("targetUri" in definition ? definition.targetUri : definition.uri).toString() === file.toString()) ?? false;
  await write(bridge, substitute);
  // Evidence is withdrawn as soon as the producer changes. Before the next
  // write, require tsserver to have recognized the replacement binding.
  await waitFor(() => bindsTo(bridge), "TypeScript did not see the substitute re-export");
  await expectEvidence(false, "substitute re-export");
  await write(bridge, genuine);
  await expectEvidence(true, "restore re-export");
  await vscode.workspace.fs.delete(bridge);
  await waitFor(() => bindsTo(fallback), "TypeScript did not resolve the fallback after deleting the re-export");
  await expectEvidence(false, "delete re-export");
  await write(bridge, genuine);
  await expectEvidence(true, "recreate re-export");
  assert.equal(document.version, version);
  await vscode.commands.executeCommand("typescript.restartTsServer");
  await waitFor(async () => (await labels(offsetAfter("on:pointer:d"))).some(item => name(item) === "on:pointer:down"),
    "Event completion did not recover after plugin reload");
  console.log("ok - unchanged Event consumer withdraws and restores completion, navigation and highlighting across dependency edits and plugin reload");

  const editPrefix = 'import { Hson, hsonLiveTree } from "hson-live";\r\nconst e = Hson.event`';
  const editSuffix = '`;\r\nconst after = 42;\r\n';
  const setSource = async (text: string) => {
    assert.equal(await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0),
      document.positionAt(document.getText().length)), text)), true);
  };
  const quoted = '<hson:event on:click local:go x:bool="';
  const withEscapes = '<hson:event on:click local:go\r\n note:str="🧪\\\"ok" x:bool="';
  for (const [body, tail, hasQuote] of [
    [quoted, ' once <>>', false], [quoted, ' n:num="7" <>>', false],
    [withEscapes, ' window capture <>>', false], [withEscapes, '" once <>>', true],
  ] as const) {
    const before = editPrefix + body;
    await setSource(before + "true" + tail + editSuffix);
    if (!hasQuote) await waitFor(() => hsonIssues().length > 0, "Missing immediate diagnostic for incomplete Boolean");
    const insert = hasQuote ? "true" : 'true"';
    await accept(before.length + 2, "true", before + insert + tail + editSuffix, before.length + insert.length);
    await waitFor(() => hsonIssues().length === 0, "Repaired Boolean did not pass tagged Event admission");
  }
  const beforeOption = editPrefix + "<hson:event on:click local:go ";
  await setSource(beforeOption + "once <>>" + editSuffix);
  const atOption = beforeOption.length;
  const insertion = "stopImmediateProp ";
  await waitFor(async () => {
    const item = (await labels(atOption)).find(item => name(item) === "stopImmediateProp");
    if (item?.range === undefined) return false;
    const range = "replacing" in item.range ? item.range.replacing : item.range;
    return range.isEmpty && document.offsetAt(range.start) === atOption;
  }, "Expected an insertion gap before once");
  assert.ok(!(await labels(atOption)).some(item => name(item) === "once"));
  await accept(atOption, "stopImmediateProp", beforeOption + insertion + "once <>>" + editSuffix, atOption + insertion.length);
  await waitFor(() => hsonIssues().length === 0, "Inserted listener option invalidated the Event");
  console.log("ok - Event suggestion acceptance preserves Boolean neighbors, once, CRLF, escaped quotes and the caret");

  const recovery = editPrefix + '// 🧪\r\n<hson:event on:key:up local:go broken:bool="tr';
  const surviving = ' native:bool=^{key.repeat} once window <>>';
  const partial = recovery + surviving + editSuffix;
  await setSource(partial);
  await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_STRING_UNTERMINATED"), "Recovery must preserve the strict quote error");
  await waitFor(async () => (await labels(partial.indexOf("repeat") + 2)).some(item => name(item) === "key.repeat"), "Native lookup after a missing Boolean quote");
  assert.ok((await labels(partial.indexOf("once"))).some(item => name(item) === "capture"));
  const recoveredRoles = async () => {
    const current = document.getText();
    const tokens = await semantic();
    return [["repeat", "hsonEventNativeProperty"], ["once", "hsonEventOption"], ["window", "hsonEventOption"]]
      .every(([word, type]) => tokens.get(current.indexOf(word!))?.type === type);
  };
  if (rendered) await waitFor(recoveredRoles, "Event suffix roles before Boolean correction");
  const repaired = recovery + 'ue"' + surviving + editSuffix;
  assert.deepEqual(await replacement(recovery.length, "true"), [recovery.length - 2, recovery.length]);
  await accept(recovery.length, "true", repaired, recovery.length + 3);
  await waitFor(() => hsonIssues().length === 0, "Boolean quote correction must pass strict admission");
  if (rendered) await waitFor(recoveredRoles, "Event suffix roles after Boolean correction");

  const ambiguous = recovery + ' once\r\n native:bool=^{key.repeat} window <>>" <>>' + editSuffix;
  await setSource(ambiguous);
  await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_STRING_CONTROL_UNESCAPED"), "Ambiguous multiline Boolean must retain its strict quote error");
  assert.ok(!(await labels(ambiguous.indexOf("repeat") + 2)).some(item => name(item) === "key.repeat"));
  assert.ok(!(await labels(recovery.length)).some(item => name(item) === "true"));
  if (rendered) {
    const roles = await semantic();
    assert.notEqual(roles.get(ambiguous.indexOf("repeat"))?.type, "hsonEventNativeProperty");
    assert.notEqual(roles.get(ambiguous.indexOf("once"))?.type, "hsonEventOption");
  }

  const quotedSuffix = '\r\n // keep "quoted" 🧭\r\n native:bool=^{key["repeat"]} note:str=" a 🧪" once window <>>';
  const quotedDraft = recovery + quotedSuffix + editSuffix;
  await setSource(quotedDraft);
  await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_STRING_CONTROL_UNESCAPED"), "Expected strict diagnostic before repair");
  await waitFor(async () => (await labels(quotedDraft.indexOf("repeat") + 2)).some(item => name(item) === "key.repeat"),
    "Expected bracket lookup after a damaged Boolean");
  if (rendered) await waitFor(async () => {
    const roles = await semantic();
    return roles.get(quotedDraft.indexOf("repeat"))?.type === "hsonEventNativeProperty"
      && roles.get(quotedDraft.indexOf(" a 🧪"))?.type === "hsonEventString"
      && roles.get(quotedDraft.indexOf("window"))?.type === "hsonEventOption";
  }, "Missing bounded quoted Event suffix roles");
  assert.deepEqual(await replacement(recovery.length, "true"), [recovery.length - 2, recovery.length]);
  await accept(recovery.length, "true", recovery + 'ue"' + quotedSuffix + editSuffix, recovery.length + 3);
  await waitFor(() => hsonIssues().length === 0, "Quoted suffix must pass strict admission after repair");
  const unclosed = recovery + ' once note:str=" a 🧪 window <>>' + editSuffix;
  await setSource(unclosed);
  await waitFor(() => hsonIssues().length > 0, "Expected strict diagnostic for the ambiguous suffix");
  assert.ok(!(await labels(recovery.length)).some(item => name(item) === "true"));
  if (rendered) assert.notEqual((await semantic()).get(unclosed.indexOf("once"))?.type, "hsonEventOption");
  console.log("ok - real Event recovery preserves bracket, comment and string boundaries and withholds an unclosed suffix");

  const closed = recovery + ' once //" window <>>' + editSuffix;
  await setSource(closed);
  await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_EVENT_DECLARATION_INVALID"), "Invalid closed Boolean must keep its strict diagnostic");
  assert.ok(!(await labels(recovery.length)).some(item => name(item) === "true"));
  assert.ok((await labels(closed.indexOf("window"))).some(item => name(item) === "capture"));
  if (rendered) await waitFor(async () => {
    const roles = await semantic();
    return roles.get(recovery.length - 2)?.type === "hsonEventString"
      && roles.get(closed.indexOf('" window'))?.type === "hsonEventQuote"
      && roles.get(closed.indexOf("window"))?.type === "hsonEventOption"
      && roles.get(closed.indexOf("once"))?.type !== "hsonEventOption";
  }, "Closed invalid Boolean lost its lexical ownership");

  const adjacentPrefix = recovery.replace('broken:bool="tr', 'broken:bool="fa');
  const adjacent = adjacentPrefix + ' capture //"junk\r\n lookup:bool=^{key.repeat} <>>' + editSuffix;
  await setSource(adjacent);
  await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_EVENT_DECLARATION_INVALID"), "Missing separator error after the closed quote");
  assert.ok(!(await labels(adjacentPrefix.length)).some(item => name(item) === "false"));
  if (rendered) await waitFor(async () => {
    const roles = await semantic();
    return roles.get(adjacentPrefix.length - 2)?.type === "hsonEventString"
      && roles.get(adjacent.indexOf('"junk'))?.type === "hsonEventQuote"
      && roles.get(adjacent.indexOf("capture"))?.type !== "hsonEventOption"
      && roles.get(adjacent.indexOf('//"junk'))?.type !== "hsonEventComment";
  }, "Adjacent malformed syntax changed a closed operand's roles");

  const boundedLookup = ' lookup:bool=^{key["repeat"]} bogus <>>';
  const unknown = adjacentPrefix + boundedLookup + editSuffix;
  await setSource(unknown);
  await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_EVENT_DECLARATION_INVALID"), "Missing malformed Event diagnostic");
  const lookupAt = unknown.indexOf("repeat");
  await waitFor(async () => (await labels(lookupAt + 2)).some(item => name(item) === "key.repeat"), "Unknown item hid the preceding lookup");
  if (rendered) await waitFor(async () => (await semantic()).get(lookupAt)?.type === "hsonEventNativeProperty", "Unknown item hid native property coloring");
  assert.deepEqual(await replacement(adjacentPrefix.length, "false"), [adjacentPrefix.length - 2, adjacentPrefix.length]);
  const fixedPrefix = adjacentPrefix + 'lse"';
  await accept(adjacentPrefix.length, "false", fixedPrefix + boundedLookup + editSuffix, fixedPrefix.length);
  await waitFor(() => hsonIssues().some(issue => issue.message.includes('Unsupported authored event header item "bogus"')),
    "The neighboring unknown item must still fail strict admission");
  if (rendered) await waitFor(async () => (await semantic()).get(lookupAt + 4)?.type === "hsonEventNativeProperty", "The exact edit lost native property coloring");
  console.log("ok - closed Event quotes and recovered lookups retain ownership in the widget and Semantic Tokens");

  const laterError = '\r\n lookup:bool=^{key["repeat"]} once\r\n note:str="unfinished window <>>';
  const incremental = recovery + laterError + editSuffix;
  await setSource(incremental);
  await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_STRING_CONTROL_UNESCAPED"), "Missing first strict string diagnostic");
  await waitFor(async () => (await labels(incremental.indexOf("repeat") + 2)).some(item => name(item) === "key.repeat"), "Later error hid a bounded lookup");
  assert.ok((await labels(incremental.indexOf("once"))).some(item => name(item) === "capture"));
  if (rendered) await waitFor(async () => {
    const roles = await semantic();
    return roles.get(incremental.indexOf("repeat"))?.type === "hsonEventNativeProperty"
      && roles.get(incremental.indexOf("once"))?.type === "hsonEventOption"
      && roles.get(incremental.indexOf("window"))?.type !== "hsonEventOption";
  }, "Later error hid or invented Event roles");
  assert.deepEqual(await replacement(recovery.length, "true"), [recovery.length - 2, recovery.length]);
  await accept(recovery.length, "true", recovery + 'ue"' + laterError + editSuffix, recovery.length + 3);
  await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_STRING_UNTERMINATED"), "Later string must still fail strict admission");
  console.log("ok - Event quote ownership and incremental recovery agree with widget edits, Semantic Tokens and strict errors");

  for (const [value, code] of [
    ['"tr\r\n capture bogus "', "HSON_STRING_CONTROL_UNESCAPED"],
    ['"tr\n capture bogus "', "HSON_STRING_CONTROL_UNESCAPED"],
    [String.raw`"tr \z \"capture\" 🧪"`, "invalid-json-escape"],
  ] as const) {
    const prefix = editPrefix + '<hson:event on:key:up local:go bad:bool=' + value;
    await setSource(prefix + ' lookup:bool=^{key.repeatx} window <>>' + editSuffix);
    const source = document.getText();
    await waitFor(() => hsonIssues().some(issue => issue.code === code), "Expected strict malformed quote diagnostic");
    assert.ok(!(await labels(source.indexOf('"tr') + 3)).some(item => name(item) === "true"));
    if (rendered) await waitFor(async () => {
      const roles = await semantic();
      return roles.get(source.indexOf(' lookup:bool') - 1)?.type === "hsonEventQuote"
        && roles.get(source.indexOf("repeatx"))?.type === "hsonEventNativeProperty"
        && roles.get(source.indexOf("capture"))?.type !== "hsonEventOption";
    }, "Malformed closed quote lost its ownership or the later lookup");
    const at = source.indexOf("repeatx");
    const fixedLookup = source.replace("repeatx", "repeat");
    assert.deepEqual(await replacement(at + 2, "key.repeat"), [at - "key.".length, at + "repeatx}".length]);
    await accept(at + 2, "key.repeat", fixedLookup, fixedLookup.indexOf("repeat}") + "repeat}".length);
    await waitFor(() => hsonIssues().some(issue => issue.code === code), "Later edit must preserve the strict quote diagnostic");
  }
  console.log("ok - closed malformed Event strings preserve strict diagnostics, highlighting and exact lookup edits");

  for (const newline of ["\n", "\r\n"]) {
    const body = '<hson:event on:key:up local:go a:bool="tr' + newline
      + ' capture b:str=" // " 🧪' + newline + ' x:bool=^{key.repeatx} <>>';
    await setSource(editPrefix + body + editSuffix);
    const source = document.getText();
    const word = source.indexOf('"tr') + 3;
    const lookup = source.indexOf("repeatx");
    await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_STRING_CONTROL_UNESCAPED"), "Expected the original control diagnostic");
    assert.ok(!(await labels(word)).some(item => name(item) === "true"));
    if (rendered) await waitFor(async () => {
      const roles = await semantic();
      return roles.get(source.indexOf('" //'))?.type === "hsonEventQuote"
        && roles.get(source.indexOf('// " 🧪'))?.type === "hsonEventComment"
        && roles.get(source.indexOf("capture"))?.type !== "hsonEventOption"
        && roles.get(lookup)?.type === "hsonEventNativeProperty";
    }, "A quoted lookalike argument must stay within the original string");
    const applied = source.replace("repeatx", "repeat");
    await accept(lookup + 2, "key.repeat", applied, lookup + "repeat}".length);
    await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_STRING_CONTROL_UNESCAPED"), "Lookup edit changed the strict quote diagnostic");
    // Make only the damaged string legal to inspect the Event's established meaning.
    const repaired = applied.slice(editPrefix.length, -editSuffix.length)
      .replace(/a:bool="tr\r?\n/, 'a:str="tr\\n');
    const event = parse_authored_event(repaired);
    assert.equal(event.listener.capture, false);
    assert.deepEqual(event.args.map(argument => argument.name), ["a", "x"]);
  }
  console.log("ok - Event widget preserves closed string ownership with an apparent following quoted argument");

  const earlier = editPrefix + '<hson:event on:cli local:go text:str="unclosed' + editSuffix;
  const selector = earlier.indexOf("on:cli");
  await setSource(earlier);
  await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_STRING_UNTERMINATED"), "Expected strict incomplete string diagnostic");
  if (rendered) await waitFor(async () => (await semantic()).get(selector + 3)?.type === "hsonEventSelectorName",
    "Earlier selector must keep its Event role");
  assert.deepEqual(await replacement(selector + "on:cli".length, "on:click"), [selector, selector + "on:cli".length]);
  await accept(selector + "on:cli".length, "on:click", earlier.replace("on:cli", "on:click"), selector + "on:click".length);
  await waitFor(() => hsonIssues().some(issue => issue.code === "HSON_STRING_UNTERMINATED"), "Selector edit changed the incomplete suffix");
  console.log("ok - Event selector completion applies before an incomplete string without changing the suffix");

  const missingOperand = editPrefix + '<hson:event on:key:up local:go broken:bool=';
  for (const [tail, label] of [
    [' once window <>>', "{true}"],
    [' // keep 🧪\r\n native:bool=^{key.repeat} once window <>>', '"true"'],
  ] as const) {
    const at = missingOperand.length;
    await setSource(missingOperand + tail + editSuffix);
    await waitFor(() => hsonIssues().length > 0, "Missing operand must fail strict admission");
    assert.equal((await requireCompletion(at, label))?.insertText, label);
    assert.deepEqual(await replacement(at, label), [at, at]);
    await accept(at, label, missingOperand + label + tail + editSuffix, at + label.length);
    const accepted = document.getText().slice(editPrefix.length, -editSuffix.length);
    assert.deepEqual(parse_authored_event(accepted).args[0]?.operand, { kind: "literal", value: true });
    await waitFor(() => hsonIssues().length === 0, "Missing-operand edit must pass strict admission");
    console.log("Event missing operand insertion", JSON.stringify({ label, replacement: [at, at], caret: at + label.length, tail }));
  }
  console.log("ok - Event widget repairs Boolean quotes and empty operands while preserving suffix roles and source");

  const listener = 'import { hsonLiveTree } from "hson-live";\r\nconst tree = hsonLiveTree.fromHson("<button/>");\r\n';
  const setListener = async (marked: string) => {
    const source = listener + "tree.listen.event(" + JSON.stringify(marked) + ");\r\n";
    await setSource(source.replace("|", ""));
    return source.indexOf("|");
  };
  const cursor = await setListener("<hson:event on:click lo| <>>");
  assert.ok(!(await labels(cursor)).some(item => name(item) === "local:"));
  const actionFixture = (domain: "host" | "local") => {
    const definitions = '{bits:{parts:{card:{kind:"document",document:Hson.document`<button hson:part event:go/>`,events:{go:source}}}}}';
    const application = domain === "host" ? 'const app=hsonLiveMap.locus.create(' + definitions
      + ',{actions:{"deck.advance":{handler(){},args:{required:true}}}});'
      : 'const app=hsonLiveMap.fromLibraries(' + definitions + '); app.actions.define("deck.advance",()=>{});';
    return 'import {Hson,hsonLiveMap,hsonLiveTree} from "hson-live";\nconst source=Hson.event`<hson:event on:click '
      + domain + ':deck.ad <>>`;\n' + application + '\nhsonLiveTree.create.button().listen.event(source);';
  };
  for (const domain of ["host", "local"] as const) {
    const source = actionFixture(domain);
    await setSource(source);
    const at = offsetAfter(":deck.ad");
    await waitFor(async () => (await labels(at)).some(item => name(item) === domain + ":deck.advance"), domain + " Action completion");
    assert.deepEqual(await replacement(at, domain + ":deck.advance"), [at - (domain + ":deck.ad").length, at]);
  }
  console.log("ok - explicit host and local Action declarations complete in their owning Part");

  for (const [body, code, eventHead] of [
    ["<hson:ev", "HSON_DECLARATIVE_NAME_INCOMPLETE", true],
    ["<hson:event on:click local:go <>>", undefined, true],
    ['<h title="ok"/>', "HSON_DECLARATIVE_ROOT_REQUIRED", false],
    ['<h title="ok" "nested"> // trailing', "HSON_DECLARATIVE_ROOT_REQUIRED", false],
    ["<'hson:event'/>", "HSON_DECLARATIVE_ROOT_REQUIRED", false],
    ["<hson:unknown>", "HSON_DECLARATIVE_DOMAIN_UNSUPPORTED", false],
    ["<hson:event=oops>", "HSON_DECLARATIVE_HEAD_MALFORMED", false],
  ] as const) {
    await setSource(editPrefix + body + editSuffix);
    await waitFor(() => hsonIssues().map(issue => issue.code).join() === (code ?? ""), body);
    const at = editPrefix.length + (/^<hson:[a-z]+/.exec(body)?.[0].length ?? 2);
    if (rendered) {
      await waitFor(async () => {
        const tokens = await semantic();
        return [...tokens].some(([offset, token]) => offset >= editPrefix.length && offset < editPrefix.length + body.length)
          && (tokens.get(editPrefix.length + 1)?.type === "hsonEventHead") === eventHead;
      }, `Incorrect semantic Event head for ${body}`);
    }
    if (body === "<hson:ev") await waitFor(async () => (await labels(at)).some(item => name(item) === "hson:event"), body);
    else assert.ok(!(await labels(at)).some(item => name(item) === "hson:event"), body);
  }
  console.log("ok - Event head completion, semantic roles and immediate diagnostics follow Declarative recognition");
  for (const stem of ["producer", "Prİme"]) await runPartDiagnosticPublication(workspace, stem);
  await runConfiguredSchemaProject(workspace);
}

async function runConfiguredSchemaProject(workspace: string): Promise<void> {
  // The preceding publication project stays open while tsserver creates this one.
  const root = vscode.Uri.file(join(workspace, "configured-schema-next"));
  const uri = (name: string) => vscode.Uri.joinPath(root, name);
  const write = (name: string, text: string) => vscode.workspace.fs.writeFile(uri(name), Buffer.from(text));
  await vscode.workspace.fs.createDirectory(root);
  await write("tsconfig.json", JSON.stringify({ compilerOptions: { module: "NodeNext", target: "ES2022", types: [], strict: true } }));
  await write("package.json", '{"type":"module"}');
  const part = (tag: string) => 'export const title="<' + tag + ' hson:part/>";';
  await write("part.ts", part("p"));
  // Library Documents are realized under html/head/body before Schema validation.
  const source = 'import {Hson,hsonLiveMap} from "hson-live";import {title} from "./part.js";\n'
    + 'const S=Hson.schema`<type "document" tag "html" content <sequence [<tag "head">, <tag "body" content <sequence [<tag "main" content <sequence [<tag "h1">]>>]>>]>>`;\n'
    + 'hsonLiveMap.fromLibraries({page:{document:Hson.document`<main <hson-part lib="bits" at="title"/>/>`,schema:S},'
    + 'bits:{parts:{title:{kind:"document",document:title}}}});\nexport function sum(){ return 11 + 22; }';
  await write("app.ts", source);
  const document = await vscode.workspace.openTextDocument(uri("app.ts"));
  await vscode.window.showTextDocument(document, { preview: false });
  const selection = new vscode.Range(document.positionAt(source.indexOf("11 + 22")), document.positionAt(source.indexOf("11 + 22") + 7));
  const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
    "vscode.executeCodeActionProvider", document.uri, selection, vscode.CodeActionKind.Refactor.value);
  assert.ok(actions?.some(action => /extract/i.test(action.title)), "TypeScript offers a native extract refactor in the second project");
  const mismatch = () => vscode.languages.getDiagnostics(document.uri).some(issue => issue.source === "hson-schema"
    && issue.message.includes('expected "h1"; received "p"'));
  await waitFor(mismatch, "Second configured project publishes its Schema mismatch");
  const version = document.version;
  await write("part.ts", part("h1"));
  await waitFor(() => !mismatch(), "Dependency-only repair clears the second project's mismatch");
  await write("part.ts", part("p"));
  await waitFor(mismatch, "Dependency-only replacement restores the second project's mismatch");
  assert.equal(document.version, version);
  console.log("ok - a second configured project preserves native refactors and dependency-only Schema diagnostics");
}



async function runPartDiagnosticPublication(workspace: string, stem: string): Promise<void> {
  const write = (file: vscode.Uri, text: string) => vscode.workspace.fs.writeFile(file, Buffer.from(text));
  const project = vscode.Uri.file(join(workspace, "part-publication-" + stem));
  const path = (name: string) => vscode.Uri.joinPath(project, name);
  await vscode.workspace.fs.createDirectory(project);
  await write(path("tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, types: [], skipLibCheck: true } }));
  await write(path("package.json"), '{"type":"module"}');
  const scopeText = (names: string[]) => 'export const doc="<button hson:part '
    + names.map(name => 'data:' + name + '=%{entries}').join(" ") + ' event:go/>";';
  await write(path("scope.ts"), scopeText(["entry", "row"]));
  await write(path(stem + ".ts"), 'export const ev="<hson:event on:click local:go a:data=^{entry.title} b:data=^{row.title} <>>";');
  await write(path("app.ts"), 'import {hsonLiveMap as maps} from "hson-live"; import {ev} from "./' + stem + '.js"; import {doc} from "./scope.js";'
    + 'maps.fromLibraries({assets:{parts:{panel:{kind:"document",document:doc,events:{go:ev}}}}});');
  const scope = await vscode.workspace.openTextDocument(path("scope.ts"));
  const consumer = await vscode.workspace.openTextDocument(path("app.ts"));
  await vscode.window.showTextDocument(consumer);
  const producer = await vscode.workspace.openTextDocument(path(stem + ".ts"));
  await vscode.window.showTextDocument(producer);
  const versions = [producer.version, consumer.version];
  const displayed = () => vscode.languages.getDiagnostics(producer.uri).filter(d => d.source === "hson-schema" && d.code === 95002)
    .map(d => [d.message, producer.getText(d.range)]);
  const change = async (names: string[]) => {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(scope.uri, new vscode.Range(scope.positionAt(0), scope.positionAt(scope.getText().length)), scopeText(names));
    assert.ok(await vscode.workspace.applyEdit(edit));
  };
  for (const missing of ["entry", "row"] as const) {
    await change([missing === "entry" ? "row" : "entry"]);
    const expected = [[`Missing Part local declaration "${missing}".`, "^{" + missing + ".title}"]];
    await waitFor(() => JSON.stringify(displayed()) === JSON.stringify(expected), "Passive displayed diagnostic for " + missing);
  }
  await change(["row"]);
  await change(["entry", "row"]);
  await waitFor(() => displayed().length === 0, "Passive removal after rapid dependency edits");
  assert.deepEqual([producer.version, consumer.version], versions);
  console.log("ok - dependency-only Part edits add, move and clear displayed diagnostics on stable recipients");
  const locate = async () => {
    const at = producer.positionAt(producer.getText().indexOf("entry.title"));
    const result = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      "vscode.executeDefinitionProvider", producer.uri, at);
    return (result ?? []).map(item => {
      const uri = "targetUri" in item ? item.targetUri : item.uri;
      const range = "targetUri" in item ? item.targetSelectionRange ?? item.targetRange : item.range;
      return [uri.fsPath, range.start.line, range.start.character, range.end.character];
    }).sort();
  };
  const target = (doc: vscode.TextDocument) => {
    const position = doc.positionAt(doc.getText().indexOf("data:entry") + "data:".length);
    return [doc.uri.fsPath, position.line, position.character, position.character + "entry".length];
  };
  assert.deepEqual(await locate(), [target(scope)]);
  const extra = new vscode.WorkspaceEdit();
  extra.insert(consumer.uri, consumer.positionAt(consumer.getText().length), '\n'
    + 'maps.fromLibraries({page:{document:"<main/>",events:{go:ev}},bits:{parts:{card:{kind:"document",'
    + 'document:"<button hson:part data:entry=%{rows} data:row=%{rows} event:go/>",events:{go:ev}}}}});\n'
    + 'import {hsonLiveTree} from "hson-live"; hsonLiveTree.create.button().listen.event(ev);');
  assert.ok(await vscode.workspace.applyEdit(extra));
  await waitFor(() => vscode.languages.getDiagnostics(producer.uri).filter(d => d.source === "hson-schema" && d.code === 95002)
    .filter(d => d.relatedInformation?.some(r => r.location.uri.fsPath === consumer.uri.fsPath
      && r.message === "Document Event metadata.")).length === 2, "Contextual diagnostics identify the Document use");
  assert.deepEqual(await locate(), [target(scope), target(consumer)].sort());
  console.log("ok - both exact Part definitions survive a Document error and an imperative listener in VS Code");
}

async function runLocalHostLifecycle(workspace: string, folder: vscode.WorkspaceFolder): Promise<void> {
  const localHostConfiguration = vscode.workspace.getConfiguration("hson.localHost", folder.uri);
  const lifecycleUri = vscode.Uri.file(join(workspace, "local-host-lifecycle.txt"));
  const lifecycle = async (): Promise<string[]> => {
    try { return Buffer.from(await vscode.workspace.fs.readFile(lifecycleUri)).toString().trim().split("\n").filter(Boolean); }
    catch { return []; }
  };
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
  const beforeJoinedSave = (await buildLog()).length, beforeJoinedLifecycle = (await lifecycle()).length;
  await saveValue("joined-restart");
  await vscode.commands.executeCommand("hson.restartLocalHost", folder.uri);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.deepEqual((await buildLog()).slice(beforeJoinedSave), ["build-start:joined-restart", "build-end:joined-restart"]);
  assert.deepEqual((await lifecycle()).slice(beforeJoinedLifecycle), ["stop", "start:joined-restart"], "Save and Restart replace once");
  const beforeExplicitRestart = (await buildLog()).length;
  await vscode.commands.executeCommand("hson.restartLocalHost", folder.uri);
  assert.equal((await buildLog()).length, beforeExplicitRestart + 2, "Restart without pending saves still builds");
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
  await saveValue("saved-while-stopped");
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.deepEqual(await buildLog(), beforeStop, "A save after Stop cannot reenable intent");
  await localHostConfiguration.update("entry", "dist/missing-app.mjs", vscode.ConfigurationTarget.WorkspaceFolder);
  assert.equal(await vscode.commands.executeCommand("hson.startLocalHost", folder.uri), false);
  await vscode.commands.executeCommand("hson.stopLocalHost", folder.uri);
  await localHostConfiguration.update("entry", "dist/local-app.mjs", vscode.ConfigurationTarget.WorkspaceFolder);
  const afterFailedStop = await buildLog();
  await saveValue("corrected-after-stop");
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.deepEqual(await buildLog(), afterFailedStop, "Stop after failed resolution disables save retry");
  await vscode.commands.executeCommand("hson.startLocalHost", folder.uri);
  await vscode.commands.executeCommand("hson.copyLocalAppUrl", folder.uri);
  assert.match(await vscode.env.clipboard.readText(), /^http:\/\/127\.0\.0\.1:\d+\/$/);
  await vscode.commands.executeCommand("hson.stopAll");
  assert.equal((await lifecycle()).at(-1), "stop");
  // Observe the real command's Open and notifications without launching a browser.
  const originalOpen = vscode.env.openExternal;
  const originalInfo = vscode.window.showInformationMessage;
  const originalError = vscode.window.showErrorMessage;
  const originalWarning = vscode.window.showWarningMessage;
  const opened: { url: string; revision: string }[] = [], errors: string[] = [], warnings: string[] = [];
  let information = 0;
  vscode.env.openExternal = async uri => {
    opened.push({ url: uri.toString(), revision: await (await fetch(new URL("/revision", uri.toString()))).text() });
    return true;
  };
  vscode.window.showInformationMessage = async () => { information++; return undefined; };
  vscode.window.showErrorMessage = async (message: string) => { errors.push(message); return undefined; };
  vscode.window.showWarningMessage = async (message: string) => { warnings.push(message); return undefined; };
  const release = async (revision: string): Promise<void> => {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(join(workspace, `release-${revision}`)), Buffer.from("release"));
  };
  try {
    for (const test of [
      { revisions: ["gate-cold-A", "gate-cold-B"] },
      { revisions: ["gate-many-A", "gate-many-B", "gate-many-C"], callers: 2 },
      { revisions: ["gate-single"] },
      { revisions: ["gate-pending-A", "gate-pending-B"], pending: true },
      { revisions: ["gate-obsolete-FAIL", "gate-recovered"] },
      { revisions: ["gate-final-A", "gate-final-FAIL"], fails: true },
      { revisions: ["gate-retained-A", "gate-retained-FAIL"], pending: true, fails: true },
      { revisions: ["gate-stop-A", "gate-stop-B"], stop: true },
    ]) {
      if (test.pending) {
        await saveValue("warm");
        assert.equal(await vscode.commands.executeCommand("hson.startLocalHost", folder.uri), true);
      }
      const first = test.revisions[0]!, last = test.revisions.at(-1)!;
      const beforeBuild = (await buildLog()).length, beforeLifecycle = await lifecycle();
      const beforeOpen = opened.length, beforeErrors = errors.length, beforeInfo = information;
      await saveValue(first);
      const requests = [vscode.commands.executeCommand<boolean>("hson.runAndOpenLocalApp", folder.uri)];
      await waitFor(async () => (await buildLog()).at(-1) === `build-start:${first}`, `Initial build ${first} did not reach its gate`);
      for (let i = 1; i < (test.callers ?? 1); i++) requests.push(vscode.commands.executeCommand<boolean>("hson.runAndOpenLocalApp", folder.uri));
      for (const revision of test.revisions.slice(1)) await saveValue(revision);
      assert.equal(opened.length, beforeOpen);
      await release(first);
      if (first !== last) {
        await waitFor(async () => (await buildLog()).at(-1) === `build-start:${last}`, `Final build ${last} did not reach its gate`);
        assert.deepEqual(await lifecycle(), beforeLifecycle, "The superseded build cannot replace a runner");
        assert.equal(opened.length, beforeOpen);
        if (test.stop) await vscode.commands.executeCommand("hson.stopLocalHost", folder.uri);
        else await release(last);
      }
      const success = !test.fails && !test.stop;
      assert.deepEqual(await Promise.all(requests), requests.map(() => success), first);
      const revisions = first === last ? [first] : [first, last];
      assert.deepEqual((await buildLog()).slice(beforeBuild), revisions.flatMap(revision => test.stop && revision === last
        ? [`build-start:${revision}`] : [`build-start:${revision}`, revision.includes("FAIL") ? "build-fail" : `build-end:${revision}`]));
      assert.deepEqual((await lifecycle()).slice(beforeLifecycle.length), success ? [...(test.pending ? ["stop"] : []), `start:${last}`] : []);
      assert.equal(opened.length - beforeOpen, success ? requests.length : 0);
      assert.equal(errors.length - beforeErrors, test.fails ? 1 : 0);
      assert.equal(information - beforeInfo, success ? requests.length : 0);
      assert.deepEqual(warnings, []);
      if (success || test.pending) {
        await vscode.commands.executeCommand("hson.copyLocalAppUrl", folder.uri);
        const url = await vscode.env.clipboard.readText();
        const expected = success ? last : "warm";
        assert.equal(await (await fetch(new URL("/revision", url))).text(), expected);
        assert.ok(opened.slice(beforeOpen).every(open => open.revision === expected && new URL(open.url).href === url));
        if (!success) {
          await vscode.commands.executeCommand("hson.openLocalApp", folder.uri);
          assert.equal(opened.length, beforeOpen + 1);
          assert.equal(opened.at(-1)?.revision, "warm");
          assert.equal(new URL(opened.at(-1)!.url).href, url);
        }
      }
      await vscode.commands.executeCommand("hson.stopLocalHost", folder.uri);
    }
    await localHostConfiguration.update("restartOnSave", false, vscode.ConfigurationTarget.WorkspaceFolder);
    await localHostConfiguration.update("buildCommand", "", vscode.ConfigurationTarget.WorkspaceFolder);
    const appUri = vscode.Uri.file(join(workspace, "dist", "local-app.mjs"));
    const writeApp = async (source: string): Promise<void> => vscode.workspace.fs.writeFile(appUri, Buffer.from(source));
    await writeApp('import { Hson } from "hson-live"; Hson.document`<main`;');
    let beforeErrors = errors.length;
    assert.deepEqual(await Promise.all([
      vscode.commands.executeCommand("hson.startLocalHost", folder.uri),
      vscode.commands.executeCommand("hson.startLocalHost", folder.uri),
      vscode.commands.executeCommand("hson.runAndOpenLocalApp", folder.uri),
    ]), [false, false, false]);
    assert.equal(errors.length, beforeErrors + 1, "Concurrent native Start commands present one failure");
    assert.match(errors.at(-1) ?? "", /unterminated angle construct/);
    assert.doesNotMatch(errors.at(-1) ?? "", /\n|\[ERR:/);
    await vscode.commands.executeCommand("hson.stopLocalHost", folder.uri);
    beforeErrors = errors.length;
    await vscode.commands.executeCommand("hson.runAll");
    assert.equal(errors.length, beforeErrors + 1, "Run All cannot add a generic Local App failure notification");
    assert.match(errors.at(-1) ?? "", /unterminated angle construct/);
    await vscode.commands.executeCommand("hson.stopAll");

    await writeApp(`export async function application() {
      queueMicrotask(() => { throw new Error("native-primary", { cause: new Error("native-actionable-cause") }); });
      await new Promise(resolve => setImmediate(resolve));
      return { name: "native-cleanup", dispose() { throw new Error("native-cleanup-failure"); } };
    }`);
    beforeErrors = errors.length;
    assert.equal(await vscode.commands.executeCommand("hson.startLocalHost", folder.uri), false);
    await vscode.commands.executeCommand("hson.stopLocalHost", folder.uri);
    assert.equal(errors.length, beforeErrors + 1, "Distinct startup cleanup evidence does not repeat the primary notification");
    assert.match(errors.at(-1) ?? "", /native-actionable-cause/);

    await writeApp(`export const application = { name: "native-recovery", requests: [{ method: "GET", path: "/fail", handle() {
      setImmediate(() => { throw new Error("native-runtime-failure"); }); return new Response("triggered");
    } }], dispose() { throw new Error("native-runtime-cleanup"); } };`);
    assert.equal(await vscode.commands.executeCommand("hson.startLocalHost", folder.uri), true, "Source correction recovers");
    await vscode.commands.executeCommand("hson.copyLocalAppUrl", folder.uri);
    const runtimeUrl = await vscode.env.clipboard.readText();
    beforeErrors = errors.length;
    await fetch(new URL("/fail", runtimeUrl));
    await waitFor(() => errors.length === beforeErrors + 1, "Post-readiness failure did not notify");
    await vscode.commands.executeCommand("hson.stopLocalHost", folder.uri);
    assert.equal(errors.length, beforeErrors + 1, "Runtime and cleanup events share one primary presentation");
    assert.match(errors.at(-1) ?? "", /native-runtime-failure/);
    process.stdout.write("ok - native structured failures notify once for concurrent Start, Run All, startup cleanup, runtime cleanup, and parsing; corrected source recovers\n");
    process.stdout.write("ok - native Run & Open follows gated saves, opens the final served revision once per caller, and respects Stop and failure\n");
  } finally {
    vscode.env.openExternal = originalOpen;
    vscode.window.showInformationMessage = originalInfo;
    vscode.window.showErrorMessage = originalError;
    vscode.window.showWarningMessage = originalWarning;
    await vscode.commands.executeCommand("hson.stopLocalHost", folder.uri);
  }
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

}

async function runStructuralKeyboard(workspace: string): Promise<void> {
  const prefix = 'import { Hson } from "hson-live";\n';
  const keys = {
    "`": { code: "Backquote", windowsVirtualKeyCode: 192 },
    "<": { code: "Comma", modifiers: 8, windowsVirtualKeyCode: 188 },
    ">": { code: "Period", modifiers: 8, windowsVirtualKeyCode: 190 },
    "/": { code: "Slash", windowsVirtualKeyCode: 191 },
    "[": { code: "BracketLeft", windowsVirtualKeyCode: 219 },
    "]": { code: "BracketRight", windowsVirtualKeyCode: 221 },
    "{": { code: "BracketLeft", modifiers: 8, windowsVirtualKeyCode: 219 },
    "}": { code: "BracketRight", modifiers: 8, windowsVirtualKeyCode: 221 },
    "(": { code: "Digit9", modifiers: 8, windowsVirtualKeyCode: 57 },
  };
  const enter = { key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 };
  const backspace = { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 };
  const undo = { key: "z", code: "KeyZ", modifiers: process.platform === "darwin" ? 4 : 2, windowsVirtualKeyCode: 90 };
  const redo = { ...undo, key: "Z", modifiers: undo.modifiers | 8 };
  const unpack = (marked: string) => {
    const markers = /\||⟦([^⟧]*)⟧/g;
    const anchors: number[] = [];
    const offsets: number[] = [];
    let removed = 0;
    for (const match of marked.matchAll(markers)) {
      const anchor = match.index - removed;
      const width = match[1]?.length ?? 0;
      anchors.push(anchor);
      offsets.push(anchor + width);
      removed += match[0].length - width;
    }
    return { anchors, offsets, text: marked.replace(markers, "$1") };
  };
  const check = async (label: string, file: string, input: string, steps: readonly (readonly [
    keyof typeof keys | Record<string, unknown>, string, number?
  ])[], indentation: { insertSpaces: boolean; tabSize: number; reverseCarets?: boolean } =
    { insertSpaces: true, tabSize: 2 }): Promise<void> => {
    const before = unpack(input);
    const uri = vscode.Uri.file(join(workspace, file));
    const existing = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
    if (existing === undefined) await vscode.workspace.fs.writeFile(uri, Buffer.from(before.text));
    const document = existing ?? await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    if (existing !== undefined) {
      const range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
      assert.ok(await editor.edit(edit => edit.replace(range, before.text)));
    }
    const matchesIndentation = (options: vscode.TextEditorOptions) => options.insertSpaces === indentation.insertSpaces
      && options.tabSize === indentation.tabSize && options.indentSize === indentation.tabSize;
    if (!matchesIndentation(editor.options)) {
      // The extension host's option setters report their values before the
      // workbench has applied them. Wait for the workbench's option event.
      let applied = false;
      const observer = vscode.window.onDidChangeTextEditorOptions(event => {
        if (event.textEditor === editor && matchesIndentation(event.options)) applied = true;
      });
      try {
        const { insertSpaces, tabSize } = indentation;
        editor.options = { insertSpaces, tabSize, indentSize: tabSize };
        await waitFor(() => applied && matchesIndentation(editor.options), "Editor indentation settings did not apply");
      } finally { observer.dispose(); }
    }
    const caretOrder = (offsets: number[]) => indentation.reverseCarets ? [...offsets].reverse() : offsets;
    const anchors = caretOrder(before.anchors);
    editor.selections = caretOrder(before.offsets).map((offset, index) =>
      new vscode.Selection(document.positionAt(anchors[index]), document.positionAt(offset)));

    await ui(workspace, { action: "focus-editor" });
    const snapshot = () => ({
      text: document.getText(),
      offsets: editor.selections.map(selection => document.offsetAt(selection.active)),
      anchors: editor.selections.map(selection => document.offsetAt(selection.anchor)),
    });
    assert.deepEqual(snapshot().offsets, caretOrder(before.offsets), label + " initial selections");
    for (const [inputKey, marked, expectedChanges] of steps) {
      const key = typeof inputKey === "string" ? { ...keys[inputKey], key: inputKey, text: inputKey } : inputKey;
      const initial = snapshot();
      const changes: (vscode.TextDocumentChangeReason | undefined)[] = [];
      const observer = vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document === document && event.contentChanges.length > 0) changes.push(event.reason);
      });
      const expected = unpack(marked);
      try {
        await ui(workspace, { action: "editor-key", ...key });
        await waitFor(() => {
          const observed = snapshot();
          const offsets = indentation.reverseCarets ? [...observed.offsets].sort((a, b) => a - b) : observed.offsets;
          const anchors = indentation.reverseCarets ? [...observed.anchors].sort((a, b) => a - b) : observed.anchors;
          return observed.text === expected.text && JSON.stringify(anchors) === JSON.stringify(expected.anchors)
            && JSON.stringify(offsets) === JSON.stringify(expected.offsets);
        }, label + " " + JSON.stringify(key) + " expected " + JSON.stringify(marked), 2_000);
        if (expectedChanges !== undefined) assert.equal(changes.length, expectedChanges, label + " content changes");
      } catch (error) {
        throw new Error(label + " observed " + JSON.stringify({ initial, result: snapshot(), key: key.key ?? key.text, expected }), { cause: error });
      } finally {
        observer.dispose();
      }
      process.stdout.write("ok - keyboard " + label + " " + JSON.stringify({ key: key.key ?? key.text, initial, ...snapshot(), changes }) + "\n");
    }
  };

  const data = prefix + 'const page = Hson.data';
  const doc = prefix + 'const page = Hson.document';
  await check("Data opening backtick and undo/redo", "structural-keys.ts", data + '|;', [
    ["`", data + '`<|>`;'], [undo, data + '|;'], [redo, data + '`<|>`;'],
    [enter, data + '`<\n  |\n>`;'], [undo, data + '`<|>`;'],
    [redo, data + '`<\n  |\n>`;'],
  ]);
  await check("Document closing backtick already present", "structural-keys.ts", doc + '|`;', [
    ["`", doc + '`<|/>`;'],
    [ { text: "main" }, doc + '`<main|/>`;'],
    ["/", doc + '`<main/|>`;'], [">", doc + '`<main/>|`;'], ["`", doc + '`<main/>`|;'],
  ]);
  await check("Malformed sibling and host errors", "structural-keys.ts", data + '`<bad «1] items |>`;\nconst broken = ;', [
    ["[", data + '`<bad «1] items «|»>`;\nconst broken = ;'],
    [enter, data + '`<bad «1] items «\n    |\n  »>`;\nconst broken = ;'],
  ]);
  await check("Unfinished template with tabs and leading-closer dedent", "structural-keys.ts",
    prefix + '  const page = Hson.data`<items «|', [
      [enter, prefix + '  const page = Hson.data`<items «\n  \t\t|'],
      [{ text: "»" }, prefix + '  const page = Hson.data`<items «\n  \t»|'],
    ], { insertSpaces: false, tabSize: 4 });
  await check("Multicursor pairing and single undo", "structural-keys.ts",
    data + '`<one | two |> `;', [
      ["[", data + '`<one «|» two «|»> `;'],
      [undo, data + '`<one | two |> `;'],
    ]);
  await check("Mixed native and Hson multicursor", "structural-keys.ts",
    data + '`<one |>`;\nconst native = |;', [
      ["[", data + '`<one «|»>`;\nconst native = [|];'],
      [undo, data + '`<one |>`;\nconst native = |;'],
    ]);
  await check("Mixed native and Hson Enter", "structural-keys.ts",
    data + '`<one |>`;\nconst native = {|};', [
      [enter, data + '`<one \n  |\n>`;\nconst native = {\n  |\n};'],
    ]);
  const mixedBrackets = "const native = |;\n" + data + '`<one |>`;';
  const pairedBrackets = "const native = [|];\n" + data + '`<one «|»>`;';
  await check("Mixed bracket ownership, undo, redo and Backspace", "structural-keys.ts", mixedBrackets, [
    ["[", pairedBrackets, 1], [undo, mixedBrackets, 1], [redo, pairedBrackets, 1], [backspace, mixedBrackets, 1],
    [undo, pairedBrackets, 1], [redo, mixedBrackets, 1],
  ]);
  await check("Mixed bracket overtype after content", "structural-keys.ts", mixedBrackets, [
    ["[", pairedBrackets, 1],
    [{ text: "1" }, "const native = [1|];\n" + data + '`<one «1|»>`;'],
    ["]", "const native = [1]|;\n" + data + '`<one «1»|>`;', 0],
  ]);
  await check("Mixed bracket with its primary caret inside Hson", "structural-keys.ts", mixedBrackets, [
    ["[", pairedBrackets, 1], [undo, mixedBrackets, 1], [redo, pairedBrackets, 1], [backspace, mixedBrackets, 1],
  ], { insertSpaces: true, tabSize: 2, reverseCarets: true });
  const editorSettings = vscode.workspace.getConfiguration("editor");
  await editorSettings.update("autoClosingBrackets", "never", vscode.ConfigurationTarget.Workspace);
  try {
    const configuredBrackets = "const native = [|;\n" + data + '`<one «|»>`;';
    await check("Mixed bracket respects native autoClosingBrackets", "structural-keys.ts", mixedBrackets, [
      ["[", configuredBrackets, 1], [undo, mixedBrackets, 1], [redo, configuredBrackets, 1],
      [backspace, mixedBrackets, 1],
    ]);
  } finally {
    await editorSettings.update("autoClosingBrackets", undefined, vscode.ConfigurationTarget.Workspace);
  }
  const mixedComment = "const native = |;\n" + doc + '`<main // |\n/>`;';
  const pairedComment = "const native = [|];\n" + doc + '`<main // [|\n/>`;';
  await check("Mixed native pair and literal Hson comment", "structural-keys.ts", mixedComment, [
    ["[", pairedComment, 1], [undo, mixedComment, 1], [redo, pairedComment, 1], [backspace, mixedComment, 1],
  ]);
  await check("Unknown mixed bracket position delegates natively", "structural-keys.ts",
    "const native = |value;\n" + data + '`<one |>`;', [
      ["[", "const native = [|value;\n" + data + '`<one [|>`;', 1],
      [undo, "const native = |value;\n" + data + '`<one |>`;', 1],
      [redo, "const native = [|value;\n" + data + '`<one [|>`;', 1],
    ]);
  const mixedEnter = "const native = {|};\n" + data + '`<one |>`;';
  const splitEnter = "const native = {\n  |\n};\n" + data + '`<one \n  |\n>`;';
  await check("Mixed Enter preserves both redo carets", "structural-keys.ts", mixedEnter, [
    [enter, splitEnter, 1], [undo, mixedEnter, 1], [redo, splitEnter, 1],
  ]);
  const differentDepths = data + '`<one | two «|»>`;';
  const splitDepths = data + '`<one \n  | two «\n    |\n  »>`;';
  await check("Different Hson depths preserve both redo carets", "structural-keys.ts", differentDepths, [
    [enter, splitDepths, 1], [undo, differentDepths, 1], [redo, splitDepths, 1],
  ]);
  const twoStarts = data + '|;\nconst other = Hson.document|;';
  const twoScaffolds = data + '`<|>`;\nconst other = Hson.document`<|/>`;';
  await check("Different scaffolds in one undo step", "structural-keys.ts", twoStarts, [
    ["`", twoScaffolds, 1], [undo, twoStarts, 1], [redo, twoScaffolds, 1],
    [backspace, data + '`|`;\nconst other = Hson.document`|`;', 1], [undo, twoScaffolds, 1],
  ]);
  const adjacent = doc + '`<main |<aside/>/>`;';
  const adjacentPair = doc + '`<main <|/><aside/>/>`;';
  await check("Pair before an adjacent Document sibling", "structural-keys.ts", adjacent, [
    ["<", adjacentPair, 1], [undo, adjacent, 1], [redo, adjacentPair, 1], [backspace, adjacent, 1],
  ]);
  const malformedAdjacent = doc + '`<main\n <bad value=\n |<broken attr=???\n/>`;';
  await check("Pair with malformed neighbors on both sides", "structural-keys.ts", malformedAdjacent, [
    ["<", malformedAdjacent.replace("|", "<|/>"), 1], [undo, malformedAdjacent, 1],
    [redo, malformedAdjacent.replace("|", "<|/>"), 1], [backspace, malformedAdjacent, 1],
  ]);
  const angleCarets = doc + '`<main | |/>`;';
  const anglePairs = doc + '`<main <|/> <|/>/>`;';
  await check("Paired Backspace after multicursor redo", "structural-keys.ts", angleCarets, [
    ["<", anglePairs, 1], [undo, angleCarets, 1], [redo, anglePairs, 1],
    [backspace, angleCarets, 1], [undo, anglePairs, 1], [redo, angleCarets, 1],
  ]);
  const authoredPair = doc + '`<main ⟦</>⟧/>`;';
  const emptyChild = doc + '`<main |/>`;';
  const generatedChild = doc + '`<main <|/>/>`;';
  const left = { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 };
  const right = { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 };
  const plainBackspace = doc + '`<main |/>/>`;';
  await check("Undo preserves an authored closer with the same spelling as a generated pair", "ownership-keys.ts", authoredPair, [
    [backspace, emptyChild, 1], ["<", generatedChild, 1], [undo, emptyChild, 1], [undo, authoredPair, 1],
    [left, doc + '`<main |</>/>`;', 0], [right, generatedChild, 0], [backspace, plainBackspace, 1],
  ]);
  const typeX = { key: "x", code: "KeyX", text: "x", windowsVirtualKeyCode: 88 };
  await check("An intervening native edit ends tracked undo history", "ownership-keys.ts", emptyChild, [
    ["<", generatedChild, 1], [typeX, doc + '`<main <x|/>/>`;', 1], [undo, generatedChild, 1],
    [undo, emptyChild, 1], [redo, generatedChild, 1], [backspace, plainBackspace, 1],
  ]);
  await check("An existing incomplete slash stays in place", "structural-keys.ts", doc + '`|/`;', [
    ["<", doc + '`<|/`;', 1], [undo, doc + '`|/`;', 1], [redo, doc + '`<|/`;', 1],
    [backspace, doc + '`|/`;', 1],
  ]);
  await check("Opening backtick preserves an unfinished nonempty template", "structural-keys.ts", doc + '|`<main', [
    ["`", doc + '`|<main', 0],
  ]);
  await check("Opening backtick fills a genuinely empty template", "structural-keys.ts", doc + '|``;', [
    ["`", doc + '`<|/>`;', 1], [undo, doc + '|``;', 1], [redo, doc + '`<|/>`;', 1],
    [backspace, doc + '`|`;', 1],
  ]);
  await check("Native TypeScript comparison", "structural-keys.ts", "const compare = x | y;", [
    ["<", "const compare = x <| y;"],
  ]);
  await check("Hson quoted delimiter protection", "structural-keys.ts", data + '`<x "a\\"|b">`;', [
    ["[", data + '`<x "a\\"[|b">`;'],
  ]);
  await check("Native interpolation and expression pairing", "structural-keys.ts", data + '`<x $|>`;', [
    ["{", data + '`<x ${|}>`;'], ["(", data + '`<x ${(|)}>`;'],
  ]);
  await check("Existing angle closer survives Backspace", "structural-keys.ts", data + '`|>`;', [
    ["<", data + '`<|>`;'], [backspace, data + '`|>`;'],
  ]);
  await check("Standalone root angle and paired Backspace", "structural-keys.hson", "|", [
    ["<", "<|>"], [backspace, "|"],
  ]);
  await check("Standalone nesting and indentation", "structural-keys.hson", "<items |>", [
    ["[", "<items [|]>"], [enter, "<items [\n        |\n    ]>"],
  ], { insertSpaces: true, tabSize: 4 });
  await check("JavaScript alias and host pairing", "structural-keys.js", prefix + 'const page = Hson.document|;', [
    ["`", doc + '`<|/>`;'],
  ]);
  await check("JavaScript native object and ordinary tagged template", "structural-keys.js", 'const x = |;', [
    ["{", 'const x = {|};'], [enter, 'const x = {\n  |\n};'],
  ]);
  await check("Unrelated data tag keeps native backticks", "structural-keys.ts", 'const x = other.data|;', [
    ["`", 'const x = other.data`|`;'],
  ]);
  const eventHead = prefix + 'const event = Hson.event`<hson:event on:click args:data=';
  await check("Incomplete Event brace opener", "structural-keys.ts", eventHead + '| <> >', [
    ["{", eventHead + '{|} <> >'],
  ]);
  const event = eventHead + '{ <items |}';
  await check("Incomplete Event Data operand", "structural-keys.ts", event, [
    ["[", event.replace("|", "«|»")],
  ]);
  const declaration = prefix + 'const event = Hson.event`<hson:event on:click local:go';
  await check("Complete Event header", "structural-keys.ts", declaration + ' |once <>>`;', [
    [enter, declaration + ' \n  |once <>>`;'],
  ]);
  await check("Complete Event nested Data operand", "structural-keys.ts", declaration + ' payload:data={<list |[1,2]>} <>>`;', [
    [enter, declaration + ' payload:data={<list \n            |[1,2]>} <>>`;'],
  ], { insertSpaces: true, tabSize: 4 });
  await check("Incomplete Event with malformed Hson and TypeScript nearby", "structural-keys.ts",
    'const broken = ;\n' + declaration + '\n  payload:data={<bad «1] items |>} <>>`;', [
      [enter, 'const broken = ;\n' + declaration + '\n  payload:data={<bad «1] items \n      |\n    >} <>>`;'],
    ]);
  await check("Multiline Event outcome and declaration closers", "structural-keys.ts", declaration + '\n  <|', [
    [enter, declaration + '\n  <\n    |'],
    [">", declaration + '\n  <\n  >|'],
    [enter, declaration + '\n  <\n  >\n  |'],
    [">", declaration + '\n  <\n  >\n>|'],
  ]);
  await check("Complete Event Boolean operand", "structural-keys.ts", declaration + ' flag:bool={|true} <>>`;', [
    [enter, declaration + ' flag:bool={\n    |true} <>>`;'],
  ]);
  await check("Incomplete Event array operand closer", "structural-keys.ts", declaration + '\n\tvalues:arr={|', [
    [enter, declaration + '\n\tvalues:arr={\n\t\t|'],
    ["}", declaration + '\n\tvalues:arr={\n\t}|'],
  ], { insertSpaces: false, tabSize: 4 });
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("terminal-gothic.hson-language");
  assert.ok(extension, "Hson extension was not discovered by the extension host");
  await extension.activate();
  console.log("VS Code integration host:", vscode.version);
  const workspace = process.env.HSON_TEST_WORKSPACE;

  assert.ok(workspace);
  if (process.env.HSON_EDITING_TEST_ONLY === "1") { await runStructuralKeyboard(workspace); return; }
  if (process.env.HSON_EVENT_TEST_ONLY === "1") { await runEventAuthoring(workspace, extension.extensionPath, true); return; }
  if (process.env.HSON_PART_COMPLETION_TEST_ONLY === "1") { await runPartCompletions(workspace); return; }
  if (process.env.HSON_RESTRICTED_TEST !== "1" && process.env.HSON_LOCAL_HOST_TEST_ONLY !== "1") {
    await runProtectedSourceFormatting(workspace);
    await runTypingConveniences(workspace);
    if (process.env.HSON_TYPING_TEST_ONLY === "1") return;
    if (nativeCompositionSupported && process.env.HSON_SCHEMA_CONSUMER_TEST !== "1") {
      await runEventAuthoring(workspace, extension.extensionPath, false);
    }
  }
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
  if (process.env.HSON_LOCAL_HOST_TEST_ONLY === "1") {
    if (process.env.HSON_RESTRICTED_TEST === "1") {
      assert.equal(vscode.workspace.isTrusted, false);
      const before = await lifecycle();
      assert.equal(await vscode.commands.executeCommand("hson.runAndOpenLocalApp", folder.uri), false);
      assert.deepEqual(await lifecycle(), before);
      process.stdout.write("ok - native Run & Open respects Workspace Trust\n");
    } else {
      await runLocalHostLifecycle(workspace, folder);
      await vscode.commands.executeCommand("hson.startLocalHost", folder.uri);
    }
    return;
  }
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
  deck: { json: { user: { age: 37 } }, schema: UserSchema },
  page: { document: Hson.document\`<main/>\` },
  components: { parts: { submit: { kind: "document", document: Hson.document\`<button hson:part/>\` } } },
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
  const invalidAdmission = libraryPrefix + 'loc.admit({ incoming: { json: { user: { age: "wrong" } }, schema: UserSchema } });';
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
    structuralEditor.options.insertSpaces = true;
    structuralEditor.options.tabSize = 2;
    structuralEditor.options.indentSize = 2;
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
    await typeArray("Part selector bracket stays ASCII", hostPrefix + 'const x=Hson.document`<p data:d="%{payload}" "^{d.items|}"/>`;', false);
    for (const [body, insertion] of [
      ['<data 1|', '\n  '], ['<data 1\n  <data2 2|>\n>', '\n    \n  '],
      ['<a "bad\\q"|>', '\n  \n'], ['<main <child/>|', '\n  '],
    ]) {
      const marked = hostPrefix + 'const x=Hson.canonical`' + body + '`;';
      await replaceMarked(marked);
      await vscode.commands.executeCommand("hson.insertLineBreak");
      assert.equal(structural.getText(), marked.replace("|", insertion), body);
    }
    await ordinaryEnter("Hson string", hostPrefix + 'const x=Hson.canonical`<a "te|xt">`;');
    await ordinaryEnter("Hson comment", hostPrefix + 'const x=Hson.canonical`<a 1 // no|te\nb 2>`;');
    await ordinaryEnter("Hson interpolation", hostPrefix + 'const value=1; const x=Hson.canonical`<a ${val|ue}>`;');
    await ordinaryEnter("ordinary TypeScript", 'const ordinary = 1;|');

    await replaceMarked(hostPrefix + 'const x=Hson.canonical`<main|/>`;');
    await vscode.commands.executeCommand("hson.insertLineBreak");
    assert.ok(structural.getText().includes("<main\n  \n/>"), "valid Hson receives smart Enter");
    await replaceMarked(hostPrefix + 'const x=Hson.canonical`<data 1\n  <data2 2|>\n>`;');
    await vscode.commands.executeCommand("hson.insertLineBreak");
    assert.ok(structural.getText().includes("<data2 2\n    \n  >"), "malformed Hson retains smart Enter");
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

  await runLocalHostLifecycle(workspace, folder);

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
