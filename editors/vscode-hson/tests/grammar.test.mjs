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
  ["markdown.hson.codeblock", new URL("../syntaxes/markdown-hson-codeblock.tmLanguage.json", import.meta.url)],
]);

const markdownHostGrammar = {
  scopeName: "text.html.markdown",
  patterns: [
    {
      name: "markup.fenced_code.block.markdown",
      begin: "(^|\\G)(\\s*)(`{3,}|~{3,})\\s*(?=([^`]*)?$)",
      beginCaptures: {
        3: { name: "punctuation.definition.markdown" },
        4: { name: "fenced_code.block.language" },
      },
      end: "(^|\\G)(\\2|\\s{0,3})(\\3)\\s*$",
      endCaptures: { 3: { name: "punctuation.definition.markdown" } },
    },
    { name: "meta.paragraph.markdown", match: ".+" },
  ],
};

const registry = new Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns) => new OnigScanner(patterns),
    createOnigString: (value) => new OnigString(value),
  }),
  loadGrammar: async (scopeName) => {
    if (scopeName === "text.html.markdown") {
      return parseRawGrammar(JSON.stringify(markdownHostGrammar), "markdown-host.json");
    }
    const path = grammarPaths.get(scopeName);
    if (path === undefined) return null;
    const grammar = parseRawGrammar(await readFile(path, "utf8"), path.pathname);
    return grammar;
  },
  getInjections: (scopeName) => scopeName === "text.html.markdown"
    ? ["markdown.hson.codeblock"]
    : [],
});

async function tokenize(scopeName, source) {
  const grammar = await registry.loadGrammar(scopeName);
  assert.ok(grammar, `missing grammar ${scopeName}`);
  const tokens = [];
  let stack = INITIAL;
  for (const [lineNumber, line] of source.split("\n").entries()) {
    const result = grammar.tokenizeLine(line, stack);
    tokens.push(...result.tokens.map((token) => ({
      line: lineNumber,
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

const representative = '<bareName class="hero" enabled true count -12.5>';
const markdownSource = [
  "Before Hson prose.",
  "```hson",
  "// embedded comment",
  representative,
  "['quotedName' \"text\" [null, false] @012345678 <child/>]",
  "```",
  "Between fences.",
  "```json",
  "<notHson enabled=true>",
  "```",
  "```hson",
  "<second flag false>",
  "```",
  "After Hson prose.",
].join("\n");
const markdown = await tokenize("text.html.markdown", markdownSource);

assert.ok(has(markdown, "bareName", "entity.name.type.hson"));
assert.ok(has(markdown, "class", "entity.other.attribute-name.hson"));
assert.ok(has(markdown, "true", "constant.language.boolean.hson"));
assert.ok(has(markdown, "-12.5", "constant.numeric.hson"));
assert.ok(has(markdown, "quotedName", "entity.name.type.quoted.hson"));
assert.ok(has(markdown, "text", "string.quoted.double.hson"));
assert.ok(has(markdown, "null", "constant.language.null.hson"));
assert.ok(has(markdown, "false", "constant.language.boolean.hson"));
assert.ok(has(markdown, "@012345678", "constant.other.quid.hson"));
assert.ok(has(markdown, "second", "entity.name.type.hson"), "a second Hson fence must be embedded independently");
assert.ok(markdown.some(token => token.line === 2 && token.scopes.includes("comment.line.double-slash.hson")));
assert.ok(markdown.some(token => token.line === 3 && token.scopes.includes("meta.embedded.block.hson") && token.scopes.includes("entity.name.type.hson")));
assert.ok(!markdown.some(token => token.line === 8 && token.scopes.some(scope => scope === "source.hson" || scope.endsWith(".hson"))), "non-Hson fences must remain untouched");
assert.ok(markdown.some(token => token.line === 0 && token.scopes.includes("meta.paragraph.markdown")));
assert.ok(markdown.some(token => token.line === 13 && token.scopes.includes("meta.paragraph.markdown")));
assert.ok(!markdown.some(token => (token.line === 0 || token.line === 13) && token.scopes.includes("meta.embedded.block.hson")));

const standaloneRepresentative = await tokenize("source.hson", representative);
for (const text of ["<", "bareName", "class", "true", "-12.5", ">"]) {
  const standaloneToken = standaloneRepresentative.find(token => token.text === text);
  const embeddedToken = markdown.find(token => token.line === 3 && token.text === text);
  assert.ok(standaloneToken, `standalone representative token ${text} is missing`);
  assert.ok(embeddedToken, `embedded representative token ${text} is missing`);
  assert.deepEqual(
    embeddedToken.scopes.filter(scope => scope.endsWith(".hson") && scope !== "meta.embedded.block.hson"),
    standaloneToken.scopes.filter(scope => scope.endsWith(".hson") && scope !== "source.hson"),
    `embedded ${text} scopes must match standalone Hson scopes`,
  );
}

// TS/TSX coverage lives in baseline.test.ts and the real semantic-token journey:
// a synthetic spelling-only injection test must not stand in for shipped behavior.
process.stdout.write("ok - standalone and Markdown-fenced Hson grammar scopes passed\n");
