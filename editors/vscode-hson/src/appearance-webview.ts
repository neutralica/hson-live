import { randomUUID } from 'node:crypto';
import { roleCatalog, styleProperties } from './appearance-model.js';

// Short panel labels share the catalog's ids, examples and bindings.
const shortLabels: Record<string, string> = {
  'part.systemAttribute.name':'System attribute', 'part.selector.library':'Library',
  'part.selector.member':'Selector member', 'part.selector.separator':'Selector separator',
  'part.receivingArgument':'Receiving local', 'part.receivingKind':'Receiving kind', 'part.sendingArgument':'Sending name',
  'reference.incoming.marker':'Incoming marker', 'reference.local.marker':'Local marker',
  'reference.incoming.content':'Incoming name', 'reference.local.content':'Local root',
  'reference.member':'Member', 'reference.separator':'Path separator',
  'reference.selectorOpen':'Selector open', 'reference.selectorClose':'Selector close',
  'punctuation.tagOpen':'Tag open', 'punctuation.tagClose':'Tag close',
  'punctuation.referenceOpen':'Opening brace', 'punctuation.referenceClose':'Closing brace',
  'value.attributeString':'Attribute string',
};

/** Panel-local layout. Role meaning, authored values and resolution stay in the shared model. */
export function appearanceHtml(): string {
  const nonce = randomUUID();
  const roles = Object.entries(roleCatalog).map(([id, role]) => ({
    id, label: role.label, shortLabel: shortLabels[id], group: id.split('.')[0], example: role.examples[0],
    fallbackLabel: role.fallback ? roleCatalog[role.fallback]?.label : undefined,
  }));
  const data = JSON.stringify(roles).replaceAll('<', '\\u003c');
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
*{box-sizing:border-box}
:root{--line:var(--vscode-panel-border,var(--vscode-widget-border));--muted:var(--vscode-descriptionForeground)}
html,body{margin:0;padding:0;height:100%;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:12px var(--vscode-font-family)}
[hidden]{display:none!important}
button,input,select,summary{min-width:0;max-width:100%;font:inherit;color:inherit}
button,summary{cursor:pointer}
button,select,input:not([type=checkbox]),.menu>summary{height:24px;padding:2px 5px;border:1px solid transparent;border-radius:3px}
button,.menu>summary{background:transparent;white-space:nowrap}
button:hover,summary:hover{background:var(--vscode-toolbar-hoverBackground)}
input,select{background:var(--vscode-input-background);color:var(--vscode-input-foreground)}
input:not([type=checkbox]),select{border-color:var(--vscode-input-border,var(--line))}
select{appearance:auto}
button:disabled,input:disabled,select:disabled{opacity:.50;cursor:default}
:where(button,input,select,summary):focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
[aria-invalid=true]{outline:1px solid var(--vscode-inputValidation-errorBorder,var(--vscode-errorForeground))}
.workbench{height:100%;min-width:0;display:flex;flex-direction:column}
header,.toolbar,.setup,footer{flex:none}
header{padding:7px 8px 5px;border-bottom:1px solid var(--line)}
.line,.cluster,.segment,.toolbar,footer{display:flex;align-items:center;min-width:0}
.line,.toolbar{flex-wrap:wrap;gap:4px 6px}
.cluster{gap:2px}
.session{flex:1 1 152px;gap:4px}
.palette-tools{flex:1 1 auto;min-width:65px;max-width:240px}
.palette-caption,.action-name{display:none}
.palette-select{position:relative;flex:1;min-width:0}
.palette-select::after,.caret::after{content:'';display:inline-block;width:5px;height:5px;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:rotate(45deg)}
.palette-select::after{position:absolute;right:8px;top:8px;pointer-events:none}
#target{appearance:none;width:100%;padding:2px 19px 2px 7px;font-weight:600;text-overflow:ellipsis;border-color:var(--vscode-dropdown-border,var(--line));background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground)}
.segment{gap:1px;padding:1px;background:var(--vscode-input-background);border:1px solid var(--line);border-radius:4px;flex:none}
.segment button{height:20px;border:0;padding:0 6px;font-size:11px}
button[aria-pressed=true]{color:var(--vscode-list-activeSelectionForeground);background:var(--vscode-list-activeSelectionBackground);box-shadow:inset 0 -1px var(--vscode-focusBorder)}
.history{margin-left:auto}
#status,.caption,.hint,#count,#previewMode{font-size:11px;color:var(--muted)}
#status{white-space:nowrap;margin-right:4px}
#status.dirty::before{content:'● ';color:var(--vscode-foreground)}
#undo,#redo{font-size:16px;width:23px;padding:0}
.save-group{gap:0;margin-left:2px}
#save,#save-options>summary{height:24px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
#save{border-radius:3px 0 0 3px;padding:0 7px}
#save-options>summary{border-radius:0 3px 3px 0;border-left:1px solid var(--vscode-button-separator,var(--line));padding:0 5px}
.preview-line{margin-top:5px;justify-content:space-between}
.preview-line .cluster{gap:4px}
#example-choice,#open-scratchpad{font-size:11px;padding:2px 4px}#open-scratchpad{border-color:var(--line)}
.menu{position:relative;flex:none}
summary{list-style:none}
summary::-webkit-details-marker{display:none}
.menu>summary{display:flex;align-items:center;justify-content:center;gap:5px}
.menu[open]>summary{background:var(--vscode-toolbar-activeBackground,var(--vscode-toolbar-hoverBackground))}
#management-toggle{width:21px;padding:0;font-size:16px}
.popover{position:absolute;top:calc(100% + 3px);right:0;z-index:5;display:grid;min-width:max-content;padding:4px;border:1px solid var(--vscode-menu-border,var(--line));border-radius:4px;background:var(--vscode-menu-background,var(--vscode-editorWidget-background));color:var(--vscode-menu-foreground,var(--vscode-foreground));box-shadow:0 2px 8px var(--vscode-widget-shadow)}
#management{position:static}.palette-tools{position:relative}#management .popover{left:0;right:auto}
.popover button{height:26px;text-align:left;padding:3px 8px}
.popover button:hover,.popover button:focus-visible{color:var(--vscode-menu-selectionForeground);background:var(--vscode-menu-selectionBackground)}
.popover hr{width:100%;margin:3px 0;border:none;border-top:1px solid var(--line)}
.save-options-content{gap:4px;padding:8px}
#examples .popover{left:0;right:auto}
.toolbar{padding:5px 8px;gap:6px}
#filter{flex:1 1 84px;width:0;font-size:11px}
#context-note{flex-basis:100%;margin:0;color:var(--muted);font-size:11px}
.catalog{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;overscroll-behavior:contain;padding:0 6px 6px 8px}
.group-heading{display:flex;align-items:center;gap:6px;margin:0;padding:5px 0 2px;color:var(--muted);font:600 10px/13px var(--vscode-font-family);letter-spacing:.08em;text-transform:uppercase}
.group-heading::after{content:'';height:1px;flex:1;background:var(--line)}
.role-row{display:grid;grid-template-columns:22px minmax(60px,1.3fr) max-content max-content minmax(49px,1fr) 21px;gap:4px;align-items:center;min-height:25px}
.role-row:hover,.role-row:focus-within{background:var(--vscode-list-hoverBackground)}
.role-label{min-width:0;width:100%;height:23px;padding:1px 2px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.role-row.selected .role-label{text-decoration:underline;text-decoration-color:var(--vscode-focusBorder);text-underline-offset:3px}
.role-row.changed .role-label::before{content:'• '}
.role-row .hex{font:11px var(--vscode-editor-font-family,monospace);width:calc(9ch + 8px);height:22px;padding:1px 3px}
.inherit-check{display:flex;align-items:center;gap:3px;font-size:11px;cursor:pointer}
.inherit-check input{flex:none;width:13px;height:13px;margin:0;accent-color:var(--vscode-focusBorder)}
.from{width:100%;height:22px;padding:1px 2px;font-size:11px;text-overflow:ellipsis}
.reset{height:22px;padding:0;font-size:15px}
.swatch{position:relative;display:block;width:21px;height:21px;overflow:hidden;border:1px solid var(--vscode-descriptionForeground);border-radius:3px;background:var(--swatch,transparent)}
.swatch.native{background:repeating-linear-gradient(135deg,transparent,transparent 3px,var(--line) 3px,var(--line) 5px)}
.swatch input[type=color]{position:absolute;inset:0;width:100%;height:100%;padding:0;opacity:0;cursor:pointer}
.swatch:focus-within{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
.inspector{padding:7px 8px;margin:3px 0;border-left:2px solid var(--vscode-focusBorder);background:var(--vscode-editorWidget-background)}
.inspector header{display:flex;justify-content:space-between;align-items:center;padding:0 0 4px}
.inspector code{display:block;overflow-wrap:anywhere;white-space:pre-wrap;font:11px/1.4 var(--vscode-editor-font-family,monospace)}
.inspector mark{color:inherit;background:var(--vscode-editor-selectionBackground);border-bottom:1px solid var(--vscode-focusBorder)}
.property-line{display:grid;grid-template-columns:80px minmax(0,1fr) 22px;gap:4px;align-items:center;margin-top:3px}
.property-line input,.property-line select{font-size:11px;width:100%}
.property-line label,.inspector summary{font-size:11px}
.source{display:block;color:var(--muted);font-size:10px;overflow-wrap:anywhere}
.inspector summary{margin:6px 0 3px}
.setup{padding:0 8px;border-top:1px solid var(--line);max-height:36vh;overflow:auto}
.setup summary,.inspector summary{list-style:revert;cursor:pointer}
.setup summary{padding:4px 0;font-size:11px}
.assignment{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:3px 8px;margin:6px 0}
.assignment select{width:100%}
.actions{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin:4px 0}
.actions button{border:1px solid var(--line)}
.hint{line-height:1.45;margin:4px 0}
footer{justify-content:space-between;flex-wrap:wrap;gap:2px 6px;padding:2px 8px;border-top:1px solid var(--line)}
footer button{height:20px;padding:1px 3px;font-size:11px}
#count{margin-right:auto}
#error:not(:empty){flex:none;max-height:72px;overflow:auto;margin:0;padding:4px 8px;color:var(--vscode-errorForeground);white-space:pre-line}
#error:empty,#empty[hidden]{display:none}
#empty{color:var(--muted)}
dialog{max-width:calc(100% - 20px);padding:10px 14px;border:1px solid var(--vscode-focusBorder);color:var(--vscode-foreground);background:var(--vscode-editorWidget-background)}
dialog::backdrop{background:#0008}
@media(max-width:330px){
 .session{flex:1 0 100%}.palette-tools{max-width:none}.history{flex:1}.history #status{margin-right:auto}
 .role-row{grid-template-columns:22px max-content minmax(0,1fr) 70px 20px;grid-template-areas:"swatch name name hex reset" ". check source source source";row-gap:0;padding:1px 0 2px}
 .swatch{grid-area:swatch}.role-label{grid-area:name}.hex{grid-area:hex}.role-row>.reset{grid-area:reset}.inherit-check{grid-area:check}.from{grid-area:source}
 .role-row .from{height:18px}.role-row .role-label{height:21px}
}
@media(min-width:500px){
 .palette-caption,.action-name{display:inline}.palette-caption{color:var(--muted);font-size:11px;margin-right:3px}
 #undo,#redo{width:auto;padding:0 5px;font-size:12px}.history .arrow{display:none}
}
</style></head><body><main class="workbench">
<header>
 <div class="line">
  <div class="cluster session"><div class="cluster palette-tools"><label class="palette-caption" id="palette-caption" for="target">Palette</label><div class="palette-select"><select id="target" aria-label="Palette" title="Select a palette to edit its shared Hson colors"></select></div>
   <details class="menu" id="management"><summary id="management-toggle" aria-label="Palette actions" title="Palette actions">⋯</summary><div class="popover">
    <button id="new">New…</button><button id="duplicate">Duplicate…</button><button id="rename">Rename…</button><button id="export">Export to source…</button><button id="delete">Delete…</button>
    <hr><button id="move-scratchpads">Move Scratchpads…</button><button id="restore">Restore shipped House…</button>
   </div></details></div>
   <div class="segment" role="group" aria-label="Palette mode"><button id="dark" aria-pressed="true">Dark</button><button id="light" aria-pressed="false">Light</button></div>
  </div>
  <div class="cluster history"><span id="status" role="status">Loading…</span><button id="undo" aria-label="Undo" title="Undo"><span class="arrow">↶</span><span class="action-name">Undo</span></button><button id="redo" aria-label="Redo" title="Redo"><span class="arrow">↷</span><span class="action-name">Redo</span></button>
   <div class="cluster save-group"><button id="save">Save · User</button><details class="menu" id="save-options"><summary class="caret" id="save-options-toggle" aria-label="Save options"></summary><div class="popover save-options-content">
    <label for="destination">Save preferences to</label><select id="destination"><option value="user">User settings</option><option value="workspace">Workspace settings</option></select><hr><button id="revert">Revert All…</button>
   </div></details></div>
  </div>
 </div>
 <div class="line preview-line"><div class="cluster"><span class="caption">Preview</span><div class="segment" role="group" aria-label="Scratchpad preview"><button id="draft" aria-pressed="true" title="Preview working colors">Working</button><button id="saved" aria-pressed="false" title="Preview the last saved colors. Color controls edit Working.">Last saved</button></div></div>
  <div class="cluster"><details class="menu examples" id="examples"><summary class="caret" id="example-choice" aria-label="Choose scratchpad example">Document</summary><div class="popover">
   <button id="Document" aria-pressed="true">Document</button><button id="Data" aria-pressed="false">Data</button><button id="Interpolation" aria-pressed="false" title="Embedded Hson with native TypeScript">TS + Hson</button><hr><button id="restore-example">Restore Example</button>
  </div></details><button id="open-scratchpad">Open Scratchpad</button></div>
 </div>
</header>
<p id="error" role="alert"></p><button id="discard-input" hidden>Discard pending input</button><button id="retry-scratchpads" hidden>Retry Scratchpad Save</button>
<div class="toolbar"><div class="segment" role="group" aria-label="Color editing context"><button id="context-hson" aria-pressed="true" title="Edit the shared palette">Hson</button><button id="context-document" aria-pressed="false" title="Edit only Document / Part overrides">Document</button><button id="context-data" aria-pressed="false" title="Edit only Data / Declarative overrides">Data</button></div>
 <input id="filter" type="search" placeholder="Find a color…" aria-label="Find a syntax color or group"><p id="context-note" hidden></p>
</div>
<div id="catalog" class="catalog" aria-label="Syntax colors"><p id="empty" hidden>No matching colors.</p></div>
<details id="assignments" class="setup"><summary id="assignments-toggle">Palette Assignments</summary>
 <p class="hint">Save applies these palettes to source files. VS Code theme uses the editor’s syntax colors.</p>
 <div class="assignment"><label for="all">All Hson</label><select id="all"></select><label for="document">Document / Part</label><select id="document"></select><label for="data">Data / Declarative</label><select id="data"></select></div>
 <p class="hint" id="scope-note"></p><div class="actions"><button id="apply">Apply to Hson</button><button id="global-overrides">Edit All Hson overrides</button></div>
</details>
<footer><span id="count"></span><span id="previewMode"></span><button id="advanced" aria-controls="inspector" aria-expanded="false">Advanced…</button></footer>
</main>
<dialog id="revert-dialog" aria-labelledby="revert-question"><p id="revert-question">Discard all unsaved appearance changes?</p><div class="actions"><button id="cancel-revert" autofocus>Cancel</button><button id="confirm-revert">Revert All</button></div></dialog>
<dialog id="palette-dialog" aria-labelledby="palette-question"><p id="palette-question"></p><div class="actions"><button id="cancel-palette" autofocus>Cancel</button><button id="confirm-palette"></button></div></dialog>
<div id="inspector" class="inspector" hidden>
 <header><strong id="inspector-title"></strong><button id="close-advanced" aria-label="Close advanced properties">×</button></header><code id="example"></code>
 <div id="properties"></div>
 <details><summary>Source / resolution</summary><p id="effective" class="hint"></p><p id="resolution" class="hint"></p><div id="property-sources"></div><p id="native-decoration-note" class="hint" hidden>VS Code applies underline and strikethrough together. An authored line can replace a theme line.</p></details>
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
 el('assignments').open=false;expanded=undefined;
 send('role',id);
 if(state)paint({...state,role:id});
}
function shortName(role){
 if(role.shortLabel)return role.shortLabel;
 const label=role.label.split(' (')[0];
 const short=label.toLowerCase().startsWith(role.group+' ')?label.slice(role.group.length+1):label;
 return short[0].toUpperCase()+short.slice(1);
}
for(const role of roles){
 let group=groups.get(role.group);
 if(!group){group=document.createElement('section');group.dataset.group=role.group;const heading=document.createElement('h2');heading.className='group-heading';heading.textContent=role.group==='element'?'Tag':role.group;group.append(heading);el('catalog').append(group);groups.set(role.group,group);}
 const holder=document.createElement('div'),row=document.createElement('div');row.className='role-row';row.dataset.role=role.id;
 const swatch=document.createElement('label');swatch.className='swatch native';const picker=document.createElement('input');picker.type='color';picker.id='picker-'+role.id;picker.setAttribute('aria-label','Choose '+role.label+' foreground');swatch.append(picker);
 const button=document.createElement('button');button.className='role-label';button.id='role-'+role.id;
 button.textContent=shortName(role);button.setAttribute('aria-label',role.label);button.title=role.label;button.addEventListener('click',()=>choose(role.id));
 const input=document.createElement('input');input.type='text';input.className='hex';input.setAttribute('aria-label',role.label+' authored foreground');input.spellcheck=false;input.id='hex-'+role.id;
 const reset=document.createElement('button');reset.className='reset';reset.textContent='↶';reset.title='Reset '+role.label+' color and source to last saved';reset.setAttribute('aria-label',reset.title);reset.id='reset-'+role.id;
 trackEdit(input,role.id);trackEdit(picker,role.id);
 input.addEventListener('input',()=>sendField(input,input.value,'foreground',role.id));
 picker.addEventListener('input',()=>sendField(picker,picker.value,'foreground',role.id));
 reset.addEventListener('click',()=>send('reset',undefined,{...fieldScope(role.id),property:'foreground'}));
 const inheritLabel=document.createElement('label');inheritLabel.className='inherit-check';
 const inherit=document.createElement('input');inherit.type='checkbox';inherit.id='inherit-'+role.id;inherit.setAttribute('aria-label','Inherit '+role.label+' color');inheritLabel.append(inherit,'Inherit');
 const from=document.createElement('select');from.className='from';from.id='from-'+role.id;from.setAttribute('aria-label',role.label+' inheritance source');
 const sources=[['','Default'],['native','VS Code theme'],...roles.filter(r=>r.id!==role.id).map(r=>[r.id,r.label])];
 for(const [value,label] of sources){const option=document.createElement('option');option.value=value;option.textContent=label;from.append(option);}
 inherit.addEventListener('input',()=>{
  if(inherit.checked)sendInheritance(inherit,from.value,role.id);
  // Author the full color before blending. Native has no resolved color, so
  // use the picker's current choice only when leaving Native.
  else sendInheritance(inherit,state.rows[role.id].resolved.rawForeground??picker.value,role.id,{materialize:true});
 });
 from.addEventListener('input',()=>sendInheritance(from,from.value,role.id));
 row.append(swatch,button,input,inheritLabel,from,reset);holder.append(row);group.append(holder);rows.set(role.id,{holder,row,button,input,picker,reset,swatch,inherit,from});
}

for(const property of properties.filter(p=>p!=='foreground')){
 const box=document.createElement('div');box.className='property';const line=document.createElement('div');line.className='property-line';
 const label=document.createElement('label');label.htmlFor=property;label.textContent=property==='fontStyle'?'Font style':property[0].toUpperCase()+property.slice(1);
 const input=document.createElement(['bold','italic','underline','strikethrough'].includes(property)?'select':'input');input.id=property;
 if(input.tagName==='SELECT'){for(const [value,text]of [['','Inherit'],['true','On'],['false','Off'],['native','VS Code theme']]){const o=document.createElement('option');o.value=value;o.textContent=text;input.append(o);}}
 else{input.type='text';input.placeholder=property==='intensity'?'0–1 / native':'bold italic… / native';input.title=property==='intensity'?'RGB blend against the palette background, not opacity':'bold, italic, underline, strikethrough, or native';}
 const reset=document.createElement('button');reset.id='reset-'+property;reset.className='reset';reset.textContent='↶';reset.title='Reset '+property+' to last saved';reset.setAttribute('aria-label',reset.title);reset.addEventListener('click',()=>send('reset',undefined,{...fieldScope(),property}));
 const info=document.createElement('small');info.id='source-'+property;info.className='source';line.append(label,input,reset);box.append(line);el('properties').append(box);el('property-sources').append(info);
 if(input.type==='text')trackEdit(input,undefined,property);
 input.addEventListener('input',()=>{let value=input.value;if(value==='')value=null;else if(property==='intensity'&&value.trim()&&Number.isFinite(Number(value)))value=Number(value);else if(input.tagName==='SELECT'&&value!=='native')value=value==='true';sendField(input,value,property);});
}
function visibleInspectorRole(){
 return roles.find(role=>role.id===state?.role&&!rows.get(role.id).holder.hidden)
     ??roles.find(role=>!rows.get(role.id).holder.hidden);
}
function filter(){
 let count=0;
 const query=el('filter').value.trim().toLowerCase();
 for(const role of roles){
  const {holder}=rows.get(role.id);
  const terms=[role.label,shortName(role),role.id,groups.get(role.group).firstChild.textContent].join(' ').toLowerCase();
  holder.hidden=!terms.includes(query)&&!state?.rejectedInputs.some(input=>input.role===role.id);
  if(!holder.hidden)count++;
 }
 for(const group of groups.values())group.hidden=![...group.children].some(child=>child!==group.firstChild&&!child.hidden);
 el('empty').hidden=count!==0;el('count').textContent=count===roles.length?count+' colors':count+' / '+roles.length+' colors';
 if(expanded&&rows.get(expanded).holder.hidden){expanded=undefined;el('inspector').hidden=true;}
 const role=visibleInspectorRole(),advanced=el('advanced');
 advanced.disabled=!role;advanced.title=role?'Advanced properties for '+role.label:'Advanced properties';
 advanced.setAttribute('aria-label',advanced.title);advanced.setAttribute('aria-expanded',String(!!expanded));
}
function toggleAdvanced(){
 if(expanded){
  expanded=undefined;paint(state);el('advanced').focus();return;
 }
 const role=visibleInspectorRole();
 if(!role||!state)return;
 if(role.id!==state.role)choose(role.id);
 expanded=role.id;paint(state);
 el('inspector').scrollIntoView({block:'nearest'});el('close-advanced').focus({preventScroll:true});
}
el('advanced').addEventListener('click',toggleAdvanced);
el('close-advanced').addEventListener('click',toggleAdvanced);
el('filter').addEventListener('input',()=>{filter();el('catalog').scrollTop=0;});
for(const id of ['target','destination'])el(id).addEventListener('input',()=>send(id,el(id).value));
for(const family of ['all','data','document'])el(family).addEventListener('input',()=>send('assign',el(family).value,{family}));
for(const mode of ['dark','light'])el(mode).addEventListener('click',()=>send('mode',mode));
for(const id of ['saved','draft'])el(id).addEventListener('click',()=>send('compare',id));
for(const id of ['document','data'])el('context-'+id).addEventListener('click',()=>send('target','override:'+id));
el('context-hson').addEventListener('click',()=>send('target',state.sharedTarget));
el('global-overrides').addEventListener('click',()=>{el('assignments').open=false;send('target','override:all');el('context-hson').focus();});
el('confirm-revert').addEventListener('click',()=>send('confirm-revert',true));el('cancel-revert').addEventListener('click',()=>send('confirm-revert',false));el('revert-dialog').addEventListener('cancel',event=>{event.preventDefault();send('confirm-revert',false);});
el('save').addEventListener('click',()=>{if(!el('save').disabled)send('save');});
for(const id of ['retry-scratchpads','move-scratchpads','revert','export','undo','redo','apply','discard-input','open-scratchpad','restore-example'])el(id).addEventListener('click',()=>send(id));
for(const id of ['Document','Data','Interpolation'])el(id).addEventListener('click',()=>send('example',id));
for(const id of ['new','duplicate','rename'])el(id).addEventListener('click',()=>send('prompt-name',id));

let paletteAction;
for(const action of ['delete','restore'])el(action).addEventListener('click',()=>{
 paletteAction={action,target:state.target,inputRevision:state.inputRevision};
 el('palette-question').textContent=action==='delete'?'Delete '+el('target').selectedOptions[0].textContent+' from Working?':'Restore the shipped House colors in Working?';
 el('confirm-palette').textContent=action==='delete'?'Delete palette':'Restore House';
 el('palette-dialog').showModal();
});
el('cancel-palette').addEventListener('click',()=>el('palette-dialog').close());
el('confirm-palette').addEventListener('click',()=>{
 const {action,target,inputRevision}=paletteAction;
 el('palette-dialog').close();send(action,undefined,{target,inputRevision});
});
el('palette-dialog').addEventListener('close',()=>el('management-toggle').focus());

const menus=[...document.querySelectorAll('details.menu')];
function closeMenu(menu,focus=false){menu.open=false;if(focus)menu.firstElementChild.focus();}
for(const menu of menus){
 menu.firstElementChild.addEventListener('click',()=>{for(const other of menus)if(other!==menu)closeMenu(other);});
 menu.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){event.preventDefault();closeMenu(menu,true);}});
 menu.addEventListener('focusout',event=>{if(event.relatedTarget&&!menu.contains(event.relatedTarget))closeMenu(menu);});
 menu.addEventListener('click',event=>{if(event.target.closest('button'))closeMenu(menu,!document.querySelector('dialog[open]'));});
}
el('destination').addEventListener('change',()=>closeMenu(el('save-options'),true));
document.addEventListener('pointerdown',event=>{for(const menu of menus)if(!menu.contains(event.target))closeMenu(menu);});
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
 s={...s,...s.rows[s.role]};if(selected&&selected!==s.role)expanded=undefined;
 if(rejected&&rejected.property!=='foreground'&&rejected.role===s.role)expanded=s.role;
 if(contextChanged){endOtherEdits();awaitingInput.clear();}
 if(replace&&editGroups.has(active)&&!awaitingInput.has(active))active.blur();
 state=s;const paletteMap=new Map(s.builtins.map(p=>[p.id,p.name]));for(const p of s.draft.palettes)paletteMap.set(p.id,p.name);
 const entries=[['native','VS Code theme'],...paletteMap],names=Object.fromEntries(entries);
 const seen=new Set(),duplicates=new Set();
 for(const [,name] of entries){if(seen.has(name))duplicates.add(name);seen.add(name);}
 const palettes=entries.map(([id,name])=>[id,duplicates.has(name)?name+' · '+id:name]);
 for(const family of ['all','data','document'])options(family,family==='all'?palettes:[['','Use All Hson'],...palettes],s.draft.assignments[family]);
 const retained=(s.retainedTargets??[]).filter(target=>target.startsWith('palette:')&&!paletteMap.has(target.slice(8))).map(target=>[target,'Retained palette · '+target.slice(8)]);
 const isPalette=s.target.startsWith('palette:'),id=s.target.slice(8),family=isPalette?'all':s.target.slice(9);
 const assigned=family=>s.draft.assignments[family]??s.draft.assignments.all;
 const base=assigned(family),familyNames={all:'All Hson',data:'Data',document:'Document'};
 const choices=palettes.slice(1).map(([id,name])=>['palette:'+id,name]);
 if(!isPalette&&base==='native')choices.unshift(['native','VS Code theme']);
 options('target',[...choices,...retained],isPalette?s.target:base==='native'?'native':'palette:'+base);
 el('palette-caption').textContent=isPalette?'Palette':'Base';
 if(el('target').options[0]?.value==='native')el('target').options[0].disabled=true;
 el('target').setAttribute('aria-label',isPalette?'Palette':'Assigned base palette. Choose a palette to edit its shared Hson colors.');
 el('retry-scratchpads').hidden=!s.scratchpadError;
 const applied=['all','document','data'].filter(family=>assigned(family)===id);
 el('scope-note').textContent=isPalette?(applied.length?'Assigned to '+applied.map(f=>familyNames[f]).join(', ')+'.':'Not applied to ordinary Hson files.'):'All Hson overrides apply across families. Family overrides take precedence.';
 el('apply').hidden=!isPalette||s.draft.assignments.all===id;
 el('apply').title='Assign '+(names[id]??id)+' to All Hson. Explicit family assignments are kept.';
 el('global-overrides').setAttribute('aria-pressed',String(s.target==='override:all'));
 el('context-note').hidden=isPalette;
 el('context-hson').title='Edit shared colors in '+(names[s.sharedTarget.slice(8)]??'the selected palette');
 el('context-note').textContent=isPalette?'':familyNames[family]+' override · Inherits '+names[base]+(family!=='all'&&!s.draft.assignments[family]?' via All Hson':'');
 for(const context of ['hson','document','data'])el('context-'+context).setAttribute('aria-pressed',String(context===(isPalette?'hson':family)));
 for(const mode of ['dark','light'])el(mode).setAttribute('aria-pressed',String(s.mode===mode));el('destination').value=s.destination;
 const scope=s.destination==='user'?'User':'Workspace';
 el('save').textContent='Save · '+scope;
 const destination='Save options · '+scope+' settings';
 el('save-options').firstElementChild.title=destination;el('save-options').firstElementChild.setAttribute('aria-label',destination);
 if(selected!==s.role){if(selected){rows.get(selected).input.id='hex-'+selected;rows.get(selected).reset.id='reset-'+selected;rows.get(selected).from.id='from-'+selected;}selected=s.role;rows.get(selected).input.id='foreground';rows.get(selected).reset.id='reset-foreground';rows.get(selected).from.id='inherits';}
 for(const role of roles){
  const row=rows.get(role.id),value=s.rows[role.id],authored=value.authored.foreground,effective=value.resolved.style.foreground,source=value.resolved.sources.foreground;
  const native=value.nativeOwned||!effective;
  row.row.classList.toggle('changed',value.changed);
  row.row.classList.toggle('selected',role.id===s.role);row.button.setAttribute('aria-pressed',String(role.id===s.role));
  row.input.disabled=row.picker.disabled=false;
  const rejectedSource=rejectedFor(role.id,'foreground','inherit');
  row.inherit.checked=!!rejectedSource||authored===undefined||authored==='native';row.from.disabled=!row.inherit.checked;
  row.from.value=rejectedSource?.text??(authored==='native'?'native':value.inherits);row.from.dataset.acceptedSource=value.inherits;
  if(rejectedSource)row.from.setAttribute('aria-invalid','true');else row.from.removeAttribute('aria-invalid');
  const fallbackLabel=!row.inherit.checked?'From…':!isPalette?'Base':(role.fallbackLabel??'Default');
  if(row.from.options[0].textContent!==fallbackLabel)row.from.options[0].textContent=fallbackLabel;
  row.from.title=rejectedSource?.error??('Inherit from '+row.from.selectedOptions[0]?.textContent+' · '+source);
  const unresolved=paintField(row.input,authored,role.id,'foreground',replace);
  row.input.placeholder=native?'VS Code':effective;row.input.title='Working color · '+role.label;
  row.reset.disabled=!unresolved&&!rejectedSource&&authored===value.saved.foreground&&value.inherits===value.savedInherits;

  row.swatch.classList.toggle('native',native);row.swatch.style.setProperty('--swatch',native?'transparent':effective);row.swatch.title=native?'VS Code theme':effective;
  const pickerColor=/^#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.exec(authored??'')?.[0]??value.resolved.rawForeground??effective;
  if(pickerColor)row.picker.value=pickerColor.length<=5?'#'+[...pickerColor.slice(1,4)].map(c=>c+c).join(''):pickerColor.slice(0,7);
 }
 const inspector=el('inspector');inspector.hidden=!expanded;
 if(expanded){const role=roles.find(r=>r.id===s.role),example=role.example;el('inspector-title').textContent=role.label;if(inspector.parentElement!==rows.get(s.role).holder)rows.get(s.role).holder.append(inspector);
  el('example').replaceChildren();if(example){let at=-1;for(let i=0;i<(example.occurrence??1);i++)at=example.code.indexOf(example.highlight,at+1);const mark=document.createElement('mark');mark.textContent=example.highlight;el('example').append(example.code.slice(0,at),mark,example.code.slice(at+example.highlight.length));}

  const style=s.resolved.style, flags=style.fontStyle?.split(/\\s+/);
  const authoredLine=flag=>typeof style[flag]==='boolean'||(style[flag]!=='native'&&flags!==undefined);
  el('native-decoration-note').hidden=authoredLine('underline')===authoredLine('strikethrough');
  el('effective').textContent=s.nativeOwned?'Native bracket coloring owns this range.':s.resolved.style.foreground?'Effective '+s.resolved.style.foreground+' · '+s.resolved.sources.foreground:'Native-managed · RGB unavailable';
  el('resolution').textContent='Authored '+(s.authored.foreground??'inherit')+' → '+s.resolved.sources.foreground+'. Reset restores the last saved property. Native explicitly delegates to VS Code.';
  for(const property of properties.filter(p=>p!=='foreground')){const node=el(property);node.disabled=false;const unresolved=paintField(node,s.authored[property],s.role,property,replace);el('reset-'+property).disabled=s.authored[property]===s.saved[property]&&!unresolved;el('source-'+property).textContent=property+' · '+(s.resolved.style[property]??'VS Code theme')+' · '+s.resolved.sources[property]+(property==='intensity'?' · RGB base '+s.resolved.background:'');}
 }
 el('move-scratchpads').disabled=!isPalette;el('rename').disabled=!isPalette;el('delete').disabled=!isPalette||s.builtins.some(p=>p.id===id);el('restore').hidden=!isPalette||!s.builtins.some(p=>p.id===id);el('duplicate').disabled=el('export').disabled=!s.target.startsWith('palette:');
 for(const example of ['Document','Data','Interpolation']){el(example).setAttribute('aria-pressed',String(s.activeExample===example));el(example).disabled=s.switchingExample;}
 const exampleName=el(s.activeExample).textContent;
 el('example-choice').textContent=exampleName;el('example-choice').setAttribute('aria-label','Scratchpad example: '+exampleName);
 el('open-scratchpad').disabled=el('restore-example').disabled=s.switchingExample;
 el('open-scratchpad').title='Open '+exampleName+' · '+(isPalette?(names[id]??id):familyNames[family]+' overrides')+' · '+s.mode;
 el('previewMode').textContent=s.mode!==s.previewMode?s.previewMode+' editor background':'';
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
 if(document.querySelector('dialog[open]')||!(event.metaKey||event.ctrlKey)||document.activeElement.id==='filter')return;
 const key=event.key.toLowerCase(),action=key==='z'?(event.shiftKey?'redo':'undo'):key==='y'?'redo':undefined;
 if(action){event.preventDefault();if(!el(action).disabled)send(action);}
});
window.addEventListener('message',event=>{if(event.data.type==='state')paint(event.data);});send('ready');
</script></body></html>`;
}
