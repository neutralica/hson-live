import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {AppearanceScratchpads} from '../../src/scratchpads.js';
import {ui} from './appearance.js';
import {HsonAppearanceEditor} from '../../src/appearance-editor.js';
import {HsonBindingCache} from '../../src/binding-intelligence.js';
import {load_hson_grammar} from '../../src/highlighting.js';
const key = 'hson.appearance.scratchpads.v1';
const before = '<durability @:title "Durable before 😀 é"/>\r\n';
const after = '<durability @:title "Latest accepted 😀 é"/>\r\n';
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function replace(editor: vscode.TextEditor, text: string) {
  assert.ok(await editor.edit(edit => edit.replace(new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length)), text)));
}
/** Real native events with controlled Memento failures; no event simulation or timing waits. */
export async function checkNativeDurability(workspace: string, storage: vscode.Memento, resumed: boolean): Promise<void> {
  if (resumed) {
    const pads = new AppearanceScratchpads(storage);
    await pads.flush(); // Includes hot-exit source acknowledgement and its durable write.
    const editor = await pads.open('Document', 'palette:durability-destination', 'dark', 'Durability');
    assert.equal(editor.document.getText(), after, 'native hot exit recovers edits after unresolved move failure');
    assert.equal(storage.get<any[]>(key)![0]!.text, after);
    assert.equal(pads.context(editor.document)!.target, 'palette:durability-destination');
    const empty=await pads.open('Document','palette:durability-destination','light','Durability empty');
    assert.equal(empty.document.getText(),'','intentional empty survives failed write and host restart');
    assert.equal(storage.get<any[]>(key)![1]!.text,'');
    const proof = JSON.parse(await readFile(join(workspace, 'native-durability.json'), 'utf8'));
    assert.equal(editor.document.uri.toString(), proof.restartUri);
    proof.restarts++; await writeFile(join(workspace, 'native-durability.json'), JSON.stringify(proof, null, 2));
    pads.dispose(); return;
  }
  const results = [];
  const placeholderUri = vscode.Uri.from({scheme:'untitled',path:'/Hson startup placeholder.hson'});
  await storage.update(key,[{example:'Document',family:'document',mode:'dark',target:'palette:house',uri:placeholderUri.toString(),text:before}]);
  const placeholder = await vscode.workspace.openTextDocument(placeholderUri);
  assert.equal(placeholder.getText(),'');
  const startup = new AppearanceScratchpads(storage);
  await startup.flush(); assert.equal(storage.get<any[]>(key)![0]!.text,before);
  const restoredPlaceholder = await startup.open('Document','palette:house','dark','House');
  assert.equal(restoredPlaceholder.document,placeholder); assert.equal(placeholder.getText(),before);
  await vscode.window.showTextDocument(placeholder,vscode.ViewColumn.Two);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor'); await startup.flush(); startup.dispose();

  // Exact original defect: allow native LF/empty writes, reject only the
  // corrective write. The repaired checkpoint must issue none of those writes.
  const correctionUri=vscode.Uri.from({scheme:'untitled',path:'Hson corrective failure.hson'}).toString();
  await storage.update(key,[{example:'Document',family:'document',mode:'dark',target:'palette:house',uri:correctionUri,text:before}]);
  const correctionWrites:string[]=[];
  const rejectCorrection:vscode.Memento={keys:()=>storage.keys(),get:storage.get.bind(storage),update:async(key,value)=>{
    correctionWrites.push(value[0].text);
    if(storage.get<any[]>(key)![0]!.text===''&&value[0].text===before)throw new Error('injected corrective write failure');
    await storage.update(key,value);
  }};
  const correction=new AppearanceScratchpads(rejectCorrection);
  const original=await correction.open('Document','palette:house','dark','House');
  await vscode.window.showTextDocument(original.document,vscode.ViewColumn.Two);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');await correction.flush();correction.dispose();
  assert.deepEqual(correctionWrites,[]);assert.equal(storage.get<any[]>(key)![0]!.text,before);
  const correctionRestart=new AppearanceScratchpads(storage),retained=await correctionRestart.open('Document','palette:house','dark','House');
  assert.equal(retained.document.getText(),before);
  await vscode.window.showTextDocument(retained.document,vscode.ViewColumn.Two);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');await correctionRestart.flush();correctionRestart.dispose();
  results.push({operation:'original corrective-write rejection',precedingDurableSource:before,acceptedSource:before,writes:correctionWrites,recovered:true});
  for (const operation of ['close', 'save-as'] as const) {
    const uri = vscode.Uri.from({scheme: 'untitled', path: `Hson Durability ${operation}.hson`}).toString();
    await storage.update(key, [{example: 'Document', family: 'document', mode: 'dark', target: 'palette:house', uri, text: before}]);
    let armed = false;
    const started = deferred(), gate = deferred(), recoveryStarted = deferred(), writes: string[] = [];
    const failing: vscode.Memento = {keys: () => storage.keys(), get: storage.get.bind(storage), update: async (key, value) => {
      writes.push(value[0].text);
      if (armed) { started.resolve(); await gate.promise; }
      else recoveryStarted.resolve();
      await storage.update(key, value);
    }};
    const pads = new AppearanceScratchpads(failing);
    const editor = await pads.open('Document', 'palette:house', 'dark', 'House');
    await vscode.window.showTextDocument(editor.document, vscode.ViewColumn.Two);
    const controller = new HsonAppearanceEditor('', load_hson_grammar(vscode.extensions.getExtension('terminal-gothic.hson-language')!.extensionPath), new HsonBindingCache(), pads);
    await controller.open();
    await vscode.window.showTextDocument(editor.document,vscode.ViewColumn.Two);
    armed = true; await replace(editor, after); await started.promise;
    if (operation === 'close') await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    else {
      const path = join(workspace, 'durability-save-as.hson'), saving = vscode.workspace.saveAs(editor.document.uri);
      await ui(workspace, {action: 'native-save-as', path});
      assert.equal((await saving)?.fsPath, path); assert.equal(await readFile(path, 'utf8'), after);
    }
    assert.ok(editor.document.isClosed);
    const flushed = pads.flush(); gate.reject(new Error('injected pending authored write failure'));
    await assert.rejects(flushed, /injected pending/);
    assert.deepEqual(writes, [after], 'neither CRLF reset nor empty teardown is ever written');
    assert.equal(storage.get<any[]>(key)![0]!.text, before, 'preceding durable authored source survives');
    assert.equal(Reflect.get(pads.context(editor.document)!, 'text'), after, 'latest accepted source remains in memory');
    armed = false;
    const reopened = await pads.open('Document', 'palette:house', 'dark', 'House');
    assert.equal(reopened.document.getText(), after, 'failed write does not erase same-runtime recovery');
    let status='';
    for(let attempt=0;attempt<50&&status!=='Scratchpad save failed';attempt++) status=(await ui<{status:string}>(workspace,{action:'inspect'})).status;
    assert.equal(status,'Scratchpad save failed');
    await ui(workspace, {action: 'key-activate', control: 'retry-scratchpads'});
    await recoveryStarted.promise; await pads.flush();
    assert.equal(storage.get<any[]>(key)![0]!.text, after); controller.dispose();
    await vscode.window.showTextDocument(reopened.document, vscode.ViewColumn.Two);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor'); await pads.flush(); pads.dispose();
    const fresh = new AppearanceScratchpads(storage), recovered = await fresh.open('Document', 'palette:house', 'dark', 'House');
    assert.equal(recovered.document.getText(), after);
    await vscode.window.showTextDocument(recovered.document, vscode.ViewColumn.Two);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor'); await fresh.flush(); fresh.dispose();
    results.push({operation, precedingDurableSource: before, acceptedSource: after, writes, recovered: true});
  }
  // Persist an ambiguous move result, reject its subsequent writes and leave the
  // native editor open. A genuine host/window restart must recover its newer source.
  const uri = vscode.Uri.from({scheme: 'untitled', path: 'Durability unresolved move.hson'}).toString();
  const emptyUri=vscode.Uri.from({scheme:'untitled',path:'Durability unresolved empty.hson'}).toString();
  await storage.update(key, [
    {example: 'Document', family: 'document', mode: 'dark', target: 'palette:durability-source', uri, text: before},
    {example: 'Document', family: 'document', mode: 'light', target: 'palette:durability-source', uri:emptyUri, text: before},
  ]);
  const started = deferred(), gate = deferred(); let writes = 0;
  const failing: vscode.Memento = {keys: () => storage.keys(), get: storage.get.bind(storage), update: async (key, value) => {
    if (++writes === 1) { started.resolve(); await gate.promise; await storage.update(key, value); }
    throw new Error('injected ambiguous move/rollback failure');
  }};
  const pads = new AppearanceScratchpads(failing), editor = await pads.open('Document', 'palette:durability-source', 'dark', 'Durability');
  const empty=await pads.open('Document','palette:durability-source','light','Durability empty');
  const moving = pads.reassign('palette:durability-source', 'palette:durability-destination').then(() => undefined, error => error);
  await started.promise;
  await replace(await vscode.window.showTextDocument(editor.document,vscode.ViewColumn.Two),after);
  await replace(await vscode.window.showTextDocument(empty.document,vscode.ViewColumn.Two),'');
  await vscode.commands.getCommands(true); gate.resolve();
  assert.match(String(await moving), /recovery is pending/);
  for (const target of ['palette:durability-source', 'palette:durability-destination']) assert.ok(pads.references(target).length);
  assert.equal(storage.get<any[]>(key)![0]!.text, before); assert.equal(storage.get<any[]>(key)![0]!.target, 'palette:durability-destination');
  assert.equal(editor.document.getText(), after);
  // The native buffer remains open for the real restarts performed by the suite.
  pads.dispose();
  await writeFile(join(workspace, 'native-durability.json'), JSON.stringify({results, unresolvedMove: true, restartUri: uri, restarts: 0}, null, 2));
}
