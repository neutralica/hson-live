import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import textmate from "vscode-textmate";
import oniguruma from "vscode-oniguruma";

const { Registry, INITIAL, parseRawGrammar } = textmate;
const { loadWASM, OnigScanner, OnigString } = oniguruma;

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("vscode-oniguruma/release/onig.wasm");
await loadWASM((await readFile(wasmPath)).buffer);

const testTypeScriptGrammar = process.env.HSON_VSCODE_TYPESCRIPT_GRAMMAR === undefined
  ? new URL("./fixtures/source.ts.tmLanguage.json", import.meta.url)
  : pathToFileURL(process.env.HSON_VSCODE_TYPESCRIPT_GRAMMAR);
const grammarPaths = new Map([
  ["source.hson", new URL("../syntaxes/hson.tmLanguage.json", import.meta.url)],
  ["source.hson.template.injection", new URL("../syntaxes/hson-template-injection.tmLanguage.json", import.meta.url)],
  ["source.ts", testTypeScriptGrammar],
  ["source.tsx", new URL("./fixtures/source.ts.tmLanguage.json", import.meta.url)],
]);

const registry = new Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns) => new OnigScanner(patterns),
    createOnigString: (value) => new OnigString(value),
  }),
  getInjections: (scopeName) => scopeName === "source.ts" || scopeName === "source.tsx"
    ? ["source.hson.template.injection"]
    : [],
  loadGrammar: async (scopeName) => {
    const path = grammarPaths.get(scopeName);
    if (path === undefined) return null;
    const grammar = parseRawGrammar(await readFile(path, "utf8"), path.pathname);
    if (scopeName === "source.tsx") grammar.scopeName = scopeName;
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

const injectionSource = await readFile(new URL("./fixtures/injection.ts", import.meta.url), "utf8");
const injection = await tokenize("source.ts", injectionSource);
assert.ok(has(injection, "hson", "support.function.tagged-template.hson"));
assert.ok(has(injection, "main", "entity.name.type.hson"));
assert.ok(injection.some((token) => token.text === "nested" && token.scopes.includes("meta.embedded.expression.ts")));
assert.ok(!injection.some((token) => token.text === "nested" && token.scopes.includes("entity.name.type.hson")));
assert.ok(injection.some((token) => token.text.includes(")") && token.scopes.includes("meta.embedded.expression.ts")));
assert.ok(hasScope(injection, "constant.character.escape.ts"));
assert.ok(!injection.some((token) => token.text === "notHson" && token.scopes.includes("entity.name.type.hson")));
assert.ok(!injection.some((token) => token.text === "notHsonEither" && token.scopes.includes("entity.name.type.hson")));
assert.ok(!injection.some((token) => token.text === "plain" && token.scopes.includes("entity.name.type.hson")));

const crlf = await tokenize("source.ts", "const value = hson`\r\n  <main/>\r\n`;\r\n");
assert.ok(has(crlf, "main", "entity.name.type.hson"));

const tsxSource = await readFile(new URL("./fixtures/injection.tsx", import.meta.url), "utf8");
const tsx = await tokenize("source.tsx", tsxSource);
assert.ok(has(tsx, "section", "entity.name.type.hson"));

process.stdout.write("ok - standalone and TypeScript/TSX injection grammar fixtures passed\n");
