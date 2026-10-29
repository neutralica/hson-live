import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";
import { resolveCatalog, validateExamples } from "./appearance-catalog.mjs";

import ts from "typescript";

const root = new URL("../", import.meta.url);
export async function appearanceSource() {
  const result = await build({ stdin: { contents: 'export * from "./src/appearance.ts"; export * from "./src/appearance-internals.ts"; export * from "./src/appearance-bindings.ts";', resolveDir: fileURLToPath(root), loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { syntaxBindings, syntaxExamplePath, tokenAppearancePaths, generalRules, generalSemanticPaths, uiColorOrder } = await appearanceSource();

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
  const styles = resolveCatalog(appearance);
  const background = styles.get('ui.editor.editor.background')?.[mode].foreground;
  const style = path => {
    const value = styles.get(path)?.[mode];
    if (!value) throw new Error(`Unknown appearance binding: ${path}`);
    return value;
  };
  const color = path => {
    const value = style(path);
    return blend(value.foreground, background, value.intensity);
  };
  const syntaxColor = path => color(`syntax.hson.${path}`);
  const colors = {};
  // Preserve generated serialization order as well as values.
  const uiEntries = { ...appearance.ui.editor, ...appearance.ui.workbench };
  for (const id of [...new Set([...uiColorOrder, ...Object.keys(uiEntries)])]) {
    const family = Object.hasOwn(appearance.ui.editor, id) ? 'editor' : 'workbench';
    const path = `ui.${family}.${id}`;
    const value = style(path);
    // Existing native UI palette colors retain their authored casing; syntax
    // inheritance (line numbers and brackets) uses the effective House color.
    const entry = uiEntries[id];
    colors[id] = entry.inherits?.startsWith('syntax.') || value.intensity !== undefined ? color(path) : value.foreground;
  }
  const rule = (scope, foreground) => ({ scope, settings: { foreground } });
  const semanticTokenColors = {
    ...Object.fromEntries(Object.entries(generalSemanticPaths).map(([type, path]) => [type, color(path)])),
    ...Object.fromEntries(Object.keys(definitions).map(type => [type, syntaxColor(tokenAppearancePaths[type])])),
    '*.hsonQualifier': syntaxColor('attribute.qualifier'),
    'hsonReceiving.hsonQualifier': syntaxColor('part.receivingArgument'),
    'hsonReceiving.hsonLocalName': syntaxColor('part.receivingKind'),
  };
  const tokenColors = [
    ...generalRules.map(({ scopes, path }) => rule(scopes, color(path))),
    ...Object.entries(definitions).map(([type, definition]) => rule(definition.scopes, semanticTokenColors[type])),
    rule(syntaxBindings['attribute.qualifier'].scopes, syntaxColor('attribute.qualifier')),
    rule([`${syntaxBindings['part.receivingArgument'].scopes[0]} ${syntaxBindings['attribute.qualifier'].scopes[0]}`], syntaxColor('part.receivingArgument')),
    rule([`${syntaxBindings['part.receivingArgument'].scopes[0]} ${syntaxBindings['part.receivingKind'].scopes[0]}`], syntaxColor('part.receivingKind')),
  ];
  for (const [path, binding] of Object.entries(syntaxBindings)) {
    const foreground = syntaxColor(path), selector = binding.selector;
    if (['attribute.qualifier', 'part.receivingKind'].includes(path)) continue;
    const base = selector.split('.')[0];
    if (foreground === semanticTokenColors[base]) continue;
    // No invented modifiers: these pairs are still inseparable in TS/TSX.
    if (selector === base) throw new Error(`${path} shares ${selector} with ${tokenAppearancePaths[base]}; keep their effective styles equal until classification supports separation`);
    semanticTokenColors[selector] = foreground;
    tokenColors.push(rule(binding.scopes, foreground));
  }
  return {
    $schema: "vscode://schemas/color-theme", name: `Hson House ${mode === "dark" ? "Dark" : "Light"}`,
    type: mode, semanticHighlighting: true, colors, tokenColors, semanticTokenColors,
  };
}

export function brandingRuntime(branding) {
  const identityMarkers = Object.entries({ library: 'hson', authoring: 'Hson' }).flatMap(([family, publicName]) =>
    Array.from(publicName).map(letter => {
      const colorSetting = branding[family].letters[letter];
      if (!Object.hasOwn(branding.palette, colorSetting)) throw new Error(`Unknown branding palette reference: ${family}.${letter} -> ${colorSetting}`);
      return { publicName, letter, colorId: `hson.${family}Marker.${letter.toLowerCase()}`, colorSetting, strength: family === 'library' ? 'strong' : 'soft' };
    }));
  for (const family of ['library', 'authoring']) {
    const opacity = branding[family].opacity;
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error(`branding.${family}: opacity must be between 0 and 1`);
  }
  return { colors: branding.palette, libraryOpacity: branding.library.opacity, authoringOpacity: branding.authoring.opacity,
    colorLibraryMarker: branding.library.enabled, identityMarkers,
    librarySeparator: { colorId: 'hson.libraryMarker.separator', colorSetting: 'librarySeparatorColor', color: branding.library.separator.color } };
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
  await validateExamples(appearance, syntaxBindings, syntaxExamplePath);
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
  const owned = brandingRuntime(appearance.branding);
  outputs.set(new URL('src/appearance-branding.generated.ts', root),
    '// Generated from appearance.ts; edit the catalog and run themes:generate.\n'
    + 'export const HSON_BRANDING = ' + JSON.stringify(owned, null, 2) + ' as const;\n'
    + 'export type AppearanceColorKey = keyof typeof HSON_BRANDING.colors;\n'
    + 'export const hsonIdentityMarkers = HSON_BRANDING.identityMarkers;\n'
    + 'export const HSON_LIBRARY_SEPARATOR_COLOR_ID = HSON_BRANDING.librarySeparator.colorId;\n');
  for (const color of parsed.contributes.colors) {
    const marker = owned.identityMarkers.find(marker => marker.colorId === color.id);
    const value = marker ? owned.colors[marker.colorSetting] : owned.librarySeparator.color;
    color.defaults = { dark: value, light: value, highContrast: "editor.foreground", highContrastLight: "editor.foreground" };
  }
  manifest = replaceValue(manifest, ["contributes", "colors"], parsed.contributes.colors);
  for (const group of parsed.contributes.configuration) for (const [key, value] of Object.entries(group.properties)) {
    const name = key.replace(/^hson\.appearance\./, "");
    const defaults = { ...owned.colors, libraryMarkerStrength: owned.libraryOpacity, authoringMarkerStrength: owned.authoringOpacity,
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
