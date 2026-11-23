/** Full-theme platform adapter. Authored values live in palettes/house.json;
 * role meaning and grammar bindings live in appearance-catalog.json. */
import house from "../palettes/house.json";
import { roleCatalog, type RoleStyle } from "./appearance-model.js";
// The generator consumes a nested tree because native workbench color IDs may
// contain dots. This is a derived projection, not an additional palette model.
type Entry = {label: string; examples: {code:string; highlight:string; occurrence?:number}[]; inherits?:string; house?: Omit<RoleStyle,'inherits'>};
type Tree = {[key:string]: Tree | Entry};
function isBranch(value: Tree | Entry): value is Tree { return !("label" in value); }
const styles: Record<string, RoleStyle> = house.roles;
const hson: Tree = {};
for (const id of Object.keys(styles)) if (!Object.hasOwn(roleCatalog,id)) throw new Error("Unknown House syntax role: " + id);
for (const [id, role] of Object.entries(roleCatalog)) {
  let branch = hson; const parts = id.split('.'), leaf = parts.pop()!;
  for (const part of parts) { const child = branch[part] ?? (branch[part] = {}); if (!isBranch(child)) throw new Error("Overlapping syntax roles"); branch = child; }
  const style: RoleStyle | undefined = styles[id];
  const {inherits, ...modes} = style ?? {inherits: role.fallback};
  branch[leaf] = {label:role.label, examples:role.examples, ...(inherits ? {inherits}:{}), ...(Object.keys(modes).length ? {house:modes}:{})};
}
export const HSON_APPEARANCE = {syntax: {hson, general: house.fullTheme.general}, ui:house.fullTheme.ui, branding:house.fullTheme.branding};
export { hsonTokenDefinitions, hsonTokenModifierDefinitions, hsonTokenScopes, hsonModifiersForScopes, hsonTypeForScope, type HsonTokenType } from "./appearance-internals.js";
export { hsonIdentityMarkers, HSON_LIBRARY_SEPARATOR_COLOR_ID, type AppearanceColorKey } from "./appearance-branding.generated.js";
