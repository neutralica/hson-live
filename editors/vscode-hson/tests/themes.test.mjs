import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import textmate from "vscode-textmate";
import oniguruma from "vscode-oniguruma";
import { appearanceSource, houseTheme, blend, generateThemes, validateGrammarScopes, brandingRuntime } from "../scripts/generate-themes.mjs";
import { resolveCatalog as resolveAppearanceCatalog, validateExamples as validateCatalogExamples, exampleRange, catalogEntries } from "../scripts/appearance-catalog.mjs";
const { HSON_APPEARANCE: appearance, hsonTokenDefinitions: definitions, hsonTokenScopes: scopes,
  hsonTokenModifierDefinitions: modifiers, hsonGrammarScopes: grammarScopes, legacyRolePaths, syntaxBindings, syntaxExamplePath, generalRules } = await appearanceSource();
const resolveCatalog = catalog => resolveAppearanceCatalog(catalog, syntaxBindings, generalRules);
const validateExamples = (catalog, bindings, examplePath) => validateCatalogExamples(catalog, bindings, examplePath, generalRules);
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
  assert.deepEqual(Object.keys(semantic).filter(selector => selector.includes('hsonQualifier') || selector.endsWith('hsonLocalName')),
    ['*.hsonQualifier', 'hsonReceiving.hsonLocalName', 'hsonReceiving.hsonQualifier', 'hsonSending.hsonQualifier', 'hsonSending.hsonLocalName'],
    'directional syntax keeps local and parameter names active and mutes their kinds');
  assert.equal(semantic['hsonReceiving.hsonLocalName'], semantic.hsonReceiving);
  assert.equal(semantic['hsonReceiving.hsonQualifier'], semantic['*.hsonQualifier']);
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
    assert.equal(semantic[`${type}.hsonLocalName`], type === 'hsonReceiving' ? semantic.hsonReceiving : type === 'hsonSending' ? semantic['*.hsonQualifier'] : undefined,
      `${type}.hsonLocalName follows the directional segment role`);
  }
  assert.equal(semantic.hsonColon, blend(syntax.punctuation.colon.house[mode].foreground, appearance.ui.palette.background.house[mode].foreground,
    syntax.punctuation.colon.house[mode].intensity));
  const customQualifier = structuredClone(appearance);
  customQualifier.syntax.hson.attribute.qualifier.house[mode].foreground = '#123456';
  const customTheme = houseTheme(customQualifier, definitions, mode);
  assert.equal(customTheme.semanticTokenColors['*.hsonQualifier'], '#123456');
  assert.equal(customTheme.semanticTokenColors['hsonReceiving.hsonQualifier'], '#123456');
  for (const selector of Object.keys(semantic).filter(selector => !['*.hsonQualifier', 'hsonReceiving.hsonQualifier', 'hsonSending.hsonLocalName'].includes(selector))) {
    assert.equal(customTheme.semanticTokenColors[selector], semantic[selector], `${selector} is independent of qualifier tuning`);
  }
  const registry = new Registry({
    theme: { settings: theme.tokenColors },
    onigLib: Promise.resolve({ createOnigScanner: p => new OnigScanner(p), createOnigString: s => new OnigString(s) }),
    loadGrammar: async scope => scope === 'source.hson' ? grammar : null,
  });
  const hson = await registry.loadGrammar('source.hson');
  const source = '<section data:blocks="x" block:data="x" for:item="x" part:optional class="x"/>';
  const encoded = hson.tokenizeLine2(source, INITIAL).tokens;
  const foreground = offset => {
    for (let i = 0; i < encoded.length; i += 2) {
      if (encoded[i] <= offset && offset < (encoded[i + 2] ?? source.length))
        return registry.getColorMap()[(encoded[i + 1] >>> 15) & 511].toLowerCase();
    }
  };
  for (const [name, qualifier, local] of [['data:blocks', semantic['*.hsonQualifier'], semantic.hsonReceiving],
    ['block:data', semantic.hsonSending, semantic['*.hsonQualifier']],
    ['for:item', semantic['*.hsonQualifier'], semantic.hsonIteration],
    ['part:optional', semantic['*.hsonQualifier'], semantic.hsonDirective]]) {
    const start = source.indexOf(name), colon = start + name.indexOf(':');
    assert.equal(foreground(start), qualifier, `${mode} standalone ${name} prefix`);
    assert.equal(foreground(colon), semantic.hsonColon, `${mode} standalone ${name} colon`);
    assert.equal(foreground(colon + 1), local, `${mode} standalone ${name} suffix`);
  }
  assert.equal(foreground(source.indexOf('class=')), semantic.hsonProperty, 'unqualified attributes retain their color');
  // Palette contrast is owner-authored; validate structure without a minimum ratio.
  assert.equal(semantic.hsonLocalReferenceSigil, blend(syntax.reference.local.marker.house[mode].foreground,
    appearance.ui.palette.background.house[mode].foreground, syntax.reference.local.marker.house[mode].intensity));
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
cycle.syntax.hson.attribute.qualifier.inherits = 'attribute.name';
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
  { foreground: '#123456', intensity: syntax.punctuation.assignment.house.dark.intensity }, 'child foreground preserves inherited intensity');

async function coloredTokens(theme, source) {
  const registry = new Registry({
    theme: { settings: theme.tokenColors },
    onigLib: Promise.resolve({ createOnigScanner: p => new OnigScanner(p), createOnigString: s => new OnigString(s) }),
    loadGrammar: async scope => scope === 'source.hson' ? grammar : null,
  });
  const hson = await registry.loadGrammar('source.hson');
  const encoded = hson.tokenizeLine2(source, INITIAL).tokens;
  const tokens = hson.tokenizeLine(source, INITIAL).tokens.map(token => {
    let foreground;
    for (let i = 0; i < encoded.length; i += 2) if (encoded[i] <= token.startIndex && token.startIndex < (encoded[i + 2] ?? source.length))
      foreground = registry.getColorMap()[(encoded[i + 1] >>> 15) & 511].toLowerCase();
    return { start: token.startIndex, end: Math.min(source.length, token.endIndex),
      text: source.slice(token.startIndex, token.endIndex), path: syntaxExamplePath(token.scopes), foreground };
  });
  registry.dispose();
  return tokens;
}
const selectorSources = [
  '<hson-part lib="components" at="foo"/>', '<hson-part at="components/foo"/>', '<hson-part at="foo"/>',
  '<hson-part lib=components at=foo/>', '<hson-part at=components/foo/>', '<hson-part at=foo/>',
  '<div lib="components" at="foo"/>', '<hson-part at=^{each.kind[0]}/>', '<hson-part at="components/%{member}"/>',
];
const partRoles = ['part.systemAttribute.name', 'part.selector.library', 'part.selector.member', 'part.selector.separator'];
for (const mode of ['light', 'dark']) {
  const theme = houseTheme(appearance, definitions, mode);
  const baselines = await Promise.all(selectorSources.map(source => coloredTokens(theme, source)));
  for (const tokens of baselines) for (const token of tokens) if (partRoles.includes(token.path)) {
    assert.equal(token.foreground, theme.semanticTokenColors[syntaxBindings[token.path].selector], `${mode}: actual ${token.text} color`);
    const style = resolved.get(`syntax.hson.${token.path}`)[mode];
    assert.equal(token.foreground, blend(style.foreground, appearance.ui.palette.background.house[mode].foreground, style.intensity));
  }
  const colorOf = (i, text) => baselines[i].find(token => token.text === text)?.foreground;
  assert.equal(colorOf(0, 'lib'), colorOf(0, 'at'), `${mode}: both governed names share a color`);
  assert.equal(colorOf(0, 'components'), colorOf(1, 'components'), `${mode}: lib and qualified at share Library color`);
  assert.equal(colorOf(0, 'foo'), colorOf(1, 'foo'), `${mode}: lib + unqualified member matches qualified member`);
  assert.equal(colorOf(1, 'foo'), colorOf(2, 'foo'), `${mode}: standalone unqualified at is a member`);
  for (const [i, j] of [[0, 3], [1, 4], [2, 5]]) for (const text of ['at', 'components', 'foo'].filter(text => colorOf(i, text)))
    assert.equal(colorOf(i, text), colorOf(j, text), `${mode}: quoted/bare ${text}`);
  for (const role of partRoles) {
    const tuned = structuredClone(appearance);
    let entry = tuned.syntax.hson;
    for (const key of role.split('.')) entry = entry[key];
    entry.house = { ...entry.house, [mode]: { foreground: '#123456', intensity: 1 } };
    const changedTheme = houseTheme(tuned, definitions, mode);
    const changed = await Promise.all(selectorSources.map(source => coloredTokens(changedTheme, source)));
    assert.ok(changed.flat().some(token => token.path === role));
    for (const [i, tokens] of changed.entries()) for (const [j, token] of tokens.entries()) {
      assert.equal(token.foreground, token.path === role ? '#123456' : baselines[i][j].foreground,
        `${mode}/${role}: only intended targets change (${selectorSources[i]} ${token.text})`);
    }
    for (const [selector, value] of Object.entries(theme.semanticTokenColors))
      assert.deepEqual(changedTheme.semanticTokenColors[selector], selector === syntaxBindings[role].selector ? '#123456' : value,
        `${mode}/${role}: independent semantic customization of ${selector}`);
  }
}
// A theme outside House controls every fallback; explicit TextMate rules can
// override each new scope. No House palette or extension-applied decoration is involved.
const external = { tokenColors: [
  { settings: { foreground: '#010203' } },
  { scope: ['string'], settings: { foreground: '#345678' } },
  { scope: ['entity.other.attribute-name'], settings: { foreground: '#456789' } },
  { scope: ['punctuation.separator'], settings: { foreground: '#56789a' } },
] };
for (const source of selectorSources.slice(0, 6)) {
  const tokens = await coloredTokens(external, source);
  for (const token of tokens.filter(token => partRoles.includes(token.path))) {
    assert.equal(token.foreground, token.path === partRoles[0] ? '#456789' : token.path === partRoles[3] ? '#56789a' : '#345678');
  }
  const custom = { tokenColors: [...external.tokenColors,
    ...partRoles.map((role, i) => ({ scope: syntaxBindings[role].scopes, settings: { foreground: ['#112233', '#223344', '#334455', '#445566'][i] } }))] };
  const customized = await coloredTokens(custom, source);
  for (const token of customized.filter(token => partRoles.includes(token.path)))
    assert.equal(token.foreground, ['#112233', '#223344', '#334455', '#445566'][partRoles.indexOf(token.path)]);
}
for (const role of partRoles) {
  const type = syntaxBindings[role].selector;
  assert.ok(scopes[type].includes(syntaxBindings[role].scopes[0]), `${type}: exact user TextMate customization fallback`);
  assert.ok(scopes[type].includes(role === partRoles[0] ? grammarScopes.attributeName : grammarScopes.quotedString), `${type}: ordinary external-theme fallback`);
}
console.log('ok - resolved House Light/Dark Part colors, four isolated owner edits, external-theme fallbacks and explicit TextMate scope overrides');

// Every owner-facing object is strict, while native workbench IDs stay dynamic.
const invalidConfigurations = [
  ['syntax.hson.reference.selectorOpen.house.dark.intensite', 0.75, 'intensity'],
  ['syntax.hson.part.selector.member.lable', 'Member', 'label'],
  ['syntax.hson.part.selector.member.hosue', {}, 'house'],
  ['syntax.hson.part.selector.member.house.drak', {}, 'dark'],
  ['syntax.hson.part.selector.member.house.dark.foregound', '#123456', 'foreground'],
  ['syntax.hson.part.selector.member.examples.0.higlight', 'foo', 'highlight'],
  ['syntax.hson.part.selector.member.examples.0.occurence', 1, 'occurrence'],
  ['syntax.hson.part.selector.member.examples.0.offset', 8],
  ['brandng', {}, 'branding'],
  ['syntax.hson.part.selector.membre', {}, 'member'],
  ['syntax.hson.prat', {}, 'part'],
  ['syntax.general.strng', {}, 'string'],
  ['ui.palete', {}, 'palette'],
  ['branding.library.opactiy', 0.5, 'opacity'],
  ['branding.library.separator.colour', '#123456', 'color'],
  ['branding.library.letters.hh', 'blue', 'h'],
  ['branding.palette.blu', '#123456', 'blue'],
  ['syntax.hson.part.selector.member.label', 42],
  ['syntax.hson.part.selector.member.examples', {}],
  ['syntax.hson.part.selector.member.examples.0.code', false],
  ['syntax.hson.part.selector.member.examples.0.highlight', ''],
  ['syntax.hson.part.selector.member.examples.0.occurrence', '1'],
  ['syntax.hson.part.selector.member.house.dark.foreground', '#12345'],
  ['syntax.hson.part.selector.member.house.dark.foreground', 123456],
  ['syntax.hson.part.selector.member.house.dark.intensity', NaN],
  ['syntax.hson.part.selector.member.house.dark.intensity', Infinity],
  ['syntax.hson.part.selector.member.house.dark.intensity', -0.1],
  ['syntax.hson.part.selector.member.house.dark.intensity', 1.1],
  ['syntax.hson.part.selector.member.house.dark.intensity', '0.75'],
  ['syntax.hson.part.selector.member.house.dark.fontStyle', 'oblique'],
  ['syntax.hson.part.selector.member.house.dark.italic', 'yes'],
  ['syntax.hson.part.selector.member.house.dark.underlne', true, 'underline'],
  ['syntax.hson.part.selector.member.house.dark.opacity', 0.5],
  ['syntax.hson.part.selector.member.inherits', []],
  ['syntax.hson.part.selector.member.house', []],
  ['syntax.hson.part.selector.member.house.dark', null],
  ['branding.library.enabled', 1],
  ['branding.authoring.opacity', Infinity],
  ['branding.library.opacity', 1.01],
  ['branding.library.opacity', -0.01],
  ['branding.palette.green', 'green'],
];
function mutateFixture(config, path, value) {
  const keys = path.split('.');
  let parent = config;
  // Clone every ancestor separately: structuredClone preserves shared aliases.
  for (const key of keys.slice(0, -1)) {
    parent[key] = structuredClone(parent[key] ?? {});
    parent = parent[key];
  }
  parent[keys.at(-1)] = value;
}
for (const [path, value, replacement] of invalidConfigurations) {
  const invalid = structuredClone(appearance);
  const keys = path.split('.');
  mutateFixture(invalid, path, value);
  assert.throws(() => houseTheme(invalid, definitions, 'dark'), error => {
    const displayPath = path.replace('.examples.0', '.examples[0]');
    assert.ok(error.message.startsWith(displayPath + ':') || error.message.startsWith(displayPath.slice(0, displayPath.lastIndexOf('.')) + ':'), error.message);
    if (replacement) {
      assert.ok(error.message.includes(`Unknown property "${keys.at(-1)}"`), error.message);
      assert.ok(error.message.includes(`Did you mean "${replacement}"?`), error.message);
    }
    return true;
  }, path);
}
const sharedFixture = structuredClone(appearance);
const sharedStyle = sharedFixture.syntax.hson.part.selector.member.house;
sharedFixture.syntax.hson.part.selector.library.house = sharedStyle;
assert.equal(sharedFixture.syntax.hson.part.selector.library.house, sharedStyle);
mutateFixture(sharedFixture, 'syntax.hson.part.selector.member.house.dark.foregound', '#123456');
assert.notEqual(sharedFixture.syntax.hson.part.selector.member.house, sharedFixture.syntax.hson.part.selector.library.house);
assert.equal(Object.hasOwn(sharedFixture.syntax.hson.part.selector.library.house.dark, 'foregound'), false);
assert.deepEqual(sharedFixture.syntax.hson.part.selector.library.house, sharedStyle);
assert.throws(() => houseTheme(sharedFixture, definitions, 'dark'), {
  message: 'syntax.hson.part.selector.member.house.dark.foregound: Unknown property "foregound". Did you mean "foreground"?',
});

const nativeUi = structuredClone(appearance);
nativeUi.ui.workbench['terminal.ansiBrightMagenta'] = { inherits: 'ui.palette.accent' };
nativeUi.ui.editor['editorOverviewRuler.wordHighlightStrongForeground'] = { house: { dark: { foreground: '#123456' }, light: { foreground: '#654321' } } };
for (const mode of ['dark', 'light']) {
  const theme = houseTheme(nativeUi, definitions, mode);
  assert.equal(theme.colors['terminal.ansiBrightMagenta'], appearance.ui.palette.accent.house[mode].foreground);
  assert.equal(theme.colors['editorOverviewRuler.wordHighlightStrongForeground'], mode === 'dark' ? '#123456' : '#654321');
}
const fontStyles = structuredClone(appearance);
fontStyles.syntax.general.keyword.house = { dark: { fontStyle: 'italic bold underline strikethrough' } };
fontStyles.syntax.general.function.inherits = 'syntax.general.keyword';
fontStyles.syntax.general.function.house = { dark: { bold: false, foreground: '#123456' } };
const styled = houseTheme(fontStyles, definitions, 'dark');
assert.deepEqual(styled.semanticTokenColors.function,
  { foreground: '#123456', bold: false, italic: true, underline: true, strikethrough: true });
assert.equal(styled.tokenColors.find(rule => rule.scope.includes('entity.name.function')).settings.fontStyle, 'italic underline strikethrough');
const nestedTypo = structuredClone(appearance);
nestedTypo.syntax.hson.reference.selectorOpen.house = { dark: { foreground: '#8792A0', intensite: 0.75 } };
assert.throws(() => houseTheme(nestedTypo, definitions, 'dark'), {
  message: 'syntax.hson.reference.selectorOpen.house.dark.intensite: Unknown property "intensite". Did you mean "intensity"?',
});
console.log('ok - strict catalog, metadata, examples, style, general syntax, UI and branding validation with full paths and typo suggestions');

const uiTypo = structuredClone(appearance);
uiTypo.ui.workbench['terminal.ansiBrightMagenta'] = { house: { dark: { foregound: '#123456' } } };
assert.throws(() => houseTheme(uiTypo, definitions, 'dark'), {
  message: 'ui.workbench.terminal.ansiBrightMagenta.house.dark.foregound: Unknown property "foregound". Did you mean "foreground"?',
});
const inheritanceTypo = structuredClone(appearance);
inheritanceTypo.syntax.hson.part.selector.member.inherits = 'part.selector.libary';
assert.throws(() => resolveCatalog(inheritanceTypo), error =>
  error.message.startsWith('syntax.hson.part.selector.member.inherits:') && error.message.includes('Did you mean "syntax.hson.part.selector.library"?'));

// Execute the real generator on a disposable owner catalog. esbuild deliberately
// does no TS type checking: this proves a direct generator invocation is strict.
const invalidOwner = await realpath(await mkdtemp(join(tmpdir(), 'hson-catalog-validation-')));
try {
  for (const directory of ['scripts', 'src']) await mkdir(join(invalidOwner, directory));
  for (const relative of ['scripts/generate-themes.mjs', 'scripts/appearance-catalog.mjs',
    'src/appearance.ts', 'src/appearance-internals.ts', 'src/appearance-bindings.ts', 'src/appearance-branding.generated.ts']) {
    let source = await readFile(new URL('../' + relative, import.meta.url), 'utf8');
    if (relative === 'src/appearance.ts') source = source.replace('selectorOpen: {', 'selectorOpen: { house: { dark: { foreground: "#8792A0", intensite: 0.75 } },');
    await writeFile(join(invalidOwner, relative), source);
  }
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(invalidOwner, 'node_modules'), 'dir');
  const generated = spawnSync(process.execPath, [join(invalidOwner, 'scripts/generate-themes.mjs'), '--check'], { encoding: 'utf8' });
  assert.notEqual(generated.status, 0, 'direct generation must reject invalid owner styling');
  assert.match(generated.stderr, /syntax\.hson\.reference\.selectorOpen\.house\.dark\.intensite: Unknown property "intensite"\. Did you mean "intensity"\?/);
} finally { await rm(invalidOwner, { recursive: true, force: true }); }
console.log('ok - native UI typo paths, inheritance suggestions and real generator-time rejection without TypeScript checking');

// Generate only inside a disposable extension; changing the owner catalog must
// update every derived default without changing the catalog or the validator.
const ownerFixture = await realpath(await mkdtemp(join(tmpdir(), 'hson-appearance-defaults-')));
try {
  for (const directory of ['scripts', 'src', 'syntaxes']) await mkdir(join(ownerFixture, directory));
  for (const relative of ['package.json', 'scripts/generate-themes.mjs', 'scripts/appearance-catalog.mjs',
    'syntaxes/hson.tmLanguage.json', 'src/appearance-internals.ts', 'src/appearance-bindings.ts', 'src/appearance-branding.generated.ts'])
    await writeFile(join(ownerFixture, relative), await readFile(new URL('../' + relative, import.meta.url)));
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(ownerFixture, 'node_modules'), 'dir');
  const owner = structuredClone(appearance);
  owner.branding.palette = { blue: '#b5d4f6', yellow: '#bda065', pink: '#dd97cc', green: '#80a894' };
  owner.branding.library.opacity = 0.45;
  owner.branding.authoring.opacity = 0.25;
  owner.branding.library.enabled = false;
  owner.branding.library.separator.color = '#abcd';
  const runGenerator = (...args) => spawnSync(process.execPath, [join(ownerFixture, 'scripts/generate-themes.mjs'), ...args], { encoding: 'utf8' });
  const success = result => assert.equal(result.status, 0, result.stderr);
  const author = async catalog => {
    const text = `export const HSON_APPEARANCE = ${JSON.stringify(catalog, null, 2)};\n`;
    await writeFile(join(ownerFixture, 'src/appearance.ts'), text);
    return text;
  };
  const outputs = ['package.json', 'src/appearance-branding.generated.ts',
    ...['dark', 'light'].map(mode => `themes/hson-house-${mode}-color-theme.json`)];
  const snapshot = () => Promise.all(outputs.map(relative => readFile(join(ownerFixture, relative), 'utf8')));
  const source = await author(owner);
  success(runGenerator());
  const generated = await snapshot();
  success(runGenerator('--check'));
  success(runGenerator());
  assert.deepEqual(await snapshot(), generated, 'repeated generation cannot restore older defaults');
  assert.equal(await readFile(join(ownerFixture, 'src/appearance.ts'), 'utf8'), source);
  const packageJson = JSON.parse(generated[0]);
  const settings = Object.assign({}, ...packageJson.contributes.configuration.map(group => group.properties));
  const branding = brandingRuntime(owner.branding);
  for (const [key, value] of Object.entries({ ...branding.colors, libraryMarkerStrength: branding.libraryOpacity,
    authoringMarkerStrength: branding.authoringOpacity, colorLibraryMarker: branding.colorLibraryMarker,
    librarySeparatorColor: branding.librarySeparator.color })) assert.equal(settings[`hson.appearance.${key}`].default, value);
  for (const marker of [...branding.identityMarkers, branding.librarySeparator]) {
    const value = marker.color ?? branding.colors[marker.colorSetting];
    assert.deepEqual(packageJson.contributes.colors.find(color => color.id === marker.colorId).defaults,
      { dark: value, light: value, highContrast: 'editor.foreground', highContrastLight: 'editor.foreground' });
  }
  for (const [index, mode] of ['dark', 'light'].entries())
    assert.deepEqual(JSON.parse(generated[index + 2]), houseTheme(owner, definitions, mode));
  // Check mode detects drift without repairing the evidence being validated.
  for (const [index, relative] of outputs.entries()) {
    const drifted = generated[index].replace(/#[\da-f]{3,8}/i, '#010203');
    assert.notEqual(drifted, generated[index]);
    await writeFile(join(ownerFixture, relative), drifted);
    const checked = runGenerator('--check');
    assert.notEqual(checked.status, 0, relative);
    assert.match(checked.stderr, /Generated appearance is stale/);
    assert.equal(await readFile(join(ownerFixture, relative), 'utf8'), drifted);
    await writeFile(join(ownerFixture, relative), generated[index]);
  }
  for (const key of Object.keys(owner.branding.palette)) {
    const missing = structuredClone(owner);
    delete missing.branding.palette[key];
    await author(missing);
    const checked = runGenerator('--check');
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, new RegExp(`branding\\.palette\\.${key}: Expected a hexadecimal color`));
  }
  for (const value of ['blue', '#12', '#gggggg', 123456]) {
    const malformed = structuredClone(owner);
    malformed.branding.palette.blue = value;
    await author(malformed);
    const checked = runGenerator('--check');
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /branding\.palette\.blue: Expected a hexadecimal color/);
  }
  for (const value of ['#000000', '#ffffff', '#808080', '#FF00FF', '#abc', '#abcd', '#12345600']) {
    for (const key of Object.keys(owner.branding.palette)) owner.branding.palette[key] = value;
    const source = await author(owner);
    success(runGenerator());
    success(runGenerator('--check'));
    assert.equal(await readFile(join(ownerFixture, 'src/appearance.ts'), 'utf8'), source);
  }
} finally { await rm(ownerFixture, { recursive: true, force: true }); }
console.log('ok - owner palette and setting edits propagate, repeated generation is stable, drift and invalid roles fail, all hues and hex forms are accepted');
