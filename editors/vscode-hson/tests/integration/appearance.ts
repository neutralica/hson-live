import assert from "node:assert/strict";
import { checkAppearanceTransitions } from "../appearance-transitions.test.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import { HsonAppearanceEditor } from "../../src/appearance-editor.js";
import { AppearanceSpanCache } from "../../src/appearance-spans.js";
import { AppearanceRenderer } from "../../src/appearance-renderer.js";
import { load_hson_grammar } from "../../src/highlighting.js";
import { initialAppearance, readAppearance, blend, housePalette, paletteById, roleCatalog, styleProperties, type AppearanceState } from "../../src/appearance-model.js";
import { Hson } from "../../../../src/hson-authoring.js";
const appearanceRoles = ["value.attributeString", "value.string", "punctuation.attributeQuotes", "punctuation.quoteOpen"] as const;
import { document_semantic_tokens, hsonSemanticLegend } from "../../src/semantic-tokens.js";

const pause = () => new Promise(resolve => setTimeout(resolve, 100));
let sequence = 0;
type UiState = { revertDisabled:boolean; status: string; saved: string; error: string; values: Record<string,string>; targets:{value:string;label:string}[] };
async function ui<T = UiState>(workspace: string, request: Record<string, unknown>): Promise<T> {
  const id = ++sequence;
  await writeFile(join(workspace, "appearance-ui-request.json"), JSON.stringify({ ...request, id }));
  for (let attempt = 0; attempt < 150; attempt++) {
    const response = await readFile(join(workspace, "appearance-ui-response.json"), "utf8").then(JSON.parse).catch(() => undefined);
    if (response?.id === id) { assert.equal(response.error, undefined, "Rendered UI: " + request.action); return response.value; }
    await pause();
  }
  assert.fail("Rendered UI probe timed out");
}
const rgb = (hex: string) => `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;
export async function rendered(workspace: string, document: vscode.TextDocument, label: string,
  samples: readonly { needle: string; length?: number; offset?: number; expected?: string }[]) {
  const id = ++sequence, text = document.getText();
  const tokens = samples.map(sample => {
    const start = text.indexOf(sample.needle);
    assert.ok(start >= 0, sample.needle);
    const position = document.positionAt(start + (sample.offset ?? 0));
    return { lineText: document.lineAt(position.line).text, character: position.character,
      length: sample.length ?? sample.needle.length, expected: sample.expected };
  });
  await writeFile(join(workspace, "binding-color-request.json"), JSON.stringify({ id, label, tokens, pairs: [] }));
  for (let attempt = 0; attempt < 180; attempt++) {
    const response = await readFile(join(workspace, "binding-color-response.json"), "utf8").then(JSON.parse).catch(() => undefined);
    if (response?.id === id) { assert.equal(response.error, undefined, label); const colors: string[] = response.colors; return colors; }
    await pause();
  }
  assert.fail("Rendered color probe timed out: " + label);
}

function deferred() {
  let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function checkControllerTransitions(): Promise<void> {
  const original = initialAppearance();
  original.palettes.push({ id: 'test', name: 'Test', blendBackground: { light: '#ffffff', dark: '#000000' }, roles: {} });
  original.palettes[0]!.roles['value.string']={dark:{intensity:.5,fontStyle:'italic',bold:true,italic:false,underline:true,strikethrough:false},light:{foreground:'#abcdef'}};
  const switching = deferred();
  let persisted: unknown = original;
  let write: ReturnType<typeof deferred> | undefined;
  let captured: AppearanceState | undefined;
  let capturedDestination: vscode.ConfigurationTarget | undefined;
  let writes = 0;
  const configuration = () => ({
    inspect: () => ({ globalValue: persisted }),
    async update(_key: string, state: AppearanceState, destination: vscode.ConfigurationTarget) {
      writes++;
      captured = state;
      capturedDestination = destination;
      await write?.promise;
      persisted = state;
    },
  });
  const controller: {
    receive(message: Record<string, unknown>): Promise<void>;
    configurationChanged(): void;
    draft: AppearanceState;
    saved: AppearanceState;
    editTarget: string;
    comparison: string;
  } = Object.assign(Object.create(HsonAppearanceEditor.prototype), {
    saved: structuredClone(original), draft: structuredClone(original),
    editTarget: 'palette:test', role: 'value.string', mode: 'dark', destination: 'user',
    configuration, showExample: () => switching.promise, confirmRevert:async()=>true,
    undoStack:[],redoStack:[],revision:0,draftRevision:0,rejectedInputs:[],inputRevision:0,inputSequence:0,
  });
  const edit = (value: string) => controller.receive({type:'property', property:'foreground', value});
  const action = (type: string, value?: string) => controller.receive({type,value});
  const color = (state: AppearanceState) => state.palettes[0]?.roles['value.string']?.dark?.foreground;

  const switchingTask = action('example', 'Data');
  await edit('#123456');
  assert.deepEqual(controller.draft.palettes[0]!.roles['value.string'],{
    ...original.palettes[0]!.roles['value.string'],dark:{...original.palettes[0]!.roles['value.string']!.dark,foreground:'#123456'},
  },'editing only foreground retains all advanced properties and the other mode');
  switching.resolve();
  await switchingTask;
  assert.equal(color(controller.draft), '#123456', 'late example completion preserves newer edits');

  write = deferred();
  const saving = action('save');
  await edit('#222222');
  await action('revert');
  await action('save');
  assert.equal(writes, 1, 'duplicate save during persistence is ignored');
  assert.equal(color(controller.draft), '#222222', 'Revert is unavailable while saving');
  assert.equal(color(captured!), '#123456', 'save uses the captured draft');
  await action('example', 'Document');
  write.resolve();
  await saving;
  assert.equal(color(controller.saved), '#123456');
  assert.equal(color(controller.draft), '#222222', 'save completion preserves newer edits');
  await action('undo');assert.equal(color(controller.draft),'#123456','post-save history stops at the captured snapshot');
  await action('undo');assert.equal(color(controller.draft),'#123456');
  await action('redo');assert.equal(color(controller.draft),'#222222');
  await action('compare', 'saved');
  assert.equal(controller.comparison, 'saved');
  assert.equal(color(controller.draft), '#222222');
  await action('compare', 'draft');
  await action('revert');
  assert.equal(color(controller.draft), '#123456');

  await edit('#333333');
  write = deferred();
  const failing = action('save');
  await edit('#444444');
  write.reject(new Error('disk write failed'));
  await assert.rejects(failing, /disk write failed/);
  assert.equal(color(controller.saved), '#123456');
  assert.equal(color(controller.draft), '#444444');
  await action('undo');assert.equal(color(controller.draft),'#333333','failed save retains history');
  await action('redo');assert.equal(color(controller.draft),'#444444');
  await assert.rejects(edit('#bad-input'),/Invalid/);
  await assert.rejects(action('save'),/invalid input/);
  await controller.receive({type:'assign',family:'all',value:'test'});
  await assert.rejects(action('save'),/invalid input/,'an unrelated action cannot acknowledge rejected input');
  await assert.rejects(action('mode','light'),/invalid input/);
  await edit('#444444');

  const broken = { assignments: { all: 'missing' } };
  persisted = broken;
  controller.configurationChanged();
  await action('revert');
  await assert.rejects(action('save'), /Fix hson.appearance.state/);
  assert.equal(persisted, broken);
  assert.equal(color(controller.draft), '#444444');
  assert.equal(color(controller.saved), '#123456');
  persisted = { ...original, palettes: [] };
  controller.configurationChanged();
  await assert.rejects(action('save'), /changed elsewhere/);
  assert.equal(color(controller.draft), '#444444');
  await action('revert');
  assert.equal(controller.editTarget, 'palette:house');
  await assert.rejects(action('target', 'palette:test'), /available edit target/);

  persisted = original;
  controller.configurationChanged();
  await action('target', 'palette:test');
  persisted = initialAppearance();
  controller.configurationChanged();
  assert.equal(controller.editTarget, 'palette:house', 'clean external changes normalize the selection immediately');
  await controller.receive({type:'assign',family:'data',value:'native'});
  await action('apply');
  assert.deepEqual(controller.draft.assignments,{all:'house',data:'native'},'Apply preserves explicit family assignments');

  await action('revert');
  for (const [restore, succeeds, externalChange] of [
    ['reset', false, 'event'], ['undo', true, 'event'], ['undo', false, 'final read'], ['undo', true, 'none'],
  ] as const) {
    // Reset is a new edit back to A. Undo stops at the captured B boundary,
    // including while the write is pending. External C cannot replace either.
    persisted = original;
    controller.configurationChanged();
    await action('target', 'palette:test');
    await action('destination', 'user');
    await edit('#bbbbbb');
    write = deferred();
    const pending = action('save');
    await action('destination', 'workspace');
    await action(restore);
    const working = structuredClone(controller.draft);
    assert.equal(color(working), restore === 'reset' ? color(original) : '#bbbbbb', restore + ' respects the captured Save boundary');
    assert.equal(color(captured!), '#bbbbbb');
    assert.equal(capturedDestination, vscode.ConfigurationTarget.Global);
    const external = structuredClone(original);
    external.palettes[0]!.roles['value.string']!.dark!.foreground = '#cccccc';
    if (externalChange !== 'none') persisted = external;
    if (externalChange === 'event') {
      controller.configurationChanged();
      assert.deepEqual(controller.draft, working, 'external C must not replace local work during Save');
    }
    if (succeeds) {
      write.resolve();
      await pending;
    } else {
      write.reject(new Error('disk write failed'));
      await assert.rejects(pending, /disk write failed/);
    }
    assert.equal(color(controller.saved), succeeds ? '#bbbbbb' : '#cccccc');
    assert.deepEqual(controller.draft, working, 'settling Save must not replace local work');
    if (externalChange !== 'none') {
      await assert.rejects(action('save'), /changed elsewhere/, 'conflict requires explicit resolution');
    }
    await action(restore === 'undo' ? 'redo' : 'undo');
    assert.equal(color(controller.draft), '#bbbbbb', 'pre-Save value remains recoverable');
    await action(restore);
    await action('revert');
    assert.deepEqual(controller.draft, controller.saved, 'Revert deliberately accepts current settings');
    write = undefined;
  }
  persisted = original;
  controller.configurationChanged();
  await action('target', 'palette:test');
  await action('destination', 'user');
  for (const succeeds of [false, true]) {
    await edit('#111111');await edit('#222222');await action('undo');
    assert.equal(color(controller.draft),'#111111');
    write=deferred();
    const pending=action('save');
    assert.equal(color(captured!),'#111111');
    if(succeeds){
      write.resolve();await pending;
      assert.equal(color(controller.saved),'#111111');
    }else{
      write.reject(new Error('disk write failed'));
      await assert.rejects(pending,/disk write failed/);
      assert.deepEqual(controller.saved,original);
    }
    await action('redo');assert.equal(color(controller.draft),'#222222','Redo ahead of the write snapshot remains available');
    await action('undo');assert.equal(color(controller.draft),'#111111','Undo returns to the write snapshot');
    await action('revert');
    await action('redo');assert.deepEqual(controller.draft,controller.saved,'Revert removes the unsaved redo branch');
    write=undefined;
  }
  console.log('ok - delayed example and save transitions, write failure, Revert, and external configuration recovery');
}

async function checkRenderedTransitions(workspace: string): Promise<void> {
  await vscode.commands.executeCommand('hson.openAppearance');
  const click = async (control: string) => {await ui(workspace, {action:'key-activate', control});};
  const input = async (control: string, value: string, keepFocus = false) => {await ui(workspace, {action:'input',control,value,keepFocus});};
  type Metrics = {editingMode:string;previewMode:string;saveDisabled:boolean;inputInvalid:string|null;foreground:string;
    swatches:Record<string,{source:string;sourceInvalid:string|null;acceptedSource:string;picker:string}>};
  const metrics = () => ui<Metrics>(workspace, {action:'metrics'});
  const until = async (predicate: (state: Metrics) => boolean) => {
    for(let attempt=0;attempt<80;attempt++){const state=await metrics();if(predicate(state))return state;}
    assert.fail('Appearance transition did not reach its observable state');
  };
  const theme = async (name: string, mode: string) => {
    await vscode.workspace.getConfiguration('workbench').update('colorTheme',name,vscode.ConfigurationTarget.Workspace);
    await until(state=>state.previewMode.includes(mode+' editor background')||state.editingMode===mode);
  };
  const revert = async () => {await click('revert');await ui(workspace,{action:'confirm-revert'});};
  await input('target','override:all');
  await input('from-comment.line','value.attributeString');
  await input('from-value.attributeString','comment.line');
  assert.equal((await metrics()).saveDisabled,true,'cycle alone blocks Save');
  assert.match((await ui(workspace,{action:'inspect'})).error,/cycle/);
  assert.equal((await metrics()).swatches['value.attributeString']!.sourceInvalid,'true');
  await input('foreground','#broken');
  const invalid=await metrics();assert.equal(invalid.inputInvalid,'true');assert.equal(invalid.saveDisabled,true);
  const panel=vscode.window.tabGroups.all.flatMap(group=>group.tabs).find(tab=>tab.label==='Hson Appearance')!;
  await vscode.window.tabGroups.close(panel);await vscode.commands.executeCommand('hson.openAppearance');
  const reopened=await metrics();assert.equal(reopened.foreground,'#broken');assert.equal(reopened.swatches['value.attributeString']!.source,'comment.line');
  assert.equal(reopened.inputInvalid,'true');assert.equal(reopened.saveDisabled,true);
  await ui(workspace,{action:'screenshot',name:'transition-rejected-cycle-and-hex'});
  await click('discard-input');
  assert.equal((await metrics()).inputInvalid,null);assert.equal((await metrics()).swatches['value.attributeString']!.sourceInvalid,null);
  assert.equal((await metrics()).swatches['comment.line']!.acceptedSource,'value.attributeString','Discard retains accepted work');
  assert.equal((await metrics()).saveDisabled,false);
  await input('inherits','comment.line');await input('foreground','#broken');
  await input('inherits','');assert.equal((await metrics()).inputInvalid,'true','source correction retains hex validation');
  await click('reset-foreground');assert.equal((await metrics()).inputInvalid,null);
  assert.equal((await metrics()).saveDisabled,false,'Reset clears rejection and retains the earlier accepted link');
  await ui(workspace,{action:'select-role',role:'comment.line'});
  await input('intensity','bad');
  await ui(workspace,{action:'select-role',role:'value.attributeString'});
  assert.equal((await metrics()).saveDisabled,true,'role navigation retains independent validation');
  await ui(workspace,{action:'select-role',role:'comment.line'});
  assert.equal((await ui(workspace,{action:'inspect'})).values.intensity,'bad','advanced rejection remains reachable');
  await input('intensity','0.5');
  await ui(workspace,{action:'select-role',role:'value.attributeString'});
  await revert();
  await input('target','palette:house');await click('apply');await click('dark');
  const dark=(await metrics()).foreground;
  await click('light');const light=(await metrics()).foreground;await click('dark');
  await ui(workspace,{action:'events'});
  await click('picker-value.attributeString');
  await theme('Hson House Light','light');
  assert.equal((await metrics()).editingMode,'dark','native picker activation pins its starting mode before input');
  await ui(workspace,{action:'key',key:'ArrowRight'});
  await ui(workspace,{action:'key',key:'ArrowDown'});
  await ui(workspace,{action:'key',key:'Enter'});
  const nativeEvents=await ui<{type:string;trusted:boolean;value:string}[]>(workspace,{action:'events'});
  await writeFile(join(workspace,'appearance-native-picker-events.json'),JSON.stringify(nativeEvents,null,2));
  assert.ok(nativeEvents.some(event=>event.type==='input'&&event.trusted),'native picker keyboard selection emits trusted input');
  assert.equal((await metrics()).editingMode,'dark');
  const picked=nativeEvents.filter(event=>event.type==='input'&&event.trusted).at(-1)!;
  const scratchpad=vscode.window.visibleTextEditors.find(editor=>editor.viewColumn===vscode.ViewColumn.Two)!.document;
  await rendered(workspace,scratchpad,'native Dark picker selection while editor theme is Light',[{needle:'Attribute text',expected:rgb(picked.value)}]);
  await input('picker-value.attributeString','#13579b',true);
  assert.equal((await metrics()).foreground,'#13579b');
  // Native dialogs may consume Escape without delivering a DOM event; the next
  // focus transfer is also an explicit completion boundary.
  await ui(workspace,{action:'key',key:'Escape'});
  await ui(workspace,{action:'focus',control:'filter'});
  await until(state=>state.editingMode==='light');
  assert.equal((await metrics()).foreground,light,'Light remains unchanged by Dark picker input');
  await click('dark');assert.equal((await metrics()).foreground,'#13579b');
  await click('undo');assert.equal((await metrics()).foreground,dark);
  // An aborted native picker creates no edit; subsequent keyboard hex editing
  // and explicit mode navigation are independent gestures.
  await click('picker-value.attributeString');await theme('Hson House Dark','dark');
  await ui(workspace,{action:'key',key:'Escape'});await ui(workspace,{action:'focus',control:'filter'});
  assert.equal((await metrics()).foreground,dark);
  await input('foreground','#2468ac',true);await theme('Hson House Light','light');
  assert.equal((await metrics()).editingMode,'dark');await input('foreground','#2468ad',true);
  await ui(workspace,{action:'blur',control:'foreground'});await until(state=>state.editingMode==='light');
  await input('foreground','#abcdef');await click('dark');assert.equal((await metrics()).foreground,'#2468ad');
  await click('light');assert.equal((await metrics()).foreground,'#abcdef');
  await ui(workspace,{action:'screenshot',name:'transition-picker-mode-ownership'});
  const events=await ui<{type:string;trusted:boolean}[]>(workspace,{action:'events'});
  assert.ok(events.some(event=>event.type==='keydown'&&event.trusted),'native activation uses trusted keyboard events');
  await writeFile(join(workspace,'appearance-picker-events.json'),JSON.stringify(events,null,2));
  await revert();await theme('Hson House Dark','dark');await click('dark');
  // Leave the normal suite with its original panel lifecycle and clean state.
  const closing=vscode.window.tabGroups.all.flatMap(group=>group.tabs).find(tab=>tab.label==='Hson Appearance')!;
  await vscode.window.tabGroups.close(closing);
  console.log('ok - rendered cycle/hex validation, close/reopen, picker mode ownership, cancellation and keyboard entry');
}

export async function run(): Promise<void> {
  const workspace = process.env.HSON_APPEARANCE_WORKSPACE!;
  const extension = vscode.extensions.getExtension("terminal-gothic.hson-language")!;
  await extension.activate();
  if(process.env.HSON_APPEARANCE_RELOAD==='1'){
    const normal=await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace,'normal-proof.ts')));await vscode.window.showTextDocument(normal);
    await rendered(workspace,normal,'saved palettes restored after fresh extension host',[
      {needle:'Content text',length:12,expected:rgb('#21a2b3')},{needle:'Data text',expected:rgb('#e05060')}]);
    await vscode.commands.executeCommand('hson.openAppearance');const state=await ui(workspace,{action:'inspect'});
    assert.match(state.status,/All saved/);
    const restored=readAppearance(vscode.workspace.getConfiguration('hson.appearance').get('state'));
    assert.equal(paletteById(restored,'house')?.roles['comment.line']?.dark?.foreground,'#99aa11','edited House survives restart under stable identity');assert.ok(state.values.data&&state.values.data!=='native');
    const report=JSON.parse(await readFile(join(workspace,'appearance-report.json'),'utf8'));report.tests.push('fresh extension host restores persisted palettes');
    await writeFile(join(workspace,'appearance-report.json'),JSON.stringify(report,null,2));console.log('ok - fresh extension host persistence');return;
  }
  await checkAppearanceTransitions();
  await checkRenderedTransitions(workspace);
  await checkControllerTransitions();
  const grammar = load_hson_grammar(extension.extensionPath);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "proof.ts")));
  const editor = await vscode.window.showTextDocument(document);
  const cancellation = new vscode.CancellationTokenSource();
  let semantic: vscode.SemanticTokens | undefined;
  for (let attempt = 0; attempt < 100 && !semantic; attempt++) {
    semantic = await document_semantic_tokens(document, cancellation.token, grammar);
    if (!semantic) await pause();
  }
  cancellation.dispose();
  assert.ok(semantic, "production native/Hson semantic composition is active");
  const types = [...semantic.data].filter((_, index) => index % 5 === 3).map(index => hsonSemanticLegend.tokenTypes[index]);
  assert.ok(types.includes("hsonString") && types.includes("hsonQuote") && types.includes("variable"));
  await vscode.workspace.getConfiguration("editor").update("semanticTokenColorCustomizations", { rules: { hsonString: "#223344", hsonQuote: "#334455" } }, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration("editor").update("tokenColorCustomizations", { textMateRules: [{ scope: ["string.quoted.double.hson", "string.template.ts"], settings: { foreground: "#112233" } }] }, vscode.ConfigurationTarget.Workspace);
  await rendered(workspace, document, "semantic tokens override TextMate before appearance", [
    { needle: "attribute text", expected: "rgb(34, 51, 68)" }, { needle: '"content text', length: 1, expected: "rgb(51, 68, 85)" },
  ]);
  const native = [
    { needle: "hostValue", offset: 0, length: 9 },
    { needle: "${hostValue", offset: 2, length: 9 },
    { needle: "${", offset: 1, length: 1 },
    { needle: "<p", length: 1 },
    { needle: "Hson.document", length: 1 },
    { needle: "%{input}", offset: 2, length: 5 },
  ];
  const before = await rendered(workspace, document, "native before", native);
  const renderer = new AppearanceRenderer(grammar);
  await renderer.attach(document);
  const preview=initialAppearance();preview.overrides.all=Object.fromEntries(appearanceRoles.map((role,i)=>[role,{dark:{foreground:["#ff0000","#00ff00","#0000ff","#ff00ff"][i]}}]));
  await renderer.setAppearance(preview);
  await rendered(workspace, document, "four independent rendered roles", [
    { needle: "attribute text", expected: "rgb(255, 0, 0)" },
    { needle: "content text", expected: "rgb(0, 255, 0)" },
    { needle: '"attribute text', length: 1, expected: "rgb(0, 0, 255)" },
    { needle: '"content text', length: 1, expected: "rgb(255, 0, 255)" },
    ...native.map((sample, i) => ({ ...sample, expected: before[i] })),
  ]);
  const editorSettings = vscode.workspace.getConfiguration('editor');
  const decoration = () => ui<{textDecoration:string}>(workspace,{action:'text-style',needle:'content text'});
  const decorations: Record<string, string> = {};
  for (const [label, underline, strikethrough, nativeUnderline, nativeStrike, foreground] of [
    ['both Native', 'native', 'native', true, true, '#124447'],
    ['authored underline', true, 'native', false, true, '#334447'],
    ['authored strikethrough', 'native', true, true, false, '#554447'],
    ['both authored', true, true, false, false, '#774447'],
  ] as const) {
    await renderer.setAppearance(undefined);
    await editorSettings.update('semanticTokenColorCustomizations', { rules: {
      hsonString: { foreground: '#223344', underline: nativeUnderline, strikethrough: nativeStrike }, hsonQuote: '#334455',
    } }, vscode.ConfigurationTarget.Workspace);
    const nativeLine = [nativeUnderline ? 'underline' : '', nativeStrike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
    let baselineLine: string | undefined;
    for (let attempt = 0; attempt < 15 && baselineLine !== nativeLine; attempt++) {
      baselineLine = (await decoration()).textDecoration;
    }
    assert.equal(baselineLine, nativeLine, label + ' native baseline');
    preview.overrides.all!['value.string'] = {dark:{underline,strikethrough,foreground}};
    await renderer.setAppearance(preview);
    await rendered(workspace,document,label + ' with native styling',[
      {needle:'content text',expected:rgb(foreground)},
    ]);
    decorations[label] = (await decoration()).textDecoration;
  }
  console.log('Rendered text-decoration ownership', JSON.stringify(decorations));
  // VS Code exposes one CSS text-decoration value for the entire range. These
  // probes expose the mixed-ownership limitation without masking either case.
  assert.equal(decorations['both Native'], 'underline line-through');
  assert.equal(decorations['both authored'], 'underline line-through');
  assert.ok(decorations['authored underline']!.includes('underline'));
  assert.ok(decorations['authored strikethrough']!.includes('line-through'));
  if (decorations['authored underline'] !== 'underline line-through'
    || decorations['authored strikethrough'] !== 'underline line-through') {
    console.log('VS Code limitation: an authored text-decoration line replaces the Native line in mixed cases');
  }
  preview.overrides.all!['value.string'] = {dark:{foreground:'#00ff00'}};
  await renderer.setAppearance(preview);
  assert.equal(editor.document, document);
  await vscode.workspace.getConfiguration("editor").update("semanticHighlighting.enabled", false, vscode.ConfigurationTarget.Workspace);
  await rendered(workspace, document, "appearance also overrides TextMate with semantic tokens disabled", [
    { needle: "attribute text", expected: "rgb(255, 0, 0)" }, { needle: "content text", expected: "rgb(0, 255, 0)" },
  ]);
  renderer.dispose();
  renderer.dispose();
  await rendered(workspace, document, "disposal restores TextMate styling", [{ needle: "attribute text", expected: "rgb(17, 34, 51)" }]);
  await vscode.workspace.getConfiguration("editor").update("semanticHighlighting.enabled", true, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration("editor").update("semanticTokenColorCustomizations", undefined, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration("editor").update("tokenColorCustomizations", undefined, vscode.ConfigurationTarget.Workspace);
  console.log("ok - actual native editor colors: four independent roles, host/branding/bracket preservation, disposable renderer");
  await runEditor(workspace, extension.extensionPath);
}

async function runEditor(workspace: string, extensionPath: string): Promise<void> {
  const settingsPath=join(workspace,'.vscode/settings.json'), userPath=join(workspace,'../user/User/settings.json');
  const settings=await readFile(settingsPath,'utf8');
  const input=async(control:string,value:string)=>{await ui(workspace,control==='role'?{action:'select-role',role:value}:{action:'input',control,value});await pause();};
  const click=async(control:string)=>{const state=await ui(workspace,{action:'click',control});if(control==='revert'&&!state.revertDisabled)await ui(workspace,{action:'confirm-revert'});await pause();};
  const keyActivate=async(control:string)=>{await ui(workspace,{action:'key-activate',control});if(control==='revert')await ui(workspace,{action:'confirm-revert'});await pause();};
  const inspect=()=>ui(workspace,{action:'inspect'});
  const set=async(role:string,color:string)=>{await input('role',role);await input('foreground',color);await input('intensity','1');};
  const colors=['#d01020','#20d030','#3050d0','#d040c0'];
  const samples=[{needle:'Attribute text'},{needle:'Content text'},{needle:'"Attribute text',length:1},{needle:'"Content text',length:1}];
  const config=()=>readAppearance(vscode.workspace.getConfiguration('hson.appearance').get('state'));
  await vscode.commands.executeCommand('hson.openAppearance');
  assert.equal((await inspect()).saved,'false');
  let scratch=vscode.window.visibleTextEditors.find(e=>e.document.isUntitled&&e.document.languageId==='hson')!;
  assert.ok(scratch);assert.equal(scratch.viewColumn,vscode.ViewColumn.Two);
  const layout=await ui<{x:number;y:number;width:number;height:number;controls:boolean;native:boolean}[]>(workspace,{action:'layout'});
  const left=layout.find(g=>g.controls)!,right=layout.find(g=>g.native&&g.x>left.x)!;
  assert.ok(left&&right&&left.width>=250&&right.width>=350,JSON.stringify(layout));assert.ok(Math.abs(left.y-right.y)<2&&left.x+left.width<=right.x+2);
  const compact=await ui<{width:number;visibleRows:number;firstRowTop:number;roles:string[];properties:string[];groups:string[];groupLabels:string[];rowHeights:number[];controlsColor:string;inputColor:string}>(workspace,{action:'metrics'});
  assert.deepEqual([...compact.roles].sort(),Object.keys(roleCatalog).sort());assert.deepEqual(['foreground',...compact.properties],[...styleProperties]);
  assert.deepEqual(compact.groups,[...new Set(Object.keys(roleCatalog).map(id=>id.split('.')[0]))]);
  assert.equal(compact.groupLabels[0],'Tag');assert.ok(Math.max(...compact.rowHeights)<=30,'default roles fit on one compact line');assert.ok(compact.visibleRows>=12,'compact catalog exposes substantially more roles');assert.ok(compact.firstRowTop<300,'colors above the fold');
  await ui(workspace,{action:'screenshot',name:'pass2-compact'});
  const shipped=await readFile(join(extensionPath,'palettes/house.json'),'utf8');
  const metrics=()=>ui<{application:string;foreground:string;foregroundCaret:number;activeControl:string;saveDisabled:boolean;inputInvalid:string|null;intensityInvalid:string|null;resetDisabled:boolean;expanded:boolean;editingMode:string;previewMode:string;swatches:Record<string,{color:string;hex:string;picker:string;inherit:boolean;source:string;acceptedSource:string;sourceInvalid:string|null;disabled:boolean}>}>(workspace,{action:'metrics'});
  assert.match((await metrics()).application,/Not applied/);
  await input('foreground','#4c89ab');
  await click('apply');
  await rendered(workspace,scratch.document,'direct House edit without duplication',[{needle:'Attribute text',expected:rgb('#4c89ab')}]);
  await input('foreground','#4c89ac');await click('undo');
  await keyActivate('save');
  assert.equal(config().palettes.find(p=>p.id==='house')?.roles['value.attributeString']?.dark?.foreground,'#4c89ab');
  await click('redo');
  assert.equal((await inspect()).values.foreground,'#4c89ac');
  assert.match((await inspect()).status,/Unsaved/);
  assert.equal((await metrics()).saveDisabled,false);
  assert.equal(paletteById(config(),'house')?.roles['value.attributeString']?.dark?.foreground,'#4c89ab');
  await click('undo');assert.equal((await inspect()).values.foreground,'#4c89ab');

  const reopenAppearance=async()=>{
    const tab=vscode.window.tabGroups.all.flatMap(group=>group.tabs).find(t=>t.label==='Hson Appearance')!;
    await vscode.window.tabGroups.close(tab);
    await vscode.commands.executeCommand('hson.openAppearance');
    for(let attempt=0;attempt<30 && !(await inspect()).values.target;attempt++)await pause();
  };
  await input('hex-comment.line','#22aa33');
  await ui(workspace,{action:'input',control:'hex-value.attributeString',value:'#broken',keepFocus:true});
  assert.equal((await metrics()).inputInvalid,'true');
  await reopenAppearance();
  const reopened=await metrics();
  assert.equal(reopened.foreground,'#broken');
  assert.equal(reopened.inputInvalid,'true');
  assert.equal(reopened.swatches['value.attributeString']!.color,rgb('#4c89ab'),'rejected text leaves the accepted preview intact');
  assert.equal(reopened.saveDisabled,true);
  assert.equal(reopened.resetDisabled,false,'Reset remains available when the underlying color already equals Saved');
  await click('reset-foreground');
  assert.equal((await inspect()).values.foreground,'#4c89ab');
  assert.equal((await metrics()).saveDisabled,false,'Reset unblocks Save for the other valid draft edit');
  await click('undo');
  assert.equal((await metrics()).swatches['comment.line']!.hex,'#939daa','Reset of rejected text alone adds no undo step');

  await input('role','value.attributeString');
  await ui(workspace,{action:'input',control:'intensity',value:' 1.5 ',keepFocus:true});
  assert.equal((await metrics()).intensityInvalid,'true');
  await reopenAppearance();
  assert.equal((await metrics()).expanded,true);
  assert.equal((await metrics()).intensityInvalid,'true');
  assert.equal((await inspect()).values.intensity,' 1.5 ','reopen preserves the text as entered, including formatting');
  await input('intensity','.5');
  assert.equal((await metrics()).intensityInvalid,null);
  assert.equal((await metrics()).saveDisabled,false);
  await click('reset-intensity');
  await input('foreground','#124578');await click('reset-foreground');
  assert.equal((await inspect()).values.foreground,'#4c89ab','Reset uses last saved color');
  await click('undo');assert.equal((await inspect()).values.foreground,'#124578','Undo reverses Reset');
  await click('redo');assert.equal((await inspect()).values.foreground,'#4c89ab');
  await input('foreground','#123456');await input('hex-value.string','#654321');
  const sourceBeforeHistory=scratch.document.getText(),versionBeforeHistory=scratch.document.version;
  await click('undo');await click('undo');await click('redo');await click('redo');
  assert.equal(scratch.document.getText(),sourceBeforeHistory);assert.equal(scratch.document.version,versionBeforeHistory);
  await input('role','value.attributeString');
  await ui(workspace,{action:'input',control:'foreground',value:'#a',keepFocus:true});
  await ui(workspace,{action:'input',control:'foreground',value:'#abc',keepFocus:true});
  await ui(workspace,{action:'input',control:'foreground',value:'#aabbcc',keepFocus:true});
  await ui(workspace,{action:'blur',control:'foreground'});await pause();
  await click('undo');assert.equal((await inspect()).values.foreground,'#123456','one undo reverses a typing gesture');
  await ui(workspace,{action:'input',control:'picker-value.attributeString',value:'#abcdea',keepFocus:true});
  await ui(workspace,{action:'input',control:'picker-value.attributeString',value:'#abcdeb',keepFocus:true});
  await input('picker-value.attributeString','#abcdef');
  await ui(workspace,{action:'shortcut',control:'foreground'});await pause();assert.equal((await inspect()).values.foreground,'#123456','keyboard undo reverses a color-picker gesture');
  await click('redo');
  await rendered(workspace,scratch.document,'swatch picker input updates immediate House preview',[{needle:'Attribute text',expected:rgb('#abcdef')}]);
  assert.equal((await inspect()).values.foreground,'#abcdef');
  assert.equal((await metrics()).swatches['value.attributeString']!.picker,'#abcdef');
  assert.equal((await metrics()).swatches['value.attributeString']!.color,rgb('#abcdef'));
  await click('inherit-value.attributeString');await input('inherits','value.string');
  await rendered(workspace,scratch.document,'selected inherited source preview',[{needle:'Attribute text',expected:rgb('#654321')}]);
  assert.equal((await metrics()).swatches['value.attributeString']!.color,rgb('#654321'));
  // Set up the reverse link with no cycle, then try to close the cycle while
  // the selected row has rejected text. Undo must still reach the earlier edit.
  await input('inherits','comment.line');
  await input('role','value.string');await input('inherits','value.attributeString');
  await input('role','value.attributeString');
  await ui(workspace,{action:'input',control:'foreground',value:'#broken',keepFocus:true});
  await ui(workspace,{action:'input',control:'inherits',value:'value.string',keepActive:true});
  assert.match((await inspect()).error,/Role inheritance cycle/);
  assert.equal((await inspect()).values.foreground,'#broken');
  assert.equal((await metrics()).activeControl,'foreground');
  assert.equal((await metrics()).swatches['value.attributeString']!.source,'value.string','rejected selection remains visible');
  assert.equal((await metrics()).swatches['value.attributeString']!.acceptedSource,'comment.line','rejected inheritance leaves the accepted link intact');
  assert.equal((await metrics()).swatches['value.attributeString']!.sourceInvalid,'true');
  assert.equal((await metrics()).inputInvalid,'true');
  assert.equal((await metrics()).saveDisabled,true);
  await click('undo');
  assert.equal((await metrics()).swatches['value.string']!.source,'','Undo still reaches the preceding source edit');
  await click('redo');
  assert.equal((await metrics()).swatches['value.string']!.source,'value.attributeString');
  await input('role','value.string');await input('inherits','');await input('role','value.attributeString');
  for(const [raw,intensity,effective,expected] of [
    ['#654321','1','#654321','rgb(101, 67, 33)'],
    ['#11223380','1','#11223380','rgba(17, 34, 51, 0.5)'],
    ['#11223380','.5','#101b2780','rgba(16, 27, 39, 0.5)'],
  ] as const){
    await input('hex-value.string',raw);await input('role','value.attributeString');
    await input('inherits','value.string');await input('intensity',intensity);
    assert.equal((await metrics()).swatches['value.attributeString']!.hex,effective);
    await rendered(workspace,scratch.document,'inherited foreground before disabling inheritance',[{needle:'Attribute text',expected}]);
    if(intensity==='.5'){
      await ui(workspace,{action:'input',control:'foreground',value:'#broken',keepFocus:true});
      assert.equal((await metrics()).inputInvalid,'true');
    }
    await click('inherit-value.attributeString');
    const row=(await metrics()).swatches['value.attributeString']!;
    assert.equal((await inspect()).values.foreground,raw,'hex shows the complete authored foreground');
    assert.equal(row.picker,raw.slice(0,7),'picker shows the RGB channels');
    assert.equal(row.hex,effective,'swatch preserves the exact alpha byte and blends RGB once');
    assert.equal(row.color,expected);
    assert.equal((await metrics()).inputInvalid,null,'an accepted replacement reconciles the hex field');
    await rendered(workspace,scratch.document,'foreground after disabling inheritance',[{needle:'Attribute text',expected}]);
    await click('inherit-value.attributeString');
  }
  await input('inherits','native');assert.equal((await metrics()).swatches['value.attributeString']!.source,'native');
  await click('inherit-value.attributeString');assert.equal((await metrics()).swatches['value.attributeString']!.disabled,true);
  await click('light');await input('foreground','#ab12cd');
  await rendered(workspace,scratch.document,'Light toggle previews without changing global theme',[{needle:'Attribute text',expected:rgb('#ab12cd')}]);
  assert.equal(vscode.workspace.getConfiguration('workbench').get('colorTheme'),'Hson House Dark');
  await click('dark');assert.notEqual((await inspect()).values.foreground,'#ab12cd');
  await ui(workspace,{action:'click',control:'revert'});await ui(workspace,{action:'confirm-revert',cancel:true});
  assert.match((await inspect()).status,/Unsaved/);
  await click('revert');assert.equal((await inspect()).values.foreground,'#4c89ab');
  await click('restore');await keyActivate('save');
  assert.deepEqual(paletteById(config(),'house'),housePalette,'explicit shipped restoration');
  await input('hex-comment.line','#99aa11');await keyActivate('save');
  await click('export');assert.deepEqual(JSON.parse(vscode.window.activeTextEditor!.document.getText()),{...housePalette,...paletteById(config(),'house')},'edited House source export');
  assert.equal(await readFile(join(extensionPath,'palettes/house.json'),'utf8'),shipped,'Save and export never rewrite shipped source');
  await click('Document');scratch=vscode.window.visibleTextEditors.find(e=>e.document===scratch.document)!;await input('role','value.attributeString');
  await click('role-value.attributeString');
  await ui(workspace,{action:'details',control:'management',open:false});await ui(workspace,{action:'catalog-top'});
  await ui(workspace,{action:'screenshot',name:'direct-house-compact'});
  const baseline=await rendered(workspace,scratch.document,'saved House baseline',samples);
  const brackets=[{needle:'<section',length:1},{needle:'<h1',length:1}];
  const bracketColors=await rendered(workspace,scratch.document,'native standalone brackets',brackets);
  await input('name','Document Palette');await click('duplicate');
  const target=(await inspect()).values.target!,id=target.slice(8);
  assert.ok(id&&id!=='house');await input('all',id);
  assert.equal((await ui<{editableRows:number}>(workspace,{action:'metrics'})).editableRows,Object.keys(roleCatalog).length,'every catalog role can be edited');
  await input('name','Document renamed');await click('rename');assert.equal((await inspect()).values.target,target);
  await keyActivate('save');assert.equal(config().palettes.find(p=>p.id===id)?.id,id);assert.equal(config().palettes.find(p=>p.id===id)?.name,'Document renamed');
  assert.deepEqual(JSON.parse(await readFile(userPath,'utf8'))['hson.appearance.state'],config(),'explicit User persistence');
  const savedUser=await readFile(userPath,'utf8');
  // An inline row edits its own role without opening the advanced inspector.
  await input('hex-value.string','#234567');
  assert.equal((await inspect()).values.foreground,'#234567');
  assert.equal((await ui<{expanded:boolean}>(workspace,{action:'metrics'})).expanded,false);
  await input('role','punctuation.tagOpen');
  assert.match((await ui<{effective:string}>(workspace,{action:'metrics'})).effective,/Native bracket/);
  const started=Date.now();
  for(const [i,role]of appearanceRoles.entries())await set(role,colors[i]!);
  // Content end quotes are an independently authored role in the full catalog.
  await set('punctuation.quoteClose',colors[3]!);
  await rendered(workspace,scratch.document,'live palette edits through actual webview controls',samples.map((s,i)=>({...s,expected:rgb(colors[i]!)})));
  const multiControlRenderMs=Date.now()-started;
  await rendered(workspace,scratch.document,'closing quotes and native bracket ownership',[
    {needle:'Attribute text"',offset:14,length:1,expected:rgb(colors[2]!)},{needle:'Content text"',offset:12,length:1,expected:rgb(colors[3]!)},...brackets.map((s,i)=>({...s,expected:bracketColors[i]}))]);
  await input('role','value.string');
  for(const flag of ['bold','italic','underline','strikethrough']){await input(flag,'true');assert.equal((await inspect()).values[flag],'true');await click('reset-'+flag);}
  const singleStart=Date.now();
  await ui(workspace,{action:'input',control:'foreground',value:'#21abc3',keepFocus:true});
  await rendered(workspace,scratch.document,'single color input to rendered output',[{needle:'Content text',expected:rgb('#21abc3')}]);
  assert.equal((await ui<{activeControl:string}>(workspace,{action:'metrics'})).activeControl,'foreground','live updates preserve hex input focus');
  const singleColorRenderMs=Date.now()-singleStart;await input('foreground',colors[1]!);
  await ui(workspace,{action:'input',control:'foreground',value:'#broken',keepFocus:true});
  await pause();
  const invalid=await ui<{activeControl:string;saveDisabled:boolean;inputInvalid:string}>(workspace,{action:'metrics'});
  assert.equal(invalid.activeControl,'foreground');
  assert.equal(invalid.inputInvalid,'true');
  assert.equal(invalid.saveDisabled,true,'rejected focused input blocks Save');
  await click('save');
  assert.equal(await readFile(userPath,'utf8'),savedUser);
  await ui(workspace,{action:'blur',control:'foreground'});
  assert.equal((await inspect()).values.foreground,'#broken','invalid input remains visible after blur');
  assert.equal((await ui<{saveDisabled:boolean}>(workspace,{action:'metrics'})).saveDisabled,true);
  await input('foreground',colors[1]!);

  await input('intensity','.5');await input('fontStyle','bold italic underline');
  await rendered(workspace,scratch.document,'RGB intensity blending with rendered font style',[{needle:'Content text',expected:rgb(blend(colors[1]!,'#0f141a',.5))}]);
  const font=await ui<{fontStyle:string;fontWeight:string;textDecoration:string}>(workspace,{action:'text-style',needle:'Content text'});
  assert.equal(font.fontStyle,'italic');assert.ok(['bold','700'].includes(font.fontWeight));assert.match(font.textDecoration,/underline/);
  await click('reset-fontStyle');await input('intensity','1');await ui(workspace,{action:'screenshot',name:'pass2-expanded'});
  await vscode.window.showTextDocument(scratch.document,vscode.ViewColumn.Two);
  const original=scratch.document.getText();
  const largeSource='<section\n  <p "Typing probe"/>\n'+Array.from({length:2000},(_,i)=>'  <p "Row '+i+'"/>\n').join('')+'/>\n';
  const replaceScratch=async(value:string)=>{
    const end=scratch.document.positionAt(scratch.document.getText().length);
    assert.ok(await scratch.edit(edit=>edit.replace(new vscode.Range(new vscode.Position(0,0),end),value)));
  };
  await replaceScratch(largeSource);
  const typingColumn=scratch.document.lineAt(1).text.indexOf('Typing probe')+'Typing probe'.length;
  scratch.selection=new vscode.Selection(1,typingColumn,1,typingColumn);
  await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
  await ui(workspace,{action:'focus-editor'});
  const typingMs:number[]=[];
  const spanCache=new AppearanceSpanCache();
  const largeGrammar=await load_hson_grammar(extensionPath);
  const classificationMs:number[]=[];
  let classifiedSpans=0;
  for(const char of '123456'){
    const started=performance.now();
    const version=scratch.document.version;
    const changed=new Promise<void>(resolve=>{
      const subscription=vscode.workspace.onDidChangeTextDocument(event=>{
        if(event.document===scratch.document&&event.document.version!==version){subscription.dispose();resolve();}
      });
      setTimeout(()=>{subscription.dispose();resolve();},3000).unref();
    });
    await vscode.commands.executeCommand('type',{text:char});
    await changed;
    assert.ok(scratch.document.version>version);
    typingMs.push(Math.round(performance.now()-started));
    const source={uri:scratch.document.uri.toString(),fileName:scratch.document.fileName,languageId:'hson',version:scratch.document.version,text:scratch.document.getText()};
    const classifyStart=performance.now();
    const spans=spanCache.get(largeGrammar,source,'document');
    classificationMs.push(Math.round(performance.now()-classifyStart));
    classifiedSpans=spans.length;
    assert.equal(spanCache.get(largeGrammar,source,'document'),spans,'unchanged source reuses classification');
  }
  assert.match(scratch.document.lineAt(1).text,/Typing probe123456/);
  await rendered(workspace,scratch.document,'large scratchpad retains draft colors after typing',[
    {needle:'Typing probe123456',expected:rgb(colors[1]!)},
  ]);
  const largeFile={lines:scratch.document.lineCount,characters:scratch.document.getText().length,classifiedSpans,typingMs,classificationMs};
  console.log('Large scratchpad typing',JSON.stringify(largeFile));
  await replaceScratch(original);
  await scratch.edit(edit=>edit.insert(new vscode.Position(0,0),'// User edit 😀\n'));
  scratch.selection=new vscode.Selection(2,3,2,15);const selection=scratch.selection,version=scratch.document.version,edited=scratch.document.getText();
  await keyActivate('saved');await rendered(workspace,scratch.document,'Saved A/B',samples.map((s,i)=>({...s,expected:baseline[i]})));
  await ui(workspace,{action:'screenshot',name:'pass2-saved'});
  assert.equal((await inspect()).values.foreground,colors[1]);assert.equal((await inspect()).saved,'true');
  await keyActivate('draft');await rendered(workspace,scratch.document,'Draft A/B',samples.map((s,i)=>({...s,expected:rgb(colors[i]!)})));
  await ui(workspace,{action:'screenshot',name:'pass2-draft'});
  assert.equal(scratch.document.getText(),edited);assert.equal(scratch.document.version,version);assert.ok(scratch.selection.isEqual(selection));
  await vscode.window.showTextDocument(scratch.document,vscode.ViewColumn.Two);await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
  await ui(workspace,{action:'focus-editor'});await pause();await vscode.commands.executeCommand('undo');
  for(let i=0;i<30&&scratch.document.version===version;i++)await pause();assert.equal(scratch.document.getText(),original,'native undo retained');
  const replacement='<p title="pasted attribute" "pasted content"/>\n';
  await scratch.edit(edit=>edit.replace(new vscode.Range(scratch.document.positionAt(0),scratch.document.positionAt(original.length)),replacement));
  await rendered(workspace,scratch.document,'arbitrary pasted Hson',[{needle:'pasted attribute',expected:rgb(colors[0]!)},{needle:'pasted content',expected:rgb(colors[1]!)}]);
  await scratch.edit(edit=>edit.delete(new vscode.Range(0,3,0,9)));
  await rendered(workspace,scratch.document,'source invalidation changes role',[{needle:'pasted attribute',expected:rgb(colors[1]!)}]);
  await scratch.edit(edit=>edit.replace(new vscode.Range(scratch.document.positionAt(0),scratch.document.positionAt(scratch.document.getText().length)),original));
  await scratch.edit(edit=>edit.insert(scratch.document.positionAt(original.length),'\n'.repeat(80)+'<p "scroll target"/>'));
  scratch.revealRange(new vscode.Range(scratch.document.lineCount-1,0,scratch.document.lineCount-1,1),vscode.TextEditorRevealType.AtTop);await pause();
  const line=scratch.visibleRanges[0]!.start.line;await click('saved');await click('draft');assert.equal(scratch.visibleRanges[0]!.start.line,line);
  scratch.revealRange(new vscode.Range(0,0,0,0),vscode.TextEditorRevealType.AtTop);await pause();
  for(const role of appearanceRoles)await set(role,'#0f141a');
  await rendered(workspace,scratch.document,'identical background-equal colors',samples.map(s=>({...s,expected:rgb('#0f141a')})));
  const extreme=await ui<{controlsColor:string;inputColor:string}>(workspace,{action:'metrics'});
  assert.equal(extreme.controlsColor,compact.controlsColor,'palette colors do not style operational controls');
  assert.equal(extreme.inputColor,compact.inputColor,'hex text remains owned by the UI theme');
  await ui(workspace,{action:'screenshot',name:'pass2-extreme'});
  assert.equal(await readFile(userPath,'utf8'),savedUser,'color changes do not persist');assert.equal(await readFile(settingsPath,'utf8'),settings);
  await keyActivate('revert');await rendered(workspace,scratch.document,'Revert Draft',samples.map((s,i)=>({...s,expected:baseline[i]})));
  assert.match((await inspect()).status,/All saved/);
  // Remove the extra top-level scroll probe before testing valid Part binding resolution.
  await scratch.edit(edit=>edit.replace(new vscode.Range(scratch.document.positionAt(0),scratch.document.positionAt(scratch.document.getText().length)),original));
  await input('target','override:document');await set('part.receivingArgument','#7f9a55');
  await rendered(workspace,scratch.document,'resolved binding declaration and local root share the authored role',[
    {needle:'data:message',offset:5,length:7,expected:rgb('#7f9a55')},{needle:'^{message}',offset:2,length:7,expected:rgb('#7f9a55')}]);
  await click('reset-foreground');await click('reset-intensity');await input('target',target);
  await set('value.string','#21a2b3');
  await input('name','Data palette');await click('new');const dataTarget=(await inspect()).values.target!,dataId=dataTarget.slice(8);
  await set('value.string','#e05060');await set('element.name','#e07020');await input('data',dataId);
  const retained=scratch.document.getText();await click('Data');
  const data=vscode.window.visibleTextEditors.find(e=>e.document.isUntitled&&e.document!==scratch.document)!;
  assert.doesNotThrow(()=>Hson.data.parse(data.document.getText()),'Data example uses admitted current syntax');
  await rendered(workspace,data.document,'Data family independent palette',[{needle:'Data content',expected:rgb('#e05060')}]);
  await click('Document');scratch=vscode.window.visibleTextEditors.find(e=>e.document===scratch.document)!;assert.equal(scratch.document.getText(),retained);
  await rendered(workspace,scratch.document,'Document inherits All',[{needle:'Content text',expected:rgb('#21a2b3')}]);
  await click('Interpolation');const mixed=vscode.window.visibleTextEditors.find(e=>e.document.isUntitled&&e.document.languageId==='typescript')!;
  assert.ok(mixed.document.getText().includes('Hson.data'));
  assert.doesNotThrow(()=>Hson.data.parse(mixed.document.getText().split('Hson.data`')[1]!.split('`')[0]!), 'mixed example Data uses admitted current syntax');
  await rendered(workspace,mixed.document,'Data and Document palettes in the SAME native editor',[
    {needle:'Content text',length:12,expected:rgb('#21a2b3')},{needle:'Data text',expected:rgb('#e05060')},{needle:'true "Data text"',length:4,expected:rgb('#e07020')}]);
  const native=[{needle:'${hostValue',offset:2,length:9},{needle:'${',offset:1,length:1},{needle:'<catalog',length:1},{needle:'Hson.document',length:1}];
  const nativeBefore=await rendered(workspace,mixed.document,'native host, brackets and branding before scoped overrides',native);
  await input('target','override:data');await set('value.string','#808080');
  await rendered(workspace,mixed.document,'Data override does not alter Document or native owners',[
    {needle:'Data text',expected:rgb('#808080')},{needle:'Content text',length:12,expected:rgb('#21a2b3')},...native.map((s,i)=>({...s,expected:nativeBefore[i]}))]);
  await click('reset-foreground');await rendered(workspace,mixed.document,'override reset inherits selected Data palette',[{needle:'Data text',expected:rgb('#e05060')}]);
  await input('data','native');await click('saved');const nativeData=await rendered(workspace,mixed.document,'Native baseline for Data',[{needle:'Data text'}]);
  await click('draft');await rendered(workspace,mixed.document,'explicit Native family delegates',[{needle:'Data text',expected:nativeData[0]},{needle:'Content text',length:12,expected:rgb('#21a2b3')}]);
  await input('data','');await rendered(workspace,mixed.document,'family reset inherits All',[{needle:'Data text',expected:rgb('#21a2b3')}]);await input('data',dataId);
  await input('destination','workspace');await click('save');const persisted=config();
  assert.equal(persisted.assignments.data,dataId);assert.equal(persisted.assignments.all,id);
  assert.deepEqual(JSON.parse(await readFile(settingsPath,'utf8'))['hson.appearance.state'],persisted);
  assert.equal(await readFile(userPath,'utf8'),savedUser,'Workspace save does not alter User state');
  // Ordinary files use saved state and the same resolver/decorations as scratchpads.
  await writeFile(join(workspace,'normal-proof.ts'),mixed.document.getText());
  const ordinary=await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace,'normal-proof.ts')));await vscode.window.showTextDocument(ordinary,vscode.ViewColumn.Two);
  await rendered(workspace,ordinary,'saved production renderer matches mixed draft',[
    {needle:'Content text',length:12,expected:rgb('#21a2b3')},{needle:'Data text',expected:rgb('#e05060')}]);
  await input('target','palette:house');await click('export');assert.deepEqual(JSON.parse(vscode.window.activeTextEditor!.document.getText()),{...housePalette,...paletteById(persisted,'house')},'House export preserves edited palette source');
  await input('target',dataTarget);await click('export');const exported=vscode.window.activeTextEditor!.document;
  assert.equal(exported.languageId,'json');const palette=JSON.parse(exported.getText());assert.equal(palette.id,dataId);assert.equal(palette.name,'Data palette');assert.deepEqual(palette.roles,persisted.palettes.find(p=>p.id===dataId)!.roles);assert.ok(exported.isUntitled);
  await input('name','Disposable');await click('duplicate');const disposable=(await inspect()).values.target;await click('delete');assert.ok(!(await inspect()).targets.some(t=>t.value===disposable));
  await input('target',dataTarget);await click('delete');assert.match((await inspect()).error,/Reassign/);
  await click('revert');assert.deepEqual(config(),persisted);
  await click('Interpolation');
  await click('role-value.string');await input('filter','string');await ui(workspace,{action:'details',control:'assignments',open:true});await ui(workspace,{action:'details',control:'management',open:false});
  await ui(workspace,{action:'screenshot',name:'pass2-families'});
  const scratchDiagnostics=vscode.languages.getDiagnostics(mixed.document.uri).map(d=>({source:d.source,code:d.code,message:d.message}));
  console.log('Mixed scratchpad diagnostics',JSON.stringify(scratchDiagnostics));
  assert.ok(!scratchDiagnostics.some(d=>d.source==='Hson'),'no Hson syntax diagnostics in mixed example');
  await ui(workspace,{action:'details',control:'assignments',open:false});await input('filter','');
  // Actual native editor group widths, not a simulated HTML-only viewport.
  await vscode.commands.executeCommand('vscode.setEditorLayout',{orientation:0,groups:[{size:.32},{size:.68}]});await pause();
  await ui(workspace,{action:'catalog-top'});
  const narrow=await ui<{width:number;scrollWidth:number;visibleRows:number;catalogScrollWidth:number;catalogClientWidth:number}>(workspace,{action:'metrics'});
  const narrowLayout=await ui<typeof layout>(workspace,{action:'layout'});
  assert.ok(narrow.width<compact.width&&narrow.width>=220);assert.ok(narrow.scrollWidth<=narrow.width,'no horizontal panel overflow');assert.ok(narrow.catalogScrollWidth<=narrow.catalogClientWidth,'no hidden horizontal scrolling within the role list');
  assert.ok(narrowLayout.some(g=>g.native&&g.width>=350));
  await ui(workspace,{action:'screenshot',name:'pass2-narrow'});
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('vscode.setEditorLayout',{orientation:0,groups:[{size:.38},{size:.62}]});await pause();
  const wide=await ui<{width:number;visibleRows:number}>(workspace,{action:'metrics'});assert.ok(wide.width>compact.width);
  await ui(workspace,{action:'screenshot',name:'pass2-wide'});

  const panel=vscode.window.tabGroups.all.flatMap(g=>g.tabs).find(t=>t.label==='Hson Appearance')!;await vscode.window.tabGroups.close(panel);
  await rendered(workspace,mixed.document,'closing panel retains saved production appearance',[{needle:'Data text',expected:rgb('#e05060')}]);
  await vscode.commands.executeCommand('hson.openAppearance');assert.equal((await inspect()).values.data,dataId,'reopen reloads persisted assignment');
  await click('Interpolation');await input('target',target);await input('role','value.string');
  const changeThemeWhileInvalid=async(theme:string,from:'light'|'dark',to:'light'|'dark',value='#unresolved')=>{
    await ui(workspace,{action:'input',control:'foreground',value,keepFocus:true});
    assert.equal((await metrics()).inputInvalid,'true');
    await vscode.workspace.getConfiguration('workbench').update('colorTheme',theme,vscode.ConfigurationTarget.Workspace);
    let after=await metrics();
    for(let attempt=0;attempt<30&&!after.previewMode.includes(to);attempt++)after=await metrics();
    assert.match(after.previewMode,new RegExp(to));
    assert.equal(vscode.window.activeColorTheme.kind,to==='light'?vscode.ColorThemeKind.Light:vscode.ColorThemeKind.Dark);
    assert.equal(after.editingMode,from,'actual theme changes without switching the invalid field to another mode');
    assert.equal(after.foreground,value);
    assert.equal(after.activeControl,'foreground');
    assert.equal(after.inputInvalid,'true');
    assert.equal(after.saveDisabled,true);
  };
  await changeThemeWhileInvalid('Hson House Light','dark','light','#12');
  await ui(workspace,{action:'type',control:'foreground',text:'3'});
  const shorthand=await metrics();
  assert.equal(shorthand.editingMode,'dark','valid shorthand does not end the gesture');
  assert.equal(shorthand.foreground,'#123');
  assert.equal(shorthand.activeControl,'foreground');
  assert.equal(shorthand.foregroundCaret,4);
  assert.equal(shorthand.inputInvalid,null);
  await rendered(workspace,mixed.document,'accepted shorthand previews while typing',[{needle:'Content text',expected:rgb('#112233')}]);
  await ui(workspace,{action:'type',control:'foreground',text:'4'});
  await ui(workspace,{action:'type',control:'foreground',text:'5'});
  assert.equal((await metrics()).inputInvalid,'true','the five-digit intermediate is still visibly rejected');
  await ui(workspace,{action:'type',control:'foreground',text:'6'});
  const fullHex=await metrics();
  assert.equal(fullHex.editingMode,'dark');
  assert.equal(fullHex.foreground,'#123456');
  assert.equal(fullHex.foregroundCaret,7);
  assert.equal(fullHex.inputInvalid,null);
  await ui(workspace,{action:'blur',control:'foreground'});
  assert.equal((await metrics()).editingMode,'light','blur follows the light theme after the gesture');
  await click('dark');assert.equal((await inspect()).values.foreground,'#123456');
  await click('undo');assert.equal((await inspect()).values.foreground,'#21a2b3','partial and complete colors form a single undo gesture');
  await click('light');
  const light=JSON.parse(await readFile(join(extensionPath,'themes/hson-house-light-color-theme.json'),'utf8'));
  await rendered(workspace,mixed.document,'light House values retained in duplicated palette',[{needle:'Content text',length:12,expected:rgb(light.semanticTokenColors.hsonString)}]);
  await input('foreground','#abc');await rendered(workspace,mixed.document,'light draft accepts shorthand hex',[{needle:'Content text',length:12,expected:rgb('#aabbcc')}]);
  await click('saved');await rendered(workspace,mixed.document,'light Saved comparison',[{needle:'Content text',length:12,expected:rgb(light.semanticTokenColors.hsonString)}]);await click('draft');
  await changeThemeWhileInvalid('Default Dark Modern','light','dark');
  await click('reset-foreground');
  assert.equal((await metrics()).editingMode,'dark','discarding the light input follows the current dark theme');
  assert.equal((await inspect()).values.foreground,'#21a2b3');
  await rendered(workspace,mixed.document,'syntax palette under unrelated workbench theme',[{needle:'Content text',length:12,expected:rgb('#21a2b3')},{needle:'Data text',expected:rgb('#e05060')}]);
  assert.equal(vscode.workspace.getConfiguration('workbench').get('colorTheme'),'Default Dark Modern');
  const report={vscodeVersion:vscode.version,layout,compact,narrow,narrowLayout,wide,scratchDiagnostics,largeFile,multiControlRenderMs,singleColorRenderMs,tests:['28 deterministic editing-state transitions','cycle and hex validation with explicit discard and close/reopen','native picker trusted keyboard input across a theme change','direct editable House and immutable shipped baseline','House save, export, restore and restart','picker and hex synchronization','inheritance source and blended color preservation','grouped typing and picker history, keyboard Undo','Reset, Undo and confirmed Revert All','Save concurrency and rejected-input blocking','rendered native controls','palette CRUD and stable rename','User/Workspace persistence','four independent syntax roles','A/B text selection undo scroll','source invalidation','identical background colors','Data/Document same document','override reset and Native','shared saved production renderer','export JSON','disposal/reopen','light/dark','native host/brackets/branding','rendered RGB intensity and font styles']};
  await writeFile(join(workspace,'appearance-report.json'),JSON.stringify(report,null,2));console.log('ok - appearance editor '+JSON.stringify(report));
}
