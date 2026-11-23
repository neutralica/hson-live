import catalogData from './appearance-catalog.json';
import houseData from '../palettes/house.json';

export type Mode = 'light' | 'dark';
export type Family = 'all' | 'data' | 'document';
export type Style = { foreground?: string; intensity?: number | 'native'; fontStyle?: string; bold?: boolean | 'native'; italic?: boolean | 'native'; underline?: boolean | 'native'; strikethrough?: boolean | 'native' };
export type RoleStyle = { inherits?: string; light?: Style; dark?: Style };
export type Palette = { id: string; name: string; blendBackground: Record<Mode, string>; roles: Record<string, RoleStyle> };
export type AppearanceState = { palettes: Palette[]; assignments: { all: string; data?: string; document?: string }; overrides: Partial<Record<Family, Record<string, RoleStyle>>> };
export type RoleDefinition = { label: string; examples: {code: string; highlight: string; occurrence?: number}[]; binding: {scopes: string[]; selector: string; context?: string; eventRole?: string}; tokens?: string[]; fallback?: string; nativeBrackets?: boolean; segments?: {order:number; grammarOrder:number; context: string; scope: string; selector: string}[] };
export const roleCatalog: Readonly<Record<string, RoleDefinition>> = catalogData.roles;
// The bundled baseline never participates in mutable editor state.
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const housePalette: Palette = freeze(houseData);
export const builtinPalettes: readonly Palette[] = Object.freeze([housePalette]);
export const styleProperties = ['foreground', 'intensity', 'fontStyle', 'bold', 'italic', 'underline', 'strikethrough'] as const;
export type StyleProperty = typeof styleProperties[number];
export function initialAppearance(): AppearanceState { return {palettes: [], assignments: {all: 'native'}, overrides: {}}; }
export function appearanceColor(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return;
  return value.length < 6 ? '#' + [...value.slice(1)].map(char => char + char).join('') : value;
}
export function blend(foreground: string, background: string, intensity = 1): string {
  const color = appearanceColor(foreground), base = appearanceColor(background);
  if (!color || !base || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) throw new Error('Invalid RGB blend');
  return '#' + [1,3,5].map(i => Math.round(parseInt(color.slice(i,i+2),16)*intensity+parseInt(base.slice(i,i+2),16)*(1-intensity)).toString(16).padStart(2,'0')).join('') + color.slice(7);
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[]): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error('Unknown appearance property: ' + key); }
function validateRoles(value: unknown): asserts value is Record<string, RoleStyle> {
  if (!object(value)) throw new Error('Expected role styles');
  for (const [id, entry] of Object.entries(value)) {
    if (!Object.hasOwn(roleCatalog,id) || !object(entry)) throw new Error('Unknown role: ' + id);
    keys(entry, ['inherits','light','dark']);
    if (entry.inherits !== undefined && (typeof entry.inherits !== 'string' || !Object.hasOwn(roleCatalog,entry.inherits))) throw new Error('Unknown inherited role: ' + entry.inherits);
    for (const mode of ['light','dark']) {
      const style = entry[mode]; if (style === undefined) continue;
      if (!object(style)) throw new Error('Expected style: '+id);
      keys(style, styleProperties);
      for (const [property, field] of Object.entries(style)) {
        if (field === 'native') continue;
        if (property === 'foreground' ? !appearanceColor(field)
          : property === 'intensity' ? typeof field !== 'number' || !Number.isFinite(field) || field < 0 || field > 1
          : property === 'fontStyle' ? typeof field !== 'string' || field.split(/\s+/).filter(Boolean).some(flag => !['bold','italic','underline','strikethrough'].includes(flag))
          : typeof field !== 'boolean') throw new Error('Invalid '+id+'.'+mode+'.'+property);
      }
    }
  }
  for (const id of Object.keys(value)) { const seen = new Set<string>(); let next: string | undefined = id;
    while (next) { if (seen.has(next)) throw new Error('Role inheritance cycle: '+id); seen.add(next); const entry: unknown = value[next]; next = object(entry) && typeof entry.inherits === 'string' ? entry.inherits : roleCatalog[next]?.fallback; }
  }
}
export function validatePalette(value: unknown): asserts value is Palette {
  if (!object(value)) throw new Error('Expected palette');
  keys(value,['id','name','blendBackground','roles']);
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value.id) || value.id === 'native') throw new Error('Invalid palette ID');
  if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('Palette name is required');
  if (!object(value.blendBackground)) throw new Error('Expected blend backgrounds');
  keys(value.blendBackground,['light','dark']);
  for (const mode of ['light','dark']) if (typeof value.blendBackground[mode] !== 'string' || !/^#[\da-f]{6}$/i.test(value.blendBackground[mode])) throw new Error('Blend backgrounds must be opaque RGB');
  validateRoles(value.roles);
}
export function readAppearance(value: unknown): AppearanceState {
  if (value === undefined) return initialAppearance();
  if (!object(value)) throw new Error('Expected appearance configuration');
  keys(value,['palettes','assignments','overrides']);
  if (!Array.isArray(value.palettes) || !object(value.assignments) || !object(value.overrides)) throw new Error('Invalid appearance configuration');
  const ids = new Set(['native']);
  for (const palette of value.palettes) { validatePalette(palette); if (ids.has(palette.id)) throw new Error('Duplicate palette ID: '+palette.id); ids.add(palette.id); }
  for (const palette of builtinPalettes) ids.add(palette.id);
  keys(value.assignments,['all','data','document']); keys(value.overrides,['all','data','document']);
  if (typeof value.assignments.all !== 'string') throw new Error('All Hson assignment is required');
  for (const id of Object.values(value.assignments)) if (typeof id !== 'string' || !ids.has(id)) throw new Error('Unknown palette selection: '+id);
  for (const roles of Object.values(value.overrides)) validateRoles(roles);
  // The validated JSON snapshot is detached from VS Code configuration objects.
  return JSON.parse(JSON.stringify(value));
}
export function paletteById(state: AppearanceState, id: string): Palette | undefined { return state.palettes.find(p => p.id === id) ?? builtinPalettes.find(p => p.id === id); }
export function editablePalette(state: AppearanceState, id: string): Palette | undefined {
  let palette = state.palettes.find(p => p.id === id);
  const baseline = builtinPalettes.find(p => p.id === id);
  if (!palette && baseline) {
    // Bundled source also carries full-theme generation data; settings keep the
    // established syntax palette schema and never acquire workbench colors.
    palette = {id:baseline.id,name:baseline.name,blendBackground:{...baseline.blendBackground},roles:structuredClone(baseline.roles)};
    state.palettes.push(palette);
  }
  return palette;
}
export function duplicatePalette(state: AppearanceState, source: string, id: string, name: string): Palette {
  const original = paletteById(state,source); if (!original) throw new Error('Select a palette to duplicate');
  const palette: Palette = {id,name,blendBackground:{...original.blendBackground},roles:structuredClone(original.roles)};
  validatePalette(palette); if (id === 'house' || paletteById(state,id)) throw new Error('Palette ID already exists');
  state.palettes.push(palette); return palette;
}
export function deletePalette(state: AppearanceState, id: string): void {
  if (builtinPalettes.some(p => p.id === id)) throw new Error('Palette is built in; restore its shipped baseline instead');
  if (Object.values(state.assignments).includes(id)) throw new Error('Reassign this palette before deleting it');
  state.palettes = state.palettes.filter(p=>p.id!==id);
}
export type ResolvedStyle = { style: Style; sources: Partial<Record<StyleProperty,string>>; background?: string; rawForeground?: string };
export function resolveStyle(state: AppearanceState, family: Family, role: string, mode: Mode): ResolvedStyle {
  const selected = state.assignments[family] ?? state.assignments.all, palette = paletteById(state,selected);
  const sources: ResolvedStyle['sources'] = {}, style: Style = {};
  for (const property of styleProperties) {
    const follow = (roles: Record<string,RoleStyle>, id: string, seen = new Set<string>()): {value:unknown;role:string}|undefined => {
      if (seen.has(id)) return undefined; seen.add(id);
      const entry = roles[id], field = entry?.[mode]?.[property];
      if (field !== undefined) return {value:field,role:id};
      return entry?.inherits ? follow(roles,entry.inherits,seen) : undefined;
    };
    const lookup = (id: string, seen = new Set<string>()): {value: unknown; source: string} => {
      if (seen.has(id)) return {value: undefined,source:'Native VS Code'}; seen.add(id);
      for (const scope of family === 'all' ? ['all'] as const : [family,'all'] as const) {
        const found = follow(state.overrides[scope] ?? {},id); if (found) return {value:found.value,source:scope+' override · '+found.role};
      }
      const found = palette && follow(palette.roles,id); if (found && palette) return {value:found.value,source:palette.name+' · '+found.role};
      const fallback = roleCatalog[id]?.fallback; return fallback ? lookup(fallback,seen) : {value:undefined,source:'Native VS Code'};
    };
    const {value,source} = lookup(role); sources[property] = value === 'native' ? 'Explicit Native' : source;
    if (value !== undefined && (value !== 'native' || ['bold','italic','underline','strikethrough'].includes(property))) Object.assign(style,{[property]:value});
  }
  // Native intensity is an explicit stop: it never exposes a lower-layer blend.
  const background = palette?.blendBackground[mode] ?? housePalette.blendBackground[mode];
  const rawForeground = style.foreground;
  if (style.foreground) style.foreground = blend(style.foreground,background,typeof style.intensity === 'number' ? style.intensity : 1);
  return {style,sources,background,rawForeground};
}
