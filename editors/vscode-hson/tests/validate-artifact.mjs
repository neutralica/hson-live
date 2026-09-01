import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const manifest = await readJson("../package.json");
const languageConfiguration = await readJson("../language-configuration.json");
const coreGrammar = await readJson("../syntaxes/hson.tmLanguage.json");

assert.equal(manifest.main, "./dist/extension.js");
assert.equal(manifest.icon, "images/hson-icon.png");
const icon = await readFile(new URL(`../${manifest.icon}`, import.meta.url));
assert.equal(icon.toString("ascii", 1, 4), "PNG");
assert.equal(icon.readUInt32BE(16), 256);
assert.equal(icon.readUInt32BE(20), 256);
assert.deepEqual(manifest.activationEvents, [
  "onStartupFinished",
  "onLanguage:typescript",
  "onLanguage:typescriptreact",
]);
assert.deepEqual(manifest.contributes.languages[0].extensions, [".hson"]);
assert.equal(coreGrammar.scopeName, "source.hson");
assert.equal(manifest.contributes.grammars.length, 1, "spelling-only injection must not bypass binding discovery");
assert.ok(manifest.contributes.semanticTokenTypes.some(type => type.id === "hsonType"));
assert.deepEqual(manifest.contributes.colors.map(color => color.id), [
  "hson.libraryMarker.h", "hson.libraryMarker.s", "hson.libraryMarker.o", "hson.libraryMarker.n",
  "hson.authoringMarker.h", "hson.authoringMarker.s", "hson.authoringMarker.o", "hson.authoringMarker.n",
  "hson.libraryMarker.separator",
]);
assert.ok((await readFile(new URL("../dist/onig.wasm", import.meta.url))).length > 0);
assert.deepEqual(languageConfiguration.comments, { lineComment: "//" });
assert.equal(manifest.contributes.commands.length, 9);
assert.deepEqual(manifest.contributes.commands.slice(-5).map(command => command.command), [
  "hson.generateSchemaTypes", "hson.startSchemaWatch", "hson.stopSchemaWatch", "hson.checkSchemas", "hson.showSchemaOutput",
]);
const configuration = Object.assign({}, ...manifest.contributes.configuration.map(group => group.properties));
assert.equal(configuration["hson.trustedSchemaDiagnostics.enabled"].default, false);
assert.equal(configuration["hson.appearance.libraryMarkerStrength"].default, 1);
assert.equal(configuration["hson.appearance.authoringMarkerStrength"].default, 0.7);
assert.equal(configuration["hson.appearance.libraryMarkerStrength"].multipleOf, undefined);
assert.equal(configuration["hson.appearance.authoringMarkerStrength"].multipleOf, undefined);
const appearanceDefaults = { blue: "#00adf6", yellow: "#c9d100", pink: "#ff4a8c", green: "#39a500" };
assert.deepEqual(Object.keys(appearanceDefaults).map(key => ({
  key: `hson.appearance.${key}`,
  default: configuration[`hson.appearance.${key}`].default,
  scope: configuration[`hson.appearance.${key}`].scope,
})), Object.entries(appearanceDefaults).map(([key, value]) => ({ key: `hson.appearance.${key}`, default: value, scope: "window" })));
assert.equal(configuration["hson.appearance.orange"], undefined);
assert.deepEqual({
  enabled: configuration["hson.appearance.colorLibraryMarker"].default,
  separator: configuration["hson.appearance.librarySeparatorColor"].default,
}, { enabled: true, separator: "#7247d4" });
assert.equal(manifest.capabilities.untrustedWorkspaces.supported, "limited");
assert.ok(manifest.capabilities.untrustedWorkspaces.restrictedConfigurations.includes("hson.trustedSchemaDiagnostics.module"));
assert.ok(manifest.devDependencies.esbuild);
assert.ok(manifest.devDependencies.typescript);
assert.deepEqual(manifest.contributes.typescriptServerPlugins, [{
  name: "../typescript-plugin",
  enableForWorkspaceTypeScriptVersions: true,
}]);
const pluginRequire = createRequire(new URL("../node_modules/__hson_plugin_probe.cjs", import.meta.url));
assert.equal(typeof pluginRequire(manifest.contributes.typescriptServerPlugins[0].name), "function");

process.stdout.write("ok - active extension manifest, language configuration, and grammar JSON are valid\n");
