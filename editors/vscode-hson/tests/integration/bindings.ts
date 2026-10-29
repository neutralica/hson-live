import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as vscode from "vscode";
import { canonical } from "../fixtures/bindings.js";
import { nativeCompositionSupported } from "./native-composition.js";

const pause = () => new Promise(resolve => setTimeout(resolve, 100));
async function open(workspace: string, name: string, text: string) {
  const uri = vscode.Uri.file(join(workspace, name));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text));
  return vscode.workspace.openTextDocument(uri);
}
async function definitions(document: vscode.TextDocument, offset: number) {
  const results = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
    'vscode.executeDefinitionProvider', document.uri, document.positionAt(offset));
  return (results ?? []).map(result => 'targetUri' in result
    ? { uri: result.targetUri.toString(), range: result.targetSelectionRange ?? result.targetRange } : { uri: result.uri.toString(), range: result.range });
}
function decode(document: vscode.TextDocument, data: vscode.SemanticTokens, legend: vscode.SemanticTokensLegend) {
  let line = 0, char = 0;
  const tokens: { start: number; end: number; type: string; modifiers: string[] }[] = [];
  for (let index = 0; index < data.data.length; index += 5) {
    const delta = data.data[index]!; line += delta;
    char = delta ? data.data[index + 1]! : char + data.data[index + 1]!;
    const start = document.offsetAt(new vscode.Position(line, char));
    tokens.push({ start, end: start + data.data[index + 2]!, type: legend.tokenTypes[data.data[index + 3]!]!,
      modifiers: legend.tokenModifiers.filter((_, bit) => (data.data[index + 4]! & (1 << bit)) !== 0) });
  }
  return tokens;
}
let colorRequest = 0;
async function rendered_colors(workspace: string, document: vscode.TextDocument, theme: string, extensionPath: string,
  pairs: readonly { at: number; target: number }[], custom = false) {
  if (process.env.HSON_BINDING_COLORS !== '1') return;
  const mode = theme === 'Hson House Light' ? 'light' : theme === 'Hson House Dark' ? 'dark' : undefined;
  const palette = mode === undefined ? undefined : JSON.parse(await readFile(join(extensionPath, `themes/hson-house-${mode}-color-theme.json`), 'utf8')).semanticTokenColors;
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
  const id = ++colorRequest;
  const tokens = pairs.flatMap(({ at, target }, index) => [target, at].map(offset => {
    const position = document.positionAt(offset), text = document.getText();
    const name = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(offset))![0];
    const color = custom ? index === 0 ? '#123456' : '#654321' : palette?.[index === 0 ? 'hsonReceiving' : 'hsonIteration'];
    return { lineText: document.lineAt(position.line).text, character: position.character, length: name.length,
      ...(color === undefined ? {} : { expected: rgb(color) }) };
  }));
  await writeFile(join(workspace, 'binding-color-request.json'), JSON.stringify({ id, theme, document: document.uri.toString(), custom, tokens, pairs: pairs.map((_, i) => [2 * i, 2 * i + 1]) }));
  for (let attempt = 0; attempt < 160; attempt++) {
    let response;
    try { response = JSON.parse(await readFile(join(workspace, 'binding-color-response.json'), 'utf8')); } catch {}
    if (response?.id === id) { assert.equal(response.error, undefined, `${theme}: actual rendered binding colors`); return; }
    await pause();
  }
  assert.fail('Native rendered-color probe did not respond');
}
export async function run_binding_intelligence(workspace: string, extensionPath: string): Promise<void> {
  const prefix = 'import {Hson} from "hson-live/hson";\nconst hostValue = "native";\nconst doc = Hson.document`';
  const nested = '<main hson:part renamed:data=%{input} <i for:renamed=^{renamed} <b per:key:renamed=^{renamed.children} title=^{renamed.kind}/> <p title="^{renamed?}"/>/> <p title=^{renamed}/>/>';
  const reports: string[] = [];
  for (const [name, text] of [
    ['bindings.hson', canonical], ['bindings.md', '# Markdown\n```hson\n' + canonical + '\n```\nOutside ^{blocks}'],
    ['bindings.ts', prefix + canonical.replace('class="column"', 'class="${hostValue}"') + '`;\nconst tail = hostValue;'],
    ['bindings.tsx', prefix + canonical + '`;\nconst tail = hostValue;'],
    ['nested.hson', nested], ['nested.md', '```hson\n' + nested + '\n```'],
    ['nested.ts', prefix + nested + '`;'], ['nested.tsx', prefix + nested + '`;'],
  ]) {
    const document = await open(workspace, name!, text!);
    await vscode.window.showTextDocument(document);
    const expected = name!.startsWith('nested') ? [
      { at: text!.indexOf('^{renamed}') + 2, target: text!.indexOf('renamed:data') },
      { at: text!.indexOf('^{renamed.children}') + 2, target: text!.indexOf('for:renamed') + 4 },
      { at: text!.indexOf('^{renamed.kind}') + 2, target: text!.indexOf('per:key:renamed') + 8 },
      { at: text!.indexOf('^{renamed?}') + 2, target: text!.indexOf('for:renamed') + 4 },
      { at: text!.lastIndexOf('^{renamed}') + 2, target: text!.indexOf('renamed:data') },
    ] : [
      { at: text!.indexOf('^{blocks}') + 2, target: text!.indexOf('blocks:data') },
      { at: text!.indexOf('^{each.kind}') + 2, target: text!.indexOf('for:each') + 4 },
      { at: text!.indexOf('^{each}') + 2, target: text!.indexOf('for:each') + 4 },
    ];
    for (const { at, target } of expected) {
      const found = await definitions(document, at);
      assert.ok(found.some(location => location.uri === document.uri.toString() && document.offsetAt(location.range.start) === target), `${name} definition at ${at}: ${JSON.stringify(found)}`);
      assert.ok(found.every(location => location.uri === document.uri.toString() && document.offsetAt(location.range.start) === target), 'no unrelated declaration');
    }
    assert.deepEqual(await definitions(document, text!.indexOf('kind}')), [], `${name}: members are not local roots`);
    if (!name!.startsWith('nested')) {
      assert.deepEqual(await definitions(document, text!.indexOf('someBlocks')), []);
      if (name!.endsWith('.md')) assert.deepEqual(await definitions(document, text!.lastIndexOf('blocks')), []);
      for (const theme of ['Hson House Light', 'Hson House Dark', 'Default Dark Modern']) {
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Workspace);
        let tokens: ReturnType<typeof decode> = [];
        for (let attempt = 0; attempt < 80; attempt++) {
          const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>('vscode.provideDocumentSemanticTokensLegend', document.uri);
          const data = await vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentSemanticTokens', document.uri);
          if (legend && data) tokens = decode(document, data, legend);
          if (tokens.some(token => token.start === expected[0]!.at)) break;
          if (!nativeCompositionSupported && name!.match(/\.tsx?$/)) break;
          await pause();
        }
        if (nativeCompositionSupported || !name!.match(/\.tsx?$/)) for (const { at, target } of expected) {
          const ref = tokens.find(token => token.start === at), declaration = tokens.find(token => token.start === target);
          assert.ok(ref && declaration, `${theme}/${name} active semantic binding overlay`);
          assert.equal(ref.type, declaration.type); assert.deepEqual(ref.modifiers, declaration.modifiers);
        }
        if (nativeCompositionSupported || !name!.match(/\.tsx?$/)) await rendered_colors(workspace, document, theme, extensionPath, expected);
        if (name!.endsWith('.md')) assert.ok(tokens.every(token => token.start >= text!.indexOf('<div') && token.end <= text!.indexOf('\n```', text!.indexOf('<div'))));
      }
      if (nativeCompositionSupported || !name!.match(/\.tsx?$/)) {
        await vscode.workspace.getConfiguration('editor').update('semanticTokenColorCustomizations', { rules: { 'hsonReceiving.hsonQualifier': '#123456', 'hsonIteration.hsonLocalName': '#654321' } }, vscode.ConfigurationTarget.Workspace);
        try { await rendered_colors(workspace, document, 'Default Dark Modern', extensionPath, expected, true); }
        finally { await vscode.workspace.getConfiguration('editor').update('semanticTokenColorCustomizations', undefined, vscode.ConfigurationTarget.Workspace); }
      }
    }
    if (name === 'bindings.ts') {
      for (const offset of [text!.indexOf('${hostValue}') + 2, text!.lastIndexOf('hostValue')]) {
        let found: Awaited<ReturnType<typeof definitions>> = [];
        for (let attempt = 0; attempt < 80 && !found.length; attempt++) { found = await definitions(document, offset); if (!found.length) await pause(); }
        assert.ok(found.some(location => document.offsetAt(location.range.start) === text!.indexOf('hostValue')), 'host TypeScript and substitution navigation retained');
      }
    }
    reports.push(name!);
  }
  const editable = await open(workspace, 'changes.hson', canonical);
  const renamed = canonical.replaceAll('blocks', 'renamed');
  const edit = new vscode.WorkspaceEdit(); edit.replace(editable.uri, new vscode.Range(editable.positionAt(0), editable.positionAt(canonical.length)), renamed);
  assert.ok(await vscode.workspace.applyEdit(edit));
  const moved = await definitions(editable, renamed.indexOf('^{renamed}') + 2);
  assert.equal(editable.offsetAt(moved[0]!.range.start), renamed.indexOf('renamed:data'));
  const broken = renamed.replace('renamed:data', 'different:data');
  const breakEdit = new vscode.WorkspaceEdit(); breakEdit.replace(editable.uri, new vscode.Range(editable.positionAt(0), editable.positionAt(renamed.length)), broken);
  await vscode.workspace.applyEdit(breakEdit);
  assert.deepEqual(await definitions(editable, broken.indexOf('^{renamed}') + 2), []);

  // A real resolved project exercises compiler-owned contracts, selector navigation
  // and the separate native mapped-type repair, through registered VS Code providers.
  const project = join(workspace, 'part-project');
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(project));
  const root = process.env.HSON_BINDING_SOURCE_ROOT ?? resolve(extensionPath, '../..');
  await open(project, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', skipLibCheck: true, types: [],
    paths: { 'hson-live': [join(root, 'src/index.ts')], 'hson-live/hson': [join(root, 'src/hson-authoring.ts')], 'hson-live/livemap': [join(root, 'src/api/livemap/index.ts')] } }, include: ['*.ts'] }));
  await open(project, 'package.json', '{"type":"module"}');
  const contractText = 'import {Hson} from "hson-live/hson"; export const contract = Hson.document`<main hson:part model:data=%{payload} <p title=^{model.title}/>/>';
  const contract = await open(project, 'contract.ts', contractText + '`;');
  const source = 'import {Hson} from "hson-live/hson"; import {hsonLiveMap} from "hson-live/livemap"; import {contract} from "./contract.js";\n'
    + 'const loc = hsonLiveMap.fromLibraries({page:{document:Hson.document`<hson-part at="components/x"/>`}, components:{parts:{x:{kind:"document",document:contract}}}});\n'
    + 'const components = {heading:{kind:"document",document:"<h1 hson:part/>"}} as const; const other = hsonLiveMap.locus.create({components:{parts:components}});\ncomponents.heading; other.parts.components.heading;';
  const app = await open(project, 'app.ts', source);
  await vscode.window.showTextDocument(app);
  let related: vscode.Diagnostic | undefined;
  for (let attempt = 0; attempt < 150; attempt++) {
    related = vscode.languages.getDiagnostics(app.uri).find(d => d.message.includes('Missing Part parameter "payload"'));
    if (related?.relatedInformation?.length) break;
    await pause();
  }
  assert.ok(related, 'existing contract diagnostic reaches the real VS Code Problems collection');
  assert.ok(related.relatedInformation?.some(info => info.location.uri.toString() === contract.uri.toString()
    && contract.getText(info.location.range) === 'model'), 'Problems links to the receiving declaration in its source file');
  const selector = await definitions(app, source.indexOf('components/x') + 11);
  assert.ok(selector.some(location => location.uri === app.uri.toString() && app.offsetAt(location.range.start) === source.indexOf('x:{')), 'governed selector uses the existing inventory declaration');
  const direct = await definitions(app, source.indexOf('components.heading') + 12);
  const governed = await definitions(app, source.lastIndexOf('heading') + 2);
  assert.ok(direct.length && governed.length);
  assert.deepEqual(governed, direct, 'native mapped member points to the same authored heading key');
  console.log('ok - registered binding Definition/semantic providers: ' + reports.join(', ') + '; edits, native substitutions, cross-file related diagnostics, governed selectors and mapped TS members');
}
