import { randomUUID } from 'node:crypto';
import { roleCatalog, styleProperties } from './appearance-model.js';

/** Panel-local layout. Role meaning, authored values and resolution stay in the shared model. */
export function appearanceHtml(): string {
  const nonce = randomUUID();
  const roles = Object.entries(roleCatalog).map(([id, role]) => ({
    id, label: role.label, group: id.split('.')[0], example: role.examples[0],
  }));
  const data = JSON.stringify(roles).replaceAll('<', '\\u003c');
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:12px var(--vscode-font-family)}
button,input,select,summary{font:inherit}button,input,select{min-width:0;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid transparent;border-radius:0;height:26px;padding:3px 5px}button{cursor:pointer;color:var(--vscode-foreground);background:transparent;white-space:nowrap}button:hover,summary:hover{background:var(--vscode-toolbar-hoverBackground)}button:disabled,input:disabled,select:disabled{opacity:.48;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}input,select{border-color:var(--vscode-input-border,transparent)}input[type=text]{font-family:var(--vscode-editor-font-family,monospace)}button[aria-pressed=true]{border-bottom-color:var(--vscode-focusBorder);background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.workbench{height:100vh;display:flex;flex-direction:column;min-width:0}header{flex:none;padding:8px 10px 6px;border-bottom:1px solid var(--vscode-panel-border)}.line{display:flex;gap:5px;align-items:center;min-width:0}.line+.line{margin-top:5px}.grow{flex:1;min-width:0}.brand{font:600 13px var(--vscode-editor-font-family,monospace);letter-spacing:-.5px}.dim,.hint{color:var(--vscode-descriptionForeground)}.eyebrow{font:10px var(--vscode-editor-font-family,monospace);text-transform:uppercase;letter-spacing:.09em}.segment{display:inline-flex;gap:1px}.segment button{font-size:11px;height:24px}.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}#target{width:100%;font-weight:600}#status{margin:0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#destination{width:90px;font-size:11px;height:24px;flex-shrink:0}.save-label{font-size:11px;white-space:nowrap}.dirty::before{content:'● ';color:var(--vscode-foreground)}#scope-note{font-size:11px;margin:6px 0 0;min-height:15px}.setup{flex:none;max-height:38vh;overflow:auto;padding:0 10px;border-bottom:1px solid var(--vscode-panel-border)}summary{cursor:pointer;padding:6px 0;list-style:none;display:flex;gap:7px;align-items:center}summary::before{content:'›';font-family:monospace}details[open]>summary::before{content:'⌄'}summary>.dim{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}summary .grow{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}details .content{padding:0 0 8px}.assignment{display:grid;grid-template-columns:90px minmax(0,1fr);gap:6px;align-items:center;margin-top:4px}.assignment label{font-size:11px}.assignment select{width:100%}#name{width:100%}.actions{display:flex;flex-wrap:wrap;gap:3px;margin-top:5px}.actions button{border:1px solid var(--vscode-panel-border);font-size:11px}.hint{font-size:11px;line-height:1.45;margin:5px 0}.danger{color:var(--vscode-errorForeground)}
.toolbar{padding:6px 10px;flex:none;border-bottom:1px solid var(--vscode-panel-border)}.examples{display:flex;align-items:center;gap:3px}.examples .eyebrow{margin-right:auto}.examples button{font-size:11px;padding:3px 6px}.search{margin-top:5px;display:flex;gap:6px}.search input{width:100%}.catalog{flex:1;min-height:120px;overflow:auto;scrollbar-gutter:stable;padding:0 10px 10px;overscroll-behavior:contain}.group-heading{display:flex;align-items:center;gap:7px;margin:0;padding:12px 0 5px;color:var(--vscode-descriptionForeground);font-size:10px;font-weight:400;letter-spacing:.1em;text-transform:uppercase}.group-heading::after{content:'';height:1px;background:var(--vscode-panel-border);flex:1}.role-row{display:grid;grid-template-columns:22px minmax(70px,1.4fr) 68px 58px minmax(48px,1fr) 20px;gap:4px;align-items:center;min-height:28px;border-bottom:1px solid var(--vscode-panel-border)}.role-row.selected{box-shadow:inset 2px 0 var(--vscode-focusBorder);padding-left:4px}.role-label{text-align:left;height:auto;white-space:normal;line-height:15px;padding:3px 0}.role-row.changed .role-label strong::before{content:'• ';}.role-label strong{font-weight:400;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.role-label{overflow:hidden}.inherit-check{display:flex;align-items:center;gap:2px;font-size:11px;white-space:nowrap}.inherit-check input{width:13px;height:16px;margin:0}.from{width:100%;font-size:11px;padding:2px}.hex[aria-invalid=true],.from[aria-invalid=true],.property input[aria-invalid=true]{outline:1px solid var(--vscode-inputValidation-errorBorder,var(--vscode-errorForeground))}.origin{font-size:10px;color:var(--vscode-descriptionForeground);display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;max-width:100%}.hex{width:100%;font-size:11px;padding:3px}.reset{padding:2px;font-size:16px}.swatch{position:relative;width:22px;height:22px;border:1px solid var(--vscode-descriptionForeground);background:var(--swatch,transparent);overflow:hidden}.swatch.native{background:repeating-linear-gradient(135deg,transparent,transparent 3px,var(--vscode-panel-border) 3px,var(--vscode-panel-border) 5px)}.swatch input{opacity:0;position:absolute;inset:0;width:100%;height:100%;padding:0;cursor:pointer}.swatch:focus-within{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}.swatch span{font:10px var(--vscode-editor-font-family,monospace);display:grid;place-items:center;height:100%;color:var(--vscode-foreground)}
.inspector{padding:8px 0 10px 9px;border-left:2px solid var(--vscode-focusBorder);border-bottom:1px solid var(--vscode-panel-border)}.inspector[hidden],[hidden]{display:none!important}.inspector code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 var(--vscode-editor-font-family,monospace);margin-bottom:6px}.inspector mark{background:var(--vscode-editor-selectionBackground);color:inherit;border-bottom:1px solid var(--vscode-focusBorder)}.property{margin-top:5px}.property-line{display:grid;grid-template-columns:72px minmax(0,1fr) 22px;gap:4px;align-items:center}.property-line label{font-size:11px}.property-line input,.property-line select{width:100%;font-size:11px}.source{font-size:10px;line-height:1.4;color:var(--vscode-descriptionForeground);display:block;margin:2px 0 0 76px;overflow-wrap:anywhere}.inherit-line{display:grid;grid-template-columns:72px minmax(0,1fr);gap:4px;align-items:center;font-size:11px}.inherit-line select{width:100%;font-size:11px}.inspector summary{font-size:11px;padding-bottom:0}footer button{font:inherit;height:16px;padding:0 3px}footer{flex-wrap:wrap;align-items:center;flex:none;padding:5px 10px;border-top:1px solid var(--vscode-panel-border);font-size:10px;color:var(--vscode-descriptionForeground);display:flex;gap:8px;justify-content:space-between}#error:empty{display:none}#error{flex:none;max-height:85px;overflow:auto;margin:0;padding:6px 10px;color:var(--vscode-errorForeground);border-bottom:1px solid var(--vscode-panel-border)}#empty{padding:16px 0;color:var(--vscode-descriptionForeground)}
@media(max-width:360px){.role-row{grid-template-columns:22px minmax(0,1fr) 68px 20px;gap:0 4px;padding:1px 0}.role-row .reset{grid-column:4;grid-row:1}.inherit-check{grid-column:2;grid-row:2}.from{grid-column:3 / 5;grid-row:2;height:20px}.role-label{grid-column:2}.line{flex-wrap:wrap}.examples{flex-wrap:wrap}.examples button{padding:2px 4px}.examples .eyebrow{flex-basis:100%}.scope-line{flex-wrap:wrap}.compare-label{display:none}.save-line{display:grid;grid-template-columns:1fr auto auto auto}.save-line>.segment{grid-column:1 / 3}.save-line>#status{grid-column:3 / 5}.save-line>#undo{grid-row:2;grid-column:2}.save-line>#redo{grid-row:2;grid-column:3}.save-line>#save{grid-row:2;grid-column:4}}
@media(max-width:260px){header,.toolbar{padding-left:6px;padding-right:6px}.setup,.catalog{padding-left:6px;padding-right:6px}.assignment{grid-template-columns:70px minmax(0,1fr)}}
.scope-line{display:flex;align-items:center;gap:4px}.scope-line p{flex:1}.scope-line button{font-size:11px;border:1px solid var(--vscode-panel-border)}#preview-state{font-size:11px}.group-heading{padding-top:8px;padding-bottom:3px}#revert{font-size:11px}#target{appearance:auto;border-color:var(--vscode-dropdown-border,var(--vscode-panel-border));background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground)}
dialog{color:var(--vscode-foreground);background:var(--vscode-editor-background);border:1px solid var(--vscode-focusBorder);max-width:calc(100% - 24px);padding:12px}dialog::backdrop{background:#0008}
.scratchpad-actions button{font-size:11px;height:24px;border:1px solid var(--vscode-panel-border)}
.scratchpad-actions .hint{margin:0;white-space:nowrap}
</style></head><body><main class="workbench">
<header>
 <div class="line"><span class="brand" aria-label="Hson">&lt;hson/&gt;</span><select class="grow" id="target" aria-label="Palette or override selector"></select></div>
 <div class="line save-line"><div class="segment" aria-label="Palette mode"><button id="dark" aria-pressed="true">Dark</button><button id="light" aria-pressed="false">Light</button></div><p id="status" class="grow dim" aria-live="polite">Loading…</p><button id="undo" title="Undo appearance change">Undo</button><button id="redo" title="Redo appearance change">Redo</button><button class="primary" id="save">Save</button></div>
 <div class="line"><span class="dim save-label compare-label">Compare</span><div class="segment" aria-label="Scratchpad comparison"><button id="draft" aria-pressed="true">Working</button><button id="saved" aria-pressed="false">Last saved</button></div><span class="grow"></span><select id="destination" aria-label="Save destination" title="Save to"><option value="user">User</option><option value="workspace">Workspace</option></select></div>
 <div class="scope-line"><p id="scope-note" class="dim"></p><button id="apply" title="Use this palette for All Hson; keep explicit Data and Document assignments">Apply to Hson</button></div>
 <div class="line scratchpad-actions"><button id="open-scratchpad" title="Open the selected family with this palette and mode pinned. Workspace assignments are unchanged.">Open Scratchpad</button><button id="restore-example" title="Replace the selected scratchpad source with its example. Native Undo is available.">Restore Example</button><span id="preview-state" class="hint"></span></div>
</header>
<p id="error" role="alert"></p><button id="discard-input" hidden>Discard pending input</button><button id="retry-scratchpads" hidden>Retry Scratchpad Save</button>
<div class="setup">
 <details id="assignments"><summary id="assignments-toggle"><span class="eyebrow">Applies</span><span id="assignment-summary" class="grow dim"></span></summary><div class="content">
  <div class="assignment"><label for="all">All Hson</label><select id="all"></select></div><div class="assignment"><label for="data">Data / Declarative</label><select id="data"></select></div><div class="assignment"><label for="document">Document / Part</label><select id="document"></select></div>
  <p class="hint">Inherit uses All. Native delegates to VS Code.</p></div></details>
 <details id="management"><summary id="management-toggle"><span class="eyebrow">Palettes</span><span class="dim">create · duplicate · rename · export</span></summary><div class="content">
  <input id="name" class="grow" type="text" aria-label="Name for palette actions" placeholder="Name for Create, Duplicate or Rename">
  <div class="actions"><button id="new">Create</button><button id="duplicate">Duplicate</button><button id="rename">Rename</button><button id="delete">Delete</button><button id="move-scratchpads" title="Move all retained Document, Data and TS scratchpads in both modes to another palette without replacing existing buffers">Move Scratchpads</button><button id="export">Export to source…</button><button id="restore">Restore shipped palette</button><button id="revert">Revert All…</button></div>
  <p class="hint">Delete requires reassignment first. Export opens JSON for review and Save As. Restore loads the shipped baseline into Working; Save persists it.</p></div></details>
</div>
<div class="toolbar"><div class="examples" aria-label="Scratchpad authoring family"><button id="Document" aria-pressed="true">Hson Document</button><button id="Data" aria-pressed="false">Hson Data</button><button id="Interpolation" aria-pressed="false" title="Editable Data and Document regions. TypeScript uses the window theme and workspace types.">Embedded TS / Hson</button></div><div class="search"><input id="filter" type="search" placeholder="Find a syntax role…" aria-label="Filter syntax roles"></div></div>
<div id="catalog" class="catalog" aria-label="Syntax role catalog"><p id="empty" hidden>No matching roles.</p></div>
<footer><span id="count"></span><button id="advanced" aria-expanded="false">Advanced</button><span id="previewMode"></span></footer>
</main>
<dialog id="revert-dialog" aria-labelledby="revert-question"><p id="revert-question">Discard all unsaved appearance changes?</p><div class="actions"><button id="cancel-revert" autofocus>Cancel</button><button id="confirm-revert">Revert All</button></div></dialog>
<div id="inspector" class="inspector" hidden>
 <strong class="eyebrow">Advanced</strong><code id="example"></code><span id="effective" class="hint"></span>
 <p class="hint">Role links supply all unauthored properties in both modes. VS Code delegates only the selected color. Reset restores the last saved property.</p>
 <div id="properties"></div>
 <p id="native-decoration-note" class="hint" hidden>VS Code applies underline and strikethrough together. An authored line can replace a Native line.</p>
 <details><summary>Source / resolution</summary><p id="resolution" class="hint"></p></details>
</div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi(), roles=${data}, properties=${JSON.stringify(styleProperties)};
const el=id=>document.getElementById(id), send=(type,value,extra={})=>vscode.postMessage({type,value,...extra});
let state, expanded, selected, groupSequence=0, inputSequence=0;
const editGroups=new Map();
function fieldScope(role=state.role){return {role,target:state.target,mode:state.mode};}
function gestureFor(input,role,property){
 if(!editGroups.has(input)){
  const gesture={...fieldScope(role),property,inputRevision:state.inputRevision,editGroup:String(++groupSequence)};
  editGroups.set(input,gesture);send('begin-edit',undefined,gesture);
 }
 return editGroups.get(input);
}
function endEdit(input){
 const gesture=editGroups.get(input);
 if(!gesture)return;
 editGroups.delete(input);send('end-edit',undefined,{editGroup:gesture.editGroup});
}
function endOtherEdits(input){for(const other of editGroups.keys())if(other!==input)endEdit(other);}
const rows=new Map(),groups=new Map();
const awaitingInput=new Map();
const rejectedFor=(role,property,kind='property')=>state?.rejectedInputs.find(input=>input.role===role&&input.property===property&&input.kind===kind);
function updateActions(){
 const unresolved=awaitingInput.size>0||!!state?.rejectedInputs.length||!!state?.appearanceError;
 el('save').disabled=!state?.dirty||!!state.saving||!!state.configurationInvalid||!!state.conflict||unresolved;
 el('export').disabled=!state?.target.startsWith('palette:')||unresolved;
 el('undo').disabled=!state?.canUndo&&!unresolved;el('redo').disabled=!state?.canRedo;
 el('revert').disabled=!(state?.dirty||state?.canUndo||state?.canRedo||state?.conflict||unresolved)||!!state.saving||!!state.configurationInvalid;
}
function sendField(input,value,property,role){
 if(!state)return;
 const scope=input.type==='color'?editGroups.get(input):input.type==='text'?gestureFor(input,role,property):fieldScope(role);
 // A late native dialog event after explicit navigation is not a new edit.
 if(!scope)return;
 const sequence=++inputSequence;awaitingInput.set(input,sequence);updateActions();
 send('property',value,{...scope,property,text:input.value,inputSequence:sequence});
}
function sendInheritance(input,value,role,extra={}){
 const sequence=++inputSequence;awaitingInput.set(input,sequence);updateActions();
 send('inherit',value,{...fieldScope(role),...extra,inputSequence:sequence});
}
function trackEdit(input,role,property='foreground'){
 input.addEventListener('focus',()=>{if(state)gestureFor(input,role,property);});
 input.addEventListener('blur',event=>{
  // A native color dialog can blur the webview without ending the gesture.
  if(input.type!=='color'||event.relatedTarget||(document.hasFocus()&&document.activeElement!==input))endEdit(input);
 });
 if(input.type==='color'){
  const activate=()=>{endEdit(input);if(state)gestureFor(input,role,property);};
  input.addEventListener('pointerdown',activate);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')activate();if(event.key==='Escape')endEdit(input);});
  // Some native pickers emit change for each selection. Focus transfer, Escape,
  // explicit navigation or a subsequent activation delimit their gesture.
  input.addEventListener('change',()=>{if(document.activeElement!==input&&document.hasFocus())endEdit(input);});
 }
}
document.addEventListener('focusin',event=>endOtherEdits(event.target));
document.addEventListener('pointerdown',event=>endOtherEdits(event.target),true);
function paintField(input,accepted,role,property,replace=false){
 const rejected=rejectedFor(role,property);
 const invalid=!!rejected;
 const awaiting=awaitingInput.has(input);
 if(!awaiting&&(invalid||state.rejectedInputs.length||replace||document.activeElement!==input||input.tagName==='SELECT')){
  const text=invalid?rejected.text:String(accepted??'');
  if(input.value!==text)input.value=text;
 }
 if(invalid)input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid');
 return invalid||awaiting;
}

function options(id,items,value){const node=el(id),signature=JSON.stringify(items);if(node.dataset.options!==signature){node.replaceChildren(...items.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));node.dataset.options=signature;}node.value=value??'';}
function choose(id){
 el('assignments').open=el('management').open=false;
 expanded=expanded===id?undefined:id;
 send('role',id);
 if(state)paint({...state,role:id});
}
for(const role of roles){
 let group=groups.get(role.group);
 if(!group){group=document.createElement('section');group.dataset.group=role.group;const heading=document.createElement('h2');heading.className='group-heading';heading.textContent=role.group==='element'?'Tag':role.group;group.append(heading);el('catalog').append(group);groups.set(role.group,group);}
 const holder=document.createElement('div'),row=document.createElement('div');row.className='role-row';row.dataset.role=role.id;
 const swatch=document.createElement('label');swatch.className='swatch native';const unknown=document.createElement('span');unknown.textContent='N';const picker=document.createElement('input');picker.type='color';picker.id='picker-'+role.id;picker.setAttribute('aria-label','Choose '+role.label+' foreground');swatch.append(unknown,picker);
 const button=document.createElement('button');button.className='role-label';button.id='role-'+role.id;button.setAttribute('aria-expanded','false');const name=document.createElement('strong');name.textContent=role.label.toLowerCase().startsWith(role.group+' ')?role.label.slice(role.group.length+1):role.label;button.setAttribute('aria-label',role.label+' Advanced');button.title=role.label+' · Advanced styling';button.append(name);button.addEventListener('click',()=>choose(role.id));
 const input=document.createElement('input');input.type='text';input.className='hex';input.setAttribute('aria-label',role.label+' authored foreground');input.spellcheck=false;input.id='hex-'+role.id;
 const reset=document.createElement('button');reset.className='reset';reset.textContent='↶';reset.title='Reset '+role.label+' color and source to last saved';reset.setAttribute('aria-label',reset.title);reset.id='reset-'+role.id;
 trackEdit(input,role.id);trackEdit(picker,role.id);
 input.addEventListener('input',()=>sendField(input,input.value,'foreground',role.id));
 picker.addEventListener('input',()=>sendField(picker,picker.value,'foreground',role.id));
 reset.addEventListener('click',()=>send('reset',undefined,{...fieldScope(role.id),property:'foreground'}));
 const inheritLabel=document.createElement('label');inheritLabel.className='inherit-check';
 const inherit=document.createElement('input');inherit.type='checkbox';inherit.id='inherit-'+role.id;inherit.setAttribute('aria-label','Inherit '+role.label+' color');inheritLabel.append(inherit,'Inherit');
 const from=document.createElement('select');from.className='from';from.id='from-'+role.id;from.setAttribute('aria-label',role.label+' inheritance source');
 const sources=[['','From fallback'],['native','VS Code'],...roles.filter(r=>r.id!==role.id).map(r=>[r.id,r.label])];
 for(const [value,label] of sources){const option=document.createElement('option');option.value=value;option.textContent=label;from.append(option);}
 inherit.addEventListener('input',()=>{
  if(inherit.checked)sendInheritance(inherit,from.value,role.id);
  // Author the full color before blending. Native has no resolved color, so
  // use the picker's current choice only when leaving Native.
  else sendInheritance(inherit,state.rows[role.id].resolved.rawForeground??picker.value,role.id,{materialize:true});
 });
 from.addEventListener('input',()=>sendInheritance(from,from.value,role.id));
 row.append(swatch,button,input,inheritLabel,from,reset);holder.append(row);group.append(holder);rows.set(role.id,{holder,row,button,input,picker,reset,swatch,unknown,inherit,from});
}

for(const property of properties.filter(p=>p!=='foreground')){
 const box=document.createElement('div');box.className='property';const line=document.createElement('div');line.className='property-line';
 const label=document.createElement('label');label.htmlFor=property;label.textContent=property==='fontStyle'?'Font style':property;
 const input=document.createElement(['bold','italic','underline','strikethrough'].includes(property)?'select':'input');input.id=property;
 if(input.tagName==='SELECT'){for(const [value,text]of [['','Inherit'],['true','On'],['false','Off'],['native','Native']]){const o=document.createElement('option');o.value=value;o.textContent=text;input.append(o);}}
 else{input.type='text';input.placeholder=property==='intensity'?'0–1 / native':'bold italic… / native';input.title=property==='intensity'?'RGB blend against the palette background, not opacity':'bold, italic, underline, strikethrough, or native';}
 const reset=document.createElement('button');reset.id='reset-'+property;reset.className='reset';reset.textContent='↶';reset.title='Reset '+property+' to last saved';reset.setAttribute('aria-label',reset.title);reset.addEventListener('click',()=>send('reset',undefined,{...fieldScope(),property}));
 const info=document.createElement('small');info.id='source-'+property;info.className='source';line.append(label,input,reset);box.append(line,info);el('properties').append(box);
 if(input.type==='text')trackEdit(input,undefined,property);
 input.addEventListener('input',()=>{let value=input.value;if(value==='')value=null;else if(property==='intensity'&&value.trim()&&Number.isFinite(Number(value)))value=Number(value);else if(input.tagName==='SELECT'&&value!=='native')value=value==='true';sendField(input,value,property);});
}
function filter(){let count=0;const query=el('filter').value.trim().toLowerCase();for(const role of roles){const row=rows.get(role.id);row.holder.hidden=!state?.rejectedInputs.some(input=>input.role===role.id)&&!(role.label+' '+role.id).toLowerCase().includes(query);if(!row.holder.hidden)count++;}for(const group of groups.values())group.hidden=![...group.children].some(child=>child!==group.firstChild&&!child.hidden);el('empty').hidden=count!==0;el('count').textContent=count+' / '+roles.length+' roles';}
el('advanced').addEventListener('click',()=>choose(state.role));
el('filter').addEventListener('input',()=>{filter();el('catalog').scrollTop=0;});
for(const id of ['target','destination'])el(id).addEventListener('input',()=>send(id,el(id).value));
for(const family of ['all','data','document'])el(family).addEventListener('input',()=>send('assign',el(family).value,{family}));
for(const mode of ['dark','light'])el(mode).addEventListener('click',()=>send('mode',mode));
for(const id of ['saved','draft'])el(id).addEventListener('click',()=>send('compare',id));
el('confirm-revert').addEventListener('click',()=>send('confirm-revert',true));el('cancel-revert').addEventListener('click',()=>send('confirm-revert',false));el('revert-dialog').addEventListener('cancel',event=>{event.preventDefault();send('confirm-revert',false);});
el('save').addEventListener('click',()=>{if(!el('save').disabled)send('save');});
for(const id of ['retry-scratchpads','move-scratchpads','revert','delete','export','undo','redo','restore','apply','discard-input'])el(id).addEventListener('click',()=>send(id));
for(const id of ['Document','Data','Interpolation'])el(id).addEventListener('click',()=>send('example',id));
for(const id of ['open-scratchpad','restore-example'])el(id).addEventListener('click',()=>send(id));
for(const id of ['new','duplicate'])el(id).addEventListener('click',()=>send(id,undefined,{name:el('name').value}));
el('rename').addEventListener('click',()=>send('rename',el('name').value));
function paint(s){
 const previousRejected=state?.rejectedInputs.at(-1);
 const rejected=s.rejectedInputs.at(-1);
 const active=document.activeElement;
 const contextChanged=!!state&&(state.inputRevision!==s.inputRevision||state.target!==s.target);
 const modeChanged=!!state&&state.mode!==s.mode;
 // A theme update can arrive after local focus but before the controller sees it.
 if(modeChanged&&!contextChanged&&!rejected&&editGroups.size>0)return;
 const replace=contextChanged||modeChanged;
 for(const [input,sequence] of awaitingInput)if(sequence<=s.inputSequence)awaitingInput.delete(input);
 s={...s,...s.rows[s.role]};if(selected&&selected!==s.role&&expanded)expanded=s.role;
 if(rejected&&rejected.property!=='foreground'&&rejected.role===s.role)expanded=s.role;
 if(contextChanged){endOtherEdits();awaitingInput.clear();}
 if(replace&&editGroups.has(active)&&!awaitingInput.has(active))active.blur();
 state=s;const paletteMap=new Map(s.builtins.map(p=>[p.id,p.name]));for(const p of s.draft.palettes)paletteMap.set(p.id,p.name);
 const palettes=[['native','Native VS Code'],...paletteMap],names=Object.fromEntries(palettes);
 for(const family of ['all','data','document'])options(family,family==='all'?palettes:[['','↳ All Hson'],...palettes],s.draft.assignments[family]);
 const retained=(s.retainedTargets??[]).filter(target=>target.startsWith('palette:')&&!paletteMap.has(target.slice(8))).map(target=>[target,'Retained palette · '+target.slice(8)]);
 el('retry-scratchpads').hidden=!s.scratchpadError;
 options('target',[...retained,...palettes.filter(p=>p[0]!=='native').map(([id,name])=>['palette:'+id,'Palette · '+name]),['override:all','Overrides · All Hson'],['override:data','Overrides · Data'],['override:document','Overrides · Document']],s.target);
 el('assignment-summary').textContent=names[s.draft.assignments.all]+' · Data '+(names[s.draft.assignments.data]??'↳')+' · Doc '+(names[s.draft.assignments.document]??'↳');
 el('assignment-summary').classList.toggle('dirty',s.assignmentsChanged);
 const id=s.target.slice(8),isPalette=s.target.startsWith('palette:'),assigned=family=>s.draft.assignments[family]??s.draft.assignments.all;
 const applied=['all','data','document'].filter(family=>assigned(family)===id),familyNames={all:'All Hson',data:'Data',document:'Document'};
 el('scope-note').textContent=isPalette?(applied.length?'Working: '+applied.map(f=>familyNames[f]).join(' · '):'Not applied · '+(['all','data','document'].every(f=>assigned(f)==='native')?'Native VS Code':'see assignments')):'Editing '+s.target.slice(9)+' overrides';
 el('apply').hidden=!isPalette||s.draft.assignments.all===id;
 el('preview-state').textContent='Hson · '+(s.comparison==='saved'?'Last Saved':'Working');
 el('preview-state').title='Open pins '+(isPalette?(names[id]??id):s.target.slice(9)+' overrides')+' · '+s.mode+'. Only Hson-owned colors preview independently; the VS Code theme is window-wide.';
 for(const mode of ['dark','light'])el(mode).setAttribute('aria-pressed',String(s.mode===mode));el('destination').value=s.destination;
 if(selected!==s.role){if(selected){rows.get(selected).input.id='hex-'+selected;rows.get(selected).reset.id='reset-'+selected;rows.get(selected).from.id='from-'+selected;}selected=s.role;rows.get(selected).input.id='foreground';rows.get(selected).reset.id='reset-foreground';rows.get(selected).from.id='inherits';}
 for(const role of roles){
  const row=rows.get(role.id),value=s.rows[role.id],authored=value.authored.foreground,effective=value.resolved.style.foreground,source=value.resolved.sources.foreground;
  const native=value.nativeOwned||!effective;
  row.row.classList.toggle('changed',value.changed);
  row.row.classList.toggle('selected',role.id===s.role);row.button.setAttribute('aria-expanded',String(expanded===role.id));
  row.input.disabled=row.picker.disabled=false;
  const rejectedSource=rejectedFor(role.id,'foreground','inherit');
  row.inherit.checked=!!rejectedSource||authored===undefined||authored==='native';row.from.disabled=!row.inherit.checked;
  row.from.value=rejectedSource?.text??(authored==='native'?'native':value.inherits);row.from.dataset.acceptedSource=value.inherits;
  if(rejectedSource)row.from.setAttribute('aria-invalid','true');else row.from.removeAttribute('aria-invalid');
  row.from.title=rejectedSource?.error??('From '+row.from.selectedOptions[0]?.textContent);
  const unresolved=paintField(row.input,authored,role.id,'foreground',replace);
  row.input.placeholder=native?'Native':effective;row.input.title=(value.changed?'Changed in Draft · ':'')+'Authored: '+(authored??'inherit')+' · '+(native?'Effective: native-managed':'Effective: '+effective)+' · '+source;
  row.reset.disabled=!unresolved&&!rejectedSource&&authored===value.saved.foreground&&value.inherits===value.savedInherits;

  row.swatch.classList.toggle('native',native);row.swatch.style.setProperty('--swatch',native?'transparent':effective);row.unknown.hidden=!native;
  const pickerColor=/^#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.exec(authored??'')?.[0]??value.resolved.rawForeground??effective;
  if(pickerColor)row.picker.value=pickerColor.length<=5?'#'+[...pickerColor.slice(1,4)].map(c=>c+c).join(''):pickerColor.slice(0,7);
 }
 const inspector=el('inspector');inspector.hidden=!expanded;el('advanced').setAttribute('aria-expanded',String(!!expanded));
 if(expanded){const role=roles.find(r=>r.id===s.role),example=role.example;if(inspector.parentElement!==rows.get(s.role).holder)rows.get(s.role).holder.append(inspector);
  el('example').replaceChildren();if(example){let at=-1;for(let i=0;i<(example.occurrence??1);i++)at=example.code.indexOf(example.highlight,at+1);const mark=document.createElement('mark');mark.textContent=example.highlight;el('example').append(example.code.slice(0,at),mark,example.code.slice(at+example.highlight.length));}

  const style=s.resolved.style, flags=style.fontStyle?.split(/\\s+/);
  const authoredLine=flag=>typeof style[flag]==='boolean'||(style[flag]!=='native'&&flags!==undefined);
  el('native-decoration-note').hidden=authoredLine('underline')===authoredLine('strikethrough');
  el('effective').textContent=s.nativeOwned?'Native bracket coloring owns this range.':s.resolved.style.foreground?'Effective '+s.resolved.style.foreground+' · '+s.resolved.sources.foreground:'Native-managed · RGB unavailable';
  el('resolution').textContent='Authored '+(s.authored.foreground??'inherit')+' → '+s.resolved.sources.foreground+'. Reset restores the last saved property. Native explicitly delegates to VS Code.';
  for(const property of properties.filter(p=>p!=='foreground')){const node=el(property);node.disabled=false;const unresolved=paintField(node,s.authored[property],s.role,property,replace);el('reset-'+property).disabled=s.authored[property]===s.saved[property]&&!unresolved;el('source-'+property).textContent=(s.resolved.style[property]??'Native')+' · '+s.resolved.sources[property]+(property==='intensity'?' · RGB base '+s.resolved.background:'');}
 }
 el('move-scratchpads').disabled=!isPalette;el('rename').disabled=!isPalette;el('delete').disabled=!isPalette||s.builtins.some(p=>p.id===id);el('restore').hidden=!isPalette||!s.builtins.some(p=>p.id===id);el('duplicate').disabled=el('export').disabled=!s.target.startsWith('palette:');
 for(const example of ['Document','Data','Interpolation']){el(example).setAttribute('aria-pressed',String(s.activeExample===example));el(example).disabled=s.switchingExample;}
 el('open-scratchpad').disabled=el('restore-example').disabled=s.switchingExample;
 el('previewMode').textContent=s.mode+' preview'+(s.mode!==s.previewMode?' · '+s.previewMode+' editor background':'');
 el('saved').setAttribute('aria-pressed',String(s.comparison==='saved'));el('draft').setAttribute('aria-pressed',String(s.comparison==='draft'));
 el('status').textContent=s.scratchpadError?'Scratchpad save failed':s.conflict?(s.saving?'Saving… · Conflict':'Configuration conflict'):s.saving?'Saving…':s.rejectedInputs.length?'Invalid input':s.dirty?'Unsaved':'All saved';el('status').classList.toggle('dirty',s.dirty);el('status').title=(s.comparison==='saved'?'Saved':'Draft')+' preview · controls edit Working';
 el('discard-input').hidden=!s.rejectedInputs.length&&(!s.error||s.conflict||s.configurationInvalid);el('discard-input').textContent=s.rejectedInputs.length?'Discard pending input':'Dismiss error';
 updateActions();el('save').title='Save all working changes to '+s.destination+' settings and update assigned Hson files';el('error').textContent=s.error;
 const confirmation=el('revert-dialog');if(s.confirmingRevert&&!confirmation.open)confirmation.showModal();else if(!s.confirmingRevert&&confirmation.open)confirmation.close();
 filter();
 if(rejected&&(!previousRejected||previousRejected.role!==rejected.role||previousRejected.property!==rejected.property)){
  const invalidField=rejected.kind==='inherit'?rows.get(rejected.role).from:rejected.property==='foreground'?rows.get(rejected.role).input:el(rejected.property);
  if(invalidField!==document.activeElement)invalidField.scrollIntoView({block:'nearest'});
 }
}
document.addEventListener('keydown',event=>{
 if(el('revert-dialog').open||!(event.metaKey||event.ctrlKey)||['name','filter'].includes(document.activeElement.id))return;
 const key=event.key.toLowerCase(),action=key==='z'?(event.shiftKey?'redo':'undo'):key==='y'?'redo':undefined;
 if(action){event.preventDefault();if(!el(action).disabled)send(action);}
});
window.addEventListener('message',event=>{if(event.data.type==='state')paint(event.data);});send('ready');
</script></body></html>`;
}
