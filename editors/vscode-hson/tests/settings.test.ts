import { hsonGrammarScopes, hsonNativeBrackets } from "../src/appearance-internals.js";
import { HSON_BRANDING } from "../src/appearance-branding.generated.js";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { HSON_APPEARANCE, hsonIdentityMarkers, hsonTokenScopes } from "../src/appearance.js";
import {
  HSON_SETTINGS_QUERY,
  APPEARANCE_COLOR_KEYS,
  appearance_color,
  marker_strength,
} from "../src/settings.js";

const manifest = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
const languageConfiguration = JSON.parse(readFileSync(resolve(__dirname, "../language-configuration.json"), "utf8"));
const groups: readonly { title: string; properties: Record<string, {
  default?: unknown; minimum?: number; maximum?: number; multipleOf?: number;
  pattern?: string; scope?: string; markdownDescription?: string;
}> }[] = manifest.contributes.configuration;
const properties = Object.assign({}, ...groups.map(group => group.properties));
let checks = 0;
function check(name: string, body: () => void): void {
  body();
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

const appearanceGroup = groups.find(group => group.title === "Hson › Appearance");
const localHostGroup = groups.find(group => group.title === "Hson › Local App");
const formattingGroup = groups.find(group => group.title === "Hson › Formatting");
assert.ok(appearanceGroup); assert.ok(localHostGroup); assert.ok(formattingGroup);
check("settings expose the appearance, bounded local-app, and formatting groups", () => assert.deepEqual(groups.map(group => group.title), ["Hson › Appearance", "Hson › Local App", "Hson › Formatting"]));
check("the appearance authority distinguishes appearance values from internal grammar scopes", () => {
  assert.deepEqual(Object.keys(HSON_APPEARANCE), ["syntax", "ui", "branding"]);
  assert.ok(Object.values(hsonGrammarScopes).every(value => value.endsWith(".hson")));
  assert.ok(Object.values(hsonGrammarScopes).every(value => !value.startsWith("#")));
});
check("manifest semantic scope fallbacks mirror the appearance authority", () => {
  assert.deepEqual(manifest.contributes.semanticTokenScopes[0].scopes, hsonTokenScopes);
});
check("manifest color defaults mirror the branding appearance palette", () => {
  const defaultsById = Object.fromEntries(manifest.contributes.colors.map((color: { id: string; defaults: Record<string, string> }) => [color.id, color.defaults]));
  for (const marker of hsonIdentityMarkers) {
    const expected = HSON_APPEARANCE.branding.palette[marker.colorSetting];
    assert.deepEqual(defaultsById[marker.colorId], { dark: expected, light: expected, highContrast: "editor.foreground", highContrastLight: "editor.foreground" });
  }
  const separator = HSON_BRANDING.librarySeparator;
  assert.deepEqual(defaultsById[separator.colorId], { dark: separator.color, light: separator.color, highContrast: "editor.foreground", highContrastLight: "editor.foreground" });
});
check("document self-closing slash belongs to the theme", () => {
  assert.equal("documentSelfClosingSlash" in HSON_APPEARANCE.branding, false);
  assert.equal(hsonGrammarScopes.selfClosingSlash, "punctuation.definition.tag.self-closing.hson");
});
check("native bracket-pair declarations mirror the appearance authority", () => {
  assert.deepEqual(languageConfiguration.colorizedBracketPairs, hsonNativeBrackets.colorizedBracketPairs);
});
check("standalone Hson contributes ordinary overridable two-space editor defaults", () => {
  assert.deepEqual(manifest.contributes.configurationDefaults, {
    '[hson]': { 'editor.tabSize': 2, 'editor.insertSpaces': true },
  });
  assert.equal(properties['hson.indentWidth'], undefined);
});
check("standalone Hson enables the existing document and selection commands", () => {
  for (const command of ['hson.formatDocument', 'hson.formatSelection']) {
    assert.match(manifest.contributes.commands.find((entry: { command: string }) => entry.command === command).enablement, /editorLangId == hson/);
    for (const menu of ['commandPalette', 'editor/context']) {
      assert.match(manifest.contributes.menus[menu].find((entry: { command: string }) => entry.command === command).when, /editorLangId == hson/);
    }
  }
});
check("appearance surface contains only the finalized eight controls", () => assert.deepEqual(
  Object.keys(appearanceGroup.properties),
  [
    "hson.appearance.libraryMarkerStrength",
    "hson.appearance.authoringMarkerStrength",
    "hson.appearance.blue",
    "hson.appearance.yellow",
    "hson.appearance.pink",
    "hson.appearance.green",
    "hson.appearance.colorLibraryMarker",
    "hson.appearance.librarySeparatorColor",
  ],
));
check("library strength has the exact stable key", () => assert.ok(properties["hson.appearance.libraryMarkerStrength"]));
check("library strength defaults to full presence", () => assert.equal(properties["hson.appearance.libraryMarkerStrength"].default, HSON_APPEARANCE.branding.library.opacity));
check("authoring strength has the exact stable key", () => assert.ok(properties["hson.appearance.authoringMarkerStrength"]));
check("authoring strength defaults to seventy percent", () => assert.equal(properties["hson.appearance.authoringMarkerStrength"].default, HSON_APPEARANCE.branding.authoring.opacity));
check("strength range is zero through one", () => {
  for (const key of ["hson.appearance.libraryMarkerStrength", "hson.appearance.authoringMarkerStrength"]) {
    assert.equal(properties[key].minimum, 0); assert.equal(properties[key].maximum, 1);
  }
});
check("strength settings retain bounds without broken multiple-of restrictions", () => {
  assert.equal(properties["hson.appearance.libraryMarkerStrength"].multipleOf, undefined);
  assert.equal(properties["hson.appearance.authoringMarkerStrength"].multipleOf, undefined);
});
check("appearance settings are window scoped", () => assert.equal(properties["hson.appearance.libraryMarkerStrength"].scope, "window"));
check("four shared color fields have approved defaults and accept empty-or-hex overrides", () => {
  assert.deepEqual(APPEARANCE_COLOR_KEYS, ["blue", "yellow", "pink", "green"]);
  const defaults = HSON_APPEARANCE.branding.palette;
  for (const key of APPEARANCE_COLOR_KEYS) {
    const property = properties[`hson.appearance.${key}`];
    assert.equal(property.default, defaults[key]); assert.equal(property.scope, "window");
    const pattern = new RegExp(property.pattern ?? "");
    assert.ok(pattern.test("")); assert.ok(pattern.test("#00adf6")); assert.ok(!pattern.test("blue"));
  }
});
check("default library and authoring markers retain the four shared hue settings", () => {
  for (const publicName of ["hson", "Hson"]) {
    assert.deepEqual(hsonIdentityMarkers.filter(marker => marker.publicName === publicName).map(marker => marker.colorSetting),
      ["blue", "yellow", "pink", "green"]);
  }
});
check("orange is hard-migrated to pink", () => assert.equal(properties["hson.appearance.orange"], undefined));
check("lowercase branding toggle defaults on and is window scoped", () => {
  assert.equal(properties["hson.appearance.colorLibraryMarker"].default, HSON_APPEARANCE.branding.library.enabled);
  assert.equal(properties["hson.appearance.colorLibraryMarker"].scope, "window");
});
check("library separator has the approved violet default and accepted hex forms", () => {
  const property = properties["hson.appearance.librarySeparatorColor"];
  assert.equal(property.default, HSON_BRANDING.librarySeparator.color); assert.equal(property.scope, "window");
  const pattern = new RegExp(property.pattern ?? "");
  for (const value of ["", "#abc", "#abcd", "#abcdef", "#abcdef12"]) assert.ok(pattern.test(value));
  assert.ok(!pattern.test("violet"));
});
check("runtime color parsing accepts hex and falls back for unset or invalid values", () => {
  assert.equal(appearance_color("#abc"), "#abc"); assert.equal(appearance_color("#69B8EECC"), "#69B8EECC");
  assert.equal(appearance_color(""), undefined); assert.equal(appearance_color("blue"), undefined);
});
check("retired trusted Schema settings are absent", () => assert.equal(Object.keys(properties).some(key => key.startsWith("hson.trustedSchemaDiagnostics.")), false));
check("local-host settings describe one built entry and narrow runtime controls", () => {
  assert.deepEqual(Object.keys(localHostGroup.properties), [
    "hson.localHost.entry", "hson.localHost.applicationExport", "hson.localHost.nodeExecutable", "hson.localHost.port",
    "hson.localHost.buildCommand", "hson.localHost.restartOnSave", "hson.localHost.sourceDirectory",
  ]);
  assert.equal(properties["hson.localHost.entry"].default, "");
  assert.equal(properties["hson.localHost.entry"].scope, "resource");
  assert.equal(properties["hson.localHost.applicationExport"].default, "application");
  assert.equal(properties["hson.localHost.nodeExecutable"].default, "node");
  assert.equal(properties["hson.localHost.port"].default, 8787);
  assert.equal(properties["hson.localHost.port"].minimum, 0);
  assert.equal(properties["hson.localHost.port"].maximum, 65_535);
});
check("Hson format-on-save is one resource setting enabled by default", () => {
  assert.deepEqual(Object.keys(formattingGroup.properties), ["hson.formatting.formatOnSave"]);
  const setting = properties["hson.formatting.formatOnSave"];
  assert.equal(setting.default, true);
  assert.equal(setting.scope, "resource");
  assert.equal(setting.markdownDescription, "Format recognized Hson authoring regions on explicit Save or Save All. Auto-save does not format.");
});
check("no retired execution settings are advertised as restricted", () => assert.equal(manifest.capabilities.untrustedWorkspaces.restrictedConfigurations, undefined));
check("settings search targets this extension", () => assert.equal(HSON_SETTINGS_QUERY, "@ext:terminal-gothic.hson-language"));
check("marker strength clamps invalid low and high values", () => {
  assert.equal(marker_strength(-1, 0.5), 0); assert.equal(marker_strength(2, 0.5), 1);
});
check("marker strength falls back for non-finite input", () => assert.equal(marker_strength(Number.NaN, 0.6), 0.6));
check("production TypeScript has no second owner-authored branding palette", () => {
  const sourceRoot = resolve(__dirname, "../src");
  const visit = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? visit(path) : entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
  const palette = [...Object.values(HSON_APPEARANCE.branding.palette), HSON_BRANDING.librarySeparator.color];
  for (const path of visit(sourceRoot)) {
    if (path.endsWith("appearance.ts") || path.endsWith("appearance-branding.generated.ts")) continue;
    const source = readFileSync(path, "utf8");
    for (const color of palette) assert.equal(source.includes(color), false, `${path} duplicates ${color}`);
  }
});
check("the compact command set complements settings and status", () => assert.deepEqual(
  manifest.contributes.commands.map((command: { command: string }) => command.command),
  [
    "hson.openSettings", "hson.formatDocument", "hson.formatSelection", "hson.generateSchemaTypes", "hson.startSchemaWatch", "hson.stopSchemaWatch", "hson.checkSchemas", "hson.showSchemaOutput",
    "hson.runAll", "hson.stopAll", "hson.startLocalHost", "hson.runAndOpenLocalApp", "hson.stopLocalHost", "hson.restartLocalHost", "hson.openLocalApp", "hson.copyLocalAppUrl", "hson.showLocalHostOutput",
  ],
));

process.stdout.write(`ok - ${checks} focused settings and consent checks passed\n`);
