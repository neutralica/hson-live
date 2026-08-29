import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import textmate from "vscode-textmate";
import oniguruma from "vscode-oniguruma";

const { Registry, INITIAL, parseRawGrammar } = textmate;
const { loadWASM, OnigScanner, OnigString } = oniguruma;

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("vscode-oniguruma/release/onig.wasm");
await loadWASM((await readFile(wasmPath)).buffer);

const grammarPaths = new Map([
  ["source.hson", new URL("../syntaxes/hson.tmLanguage.json", import.meta.url)],
]);

const registry = new Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns) => new OnigScanner(patterns),
    createOnigString: (value) => new OnigString(value),
  }),
  loadGrammar: async (scopeName) => {
    const path = grammarPaths.get(scopeName);
    if (path === undefined) return null;
    const grammar = parseRawGrammar(await readFile(path, "utf8"), path.pathname);
    return grammar;
  },
});

async function tokenize(scopeName, source) {
  const grammar = await registry.loadGrammar(scopeName);
  assert.ok(grammar, `missing grammar ${scopeName}`);
  const tokens = [];
  let stack = INITIAL;
  for (const line of source.split("\n")) {
    const result = grammar.tokenizeLine(line, stack);
    tokens.push(...result.tokens.map((token) => ({
      text: line.slice(token.startIndex, token.endIndex),
      scopes: token.scopes,
    })));
    stack = result.ruleStack;
  }
  return tokens;
}

function has(tokens, text, scope) {
  return tokens.some((token) => token.text === text && token.scopes.includes(scope));
}

function hasScope(tokens, scope) {
  return tokens.some((token) => token.scopes.includes(scope));
}

const standaloneSource = await readFile(new URL("./fixtures/standalone.hson", import.meta.url), "utf8");
const standalone = await tokenize("source.hson", standaloneSource);
assert.ok(hasScope(standalone, "comment.line.double-slash.hson"));
assert.ok(has(standalone, "bareName", "entity.name.type.hson"));
assert.ok(hasScope(standalone, "entity.name.type.quoted.hson"));
assert.ok(hasScope(standalone, "string.quoted.double.hson"));
assert.ok(hasScope(standalone, "constant.character.escape.hson"));
assert.ok(has(standalone, "true", "constant.language.boolean.hson"));
assert.ok(has(standalone, "null", "constant.language.null.hson"));
assert.ok(has(standalone, "-0", "constant.numeric.hson"));
assert.ok(has(standalone, "1e3", "constant.numeric.hson"));
assert.ok(has(standalone, "-12.5", "constant.numeric.hson"));
assert.ok(has(standalone, "[", "punctuation.section.array.begin.hson"));
assert.ok(has(standalone, "«", "punctuation.section.array.begin.hson"));
assert.ok(has(standalone, "class", "entity.other.attribute-name.hson"));
assert.ok(hasScope(standalone, "constant.other.quid.hson"));
assert.ok(hasScope(standalone, "invalid.illegal.reserved-name.hson"));
assert.ok(has(standalone, "foo//bar", "string.unquoted.attribute-value.hson"));
assert.ok(!has(standalone, "//bar", "comment.line.double-slash.hson"));
assert.ok(hasScope(standalone, "invalid.illegal.escape.hson"));
assert.ok(has(standalone, "<", "punctuation.definition.tag.begin.hson"));

// TS/TSX coverage lives in baseline.test.ts and the real semantic-token journey:
// a synthetic spelling-only injection test must not stand in for shipped behavior.
process.stdout.write("ok - standalone Hson grammar scopes passed\n");
