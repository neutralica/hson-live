import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import { document_semantic_tokens, hsonSemanticLegend, nativeTokenTypes, nativeTokenModifiers } from "../../src/semantic-tokens.js";
import { load_hson_grammar } from "../../src/highlighting.js";
import { hsonTokenScopes } from "../../src/appearance-internals.js";
import { nativeCompositionSupported } from "./native-composition.js";

import { run_binding_intelligence } from "./bindings.js";

const pause = () => new Promise(resolve => setTimeout(resolve, 100));
function decode(document: vscode.TextDocument, tokens: vscode.SemanticTokens, legend: vscode.SemanticTokensLegend) {
  let line = 0, character = 0;
  const result: { start: number; end: number; type: string | undefined; modifiers: string[] }[] = [];
  for (let i = 0; i < tokens.data.length; i += 5) {
    const delta = tokens.data[i]!; line += delta;
    character = delta ? tokens.data[i + 1]! : character + tokens.data[i + 1]!;
    const start = document.offsetAt(new vscode.Position(line, character));
    result.push({ start, end: start + tokens.data[i + 2]!, type: legend.tokenTypes[tokens.data[i + 3]!],
      modifiers: legend.tokenModifiers.filter((_, bit) => (tokens.data[i + 4]! & (1 << bit)) !== 0) });
  }
  return result;
}
let partColorRequest = 0;
async function verify_part_appearance(workspace: string, extensionPath: string) {
  const baseBody = [
    '<hson-part lib="components" at="foo"/>', '<hson-part at="components/foo"/>', '<hson-part at="foo"/>',
    '<hson-part lib=components at=foo/>', '<hson-part at=components/foo/>', '<hson-part at=foo/>',
    '<div lib="components" at="foo"/>', '<hson-part at=^{each.kind[0]}/>', '<hson-part at="components/%{member}"/>',
  ].join('\n');
  const selectors = ['hsonPartSystemAttribute', 'hsonPartLibrary', 'hsonPartMember', 'hsonPartSeparator'];
  const customColors = ['#112233', '#223344', '#334455', '#445566'];
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
  for (const suffix of ['hson', 'md', 'ts', 'tsx']) {
    if (!nativeCompositionSupported && /tsx?/.test(suffix)) continue;
    const body = baseBody + (/tsx?/.test(suffix) ? '\n<hson-part at="${\n  "foo"\n}" lib="components"/>' : '');
    const prefix = /tsx?/.test(suffix) ? 'import { Hson } from "hson-live/hson";\nconst view = Hson.document`' : suffix === 'md' ? '```hson\n' : '';
    const text = prefix + body + (/tsx?/.test(suffix) ? '`;' : suffix === 'md' ? '\n```' : '');
    const uri = vscode.Uri.file(join(workspace, 'part-colors.' + suffix));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text));
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    // Literal examples keep all tokens visible; offsets are found from source,
    // never manually counted. Dynamic values also assert their reference roles.
    const targets: { start: number; length: number; type: string }[] = [];
    const add = (line: number, fragment: string, type: string) => {
      const source = body.split('\n')[line]!;
      const lineStart = prefix.length + body.split('\n').slice(0, line).reduce((size, line) => size + line.length + 1, 0);
      targets.push({ start: lineStart + source.indexOf(fragment), length: fragment.length, type });
    };
    for (const line of [0, 1, 2, 3, 4, 5, 7, 8]) add(line, 'at', selectors[0]!);
    for (const line of [0, 3]) add(line, 'lib', selectors[0]!);
    for (const line of [0, 1, 3, 4]) add(line, 'components', selectors[1]!);
    for (const line of [0, 1, 2, 3, 4, 5]) add(line, 'foo', selectors[2]!);
    for (const line of [1, 4]) add(line, '/', selectors[3]!);
    add(6, 'lib', 'hsonProperty'); add(6, 'at', 'hsonProperty');
    add(6, 'components', 'hsonString'); add(6, 'foo', 'hsonString');
    add(7, '^', 'hsonLocalReferenceSigil'); add(7, 'kind', 'hsonReference.hsonMember');
    if (/tsx?/.test(suffix)) {
      add(9, 'at', selectors[0]!);
      add(11, 'lib', selectors[0]!);
      add(11, 'components', selectors[1]!);
    }
    add(8, '%', 'hsonIncomingReferenceSigil'); add(8, 'member', 'hsonIncomingReference');
    for (const theme of ['Hson House Light', 'Hson House Dark', 'Default Dark Modern']) {
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Workspace);
      const mode = theme === 'Hson House Light' ? 'light' : theme === 'Hson House Dark' ? 'dark' : undefined;
      const palette = mode ? JSON.parse(await readFile(join(extensionPath, `themes/hson-house-${mode}-color-theme.json`), 'utf8')).semanticTokenColors : undefined;
      if (/tsx?/.test(suffix)) {
        let tokens: ReturnType<typeof decode> = [];
        for (let attempt = 0; attempt < 80; attempt++) {
          const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>('vscode.provideDocumentSemanticTokensLegend', uri);
          const data = await vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentSemanticTokens', uri);
          if (legend && data) tokens = decode(document, data, legend);
          if (tokens.some(token => token.type === selectors[3])) break;
          await pause();
        }
        for (const target of targets) {
          const [type, modifier] = target.type.split('.');
          assert.ok(tokens.some(token => token.start === target.start && token.end === target.start + target.length
            && token.type === type && (!modifier || token.modifiers.includes(modifier))), `${suffix}/${theme}: ${target.type}`);
        }
      }
      for (const customization of ['none', 'semantic', 'textmate']) {
        if (customization === 'semantic') await vscode.workspace.getConfiguration('editor').update('semanticTokenColorCustomizations',
          { rules: Object.fromEntries(selectors.map((selector, index) => [selector, customColors[index]])) }, vscode.ConfigurationTarget.Workspace);
        if (customization === 'textmate') await vscode.workspace.getConfiguration('editor').update('tokenColorCustomizations', {
          textMateRules: selectors.map((selector, index) => ({ scope: hsonTokenScopes[selector]![0], settings: { foreground: customColors[index] } })),
        }, vscode.ConfigurationTarget.Workspace);
        try {
          if (process.env.HSON_BINDING_COLORS !== '1') continue;
          const id = `part-${++partColorRequest}`;
          const tokens = targets.map(target => {
            const position = document.positionAt(target.start), index = selectors.indexOf(target.type);
            // Standalone/Markdown use TextMate for literal syntax; semantic
            // overrides apply to TS/TSX's transported classifications.
            const custom = index >= 0 && (customization === 'textmate' && (!palette || !/tsx?/.test(suffix)) || customization === 'semantic' && /tsx?/.test(suffix));
            const color = custom ? customColors[index] : palette?.[target.type] ?? palette?.[target.type.split('.')[0]!];
            return { lineText: document.lineAt(position.line).text, character: position.character, length: target.length,
              ...(color ? { expected: rgb(color) } : {}) };
          });
          await writeFile(join(workspace, 'binding-color-request.json'), JSON.stringify({ id, theme, customization, document: uri.toString(), tokens,
            pairs: selectors.flatMap(type => {
              const indices = targets.flatMap((target, index) => target.type === type ? [index] : []);
              return indices.slice(1).map(index => [indices[0], index]);
            }) }));
          let responded = false;
          for (let attempt = 0; attempt < 160; attempt++) {
            let response;
            try { response = JSON.parse(await readFile(join(workspace, 'binding-color-response.json'), 'utf8')); } catch {}
            if (response?.id === id) {
              assert.equal(response.error, undefined, `${theme}/${suffix}/${customization}: actual rendered Part colors`);
              responded = true; break;
            }
            await pause();
          }
          assert.ok(responded, 'Part rendered-color probe responded');
        } finally {
          await vscode.workspace.getConfiguration('editor').update('semanticTokenColorCustomizations', undefined, vscode.ConfigurationTarget.Workspace);
          await vscode.workspace.getConfiguration('editor').update('tokenColorCustomizations', undefined, vscode.ConfigurationTarget.Workspace);
        }
      }
    }
  }
  console.log('ok - rendered Part system/Library/member/separator colors in Hson, Markdown, TS and TSX; House, external theme and explicit semantic/TextMate overrides');
}

export async function run(): Promise<void> {
  const workspace = process.env.HSON_HOUSE_WORKSPACE;
  assert.ok(workspace);
  const extension = vscode.extensions.getExtension('terminal-gothic.hson-language');
  assert.ok(extension); await extension.activate();
  await run_binding_intelligence(workspace, extension.extensionPath);
  await verify_part_appearance(workspace, extension.extensionPath);
  const manifest = JSON.parse(await readFile(join(extension.extensionPath, 'package.json'), 'utf8'));
  assert.deepEqual(hsonSemanticLegend.tokenTypes, [...nativeTokenTypes,
    ...manifest.contributes.semanticTokenTypes.map((entry: { id: string }) => entry.id)]);
  assert.deepEqual(hsonSemanticLegend.tokenModifiers, [...nativeTokenModifiers,
    ...manifest.contributes.semanticTokenModifiers.map((entry: { id: string }) => entry.id)]);
  assert.equal(new Set(hsonSemanticLegend.tokenTypes).size, hsonSemanticLegend.tokenTypes.length);
  assert.equal(new Set(hsonSemanticLegend.tokenModifiers).size, hsonSemanticLegend.tokenModifiers.length);
  assert.ok(hsonSemanticLegend.tokenModifiers.length < 32, 'complete modifier legend fits the semantic-token bitset');
  await vscode.extensions.getExtension('vscode.typescript-language-features')?.activate();
  const text = await readFile(join(workspace, 'house.ts'), 'utf8');
  const grammar = load_hson_grammar(extension.extensionPath);
  if (!nativeCompositionSupported) {
    // The 1.95 command allowlist blocks our custom request. Assert the real
    // fallback, including native tokens inside substitutions, without treating
    // a missing composed stream on newer hosts as an acceptable result.
    for (const theme of ['Hson House Light', 'Hson House Dark', 'Default Dark Modern']) {
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Workspace);
      for (const filename of ['house.ts', 'house.tsx']) {
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, filename)));
        await vscode.window.showTextDocument(document);
        const range = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
        let native: ReturnType<typeof decode> = [];
        for (let attempt = 0; attempt < 100; attempt++) {
          const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>('vscode.provideDocumentRangeSemanticTokensLegend', document.uri, range);
          const data = await vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentRangeSemanticTokens', document.uri, range);
          if (legend && data) native = decode(document, data, legend);
          if (native.length > 20) break;
          await pause();
        }
        assert.ok(native.length > 20, `${theme}/${filename}: native TS provider is active`);
        const hole = text.indexOf('${deck.render(slide)}'), end = hole + '${deck.render(slide)}'.length;
        assert.ok(native.some(token => token.start > hole && token.end < end && token.type === 'method'));
        assert.ok(native.some(token => token.start > hole && token.end < end && token.type === 'variable'));
        const cancellation = new vscode.CancellationTokenSource();
        try { assert.equal(await document_semantic_tokens(document, cancellation.token, grammar), undefined); }
        finally { cancellation.dispose(); }
        const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>('vscode.provideDocumentRangeSemanticTokensLegend', document.uri, range);
        const data = await vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentRangeSemanticTokens', document.uri, range);
        assert.ok(legend && data);
        assert.deepEqual(decode(document, data, legend), native, 'fallback preserves the entire native stream');
      }
    }
    await writeFile(join(workspace, 'house-report.json'), JSON.stringify({ vscodeVersion: vscode.version,
      nativeFallback: true, limitation: 'Atomic Hson composition requires VS Code 1.96+' }, null, 2));
    console.log(`ok - VS Code ${vscode.version}: native TS/TSX fallback in all three themes; atomic Hson composition requires 1.96+`);
    return;
  }
  const cancellation = new vscode.CancellationTokenSource();
  const prefix = 'import { Hson } from "hson-live/hson";\n';
  // An identifier crosses a 50k request boundary; a final identifier appears
  // beyond native TS's 100k single-request limit.
  const large = prefix + '//' + 'x'.repeat(49_998 - prefix.length - 9) + '\nconst '
    + 'crossingBoundary = 1;\nconst view = Hson.document`<p "^{local}"/>`;\n'
    + '/*' + 'x'.repeat(60_000) + '*/\nconst finalNative = crossingBoundary;\n';
  const largeUri = vscode.Uri.file(join(workspace, 'large.ts'));
  await vscode.workspace.fs.writeFile(largeUri, Buffer.from(large));
  const largeDocument = await vscode.workspace.openTextDocument(largeUri);
  let composed: vscode.SemanticTokens | undefined;
  for (let attempt = 0; attempt < 50 && !composed; attempt++) {
    composed = await document_semantic_tokens(largeDocument, cancellation.token, grammar);
    if (!composed) await pause();
  }
  assert.ok(composed);
  const decoded = decode(largeDocument, composed, hsonSemanticLegend);
  for (const name of ['crossingBoundary', 'finalNative']) {
    const start = large.indexOf(name);
    assert.equal(decoded.filter(token => token.start === start && token.end === start + name.length && token.type === 'variable').length, 1, name);
  }
  assert.ok(decoded.some(token => token.type === 'hsonLocalReferenceSigil'));
  cancellation.cancel();
  assert.equal(await document_semantic_tokens(largeDocument, cancellation.token, grammar), undefined);
  cancellation.dispose();
  const ordinaryUri = vscode.Uri.file(join(workspace, 'ordinary.ts'));
  await vscode.workspace.fs.writeFile(ordinaryUri, Buffer.from('const ordinary = 1;'));
  const ordinary = await vscode.workspace.openTextDocument(ordinaryUri);
  const fresh = new vscode.CancellationTokenSource();
  assert.equal(await document_semantic_tokens(ordinary, fresh.token, grammar), undefined, 'ordinary TS keeps its viewport provider');
  let rangeProviderCalls = 0;
  const providers = [new vscode.SemanticTokensLegend(['class', 'variable']), new vscode.SemanticTokensLegend(['variable', 'class'])]
    .map(legend => vscode.languages.registerDocumentRangeSemanticTokensProvider({ language: 'typescript', pattern: '**/large.ts' }, {
      provideDocumentRangeSemanticTokens: () => { rangeProviderCalls++; return new vscode.SemanticTokens(new Uint32Array([0, 0, 1, 0, 0])); },
    }, legend));
  try {
    const atomic = await document_semantic_tokens(largeDocument, fresh.token, grammar);
    assert.ok(atomic);
    assert.ok(decode(largeDocument, atomic, hsonSemanticLegend).some(token => token.start === large.indexOf('crossingBoundary') && token.type === 'variable'));
    assert.equal(rangeProviderCalls, 0, 'separate providers and their legend orders cannot influence the atomic TS snapshot');
  } finally { for (const provider of providers) provider.dispose(); }
  for (const newline of ['\n', '\r\n']) {
    const source = 'import { hson } from "hson-live";\nconst view = hson.fromHson(\'<long\\' + newline + 'Name title="😀 hel\\' + newline + 'lo"/>\');';
    const uri = vscode.Uri.file(join(workspace, newline === '\n' ? 'continued.ts' : 'continued-crlf.ts'));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(source));
    const document = await vscode.workspace.openTextDocument(uri);
    let result: vscode.SemanticTokens | undefined;
    for (let attempt = 0; attempt < 50 && !result; attempt++) {
      result = await document_semantic_tokens(document, fresh.token, grammar);
      if (!result) await pause();
    }
    assert.ok(result, 'mapped continuations must build a complete semantic result');
    assert.ok(decode(document, result, hsonSemanticLegend).some(token => token.type === 'hsonType'));
  }
  fresh.dispose();
  const taxonomy = 'import { Hson } from "hson-live/hson";\r\nexport const parts = { card: Hson.document`<section hson:part data:blocks="%{blocks}" <hson-part at="^{block.kind[0]}"/> <list [1,2]> />` };';
  const taxonomyUri = vscode.Uri.file(join(workspace, 'taxonomy.ts'));
  await vscode.workspace.fs.writeFile(taxonomyUri, Buffer.from(taxonomy));
  const taxonomyDocument = await vscode.workspace.openTextDocument(taxonomyUri);
  const taxonomyCancellation = new vscode.CancellationTokenSource();
  try {
    let result: vscode.SemanticTokens | undefined;
    for (let attempt = 0; attempt < 50 && !result; attempt++) {
      result = await document_semantic_tokens(taxonomyDocument, taxonomyCancellation.token, grammar);
      if (!result) await pause();
    }
    assert.ok(result);
    const tokens = decode(taxonomyDocument, result, hsonSemanticLegend);
    for (const [needle, offset, length, type, modifier] of [
      ['data:blocks', 0, 4, 'hsonReceiving', 'hsonQualifier'],
      ['data:blocks', 5, 6, 'hsonReceiving', 'hsonLocalName'],
      ['hson:part', 0, 4, 'hsonDeclaration', 'hsonQualifier'],
      ['hson:part', 5, 4, 'hsonDeclaration', 'hsonLocalName'],
      ['block.kind', 5, 1, 'hsonReference', 'hsonReferenceSeparator'],
      ['block.kind', 6, 4, 'hsonReference', 'hsonMember'],
      ['[0]', 0, 1, 'hsonReference', 'hsonSelectorOpen'],
      ['[0]', 2, 1, 'hsonReference', 'hsonSelectorClose'],
      ['[1,2]', 0, 1, 'hsonDelimiter', 'hsonArrayOpen'],
      ['[1,2]', 4, 1, 'hsonDelimiter', 'hsonArrayClose'],
      ['/>', 0, 1, 'hsonDelimiter', 'hsonSelfClosing'],
      ['/>', 1, 1, 'hsonDelimiter', 'hsonTagClose'],
    ] as const) {
      const start = taxonomy.indexOf(needle) + offset;
      assert.ok(tokens.some(token => token.start === start && token.end === start + length
        && token.type === type && token.modifiers.includes(modifier)), `${needle}: ${type}.${modifier}`);
    }
    for (const [index, token] of tokens.entries()) {
      assert.ok(!index || tokens[index - 1]!.end <= token.start, 'merged tokens remain ordered and nonoverlapping');
      assert.doesNotMatch(taxonomy.slice(token.start, token.end), /[\r\n]/);
    }
    assert.ok(tokens.some(token => token.start === taxonomy.indexOf('card:') && token.type === 'property'), 'native Part object key retained');
    console.log('ok - real VS Code qualifier, role, member and punctuation modifiers retain exact UTF-16 ranges and native object keys');
  } finally { taxonomyCancellation.dispose(); }
  console.log('ok - bounded atomic native composition: chunk boundary, >100k, cancellation, unrelated providers and mapped continuations');
  const reports = [];
  for (const theme of ['Hson House Light', 'Hson House Dark', 'Default Dark Modern']) {
    await vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Workspace);
    for (const filename of ['house.ts', 'house.tsx']) {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, filename)));
      await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
      let merged: ReturnType<typeof decode> = [];
      let native: ReturnType<typeof decode> = [];
      for (let attempt = 0; attempt < 100; attempt++) {
        const range = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
        const nativeLegend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>('vscode.provideDocumentRangeSemanticTokensLegend', document.uri, range);
        const nativeData = await vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentRangeSemanticTokens', document.uri, range);
        const mergedLegend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>('vscode.provideDocumentSemanticTokensLegend', document.uri);
        const mergedData = await vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentSemanticTokens', document.uri);
        if (nativeLegend && nativeData && mergedLegend && mergedData) {
          native = decode(document, nativeData, nativeLegend); merged = decode(document, mergedData, mergedLegend);
          if (native.length && merged.some(token => token.type === 'hsonLocalReferenceSigil')) break;
        }
        await pause();
      }
      assert.ok(native.length > 20, 'native TS provider is active');
      assert.ok(merged.some(token => token.type === 'hsonLocalReferenceSigil'), 'composed Hson provider is active');
      for (const token of native) assert.ok(merged.some(candidate => JSON.stringify(candidate) === JSON.stringify(token)),
        `${theme}/${filename}: native ${text.slice(token.start, token.end)} ${token.type} and modifiers preserved`);
      for (const sigil of ['^', '%']) for (const match of text.matchAll(new RegExp('\\' + sigil + '\\{', 'g'))) {
        assert.ok(merged.some(token => token.start === match.index && token.end === match.index + 1
          && token.type === (sigil === '^' ? 'hsonLocalReferenceSigil' : 'hsonIncomingReferenceSigil')));
      }
      const hole = text.indexOf('${deck.render(slide)}'), end = hole + '${deck.render(slide)}'.length;
      const inside = native.filter(token => token.start > hole && token.end < end);
      assert.ok(inside.some(token => token.type === 'method'));
      assert.ok(inside.some(token => token.type === 'variable'));
      assert.ok(!merged.some(token => token.type?.startsWith('hson') && token.start >= hole && token.end <= end));
      reports.push({ vscodeVersion: vscode.version, theme, filename, nativeTokens: native.length, nativeTokensInHole: inside.length, composedTokens: merged.length });
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, 'house.ts'))), vscode.ViewColumn.One);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, 'house.hson'))), vscode.ViewColumn.Two);
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    await writeFile(join(workspace, 'house-report.json'), JSON.stringify(reports, null, 2));
    console.log(`ok - ${theme}: native TS/TSX outside Hson and inside substitutions preserved`);
    if (process.env.HSON_HOUSE_VISUAL === '1') {
      await writeFile(join(workspace, 'visual-ready.json'), JSON.stringify({ theme }));
      const signal = join(workspace, theme.replaceAll(' ', '-') + '.continue');
      for (let attempt = 0; attempt < 3000; attempt++) {
        if (await access(signal).then(() => true, () => false)) break;
        await pause();
        assert.ok(attempt < 2999, 'visual inspection timed out');
      }
    }
  }
  // Settings are confined to this disposable profile/workspace. Verify user
  // semantic overrides and disabling semantic highlighting remain available.
  await vscode.workspace.getConfiguration('editor').update('semanticTokenColorCustomizations', {
    rules: { hsonLocalReferenceSigil: '#ff0000' },
  }, vscode.ConfigurationTarget.Workspace);
  assert.deepEqual(vscode.workspace.getConfiguration('editor').get('semanticTokenColorCustomizations'), { rules: { hsonLocalReferenceSigil: '#ff0000' } });
  await vscode.workspace.getConfiguration('editor').update('semanticHighlighting.enabled', false, vscode.ConfigurationTarget.Workspace);
  assert.equal(vscode.workspace.getConfiguration('editor').get('semanticHighlighting.enabled'), false);
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default High Contrast', vscode.ConfigurationTarget.Workspace);
  for (let attempt = 0; attempt < 50 && vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.HighContrast; attempt++) await pause();
  assert.equal(vscode.window.activeColorTheme.kind, vscode.ColorThemeKind.HighContrast);
  console.log('ok - non-House and high-contrast selection, semantic override and disabled highlighting retained');
}
