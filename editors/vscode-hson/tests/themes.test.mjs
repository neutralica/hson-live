import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import textmate from "vscode-textmate";
import oniguruma from "vscode-oniguruma";
import { appearanceSource, houseTheme, blend, generateThemes, validateGrammarScopes } from "../scripts/generate-themes.mjs";
const { HSON_APPEARANCE: appearance, hsonTokenDefinitions: definitions, hsonTokenScopes: scopes,
  hsonTokenModifierDefinitions: modifiers } = await appearanceSource();
await generateThemes({ check: true });
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
  assert.equal(semantic['*.hsonQualifier'], appearance.house.roles.qualifier[mode].toLowerCase());
  assert.deepEqual(Object.keys(semantic).filter(selector => selector.includes('.')),
    ['*.hsonQualifier', 'hsonReceiving.hsonQualifier', 'hsonReceiving.hsonLocalName'],
    'receiving syntax keeps its binding active and mutes its trailing kind');
  assert.equal(semantic['hsonReceiving.hsonQualifier'], semantic.hsonReceiving);
  assert.equal(semantic['hsonReceiving.hsonLocalName'], semantic['*.hsonQualifier']);
  const qualifierRule = theme.tokenColors.findLast(rule => rule.scope.includes(appearance.themeDerived.attributeQualifier));
  assert.equal(qualifierRule.settings.foreground, semantic['*.hsonQualifier']);
  for (const [type, role] of [['hsonReceiving', 'receiving'], ['hsonSending', 'sending'],
    ['hsonIteration', 'iteration'], ['hsonDirective', 'directive'], ['hsonDeclaration', 'directive'],
    ['hsonProperty', 'attribute'], ['hsonFlag', 'flag']]) {
    assert.ok(modifiers.hsonQualifier.types.includes(type), `${type}.hsonQualifier is classified`);
    assert.ok(scopes[`${type}.hsonQualifier`], `${type}.hsonQualifier has a fallback`);
    assert.ok(scopes[`${type}.hsonLocalName`], `${type}.hsonLocalName has a fallback`);
    assert.ok(Object.keys(semantic).indexOf('*.hsonQualifier') > Object.keys(semantic).indexOf(type),
      `${type}.hsonQualifier wins the equal-specificity match by appearing after the base rule`);
    assert.equal(semantic[type], appearance.house.roles[role][mode].toLowerCase(), `${type} keeps its parent color`);
    assert.equal(semantic[`${type}.hsonLocalName`], type === 'hsonReceiving' ? semantic['*.hsonQualifier'] : undefined,
      `${type}.hsonLocalName only overrides the receiving kind segment`);
  }
  assert.equal(semantic.hsonColon, blend(appearance.house.roles.colon[mode], appearance.house.ui.background[mode],
    appearance.house.intensityOverrides[mode].colon ?? appearance.house.intensity.colon));
  const customQualifier = structuredClone(appearance);
  customQualifier.house.roles.qualifier[mode] = '#123456';
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
  changed.house.roles.localReference[mode] = '#808080';
  changed.house.intensityOverrides[mode].localReference = 1;
  const regenerated = houseTheme(changed, definitions, mode);
  assert.equal(regenerated.semanticTokenColors.hsonLocalReferenceSigil, '#808080');
  assert.equal(regenerated.semanticTokenColors.hsonProperty, semantic.hsonProperty);
  assert.equal(regenerated.semanticTokenColors.hsonIncomingReferenceSigil, semantic.hsonIncomingReferenceSigil);
  const ownerPalette = structuredClone(appearance);
  ownerPalette.house.roles.structure[mode] = ownerPalette.house.ui.background[mode];
  assert.equal(houseTheme(ownerPalette, definitions, mode).semanticTokenColors.hsonDelimiter,
    ownerPalette.house.ui.background[mode].toLowerCase(), 'owner punctuation colors are accepted without contrast adjustment');
}
assert.equal(blend('#344154', '#FAF9F6', .75), '#666f7d');
assert.equal(blend('#101820', '#FAF9F6', .6), '#6e7276');
assert.equal(blend('#3D434B', '#FAF9F6', .75), '#6c7176');
console.log('ok - deterministic House assets, opaque blending, independent roles and language-qualified fallbacks');
