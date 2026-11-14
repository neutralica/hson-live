import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import { AppearanceRenderer } from "../../src/appearance-renderer.js";
import { load_hson_grammar } from "../../src/highlighting.js";
import { initialAppearance, readAppearance, blend } from "../../src/appearance-model.js";
const appearanceRoles = ["value.attributeString", "value.string", "punctuation.attributeQuotes", "punctuation.quoteOpen"] as const;
import { document_semantic_tokens, hsonSemanticLegend } from "../../src/semantic-tokens.js";

const pause = () => new Promise(resolve => setTimeout(resolve, 100));
let sequence = 0;
type UiState = { status: string; saved: string; error: string; values: Record<string,string>; targets:{value:string;label:string}[] };
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

export async function run(): Promise<void> {
  const workspace = process.env.HSON_APPEARANCE_WORKSPACE!;
  const extension = vscode.extensions.getExtension("terminal-gothic.hson-language")!;
  await extension.activate();
  if(process.env.HSON_APPEARANCE_RELOAD==='1'){
    const normal=await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace,'normal-proof.ts')));await vscode.window.showTextDocument(normal);
    await rendered(workspace,normal,'saved palettes restored after fresh extension host',[
      {needle:'Content text',length:12,expected:rgb('#21a2b3')},{needle:'Data text',expected:rgb('#e05060')}]);
    await vscode.commands.executeCommand('hson.openAppearance');const state=await ui(workspace,{action:'inspect'});
    assert.match(state.status,/Saved state/);assert.ok(state.values.data&&state.values.data!=='native');
    const report=JSON.parse(await readFile(join(workspace,'appearance-report.json'),'utf8'));report.tests.push('fresh extension host restores persisted palettes');
    await writeFile(join(workspace,'appearance-report.json'),JSON.stringify(report,null,2));console.log('ok - fresh extension host persistence');return;
  }
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
  const input=async(control:string,value:string)=>{await ui(workspace,{action:'input',control,value});await pause();};
  const click=async(control:string)=>{await ui(workspace,{action:'click',control});await pause();};
  const inspect=()=>ui(workspace,{action:'inspect'});
  const set=async(role:string,color:string)=>{await input('role',role);await input('foreground',color);await input('intensity','1');};
  const colors=['#d01020','#20d030','#3050d0','#d040c0'];
  const samples=[{needle:'Attribute text'},{needle:'Content text'},{needle:'"Attribute text',length:1},{needle:'"Content text',length:1}];
  const config=()=>readAppearance(vscode.workspace.getConfiguration('hson.appearance').get('state'));
  await vscode.commands.executeCommand('hson.openAppearance');
  assert.match((await inspect()).status,/Draft preview/);
  let scratch=vscode.window.visibleTextEditors.find(e=>e.document.isUntitled&&e.document.languageId==='hson')!;
  assert.ok(scratch);assert.equal(scratch.viewColumn,vscode.ViewColumn.Two);
  const layout=await ui<{x:number;y:number;width:number;height:number;controls:boolean;native:boolean}[]>(workspace,{action:'layout'});
  const left=layout.find(g=>g.controls)!,right=layout.find(g=>g.native&&g.x>left.x)!;
  assert.ok(left&&right&&left.width>=250&&right.width>=350,JSON.stringify(layout));assert.ok(Math.abs(left.y-right.y)<2&&left.x+left.width<=right.x+2);
  const baseline=await rendered(workspace,scratch.document,'native initial Saved baseline',samples);
  const brackets=[{needle:'<section',length:1},{needle:'<h1',length:1}];
  const bracketColors=await rendered(workspace,scratch.document,'native standalone brackets',brackets);
  await input('name','Document Palette');await click('duplicate');
  const target=(await inspect()).values.target!,id=target.slice(8);
  assert.ok(id&&id!=='house');await input('all',id);
  await input('name','Document renamed');await click('rename');assert.equal((await inspect()).values.target,target);
  await click('save');assert.equal(config().palettes[0]?.id,id);assert.equal(config().palettes[0]?.name,'Document renamed');
  assert.deepEqual(JSON.parse(await readFile(userPath,'utf8'))['hson.appearance.state'],config(),'explicit User persistence');
  const savedUser=await readFile(userPath,'utf8');
  const started=Date.now();
  for(const [i,role]of appearanceRoles.entries())await set(role,colors[i]!);
  // Content end quotes are an independently authored role in the full catalog.
  await set('punctuation.quoteClose',colors[3]!);
  await rendered(workspace,scratch.document,'live palette edits through actual webview controls',samples.map((s,i)=>({...s,expected:rgb(colors[i]!)})));
  const multiControlRenderMs=Date.now()-started;
  await rendered(workspace,scratch.document,'closing quotes and native bracket ownership',[
    {needle:'Attribute text"',offset:14,length:1,expected:rgb(colors[2]!)},{needle:'Content text"',offset:12,length:1,expected:rgb(colors[3]!)},...brackets.map((s,i)=>({...s,expected:bracketColors[i]}))]);
  await input('role','value.string');const singleStart=Date.now();
  await ui(workspace,{action:'input',control:'foreground',value:'#21abc3'});
  await rendered(workspace,scratch.document,'single color input to rendered output',[{needle:'Content text',expected:rgb('#21abc3')}]);
  const singleColorRenderMs=Date.now()-singleStart;await input('foreground',colors[1]!);
  await input('intensity','.5');await input('fontStyle','bold italic underline');
  await rendered(workspace,scratch.document,'RGB intensity blending with rendered font style',[{needle:'Content text',expected:rgb(blend(colors[1]!,'#0f141a',.5))}]);
  const font=await ui<{fontStyle:string;fontWeight:string;textDecoration:string}>(workspace,{action:'text-style',needle:'Content text'});
  assert.equal(font.fontStyle,'italic');assert.ok(['bold','700'].includes(font.fontWeight));assert.match(font.textDecoration,/underline/);
  await click('reset-fontStyle');await input('intensity','1');await ui(workspace,{action:'screenshot',name:'appearance-draft'});
  await vscode.window.showTextDocument(scratch.document,vscode.ViewColumn.Two);
  const original=scratch.document.getText();await scratch.edit(edit=>edit.insert(new vscode.Position(0,0),'// User edit 😀\n'));
  scratch.selection=new vscode.Selection(2,3,2,15);const selection=scratch.selection,version=scratch.document.version,edited=scratch.document.getText();
  await click('saved');await rendered(workspace,scratch.document,'Saved A/B',samples.map((s,i)=>({...s,expected:baseline[i]})));
  assert.equal((await inspect()).values.foreground,colors[1]);assert.equal((await inspect()).saved,'true');
  await click('draft');await rendered(workspace,scratch.document,'Draft A/B',samples.map((s,i)=>({...s,expected:rgb(colors[i]!)})));
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
  assert.equal(await readFile(userPath,'utf8'),savedUser,'color changes do not persist');assert.equal(await readFile(settingsPath,'utf8'),settings);
  await click('revert');await rendered(workspace,scratch.document,'Revert Draft',samples.map((s,i)=>({...s,expected:baseline[i]})));
  assert.match((await inspect()).status,/Saved state/);
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
  await rendered(workspace,data.document,'Data family independent palette',[{needle:'Data content',expected:rgb('#e05060')}]);
  await click('Document');scratch=vscode.window.visibleTextEditors.find(e=>e.document===scratch.document)!;assert.equal(scratch.document.getText(),retained);
  await rendered(workspace,scratch.document,'Document inherits All',[{needle:'Content text',expected:rgb('#21a2b3')}]);
  await click('Interpolation');const mixed=vscode.window.visibleTextEditors.find(e=>e.document.isUntitled&&e.document.languageId==='typescript')!;
  assert.ok(mixed.document.getText().includes('Hson.data'));
  await rendered(workspace,mixed.document,'Data and Document palettes in the SAME native editor',[
    {needle:'Content text',length:12,expected:rgb('#21a2b3')},{needle:'Data text',expected:rgb('#e05060')},{needle:'<true',offset:1,length:4,expected:rgb('#e07020')}]);
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
  await input('target','palette:house');await click('export');assert.deepEqual(JSON.parse(vscode.window.activeTextEditor!.document.getText()),JSON.parse(await readFile(join(extensionPath,'palettes/house.json'),'utf8')),'House export preserves full-theme source');
  await input('target',dataTarget);await click('export');const exported=vscode.window.activeTextEditor!.document;
  assert.equal(exported.languageId,'json');const palette=JSON.parse(exported.getText());assert.equal(palette.id,dataId);assert.equal(palette.name,'Data palette');assert.deepEqual(palette.roles,persisted.palettes.find(p=>p.id===dataId)!.roles);assert.ok(exported.isUntitled);
  await input('name','Disposable');await click('duplicate');const disposable=(await inspect()).values.target;await click('delete');assert.ok(!(await inspect()).targets.some(t=>t.value===disposable));
  await input('target',dataTarget);await click('delete');assert.match((await inspect()).error,/Reassign/);
  await click('revert');assert.deepEqual(config(),persisted);
  await click('Interpolation');await ui(workspace,{action:'screenshot',name:'appearance-families'});
  const panel=vscode.window.tabGroups.all.flatMap(g=>g.tabs).find(t=>t.label==='Hson Appearance')!;await vscode.window.tabGroups.close(panel);
  await rendered(workspace,mixed.document,'closing panel retains saved production appearance',[{needle:'Data text',expected:rgb('#e05060')}]);
  await vscode.commands.executeCommand('hson.openAppearance');assert.equal((await inspect()).values.data,dataId,'reopen reloads persisted assignment');
  await click('Interpolation');await input('target',target);await input('role','value.string');
  await vscode.workspace.getConfiguration('workbench').update('colorTheme','Hson House Light',vscode.ConfigurationTarget.Workspace);
  const light=JSON.parse(await readFile(join(extensionPath,'themes/hson-house-light-color-theme.json'),'utf8'));
  await rendered(workspace,mixed.document,'light House values retained in duplicated palette',[{needle:'Content text',length:12,expected:rgb(light.semanticTokenColors.hsonString)}]);
  await input('foreground','#abc');await rendered(workspace,mixed.document,'light draft accepts shorthand hex',[{needle:'Content text',length:12,expected:rgb('#aabbcc')}]);
  await click('saved');await rendered(workspace,mixed.document,'light Saved comparison',[{needle:'Content text',length:12,expected:rgb(light.semanticTokenColors.hsonString)}]);await click('draft');
  await vscode.workspace.getConfiguration('workbench').update('colorTheme','Default Dark Modern',vscode.ConfigurationTarget.Workspace);
  await rendered(workspace,mixed.document,'syntax palette under unrelated workbench theme',[{needle:'Content text',length:12,expected:rgb('#21a2b3')},{needle:'Data text',expected:rgb('#e05060')}]);
  assert.equal(vscode.workspace.getConfiguration('workbench').get('colorTheme'),'Default Dark Modern');
  const report={vscodeVersion:vscode.version,layout,multiControlRenderMs,singleColorRenderMs,tests:['rendered native controls','palette CRUD and stable rename','User/Workspace persistence','four independent syntax roles','A/B text selection undo scroll','source invalidation','identical background colors','Data/Document same document','override reset and Native','shared saved production renderer','export JSON','disposal/reopen','light/dark','native host/brackets/branding','rendered RGB intensity and font styles']};
  await writeFile(join(workspace,'appearance-report.json'),JSON.stringify(report,null,2));console.log('ok - appearance editor '+JSON.stringify(report));
}
