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
  "hson.authoringMarker.h", "hson.authoringMarker.s", "hson.authoringMarker.o", "hson.authoringMarker.n",
]);
assert.ok((await readFile(new URL("../dist/onig.wasm", import.meta.url))).length > 0);
assert.deepEqual(languageConfiguration.comments, { lineComment: "//" });
assert.equal(manifest.contributes.commands, undefined);
assert.equal(manifest.contributes.configuration.properties["hson.trustedSchemaDiagnostics.enabled"].default, false);
assert.equal(manifest.capabilities.untrustedWorkspaces.supported, "limited");
assert.ok(manifest.capabilities.untrustedWorkspaces.restrictedConfigurations.includes("hson.trustedSchemaDiagnostics.module"));
assert.ok(manifest.devDependencies.esbuild);
assert.ok(manifest.devDependencies.typescript);

process.stdout.write("ok - active extension manifest, language configuration, and grammar JSON are valid\n");
