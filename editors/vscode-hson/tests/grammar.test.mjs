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
      begin: "(^|\\G)( {0,3})(`{3,})[ \\t]*(?=([^`]*)?$)",
      beginCaptures: {
        3: { name: "punctuation.definition.markdown" },
        4: { name: "fenced_code.block.language" },
      },
      end: "(^|\\G)(?:\\2| {0,3})(\\3`*)[ \\t]*$",
      endCaptures: { 2: { name: "punctuation.definition.markdown" } },
    },
    {
      name: "markup.fenced_code.block.markdown",
      begin: "(^|\\G)( {0,3})(~{3,})[ \\t]*(?=(.*)$)",
      beginCaptures: {
        3: { name: "punctuation.definition.markdown" },
        4: { name: "fenced_code.block.language" },
      },
      end: "(^|\\G)(?:\\2| {0,3})(\\3~*)[ \\t]*$",
      endCaptures: { 2: { name: "punctuation.definition.markdown" } },
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
  // Captured punctuation may split a declaration while retaining its enclosing scope.
  return tokens.some((token, index) => {
    let value = '';
    while (tokens[index]?.line === token.line && tokens[index].scopes.includes(scope)) {
      value += tokens[index++].text;
      if (value === text) return true;
      if (!text.startsWith(value)) break;
    }
    return false;
  });
}

function hasScope(tokens, scope) {
  return tokens.some((token) => token.scopes.includes(scope));
}

const quads = await tokenize("source.hson", '<nav @:navigation <a @:next/> <hson-part @:content lib="parts" at="content"/>/>');
for (const declaration of ['@:navigation', '@:next', '@:content']) {
  assert.ok(has(quads, declaration, 'constant.other.quad.hson'));
  assert.ok(!has(quads, declaration, 'constant.other.quid.hson'));
}
assert.ok(has(await tokenize('source.hson', '<p @:text"Text"/>'), '@:text', 'constant.other.quad.hson'));
for (const invalid of ['@:bad-name', '@:123', '@:' + 'x'.repeat(129)]) {
  assert.ok(!hasScope(await tokenize('source.hson', '<p ' + invalid + '/>'), 'constant.other.quad.hson'));
}

for (const [source, kind, pieces] of [
  ['<p @:identity next="after"/>\n<b/>', 'quad', [['@', 'punctuation.definition.identity.hson'], [':', 'punctuation.separator.identity.hson'], ['identity', 'constant.other.identity.hson']]],
  ['<p @012345678 next="after"/>\n<b/>', 'quid', [['@', 'punctuation.definition.identity.hson'], ['012345678', 'constant.other.identity.hson']]],
]) {
  const actual = await tokenize('source.hson', source);
  const begin = actual.findIndex(token => token.text === '@');
  assert.deepEqual(actual.slice(begin, begin + pieces.length).map(({ text, scopes }) => ({ text, scopes })), pieces.map(([text, scope]) => ({ text, scopes: ['source.hson', `constant.other.${kind}.hson`, scope] })));
  assert.deepEqual(actual.find(token => token.text === 'next')?.scopes, ['source.hson', 'entity.other.attribute-name.hson']);
  assert.deepEqual(actual.filter(token => token.line === 1), (await tokenize('source.hson', '<b/>')).map(token => ({ ...token, line: 1 })));
}
for (const source of ['<p "@:literal @012345678"/>', '// @:comment @012345678', '<p "%{d[\\"@:key\\"]} #{d[\\"@012345678\\"]} ${value}"/>']) {
  assert.ok(!(await tokenize('source.hson', source)).some(token => token.scopes.includes('constant.other.identity.hson')), source);
}
for (const value of ['@01234567', '@0123456789', '@iiiiiiiii']) {
  assert.ok(!hasScope(await tokenize('source.hson', `<p ${value}/>`), 'constant.other.quid.hson'), value);
}

const header = await tokenize('source.hson', '<button data:model="one" model:data="two" part:optional="true" disabled/>\n<next part:optional/>');
assert.deepEqual(header.filter(token => ['button', 'data:model', 'model:data', 'disabled', 'next', 'part:optional'].includes(token.text)).map(({ text, scopes }) => ({ text, scopes })), [
  { text: 'button', scopes: ['source.hson', 'entity.name.type.hson'] },
  ...['data:model', 'model:data', 'part:optional'].map(text => ({ text, scopes: ['source.hson', 'entity.other.attribute-name.hson'] })),
  { text: 'disabled', scopes: ['source.hson', 'constant.language.flag.hson'] },
  { text: 'next', scopes: ['source.hson', 'entity.name.type.hson'] },
  { text: 'part:optional', scopes: ['source.hson', 'constant.language.flag.hson'] },
]);
for (const value of ['one', 'two', 'true']) assert.deepEqual(header.find(token => token.text === value)?.scopes, ['source.hson', 'string.quoted.double.hson']);
assert.deepEqual((await tokenize('source.hson', '<button class=card disabled/>')).filter(token => ['class', 'card', 'disabled'].includes(token.text)).map(({ text, scopes }) => ({ text, scopes })), [
  { text: 'class', scopes: ['source.hson', 'entity.other.attribute-name.hson'] },
  { text: 'card', scopes: ['source.hson', 'string.unquoted.attribute-value.hson'] },
  { text: 'disabled', scopes: ['source.hson', 'constant.language.flag.hson'] },
]);
for (const source of ['<button disabled\n<next enabled/>', '<button disabled // hidden fake=value\n<next enabled/>', '<button value="unfinished\n<next enabled/>', '<button value=\n<next enabled/>', '<button value="escaped \\\" disabled"\n<next enabled/>']) {
  const actual = await tokenize('source.hson', source);
  assert.deepEqual(actual.find(token => token.text === 'next')?.scopes, ['source.hson', 'entity.name.type.hson'], source);
  assert.deepEqual(actual.find(token => token.text === 'enabled')?.scopes, ['source.hson', 'constant.language.flag.hson'], source);
  assert.ok(!actual.some(token => token.text === 'disabled' && token.scopes.includes('string.quoted.double.hson') && token.scopes.includes('constant.language.flag.hson')), source);
}
// Hson name punctuation does not delimit a primitive keyword prefix.
for (const name of ['true-flag', 'false.key', 'null:flag']) {
  for (const assigned of [false, true]) {
    const source = `<item ${name}${assigned ? '="value"' : ''} disabled model:data="done"/> <next enabled/>`;
    const actual = await tokenize('source.hson', source);
    const expected = await tokenize('source.hson', `<item ordinary${assigned ? '="value"' : ''} disabled model:data="done"/> <next enabled/>`);
    assert.deepEqual(actual.map(token => token.text === name ? { ...token, text: 'ordinary' } : token), expected, source);
  }
}
const keywordFlags = await tokenize('source.hson', '<item true-flag false.key null:flag/>');
assert.deepEqual(keywordFlags.filter(token => token.scopes.includes('constant.language.flag.hson')).map(token => token.text), ['true-flag', 'false.key', 'null:flag']);
for (const primitive of ['true', 'false', 'null']) {
  const actual = await tokenize('source.hson', `<value ${primitive}>\n<next enabled/>`);
  assert.deepEqual(actual.find(token => token.text === primitive)?.scopes, ['source.hson', `constant.language.${primitive === 'null' ? 'null' : 'boolean'}.hson`]);
  assert.deepEqual(actual.filter(token => token.line === 1), (await tokenize('source.hson', '<next enabled/>')).map(token => ({ ...token, line: 1 })));
  const assigned = await tokenize('source.hson', `<item ${primitive}="value" disabled/>`);
  assert.deepEqual(assigned.find(token => token.text === primitive)?.scopes, ['source.hson', 'entity.other.attribute-name.hson']);
  assert.deepEqual(assigned.find(token => token.text === 'disabled')?.scopes, ['source.hson', 'constant.language.flag.hson']);
}
for (const trivia of ['\n', '\r\n  ', '\n\n\t']) {
  for (const value of ['"done"', 'plain', String.raw`"#{d[\"odd}key\"]} after"`]) {
    const source = `<item true-flag model:data${trivia}=\n  ${value} disabled next="kept"/>\n<next enabled/>`;
    const actual = await tokenize('source.hson', source);
    // A prior-line name remains provisionally a flag: TextMate cannot look
    // ahead into another physical line. Assignment and all following tokens
    // must still be identical to the ordinary same-line assignment.
    assert.deepEqual(actual.find(token => token.text === 'model:data')?.scopes, ['source.hson', 'constant.language.flag.hson']);
    const expected = await tokenize('source.hson', `<item true-flag model:data=${value} disabled next="kept"/>\n<next enabled/>`);
    const tail = tokens => {
      const start = tokens.findIndex(token => token.text === '='); assert.ok(start >= 0, source);
      return tokens.slice(start).filter(token => token.text.trim()).map(({ text, scopes }) => ({ text, scopes }));
    };
    assert.deepEqual(tail(actual), tail(expected), source);
  }
}
for (const name of ['true', 'false', 'null', 'true-flag', 'false.key', 'model:data']) {
  for (const trivia of [' \t', '\n', ' \r\n\t', ' // pending\n\n  ']) {
    const suffix = ' disabled extra:key=plain @:identity/> <next enabled/>\n<value false>';
    const source = `<item ${name}${trivia}= "done"` + suffix;
    const actual = await tokenize('source.hson', source);
    const expected = await tokenize('source.hson', `<item ${name}="done"` + suffix);
    const tail = tokens => tokens.slice(tokens.findIndex(token => token.text === '='))
      .filter(token => token.text.trim()).map(({ text, scopes }) => ({ text, scopes }));
    assert.deepEqual(tail(actual), tail(expected), source);
    assert.deepEqual(actual.find(token => token.text === name)?.scopes,
      ['source.hson', trivia.includes('\n') ? 'constant.language.flag.hson' : 'entity.other.attribute-name.hson'], source);
  }
}
const consecutive = '<item true\n="one" false\n=two null\n="three" data:key="four" true-flag false.key null:flag/> <next enabled/>';
const ordinaryConsecutive = await tokenize('source.hson', consecutive.replaceAll('\n', ' '));
assert.deepEqual((await tokenize('source.hson', consecutive)).filter(token => token.text.trim()).map(({ text, scopes }) => ({ text, scopes })),
  ordinaryConsecutive.filter(token => token.text.trim()).map(({ text, scopes }) => ({ text,
    scopes: ['true', 'false', 'null'].includes(text) ? ['source.hson', 'constant.language.flag.hson'] : scopes })));

for (const source of ['<item true-flag false.key null:flag', '<item true-flag\n<next enabled/>', '<item model:data\n=\n<next enabled/>',
  '<item true\n<next enabled/>', '<item false\n=\n<next enabled/>', '<item null // pending\n<next enabled/>']) {
  const actual = await tokenize('source.hson', source);
  if (source.includes('<next')) {
    assert.deepEqual(actual.find(token => token.text === 'next')?.scopes, ['source.hson', 'entity.name.type.hson'], source);
    assert.deepEqual(actual.find(token => token.text === 'enabled')?.scopes, ['source.hson', 'constant.language.flag.hson'], source);
  } else assert.deepEqual(actual.filter(token => token.scopes.includes('constant.language.flag.hson')).map(token => token.text), ['true-flag', 'false.key', 'null:flag']);
}
assert.deepEqual((await tokenize('source.hson', '<item disabled\n  enabled/>')).filter(token => token.scopes.includes('constant.language.flag.hson')).map(token => token.text), ['disabled', 'enabled']);

const structural = await tokenize('source.hson', '<hson-part part:optional #{control}/>\n<b/>');
assert.deepEqual(structural.filter(token => token.scopes.includes('constant.language.flag.hson')).map(token => token.text), ['part:optional']);
assert.ok(has(structural, '#', 'keyword.operator.interpolation.hash.hson'));
assert.deepEqual(structural.find(token => token.text === 'b')?.scopes, ['source.hson', 'entity.name.type.hson']);
for (const [sigil, scope] of [['%', 'percent'], ['#', 'hash']]) {
  const actual = await tokenize('source.hson', `<p title=prefix${sigil}{value} disabled/>`);
  assert.ok(has(actual, sigil, `keyword.operator.interpolation.${scope}.hson`));
  assert.ok(has(actual, 'disabled', 'constant.language.flag.hson'));
}
assert.ok(!hasScope(await tokenize('source.hson', '<p title=@:text value=@012345678/>'), 'constant.other.identity.hson'));

const references = await tokenize("source.hson", '<main d:data="%{payload}" title="#{d.title}" <hson-part #{control}/>/ >');
assert.ok(hasScope(references, "meta.part.incoming.hson"));
assert.ok(hasScope(references, "meta.part.local.hson"));

// Compare the complete following-token sequence, including on the same line.
for (const sigil of ['%', '#', '$']) {
  for (const key of ['odd}key', 'quote"key', 'slash\\key', 'slash\\"}key', '']) {
    const value = JSON.stringify(`${sigil}{d[${JSON.stringify(key)}][0]["nested"]} plain`);
    const source = `<p value=${value} next="after" "tail"/>\n<b next="after" "tail"/>`;
    const actual = await tokenize('source.hson', source);
    const expected = await tokenize('source.hson', '<p value="safe" next="after" "tail"/>\n<b next="after" "tail"/>');
    const tail = tokens => tokens.slice(tokens.findIndex(token => token.text === 'next'));
    assert.deepEqual(tail(actual), tail(expected), source);
    const plain = actual.find(token => token.text === ' plain');
    assert.deepEqual(plain?.scopes, ['source.hson', 'string.quoted.double.hson'], source);
  }
  for (const unfinished of [`${sigil}{d`, `${sigil}{d[`, `${sigil}{d[\\"odd}key`]) {
    const source = `<p value="${unfinished}" next="after"/>\n<b/>`;
    const actual = await tokenize('source.hson', source);
    assert.deepEqual(actual.find(token => token.text === 'next')?.scopes, ['source.hson', 'entity.other.attribute-name.hson'], source);
    assert.deepEqual(actual.filter(token => token.line === 1), (await tokenize('source.hson', '<b/>')).map(token => ({ ...token, line: 1 })), source);
  }
}

for (const [sigil, scope] of [['$', 'dollar'], ['%', 'percent'], ['#', 'hash']]) {
  const actual = await tokenize('source.hson', `<p title="before ${sigil}{value} after"/>\n<b/>`);
  const meta = sigil === '$' ? 'meta.interpolation.hson' : sigil === '%' ? 'meta.part.incoming.hson' : 'meta.part.local.hson';
  const base = ['source.hson', 'string.quoted.double.hson', meta];
  assert.deepEqual(actual.slice(actual.findIndex(token => token.text === sigil), actual.findIndex(token => token.text === sigil) + 4).map(({ text, scopes }) => ({ text, scopes })), [
    { text: sigil, scopes: [...base, `keyword.operator.interpolation.${scope}.hson`] },
    { text: '{', scopes: [...base, 'punctuation.definition.template-expression.begin.hson'] },
    { text: 'value', scopes: sigil === '$' ? base : [...base, 'variable.other.property.hson'] },
    { text: '}', scopes: [...base, 'punctuation.definition.template-expression.end.hson'] },
  ]);
  assert.ok(has(actual, sigil, `keyword.operator.interpolation.${scope}.hson`));
  assert.ok(has(actual, '{', 'punctuation.definition.template-expression.begin.hson'));
  assert.ok(has(actual, '}', 'punctuation.definition.template-expression.end.hson'));
  assert.ok(has(actual, '=', 'keyword.operator.assignment.hson'));
  assert.ok(has(actual, '"', 'punctuation.definition.string.begin.hson'));
  assert.ok(has(actual, '"', 'punctuation.definition.string.end.hson'));
  assert.deepEqual(actual.find(token => token.text === ' after')?.scopes, ['source.hson', 'string.quoted.double.hson']);
  assert.deepEqual(actual.filter(token => token.line === 1), (await tokenize('source.hson', '<b/>')).map(token => ({ ...token, line: 1 })));
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
assert.ok(has(standalone, "/", "punctuation.definition.tag.self-closing.hson"));
assert.ok(has(standalone, ">", "punctuation.definition.tag.end.hson"));
assert.ok(has(standalone, "]", "punctuation.section.array.end.hson"));
assert.ok(has(standalone, ",", "punctuation.separator.sequence.hson"));
assert.ok(has(standalone, "=", "keyword.operator.assignment.hson"));

const authoredQuote = standalone.find(token => token.text === "'" && token.scopes.includes("entity.name.type.quoted.hson"));
const valueQuote = standalone.find(token => token.text === "\"" && token.scopes.includes("string.quoted.double.hson"));
assert.ok(authoredQuote?.scopes.some(scope => scope.startsWith("punctuation.definition.string.")));
assert.ok(valueQuote?.scopes.some(scope => scope.startsWith("punctuation.definition.string.")));

const representative = '<bareName class="hero" enabled true count -12.5/>';
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

const fenceLifetimeSource = [
  "```hson",
  "<triple/>",
  "```",
  "triple prose",
  "````hson",
  "```",
  "<afterShortBackticks/>",
  "`````",
  "longer-close prose",
  "~~~~hson",
  "```",
  "<afterOppositeBackticks/>",
  "~~~~",
  "tilde prose",
  "```hson",
  "~~~~",
  "<afterOppositeTildes/>",
  "````",
  "final prose",
].join("\n");
const fenceLifetime = await tokenize("text.html.markdown", fenceLifetimeSource);
for (const [line, name] of [[1, "triple"], [6, "afterShortBackticks"], [11, "afterOppositeBackticks"], [16, "afterOppositeTildes"]]) {
  assert.ok(fenceLifetime.some(token => token.line === line && token.text === name && token.scopes.includes("entity.name.type.hson")),
    `${name} must remain in Hson until the matching delimiter kind and sufficient width closes`);
}
for (const line of [3, 8, 13, 18]) {
  assert.ok(fenceLifetime.some(token => token.line === line && token.scopes.includes("meta.paragraph.markdown")),
    `line ${line} must return to ordinary Markdown after its valid close`);
  assert.ok(!fenceLifetime.some(token => token.line === line && token.scopes.includes("meta.embedded.block.hson")));
}

const standaloneRepresentative = await tokenize("source.hson", representative);
for (const text of ["<", "bareName", "class", "=", "\"", "hero", "true", "-12.5", "/", ">"]) {
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

const multiline = await tokenize("source.hson", '<p "\n  first\n  // <inside/>\n  last\n"/>\n<after/>');
assert.ok(multiline.some(token => token.line === 2 && token.scopes.includes("string.quoted.double.hson")));
assert.ok(!multiline.some(token => token.line === 2 && token.scopes.includes("comment.line.double-slash.hson")));
assert.ok(has(multiline, "after", "entity.name.type.hson"));
for (const fence of ["```", "~~~~"]) {
  const bounded = await tokenize("text.html.markdown", `${fence}hson\n<p "\ninside\n${fence}\noutside prose\n${fence}hson\n<fresh/>\n${fence}`);
  assert.ok(bounded.some(token => token.line === 2 && token.scopes.includes("string.quoted.double.hson")));
  assert.ok(!bounded.some(token => token.line === 4 && token.scopes.includes("string.quoted.double.hson")));
  assert.ok(has(bounded, "fresh", "entity.name.type.hson"));
}

// Native bracket scanning consumes binary language/token metadata, not semantic
// scopes. Check both actual Hson contexts with VS Code's balanced-token defaults.
for (const scopeName of ["source.hson", "text.html.markdown"]) {
  const nativeRegistry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner: patterns => new OnigScanner(patterns), createOnigString: value => new OnigString(value) }),
    loadGrammar: async scope => scope === "text.html.markdown"
      ? parseRawGrammar(JSON.stringify(markdownHostGrammar), "markdown-host.json")
      : grammarPaths.has(scope) ? parseRawGrammar(await readFile(grammarPaths.get(scope), "utf8"), "grammar.json") : null,
    getInjections: scope => scope === "text.html.markdown" ? ["markdown.hson.codeblock"] : [],
  });
  const grammar = await nativeRegistry.loadGrammarWithConfiguration(scopeName, scopeName === "source.hson" ? 1 : 2, {
    embeddedLanguages: { "meta.embedded.block.hson": 1 },
    balancedBracketSelectors: ["*"],
  });
  assert.ok(grammar);
  const body = "<\n 'literal < « [ > » ] name' 1\n value \"\n <not structure> «text»\n \"\n // < « [ > » ]\n real «<x 1>»\n>";
  const source = scopeName === "source.hson" ? body : "```hson\n" + body + "\n```";
  let state = INITIAL;
  const brackets = [];
  for (const line of source.split("\n")) {
    const result = grammar.tokenizeLine2(line, state);
    state = result.ruleStack;
    for (let index = 0; index < result.tokens.length; index += 2) {
      const metadata = result.tokens[index + 1];
      const language = metadata & 255, type = (metadata >> 8) & 3;
      if (language !== 1 || type !== 0 || !(metadata & 1024)) continue;
      const text = line.slice(result.tokens[index], result.tokens[index + 2] ?? line.length);
      brackets.push(...text.match(/[<>«»\[\]]/g) ?? []);
    }
  }
  assert.deepEqual(brackets, ["<", "«", "<", ">", "»", ">"], scopeName);
}
process.stdout.write("ok - native standalone and Markdown bracket metadata excludes quoted names and multiline strings\n");

const partDeclaration = await tokenize('source.hson', '<button hson:part disabled/>');
assert.deepEqual(partDeclaration.filter(token => token.text === 'hson:part').map(token => token.scopes), [['source.hson', 'keyword.declaration.part.hson']]);

const visible = await tokenize('source.hson', await readFile(new URL('./fixtures/visible-highlighting.hson', import.meta.url), 'utf8'));
for (const path of ['data', 'slide.href', 'slide2.value']) {
  assert.ok(has(visible, path, 'variable.other.property.hson'), path);
}
for (const [text, scope] of [['tag', 'entity.name.type.hson'], ['hson:part', 'keyword.declaration.part.hson'],
  ['slide:data', 'entity.other.attribute-name.hson'], ['=', 'keyword.operator.assignment.hson'],
  ['enabled', 'constant.language.flag.hson'], ['svg', 'entity.name.type.hson'], ['path', 'entity.name.type.hson'],
  ['M2 10h4', 'string.quoted.double.hson'], ['/', 'punctuation.definition.tag.self-closing.hson']]) {
  assert.ok(has(visible, text, scope), text);
}

// Resolve the installed VS Code themes through the native TextMate engine.
// Opt in with HSON_VSCODE_THEMES pointing at theme-defaults/themes; no theme
// palette is copied into Hson. This checks scope fallbacks, not user overrides
// or a theme's explicit semantic-token rules.
if (process.env.HSON_VSCODE_THEMES) {
  const { resolve, dirname } = await import('node:path');
  const { parseConfigFileTextToJson } = require('typescript');
  async function readTheme(file) {
    const parsed = parseConfigFileTextToJson(file, await readFile(file, 'utf8'));
    assert.equal(parsed.error, undefined, file);
    const theme = parsed.config;
    const base = theme.include ? await readTheme(resolve(dirname(file), theme.include)) : { colors: {}, tokenColors: [] };
    return { colors: { ...base.colors, ...theme.colors }, tokenColors: [...base.tokenColors, ...theme.tokenColors ?? []] };
  }
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const fallbacks = manifest.contributes.semanticTokenScopes[0].scopes;
  const cases = [
    ['data', 'hsonReference'], ['slide.href', 'hsonReference'], ['slide2.value', 'hsonReference'],
    ['%', 'hsonOperator'], ['#', 'hsonOperator'], ['{', 'hsonInterpolationDelimiter'], ['}', 'hsonInterpolationDelimiter'],
    ['"', 'hsonQuote'], ['=', 'hsonOperator'], ['M2 10h4', 'hsonString'],
    ['tag', 'hsonType'], ['slide:data', 'hsonProperty'], ['enabled', 'hsonKeyword'], ['hson:part', 'hsonDeclaration'],
  ];
  const stacks = [...cases.map(([text]) => visible.find(token => token.text === text).scopes),
    ...Object.values(fallbacks).flat().map(scope => scope.split(' '))];
  for (const name of ['2026-light', '2026-dark', 'light_plus', 'dark_plus']) {
    const theme = await readTheme(resolve(process.env.HSON_VSCODE_THEMES, name + '.json'));
    // A sentinel exposes an absent fallback instead of silently mistaking the
    // editor default (or the host template's string color) for a match.
    const sentinel = '#010203';
    const themed = new Registry({
      theme: { settings: [{ settings: { foreground: sentinel } }, ...theme.tokenColors] },
      onigLib: Promise.resolve({ createOnigScanner: p => new OnigScanner(p), createOnigString: s => new OnigString(s) }),
      loadGrammar: async scope => scope === 'source.ts'
        ? parseRawGrammar(await readFile(resolve(process.env.HSON_VSCODE_THEMES, '../../typescript-basics/syntaxes/TypeScript.tmLanguage.json'), 'utf8'), 'typescript.json')
        : { scopeName: 'source.scope-probe', patterns: stacks.map((stack, index) => ({ match: '^p' + index + '$', name: stack.join(' ') })) },
    });
    const probe = await themed.loadGrammar('source.scope-probe');
    const foreground = stack => {
      const index = stacks.findIndex(candidate => candidate.join(' ') === stack.join(' '));
      assert.ok(index >= 0);
      const metadata = probe.tokenizeLine2('p' + index, INITIAL).tokens[1];
      return themed.getColorMap()[(metadata >>> 15) & 511];
    };
    const resolved = new Map();
    for (const [text, type] of cases) {
      const standalone = foreground(visible.find(token => token.text === text).scopes);
      const embedded = fallbacks[type].map(scope => foreground(scope.split(' '))).find(color => color !== sentinel);
      assert.ok(embedded, `${name}: missing ${type} fallback`);
      assert.equal(embedded, standalone, `${name}: standalone/embedded ${text}`);
      resolved.set(text, standalone);
    }
    for (const path of ['data', 'slide.href', 'slide2.value']) assert.notEqual(resolved.get(path), resolved.get('M2 10h4'), `${name}: path versus string`);
    assert.notEqual(resolved.get('{'), resolved.get('data'), `${name}: braces versus path`);
    assert.notEqual(resolved.get('%'), resolved.get('{'), `${name}: sigil versus brace`);
    const host = await themed.loadGrammar('source.ts');
    const line = 'const value = Hson.document`<tag slide2:data="${data2}"/>`;';
    const lexical = host.tokenizeLine(line, INITIAL).tokens;
    const binary = host.tokenizeLine2(line, INITIAL).tokens;
    for (const [offset, scope] of [[line.indexOf('${'), 'punctuation.definition.template-expression.begin.ts'],
      [line.indexOf('}'), 'punctuation.definition.template-expression.end.ts']]) {
      assert.ok(lexical.find(token => token.startIndex <= offset && token.endIndex > offset).scopes.includes(scope));
      let metadata;
      for (let index = 0; index < binary.length; index += 2) {
        if (binary[index] <= offset && (binary[index + 2] ?? line.length) > offset) metadata = binary[index + 1];
      }
      assert.equal(themed.getColorMap()[(metadata >>> 15) & 511], resolved.get('{'), `${name}: native host interpolation`);
    }
    console.log('ok - native theme scope foregrounds ' + name + ': ' + JSON.stringify(Object.fromEntries(resolved)));
    themed.dispose();
  }
} else {
  console.log('skip - installed theme foreground checks (set HSON_VSCODE_THEMES to theme-defaults/themes)');
}
