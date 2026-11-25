import * as vscode from 'vscode';
import type { IGrammar } from 'vscode-textmate';
import { AppearanceSpanCache } from './appearance-spans.js';
import { initialAppearance, resolveStyle, roleCatalog, type AppearanceState, type Family, type Style, type Mode } from './appearance-model.js';
import type { ScratchpadContext } from './scratchpads.js';

function renderStyle(style: Style): vscode.DecorationRenderOptions {
  const options: vscode.DecorationRenderOptions = {rangeBehavior:vscode.DecorationRangeBehavior.ClosedClosed};
  if (style.foreground) options.color=style.foreground;
  const flags = style.fontStyle === undefined ? undefined : style.fontStyle.split(/\s+/);
  const flag = (key:'bold'|'italic'|'underline'|'strikethrough') => style[key] === 'native' ? undefined : typeof style[key] === 'boolean' ? style[key] : flags?.includes(key);
  if (flag('bold') !== undefined) options.fontWeight=flag('bold')?'bold':'normal';
  if (flag('italic') !== undefined) options.fontStyle=flag('italic')?'italic':'normal';
  if (flag('underline') !== undefined || flag('strikethrough') !== undefined) options.textDecoration=[flag('underline')?'underline':'',flag('strikethrough')?'line-through':''].filter(Boolean).join(' ') || 'none';
  return options;
}
/** Saved and Draft share classification, resolution and native decorations.
 * Preview state is limited to attached scratchpads; ordinary documents use saved configuration. */
export class AppearanceRenderer implements vscode.Disposable {
  private readonly documents = new Map<vscode.TextDocument,Family>();
  private readonly decorations = new Map<string,vscode.TextEditorDecorationType>();
  private readonly applied = new WeakMap<vscode.TextEditor, ReadonlySet<string>>();
  private readonly subscriptions: vscode.Disposable[];
  private preview?: AppearanceState;
  private previewMode?: Mode;
  private disposed=false;
  constructor(private readonly grammar:Promise<IGrammar>, private readonly cache=new AppearanceSpanCache(),
    private readonly saved:(document:vscode.TextDocument)=>AppearanceState=()=>initialAppearance(),
    private readonly scratchpad:(document:vscode.TextDocument)=>ScratchpadContext|undefined=()=>undefined,
    private readonly family:(document:vscode.TextDocument)=>Family=()=> 'all') {
    this.subscriptions=[vscode.window.onDidChangeVisibleTextEditors(()=>{void this.refresh();}),
      vscode.workspace.onDidChangeTextDocument(event=>{if(event.contentChanges.length)void this.refresh(event.document);}),
      vscode.workspace.onDidCloseTextDocument(document=>{this.documents.delete(document);this.cache.forget(document.uri.toString());}),
      vscode.window.onDidChangeActiveColorTheme(()=>{void this.refresh();}),
      vscode.workspace.onDidChangeConfiguration(event=>{if(event.affectsConfiguration('hson.appearance.state')||event.affectsConfiguration('hson.authoring.mode')||event.affectsConfiguration('editor.bracketPairColorization'))void this.refresh();})];
  }
  async attach(document:vscode.TextDocument,family:Family='all'):Promise<void> {if(this.disposed)return;this.documents.set(document,family);await this.refresh();}
  async setAppearance(state:AppearanceState|undefined,mode?:Mode):Promise<void> {if(this.disposed)return;this.preview=state;this.previewMode=mode;await this.refresh();}
  async refresh(changed?:vscode.TextDocument):Promise<void> {
    const grammar=await this.grammar;if(this.disposed)return;
    const mode=[vscode.ColorThemeKind.Light,vscode.ColorThemeKind.HighContrastLight].includes(vscode.window.activeColorTheme.kind)?'light':'dark';
    const used=new Set<string>();
    for(const editor of vscode.window.visibleTextEditors){
      const document=editor.document;if((changed!==undefined&&changed!==document)||document.isClosed||!['hson','markdown','typescript','typescriptreact'].includes(document.languageId))continue;
      const context=this.scratchpad(document);
      const preview=(context||this.documents.has(document))&&this.preview;
      const source=preview||this.saved(document),renderMode=context?.mode??(preview?this.previewMode??mode:mode);
      // Palette editing previews that palette, regardless of ordinary workspace
      // assignments. This is a projection only, exactly like the color controls.
      const state:AppearanceState=context?.target.startsWith('palette:')
        ? {...source,assignments:{all:context.target.slice(8)},overrides:{}} : source;
      const nativeBrackets=vscode.workspace.getConfiguration('editor',document).get('bracketPairColorization.enabled',true);
      const spans=this.cache.get(grammar,{uri:document.uri.toString(),fileName:document.fileName,languageId:document.languageId,version:document.version,text:document.getText()},context?.family??this.documents.get(document)??this.family(document));
      const ranges=new Map<string,vscode.Range[]>(), styles=new Map<string,vscode.DecorationRenderOptions>();
      for(const span of spans){
        if(nativeBrackets&&roleCatalog[span.role]?.nativeBrackets)continue;
        const style=renderStyle(resolveStyle(state,span.family,span.role,renderMode).style);
        if(Object.keys(style).length===1)continue;
        const key=JSON.stringify(style);styles.set(key,style);const group=ranges.get(key)??[];
        group.push(new vscode.Range(document.positionAt(span.range.start),document.positionAt(span.range.end)));ranges.set(key,group);used.add(key);
      }
      for(const [key,style]of styles)if(!this.decorations.has(key))this.decorations.set(key,vscode.window.createTextEditorDecorationType(style));
      // VS Code tracks the existing ranges through edits until this replacement.
      for(const [key,group] of ranges)editor.setDecorations(this.decorations.get(key)!,group);
      for(const key of this.applied.get(editor)??[])if(!ranges.has(key)) {
        const type=this.decorations.get(key);
        if(type)editor.setDecorations(type,[]);
      }
      this.applied.set(editor,new Set(ranges.keys()));
    }
    if(changed===undefined)for(const [key,type]of this.decorations)if(!used.has(key)){type.dispose();this.decorations.delete(key);}
  }
  dispose():void {if(this.disposed)return;this.disposed=true;for(const sub of this.subscriptions)sub.dispose();for(const type of this.decorations.values())type.dispose();this.decorations.clear();this.documents.clear();this.cache.clear();}
}
