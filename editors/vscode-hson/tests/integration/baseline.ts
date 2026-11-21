import assert from "node:assert/strict";
import { join } from "node:path";
import * as vscode from "vscode";
import { nativeCompositionSupported } from "./native-composition.js";
import { HSON_BRANDING } from "../../src/appearance-branding.generated.js";

async function pause(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 100)); }

export async function run(): Promise<void> {
  const workspace = process.env.HSON_BASELINE_WORKSPACE!;
  const probe = process.env.HSON_BASELINE_PROBE === "1";
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "baseline.ts")));
  await vscode.window.showTextDocument(doc);
  const extension = vscode.extensions.getExtension("terminal-gothic.hson-language");
  assert.ok(extension);
  // Do not activate explicitly: exercise the installed activation event.
  for (let n = 0; n < 100 && !extension.isActive; n++) await pause();
  assert.equal(extension.isActive, true);
  assert.equal(vscode.workspace.isTrusted, process.env.HSON_BASELINE_RESTRICTED !== "1");
  const markerColors = extension.packageJSON.contributes.colors;
  assert.deepEqual(markerColors.map((color: { id: string }) => color.id), [
    "hson.libraryMarker.h", "hson.libraryMarker.s", "hson.libraryMarker.o", "hson.libraryMarker.n",
    "hson.authoringMarker.h", "hson.authoringMarker.s", "hson.authoringMarker.o", "hson.authoringMarker.n",
    "hson.libraryMarker.separator",
  ]);
  assert.ok(markerColors.every((color: { defaults: object }) =>
    ["dark", "light", "highContrast", "highContrastLight"].every(key => key in color.defaults)));
  const settings = Object.assign({}, ...extension.packageJSON.contributes.configuration.map(
    (group: { properties: object }) => group.properties,
  ));
  assert.equal(settings["hson.appearance.authoringMarkerStrength"].default, HSON_BRANDING.authoringOpacity);
  assert.equal(settings["hson.appearance.libraryMarkerStrength"].multipleOf, undefined);
  assert.equal(settings["hson.appearance.authoringMarkerStrength"].multipleOf, undefined);
  const hueDefaults = HSON_BRANDING.colors;
  for (const [key, value] of Object.entries(hueDefaults)) {
    const colorSetting = settings[`hson.appearance.${key}`];
    assert.equal(colorSetting.default, value); assert.equal(colorSetting.type, "string");
    assert.ok(new RegExp(colorSetting.pattern).test(value));
  }
  assert.equal(settings["hson.appearance.orange"], undefined);
  assert.equal(settings["hson.appearance.colorLibraryMarker"].default, HSON_BRANDING.colorLibraryMarker);
  assert.equal(settings["hson.appearance.librarySeparatorColor"].default, HSON_BRANDING.librarySeparator.color);
  const override = {
    "hson.libraryMarker.h": "#123456",
    "hson.authoringMarker.h": "#123456CC",
    "hson.libraryMarker.separator": "#654321",
  };
  await vscode.workspace.getConfiguration("workbench").update("colorCustomizations", override, vscode.ConfigurationTarget.Global);
  assert.deepEqual(vscode.workspace.getConfiguration("workbench").get("colorCustomizations"), override);
  const appearance = vscode.workspace.getConfiguration("hson.appearance", doc.uri);
  await appearance.update("authoringMarkerStrength", 0.35, vscode.ConfigurationTarget.Workspace);
  assert.equal(vscode.workspace.getConfiguration("hson.appearance", doc.uri).get("authoringMarkerStrength"), 0.35);
  assert.equal(extension.isActive, true, "authoring marker strength refresh must not reload the extension");
  await appearance.update("libraryMarkerStrength", 0.55, vscode.ConfigurationTarget.Workspace);
  assert.equal(vscode.workspace.getConfiguration("hson.appearance", doc.uri).get("libraryMarkerStrength"), 0.55);
  assert.equal(extension.isActive, true, "library marker strength refresh must not reload the extension");
  for (const [key, color] of [["blue", "#102030"], ["yellow", "#405060"], ["pink", "#708090"], ["green", "#A0B0C0"]]) {
    await appearance.update(key, color, vscode.ConfigurationTarget.Workspace);
    assert.equal(vscode.workspace.getConfiguration("hson.appearance", doc.uri).get(key), color);
    assert.equal(extension.isActive, true, `${key} marker color refresh must not reload the extension`);
  }
  await appearance.update("librarySeparatorColor", "#1122CC", vscode.ConfigurationTarget.Workspace);
  assert.equal(vscode.workspace.getConfiguration("hson.appearance", doc.uri).get("librarySeparatorColor"), "#1122CC");
  assert.equal(extension.isActive, true, "separator color refresh must not reload the extension");
  await appearance.update("colorLibraryMarker", false, vscode.ConfigurationTarget.Workspace);
  assert.equal(vscode.workspace.getConfiguration("hson.appearance", doc.uri).get("colorLibraryMarker"), false);
  assert.equal(extension.isActive, true, "lowercase marker toggle refresh must not reload the extension");
  assert.deepEqual(vscode.workspace.getConfiguration("workbench").get("colorCustomizations"), override,
    "shared colors do not mutate the advanced theme-specific color IDs");
  for (const [key, value] of Object.entries(hueDefaults)) {
    await appearance.update(key, undefined, vscode.ConfigurationTarget.Workspace);
    assert.equal(vscode.workspace.getConfiguration("hson.appearance", doc.uri).get(key), value);
  }
  await appearance.update("librarySeparatorColor", undefined, vscode.ConfigurationTarget.Workspace);
  await appearance.update("colorLibraryMarker", undefined, vscode.ConfigurationTarget.Workspace);
  await appearance.update("authoringMarkerStrength", undefined, vscode.ConfigurationTarget.Workspace);
  await appearance.update("libraryMarkerStrength", undefined, vscode.ConfigurationTarget.Workspace);
  assert.equal(vscode.workspace.getConfiguration("hson.appearance", doc.uri).get("authoringMarkerStrength"), HSON_BRANDING.authoringOpacity);
  assert.equal(vscode.workspace.getConfiguration("hson.appearance", doc.uri).get("libraryMarkerStrength"), HSON_BRANDING.libraryOpacity);
  assert.equal(vscode.workspace.getConfiguration("hson.appearance", doc.uri).get("librarySeparatorColor"), HSON_BRANDING.librarySeparator.color);
  assert.equal(vscode.workspace.getConfiguration("hson.appearance", doc.uri).get("colorLibraryMarker"), HSON_BRANDING.colorLibraryMarker);
  await vscode.commands.executeCommand("hson.openSettings");
  assert.equal(extension.isActive, true, "opening native Hson Settings must not reload the extension");
  process.stdout.write("ok - real VS Code strengths, four shared colors, lowercase toggle, and separator color update and restore live without extension reload; contributed color overrides remain intact; Hson Settings command opens\n");
  const syntax = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", doc.uri);
  const grammarHighlighted = JSON.stringify(syntax).includes("entity.name.type.hson");
  const nativeExtension = vscode.extensions.getExtension('vscode.typescript-language-features');
  assert.ok(nativeExtension || !vscode.workspace.isTrusted, 'trusted host must expose the native TS service');
  if (!nativeExtension) assert.ok(vscode.extensions.getExtension('vscode.typescript'), 'Restricted Mode retains the built-in TS syntax grammar');
  await nativeExtension?.activate();
  const compositionAvailable = nativeCompositionSupported && nativeExtension !== undefined;
  let semanticHighlighted = false;
  // Extension activation and the first TS project snapshot are asynchronous,
  // including in the separate Restricted Mode profile.
  for (let attempt = 0; attempt < (compositionAvailable ? 50 : 1); attempt++) {
    const semantic = await vscode.commands.executeCommand<vscode.SemanticTokens>("vscode.provideDocumentSemanticTokens", doc.uri);
    const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>("vscode.provideDocumentSemanticTokensLegend", doc.uri);
    semanticHighlighted = !!semantic?.data.length && !!legend?.tokenTypes.some(type => type.startsWith("hson"));
    if (semanticHighlighted) break;
    await pause();
  }
  const diagnostics = () => vscode.languages.getDiagnostics(doc.uri).filter(d => d.source === "Hson");
  const edit = async (body: string) => {
    const text = doc.getText(), tag = "Hson.canonical`";
    const tagStart = text.indexOf(tag);
    assert.notEqual(tagStart, -1, "baseline edit must target the authored Hson template");
    const start = tagStart + tag.length, end = text.indexOf("`", start);
    const change = new vscode.WorkspaceEdit();
    change.replace(doc.uri, new vscode.Range(doc.positionAt(start), doc.positionAt(end)), body);
    assert.equal(await vscode.workspace.applyEdit(change), true);
  };
  const waitFor = async (count: number) => {
    for (let n = 0; n < 50 && diagnostics().length !== count; n++) await pause();
    return diagnostics().length;
  };
  assert.equal(diagnostics().length, 0);
  await edit("<thing !!!");
  const invalidCount = await waitFor(1);
  if (!probe) {
    if (compositionAvailable) {
      assert.ok(grammarHighlighted || semanticHighlighted, "official Hson must receive grammar-backed highlighting");
    } else if (!nativeExtension) {
      assert.equal(semanticHighlighted, false, 'Hson yields when the host disables the native TS service');
      console.log(`ok - VS Code ${vscode.version}: Restricted Mode disables the native TS semantic extension; composed tokens unavailable`);
    } else {
      assert.equal(semanticHighlighted, false, "pre-1.96 hosts cannot acquire an atomic native snapshot");
      const range = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
      const native = await vscode.commands.executeCommand<vscode.SemanticTokens>("vscode.provideDocumentRangeSemanticTokens", doc.uri, range);
      assert.ok(native?.data.length, "native TypeScript highlighting remains available on pre-1.96 hosts");
      console.log(`ok - VS Code ${vscode.version}: native TS fallback; composed Hson tokens require 1.96+`);
    }
    assert.equal(invalidCount, 1, "zero-Schema invalid Hson must be diagnosed");
  }
  await edit('\n <thing "readable" >\n');
  const correctedCount = await waitFor(0);
  assert.equal(correctedCount, 0);
  assert.equal(doc.isDirty, true, "correction is unsaved");
  await edit("+1");
  const republishedCount = await waitFor(1);
  if (!probe) assert.equal(republishedCount, 1);
  const replace = async (text: string) => {
    const change = new vscode.WorkspaceEdit();
    change.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(change), true);
  };
  const event = 'import { Hson as author } from "hson-live/hson";\n'
    + 'const event = author.event`\n<hson:event on:key:down local:save note:str="🧪\\u0061"\n key:str=^{key.nope} <> >`;';
  if (!probe && !compositionAvailable) {
    await replace(event + '\nimport {Hson} from "hson-live"; Hson.canonical`+1`;');
    for (let n = 0; n < 50 && !diagnostics().some(issue => issue.code === "HSON_NUMBER_LEADING_PLUS"); n++) await pause();
    assert.deepEqual(diagnostics().map(issue => issue.code), ["HSON_NUMBER_LEADING_PLUS"]);
    console.log("ok - without a semantic service Event evidence stays empty and canonical diagnostics remain available");
  }
  if (!probe && compositionAvailable) {
    for (const [name, eol] of [["lf", "\n"], ["crlf", "\r\n"], ["cr", "\r"], ["astral", "\r"]] as const) {
      const uri = vscode.Uri.file(join(workspace, `event-${name}.ts`));
      assert.ok(!vscode.workspace.textDocuments.some(document => document.uri.toString() === uri.toString()));
      const bytes = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString();
      assert.ok(bytes.includes(eol));
      if (eol === "\r") assert.ok(!bytes.includes("\n"));
      const duplicate = () => vscode.languages.getDiagnostics(uri).filter(issue =>
        issue.source === "Hson" && /Duplicate authored event header/.test(issue.message));
      for (let n = 0; n < 50 && duplicate().length === 0; n++) await pause();
      const [issue] = duplicate();
      assert.equal(duplicate().length, 1, name);
      const coords = ({ start, end }: vscode.Range) => [start.line + 1, start.character + 1, end.line + 1, end.character + 1];
      assert.deepEqual({
        primary: coords(issue!.range),
        related: issue!.relatedInformation?.map(item => [item.location.uri.toString(), coords(item.location.range)]),
      }, {
        primary: name === "astral" ? [2, 74, 2, 75] : [3, 2, 3, 3],
        related: [[uri.toString(), name === "astral" ? [2, 69, 2, 70] : [2, 54, 2, 55]]],
      }, name);
    }
    console.log("ok - closed Event files publish primary and related UTF-16 ranges under LF, CRLF, and lone CR");
    const config = vscode.Uri.file(join(workspace, "events/tsconfig.events.json"));
    const consumer = vscode.Uri.file(join(workspace, "events/consumer.ts"));
    const mirror = vscode.Uri.file(join(workspace, "mirror/consumer.ts"));
    const producer = vscode.Uri.file(join(workspace, "events/producer.ts"));
    const shim = vscode.Uri.file(join(workspace, "events/late-shim.ts"));
    const openConsumer = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "events/open-consumer.ts")));
    await vscode.window.showTextDocument(openConsumer);
    const consumerVersion = openConsumer.version;
    const hsonCodes = (uri: vscode.Uri) => vscode.languages.getDiagnostics(uri).filter(issue => issue.source === "Hson").map(issue => issue.code);
    const waitUntil = async (valid: () => boolean | Promise<boolean>, label: string) => {
      for (let n = 0; n < 80; n++) {
        if (await valid()) return;
        await pause();
      }
      assert.fail(label);
    };
    const sdkFile = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "sdk/consumer.ts")));
    await vscode.window.showTextDocument(sdkFile);
    const sdkCodes = () => vscode.languages.getDiagnostics(sdkFile.uri).map(issue => issue.code);
    await waitUntil(() => sdkCodes().includes(2322), "active compiler diagnostics");
    const sdkEventCount = () => sdkCodes().filter(code => code === "HSON_DECLARATIVE_ROOT_REQUIRED").length;
    await waitUntil(() => sdkEventCount() === (sdkCodes().includes(2339) ? 1 : 2),
      "conditional exports follow the active SDK");
    const bridge = vscode.Uri.file(join(workspace, "sdk/bridge.ts"));
    await vscode.workspace.fs.writeFile(bridge, Buffer.from('export {Hson} from "hson-live";'));
    await waitUntil(() => sdkCodes().includes(2322) && !sdkCodes().includes(2339) && sdkEventCount() === 2,
      "genuine named export restores evidence");
    await vscode.window.showTextDocument(openConsumer);
    const eventToken = async (): Promise<boolean> => {
      const values = await vscode.commands.executeCommand<vscode.SemanticTokens>("vscode.provideDocumentSemanticTokens", openConsumer.uri);
      const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>("vscode.provideDocumentSemanticTokensLegend", openConsumer.uri);
      const start = openConsumer.positionAt(openConsumer.getText().indexOf("<hson:event"));
      let line = 0, column = 0;
      for (let i = 0; values && i < values.data.length; i += 5) {
        const delta = values.data[i]!;
        line += delta; column = delta ? values.data[i + 1]! : column + values.data[i + 1]!;
        if (line === start.line && column === start.character && legend?.tokenTypes[values.data[i + 3]!]?.startsWith("hson")) return true;
      }
      return false;
    };
    const expectProvenance = async (official: boolean, label: string) => {
      await waitUntil(() => {
        const open = vscode.languages.getDiagnostics(openConsumer.uri);
        return hsonCodes(consumer).includes("HSON_DECLARATIVE_ROOT_REQUIRED") === official
          && hsonCodes(mirror).includes("HSON_DECLARATIVE_ROOT_REQUIRED") === official
          && hsonCodes(openConsumer.uri).includes("HSON_DECLARATIVE_ROOT_REQUIRED") === official
          && hsonCodes(openConsumer.uri).includes("HSON_NUMBER_LEADING_PLUS")
          && (!vscode.workspace.isTrusted || open.some(issue => issue.code === 2322)
            && open.some(issue => issue.code === 95002 && issue.message.includes('local declaration "missing"')) === official);
      }, label + " diagnostics");
      if (compositionAvailable) await waitUntil(async () => (await eventToken()) === official, label + " semantic tokens");
      assert.equal(openConsumer.version, consumerVersion, label + " leaves the consumer source alone");
    };
    await expectProvenance(true, "two official projects");
    assert.ok(!vscode.workspace.textDocuments.some(document => document.uri.toString() === producer.toString()));
    await waitUntil(() => hsonCodes(producer).includes("HSON_EVENT_REFERENCE_INVALID"), "closed TypeScript producer through a JS re-export");
    assert.deepEqual(hsonCodes(producer), ["HSON_EVENT_REFERENCE_INVALID"]);
    const openedProducer = await vscode.workspace.openTextDocument(producer);
    assert.deepEqual(hsonCodes(producer), ["HSON_EVENT_REFERENCE_INVALID"], "opening must keep one syntax owner");
    const badReference = openedProducer.getText().indexOf("key.nope");
    const correction = new vscode.WorkspaceEdit();
    correction.replace(producer, new vscode.Range(openedProducer.positionAt(badReference), openedProducer.positionAt(badReference + 8)), "key.code");
    assert(await vscode.workspace.applyEdit(correction));
    await waitUntil(() => hsonCodes(producer).length === 0, "unsaved producer correction");
    console.log("ok - a closed imported TypeScript Event has one syntax owner, and an unsaved producer edit clears it");

    const original = await vscode.workspace.fs.readFile(config);
    try {
      await vscode.workspace.fs.writeFile(config, Buffer.from(JSON.stringify({
        ...JSON.parse(Buffer.from(original).toString()),
        compilerOptions: { allowJs: true, preserveSymlinks: true, paths: { "hson-live/hson": ["./late-shim.ts"] } },
      })));
      await expectProvenance(true, "missing remap falls back to package");
      await vscode.workspace.fs.writeFile(shim, Buffer.from("export const Hson = { event: String.raw };"));
      await expectProvenance(false, "created shim disputes Event provenance");
      await vscode.workspace.fs.writeFile(shim, Buffer.from('export { Hson } from "hson-live";'));
      await expectProvenance(true, "edited target re-exports the official value");
      await vscode.workspace.fs.writeFile(shim, Buffer.from('export { Hson } from "hson-live"; export = {};'));
      await expectProvenance(false, "a conflicting export assignment invalidates the named route");
      await vscode.workspace.fs.writeFile(shim, Buffer.from('export { Hson } from "hson-live"; const unrelated: number = "bad";'));
      await expectProvenance(true, "an unrelated type error permits the valid route");
      await vscode.workspace.fs.writeFile(shim, Buffer.from('export type { Hson } from "hson-live";'));
      await expectProvenance(false, "a type-only alias withdraws Event evidence");
      await vscode.workspace.fs.writeFile(shim, Buffer.from('export { Hson } from "hson-live"; export { missing };'));
      await expectProvenance(true, "the restored value supplies diagnostics and highlighting alongside a missing sibling export");
      await vscode.workspace.fs.writeFile(shim, Buffer.from('export * as Hson from "hson-live";'));
      await expectProvenance(false, "a package namespace disputes provenance across both URIs");
      await vscode.workspace.fs.writeFile(config, original);
      await expectProvenance(true, "config edit restores agreement");
      const alternate = JSON.parse(Buffer.from(original).toString());
      await vscode.workspace.fs.writeFile(config, Buffer.from(JSON.stringify({ ...alternate,
        compilerOptions: { ...alternate.compilerOptions, types: ["overrides"], typeRoots: ["./type-packages"] },
      })));
      await expectProvenance(false, "the configured ambient package changes the binding for both URIs");
      await vscode.workspace.fs.writeFile(config, original);
      await expectProvenance(true, "removing the ambient package restores both URIs");
      await vscode.workspace.fs.writeFile(config, Buffer.from(JSON.stringify({
        ...JSON.parse(Buffer.from(original).toString()),
        compilerOptions: { allowJs: true, preserveSymlinks: true, paths: { "hson-live/hson": ["./late-shim.ts"] } },
      })));
      await expectProvenance(false, "config edit restores dispute");
      await vscode.workspace.fs.delete(shim);
      await expectProvenance(true, "deleted shim restores the official fallback");
    } finally { await vscode.workspace.fs.writeFile(config, original); }
    console.log("ok - resolution changes update open and closed Event diagnostics, contextual facts, and composed tokens");

    await vscode.window.showTextDocument(doc);
    await replace(event);
    for (let n = 0; n < 50 && diagnostics()[0]?.code !== "HSON_EVENT_REFERENCE_INVALID"; n++) await pause();
    assert.deepEqual(diagnostics().map(issue => [issue.code, doc.getText(issue.range)]), [
      ["HSON_EVENT_REFERENCE_INVALID", "^{key.nope}"],
    ]);
    await replace(event.replace('key.nope', 'key.code'));
    assert.equal(await waitFor(0), 0, "unsaved Event correction clears the diagnostic");
    console.log("ok - real VS Code diagnoses and clears an unattached Event template at the authored range");
    await replace(event.replace('\\u0061', '\\xZZ \\u0QQQ').replace('key.nope', 'key.code'));
    for (let n = 0; n < 50 && diagnostics().length !== 2; n++) await pause();
    assert.deepEqual(diagnostics().map(issue => [issue.code, doc.getText(issue.range)]), [
      ["HSON_TAGGED_TEMPLATE_REQUIRED", "Z"], ["HSON_TAGGED_TEMPLATE_REQUIRED", "Q"],
    ]);
    await replace(event.replace('\\u0061', '\\x').replace('key.nope', 'key.code'));
    await waitUntil(() => diagnostics().length === 1 && doc.getText(diagnostics()[0]!.range) === '\\x', "short escape range");
    await replace(event.replace('key.nope', 'key.code'));
    assert.equal(await waitFor(0), 0, "unsaved escape correction clears both diagnostics");
    console.log("ok - VS Code publishes malformed host escape ranges and clears them after an unsaved correction");
  }
  if (!probe && compositionAvailable) {
    const hsonTokens = async () => {
      const values = await vscode.commands.executeCommand<vscode.SemanticTokens>("vscode.provideDocumentSemanticTokens", doc.uri);
      const types = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>("vscode.provideDocumentSemanticTokensLegend", doc.uri);
      const result: { text: string; start: number; end: number }[] = [];
      let line = 0, column = 0;
      for (let i = 0; values && i < values.data.length; i += 5) {
        const deltaLine = values.data[i]!; line += deltaLine;
        column = deltaLine ? values.data[i + 1]! : column + values.data[i + 1]!;
        if (!types?.tokenTypes[values.data[i+3]!]?.startsWith("hson")) continue;
        const start = doc.offsetAt(new vscode.Position(line, column)), end = start + values.data[i+2]!;
        result.push({ text: doc.getText().slice(start,end), start, end });
      }
      return result;
    };
    const eventStart = doc.getText().indexOf("<hson:event");
    for (let n = 0; n < 50 && !(await hsonTokens()).some(token => token.start === eventStart && token.text === "<"); n++) await pause();
    assert.ok((await hsonTokens()).some(token => token.start === eventStart && token.text === "<"),
      "official Event templates receive grammar-backed Hson tokens");
    for (const [imported, tag, pkg] of [["Hson", "Hson", "hson-live/hson"], ["Hson", "Hson", "hson-live"], ["Hson as author", "author", "hson-live/hson"]]) {
      for (const body of ['<thing 1>', '<thing !!!', '<thing ${dangerous()} other 1>']) {
        await replace(`import { ${imported} } from "${pkg}"; const value=${tag}.canonical\`${body}\`;`);
        const tokens = await hsonTokens();
        assert.ok(tokens.some(token => token.text === 'thing'), `real Hson token: ${tag} ${body}`);
        const hole = doc.getText().indexOf('${'), end = doc.getText().indexOf('}',hole)+1;
        if (hole >= 0) assert.ok(tokens.every(token => token.end <= hole || token.start >= end));
      }
    }
    for (const text of [
      'import { hson } from "hson-live"; hson.transform.fromHson("<thing/>");',
      'import { hsonTransform } from "hson-live/transform"; hsonTransform.fromHson(`<thing/>`);',
      'import { hson } from "hson-live"; hson.transform.fromHson(`<thing "${value}"/>`);',
    ]) {
      await replace(text);
      const tokens = await hsonTokens();
      assert.ok(tokens.some(token => token.text === "thing"), `real fromHson token: ${text}`);
      const hole = doc.getText().indexOf("${"), end = doc.getText().indexOf("}", hole) + 1;
      if (hole >= 0) assert.ok(tokens.every(token => token.end <= hole || token.start >= end));
    }
    for (const text of ['import { Hson } from "hson-live/hson"; Hson`<thing !!!`;',
      'import { hson } from "hson-live"; hson.liveMap.fromHson("<thing/>");',
      'import { hsonLiveMap } from "hson-live/livemap"; hsonLiveMap.fromHson(`<thing/>`);',
      'const Hson=String.raw; Hson.canonical`<thing !!!`;',
      'import { Hson } from "other"; Hson.canonical`<thing !!!`;',
      'import { Hson } from "hson-live/hson"; function f(Hson:any){ Hson.canonical`<thing !!!`; }']) {
      await replace(text); assert.deepEqual(await hsonTokens(), [], 'unsupported binding must not keep stale Hson tokens');
      assert.equal(await waitFor(0),0);
    }
    console.log('ok - real baseline tokens: Hson tags and fromHson literals; binding aliases; interpolation holes; local/wrong-package/shadow exclusions; unsaved token refresh');
  }
  assert.equal(vscode.languages.getDiagnostics(doc.uri).filter(d => d.source === "Hson Schema").length, 0);
  await assert.rejects(Promise.resolve(vscode.workspace.fs.stat(vscode.Uri.file(join(workspace, "provider-executed")))));
  if (vscode.workspace.isTrusted) process.stdout.write("ok - checked-in trusted execution preference remains inert without the extension-owned consent receipt\n");
  console.log("# Hson baseline " + JSON.stringify({ version: extension.packageJSON.version, extensionPath: extension.extensionPath,
    active: extension.isActive, trusted: vscode.workspace.isTrusted, grammarHighlighted, semanticHighlighted,
    invalidCount, correctedCount, republishedCount, providerExecuted: false }));
}
