import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { ui, rendered } from './appearance.js';
import { parse_authored_document_library } from '../../../../src/api/livemap/livemap.document.quad.js';
import { checkNativeDurability } from './scratchpad-durability.js';
import { readAppearance } from '../../src/appearance-model.js';

const pause = () => new Promise(resolve => setTimeout(resolve,100));
const rgb = (hex:string) => `rgb(${[1,3,5].map(at=>parseInt(hex.slice(at,at+2),16)).join(', ')})`;
async function until<T>(read:()=>T|undefined, label:string):Promise<T> {
  for(let i=0;i<100;i++){const result=read();if(result!==undefined)return result;await pause();}
  throw new Error('Timed out: '+label);
}
async function replace(editor:vscode.TextEditor, text:string) {
  assert.ok(await editor.edit(edit=>edit.replace(new vscode.Range(editor.document.positionAt(0),editor.document.positionAt(editor.document.getText().length)),text)));
}
async function hsonErrors(document:vscode.TextDocument) {
  // Diagnostics are debounced; wait beyond the document change boundary.
  await new Promise(resolve=>setTimeout(resolve,400));
  return vscode.languages.getDiagnostics(document.uri).filter(diagnostic=>diagnostic.source==='Hson');
}
export async function checkScratchpads(workspace:string, storage?: vscode.Memento):Promise<void> {
  const click=async(control:string)=>{await ui(workspace,{action:'key-activate',control});await pause();};
  const input=async(control:string,value:string)=>{await ui(workspace,{action:'input',control,value});await pause();};
  const hex=async(role:string,value:string)=>{await ui(workspace,{action:'select-role',role});await pause();await ui(workspace,{action:'type-field',control:'foreground',value});await pause();};
  const color=(document:vscode.TextDocument,needle:string,expected:string,label=needle)=>rendered(workspace,document,label,[{needle,expected:rgb(expected)}]);
  const open=async(example:string,mode:string,target='palette:house',label='House')=>{
    await input('target',target);await click(mode);await click(example);await click('open-scratchpad');
    return until(()=>vscode.window.visibleTextEditors.find(editor=>editor.document.fileName.includes(`Hson ${example} - ${label} ${mode}`)),'open '+example+' '+mode);
  };
  const closePanel=async()=>{
    const tab=vscode.window.tabGroups.all.flatMap(group=>group.tabs).find(tab=>tab.label==='Hson Appearance');
    assert.ok(tab);assert.ok(await vscode.window.tabGroups.close(tab));
  };
  const savedFile=join(workspace,'scratchpad-persistence.json');
  const lifecycleFile=join(workspace,'scratchpad-lifecycle.json');
  const stage=await readFile(lifecycleFile,'utf8').catch(()=>undefined);
  const restart=async(next:string,command:string):Promise<never>=>{
    await writeFile(lifecycleFile,next);await vscode.commands.executeCommand(command);
    return new Promise<never>(()=>{}); // The restarted driver resumes the next stage.
  };
  assert.ok(storage, 'restart runner must provide real workspace Memento');
  await checkNativeDurability(workspace, storage, !!stage || process.env.HSON_APPEARANCE_RELOAD === '1');
  await vscode.commands.executeCommand('hson.openAppearance');
  assert.equal(vscode.window.tabGroups.all.flatMap(group=>group.tabs).filter(tab=>tab.label==='Hson Appearance').length,1,'one live Appearance panel after host restart');
  if(process.env.HSON_APPEARANCE_RELOAD==='1'||stage) {
    const records:{example:string;mode:string;uri:string;text:string}[]=JSON.parse(await readFile(savedFile,'utf8'));
    for(const record of records) {
      const editor=await open(record.example,record.mode);
      assert.equal(editor.document.uri.toString(),record.uri,'stable native scratchpad URI after fresh extension host');
      assert.equal(editor.document.getText(),record.text,'retained user source '+record.example+' '+record.mode);
      if(record.text)assert.deepEqual(await hsonErrors(editor.document),[],'declared authoring family survives restart');
      if(record.example==='Document') {
        await color(editor.document,record.mode==='dark'?'darkpanel':'lightpanel',record.mode==='dark'?'#12ab34':'#ef7654','pinned palette after fresh host');
        await replace(editor,record.text.replace(/<(\w+)\s+@:/,'<$1   @:'));
        const edits=await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider',editor.document.uri,{tabSize:2,insertSpaces:true});
        assert.ok(edits?.length,'reopened Document retains authored formatting context');
        const edit=new vscode.WorkspaceEdit();edit.set(editor.document.uri,edits);assert.ok(await vscode.workspace.applyEdit(edit));
        assert.deepEqual(parse_authored_document_library(editor.document.getText()),parse_authored_document_library(record.text));
        await replace(editor,record.text);
      }
    }
    const missing=JSON.parse(await readFile(join(workspace,'missing-palette.json'),'utf8'));
    await input('target',missing.target);await click('dark');await click('Document');await click('open-scratchpad');
    const orphan=await until(()=>vscode.window.visibleTextEditors.find(editor=>editor.document.uri.toString()===missing.uri),'retained missing palette');
    assert.equal(orphan.document.getText(),missing.text);
    const recovery=JSON.parse(await readFile(join(workspace,'palette-recovery.json'),'utf8'));
    await input('target',recovery.target);await click('dark');await click('Document');await click('open-scratchpad');
    const restored=await until(()=>vscode.window.visibleTextEditors.find(e=>e.document.uri.toString()===recovery.uri),'reassigned source');
    assert.equal(restored.document.getText(),recovery.text);
    console.log('ok - '+(process.env.HSON_APPEARANCE_RELOAD==='1'?'fresh process':stage)+' retains all six scratchpad texts, URIs, modes and families');
    const report=JSON.parse(await readFile(join(workspace,'scratchpad-report.json'),'utf8'));report.tests.push(process.env.HSON_APPEARANCE_RELOAD==='1'?'fresh process persistence':stage+' persistence');await writeFile(join(workspace,'scratchpad-report.json'),JSON.stringify(report,null,2));
    if(stage==='extension-restart'&&process.env.HSON_APPEARANCE_RELOAD!=='1')return restart('window-reload','workbench.action.reloadWindow');
    await writeFile(lifecycleFile,'complete');
    return;
  }
  assert.equal(readAppearance(vscode.workspace.getConfiguration('hson.appearance').get('state')).assignments.all,'native');
  let dark=await open('Document','dark');
  const darkSource='<darkpanel   @:title title="Dark attribute"\n<p @:body "Dark retained 😀"/>\n'+Array.from({length:220},(_,i)=>`<p "Retained paragraph ${i}"/>`).join('\n')+'\n/>\n';
  await replace(dark,darkSource);
  assert.deepEqual(await hsonErrors(dark.document),[]);
  const baseline=await rendered(workspace,dark.document,'baseline House with ordinary Native assignment',[{needle:'darkpanel'}]);
  dark.selection=new vscode.Selection(1,2,1,9);
  const version=dark.document.version,selection=dark.selection,scroll=dark.visibleRanges[0]!.start.line;
  await hex('element.name','#12ab34');
  await color(dark.document,'darkpanel','#12ab34','trusted visible hex input recolors existing scratchpad');
  await click('undo');await rendered(workspace,dark.document,'Undo renders baseline',[{needle:'darkpanel',expected:baseline[0]}]);
  await click('redo');await color(dark.document,'darkpanel','#12ab34','Redo renders working color');
  await click('saved');await rendered(workspace,dark.document,'Last Saved comparison',[{needle:'darkpanel',expected:baseline[0]}]);
  await click('draft');await color(dark.document,'darkpanel','#12ab34','Working comparison');
  assert.equal(dark.document.version,version);assert.equal(dark.document.getText(),darkSource);assert.ok(dark.selection.isEqual(selection));assert.equal(dark.visibleRanges[0]!.start.line,scroll);
  await ui(workspace,{action:'events'});await click('picker-element.name');
  await ui(workspace,{action:'key',key:'ArrowRight'});await ui(workspace,{action:'key',key:'ArrowDown'});await ui(workspace,{action:'key',key:'Enter'});
  const events=await ui<{type:string;trusted:boolean;value:string}[]>(workspace,{action:'events'});
  const picked=events.filter(event=>event.type==='input'&&event.trusted).at(-1);assert.ok(picked,'native picker must emit trusted input');
  await color(dark.document,'darkpanel',picked.value,'native picker recolors existing scratchpad');
  await ui(workspace,{action:'key',key:'Escape'});await ui(workspace,{action:'focus',control:'filter'});
  await hex('value.string','#654321');await input('from-element.name','value.string');
  await color(dark.document,'darkpanel','#654321','inheritance recolors existing scratchpad');
  await click('undo');await color(dark.document,'darkpanel',picked.value,'Undo inheritance');
  await hex('element.name','#12ab34');
  const light=await open('Document','light');
  assert.notEqual(light.document,dark.document);assert.ok(!dark.document.isClosed);
  await replace(light,'<lightpanel @:title\n<p @:body "Light retained"/>\n/>\n');
  await hex('element.name','#ef7654');await color(light.document,'lightpanel','#ef7654','Light palette editing');
  // Both native editors coexist with the same window-wide theme.
  await vscode.commands.executeCommand('vscode.setEditorLayout',{orientation:0,groups:[{size:.34},{size:.33},{size:.33}]});
  dark=await vscode.window.showTextDocument(dark.document,{viewColumn:vscode.ViewColumn.Three,preview:false,preserveFocus:true});
  const pinnedSelection=dark.selection;
  await color(dark.document,'darkpanel','#12ab34','Dark remains pinned while editing Light');
  await click('dark');await hex('element.name','#23bc45');
  await color(dark.document,'darkpanel','#23bc45','Dark edits update the already visible Dark editor');
  await color(light.document,'lightpanel','#ef7654','Dark edits preserve Light editor');
  await click('undo');await color(dark.document,'darkpanel','#12ab34');
  assert.equal(dark.document.version,version);assert.ok(dark.selection.isEqual(pinnedSelection));
  await ui(workspace,{action:'screenshot',name:'scratchpads-pinned-dark-light'});
  await closePanel();assert.equal(dark.document.getText(),darkSource);
  await vscode.commands.executeCommand('hson.openAppearance');
  const reopened=await open('Document','dark');assert.equal(reopened.document,dark.document);assert.equal(reopened.document.getText(),darkSource);
  dark=reopened;
  await click('restore-example');await until(()=>dark.document.getText().includes('<h1 @:title')?true:undefined,'Restore Example');
  await vscode.window.showTextDocument(dark.document,vscode.ViewColumn.Two);await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');await vscode.commands.executeCommand('undo');
  await until(()=>dark.document.getText()===darkSource?true:undefined,'native undo of explicit Restore Example');
  // Formatting is source-preserving authoring, including QUAD association meaning.
  const edits=await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider',dark.document.uri,{insertSpaces:true,tabSize:2});
  assert.ok(edits?.length,'Document scratchpad uses authored formatter');
  const edit=new vscode.WorkspaceEdit();edit.set(dark.document.uri,edits);assert.ok(await vscode.workspace.applyEdit(edit));
  assert.deepEqual(parse_authored_document_library(dark.document.getText()),parse_authored_document_library(darkSource));
  const records=[];
  for(const mode of ['dark','light']) for(const example of ['Document','Data','Interpolation']) {
    const editor=await open(example,mode);
    if(example==='Data')await replace(editor,mode==='light'?'':`// Retained ${mode} Data\n<catalog <title "${mode} data" count 42>>\n`);
    if(example==='Data'&&mode==='dark')assert.ok(await editor.edit(edit=>edit.setEndOfLine(vscode.EndOfLine.CRLF)));
    if(example==='Interpolation')await replace(editor,'import { Hson } from "hson-live/hson";\nconst host = "'+mode+' TS retained";\nconst doc = Hson.document`<article @:title "'+mode+' embedded"/>`;\nconst data = Hson.data`<catalog <title "data" count 42>>`;\n');
    if(editor.document.getText())assert.deepEqual(await hsonErrors(editor.document),[]);
    records.push({example,mode,uri:editor.document.uri.toString(),text:editor.document.getText()});
  }
  const empty=await open('Data','light');assert.equal(empty.document.getText(),'','empty source is retained across mode/family navigation');
  await vscode.window.showTextDocument(empty.document,vscode.ViewColumn.Two);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  const emptyAgain=await open('Data','light');assert.equal(emptyAgain.document.getText(),'','closing an empty scratchpad never restores an example');
  await vscode.window.showTextDocument(emptyAgain.document,vscode.ViewColumn.Two);
  await replace(emptyAgain,'<catalog <title "temporary">>');
  await replace(emptyAgain,'');
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  assert.equal((await open('Data','light')).document.getText(),'','immediate authored clear and close');
  // Native teardown must not replace the last authored source (including empty).
  for(const example of ['Document','Data']) {
    let editor=await open(example,'dark');
    const original=editor.document.getText(),uri=editor.document.uri.toString();
    await closePanel();
    await vscode.window.showTextDocument(editor.document,vscode.ViewColumn.Two);
    for(let i=0;i<12;i++)await replace(editor,example==='Document'?`<rapid @:title "${i} 😀"/>`:`<catalog <title "${i} 😀">>`);
    await replace(editor,original);
    if(example==='Data') {
      const destination=join(workspace,'native-scratchpad-save.hson');
      const saving=vscode.workspace.saveAs(editor.document.uri);
      await ui(workspace,{action:'native-save-as',path:destination});
      assert.equal((await saving)?.fsPath,destination);
      assert.equal(await readFile(destination,'utf8'),original);
    } else await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('hson.openAppearance');editor=await open(example,'dark');
    assert.equal(editor.document.uri.toString(),uri);
    assert.equal(editor.document.getText(),original,'nonempty native lifecycle retains exact source');
  }
  // Ordinary files keep Native, and explicit modes affect diagnostics and family ownership.
  const path=join(workspace,'standalone.hson');await writeFile(path,'<ordinary @:title "Document"/>');
  const ordinary=await vscode.workspace.openTextDocument(path);await vscode.window.showTextDocument(ordinary,vscode.ViewColumn.Two);
  assert.equal((await hsonErrors(ordinary))[0]?.code,'HSON_ELEMENT_QUID_INVALID');
  await vscode.workspace.getConfiguration('hson.authoring',ordinary).update('mode','document',vscode.ConfigurationTarget.Workspace);
  assert.deepEqual(await hsonErrors(ordinary),[]);
  const native=await rendered(workspace,ordinary,'ordinary file retains Native assignment',[{needle:'ordinary'}]);
  await click('dark');await hex('element.name','#aa4455');
  await rendered(workspace,ordinary,'ordinary Native unaffected by palette preview',[{needle:'ordinary',expected:native[0]}]);
  await click('undo');
  const ordinaryEditor=await vscode.window.showTextDocument(ordinary,vscode.ViewColumn.Two);
  for(const [source,code] of [['<ordinary @:bad-name/>','HSON_LIBRARY_QUAD_INVALID'],['<ordinary @000000001/>','PORTABLE_RUNTIME_QUID_FORBIDDEN'],['<ordinary @:','HSON_CONTAINER_UNTERMINATED']]) {
    await replace(ordinaryEditor,source);assert.equal((await hsonErrors(ordinary))[0]?.code,code);
  }
  await replace(ordinaryEditor,'<ordinary @:title/>');
  await vscode.workspace.getConfiguration('hson.authoring',ordinary).update('mode','data',vscode.ConfigurationTarget.Workspace);
  assert.equal((await hsonErrors(ordinary))[0]?.code,'HSON_ELEMENT_QUID_INVALID');
  const doc=await open('Document','dark');assert.deepEqual(await hsonErrors(doc.document),[],'scratchpad family overrides workspace Data mode');
  await vscode.workspace.getConfiguration('hson.authoring',ordinary).update('mode','canonical',vscode.ConfigurationTarget.Workspace);
  // Resolve a retained palette dependency deliberately, without replacing House buffers.
  await input('name','Recovery destination');await click('new');await click('save');
  const recovery=(await ui<{values:Record<string,string>}>(workspace,{action:'inspect'})).values.target!;
  await input('name','Retained custom');await click('new');
  await click('open-scratchpad');
  assert.match((await ui<{error:string}>(workspace,{action:'inspect'})).error,/Save this palette/);
  assert.ok(!vscode.workspace.textDocuments.some(document=>document.fileName.includes('Retained custom')));
  await click('save');
  const custom=(await ui<{values:Record<string,string>}>(workspace,{action:'inspect'})).values.target!;
  let retained=await open('Document','dark',custom,'Retained custom');
  const retainedSource='<retained @:title "Palette recovery 😀"/>';
  await replace(retained,retainedSource);
  await input('name','Renamed custom');await click('rename');await click('save');
  await click('open-scratchpad');assert.equal(retained.document.getText(),retainedSource);
  await vscode.window.showTextDocument(retained.document,vscode.ViewColumn.Two);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  await click('delete');
  const blocked=await ui<{error:string}>(workspace,{action:'inspect'});assert.match(blocked.error,/Document dark.*Move Scratchpads/);
  await click('open-scratchpad');
  retained=vscode.window.visibleTextEditors.find(e=>e.document.uri.toString()===retained.document.uri.toString())!;
  assert.equal(retained.document.getText(),retainedSource);
  await click('move-scratchpads');await ui(workspace,{action:'native-pick',label:'Recovery destination'});await pause();
  await click('delete');await click('save');
  await input('target',recovery);await click('open-scratchpad');
  assert.equal(retained.document.getText(),retainedSource);
  await writeFile(join(workspace,'palette-recovery.json'),JSON.stringify({target:recovery,uri:retained.document.uri.toString(),text:retainedSource}));
  // Workspace assignment previews remain available explicitly in Overrides.
  const mixed=await open('Interpolation','dark','override:all','all overrides');
  await input('all','house');await input('data','native');await input('target','override:data');await hex('value.string','#ab34cd');
  await color(mixed.document,'Data text','#ab34cd','family-specific Data override');
  const docColor=await rendered(workspace,mixed.document,'Document family baseline',[{needle:'Content text',length:12}]);
  await input('inherits','native');
  await rendered(workspace,mixed.document,'explicit Native retains Document family',[{needle:'Content text',length:12,expected:docColor[0]}]);
  const nativeData=await rendered(workspace,mixed.document,'Data Native property',[{needle:'Data text'}]);assert.notEqual(nativeData[0],rgb('#ab34cd'));
  // Save only after proving the unsaved preview path; ordinary assignments remain Native.
  await input('all','native');await input('data','');await input('target','palette:house');await click('save');
  assert.equal(readAppearance(vscode.workspace.getConfiguration('hson.appearance').get('state')).assignments.all,'native');
  await input('name','External retention');await click('new');await click('save');
  const externalTarget=(await ui<{values:Record<string,string>}>(workspace,{action:'inspect'})).values.target!;
  const external=await open('Document','dark',externalTarget,'External retention');
  const externalText='<external @:title "Source retained after settings replacement 😀"/>';
  await replace(external,externalText);
  await vscode.window.showTextDocument(external.document,vscode.ViewColumn.Two);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  const configuration=vscode.workspace.getConfiguration('hson.appearance');
  const replacement=readAppearance(configuration.get('state'));
  replacement.palettes=replacement.palettes.filter(palette=>'palette:'+palette.id!==externalTarget);
  await configuration.update('state',replacement,vscode.ConfigurationTarget.Global);
  await vscode.commands.getCommands(true);
  // Revert must preserve the referenced local palette until movement resolves it.
  await ui(workspace,{action:'click',control:'revert'});await ui(workspace,{action:'confirm-revert'});
  const conflict=await ui<{error:string;targets:{value:string}[]}>(workspace,{action:'inspect'});
  assert.match(conflict.error,/Retained scratchpads/);assert.ok(conflict.targets.some(target=>target.value===externalTarget));
  await click('open-scratchpad');
  const reachable=await until(()=>vscode.window.visibleTextEditors.find(editor=>editor.document.uri.toString()===external.document.uri.toString()),'source after external palette removal');
  assert.equal(reachable.document.getText(),externalText);
  await writeFile(join(workspace,'missing-palette.json'),JSON.stringify({target:externalTarget,uri:reachable.document.uri.toString(),text:externalText}));
  await writeFile(savedFile,JSON.stringify(records,null,2));
  await writeFile(join(workspace,'scratchpad-report.json'),JSON.stringify({vscodeVersion:vscode.version,pickerEvents:events,records:records.map(({text,...record})=>({...record,characters:text.length})),tests:['native delayed-write failures and restart recovery','unsaved creation and external palette recovery','nonempty native close and Save As','immediate intentional empty and close','rapid edits with panel closed','palette dependency, reassignment, deletion and rename','trusted hex','native picker','inheritance','Undo/Redo','Working/Last Saved','pinned coexisting modes','source, selection, scroll and native undo','panel closure and reopen','explicit Restore Example','authored QUAD formatting','standalone explicit Document/Data/canonical diagnostics','Native and family ownership']},null,2));
  console.log('ok - rendered GUI-to-renderer scratchpad lifecycle, pinned modes, authoring and persistence capture');
  return restart('extension-restart','workbench.action.restartExtensionHost');
}
