import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const manifest = await readJson("../package.json");
const languageConfiguration = await readJson("../language-configuration.json");
const coreGrammar = await readJson("../syntaxes/hson.tmLanguage.json");

assert.equal(manifest.main, "./dist/extension.js");
assert.deepEqual(manifest.activationEvents, [
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
]);
assert.ok((await readFile(new URL("../dist/onig.wasm", import.meta.url))).length > 0);
assert.deepEqual(languageConfiguration.comments, { lineComment: "//" });
assert.equal(manifest.contributes.commands.length, 4);
const configuration = Object.assign({}, ...manifest.contributes.configuration.map(group => group.properties));
assert.equal(configuration["hson.trustedSchemaDiagnostics.enabled"].default, false);
assert.equal(configuration["hson.appearance.libraryMarkerStrength"].default, 1);
assert.equal(configuration["hson.appearance.authoringMarkerStrength"].default, 0.6);
assert.equal(configuration["hson.appearance.libraryMarkerStrength"].multipleOf, undefined);
assert.equal(configuration["hson.appearance.authoringMarkerStrength"].multipleOf, undefined);
assert.deepEqual(["blue", "yellow", "orange", "green"].map(key => ({
  key: `hson.appearance.${key}`,
  default: configuration[`hson.appearance.${key}`].default,
  scope: configuration[`hson.appearance.${key}`].scope,
})), ["blue", "yellow", "orange", "green"].map(key => ({ key: `hson.appearance.${key}`, default: "", scope: "window" })));
assert.equal(manifest.capabilities.untrustedWorkspaces.supported, "limited");
assert.ok(manifest.capabilities.untrustedWorkspaces.restrictedConfigurations.includes("hson.trustedSchemaDiagnostics.module"));
assert.ok(manifest.devDependencies.esbuild);
assert.ok(manifest.devDependencies.typescript);

process.stdout.write("ok - active extension manifest, language configuration, and grammar JSON are valid\n");
