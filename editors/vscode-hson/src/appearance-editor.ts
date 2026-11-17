import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { appearanceHtml } from './appearance-webview.js';
import type { IGrammar } from 'vscode-textmate';
import { AppearanceRenderer } from './appearance-renderer.js';
import { AppearanceSpanCache } from './appearance-spans.js';
import { roleCatalog, housePalette, builtinPalettes, paletteById, editablePalette, initialAppearance, readAppearance, duplicatePalette, deletePalette, resolveStyle,
  styleProperties, type AppearanceState, type Mode, type Family, type RoleStyle, type StyleProperty } from './appearance-model.js';
import type { HsonBindingCache } from './binding-intelligence.js';
type Example = keyof typeof examples;
type EditScope = { target: string; mode: Mode; role: string; property: StyleProperty };
type RejectedInput = EditScope & { kind: 'property' | 'inherit'; text: string; error: string };
type HistoryEntry = { state: AppearanceState; target: string; revision: number };
const examples = {
  Document: { language: "hson", content: '// Editable Document scratchpad — paste your own Hson here.\n<section hson:part data:message=%{message} title="Attribute text" class="example"\n  <h1 "Content text"/>\n  <p title=^{message} "Hello"/>\n/>\n' },
  Data: { language: "hson", content: '// Editable Data scratchpad — paste your own Hson here.\n<catalog <\n  title "Data content"\n  tags ["alpha", "beta"]\n  count 42\n  enabled true\n>>\n' },
  Interpolation: { language: "typescript", content: 'import { Hson } from "hson-live/hson";\nconst hostValue = "Native TypeScript";\nconst document = Hson.document`\n<section title="Attribute text"\n  <p "Content text ${hostValue.toUpperCase()}"/>\n/>`;\nconst data = Hson.data`\n<catalog <\n  true "Data text"\n  false 1\n  null null\n>>`;\n' },
};
function currentMode(): Mode {return [vscode.ColorThemeKind.Light,vscode.ColorThemeKind.HighContrastLight].includes(vscode.window.activeColorTheme.kind)?'light':'dark';}
function configured(configuration = vscode.workspace.getConfiguration('hson.appearance')): AppearanceState {
  const setting = configuration.inspect('state');
  if (setting?.workspaceValue !== undefined) return readAppearance(setting.workspaceValue);
  if (setting?.globalValue !== undefined) return readAppearance(setting.globalValue);
  return readAppearance(setting?.defaultValue);
}
function sameAppearance(a: AppearanceState, b: AppearanceState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
  private activeExample:Example='Document';
  private mode=currentMode();
  private themeModePending=false;
  private destination:'user'|'workspace'='user';
  private error='';
  private conflict=false;
  private configurationError = '';
  private saving?: { snapshot: AppearanceState; destination: 'user' | 'workspace' };
  private switchingExample = false;
  private disposed=false;
  private opening?:Promise<void>;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private draftRevision = 0;
  private historyBaseline?: HistoryEntry;
  private revision = 0;
  private editGroup?: string;
  private activeEdit?: EditScope & { group: string };
  private rejectedInputs: RejectedInput[] = [];
  private inputSequence = 0;
  private inputRevision = 0;
  private revertConfirmation?: (confirmed: boolean) => void;
  constructor(_extensionPath:string,grammar:Promise<IGrammar>,bindings:HsonBindingCache){
    this.configurationChanged();
    this.renderer=new AppearanceRenderer(grammar,new AppearanceSpanCache(bindings),()=>this.saved);
    void this.renderer.refresh();
    this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event=>{
      if(event.affectsConfiguration('hson.appearance.state')) this.configurationChanged();
      else if(event.affectsConfiguration('editor.bracketPairColorization')) void this.present();
    }),vscode.window.onDidChangeActiveColorTheme(()=>{
      this.themeModePending = true;
      this.followThemeWhenReady();
      void this.present();
    }));
  }
  private configuration() {
    return vscode.workspace.getConfiguration('hson.appearance');
  }
  private validTarget(target: string): boolean {
    return [...builtinPalettes.map(p => 'palette:' + p.id), 'override:all', 'override:data', 'override:document'].includes(target)
      || this.draft.palettes.some(palette => target === 'palette:' + palette.id);
  }
  private normalizeTarget(): void {
    if (!this.validTarget(this.editTarget)) this.editTarget = 'palette:house';
  }
  private configurationChanged(): void {
    this.acceptConfiguration(this.configuration());
    void this.present();
  }
  private acceptConfiguration(configuration: vscode.WorkspaceConfiguration, ignoreSaveEcho = true): void {
    try {
      const current = configured(configuration);
      this.configurationError = '';
      // The completion of our own write advances Saved without replacing Draft.
      if (ignoreSaveEcho && this.saving && sameAppearance(current, this.saving.snapshot)) return;
      if (sameAppearance(current, this.saved)) return;
      if (!this.saving && !this.conflict && !this.hasLocalWork()) {
        this.draft = structuredClone(current);
        this.undoStack = []; this.redoStack = []; this.draftRevision = ++this.revision; this.historyBaseline = undefined; this.clearInputs();
        this.normalizeTarget();
      } else {
        this.conflict = true;
      }
      this.saved = current; this.revision++;
    } catch (error) {
      this.configurationError = 'Fix hson.appearance.state in Settings before saving. ' + String(error);
    }
  }
  async open():Promise<void>{
    if(this.disposed)return;if(this.opening)return this.opening;
    this.opening=this.openPanel().finally(()=>{this.opening=undefined;});return this.opening;
  }
  private async openPanel():Promise<void>{
    if(!this.panel){
      const panel=this.panel=vscode.window.createWebviewPanel('hson.appearance','Hson Appearance',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
      const events=[panel.onDidDispose(()=>{
        this.panel=undefined;
        this.activeEdit=undefined;this.editGroup=undefined;
        this.followThemeWhenReady();
        this.revertConfirmation?.(false);this.revertConfirmation=undefined;
        void this.renderer.setAppearance(undefined);for(const event of events)event.dispose();
      }),
        panel.webview.onDidReceiveMessage((message:unknown)=>{void this.receive(message).catch(error=>{this.error=String(error);void this.present();});})];
      panel.webview.html=appearanceHtml();
    }
    await vscode.commands.executeCommand('vscode.setEditorLayout',{orientation:0,groups:[{size:.48},{size:.52}]});
    this.panel.reveal(vscode.ViewColumn.One,true);await this.selectExample(this.activeExample);
  }
  private async selectExample(example: Example): Promise<void> {
    if (this.switchingExample) return;
    this.switchingExample = true;
    try {
      await this.present();
      await this.showExample(example);
    } finally {
      this.switchingExample = false;
      await this.present();
    }
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
    this.activeExample=example;
  }
  private target(state:AppearanceState, edit = false):Record<string,RoleStyle>|undefined {
    if(this.editTarget.startsWith('palette:'))return (edit ? editablePalette(state,this.editTarget.slice(8)) : paletteById(state,this.editTarget.slice(8)))?.roles;
    const family=this.editTarget.slice(9);if(family!=='all'&&family!=='data'&&family!=='document')return;
    return state.overrides[family]??(edit ? state.overrides[family]={} : undefined);
  }
  private followThemeWhenReady(): boolean {
    if (!this.themeModePending || this.activeEdit || this.rejectedInputs.length) return false;
    this.themeModePending = false;
    const mode = currentMode();
    if (mode === this.mode) return false;
    this.mode = mode;
    return true;
  }
  private hasLocalWork(): boolean {
    return !sameAppearance(this.draft, this.saved) || !!this.undoStack.length || !!this.redoStack.length
      || !!this.rejectedInputs.length || !!this.activeEdit || !!this.error;
  }
  private historyEntry(): HistoryEntry {
    return {state: this.draft, target: this.editTarget, revision: this.draftRevision};
  }
  private normalizeHistory(): void {
    const baseline = this.historyBaseline;
    if (!baseline) return;
    if (this.draftRevision === baseline.revision) { this.undoStack = []; return; }
    const undo = this.undoStack.findIndex(entry => entry.revision === baseline.revision);
    if (undo >= 0) { this.undoStack = this.undoStack.slice(undo); return; }
    // Keep the baseline reachable when the bounded history drops old entries.
    this.undoStack.unshift(baseline);
  }
  private clearInputs(discard: (input: RejectedInput) => boolean = () => true): void {
    this.rejectedInputs = this.rejectedInputs.filter(input => !discard(input)); this.inputRevision++; this.editGroup = undefined;
    this.activeEdit = undefined;
    this.followThemeWhenReady();
  }
  private async confirmRevert(): Promise<boolean> {
    if(this.revertConfirmation || !this.panel)return false;
    const confirmed=new Promise<boolean>(resolve=>{this.revertConfirmation=resolve;});
    void this.present();
    return confirmed;
  }
  private async receive(message:unknown):Promise<void>{
    if(!message||typeof message!=='object'||!('type'in message))return;
    const value='value'in message?message.value:undefined;
    const group = 'editGroup' in message && typeof message.editGroup === 'string' ? message.editGroup : undefined;
    if (message.type === 'begin-edit') {
      if (!group || !('inputRevision' in message) || message.inputRevision !== this.inputRevision) return;
      const role = 'role' in message && typeof message.role === 'string' && Object.hasOwn(roleCatalog, message.role) ? message.role : this.role;
      const property = 'property' in message ? styleProperties.find(property => property === message.property) : 'foreground';
      if (!property || ('target' in message && message.target !== this.editTarget)) return;
      const mode = 'mode' in message && (message.mode === 'light' || message.mode === 'dark') ? message.mode : this.mode;
      this.activeEdit = {group, target: this.editTarget, role, property, mode};
      // Focus can arrive while a theme update is still on its way to the panel.
      if (!this.rejectedInputs.length && 'mode' in message && (message.mode === 'light' || message.mode === 'dark') && message.mode !== this.mode) {
        this.themeModePending = true;
        this.mode = message.mode;
        return this.present();
      }
      return;
    }
    if (message.type === 'end-edit') {
      if (group === this.editGroup) this.editGroup = undefined;
      if (group === this.activeEdit?.group) {
        this.activeEdit = undefined;
        if (this.followThemeWhenReady()) return this.present();
      }
      return;
    }
    if (message.type !== 'save') this.error = '';
    if (message.type === 'confirm-revert' && typeof value === 'boolean') {
      this.revertConfirmation?.(value);this.revertConfirmation=undefined;
      return this.present();
    }
    if (message.type === 'ready') { this.inputSequence = 0; return this.present(); }
    if (message.type === 'example' && (value === 'Document' || value === 'Data' || value === 'Interpolation')) {
      return this.selectExample(value);
    }
    if (message.type === 'compare' && (value === 'saved' || value === 'draft')) {
      this.comparison = value;
      return this.present();
    }
    if (message.type === 'role' && typeof value === 'string' && Object.hasOwn(roleCatalog, value)) {
      if (this.role !== value) this.clearInputs(() => false);
      this.role = value;
      return this.present();
    }
    if (message.type === 'target') {
      if(this.rejectedInputs.length)throw new Error('Correct or reset invalid input before changing palettes.');
      if (typeof value !== 'string' || !this.validTarget(value)) throw new Error('Choose an available edit target');
      this.editTarget = value;
      this.clearInputs();
      return this.present();
    }
    if (message.type === 'mode' && (value === 'light' || value === 'dark')) {
      if(this.rejectedInputs.length)throw new Error('Correct or reset invalid input before changing modes.');
      this.themeModePending = false;
      this.mode = value;
      this.clearInputs();
      return this.present();
    }
    if (message.type === 'destination' && (value === 'user' || value === 'workspace')) {
      this.destination = value;
      return this.present();
    }
    if (message.type === 'revert') {
      if (this.saving || this.configurationError) return this.present();
      const revision = this.revision;
      if (this.hasLocalWork() && !await this.confirmRevert()) return;
      if (this.saving || this.configurationError || revision !== this.revision) throw new Error('Appearance changed while confirming. Review the working changes before reverting.');
      this.draft = structuredClone(this.saved);
      this.undoStack = []; this.redoStack = []; this.draftRevision = ++this.revision; this.historyBaseline = undefined; this.clearInputs();
      this.conflict = false;
      this.comparison = 'draft';
      this.normalizeTarget();
      return this.present();
    }
    if (message.type === 'undo' || message.type === 'redo') {
      const from = message.type === 'undo' ? this.undoStack : this.redoStack;
      const to = message.type === 'undo' ? this.redoStack : this.undoStack;
      const previous = from.pop();
      if (previous) {
        to.push(this.historyEntry());
        this.revision++; this.draftRevision = previous.revision;
        this.draft = previous.state; this.editTarget = previous.target; this.normalizeTarget();
        this.normalizeHistory();
      }
      this.clearInputs(); this.comparison = 'draft';
      return this.present();
    }
    if (message.type === 'discard-input') { this.clearInputs(); return this.present(); }
    if (message.type === 'save') return this.save();
    if (message.type === 'export') {
      const id = this.editTarget.slice(8);
      if (this.rejectedInputs.length) throw new Error('Correct or reset invalid input before exporting.');
      const palette = paletteById(this.draft,id);
      if (!this.editTarget.startsWith('palette:') || !palette) throw new Error('Select a palette to export');
      const source = {...builtinPalettes.find(p=>p.id===id),...palette};
      const document = await vscode.workspace.openTextDocument({language: 'json', content: JSON.stringify(source, null, 2) + '\n'});
      await vscode.window.showTextDocument(document, {viewColumn: vscode.ViewColumn.Two, preview: false});
      return;
    }

    if ('inputRevision' in message && message.inputRevision !== this.inputRevision) return this.present();
    const gesture = group === this.activeEdit?.group ? this.activeEdit : undefined;
    if (message.type === 'property' && group && 'inputRevision' in message && !gesture) return this.present();
    const previousTarget = this.editTarget;
    const field = gesture?.property ?? ('property' in message ? styleProperties.find(property => property === message.property) : 'foreground');
    const role = gesture?.role ?? ('role' in message && typeof message.role === 'string' && Object.hasOwn(roleCatalog,message.role) ? message.role : this.role);
    const mode = gesture?.mode ?? ('mode' in message && (message.mode === 'light' || message.mode === 'dark') ? message.mode : this.mode);
    if ((message.type === 'property' || message.type === 'inherit') && 'inputSequence' in message && typeof message.inputSequence === 'number') {
      this.inputSequence = message.inputSequence;
    }
    if ('target' in message && message.target !== previousTarget) throw new Error('The edit target changed. Try the edit again.');
    const matchesField = (input: RejectedInput) => input.target === previousTarget && input.mode === mode && input.role === role && input.property === field;
    if (this.rejectedInputs.length && ['new','duplicate','delete','restore'].includes(String(message.type))) {
      throw new Error('Correct or reset invalid input before changing palettes.');
    }
    const candidate = structuredClone(this.draft);
    if(message.type==='assign'&&'family'in message&&(message.family==='all'||message.family==='data'||message.family==='document')&&typeof value==='string'){
      if(value===''&&message.family!=='all')delete candidate.assignments[message.family];else candidate.assignments[message.family]=value;
    }else if(message.type==='apply'&&this.editTarget.startsWith('palette:')){
      candidate.assignments.all=this.editTarget.slice(8);
    }else if(message.type==='restore'&&this.editTarget.startsWith('palette:')){
      const id=this.editTarget.slice(8);
      if(!builtinPalettes.some(p=>p.id===id))throw new Error('Select a built-in palette to restore');
      candidate.palettes=candidate.palettes.filter(p=>p.id!==id);
      this.clearInputs();
    }else if(message.type==='new'||message.type==='duplicate'){
      const id=randomUUID(),name='name'in message&&typeof message.name==='string'?message.name.trim():'';
      if(!name)throw new Error('Enter a palette name');
      if(message.type==='duplicate')duplicatePalette(candidate,this.editTarget.startsWith('palette:')?this.editTarget.slice(8):'house',id,name);
      else candidate.palettes.push({id,name,blendBackground:{...housePalette.blendBackground},roles:{}});
      this.editTarget='palette:'+id;
    }else if(message.type==='rename'&&typeof value==='string'){
      const palette=editablePalette(candidate,this.editTarget.slice(8));if(!palette)throw new Error('Select a palette');palette.name=value.trim();
    }else if(message.type==='delete'){
      deletePalette(candidate,this.editTarget.slice(8));this.editTarget='palette:house';
    }else if(message.type==='property'&&field){
      if (group && !gesture) this.activeEdit = {group, target: previousTarget, role, mode, property: field};
      const target=this.target(candidate,true);if(!target)throw new Error('Select an edit target');
      const entry=target[role]??(target[role]={}),style=entry[mode]??(entry[mode]={});
      if(value===null)Reflect.deleteProperty(style,field);else Object.assign(style,{[field]:value});
      if(Object.keys(style).length===0)delete entry[mode];if(Object.keys(entry).length===0)delete target[role];
    }else if(message.type==='reset'&&field){
      const target=this.target(candidate,true);if(!target)return;
      const saved=this.target(this.saved)?.[role],entry=target[role]??(target[role]={}),style=entry[mode]??(entry[mode]={});
      Reflect.deleteProperty(style,field);
      if(saved?.[mode]&&Object.hasOwn(saved[mode]!,field))Object.assign(style,{[field]:Reflect.get(saved[mode]!,field)});
      if(field==='foreground'){if(saved?.inherits)entry.inherits=saved.inherits;else delete entry.inherits;}
      if(!Object.keys(style).length)delete entry[mode];if(!Object.keys(entry).length)delete target[role];
    }else if(message.type==='inherit'&&typeof value==='string'){
      const target=this.target(candidate,true);if(!target)throw new Error('Select an edit target');const entry=target[role]??(target[role]={});
      const style=entry[mode]??(entry[mode]={});
      // Existing role links are shared by both modes and all unauthored properties.
      // Native is a per-property delegation, never a role link.
      if('materialize'in message&&message.materialize===true)style.foreground=value;
      else if(value==='native')style.foreground='native';
      else {delete style.foreground;if(value)entry.inherits=value;else delete entry.inherits;}
    } else return;
    candidate.palettes=candidate.palettes.filter(p=>this.saved.palettes.some(saved=>saved.id===p.id)||!builtinPalettes.some(b=>JSON.stringify({id:b.id,name:b.name,blendBackground:b.blendBackground,roles:b.roles})===JSON.stringify(p)));
    let validated: AppearanceState;
    try { validated = readAppearance(candidate); }
    catch(error) {
      if ((message.type === 'property' || message.type === 'inherit') && field) {
        const kind = message.type;
        const text = 'text' in message && typeof message.text === 'string' ? message.text : String(value ?? '');
        this.rejectedInputs = this.rejectedInputs.filter(input => !(matchesField(input) && input.kind === kind));
        this.rejectedInputs.push({kind, target: previousTarget, mode, role, property: field, text, error: String(error)});
        this.revision++;
        if (this.mode !== mode) this.themeModePending = true;
        this.mode = mode; this.role = role;
      }
      this.editTarget=previousTarget;
      throw error;
    }
    this.role = role;
    if (message.type === 'property' || message.type === 'inherit') {
      this.rejectedInputs = this.rejectedInputs.filter(input => !(matchesField(input) && input.kind === message.type));
    }
    if (message.type === 'reset' || (message.type === 'inherit' && 'materialize' in message && message.materialize === true)) this.clearInputs(matchesField);
    if (!sameAppearance(validated, this.draft)) {
      if(!group || group!==this.editGroup)this.undoStack.push({...this.historyEntry(), target:previousTarget});
      this.draftRevision = ++this.revision;
      if(this.undoStack.length>100)this.undoStack.shift();
      this.redoStack=[];this.editGroup=group;
      this.draft = validated;
      this.normalizeHistory();
      this.comparison = 'draft';
    }
    this.followThemeWhenReady();
    await this.present();
  }
  private async save(): Promise<void> {
    if (this.saving) return;
    if (this.rejectedInputs.length) throw new Error('Correct or reset invalid input before saving.');
    if (this.error) throw new Error(this.error);
    const configuration = this.configuration();
    this.acceptConfiguration(configuration);
    if (this.configurationError) throw new Error(this.configurationError);
    if (this.conflict) throw new Error('Configuration changed elsewhere. Revert to load it before saving.');
    if (sameAppearance(this.draft, this.saved)) return this.present();
    const destination = this.destination;
    if (destination === 'workspace' && !vscode.workspace.workspaceFolders?.length) {
      throw new Error('Open a workspace to save workspace settings');
    }
    if (destination === 'user' && configuration.inspect('state')?.workspaceValue !== undefined) {
      throw new Error('Workspace appearance takes precedence here. Choose Workspace to save the active appearance.');
    }
    const snapshot = readAppearance(this.draft);
    const baseline = {...this.historyEntry(), state:snapshot};
    const previousBaseline = this.historyBaseline, previousUndo = this.undoStack;
    // Establish the boundary at capture, so navigation never depends on write
    // latency. The detached prefix remains recoverable if persistence fails.
    this.historyBaseline = baseline; this.normalizeHistory();
    this.editGroup=undefined;
    this.saving = {snapshot, destination};
    try {
      // Start the write before yielding so no local action can change its snapshot or destination.
      const write = configuration.update('state', snapshot, destination === 'user'
        ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace);
      void this.present();
      await write;
      this.saved = snapshot;
    } catch (error) {
      this.historyBaseline = previousBaseline;
      this.undoStack = [...previousUndo, ...this.undoStack];
      this.normalizeHistory();
      throw error;
    } finally {
      // The final read can be the first time we see an external change.
      this.acceptConfiguration(this.configuration(), false);
      this.saving = undefined;
    }
    await this.present();
  }
  private async present():Promise<void>{
    const panel = this.panel;
    if (!panel) return;
    await this.renderer.setAppearance(this.comparison==='saved'?this.saved:this.draft,this.mode);
    if (this.panel !== panel) return;
    const id=this.editTarget.slice(8),palette=paletteById(this.draft,id);
    const family:Family=this.editTarget==='override:data'?'data':this.editTarget==='override:document'?'document':'all';
    const roles=this.editTarget.startsWith('palette:')?palette?.roles:this.draft.overrides[family];
    const effective=this.editTarget.startsWith('palette:')?{...this.draft,assignments:{all:id},overrides:{}}:this.draft;
    const nativeBrackets=vscode.workspace.getConfiguration('editor',vscode.window.visibleTextEditors.find(editor=>editor.viewColumn===vscode.ViewColumn.Two)?.document).get('bracketPairColorization.enabled',true);
    const savedPalette=paletteById(this.saved,id);
    const savedRoles=this.editTarget.startsWith('palette:')?savedPalette?.roles:this.saved.overrides[family];
    // Presentation projection only: every row uses the production resolver.
    const rows=Object.fromEntries(Object.keys(roleCatalog).map(role=>[role,{
      changed:JSON.stringify(roles?.[role]??{})!==JSON.stringify(savedRoles?.[role]??{}),
      authored:roles?.[role]?.[this.mode]??{}, inherits:roles?.[role]?.inherits??'',
      saved:savedRoles?.[role]?.[this.mode]??{}, savedInherits:savedRoles?.[role]?.inherits??'',
      resolved:resolveStyle(effective,family,role,this.mode), nativeOwned:!!roleCatalog[role]?.nativeBrackets&&nativeBrackets,
    }]));
    await panel.webview.postMessage({type:'state',draft:this.draft,comparison:this.comparison,dirty:JSON.stringify(this.saved)!==JSON.stringify(this.draft),
      rows,confirmingRevert:!!this.revertConfirmation,builtins:builtinPalettes.map(p=>({id:p.id,name:p.name})),canUndo:!!this.undoStack.length,canRedo:!!this.redoStack.length,inputRevision:this.inputRevision,inputSequence:this.inputSequence,rejectedInputs:this.rejectedInputs,saving:!!this.saving,switchingExample:this.switchingExample,configurationInvalid:!!this.configurationError,conflict:this.conflict,assignmentsChanged:JSON.stringify(this.saved.assignments)!==JSON.stringify(this.draft.assignments),activeExample:this.activeExample,role:this.role,mode:this.mode,previewMode:currentMode(),target:this.editTarget,destination:this.destination,
      nativeOwned:rows[this.role]?.nativeOwned,
      authored:roles?.[this.role]?.[this.mode]??{},inherits:roles?.[this.role]?.inherits??'',resolved:resolveStyle(effective,family,this.role,this.mode),
      error:[...new Set([this.configurationError, ...this.rejectedInputs.map(input => input.error), this.error, this.conflict?'Configuration changed elsewhere; Revert before saving.':''].filter(Boolean))].join('\n')});
  }
  dispose():void{this.disposed=true;this.panel?.dispose();this.renderer.dispose();for(const sub of this.subscriptions)sub.dispose();this.documents.clear();}
}
