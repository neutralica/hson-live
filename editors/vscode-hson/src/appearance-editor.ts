import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { appearanceHtml } from './appearance-webview.js';
import type { IGrammar } from 'vscode-textmate';
import { AppearanceRenderer } from './appearance-renderer.js';
import { AppearanceSpanCache } from './appearance-spans.js';
import { roleCatalog, housePalette, initialAppearance, readAppearance, duplicatePalette, deletePalette, resolveStyle,
  styleProperties, type AppearanceState, type Mode, type Family, type RoleStyle } from './appearance-model.js';
import type { HsonBindingCache } from './binding-intelligence.js';
type Example = keyof typeof examples;
const examples = {
  Document: { language: "hson", content: '// Editable Document scratchpad — paste your own Hson here.\n<section hson:part data:message=%{message} title="Attribute text" class="example"\n  <h1 "Content text"/>\n  <p title=^{message} "Hello"/>\n/>\n' },
  Data: { language: "hson", content: '// Editable Data scratchpad — paste your own Hson here.\n<catalog\n  <title "Data content" >\n  <tags ["alpha", "beta"]>\n  <count 42>\n  <enabled true>\n>\n' },
  Interpolation: { language: "typescript", content: 'import { Hson } from "hson-live/hson";\nconst hostValue = "Native TypeScript";\nconst document = Hson.document`\n<section title="Attribute text"\n  <p "Content text ${hostValue.toUpperCase()}"/>\n/>`;\nconst data = Hson.data`\n<catalog\n  <true "Data text">\n  <false 1>\n  <null null>\n>`;\n' },
};
function currentMode(): Mode {return [vscode.ColorThemeKind.Light,vscode.ColorThemeKind.HighContrastLight].includes(vscode.window.activeColorTheme.kind)?'light':'dark';}
function configured():AppearanceState {
  const setting=vscode.workspace.getConfiguration('hson.appearance').inspect('state');
  return readAppearance(setting?.workspaceValue??setting?.globalValue??setting?.defaultValue);
}
export class HsonAppearanceEditor implements vscode.Disposable {
  private panel?:vscode.WebviewPanel;
  private readonly renderer:AppearanceRenderer;
  private readonly subscriptions:vscode.Disposable[]=[];
  private readonly documents=new Map<Example,vscode.TextDocument>();
  private readonly scratchpadId=randomUUID().slice(0,8);
  private saved=initialAppearance();
  private draft=initialAppearance();
  private comparison:'saved'|'draft'='draft';
  private editTarget='palette:house';
  private role='value.attributeString';
  private mode=currentMode();
  private destination:'user'|'workspace'='user';
  private error='';
  private conflict=false;
  private saving=false;
  private disposed=false;
  private opening?:Promise<void>;
  constructor(_extensionPath:string,grammar:Promise<IGrammar>,bindings:HsonBindingCache){
    this.reload();
    this.renderer=new AppearanceRenderer(grammar,new AppearanceSpanCache(bindings),()=>{try{return configured();}catch{return this.saved;}});
    void this.renderer.refresh();
    this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event=>{
      if(event.affectsConfiguration('editor.bracketPairColorization'))void this.present();
      if(!event.affectsConfiguration('hson.appearance.state')||this.saving)return;
      const dirty=JSON.stringify(this.draft)!==JSON.stringify(this.saved);
      try{this.saved=configured();if(!dirty)this.draft=structuredClone(this.saved);else this.conflict=true;this.error='';}catch(error){this.error=String(error);}
      void this.present();
    }),vscode.window.onDidChangeActiveColorTheme(()=>{this.mode=currentMode();void this.present();}));
  }
  private reload():void {try{this.saved=configured();this.draft=structuredClone(this.saved);this.error='';this.conflict=false;}catch(error){this.error=String(error);}}
  async open():Promise<void>{
    if(this.disposed)return;if(this.opening)return this.opening;
    this.opening=this.openPanel().finally(()=>{this.opening=undefined;});return this.opening;
  }
  private async openPanel():Promise<void>{
    if(!this.panel){
      const panel=this.panel=vscode.window.createWebviewPanel('hson.appearance','Hson Appearance',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
      const events=[panel.onDidDispose(()=>{this.panel=undefined;void this.renderer.setAppearance(undefined);for(const event of events)event.dispose();}),
        panel.webview.onDidReceiveMessage((message:unknown)=>{void this.receive(message).catch(error=>{this.error=String(error);void this.present();});})];
      panel.webview.html=appearanceHtml();
    }
    await vscode.commands.executeCommand('vscode.setEditorLayout',{orientation:0,groups:[{size:.38},{size:.62}]});
    this.panel.reveal(vscode.ViewColumn.One,true);await this.showExample('Document');await this.present();
  }
  private async showExample(example:Example):Promise<void>{
    let document=this.documents.get(example);
    if(!document||document.isClosed){
      const suffix=examples[example].language==='typescript'?'ts':'hson';
      document=await vscode.workspace.openTextDocument(vscode.Uri.from({scheme:'untitled',path:`Hson ${example} ${this.scratchpadId}.${suffix}`}));
      const edit=new vscode.WorkspaceEdit();edit.insert(document.uri,new vscode.Position(0,0),examples[example].content);
      if(!await vscode.workspace.applyEdit(edit))throw new Error('Could not initialize scratchpad');this.documents.set(example,document);
    }
    if(!this.panel)return;
    await this.renderer.attach(document,example==='Document'?'document':example==='Data'?'data':'all');
    await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.Two,preview:false,preserveFocus:true});
  }
  private target(state:AppearanceState):Record<string,RoleStyle>|undefined {
    if(this.editTarget.startsWith('palette:'))return state.palettes.find(p=>p.id===this.editTarget.slice(8))?.roles;
    const family=this.editTarget.slice(9);if(family!=='all'&&family!=='data'&&family!=='document')return;
    return state.overrides[family]??(state.overrides[family]={});
  }
  private async receive(message:unknown):Promise<void>{
    if(!message||typeof message!=='object'||!('type'in message))return;
    this.error='';const candidate=structuredClone(this.draft);
    const value='value'in message?message.value:undefined;
    if(message.type==='ready'){}
    else if(message.type==='compare'&&(value==='saved'||value==='draft'))this.comparison=value;
    else if(message.type==='role'&&typeof value==='string'&&Object.hasOwn(roleCatalog,value))this.role=value;
    else if(message.type==='target'&&typeof value==='string')this.editTarget=value;
    else if(message.type==='mode'&&(value==='light'||value==='dark'))this.mode=value;
    else if(message.type==='destination'&&(value==='user'||value==='workspace'))this.destination=value;
    else if(message.type==='example'&&typeof value==='string'&&Object.hasOwn(examples,value)){
      if(value==='Document'||value==='Data'||value==='Interpolation')await this.showExample(value);
    }else if(message.type==='revert'){this.draft=structuredClone(this.saved);this.conflict=false;this.comparison='draft';if(this.editTarget.startsWith('palette:')&&this.editTarget!=='palette:house'&&!this.draft.palettes.some(p=>'palette:'+p.id===this.editTarget))this.editTarget='palette:house';await this.present();return;}
    else if(message.type==='assign'&&'family'in message&&(message.family==='all'||message.family==='data'||message.family==='document')&&typeof value==='string'){
      if(value===''&&message.family!=='all')delete candidate.assignments[message.family];else candidate.assignments[message.family]=value;
    }else if(message.type==='new'||message.type==='duplicate'){
      const id=randomUUID(),name='name'in message&&typeof message.name==='string'?message.name.trim():'';
      if(!name)throw new Error('Enter a palette name');
      if(message.type==='duplicate')duplicatePalette(candidate,this.editTarget.startsWith('palette:')?this.editTarget.slice(8):'house',id,name);
      else candidate.palettes.push({id,name,blendBackground:{...housePalette.blendBackground},roles:{}});
      this.editTarget='palette:'+id;
    }else if(message.type==='rename'&&typeof value==='string'){
      const palette=candidate.palettes.find(p=>'palette:'+p.id===this.editTarget);if(!palette)throw new Error('Duplicate House to edit it');palette.name=value.trim();
    }else if(message.type==='delete'){
      deletePalette(candidate,this.editTarget.slice(8));this.editTarget='palette:house';
    }else if(message.type==='property'&&'property'in message&&typeof message.property==='string'&&styleProperties.some(p=>p===message.property)){
      const target=this.target(candidate);if(!target)throw new Error('House is read only; duplicate it to make a palette');
      const entry=target[this.role]??(target[this.role]={}),style=entry[this.mode]??(entry[this.mode]={});
      if(value===null)Reflect.deleteProperty(style,message.property);else Object.assign(style,{[message.property]:value});
      if(Object.keys(style).length===0)delete entry[this.mode];if(Object.keys(entry).length===0)delete target[this.role];
    }else if(message.type==='inherit'&&typeof value==='string'){
      const target=this.target(candidate);if(!target)throw new Error('Duplicate House to edit it');const entry=target[this.role]??(target[this.role]={});
      if(value)entry.inherits=value;else delete entry.inherits;
    }else if(message.type==='save'){
      if(this.conflict)throw new Error('Configuration changed elsewhere. Revert to load it before saving.');
      if(this.destination==='workspace'&&!vscode.workspace.workspaceFolders?.length)throw new Error('Open a workspace to save workspace settings');
      if(this.destination==='user'&&vscode.workspace.getConfiguration('hson.appearance').inspect('state')?.workspaceValue!==undefined)throw new Error('Workspace appearance takes precedence here. Choose Workspace to save the active appearance.');
      this.saving=true;try{await vscode.workspace.getConfiguration('hson.appearance').update('state',readAppearance(this.draft),this.destination==='user'?vscode.ConfigurationTarget.Global:vscode.ConfigurationTarget.Workspace);this.reload();}finally{this.saving=false;}
      await this.present();return;
    }else if(message.type==='export'){
      const id=this.editTarget.slice(8),palette=id==='house'?housePalette:this.draft.palettes.find(p=>p.id===id);
      if(!this.editTarget.startsWith('palette:')||!palette)throw new Error('Select a palette to export');
      const document=await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(palette,null,2)+'\n'});
      await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.Two,preview:false});return;
    }else return;
    const changed=JSON.stringify(candidate)!==JSON.stringify(this.draft);
    this.draft=readAppearance(candidate);if(changed)this.comparison='draft';await this.present();
  }
  private async present():Promise<void>{
    if(!this.panel)return;
    await this.renderer.setAppearance(this.comparison==='saved'?this.saved:this.draft);
    const id=this.editTarget.slice(8),palette=id==='house'?housePalette:this.draft.palettes.find(p=>p.id===id);
    const family:Family=this.editTarget==='override:data'?'data':this.editTarget==='override:document'?'document':'all';
    const roles=this.editTarget.startsWith('palette:')?palette?.roles:this.draft.overrides[family];
    const effective=this.editTarget.startsWith('palette:')?{...this.draft,assignments:{all:id},overrides:{}}:this.draft;
    await this.panel.webview.postMessage({type:'state',draft:this.draft,comparison:this.comparison,dirty:JSON.stringify(this.saved)!==JSON.stringify(this.draft),
      role:this.role,mode:this.mode,previewMode:currentMode(),target:this.editTarget,destination:this.destination,readonly:this.editTarget==='palette:house',
      nativeOwned:!!roleCatalog[this.role]?.nativeBrackets&&vscode.workspace.getConfiguration('editor',vscode.window.visibleTextEditors.find(editor=>editor.viewColumn===vscode.ViewColumn.Two)?.document).get('bracketPairColorization.enabled',true),
      authored:roles?.[this.role]?.[this.mode]??{},inherits:roles?.[this.role]?.inherits??'',resolved:resolveStyle(effective,family,this.role,this.mode),
      error:this.error||(this.conflict?'Configuration changed elsewhere; Revert before saving.':'')});
  }
  dispose():void{this.disposed=true;this.panel?.dispose();this.renderer.dispose();for(const sub of this.subscriptions)sub.dispose();this.documents.clear();}
}
