import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as vscode from "vscode";
import { canonical, iteratorColumn, ordinarySibling, invalidSibling, malformedQuotedSibling, escapedControlSibling, receivingPart,
  invalidOperandDocument, malformedContentDocument, conflictingPart } from "../fixtures/bindings.js";
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
  pairs: readonly { at: number; target: number }[], custom = false, authored = false) {
  if (process.env.HSON_BINDING_COLORS !== '1') return;
  const mode = theme === 'Hson House Light' ? 'light' : theme === 'Hson House Dark' ? 'dark' : undefined;
  const palette = mode === undefined ? undefined : JSON.parse(await readFile(join(extensionPath, `themes/hson-house-${mode}-color-theme.json`), 'utf8')).semanticTokenColors;
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
  const tokens = pairs.flatMap(({ at, target }, index) => [target, at].map(offset => {
    const position = document.positionAt(offset), text = document.getText();
    const name = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(offset))![0];
    const color = authored ? index === 0 ? '#126eb3' : '#ab34cd' : custom ? index === 0 ? '#123456' : '#654321' : palette?.[index === 0 ? 'hsonReceiving' : 'hsonIteration'];
    return { lineText: document.lineAt(position.line).text, character: position.character, length: name.length,
      ...(color === undefined ? {} : { expected: rgb(color) }) };
  }));
  const memberOffset = document.getText().indexOf('^{each.kind}') + '^{each.'.length;
  const member = document.positionAt(memberOffset), memberColor = authored ? '#45c687' : palette?.['hsonReference.hsonMember'];
  tokens.push({lineText:document.lineAt(member.line).text, character:member.character, length:4,
    ...(memberColor ? {expected:rgb(memberColor)} : {})});
  await sampleColors(workspace, document, theme, tokens, pairs.map((_, i) => [2 * i, 2 * i + 1]), custom);
}
async function sampleColors(workspace: string, document: vscode.TextDocument, theme: string,
  tokens: { lineText: string; character: number; length: number; expected?: string }[], pairs: number[][], custom = false) {
  const id = ++colorRequest;
  await writeFile(join(workspace, 'binding-color-request.json'), JSON.stringify({ id, theme, document: document.uri.toString(), custom, tokens, pairs }));
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
  const nested = '<main hson:part data:renamed=%{input} <i for:renamed=^{renamed} <b per:key:renamed=^{renamed.children} title=^{renamed.kind}/> <p title="^{renamed?}"/>/> <p title=^{renamed}/>/>';
  const reports: string[] = [];
  for (const [name, text] of [
    ['bindings.hson', canonical], ['bindings.md', '# Markdown\n```hson\n' + canonical + '\n```\nOutside ^{blocks}'],
    ['bindings.ts', prefix + canonical.replace('class="column"', 'class="${hostValue}"') + '`;\nconst tail = hostValue;'],
    ['bindings.tsx', prefix + canonical + '`;\nconst tail = hostValue;'],
    ['adjacent.hson', '<aside/>\n' + iteratorColumn], ['adjacent.ts', prefix + '\n<aside/>\n' + iteratorColumn + '`;'],
    ['nested.hson', nested], ['nested.md', '```hson\n' + nested + '\n```'],
    ['nested.ts', prefix + nested + '`;'], ['nested.tsx', prefix + nested + '`;'],
  ]) {
    const document = await open(workspace, name!, text!);
    await vscode.window.showTextDocument(document);
    const expected = name!.startsWith('nested') ? [
      { at: text!.indexOf('^{renamed}') + 2, target: text!.indexOf('data:renamed') + 5 },
      { at: text!.indexOf('^{renamed.children}') + 2, target: text!.indexOf('for:renamed') + 4 },
      { at: text!.indexOf('^{renamed.kind}') + 2, target: text!.indexOf('per:key:renamed') + 8 },
      { at: text!.indexOf('^{renamed?}') + 2, target: text!.indexOf('for:renamed') + 4 },
      { at: text!.lastIndexOf('^{renamed}') + 2, target: text!.indexOf('data:renamed') + 5 },
    ] : [
      { at: text!.indexOf('^{blocks}') + 2, target: text!.indexOf('data:blocks') + 5 },
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
      assert.deepEqual(await definitions(document, text!.indexOf('%{') + 2), []);
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
        await vscode.workspace.getConfiguration('editor').update('semanticTokenColorCustomizations', { rules: { 'hsonReceiving.hsonLocalName': '#123456', 'hsonIteration.hsonLocalName': '#654321' } }, vscode.ConfigurationTarget.Workspace);
        try { await rendered_colors(workspace, document, 'Default Dark Modern', extensionPath, expected, true); }
        finally { await vscode.workspace.getConfiguration('editor').update('semanticTokenColorCustomizations', undefined, vscode.ConfigurationTarget.Workspace); }
      }
    }
    if (name!.startsWith('adjacent')) {
      const appearance = vscode.workspace.getConfiguration('hson.appearance');
      await appearance.update('state', {palettes:[], assignments:{all:'native'}, overrides:{all:{
        'part.receivingArgument':{dark:{foreground:'#126eb3'}}, 'iteration.name':{dark:{foreground:'#ab34cd'}},
        'reference.member':{dark:{foreground:'#45c687'}},
      }}}, vscode.ConfigurationTarget.Workspace);
      try { await rendered_colors(workspace, document, 'Default Dark Modern', extensionPath, expected, false, true); }
      finally { await appearance.update('state', undefined, vscode.ConfigurationTarget.Workspace); }
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
  // Independent GUI oracle: source spellings set the navigation offsets and
  // distinct authored colors expose receiving, iterator, member and lexical roles.
  const appearance = vscode.workspace.getConfiguration('hson.appearance');
  const colors = {receiving:'#126eb3', iterator:'#ab34cd', member:'#45c687', lexical:'#d95555'};
  await appearance.update('state', {palettes:[], assignments:{all:'native'}, overrides:{all:{
    'part.receivingArgument':{dark:{foreground:colors.receiving}}, 'iteration.name':{dark:{foreground:colors.iterator}},
    'reference.member':{dark:{foreground:colors.member}}, 'reference.local.content':{dark:{foreground:colors.lexical}},
  }}}, vscode.ConfigurationTarget.Workspace);
  try {
    for (const [name, source] of [
      ['ordinary.hson','<main data-flag/>\n'+ordinarySibling], ['ordinary-marked.hson','<main hson:part/>\n'+ordinarySibling],
      ['closed.hson',[invalidSibling,'// 😀',iteratorColumn,'<aside attr="'].join('\n').replaceAll('\n','\r\n')],
      ['hole.ts','import {Hson} from "hson-live/hson";\nconst child = Hson.document`<b/>`;\n'
        +'const doc = Hson.document`<aside ${child}/>\n'+iteratorColumn+'`;'],
    ] as const) {
      const document = await open(workspace,name,source);
      await vscode.window.showTextDocument(document);
      assert.equal(document.getText(),source,'fixture source offsets match the opened document');
      if (source.includes(ordinarySibling)) {
        const at = source.indexOf('^{x}') + 2, position = document.positionAt(at);
        assert.deepEqual(await definitions(document, at), []);
        if (process.env.HSON_BINDING_COLORS === '1') await sampleColors(workspace, document, 'Default Dark Modern',
          [{lineText:document.lineAt(position.line).text, character:position.character, length:1, expected:'rgb(217, 85, 85)'}], []);
      } else {
        const pairs = ([['^{blocks}','data:blocks'],['^{each.kind}','for:each'],['^{each}','for:each']] as const).map(([use,decl]) => ({
          at:source.indexOf(use) + 2, target:source.indexOf(decl) + decl.indexOf(':') + 1,
        }));
        for (const {at,target} of pairs) {
          const found = await definitions(document,at);
          const length = source.startsWith('blocks', at) ? 'blocks'.length : 'each'.length;
          assert.ok(found.length && found.every(item => item.uri === document.uri.toString()
            && document.offsetAt(item.range.start) === target && document.offsetAt(item.range.end) === target + length),name);
        }
        if (name === 'hole.ts') {
          const native = await definitions(document, source.indexOf('${child}') + 2);
          assert.ok(native.some(item => document.offsetAt(item.range.start) === source.indexOf('child =')));
        }
        assert.deepEqual(await definitions(document,source.indexOf('kind}')),[]);
        await rendered_colors(workspace,document,'Default Dark Modern',extensionPath,pairs,false,true);
      }
      reports.push(name);
    }
    const malformed = malformedQuotedSibling + '\n// 😀 <ignored/>\n' + receivingPart;
    const host = 'import {Hson} from "hson-live/hson";\nconst child = Hson.document`<b/>`;\nconst doc = Hson.document`';
    for (const [fixture, body, targets, diagnostic] of [
      ['operand', invalidOperandDocument, [undefined, 88], { code: 'HSON_PART_REFERENCE_INVALID', at: 9 }],
      ['content', malformedContentDocument, [27], { code: 'invalid-json-escape', at: 2 }],
      ['conflict', conflictingPart() + '\n<aside/>', [undefined], undefined],
      ['conflict-reversed', conflictingPart(true) + '\n<aside/>', [undefined], undefined],
    ] as const) for (const ext of ['hson', 'ts']) {
      const name = fixture + '.' + ext;
      const prefix = ext === 'ts' ? '// 😀\r\n' + host.replaceAll('\n', '\r\n') : '';
      const source = prefix + (ext === 'ts' ? body.replaceAll('\n', '\r\n') + '`;' : body);
      const document = await open(workspace, name, source);
      await vscode.window.showTextDocument(document);
      assert.equal(document.getText(), source);
      const offset = (at: number) => prefix.length + at + (ext === 'ts' ? body.slice(0, at).split('\n').length - 1 : 0);
      const roots = [...body.matchAll(/\^\{x\}/g)];
      assert.equal(roots.length, targets.length);
      const samples: {lineText: string; character: number; length: number; expected: string}[] = [];
      for (const [index, root] of roots.entries()) {
        const at = offset(root.index + 2), target = targets[index];
        const found = await definitions(document, at);
        if (target === undefined) assert.deepEqual(found, [], name);
        else assert.ok(found.length && found.every(item => item.uri === document.uri.toString()
          && document.offsetAt(item.range.start) === offset(target) && document.offsetAt(item.range.end) === offset(target + 1)), name);
        for (const start of target === undefined ? [at] : [at, offset(target)]) {
          const pos = document.positionAt(start);
          samples.push({ lineText: document.lineAt(pos.line).text, character: pos.character, length: 1,
            expected: target === undefined ? 'rgb(217, 85, 85)' : 'rgb(18, 110, 179)' });
        }
      }
      if (diagnostic) {
        let found: vscode.Diagnostic | undefined;
        for (let attempt = 0; attempt < 80 && !found; attempt++) {
          found = vscode.languages.getDiagnostics(document.uri).find(item => item.source === 'Hson' && item.code === diagnostic.code);
          if (!found) await pause();
        }
        assert.ok(found, name + ' ' + diagnostic.code);
        assert.equal(document.offsetAt(found.range.start), offset(diagnostic.at));
      }
      if (process.env.HSON_BINDING_COLORS === '1') await sampleColors(workspace, document, 'Default Dark Modern', samples, []);
      reports.push(name);
    }
    for (const [name, source, code] of [
      ['malformed-quote.hson', malformed, 'HSON_STRING_CONTROL_UNESCAPED'],
      ['malformed-quote.ts', host + malformed + '`;', 'HSON_STRING_CONTROL_UNESCAPED'],
      ['escaped-control.hson', escapedControlSibling + '\n' + receivingPart, 'HSON_STRING_CONTROL_UNESCAPED'],
      ['escaped-control.ts', host + escapedControlSibling + '\n' + receivingPart + '`;', 'HSON_STRING_CONTROL_UNESCAPED'],
      ['split-line-note.ts', host + '/${child}/ note ' + receivingPart + '`;', 'HSON_INTERPOLATION_POSITION_INVALID'],
      ['split-block-star.ts', host + '/${child}*' + receivingPart + '`;', undefined],
      ['split-closer.ts', host + '<aside /${child}>\n' + receivingPart + '`;', 'HSON_INTERPOLATION_POSITION_INVALID'],
      ['split-comment.ts', host + '<aside /${child}/ <span/>/>' + receivingPart + '`;', undefined],
    ] as const) {
      const document = await open(workspace, name, source);
      await vscode.window.showTextDocument(document);
      assert.equal(document.getText(), source);
      const at = source.indexOf('^{x}') + 2, target = source.indexOf('data:x') + 5;
      const found = await definitions(document, at);
      assert.ok(found.length && found.every(item => item.uri === document.uri.toString()
        && document.offsetAt(item.range.start) === target && document.offsetAt(item.range.end) === target + 1), name);
      const hole = source.indexOf('${child}');
      if (hole >= 0) {
        const native = await definitions(document, hole + 2);
        assert.ok(native.some(item => document.offsetAt(item.range.start) === source.indexOf('child =')), name);
      }
      if (code !== undefined) {
        let diagnostic: vscode.Diagnostic | undefined;
        for (let attempt = 0; attempt < 80 && !diagnostic; attempt++) {
          diagnostic = vscode.languages.getDiagnostics(document.uri).find(item => item.source === 'Hson' && item.code === code);
          if (!diagnostic) await pause();
        }
        assert.ok(diagnostic, name + ' retains ' + code);
        if (code === 'HSON_STRING_CONTROL_UNESCAPED') {
          assert.equal(document.offsetAt(diagnostic.range.start), source.indexOf('\n', source.indexOf('<aside title="a')));
        }
      }
      if (process.env.HSON_BINDING_COLORS === '1') {
        const tokens = [target, at].map(offset => {
          const position = document.positionAt(offset);
          return {lineText:document.lineAt(position.line).text, character:position.character, length:1, expected:'rgb(18, 110, 179)'};
        });
        await sampleColors(workspace, document, 'Default Dark Modern', tokens, [[0, 1]]);
      }
      reports.push(name);
    }
  } finally { await appearance.update('state',undefined,vscode.ConfigurationTarget.Workspace); }
  const editable = await open(workspace, 'changes.hson', canonical);
  const renamed = canonical.replaceAll('blocks', 'renamed');
  const edit = new vscode.WorkspaceEdit(); edit.replace(editable.uri, new vscode.Range(editable.positionAt(0), editable.positionAt(canonical.length)), renamed);
  assert.ok(await vscode.workspace.applyEdit(edit));
  const moved = await definitions(editable, renamed.indexOf('^{renamed}') + 2);
  assert.equal(editable.offsetAt(moved[0]!.range.start), renamed.indexOf('data:renamed') + 5);
  const broken = renamed.replace('data:renamed', 'data:different');
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
  const contractText = 'import {Hson} from "hson-live/hson"; export const contract = Hson.document`<main hson:part data:model=%{payload} <p title=^{model.title}/>/>';
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
  const conflictSource = 'import {Hson} from "hson-live/hson"; import {hsonLiveMap} from "hson-live/livemap";\n'
    + 'hsonLiveMap.locus.create({components:{parts:{x:{kind:"document",document:Hson.document`' + conflictingPart() + '`}}}});';
  const conflict = await open(project, 'conflicting-contract.ts', conflictSource);
  await vscode.window.showTextDocument(conflict);
  let conflictIssue: vscode.Diagnostic | undefined;
  for (let attempt = 0; attempt < 150 && !conflictIssue; attempt++) {
    conflictIssue = vscode.languages.getDiagnostics(conflict.uri).find(item => item.message.includes('Conflicting Part local binding "x".'));
    if (!conflictIssue) await pause();
  }
  assert.ok(conflictIssue, 'governed Part retains its conflict in Problems');
  assert.equal(conflict.getText(conflictIssue.range), '%{b}');
  assert.deepEqual(await definitions(conflict, conflictSource.indexOf('^{x}') + 2), []);
  console.log('ok - registered binding Definition/semantic providers: ' + reports.join(', ') + '; edits, native substitutions, cross-file related diagnostics, governed selectors and mapped TS members');
}
