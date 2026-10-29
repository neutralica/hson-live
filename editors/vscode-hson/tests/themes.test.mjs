import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import textmate from "vscode-textmate";
import oniguruma from "vscode-oniguruma";
import { appearanceSource, houseTheme, blend, generateThemes, validateGrammarScopes, brandingRuntime } from "../scripts/generate-themes.mjs";
import { resolveCatalog, validateExamples, exampleRange, catalogEntries } from "../scripts/appearance-catalog.mjs";
const { HSON_APPEARANCE: appearance, hsonTokenDefinitions: definitions, hsonTokenScopes: scopes,
  hsonTokenModifierDefinitions: modifiers, hsonGrammarScopes: grammarScopes, legacyRolePaths, syntaxBindings, syntaxExamplePath } = await appearanceSource();
await generateThemes({ check: true });
const resolved = resolveCatalog(appearance);
const syntax = appearance.syntax.hson;
const roleColor = (role, mode) => resolved.get(`syntax.hson.${legacyRolePaths[role]}`)[mode].foreground;
await validateExamples(appearance, syntaxBindings, syntaxExamplePath);
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const grammar = JSON.parse(await readFile(new URL('../syntaxes/hson.tmLanguage.json', import.meta.url), 'utf8'));
const { Registry, INITIAL } = textmate;
const { loadWASM, OnigScanner, OnigString } = oniguruma;
await loadWASM(await readFile(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm')));
const drifted = structuredClone(definitions);
drifted.hsonIteration.scopes = ['keyword.control.iteration.hs`on'];
assert.throws(() => validateGrammarScopes(drifted, grammar), /hsonIteration scope is absent/);
assert.equal(manifest.contributes.themes.length, 2);
validateGrammarScopes({ ...definitions, ...modifiers }, grammar);
assert.deepEqual(manifest.contributes.semanticTokenTypes.map(({ id }) => id), Object.keys(definitions));
assert.deepEqual(manifest.contributes.semanticTokenModifiers, Object.entries(modifiers).map(([id, { description }]) => ({ id, description })));
assert.equal(new Set(Object.keys(modifiers)).size, Object.keys(modifiers).length);
assert.deepEqual(scopes['hsonDelimiter.hsonTagOpen'], ['punctuation.definition.tag.begin.hson']);
assert.deepEqual(scopes['hsonDelimiter.hsonTagClose'], ['punctuation.definition.tag.end.hson']);
for (const language of ['typescript', 'typescriptreact']) assert.deepEqual(manifest.contributes.semanticTokenScopes.find(entry => entry.language === language)?.scopes, scopes);
for (const mode of ['light', 'dark']) {
  const theme = houseTheme(appearance, definitions, mode);
  assert.deepEqual(theme, houseTheme(appearance, definitions, mode));
  for (const foreground of [...Object.values(theme.colors), ...Object.values(theme.semanticTokenColors), ...theme.tokenColors.map(rule => rule.settings.foreground)]) assert.match(foreground, /^#[\da-f]{6}$/i);
  const semantic = theme.semanticTokenColors;
  assert.equal(semantic['*.hsonQualifier'], roleColor("qualifier", mode).toLowerCase());
  assert.deepEqual(Object.keys(semantic).filter(selector => selector.includes('.')),
    ['*.hsonQualifier', 'hsonReceiving.hsonQualifier', 'hsonReceiving.hsonLocalName'],
    'receiving syntax keeps its binding active and mutes its trailing kind');
  assert.equal(semantic['hsonReceiving.hsonQualifier'], semantic.hsonReceiving);
  assert.equal(semantic['hsonReceiving.hsonLocalName'], semantic['*.hsonQualifier']);
  const qualifierRule = theme.tokenColors.findLast(rule => rule.scope.includes(grammarScopes.attributeQualifier));
  assert.equal(qualifierRule.settings.foreground, semantic['*.hsonQualifier']);
  for (const [type, role] of [['hsonReceiving', 'receiving'], ['hsonSending', 'sending'],
    ['hsonIteration', 'iteration'], ['hsonDirective', 'directive'], ['hsonDeclaration', 'directive'],
    ['hsonProperty', 'attribute'], ['hsonFlag', 'flag']]) {
    assert.ok(modifiers.hsonQualifier.types.includes(type), `${type}.hsonQualifier is classified`);
    assert.ok(scopes[`${type}.hsonQualifier`], `${type}.hsonQualifier has a fallback`);
    assert.ok(scopes[`${type}.hsonLocalName`], `${type}.hsonLocalName has a fallback`);
    assert.ok(Object.keys(semantic).indexOf('*.hsonQualifier') > Object.keys(semantic).indexOf(type),
      `${type}.hsonQualifier wins the equal-specificity match by appearing after the base rule`);
    assert.equal(semantic[type], roleColor(role, mode).toLowerCase(), `${type} keeps its parent color`);
    assert.equal(semantic[`${type}.hsonLocalName`], type === 'hsonReceiving' ? semantic['*.hsonQualifier'] : undefined,
      `${type}.hsonLocalName only overrides the receiving kind segment`);
  }
  assert.equal(semantic.hsonColon, blend(syntax.punctuation.colon.house[mode].foreground, appearance.ui.palette.background.house[mode].foreground,
    syntax.punctuation.colon.house[mode].intensity));
  const customQualifier = structuredClone(appearance);
  customQualifier.syntax.hson.attribute.qualifier.house[mode].foreground = '#123456';
  const customTheme = houseTheme(customQualifier, definitions, mode);
  assert.equal(customTheme.semanticTokenColors['*.hsonQualifier'], '#123456');
  assert.equal(customTheme.semanticTokenColors['hsonReceiving.hsonLocalName'], '#123456');
  for (const selector of Object.keys(semantic).filter(selector => !['*.hsonQualifier', 'hsonReceiving.hsonLocalName'].includes(selector))) {
    assert.equal(customTheme.semanticTokenColors[selector], semantic[selector], `${selector} is independent of qualifier tuning`);
  }
  const registry = new Registry({
    theme: { settings: theme.tokenColors },
    onigLib: Promise.resolve({ createOnigScanner: p => new OnigScanner(p), createOnigString: s => new OnigString(s) }),
    loadGrammar: async scope => scope === 'source.hson' ? grammar : null,
  });
  const hson = await registry.loadGrammar('source.hson');
  const source = '<section blocks:data="x" data:block="x" for:item="x" part:optional class="x"/>';
  const encoded = hson.tokenizeLine2(source, INITIAL).tokens;
  const foreground = offset => {
    for (let i = 0; i < encoded.length; i += 2) {
      if (encoded[i] <= offset && offset < (encoded[i + 2] ?? source.length))
        return registry.getColorMap()[(encoded[i + 1] >>> 15) & 511].toLowerCase();
    }
  };
  for (const [name, qualifier, local] of [['blocks:data', semantic.hsonReceiving, semantic['*.hsonQualifier']],
    ['data:block', semantic['*.hsonQualifier'], semantic.hsonSending],
    ['for:item', semantic['*.hsonQualifier'], semantic.hsonIteration],
    ['part:optional', semantic['*.hsonQualifier'], semantic.hsonDirective]]) {
    const start = source.indexOf(name), colon = start + name.indexOf(':');
    assert.equal(foreground(start), qualifier, `${mode} standalone ${name} prefix`);
    assert.equal(foreground(colon), semantic.hsonColon, `${mode} standalone ${name} colon`);
    assert.equal(foreground(colon + 1), local, `${mode} standalone ${name} suffix`);
  }
  assert.equal(foreground(source.indexOf('class=')), semantic.hsonProperty, 'unqualified attributes retain their color');
  // Palette contrast is owner-authored; validate structure without a minimum ratio.
  assert.notEqual(semantic.hsonLocalReferenceSigil, semantic.hsonIncomingReferenceSigil);
  assert.notEqual(semantic.hsonDirective, semantic.hsonKeyword);
  assert.notEqual(semantic.hsonQuote, semantic.hsonString);
  for (const type of Object.keys(definitions)) {
    assert.ok(manifest.contributes.semanticTokenTypes.some(entry => entry.id === type));
    const rule = theme.tokenColors.findLast(rule => JSON.stringify(rule.scope) === JSON.stringify(definitions[type].scopes));
    assert.equal(rule.settings.foreground, semantic[type]);
  }
  const changed = structuredClone(appearance);
  changed.syntax.hson.reference.local.marker.house[mode].foreground = '#808080';
  changed.syntax.hson.reference.local.marker.house[mode].intensity = 1;
  const regenerated = houseTheme(changed, definitions, mode);
  assert.equal(regenerated.semanticTokenColors.hsonLocalReferenceSigil, '#808080');
  assert.equal(regenerated.semanticTokenColors.hsonProperty, semantic.hsonProperty);
  assert.equal(regenerated.semanticTokenColors.hsonIncomingReferenceSigil, semantic.hsonIncomingReferenceSigil);
  const ownerPalette = structuredClone(appearance);
  ownerPalette.syntax.hson.punctuation.tagOpen.house[mode].foreground = ownerPalette.ui.palette.background.house[mode].foreground;
  assert.equal(houseTheme(ownerPalette, definitions, mode).semanticTokenColors.hsonDelimiter,
    ownerPalette.ui.palette.background.house[mode].foreground.toLowerCase(), 'owner punctuation colors are accepted without contrast adjustment');
}
assert.equal(blend('#344154', '#FAF9F6', .75), '#666f7d');
assert.equal(blend('#101820', '#FAF9F6', .6), '#6e7276');
assert.equal(blend('#3D434B', '#FAF9F6', .75), '#6c7176');
console.log('ok - deterministic House assets, opaque blending, independent roles and language-qualified fallbacks');

// Transitive inheritance resolves styling only, merges individual mode properties,
// and never copies documentation or mutates the owner catalog.
const inherited = structuredClone(appearance);
inherited.syntax.hson.part.declaration.inherits = 'part.receivingKind';
inherited.syntax.hson.part.declaration.house = { dark: { intensity: 0.4 } };
const chain = resolveCatalog(inherited).get('syntax.hson.part.declaration');
assert.deepEqual(chain.dark, { foreground: syntax.attribute.qualifier.house.dark.foreground, intensity: 0.4 });
assert.deepEqual(chain.light, { foreground: syntax.attribute.qualifier.house.light.foreground });
assert.deepEqual(Object.keys(chain).sort(), ['dark', 'light']);
assert.equal(inherited.syntax.hson.part.declaration.label, 'Part declaration');
const badReference = structuredClone(appearance);
badReference.syntax.hson.attribute.qualifier.inherits = 'attribute.missing';
assert.throws(() => resolveCatalog(badReference), /attribute.qualifier -> syntax.hson.attribute.missing/);
const cycle = structuredClone(appearance);
cycle.syntax.hson.attribute.name.inherits = 'attribute.qualifier';
assert.throws(() => resolveCatalog(cycle), /inheritance cycle:.*attribute.name.*attribute.qualifier.*attribute.name/);
const selfCycle = structuredClone(appearance);
selfCycle.syntax.hson.element.name.inherits = 'element.name';
assert.throws(() => resolveCatalog(selfCycle), /inheritance cycle/);
assert.throws(() => exampleRange({ code: '<p/>', highlight: 'missing' }), /does not exist/);
assert.throws(() => exampleRange({ code: '<p "x"/>', highlight: '"' }), /ambiguous/);
assert.throws(() => exampleRange({ code: '<p/>', highlight: 'p', occurrence: 2 }), /invalid highlight occurrence/);
assert.deepEqual(exampleRange({ code: '<p "x"/>', highlight: '"', occurrence: 2 }), { start: 5, end: 6 });
const wrongExample = structuredClone(appearance);
wrongExample.syntax.hson.attribute.name.examples[0] = { code: '<button class="primary"/>', highlight: 'button' };
await assert.rejects(validateExamples(wrongExample, syntaxBindings, syntaxExamplePath), /does not classify as Attribute name/);
const shared = structuredClone(appearance);
shared.syntax.hson.punctuation.quoteClose.house = { dark: { foreground: '#123456' } };
assert.throws(() => houseTheme(shared, definitions, 'dark'), /shares hsonQuote/);
const customized = structuredClone(appearance);
customized.syntax.hson.punctuation.tagClose.house = { dark: { foreground: '#123456' } };
customized.syntax.general.type.house = { dark: { foreground: '#456789' } };
const customizedTheme = houseTheme(customized, definitions, 'dark');
assert.equal(customizedTheme.semanticTokenColors['hsonDelimiter.hsonTagClose'], '#123456');
assert.equal(customizedTheme.semanticTokenColors.type, '#456789');
assert.equal(customizedTheme.semanticTokenColors.hsonType, houseTheme(appearance, definitions, 'dark').semanticTokenColors.hsonType);
assert.ok(customizedTheme.tokenColors.some(rule => rule.scope.includes(grammarScopes.tagEnd) && rule.settings.foreground === '#123456'));
for (const [path, entry] of catalogEntries(appearance)) if (path.startsWith('syntax.hson.')) {
  assert.ok(entry.label && entry.examples.length, path);
}
// Both emitted JS and sourcemap must exclude the owner catalog and its examples.
const bundle = await readFile(new URL('../dist/extension.js', import.meta.url), 'utf8');
const map = JSON.parse(await readFile(new URL('../dist/extension.js.map', import.meta.url), 'utf8'));
assert.ok(!map.sources.some(path => /(?:appearance|appearance-bindings)\.ts$/.test(path)));
assert.ok(!bundle.includes('Attribute qualifier'));
console.log('ok - catalog examples, transitive inheritance, invalid references/cycles, independent existing selectors and runtime metadata exclusion');

const wrongNestedExample = structuredClone(appearance);
wrongNestedExample.syntax.hson.value.string.examples[0] = { code: '<p "%{slide}"/>', highlight: 'slide' };
await assert.rejects(validateExamples(wrongNestedExample, syntaxBindings, syntaxExamplePath), /does not classify as String content/);
const badBranding = structuredClone(appearance.branding);
badBranding.library.letters.h = 'missing';
assert.throws(() => brandingRuntime(badBranding), /Unknown branding palette reference: library.h -> missing/);
const reorderedBranding = structuredClone(appearance.branding);
reorderedBranding.library.letters = { n: 'green', o: 'pink', s: 'yellow', h: 'blue' };
assert.deepEqual(brandingRuntime(reorderedBranding), brandingRuntime(appearance.branding), 'owner key order cannot change marker ranges');

// Exercise the runtime resolver with generated associations, including mappings
// that intentionally differ between library and authoring markers.
const settingsBuild = await build({
  stdin: { contents: 'export { marker_color } from "./src/settings.ts";',
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { marker_color } = await import(`data:text/javascript;base64,${Buffer.from(settingsBuild.outputFiles[0].text).toString('base64')}`);
class ThemeColor {
  constructor(id) { this.id = id; }
}
const configuration = (inspections, values) => ({ inspect: key => inspections[key], get: key => values[key] });
const defaultBranding = brandingRuntime(appearance.branding);
const defaultInspections = Object.fromEntries(Object.entries(defaultBranding.colors).map(([key, defaultValue]) => [key, { key, defaultValue }]));
for (const marker of defaultBranding.identityMarkers) {
  const fallback = new ThemeColor(marker.colorId);
  assert.equal(marker_color(configuration(defaultInspections, defaultBranding.colors), marker, fallback), fallback,
    `${marker.publicName}.${marker.letter}: contributed defaults must retain the ThemeColor fallback`);
}
const divergentBranding = structuredClone(appearance.branding);
divergentBranding.authoring.letters = { H: 'pink', s: 'green', o: 'blue', n: 'yellow' };
const divergent = brandingRuntime(divergentBranding);
assert.deepEqual(divergent.identityMarkers.filter(marker => marker.publicName === 'hson'),
  defaultBranding.identityMarkers.filter(marker => marker.publicName === 'hson'));
assert.deepEqual(divergent.identityMarkers.filter(marker => marker.publicName === 'Hson').map(marker => marker.colorSetting),
  ['pink', 'green', 'blue', 'yellow']);
assert.deepEqual(divergent.identityMarkers.map(marker => marker.colorId), defaultBranding.identityMarkers.map(marker => marker.colorId));
divergentBranding.library.letters.h = 'green';
const independent = brandingRuntime(divergentBranding);
assert.equal(independent.identityMarkers.find(marker => marker.publicName === 'hson' && marker.letter === 'h').colorSetting, 'green');
assert.equal(independent.identityMarkers.find(marker => marker.publicName === 'Hson' && marker.letter === 'H').colorSetting, 'pink');
for (const branding of [defaultBranding, divergent, independent]) {
  for (const key of Object.keys(defaultBranding.colors)) {
    const overrides = configuration({ ...defaultInspections, [key]: { key, globalValue: '#123456' } },
      { ...defaultBranding.colors, [key]: '#123456' });
    for (const marker of branding.identityMarkers) {
      const fallback = new ThemeColor(marker.colorId);
      assert.equal(marker_color(overrides, marker, fallback), marker.colorSetting === key ? '#123456' : fallback,
        `${marker.publicName}.${marker.letter}: only its generated setting may override its theme color`);
    }
  }
}
const authoringH = independent.identityMarkers.find(marker => marker.publicName === 'Hson' && marker.letter === 'H');
const authoringFallback = new ThemeColor(authoringH.colorId);
assert.equal(marker_color(configuration({}, {}), authoringH, authoringFallback), authoringFallback);
for (const field of ['globalValue', 'workspaceValue', 'workspaceFolderValue', 'globalLanguageValue', 'workspaceLanguageValue', 'workspaceFolderLanguageValue']) {
  assert.equal(marker_color(configuration({ pink: { key: 'pink', [field]: '#111111' } }, { pink: '#abcdef' }), authoringH, authoringFallback),
    '#abcdef', `${field}: use VS Code's resolved value after detecting an explicit setting`);
}
for (const invalid of ['', 'pink', '#12']) {
  assert.equal(marker_color(configuration({ pink: { key: 'pink', workspaceValue: invalid } }, { pink: invalid }), authoringH, authoringFallback),
    authoringFallback, 'empty or invalid explicit colors retain the ThemeColor fallback');
}
const separatorFallback = new ThemeColor(defaultBranding.librarySeparator.colorId);
assert.equal(marker_color(configuration({}, {}), defaultBranding.librarySeparator, separatorFallback), separatorFallback);
assert.equal(marker_color(configuration({ librarySeparatorColor: { key: 'librarySeparatorColor', workspaceValue: '#abcdef' } },
  { librarySeparatorColor: '#abcdef' }), defaultBranding.librarySeparator, separatorFallback), '#abcdef');
console.log('ok - default and independent branding mappings, per-marker explicit overrides, configuration precedence and ThemeColor fallbacks');

const badUi = structuredClone(appearance);
badUi.ui.editor['editor.background'].inherits = 'ui.palette.missing';
assert.throws(() => resolveCatalog(badUi), /Unknown appearance styling reference:.*ui.palette.missing/);
const propertyOverride = structuredClone(appearance);
propertyOverride.syntax.general.punctuation.inherits = 'syntax.hson.punctuation.assignment';
propertyOverride.syntax.general.punctuation.house = { dark: { foreground: '#123456' } };
assert.deepEqual(resolveCatalog(propertyOverride).get('syntax.general.punctuation').dark,
  { foreground: '#123456', intensity: 0.75 }, 'child foreground preserves inherited intensity');
