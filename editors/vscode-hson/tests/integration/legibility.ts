import assert from "node:assert/strict";
import { join } from "node:path";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const workspace = process.env.HSON_LEGIBILITY_WORKSPACE;
  assert.ok(workspace);
  const extension = vscode.extensions.getExtension('terminal-gothic.hson-language');
  assert.ok(extension);
  await extension.activate();
  const prefix = 'import { Hson } from "hson-live/hson";\n';
  const open = async (name: string, text: string) => {
    const uri = vscode.Uri.file(join(workspace, name));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(""));
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    await replace(document, text);
    return { document, editor };
  };
  const replace = async (document: vscode.TextDocument, text: string) => {
    const edits = new vscode.WorkspaceEdit();
    edits.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(edits), true);
  };
  const body = '\n<\na <\nb 1\n>\n>\n';
  const formatted = '\n<\n  a <\n    b 1\n  >\n>\n';
  const literal = '"\n        first\n            nested\n  \n        third\n    "';
  const input = prefix + 'const value=Hson.data`' + body + '`;\nconst literal=Hson.data`<text ' + literal + '>`;\n';
  for (const language of ['ts', 'tsx']) {
    const { document, editor } = await open('authoring.' + language, input);
    for (const tabSize of [2, 4, 8]) for (const insertSpaces of [true, false]) {
      editor.options = { ...editor.options, tabSize, insertSpaces };
      await replace(document, input);
      assert.equal(await document.save(), true);
      assert.ok(document.getText().includes('Hson.data`' + formatted + '`'), `${language} manual save: ${tabSize}/${insertSpaces}`);
      assert.ok(document.getText().includes(literal), 'manual save preserves literal and closing quote bytes');
      const once = document.getText();
      assert.equal(await document.save(), true);
      assert.equal(document.getText(), once);
    }
    editor.options = { ...editor.options, tabSize: 4, insertSpaces: true };
    await replace(document, input);
    await vscode.commands.executeCommand('hson.formatDocument');
    assert.ok(document.getText().includes('Hson.data`' + formatted + '`'), 'Format Document uses two-space structure');
    assert.ok(document.getText().includes(literal));
    await replace(document, input);
    const start = input.indexOf(body), end = start + body.length;
    editor.selection = new vscode.Selection(document.positionAt(start), document.positionAt(end));
    await vscode.commands.executeCommand('hson.formatSelection');
    assert.ok(document.getText().includes('Hson.data`' + formatted + '`'), 'Format Selection uses two-space structure');
    assert.ok(document.getText().includes(literal));
    const inline = prefix + 'const value=Hson.document`<main/>`;';
    await replace(document, inline);
    const cursor = document.positionAt(inline.indexOf('/>'));
    editor.selection = new vscode.Selection(cursor, cursor);
    await vscode.commands.executeCommand('hson.insertLineBreak');
    assert.ok(document.getText().includes('<main\n  \n/>'), 'smart Enter ignores host width');
    const tabs = prefix + 'function f() {\n\tconst value=Hson.data`' + body + '\t`;\n}';
    editor.options = { ...editor.options, tabSize: 8, insertSpaces: false };
    await replace(document, tabs);
    assert.equal(await document.save(), true);
    assert.ok(document.getText().includes('\n\t<\n\t  a <\n\t    b 1\n\t  >\n\t>'), 'save preserves host tabs and adds spaces');
  }
  const markdown = '   ```hson' + body + '   ```\n';
  const { document: md, editor: mdEditor } = await open('authoring.md', markdown);
  mdEditor.options = { ...mdEditor.options, tabSize: 8, insertSpaces: false };
  await replace(md, markdown);
  assert.equal(await md.save(), true);
  assert.equal(md.getText(), '   ```hson\n   <\n     a <\n       b 1\n     >\n   >\n   ```\n');
  await replace(md, markdown);
  const mdEdits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', md.uri, { tabSize: 8, insertSpaces: false });
  const mdChange = new vscode.WorkspaceEdit();
  for (const edit of mdEdits ?? []) mdChange.replace(md.uri, edit.range, edit.newText);
  assert.equal(await vscode.workspace.applyEdit(mdChange), true);
  assert.ok(md.getText().includes('\n     a <\n       b 1\n'));

  const editorConfiguration = vscode.workspace.getConfiguration('editor');
  await editorConfiguration.update('detectIndentation', false, vscode.ConfigurationTarget.Workspace);
  const { document: standalone } = await open('standalone.hson', '<a «<b 1>»>');
  assert.equal(vscode.workspace.getConfiguration('editor', standalone).get('tabSize'), 2);
  assert.equal(vscode.workspace.getConfiguration('editor', standalone).get('insertSpaces'), true);
  const configuration = vscode.workspace.getConfiguration(undefined);
  await configuration.update('[hson]', { 'editor.tabSize': 8, 'editor.insertSpaces': false }, vscode.ConfigurationTarget.Workspace);
  assert.equal(vscode.workspace.getConfiguration('editor', standalone).get('tabSize'), 8);
  assert.equal(vscode.workspace.getConfiguration('editor', standalone).get('insertSpaces'), false);

  const standaloneInput = '<\nslides «\n<\nid "intro"\n>\n»\n>\n';
  const standaloneExpected = '<\n  slides «\n    <\n      id "intro"\n    >\n  »\n>\n';
  await replace(standalone, standaloneInput);
  assert.equal(await standalone.save(), true);
  assert.equal(standalone.getText(), standaloneExpected, 'standalone manual save ignores eight-space/tab editor overrides');
  const applyProvider = async (range?: vscode.Range) => {
    const edits = range === undefined
      ? await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', standalone.uri, { tabSize: 8, insertSpaces: false })
      : await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatRangeProvider', standalone.uri, range, { tabSize: 8, insertSpaces: false });
    const change = new vscode.WorkspaceEdit();
    for (const edit of edits ?? []) change.replace(standalone.uri, edit.range, edit.newText);
    if ((edits?.length ?? 0) > 0) assert.equal(await vscode.workspace.applyEdit(change), true);
    return edits ?? [];
  };
  assert.deepEqual(await applyProvider(), [], 'standalone document provider is idempotent');
  await replace(standalone, standaloneInput);
  await applyProvider();
  assert.equal(standalone.getText(), standaloneExpected, 'ordinary document provider is registered');
  await replace(standalone, standaloneInput);
  await applyProvider(new vscode.Range(standalone.positionAt(0), standalone.positionAt(standaloneInput.length)));
  assert.equal(standalone.getText(), standaloneExpected, 'ordinary range provider is registered');
  await replace(standalone, standaloneInput);
  await vscode.commands.executeCommand('hson.formatDocument');
  assert.equal(standalone.getText(), standaloneExpected, 'Hson document command accepts standalone Hson');
  await replace(standalone, standaloneInput);
  const standaloneEditor = vscode.window.activeTextEditor;
  assert.ok(standaloneEditor && standaloneEditor.document === standalone);
  standaloneEditor.selection = new vscode.Selection(standalone.positionAt(0), standalone.positionAt(standaloneInput.length));
  await vscode.commands.executeCommand('hson.formatSelection');
  assert.equal(standalone.getText(), standaloneExpected, 'Hson selection command accepts standalone Hson');
  await replace(standalone, '<\ntext ' + literal + '\n>');
  await standalone.save();
  assert.ok(standalone.getText().includes(literal), 'standalone save protects literal body, blank whitespace, and closing quote');
  const invalidStandalone = '<\nslides «\n<id "intro">';
  await replace(standalone, invalidStandalone);
  assert.deepEqual(await applyProvider(), []);
  await standalone.save();
  assert.equal(standalone.getText(), invalidStandalone, 'invalid standalone source saves without unsafe formatting');
  await replace(standalone, standaloneInput);
  await vscode.commands.executeCommand('workbench.action.files.saveAll');
  assert.equal(standalone.getText(), standaloneExpected, 'Save All shares manual formatting');
  const saveReasons: vscode.TextDocumentSaveReason[] = [];
  const saveSubscription = vscode.workspace.onWillSaveTextDocument(event => {
    if (event.document === standalone) saveReasons.push(event.reason);
  });
  const files = vscode.workspace.getConfiguration('files');
  await editorConfiguration.update('formatOnSave', true, vscode.ConfigurationTarget.Workspace);
  await files.update('autoSaveDelay', 100, vscode.ConfigurationTarget.Workspace);
  await files.update('autoSave', 'afterDelay', vscode.ConfigurationTarget.Workspace);
  await replace(standalone, standaloneInput);
  for (let attempt = 0; attempt < 100 && standalone.isDirty; attempt++) {
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.equal(standalone.isDirty, false, 'standalone auto-save completed');
  assert.ok(saveReasons.includes(vscode.TextDocumentSaveReason.AfterDelay));
  assert.equal(standalone.getText(), standaloneInput, 'auto-save does not invoke either Hson save formatting or the new provider');
  await files.update('autoSave', 'off', vscode.ConfigurationTarget.Workspace);
  await editorConfiguration.update('formatOnSave', false, vscode.ConfigurationTarget.Workspace);
  saveSubscription.dispose();
  console.log('ok - standalone Hson: providers, commands, manual Save/Save All, passive auto-save, settings, literal safety, and invalid input');

  const adjacent = '<content<id "intro"> blocks[1,2]>';
  const spaced = '<content <id "intro"> blocks «1,2»>';
  await replace(standalone, adjacent);
  await standalone.save();
  assert.equal(standalone.getText(), spaced, 'standalone save inserts preferred member spacing and canonicalizes legacy arrays');
  for (const language of ['ts', 'tsx']) {
    const text = prefix + 'const value=Hson.data`' + adjacent + '`;';
    const { document } = await open('adjacency.' + language, text);
    await document.save();
    assert.equal(document.getText(), prefix + 'const value=Hson.data`' + spaced + '`;', 'embedded save uses the same relaxed grammar and spacing');
  }
  console.log('ok - structural opener adjacency normalizes on standalone and TS/TSX manual save');

  // Exercise real adapter events in an isolated profile. The focused unit tests
  // inspect the exact theme IDs and cleared/rebuilt decoration buckets.
  const { document: colored } = await open('colored.ts', input);
  const before = colored.getText();
  await editorConfiguration.update('bracketPairColorization.enabled', false, vscode.ConfigurationTarget.Workspace);
  await replace(colored, prefix + 'const ordinary=1;');
  await editorConfiguration.update('bracketPairColorization.enabled', true, vscode.ConfigurationTarget.Workspace);
  await replace(colored, before);
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default High Contrast', vscode.ConfigurationTarget.Workspace);
  for (let attempt = 0; attempt < 50 && vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.HighContrast; attempt++) {
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.equal(vscode.window.activeColorTheme.kind, vscode.ColorThemeKind.HighContrast);
  assert.equal(colored.getText(), before, 'theme/settings presentation does not edit source');
  console.log('ok - isolated VS Code legibility: TS/TSX save, document/selection, Enter, host tabs, literals, Markdown, overridable defaults, and high-contrast/settings events');
}
