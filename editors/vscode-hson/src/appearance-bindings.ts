import { roleCatalog } from "./appearance-model.js";

// Platform adapters derived from the catalog, never separately authored maps.
export const syntaxBindings = Object.fromEntries(Object.entries(roleCatalog).map(([id, role]) => [id, role.binding]));
export const tokenAppearancePaths: Record<string,string> = Object.fromEntries(Object.entries(roleCatalog).flatMap(([id, role]) => (role.tokens ?? []).map(token => [token,id])));
export const segmentBindings = Object.entries(roleCatalog).flatMap(([id, role]) => (role.segments ?? []).map(segment => ({...segment, id}))).sort((a,b)=>a.order-b.order);
export function syntaxExamplePath(scopes: readonly string[]): string | undefined {
  const segment = segmentBindings.find(s => scopes.includes(s.context) && scopes.at(-1) === s.scope);
  if (segment) return segment.id;
  let selected: string | undefined, deepest = -1;
  for (const [id, role] of Object.entries(roleCatalog)) {
    const binding = role.binding;
    if (binding.context && !scopes.includes(binding.context)) continue;
    for (const target of binding.scopes) {
      const index = scopes.lastIndexOf(target);
      if (index >= 0 && (index > deepest || index === deepest && binding.context)) {selected=id; deepest=index;}
    }
  }
  return selected;
}
export const generalRules = [
  { path: "syntax.general.comment", scopes: ["comment"] },
  { path: "syntax.general.string", scopes: ["string"] },
  { path: "syntax.general.number", scopes: ["constant.numeric"] },
  { path: "syntax.general.keyword", scopes: ["keyword", "storage", "constant.language"] },
  { path: "syntax.general.type", scopes: ["entity.name.type", "support.type"] },
  { path: "syntax.general.function", scopes: ["entity.name.function", "support.function"] },
  { path: "syntax.general.variable", scopes: ["variable", "entity.other.attribute-name"] },
  { path: "syntax.general.punctuation", scopes: ["punctuation"] },
  { path: "syntax.general.escape", scopes: ["constant.character.escape"] },
  { path: "syntax.general.invalid", scopes: ["invalid"] }
] as const;
export const generalSemanticPaths = {
  "type": "syntax.general.type",
  "class": "syntax.general.type",
  "interface": "syntax.general.type",
  "enum": "syntax.general.type",
  "typeParameter": "syntax.general.type",
  "namespace": "syntax.general.type",
  "variable": "syntax.general.variable",
  "parameter": "syntax.general.variable",
  "property": "syntax.general.variable",
  "function": "syntax.general.function",
  "method": "syntax.general.function",
  "enumMember": "syntax.general.number"
} as const;
export const uiColorOrder = ["editor.background", "editor.foreground", "foreground", "focusBorder", "editor.selectionBackground", "editor.lineHighlightBackground", "editorCursor.foreground", "editorLineNumber.foreground", "editorLineNumber.activeForeground", "sideBar.background", "sideBar.foreground", "sideBar.border", "activityBar.background", "activityBar.foreground", "statusBar.background", "statusBar.foreground", "titleBar.activeBackground", "titleBar.activeForeground", "editorGroupHeader.tabsBackground", "tab.activeBackground", "tab.activeForeground", "tab.inactiveBackground", "panel.background", "panel.border", "input.background", "input.foreground", "input.border", "list.activeSelectionBackground", "list.activeSelectionForeground", "editorBracketHighlight.foreground1", "editorBracketHighlight.foreground2", "editorBracketHighlight.foreground3", "editorBracketHighlight.foreground4", "editorBracketHighlight.foreground5", "editorBracketHighlight.foreground6"] as const;
