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
.workbench{height:100vh;display:flex;flex-direction:column;min-width:220px}header{flex:none;padding:10px 10px 6px;border-bottom:1px solid var(--vscode-panel-border)}.line{display:flex;gap:5px;align-items:center;min-width:0}.line+.line{margin-top:5px}.grow{flex:1;min-width:0}.brand{font:600 13px var(--vscode-editor-font-family,monospace);letter-spacing:-.5px}.dim,.hint{color:var(--vscode-descriptionForeground)}.eyebrow{font:10px var(--vscode-editor-font-family,monospace);text-transform:uppercase;letter-spacing:.09em}.segment{display:inline-flex;gap:1px}.segment button{font-size:11px;height:24px}.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}#target{width:100%;font-weight:600}#status{margin:0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#destination{width:90px;font-size:11px;height:24px;flex-shrink:0}.save-label{font-size:11px;white-space:nowrap}.dirty::before{content:'● ';color:var(--vscode-foreground)}#scope-note{font-size:11px;margin:6px 0 0;min-height:15px}.setup{flex:none;max-height:38vh;overflow:auto;padding:0 10px;border-bottom:1px solid var(--vscode-panel-border)}summary{cursor:pointer;padding:6px 0;list-style:none;display:flex;gap:7px;align-items:center}summary::before{content:'›';font-family:monospace}details[open]>summary::before{content:'⌄'}summary .grow{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}details .content{padding:0 0 8px}.assignment{display:grid;grid-template-columns:90px minmax(0,1fr);gap:6px;align-items:center;margin-top:4px}.assignment label{font-size:11px}.assignment select{width:100%}#name{width:100%}.actions{display:flex;flex-wrap:wrap;gap:3px;margin-top:5px}.actions button{border:1px solid var(--vscode-panel-border);font-size:11px}.hint{font-size:11px;line-height:1.45;margin:5px 0}.danger{color:var(--vscode-errorForeground)}
.toolbar{padding:6px 10px;flex:none;border-bottom:1px solid var(--vscode-panel-border)}.examples{display:flex;align-items:center;gap:3px}.examples .eyebrow{margin-right:auto}.examples button{font-size:11px;padding:3px 6px}.search{margin-top:5px;display:flex;gap:6px}.search input{width:100%}.search select{width:67px}.catalog{flex:1;min-height:120px;overflow:auto;scrollbar-gutter:stable;padding:0 10px 10px;overscroll-behavior:contain}.group-heading{display:flex;align-items:center;gap:7px;margin:0;padding:12px 0 5px;color:var(--vscode-descriptionForeground);font-size:10px;font-weight:400;letter-spacing:.1em;text-transform:uppercase}.group-heading::after{content:'';height:1px;background:var(--vscode-panel-border);flex:1}.role-row{display:grid;grid-template-columns:24px minmax(0,1fr) 78px 22px;gap:5px;align-items:center;min-height:39px;border-bottom:1px solid var(--vscode-panel-border)}.role-row.selected{box-shadow:inset 2px 0 var(--vscode-focusBorder);padding-left:4px}.role-label{text-align:left;height:auto;white-space:normal;line-height:15px;padding:3px 0}.role-row.changed .role-label strong::before{content:'• ';}.role-label strong{font-weight:400;display:block}.origin{font-size:10px;color:var(--vscode-descriptionForeground);display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;max-width:100%}.hex{width:100%;font-size:11px;padding:3px}.reset{padding:2px;font-size:16px}.swatch{position:relative;width:22px;height:22px;border:1px solid var(--vscode-descriptionForeground);background:var(--swatch,transparent);overflow:hidden}.swatch.native{background:repeating-linear-gradient(135deg,transparent,transparent 3px,var(--vscode-panel-border) 3px,var(--vscode-panel-border) 5px)}.swatch input{opacity:0;position:absolute;inset:0;width:100%;height:100%;padding:0;cursor:pointer}.swatch:focus-within{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}.swatch span{font:10px var(--vscode-editor-font-family,monospace);display:grid;place-items:center;height:100%;color:var(--vscode-foreground)}
.inspector{padding:8px 0 10px 9px;border-left:2px solid var(--vscode-focusBorder);border-bottom:1px solid var(--vscode-panel-border)}.inspector[hidden],[hidden]{display:none!important}.inspector code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 var(--vscode-editor-font-family,monospace);margin-bottom:6px}.inspector mark{background:var(--vscode-editor-selectionBackground);color:inherit;border-bottom:1px solid var(--vscode-focusBorder)}.property{margin-top:5px}.property-line{display:grid;grid-template-columns:72px minmax(0,1fr) 22px;gap:4px;align-items:center}.property-line label{font-size:11px}.property-line input,.property-line select{width:100%;font-size:11px}.source{font-size:10px;line-height:1.4;color:var(--vscode-descriptionForeground);display:block;margin:2px 0 0 76px;overflow-wrap:anywhere}.inherit-line{display:grid;grid-template-columns:72px minmax(0,1fr);gap:4px;align-items:center;font-size:11px}.inherit-line select{width:100%;font-size:11px}.inspector summary{font-size:11px;padding-bottom:0}footer{flex:none;padding:5px 10px;border-top:1px solid var(--vscode-panel-border);font-size:10px;color:var(--vscode-descriptionForeground);display:flex;gap:8px;justify-content:space-between}#error:empty{display:none}#error{flex:none;max-height:85px;overflow:auto;margin:0;padding:6px 10px;color:var(--vscode-errorForeground);border-bottom:1px solid var(--vscode-panel-border)}#empty{padding:16px 0;color:var(--vscode-descriptionForeground)}
@media(max-width:280px){header,.toolbar{padding-left:7px;padding-right:7px}.setup,.catalog{padding-left:7px;padding-right:7px}.role-row{grid-template-columns:20px minmax(0,1fr) 70px 20px;gap:3px}.swatch{width:18px;height:20px}.brand{font-size:12px}.line{gap:3px}.line button{padding-left:4px;padding-right:4px}.assignment{grid-template-columns:76px minmax(0,1fr)}}
</style></head><body><main class="workbench">
<header>
 <div class="line"><span class="brand" aria-label="Hson">&lt;hson/&gt;</span><p id="status" class="grow dim" aria-live="polite">Loading…</p><button id="revert" title="Discard all unsaved appearance changes">Revert</button><button class="primary" id="save" title="Save Draft to the selected settings destination">Save</button></div>
 <div class="line"><select id="target" aria-label="Edit target"></select></div>
 <div class="line"><div class="segment" aria-label="Preview state"><button id="saved" aria-pressed="false">Saved</button><button id="draft" aria-pressed="true">Draft</button></div><span class="grow"></span><span class="dim save-label">Save to</span><select id="destination" aria-label="Save destination" title="Save destination"><option value="user">User</option><option value="workspace">Workspace</option></select></div>
 <p id="scope-note" class="dim"></p>
</header>
<p id="error" role="alert"></p>
<div class="setup">
 <details id="assignments"><summary id="assignments-toggle"><span class="eyebrow">Applies</span><span id="assignment-summary" class="grow dim"></span></summary><div class="content">
  <div class="assignment"><label for="all">All Hson</label><select id="all"></select></div><div class="assignment"><label for="data">Data / Declarative</label><select id="data"></select></div><div class="assignment"><label for="document">Document / Part</label><select id="document"></select></div>
  <p class="hint">Inherit uses All. Native delegates to VS Code.</p></div></details>
 <details id="management"><summary id="management-toggle"><span class="eyebrow">Palettes</span><span class="dim">create · duplicate · rename · export</span></summary><div class="content">
  <input id="name" class="grow" type="text" aria-label="Name for palette actions" placeholder="Name for Create, Duplicate or Rename">
  <div class="actions"><button id="new">Create</button><button id="duplicate">Duplicate</button><button id="rename">Rename</button><button id="delete">Delete</button><button id="export">Export to source…</button></div>
  <p class="hint">Delete requires reassignment first. Export opens JSON for review and Save As.</p></div></details>
</div>
<div class="toolbar"><div class="examples" aria-label="Native scratchpad"><span class="eyebrow dim" title="Editable native scratchpad" aria-label="Editable native scratchpad">→</span><button id="Document" aria-pressed="true">Document</button><button id="Data" aria-pressed="false">Data</button><button id="Interpolation" aria-pressed="false" title="Editable Data and Document regions. TypeScript imports use your workspace’s installed types.">Mixed TS</button></div><div class="search"><input id="filter" type="search" placeholder="Find a syntax role…" aria-label="Filter syntax roles"><select id="mode" aria-label="Palette mode"><option value="dark">Dark</option><option value="light">Light</option></select></div></div>
<div id="catalog" class="catalog" aria-label="Syntax role catalog"><p id="empty" hidden>No matching roles.</p></div>
<footer><span id="count"></span><span id="previewMode"></span></footer>
</main>
<div id="inspector" class="inspector" hidden>
 <code id="example"></code><span id="effective" class="hint"></span>
 <div class="inherit-line"><label for="inherits">Inherit role</label><select id="inherits"></select></div>
 <div id="properties"></div>
 <p id="native-decoration-note" class="hint" hidden>VS Code applies underline and strikethrough together. An authored line can replace a Native line.</p>
 <details><summary>Source / resolution</summary><p id="resolution" class="hint"></p></details>
</div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi(), roles=${data}, properties=${JSON.stringify(styleProperties)};
const el=id=>document.getElementById(id), send=(type,value,extra={})=>vscode.postMessage({type,value,...extra});
let state, expanded, selected;
const rows=new Map(),groups=new Map();
const pendingText=new Map();
function updateActions(){
 const unresolved=pendingText.size>0;
 el('save').disabled=!state?.dirty||!!state.saving||!!state.configurationInvalid||!!state.conflict||unresolved;
 el('revert').disabled=!(state?.dirty||state?.conflict)||!!state.saving||!!state.configurationInvalid;
}
function sendField(input,value,extra){
 if(input.type==='text'&&document.activeElement===input){
  pendingText.set(input,value);
  updateActions();
 }
 send('property',value,extra);
}
function restoreOnBlur(input){
 input.addEventListener('blur',()=>{
  if(!pendingText.delete(input))return;
  input.value=input.dataset.accepted??'';
  input.removeAttribute('aria-invalid');
  updateActions();
 });
}
function paintField(input,accepted,error){
 input.dataset.accepted=String(accepted??'');
 if(pendingText.has(input)&&Object.is(pendingText.get(input),accepted??null))pendingText.delete(input);
 if(document.activeElement!==input||input.disabled){
  input.value=input.dataset.accepted;
  pendingText.delete(input);
 }
 if(error&&pendingText.has(input))input.setAttribute('aria-invalid','true');
 else input.removeAttribute('aria-invalid');
}

function options(id,items,value){const node=el(id),signature=JSON.stringify(items);if(node.dataset.options!==signature){node.replaceChildren(...items.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));node.dataset.options=signature;}node.value=value??'';}
function choose(id){el('assignments').open=el('management').open=false;expanded=expanded===id?undefined:id;send('role',id);if(state)paint({...state,role:id});}
for(const role of roles){
 let group=groups.get(role.group);
 if(!group){group=document.createElement('section');group.dataset.group=role.group;const heading=document.createElement('h2');heading.className='group-heading';heading.textContent=role.group;group.append(heading);el('catalog').append(group);groups.set(role.group,group);}
 const holder=document.createElement('div'),row=document.createElement('div');row.className='role-row';row.dataset.role=role.id;
 const swatch=document.createElement('label');swatch.className='swatch native';const unknown=document.createElement('span');unknown.textContent='N';const picker=document.createElement('input');picker.type='color';picker.id='picker-'+role.id;picker.setAttribute('aria-label','Choose '+role.label+' foreground');swatch.append(unknown,picker);
 const button=document.createElement('button');button.className='role-label';button.id='role-'+role.id;button.setAttribute('aria-expanded','false');const name=document.createElement('strong');name.textContent=role.label.toLowerCase().startsWith(role.group+' ')?role.label.slice(role.group.length+1):role.label;button.setAttribute('aria-label',role.label+' details');button.title=role.label;const origin=document.createElement('span');origin.className='origin';button.append(name,origin);button.addEventListener('click',()=>choose(role.id));
 const input=document.createElement('input');input.type='text';input.className='hex';input.setAttribute('aria-label',role.label+' authored foreground');input.spellcheck=false;input.id='hex-'+role.id;
 const reset=document.createElement('button');reset.className='reset';reset.textContent='↶';reset.title='Reset '+role.label+' foreground to inheritance';reset.setAttribute('aria-label',reset.title);reset.id='reset-'+role.id;
 restoreOnBlur(input);
 input.addEventListener('input',()=>sendField(input,input.value||null,{property:'foreground',role:role.id}));
 picker.addEventListener('input',()=>send('property',picker.value,{property:'foreground',role:role.id}));reset.addEventListener('click',()=>send('property',null,{property:'foreground',role:role.id}));
 row.append(swatch,button,input,reset);holder.append(row);group.append(holder);rows.set(role.id,{holder,row,button,input,picker,reset,swatch,unknown,origin});
}
options('inherits',[['','Catalog fallback / Native'],...roles.map(r=>[r.id,r.label])],'');
for(const property of properties.filter(p=>p!=='foreground')){
 const box=document.createElement('div');box.className='property';const line=document.createElement('div');line.className='property-line';
 const label=document.createElement('label');label.htmlFor=property;label.textContent=property==='fontStyle'?'Font style':property;
 const input=document.createElement(['bold','italic','underline','strikethrough'].includes(property)?'select':'input');input.id=property;
 if(input.tagName==='SELECT'){for(const [value,text]of [['','Inherit'],['true','On'],['false','Off'],['native','Native']]){const o=document.createElement('option');o.value=value;o.textContent=text;input.append(o);}}
 else{input.type='text';input.placeholder=property==='intensity'?'0–1 / native':'bold italic… / native';input.title=property==='intensity'?'RGB blend against the palette background, not opacity':'bold, italic, underline, strikethrough, or native';}
 const reset=document.createElement('button');reset.id='reset-'+property;reset.className='reset';reset.textContent='↶';reset.title='Reset '+property+' to inheritance';reset.setAttribute('aria-label',reset.title);reset.addEventListener('click',()=>send('property',null,{property}));
 const info=document.createElement('small');info.id='source-'+property;info.className='source';line.append(label,input,reset);box.append(line,info);el('properties').append(box);
 if(input.type==='text')restoreOnBlur(input);
 input.addEventListener('input',()=>{let value=input.value;if(value==='')value=null;else if(property==='intensity'&&value.trim()&&Number.isFinite(Number(value)))value=Number(value);else if(input.tagName==='SELECT'&&value!=='native')value=value==='true';sendField(input,value,{property});});
}
function filter(){let count=0;const query=el('filter').value.trim().toLowerCase();for(const role of roles){const row=rows.get(role.id);row.holder.hidden=!(role.label+' '+role.id).toLowerCase().includes(query);if(!row.holder.hidden)count++;}for(const group of groups.values())group.hidden=![...group.children].some(child=>child!==group.firstChild&&!child.hidden);el('empty').hidden=count!==0;el('count').textContent=count+' / '+roles.length+' roles';}
el('filter').addEventListener('input',()=>{filter();el('catalog').scrollTop=0;});
for(const id of ['target','mode','destination'])el(id).addEventListener('input',()=>send(id,el(id).value));
for(const family of ['all','data','document'])el(family).addEventListener('input',()=>send('assign',el(family).value,{family}));
el('inherits').addEventListener('input',()=>send('inherit',el('inherits').value));
for(const id of ['saved','draft'])el(id).addEventListener('click',()=>send('compare',id));
el('save').addEventListener('click',()=>{if(!el('save').disabled)send('save');});
for(const id of ['revert','delete','export'])el(id).addEventListener('click',()=>send(id));
for(const id of ['Document','Data','Interpolation'])el(id).addEventListener('click',()=>send('example',id));
for(const id of ['new','duplicate'])el(id).addEventListener('click',()=>send(id,undefined,{name:el('name').value}));
el('rename').addEventListener('click',()=>send('rename',el('name').value));
function paint(s){
 s={...s,...s.rows[s.role]};if(selected&&selected!==s.role&&expanded)expanded=s.role;
 state=s;const palettes=[['native','Native'],['house','House'],...s.draft.palettes.map(p=>[p.id,p.name])],names=Object.fromEntries(palettes);
 for(const family of ['all','data','document'])options(family,family==='all'?palettes:[['','↳ All Hson'],...palettes],s.draft.assignments[family]);
 options('target',[...palettes.filter(p=>p[0]!=='native').map(([id,name])=>['palette:'+id,'Palette · '+name]),['override:all','Overrides · All Hson'],['override:data','Overrides · Data'],['override:document','Overrides · Document']],s.target);
 el('assignment-summary').textContent=names[s.draft.assignments.all]+' · Data '+(names[s.draft.assignments.data]??'↳')+' · Doc '+(names[s.draft.assignments.document]??'↳');
 el('assignment-summary').classList.toggle('dirty',s.assignmentsChanged);
 el('scope-note').textContent=(s.readonly?'Built in · Duplicate to edit':s.target.startsWith('override:')?'Editing Draft · '+(s.target.slice(9)==='all'?'all families':s.target.slice(9)+' only')+' override':'Editing Draft · every use of this palette');
 el('mode').value=s.mode;el('destination').value=s.destination;
 if(selected!==s.role){if(selected){rows.get(selected).input.id='hex-'+selected;rows.get(selected).reset.id='reset-'+selected;}selected=s.role;rows.get(selected).input.id='foreground';rows.get(selected).reset.id='reset-foreground';}
 for(const role of roles){
  const row=rows.get(role.id),value=s.rows[role.id],authored=value.authored.foreground,effective=value.resolved.style.foreground,source=value.resolved.sources.foreground;
  const native=value.nativeOwned||!effective;
  row.row.classList.toggle('changed',value.changed);
  row.row.classList.toggle('selected',role.id===s.role);row.button.setAttribute('aria-expanded',String(expanded===role.id));
  row.input.disabled=row.picker.disabled=s.readonly;
  paintField(row.input,authored,s.error);
  row.input.placeholder=native?'Native':effective;row.input.title=(value.changed?'Changed in Draft · ':'')+'Authored: '+(authored??'inherit')+' · '+(native?'Effective: native-managed':'Effective: '+effective)+' · '+source;
  row.reset.disabled=s.readonly||authored===undefined;
  row.origin.textContent=value.nativeOwned?'Native brackets':authored==='native'?'Native':authored!==undefined?(s.target.startsWith('override:')?'Override':'Authored'):effective?'↳ '+source:'Native-managed';row.origin.title=row.input.title;
  row.swatch.classList.toggle('native',native);row.swatch.style.setProperty('--swatch',native?'transparent':effective);row.unknown.hidden=!native;
  const pickerColor=/^#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.exec(authored??'')?.[0]??effective;
  if(pickerColor)row.picker.value=pickerColor.length<=5?'#'+[...pickerColor.slice(1,4)].map(c=>c+c).join(''):pickerColor.slice(0,7);
 }
 const inspector=el('inspector');inspector.hidden=!expanded;
 if(expanded){const role=roles.find(r=>r.id===s.role),example=role.example;if(inspector.parentElement!==rows.get(s.role).holder)rows.get(s.role).holder.append(inspector);
  el('example').replaceChildren();if(example){let at=-1;for(let i=0;i<(example.occurrence??1);i++)at=example.code.indexOf(example.highlight,at+1);const mark=document.createElement('mark');mark.textContent=example.highlight;el('example').append(example.code.slice(0,at),mark,example.code.slice(at+example.highlight.length));}
  el('inherits').value=s.inherits;el('inherits').disabled=s.readonly;
  const style=s.resolved.style, flags=style.fontStyle?.split(/\\s+/);
  const authoredLine=flag=>typeof style[flag]==='boolean'||(style[flag]!=='native'&&flags!==undefined);
  el('native-decoration-note').hidden=authoredLine('underline')===authoredLine('strikethrough');
  el('effective').textContent=s.nativeOwned?'Native bracket coloring owns this range.':s.resolved.style.foreground?'Effective '+s.resolved.style.foreground+' · '+s.resolved.sources.foreground:'Native-managed · RGB unavailable';
  el('resolution').textContent='Authored '+(s.authored.foreground??'inherit')+' → '+s.resolved.sources.foreground+'. Reset removes a property. Native explicitly delegates to VS Code.';
  for(const property of properties.filter(p=>p!=='foreground')){const node=el(property);node.disabled=s.readonly;paintField(node,s.authored[property],s.error);el('reset-'+property).disabled=s.readonly||s.authored[property]===undefined;el('source-'+property).textContent=(s.resolved.style[property]??'Native')+' · '+s.resolved.sources[property]+(property==='intensity'?' · RGB base '+s.resolved.background:'');}
 }
 el('rename').disabled=el('delete').disabled=s.readonly||!s.target.startsWith('palette:');el('duplicate').disabled=el('export').disabled=!s.target.startsWith('palette:');
 for(const example of ['Document','Data','Interpolation']){el(example).setAttribute('aria-pressed',String(s.activeExample===example));el(example).disabled=s.switchingExample;}
 el('previewMode').textContent=s.previewMode+' editor'+(s.mode!==s.previewMode?' · editing '+s.mode:'');
 el('saved').setAttribute('aria-pressed',String(s.comparison==='saved'));el('draft').setAttribute('aria-pressed',String(s.comparison==='draft'));
 el('status').textContent=s.saving?'Saving…':s.dirty?'Unsaved':'Saved state';el('status').classList.toggle('dirty',s.dirty);el('status').title=(s.comparison==='saved'?'Saved':'Draft')+' preview · controls edit Draft';
 updateActions();el('save').title='Save all Draft changes to '+s.destination+' settings';el('error').textContent=s.error;
 filter();
}
window.addEventListener('message',event=>{if(event.data.type==='state')paint(event.data);});send('ready');
</script></body></html>`;
}
