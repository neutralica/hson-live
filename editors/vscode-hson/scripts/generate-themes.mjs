import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { transform } from "esbuild";
import ts from "typescript";

const root = new URL("../", import.meta.url);
export async function appearanceSource() {
  const { code } = await transform(await readFile(new URL("src/appearance.ts", root), "utf8"), { loader: "ts", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
export function validateGrammarScopes(definitions, grammar) {
  const emitted = new Set();
  const visit = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === "name" || key === "contentName") && typeof child === "string") {
        for (const scope of child.split(/\s+/)) emitted.add(scope);
      } else visit(child);
    }
  };
  visit(grammar);
  for (const [type, definition] of Object.entries(definitions)) for (const scope of definition.scopes) {
    if (!emitted.has(scope)) throw new Error(`${type} scope is absent from the Hson grammar: ${scope}`);
  }
}
export function blend(foreground, background, intensity = 1) {
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) throw new Error(`Invalid intensity: ${intensity}`);
  if (![foreground, background].every(color => /^#[\da-f]{6}$/i.test(color))) throw new Error("House colors must be opaque RGB hex values");
  return "#" + [1, 3, 5].map(i => Math.round(parseInt(foreground.slice(i, i + 2), 16) * intensity
    + parseInt(background.slice(i, i + 2), 16) * (1 - intensity)).toString(16).padStart(2, "0")).join("");
}
export function houseTheme(appearance, definitions, mode) {
  const { house } = appearance;
  const ui = Object.fromEntries(Object.entries(house.ui).map(([key, value]) => [key, value[mode]]));
  const intensity = { ...house.intensity, ...house.intensityOverrides[mode] };
  const roles = Object.fromEntries(Object.entries(house.roles).map(([key, value]) => [key, blend(value[mode], ui.background, intensity[key])]));
  const colors = {
    "editor.background": ui.background, "editor.foreground": ui.foreground,
    "foreground": ui.foreground, "focusBorder": ui.accent,
    "editor.selectionBackground": ui.selection, "editor.lineHighlightBackground": ui.surface,
    "editorCursor.foreground": ui.accent, "editorLineNumber.foreground": roles.comment,
    "editorLineNumber.activeForeground": ui.foreground,
    "sideBar.background": ui.surface, "sideBar.foreground": ui.foreground, "sideBar.border": ui.border,
    "activityBar.background": ui.surface, "activityBar.foreground": ui.foreground,
    "statusBar.background": ui.surface, "statusBar.foreground": ui.foreground,
    "titleBar.activeBackground": ui.surface, "titleBar.activeForeground": ui.foreground,
    "editorGroupHeader.tabsBackground": ui.surface, "tab.activeBackground": ui.background,
    "tab.activeForeground": ui.foreground, "tab.inactiveBackground": ui.surface,
    "panel.background": ui.surface, "panel.border": ui.border,
    "input.background": ui.background, "input.foreground": ui.foreground, "input.border": ui.border,
    "list.activeSelectionBackground": ui.selection, "list.activeSelectionForeground": ui.foreground,
  };
  for (let i = 0; i < 6; i++) colors[`editorBracketHighlight.foreground${i + 1}`] = roles[house.bracketRoles[i % house.bracketRoles.length]];
  const rule = (scope, role) => ({ scope, settings: { foreground: roles[role] } });
  return {
    $schema: "vscode://schemas/color-theme", name: `Hson House ${mode === "dark" ? "Dark" : "Light"}`,
    type: mode, semanticHighlighting: true, colors,
    tokenColors: [
      rule(["comment"], "comment"), rule(["string"], "text"), rule(["constant.numeric"], "number"),
      rule(["keyword", "storage", "constant.language"], "primitive"), rule(["entity.name.type", "support.type"], "element"),
      rule(["entity.name.function", "support.function"], "sending"), rule(["variable", "entity.other.attribute-name"], "attribute"),
      rule(["punctuation"], "structure"), rule(["constant.character.escape"], "escape"), rule(["invalid"], "invalid"),
      ...Object.values(definitions).map(definition => rule(definition.scopes, definition.role)),
      rule([appearance.themeDerived.attributeQualifier], "qualifier"),
      rule([`${appearance.themeDerived.receiving} ${appearance.themeDerived.attributeQualifier}`], "receiving"),
      rule([`${appearance.themeDerived.receiving} ${appearance.themeDerived.attributeLocalName}`], "qualifier"),
    ],
    semanticTokenColors: {
      type: roles.element, class: roles.element, interface: roles.element, enum: roles.element,
      typeParameter: roles.element, namespace: roles.element, variable: roles.attribute, parameter: roles.attribute,
      property: roles.attribute, function: roles.sending, method: roles.sending, enumMember: roles.number,
      ...Object.fromEntries(Object.entries(definitions).map(([type, definition]) => [type, roles[definition.role]])),
      // A wildcard plus one modifier ties a base type's specificity in VS Code;
      // keep this later so qualifiers override the base without coloring locals.
      "*.hsonQualifier": roles.qualifier,
      // Receiving syntax places the binding first and its data/doc kind last.
      "hsonReceiving.hsonQualifier": roles.receiving,
      "hsonReceiving.hsonLocalName": roles.qualifier,
    },
  };
}
// Replace only generated values; preserve all other manifest text and concurrent edits.
function replaceValue(text, path, value) {
  const source = ts.parseJsonText("package.json", text);
  let node = source.statements[0].expression;
  for (const key of path) {
    const property = node.properties.find(property => property.name.text === key);
    if (!property) {
      if (key !== path.at(-1)) throw new Error(`Missing manifest parent ${path.join(".")}`);
      const last = node.properties.at(-1);
      const indent = text.slice(text.lastIndexOf("\n", last.getStart(source)) + 1, last.getStart(source)).match(/^ */)[0];
      const entry = JSON.stringify(value, null, 2).replaceAll("\n", "\n" + indent);
      return text.slice(0, last.end) + `,\n${indent}"${key}": ${entry}` + text.slice(last.end);
    }
    node = property.initializer;
  }
  const start = node.getStart(source);
  const indent = text.slice(text.lastIndexOf("\n", start) + 1, start).match(/^ */)[0];
  return text.slice(0, start) + JSON.stringify(value, null, 2).replaceAll("\n", "\n" + indent) + text.slice(node.end);
}
export async function generateThemes({ check = false } = {}) {
  const { HSON_APPEARANCE: appearance, hsonTokenDefinitions: definitions, hsonTokenScopes: scopes, hsonTokenModifierDefinitions: modifiers } = await appearanceSource();
  validateGrammarScopes({ ...definitions, ...modifiers }, JSON.parse(await readFile(new URL("syntaxes/hson.tmLanguage.json", root), "utf8")));
  const contributions = ["dark", "light"].map(mode => ({
    label: `Hson House ${mode === "dark" ? "Dark" : "Light"}`, uiTheme: mode === "dark" ? "vs-dark" : "vs",
    path: `./themes/hson-house-${mode}-color-theme.json`,
  }));
  const outputs = new Map(contributions.map((entry, i) => [new URL(entry.path, root), JSON.stringify(houseTheme(appearance, definitions, i ? "light" : "dark"), null, 2) + "\n"]));
  const manifestPath = new URL("package.json", root);
  let manifest = await readFile(manifestPath, "utf8");
  for (const [key, value] of Object.entries({
    themes: contributions,
    semanticTokenTypes: Object.entries(definitions).map(([id, definition]) => ({ id, ...("superType" in definition ? { superType: definition.superType } : {}), description: `Hson ${definition.role}` })),
    semanticTokenModifiers: Object.entries(modifiers).map(([id, { description }]) => ({ id, description })),
    semanticTokenScopes: [{ scopes }, ...["typescript", "typescriptreact"].map(language => ({ language, scopes }))],
  })) manifest = replaceValue(manifest, ["contributes", key], value);
  const parsed = JSON.parse(manifest);
  const { owned } = appearance;
  for (const color of parsed.contributes.colors) {
    const marker = owned.identityMarkers.find(marker => marker.colorId === color.id);
    const value = marker ? owned.colors[marker.colorSetting] : owned.librarySeparator.color;
    color.defaults = { dark: value, light: value, highContrast: "editor.foreground", highContrastLight: "editor.foreground" };
  }
  manifest = replaceValue(manifest, ["contributes", "colors"], parsed.contributes.colors);
  for (const group of parsed.contributes.configuration) for (const [key, value] of Object.entries(group.properties)) {
    const name = key.replace(/^hson\.appearance\./, "");
    const defaults = { ...owned.colors, libraryMarkerStrength: owned.strength.strong, authoringMarkerStrength: owned.strength.soft,
      colorLibraryMarker: owned.colorLibraryMarker, librarySeparatorColor: owned.librarySeparator.color };
    if (key.startsWith("hson.appearance.") && name in defaults) value.default = defaults[name];
  }
  // Only update configuration when palette-owned defaults change.
  if (JSON.stringify(JSON.parse(manifest).contributes.configuration) !== JSON.stringify(parsed.contributes.configuration))
    manifest = replaceValue(manifest, ["contributes", "configuration"], parsed.contributes.configuration);
  outputs.set(manifestPath, manifest);
  if (!check) await mkdir(new URL("themes/", root), { recursive: true });
  for (const [path, expected] of outputs) {
    const current = await readFile(path, "utf8").catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
    if (current === expected) continue;
    if (check) throw new Error(`Generated appearance is stale: ${fileURLToPath(path)}. Run npm run themes:generate.`);
    await writeFile(path, expected);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await generateThemes({ check: process.argv.includes("--check") });
}
