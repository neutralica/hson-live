import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const manifest = await readJson("../package.json");
const languageConfiguration = await readJson("../language-configuration.json");
const coreGrammar = await readJson("../syntaxes/hson.tmLanguage.json");
const injectionGrammar = await readJson("../syntaxes/hson-template-injection.tmLanguage.json");

assert.equal(manifest.main, "./dist/extension.js");
assert.deepEqual(manifest.activationEvents, [
  "onLanguage:typescript",
  "onLanguage:typescriptreact",
]);
assert.deepEqual(manifest.contributes.languages[0].extensions, [".hson"]);
assert.equal(coreGrammar.scopeName, "source.hson");
assert.deepEqual(manifest.contributes.grammars[1].injectTo, ["source.ts", "source.tsx"]);
assert.match(injectionGrammar.injectionSelector, /source\.ts/);
assert.deepEqual(languageConfiguration.comments, { lineComment: "//" });
assert.equal(manifest.contributes.commands, undefined);
assert.equal(manifest.contributes.configuration, undefined);
assert.ok(manifest.devDependencies.esbuild);
assert.ok(manifest.devDependencies.typescript);

process.stdout.write("ok - active extension manifest, language configuration, and grammar JSON are valid\n");
