import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import { nativeCompositionSupported } from "./native-composition.js";
import { HSON_BRANDING } from "../../src/appearance-branding.generated.js";
import type { ProjectDiscoveryRequest, ProjectDiscoveryResponse } from "../../src/typescript-project-discovery.js";
import type { AppearanceSpanCache } from "../../src/appearance-spans.js";

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
    const eventToken = async (document = openConsumer): Promise<boolean> => {
      const values = await vscode.commands.executeCommand<vscode.SemanticTokens>("vscode.provideDocumentSemanticTokens", document.uri);
      const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>("vscode.provideDocumentSemanticTokensLegend", document.uri);
      const body = document.getText();
      const start = document.positionAt(body.includes("<hson:event") ? body.indexOf("<hson:event") : body.indexOf("<div/>"));
      let line = 0, column = 0;
      for (let i = 0; values && i < values.data.length; i += 5) {
        const delta = values.data[i]!;
        line += delta; column = delta ? values.data[i + 1]! : column + values.data[i + 1]!;
        if (line === start.line && column === start.character && legend?.tokenTypes[values.data[i + 3]!]?.startsWith("hson")) return true;
      }
      return false;
    };
    const expectProvenance = async (official: boolean, label: string) => {
      const state = () => {
        const open = vscode.languages.getDiagnostics(openConsumer.uri);
        return { closed: hsonCodes(consumer), mirror: hsonCodes(mirror), open: hsonCodes(openConsumer.uri),
          nativeError: open.some(issue => issue.code === 2322),
          contextual: open.some(issue => issue.code === 95002 && issue.message.includes('local declaration "missing"')) };
      };
      try {
        await waitUntil(() => {
          const result = state();
          return [result.closed, result.mirror, result.open].every(codes => codes.includes("HSON_DECLARATIVE_ROOT_REQUIRED") === official)
            && result.open.includes("HSON_NUMBER_LEADING_PLUS")
            && (!vscode.workspace.isTrusted || result.nativeError && result.contextual === official);
        }, label + " diagnostics");
      } catch (error) {
        assert.fail(`${error}: ${JSON.stringify(state())}`);
      }
      if (compositionAvailable) await waitUntil(async () => (await eventToken()) === official, label + " semantic tokens");
      assert.equal(openConsumer.version, consumerVersion, label + " leaves the consumer source alone");
    };
    await expectProvenance(true, "two official projects");
    assert.ok(!vscode.workspace.textDocuments.some(document => document.uri.toString() === producer.toString()));
    await waitUntil(() => hsonCodes(producer).includes("HSON_EVENT_REFERENCE_INVALID"), "closed TypeScript producer through a JS re-export");
    assert.deepEqual(hsonCodes(producer), ["HSON_EVENT_REFERENCE_INVALID"]);
    const eventIssue = () => vscode.languages.getDiagnostics(producer).find(issue => issue.code === "HSON_EVENT_REFERENCE_INVALID")!;
    const closedRange = eventIssue().range;
    const openProducer = async () => {
      await vscode.commands.executeCommand("vscode.open", producer);
      const document = vscode.window.activeTextEditor?.document;
      assert.equal(document?.uri.toString(), producer.toString());
      return document!;
    };
    const openedProducer = await openProducer();
    const producerText = openedProducer.getText();
    assert.ok(!openedProducer.isDirty);
    assert.match(producerText, /\r\n.*é🧪/);
    assert.deepEqual(hsonCodes(producer), ["HSON_EVENT_REFERENCE_INVALID"], "opening must keep one syntax owner");
    const operand = "^{key.nope}";
    const offset = producerText.indexOf(operand);
    assert.ok(offset >= 0);
    assert.deepEqual(closedRange, new vscode.Range(openedProducer.positionAt(offset), openedProducer.positionAt(offset + operand.length)));
    assert.deepEqual(eventIssue().range, closedRange);
    await waitUntil(() => eventToken(openedProducer), "UTF-16LE Event semantic tokens");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await waitUntil(() => openedProducer.isClosed, "UTF-16LE producer closed");
    await waitUntil(() => eventIssue()?.range.isEqual(closedRange), "UTF-16LE diagnostic restored from disk");
    const reopened = await openProducer();
    assert.equal(reopened.getText(), producerText);
    assert.deepEqual(eventIssue().range, closedRange);
    await waitUntil(() => eventToken(reopened), "reopened UTF-16LE Event semantic tokens");
    const bytes = await vscode.workspace.fs.readFile(producer);
    await rm(producer.fsPath);
    await waitUntil(() => hsonCodes(producer).length === 0, "deleted clean producer withdraws Event evidence");
    assert.ok(!reopened.isClosed && !reopened.isDirty, "the clean editor buffer is still present");
    await writeFile(producer.fsPath, bytes);
    await waitUntil(() => eventIssue()?.range.isEqual(closedRange), "recreated clean producer restores Event evidence");
    await waitUntil(() => eventToken(reopened), "recreated Event supplies semantic tokens");
    const badReference = producerText.indexOf("key.nope");
    const correction = new vscode.WorkspaceEdit();
    correction.replace(producer, new vscode.Range(reopened.positionAt(badReference), reopened.positionAt(badReference + 8)), "key.code");
    assert(await vscode.workspace.applyEdit(correction));
    await waitUntil(() => hsonCodes(producer).length === 0, "unsaved producer correction");
    assert.ok(await reopened.save());
    assert.deepEqual(hsonCodes(producer), []);
    console.log("ok - a UTF-16LE Event keeps its range through open/close and withdraws and restores across deletion/recreation");

    // tsserver's background diagnostic notification is serviced for visible editors.
    await vscode.window.showTextDocument(openConsumer);
    const original = await vscode.workspace.fs.readFile(config);
    try {
      const remapped = Buffer.from(JSON.stringify({
        ...JSON.parse(Buffer.from(original).toString()),
        compilerOptions: { allowJs: true, preserveSymlinks: true, paths: { "hson-live/hson": ["./late-shim.ts"] } },
      }));
      await vscode.workspace.fs.writeFile(config, remapped);
      await expectProvenance(true, "missing remap falls back to package");
      if (process.env.HSON_BASELINE_GATE_DISCOVERY === "1") {
        const test = globalThis as typeof globalThis & {
          hsonTestHoldProjectReply?: (reply: ProjectDiscoveryResponse | undefined) => Promise<void>;
          hsonTestAppearanceSpans?: (document: Parameters<AppearanceSpanCache["get"]>[1]) =>
            Promise<ReturnType<AppearanceSpanCache["get"]>>;
        };
        const replyGate = () => {
          let release!: () => void;
          const wait = new Promise<void>(resolve => { release = resolve; });
          return { wait, release, reached: false };
        };
        const older = replyGate(), newer = replyGate();
        const genuine = Buffer.from('export { Hson } from "hson-live";');
        const lookalike = Buffer.from('export const Hson = { event: String.raw };');
        await vscode.workspace.fs.writeFile(shim, lookalike);
        await expectProvenance(false, "fixture establishes a disputed remap before arming the gate");
        await vscode.workspace.fs.writeFile(shim, genuine);
        await expectProvenance(true, "genuine remap before the gated race");
        await waitUntil(() => sdkEventCount() === 2, "independent project establishes Event evidence");
        const sourceText = openConsumer.getText();
        assert.ok(test.hsonTestAppearanceSpans);
        const appearanceSpans = test.hsonTestAppearanceSpans;
        const start = sourceText.indexOf("<hson:event"), end = sourceText.indexOf("`", start);
        const eventSpans = async () => {
          const spans = await appearanceSpans({ uri: openConsumer.uri.toString(), fileName: openConsumer.fileName,
            languageId: openConsumer.languageId, version: openConsumer.version, text: openConsumer.getText() });
          return spans.filter(span => start <= span.range.start && span.range.end <= end);
        };
        const originalSpans = await eventSpans();
        assert.ok(originalSpans.length);
        const use = openConsumer.positionAt(sourceText.indexOf("^{row.label}") + 2);
        const declaration = openConsumer.positionAt(sourceText.indexOf("data:row") + "data:".length);
        const eventDefinition = async (): Promise<boolean> => {
          const definitions = await vscode.commands.executeCommand<readonly (vscode.Location | vscode.LocationLink)[]>(
            "vscode.executeDefinitionProvider", openConsumer.uri, use);
          return definitions?.some(target => "targetUri" in target
            ? target.targetUri.toString() === openConsumer.uri.toString() && (target.targetSelectionRange ?? target.targetRange).start.isEqual(declaration)
            : target.uri.toString() === openConsumer.uri.toString() && target.range.start.isEqual(declaration)) ?? false;
        };
        await waitUntil(eventDefinition, "current Event has a contextual definition");
        test.hsonTestHoldProjectReply = async response => {
          const entry = response?.projects?.sources.find(source => source.fileName === consumer.fsPath);
          if (entry?.owners.length !== 2) return;
          if (entry.eventEvidence) {
            if (older.reached) return;
            older.reached = true;
            await older.wait;
          } else {
            newer.reached = true;
            await newer.wait;
          }
        };
        try {
          await vscode.workspace.fs.writeFile(shim, Buffer.concat([genuine, Buffer.from("\n// refresh proof")]));
          await waitUntil(() => older.reached, "older agreeing reply held");
          await vscode.workspace.fs.writeFile(shim, lookalike);
          await waitUntil(() => newer.reached, "newer disputed reply held");
          const opened = await vscode.workspace.openTextDocument(consumer);
          const text = opened.getText(), version = opened.version;
          assert.equal(text, 'import { Hson as A } from "hson-live/hson"; A.event`<div/>`;');
          assert.deepEqual(hsonCodes(consumer), []);
          assert.ok(!hsonCodes(openConsumer.uri).includes("HSON_DECLARATIVE_ROOT_REQUIRED"));
          assert.equal(await eventToken(), false);
          assert.equal(await eventToken(opened), false);
          assert.deepEqual(await eventSpans(), []);
          assert.equal(sdkEventCount(), 2, "independent event proof stays available");
          await waitUntil(() => !vscode.languages.getDiagnostics(openConsumer.uri).some(issue => issue.code === 95002),
            "pending proof withdraws the contextual plugin diagnostic");
          await waitUntil(async () => !(await eventDefinition()), "pending proof withdraws contextual navigation");
          assert.ok(vscode.languages.getDiagnostics(openConsumer.uri).some(issue => issue.code === 2322));
          newer.release();
          await expectProvenance(false, "newer disagreement accepted");
          await vscode.commands.executeCommand("typescript.reloadProjects");
          const barrier = await vscode.commands.executeCommand<{ success?: boolean }>(
            "typescript.tsserverRequest", "_hson.discoverTypeScriptProjects", { revisionOnly: true });
          assert.ok(barrier?.success, "the server processed the queued reload before the obsolete reply was released");
          older.release();
          await new Promise<void>(resolve => setImmediate(resolve));
          assert.deepEqual(hsonCodes(consumer), []);
          assert.equal(await eventToken(opened), false);
          delete test.hsonTestHoldProjectReply;
          await vscode.workspace.fs.writeFile(shim, genuine);
          await expectProvenance(true, "current agreement restored after the old reply");
          await waitUntil(() => eventToken(opened), "current proof restores tokens in the opened consumer");
          await waitUntil(eventDefinition, "current proof restores contextual navigation");
          assert.deepEqual(await eventSpans(), originalSpans);
          assert.equal(opened.getText(), text);
          assert.equal(opened.version, version);
          console.log("ok - gated open and token publication with unchanged consumer, scoped invalidation, and contextual withdrawal");
        } finally {
          older.release();
          newer.release();
          delete test.hsonTestHoldProjectReply;
        }
      }
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

    if (process.env.HSON_BASELINE_GATE_DISCOVERY === "1") {
      const test = globalThis as typeof globalThis & {
        hsonTestHoldProjectReply?: (reply: ProjectDiscoveryResponse | undefined, request: ProjectDiscoveryRequest, isCurrent: () => boolean) => Promise<void>;
        hsonTestProjectChange?: (uri: string) => void;
        hsonTestSourceChange?: (change: { uri: string; kind: string }) => void;
        hsonTestReplayCreate?: (uri: vscode.Uri) => void;
        hsonTestAppearanceSpans?: (document: Parameters<AppearanceSpanCache["get"]>[1]) =>
          Promise<ReturnType<AppearanceSpanCache["get"]>>;
      };
      const location = (name: string) => vscode.Uri.file(join(workspace, "membership", name));
      const firstConfig = location("first/tsconfig.json").fsPath;
      const secondConfig = location("second/tsconfig.json").fsPath;
      const thirdConfig = location("third/tsconfig.json").fsPath;
      const second = await vscode.workspace.openTextDocument(location("second/root.ts"));
      await vscode.window.showTextDocument(second);
      const independent = await vscode.workspace.openTextDocument(location("third/independent.ts"));
      await vscode.window.showTextDocument(independent, { preview: false, viewColumn: vscode.ViewColumn.Two });
      const shared = await vscode.workspace.openTextDocument(location("first/consumer.ts"));
      await vscode.window.showTextDocument(shared, { preview: false, viewColumn: vscode.ViewColumn.One });
      const originals = [shared, independent].map(document => ({ document, version: document.version, text: document.getText() }));
      const assertUnchanged = () => {
        for (const { document, version, text } of originals) {
          assert.equal(document.getText(), text);
          assert.equal(document.version, version);
        }
      };
      const readSignals = async (document: vscode.TextDocument) => {
        const text = document.getText();
        const start = text.indexOf("<hson:event"), end = text.indexOf("`", start);
        const use = document.positionAt(text.indexOf("^{row.label}") + 2);
        const declaration = document.positionAt(text.indexOf("data:row") + "data:".length);
        assert.ok(test.hsonTestAppearanceSpans);
        const spans = await test.hsonTestAppearanceSpans({ uri: document.uri.toString(), fileName: document.fileName,
          languageId: document.languageId, version: document.version, text });
        const definitions = await vscode.commands.executeCommand<readonly (vscode.Location | vscode.LocationLink)[]>(
          "vscode.executeDefinitionProvider", document.uri, use);
        const issues = vscode.languages.getDiagnostics(document.uri);
        return {
          syntax: hsonCodes(document.uri).includes("HSON_DECLARATIVE_ROOT_REQUIRED"),
          contextual: issues.some(issue => issue.code === 95002 && issue.message.includes('local declaration "missing"')),
          tokens: await eventToken(document),
          appearance: spans.some(span => start <= span.range.start && span.range.end <= end),
          definition: definitions?.some(target => "targetUri" in target
            ? target.targetUri.toString() === document.uri.toString() && (target.targetSelectionRange ?? target.targetRange).start.isEqual(declaration)
            : target.uri.toString() === document.uri.toString() && target.range.start.isEqual(declaration)) ?? false,
          native: issues.filter(issue => issue.source === "ts").map(issue => issue.code).sort(),
        };
      };
      const matches = ({ native, ...hson }: Awaited<ReturnType<typeof readSignals>>, expected: boolean) =>
        native.includes(2322) && native.includes(6133) && Object.values(hson).every(signal => signal === expected);
      const expectSignals = async (document: vscode.TextDocument, expected: boolean, label: string) => {
        let state: Awaited<ReturnType<typeof readSignals>> | undefined;
        try {
          await waitUntil(async () => matches(state = await readSignals(document), expected), label);
        } catch (error) {
          throw new Error(`${label} ${JSON.stringify(state)}`, { cause: error });
        }
        assertUnchanged();
        console.log("ok - Event signals", JSON.stringify({ label, state }));
      };
      let lastReply: ProjectDiscoveryResponse | undefined;
      const scannerSource = (document: vscode.TextDocument, reply = lastReply) =>
        reply?.projects?.sources.find(source => source.fileName === document.fileName);
      const authorOffset = shared.getText().indexOf("author }");
      const agrees = (applicable: boolean, proven: boolean, reply = lastReply) => {
        const source = scannerSource(shared, reply);
        return source?.owners.includes(firstConfig) === true && source.owners.includes(secondConfig) === applicable
          && (source.eventEvidence?.importOffsets.includes(authorOffset) ?? false) === proven;
      };
      const gates = new Set<(reply: ProjectDiscoveryResponse, request: ProjectDiscoveryRequest, isCurrent: () => boolean) => Promise<void>>();
      const holdMatchingReply = (matches: (reply: ProjectDiscoveryResponse) => boolean) => {
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const gate: { reply?: ProjectDiscoveryResponse; request?: ProjectDiscoveryRequest; isCurrent?: () => boolean } = {};
        const block = async (reply: ProjectDiscoveryResponse, request: ProjectDiscoveryRequest, isCurrent: () => boolean) => {
          if (!matches(reply)) return;
          if (gate.reply === undefined) Object.assign(gate, { reply, request, isCurrent });
          await held;
        };
        gates.add(block);
        return { gate, release: () => { gates.delete(block); release(); } };
      };
      const holdReply = (applicable: boolean, proven: boolean) =>
        holdMatchingReply(reply => agrees(applicable, proven, reply));
      test.hsonTestHoldProjectReply = async (reply, request, isCurrent) => {
        if (reply?.projects === undefined) return;
        lastReply = reply;
        await Promise.all([...gates].map(block => block(reply, request, isCurrent)));
      };
      const identity = location("second/identity.ts"), lateIdentity = location("second/late-identity.ts");
      const bridge = location("second/bridge.ts");
      const write = (uri: vscode.Uri, text: string) => vscode.workspace.fs.writeFile(uri, Buffer.from(text));
      const genuine = 'export { Hson } from "hson-live";';
      const lookalike = 'export const Hson = {event: String.raw};';
      const importsShared = 'import "../first/consumer.js";';
      const changes: string[] = [];
      test.hsonTestSourceChange = change => {
        if (change.uri === identity.toString()) changes.push(change.kind);
      };
      try {
        await write(bridge, importsShared);
        await waitUntil(() => agrees(true, true) && [firstConfig, secondConfig, thirdConfig]
          .every(config => new Map(lastReply?.revision).get(config)?.split(":")[0]),
        "three active configured projects and initial agreement");
        await expectSignals(shared, true, "two projects agree");
        await expectSignals(independent, true, "independent project before the rewrite");
        const before = lastReply;
        const older = holdReply(true, true);
        const newer = holdReply(true, false);
        try {
          await write(identity, genuine + " // agreeing discovery held");
          await waitUntil(() => changes.some(kind => kind === "create" || kind === "change"), "filesystem watcher observed the rewrite");
          const watcherKinds = [...changes];
          // Some hosts report this write as a change. Replay the observed
          // create variant through the same listener so both hosts test it.
          if (!watcherKinds.includes("create")) {
            assert.ok(test.hsonTestReplayCreate);
            test.hsonTestReplayCreate(identity);
          }
          await waitUntil(() => older.gate.reply !== undefined, "older agreeing reply held");
          assert.ok(older.gate.request && older.gate.request.changedFiles === undefined, "create notification requests full rediscovery");
          await write(identity, lookalike);
          await waitUntil(() => newer.gate.reply !== undefined, "newer disputed reply held");
          await expectSignals(shared, false, "existing dependency rewrite withdraws shared evidence during discovery");
          const retained = await readSignals(independent);
          console.log("ok - Event scope observation", JSON.stringify({ watcherKinds, changes, retained }));
          assert.ok(matches(retained, true), "existing dependency rewrite retains all five independent signals while discovery is held");
          assert.deepEqual(scannerSource(independent, newer.gate.reply), scannerSource(independent, before));
          assert.deepEqual(scannerSource(independent, before)?.owners, [thirdConfig]);
          assert.equal(new Map(newer.gate.reply?.revision).get(thirdConfig), new Map(before?.revision).get(thirdConfig));
          assertUnchanged();
          newer.release();
          await expectSignals(shared, false, "current discovery withholds disputed evidence");
          older.release();
          await new Promise<void>(resolve => setImmediate(resolve));
          await expectSignals(shared, false, "older agreeing reply cannot republish disputed evidence");
          await expectSignals(independent, true, "out-of-order completion preserves independent evidence");
        } finally { newer.release(); older.release(); }

        await write(identity, genuine);
        await waitUntil(() => agrees(true, true), "restoration has current scanner agreement");
        await expectSignals(shared, true, "current agreement restores evidence after withdrawal");

        const created = holdReply(true, false);
        try {
          await write(lateIdentity, lookalike);
          await waitUntil(() => created.gate.reply !== undefined, "new higher priority source changes project resolution");
          assert.ok(created.gate.request && created.gate.request.changedFiles === undefined, "genuine creation requests full rediscovery");
          await expectSignals(shared, false, "genuine creation withdraws evidence during discovery");
        } finally { created.release(); }
        await expectSignals(shared, false, "new source vetoes Event agreement");

        await vscode.workspace.fs.delete(lateIdentity);
        await waitUntil(() => agrees(true, true), "deletion restores lower priority resolution");
        await expectSignals(shared, true, "deletion restores Event diagnostics and navigation via fallback");
        await write(lateIdentity, genuine + " // recreated with different contents");
        await waitUntil(() => lastReply?.projects?.projectFiles.some(([project, files]) => project === secondConfig
          && files.some(([path, identity]) => identity !== null && path.toLowerCase() === lateIdentity.fsPath.toLowerCase())) === true,
        "recreated source enters current project resolution");
        await expectSignals(shared, true, "recreated genuine source preserves Event diagnostics and navigation");
        await vscode.workspace.fs.delete(lateIdentity);

        await write(bridge, "export {};");
        await waitUntil(() => agrees(false, true), "second project becomes inapplicable");
        await write(identity, lookalike);
        await expectSignals(shared, true, "first project alone proves Event identity");
        await expectSignals(independent, true, "independent evidence restored before membership growth");
        const growing = holdReply(true, false);
        try {
          await write(bridge, importsShared);
          await waitUntil(() => growing.gate.reply !== undefined, "newly applicable project disagrees before acceptance");
          await expectSignals(shared, false, "membership growth withdraws newly disputed evidence during discovery");
          await expectSignals(independent, true, "membership growth retains independent evidence");
        } finally { growing.release(); }
        await write(bridge, "export {};");
        await waitUntil(() => agrees(false, true), "second project exits again");
        await expectSignals(shared, true, "project exit restores Event agreement");

        const auxiliary = location("second/tsconfig.aux.json");
        const auxiliaryAgreement = (proven: boolean, reply = lastReply) =>
          agrees(false, proven, reply) && scannerSource(shared, reply)?.owners.includes(auxiliary.fsPath) === true;
        const auxiliaryConfig = (disputed: boolean) => JSON.stringify({
          compilerOptions: { module: "NodeNext", types: [],
            paths: disputed ? { "hson-live/hson": ["./identity.ts"] } : undefined },
          files: ["../first/consumer.ts"],
        });
        const agreeingConfig = holdMatchingReply(reply => auxiliaryAgreement(true, reply));
        const disputedConfig = holdMatchingReply(reply => auxiliaryAgreement(false, reply));
        let changed = false;
        test.hsonTestProjectChange = uri => { if (uri === auxiliary.toString()) changed = true; };
        try {
          assert.ok(!lastReply?.projects?.configurations.includes(auxiliary.fsPath));
          await write(auxiliary, auxiliaryConfig(false));
          await waitUntil(() => agreeingConfig.gate.reply !== undefined, "first auxiliary config discovery is held");
          assert.ok(agreeingConfig.gate.isCurrent?.());
          assert.ok(!new Map(agreeingConfig.gate.reply?.revision).has(auxiliary.fsPath), "auxiliary config is scanner-only");
          await expectSignals(shared, false, "auxiliary config creation withdraws pending proof");

          changed = false;
          await write(auxiliary, auxiliaryConfig(true));
          await waitUntil(() => changed, "actual VS Code JSON watcher delivered the rewrite as change");
          assert.equal(agreeingConfig.gate.isCurrent?.(), false, "config change fences the first discovery before acceptance");
          await waitUntil(() => disputedConfig.gate.reply !== undefined, "current auxiliary veto discovery is held");
          assert.deepEqual(disputedConfig.gate.reply?.revision, agreeingConfig.gate.reply?.revision);
          assert.deepEqual(scannerSource(independent, disputedConfig.gate.reply), scannerSource(independent, agreeingConfig.gate.reply));
          agreeingConfig.release();
          await new Promise<void>(resolve => setImmediate(resolve));
          await expectSignals(shared, false, "obsolete agreeing configuration cannot republish Event evidence");
          await expectSignals(independent, false, "obsolete discovery cannot restore independent evidence before a broad scan accepts");

          disputedConfig.release();
          await expectSignals(independent, true, "current configuration restores independent evidence");
          await expectSignals(shared, false, "current auxiliary configuration vetoes shared evidence");
          await write(auxiliary, auxiliaryConfig(false));
          await waitUntil(() => auxiliaryAgreement(true), "ordinary accepted configuration edit restores scanner agreement");
          await expectSignals(shared, true, "ordinary configuration edit restores all shared signals");

          await vscode.workspace.fs.delete(auxiliary);
          await waitUntil(() => !lastReply?.projects?.configurations.includes(auxiliary.fsPath), "deleted auxiliary configuration exits discovery");
          await expectSignals(shared, true, "deleting the auxiliary configuration leaves first-project evidence");
          await write(auxiliary, auxiliaryConfig(true));
          await waitUntil(() => auxiliaryAgreement(false), "recreated configuration vetoes scanner agreement");
          await expectSignals(shared, false, "recreated auxiliary configuration vetoes shared evidence");
          await expectSignals(independent, true, "independent evidence survives current auxiliary membership");
        } finally {
          agreeingConfig.release();
          disputedConfig.release();
          delete test.hsonTestProjectChange;
        }
      } finally {
        delete test.hsonTestHoldProjectReply;
        delete test.hsonTestSourceChange;
        delete test.hsonTestReplayCreate;
      }
    }

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
