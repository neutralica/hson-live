import { randomUUID } from 'node:crypto';
import { roleCatalog, styleProperties } from './appearance-model.js';

/** A compact control surface; all validation and appearance state live in the extension. */
export function appearanceHtml(): string {
  const nonce = randomUUID();
  const roles = Object.entries(roleCatalog).map(([id, role]) => ({id, label: role.label, example: role.examples[0]}));
  return `<!doctype html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font:13px var(--vscode-font-family);padding:12px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}
label{display:block;margin:9px 0 3px}input,select,button{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);padding:5px;max-width:100%;box-sizing:border-box}select,input[type=text]{width:100%}button{cursor:pointer;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}button:disabled{opacity:.5;cursor:default}button[aria-pressed=true]{outline:2px solid var(--vscode-focusBorder)}.row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.row>*{flex:1;min-width:60px}.row input{min-width:100px}.property{margin:12px 0;border-top:1px solid var(--vscode-panel-border);padding-top:4px}.source{display:block;opacity:.8;font-size:12px;margin:4px 0;overflow-wrap:anywhere}#error{color:var(--vscode-errorForeground)}code{white-space:pre-wrap}h1{font-size:18px}h2{font-size:14px;margin-top:20px}
</style></head><body>
<h1>Hson Appearance</h1><p id="status" aria-live="polite">Loading…</p>
<div class="row"><button id="saved" aria-pressed="false">Saved</button><button id="draft" aria-pressed="true">Draft</button><button id="revert">Revert Draft</button></div>
<div class="row"><button id="Document">Document</button><button id="Data">Data</button><button id="Interpolation">Mixed TypeScript</button></div>
<h2>Palette assignments</h2><label for="all">All Hson</label><select id="all"></select><label for="data">Data / Declarative</label><select id="data"></select><label for="document">Document / Part</label><select id="document"></select>
<h2>Edit appearance</h2><label for="target">Edit target</label><select id="target"></select>
<label for="name">Palette name</label><input id="name" type="text" placeholder="Name for new, duplicate or rename">
<div class="row"><button id="new">Create</button><button id="duplicate">Duplicate</button><button id="rename">Rename</button><button id="delete">Delete</button></div>
<p id="protected"></p><label for="role">Syntax role</label><select id="role"></select><code id="example"></code>
<label for="mode">Appearance mode</label><select id="mode"><option value="dark">Dark</option><option value="light">Light</option></select><small id="previewMode"></small>
<label for="inherits">Inherit missing properties from role</label><select id="inherits"></select>
<div id="properties"></div>
<label for="destination">Save destination</label><select id="destination"><option value="user">User settings</option><option value="workspace">Workspace settings</option></select>
<div class="row"><button id="save">Save</button><button id="export">Export palette to source…</button></div><p id="error" role="alert"></p>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi(), roles=${JSON.stringify(roles)}, properties=${JSON.stringify(styleProperties)};
const el=id=>document.getElementById(id), send=(type,value,extra={})=>vscode.postMessage({type,value,...extra});
let state;
function options(id,items,value){const node=el(id);const signature=JSON.stringify(items);if(node.dataset.options!==signature){node.replaceChildren(...items.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));node.dataset.options=signature;}node.value=value??'';}
options('role',roles.map(r=>[r.id,r.label]),'');options('inherits',[['','Catalog fallback / Native'],...roles.map(r=>[r.id,r.label])],'');
for(const property of properties){
 const box=document.createElement('div');box.className='property';const label=document.createElement('label');label.htmlFor=property;label.textContent=property;
 const input=document.createElement(['bold','italic','underline','strikethrough'].includes(property)?'select':'input');input.id=property;
 if(input.tagName==='SELECT'){for(const [value,text]of [['','Inherit'],['true','On'],['false','Off'],['native','Native']]){const o=document.createElement('option');o.value=value;o.textContent=text;input.append(o);}}
 else{input.type='text';input.placeholder=property==='foreground'?'#RRGGBB or native':property==='intensity'?'0 to 1 or native':'bold italic underline, or native';}
 const row=document.createElement('div');row.className='row';row.append(input);
 if(property==='foreground'){const picker=document.createElement('input');picker.type='color';picker.id='colorPicker';picker.title='Choose foreground';picker.addEventListener('input',()=>send('property',picker.value,{property}));row.append(picker);}
 const reset=document.createElement('button');reset.id='reset-'+property;reset.textContent='Reset';reset.addEventListener('click',()=>send('property',null,{property}));row.append(reset);
 const info=document.createElement('small');info.id='source-'+property;info.className='source';box.append(label,row,info);el('properties').append(box);
 input.addEventListener('input',()=>{let value=input.value;if(value==='')value=null;else if(property==='intensity'&&value!=='native')value=Number(value);else if(input.tagName==='SELECT'&&value!=='native')value=value==='true';send('property',value,{property});});
}
for(const id of ['role','target','mode','destination'])el(id).addEventListener('input',()=>send(id,el(id).value));
for(const family of ['all','data','document'])el(family).addEventListener('input',()=>send('assign',el(family).value,{family}));
el('inherits').addEventListener('input',()=>send('inherit',el('inherits').value));
for(const id of ['saved','draft'])el(id).addEventListener('click',()=>send('compare',id));
for(const id of ['revert','delete','save','export'])el(id).addEventListener('click',()=>send(id));
for(const id of ['Document','Data','Interpolation'])el(id).addEventListener('click',()=>send('example',id));
for(const id of ['new','duplicate'])el(id).addEventListener('click',()=>send(id,undefined,{name:el('name').value}));
el('rename').addEventListener('click',()=>send('rename',el('name').value));
window.addEventListener('message',event=>{const s=event.data;if(s.type!=='state')return;state=s;
 const palettes=[['native','Native VS Code'],['house','House'],...s.draft.palettes.map(p=>[p.id,p.name])];
 for(const family of ['all','data','document'])options(family,family==='all'?palettes:[['','Inherit All Hson'],...palettes],s.draft.assignments[family]);
 options('target',[...palettes.filter(p=>p[0]!=='native').map(([id,name])=>['palette:'+id,'Palette · '+name]),['override:all','Overrides · All Hson'],['override:data','Overrides · Data / Declarative'],['override:document','Overrides · Document / Part']],s.target);
 el('role').value=s.role;el('mode').value=s.mode;el('destination').value=s.destination;el('inherits').value=s.inherits;el('inherits').disabled=s.readonly;
 const example=roles.find(r=>r.id===s.role)?.example;el('example').textContent=example?example.code:'';
 el('previewMode').textContent='Native editor currently uses '+s.previewMode+' mode.';
 el('protected').textContent=s.readonly?'House is built in. Duplicate it to edit.':s.target.startsWith('override:')?'Sparse overrides: Reset inherits from lower layers. Native explicitly delegates to VS Code.':'Editing this palette changes every assignment that selects it.';
 for(const property of properties){const node=el(property);if(document.activeElement!==node)node.value=s.authored[property]??'';node.disabled=s.readonly;el('reset-'+property).disabled=s.readonly;el('source-'+property).textContent=(s.nativeOwned?'Native bracket coloring owns this role. Configured: ':'Effective: ')+(s.resolved.style[property]??'Native')+' · '+s.resolved.sources[property];}
 el('colorPicker').disabled=s.readonly;const color=s.authored.foreground;if(/^#[a-f0-9]{6}$/i.test(color))el('colorPicker').value=color;
 el('rename').disabled=el('delete').disabled=s.readonly||!s.target.startsWith('palette:');el('duplicate').disabled=el('export').disabled=!s.target.startsWith('palette:');
 el('saved').setAttribute('aria-pressed',String(s.comparison==='saved'));el('draft').setAttribute('aria-pressed',String(s.comparison==='draft'));
 el('status').textContent=(s.comparison==='saved'?'Saved':'Draft')+' preview · '+(s.dirty?'Unsaved changes':'Saved state');el('save').disabled=!s.dirty;el('error').textContent=s.error;
});send('ready');
</script></body></html>`;
}
