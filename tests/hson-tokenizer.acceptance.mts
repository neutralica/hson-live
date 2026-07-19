import assert from "node:assert/strict";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { parse_json } from "../src/api/transform/parsers/parse-json.ts";
import { parse_tokens } from "../src/api/transform/parsers/parse-tokens.ts";
import { serialize_hson } from "../src/api/transform/serializers/serialize-hson.ts";
import { tokenize_hson } from "../src/api/transform/parsers/tokenize-hson.ts";

let checks = 0;

function check(name, fn) {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function token_summary(tokens) {
  return tokens.map((token) => {
    switch (token.kind) {
      case "OPEN":
        return {
          kind: token.kind,
          tag: token.tag,
          attrs: token.rawAttrs.map((attr) => ({
            name: attr.name,
            ...(attr.value ? { value: attr.value } : {}),
          })),
        };
      case "CLOSE":
        return { kind: token.kind, close: token.close };
      case "ARR_OPEN":
      case "ARR_CLOSE":
        return { kind: token.kind, symbol: token.symbol };
      case "TEXT":
        return { kind: token.kind, raw: token.raw, ...(token.quoted ? { quoted: true } : {}) };
      case "EMPTY_OBJ":
        return { kind: token.kind, raw: token.raw };
    }
  });
}

const legacy_cases = [
  {
    name: "canonical multiline object",
    source: `<author
  <name "Ada">
  <age 42>
>`,
    expected: [
      { kind: "OPEN", tag: "author", attrs: [] },
      { kind: "OPEN", tag: "name", attrs: [] },
      { kind: "TEXT", raw: `"Ada"`, quoted: true },
      { kind: "CLOSE", close: "obj" },
      { kind: "OPEN", tag: "age", attrs: [] },
      { kind: "TEXT", raw: "42" },
      { kind: "CLOSE", close: "obj" },
      { kind: "CLOSE", close: "obj" },
    ],
  },
  {
    name: "ordered element children",
    source: `<p
  "first"
  <em "middle"/>
  "last"
/>`,
    expected: [
      { kind: "OPEN", tag: "p", attrs: [] },
      { kind: "TEXT", raw: `"first"`, quoted: true },
      { kind: "OPEN", tag: "em", attrs: [] },
      { kind: "TEXT", raw: `"middle"`, quoted: true },
      { kind: "CLOSE", close: "elem" },
      { kind: "TEXT", raw: `"last"`, quoted: true },
      { kind: "CLOSE", close: "elem" },
    ],
  },
  {
    name: "nested arrays and anonymous object item",
    source: `<items
  «
    1,
    [true, null],
    <
      <name "Ada">
    >
  »
>`,
    expected: [
      { kind: "OPEN", tag: "items", attrs: [] },
      { kind: "ARR_OPEN", symbol: "guillemet" },
      { kind: "TEXT", raw: "1" },
      { kind: "ARR_OPEN", symbol: "bracket" },
      { kind: "TEXT", raw: "true" },
      { kind: "TEXT", raw: "null" },
      { kind: "ARR_CLOSE", symbol: "bracket" },
      { kind: "OPEN", tag: "_hson_obj", attrs: [] },
      { kind: "OPEN", tag: "name", attrs: [] },
      { kind: "TEXT", raw: `"Ada"`, quoted: true },
      { kind: "CLOSE", close: "obj" },
      { kind: "CLOSE", close: "obj" },
      { kind: "ARR_CLOSE", symbol: "guillemet" },
      { kind: "CLOSE", close: "obj" },
    ],
  },
  {
    name: "quoted key attributes flags and metadata",
    source: `<\`display name\` data-_quid="q-1" count=2 enabled=true missing=null disabled "Ada"/>`,
    expected: [
      {
        kind: "OPEN",
        tag: "display name",
        attrs: [
          { name: "data-_quid", value: { text: "q-1", quoted: true } },
          { name: "count", value: { text: "2", quoted: false } },
          { name: "enabled", value: { text: "true", quoted: false } },
          { name: "missing", value: { text: "null", quoted: false } },
          { name: "disabled" },
        ],
      },
      { kind: "TEXT", raw: `"Ada"`, quoted: true },
      { kind: "CLOSE", close: "elem" },
    ],
  },
  {
    name: "multiline quoted content",
    source: `<text
  "first
second"
/>`,
    expected: [
      { kind: "OPEN", tag: "text", attrs: [] },
      { kind: "TEXT", raw: `"first\\nsecond"`, quoted: true },
      { kind: "CLOSE", close: "elem" },
    ],
  },
  {
    name: "full-line and closer comments",
    source: `// before
<p
  "first"
  // between
  <em "middle"/>
/> // close`,
    expected: [
      { kind: "OPEN", tag: "p", attrs: [] },
      { kind: "TEXT", raw: `"first"`, quoted: true },
      { kind: "OPEN", tag: "em", attrs: [] },
      { kind: "TEXT", raw: `"middle"`, quoted: true },
      { kind: "CLOSE", close: "elem" },
      { kind: "CLOSE", close: "elem" },
    ],
  },
  {
    name: "empty object",
    source: `<>`,
    expected: [{ kind: "EMPTY_OBJ", raw: "<>" }],
  },
];

for (const fixture of legacy_cases) {
  check(`legacy tokens: ${fixture.name}`, () => {
    const tokens = tokenize_hson(fixture.source);
    assert.deepEqual(token_summary(tokens), fixture.expected);
    assert.deepEqual(parse_tokens(tokens), parse_hson(fixture.source));
  });
}

const required_valid = [
  `<tag attr="value" flag "content"/>`,
  `<tag attr="value" flag"content"/>`,
  `<tag attr="value" flag "content" />`,
  `<tag count=2/>`,
  `<a 1><b 2>`,
  `<parent <child "value"/>/>`,
  `<\`this is always a tag\`
  attribute="long value"
  disabled
  "content"
/>`,
  `<p "first" <em "middle"/> "last"/>`,
  `<
  tag
  "content"
>`,
  `[1, «true, [null, "deep"]», <<name "Ada"><age 31>>]`,
  `<p // comment after tag name
    "first" // comment after content
    <em // comment in child header
      "middle"
    />
    "last"
  />`,
  `<text "first
second and \\"quoted\\" text"/>`,
];

for (const source of required_valid) {
  check(`newline-agnostic valid form: ${JSON.stringify(source)}`, () => {
    const tokens = tokenize_hson(source);
    assert.ok(tokens.length > 0);
    assert.deepEqual(parse_tokens(tokens), parse_hson(source));
  });
}

check("required interleaved content token order", () => {
  const tokens = tokenize_hson(`<p "first" <em "middle"/> "last"/>`);
  assert.deepEqual(token_summary(tokens), [
    { kind: "OPEN", tag: "p", attrs: [] },
    { kind: "TEXT", raw: `"first"`, quoted: true },
    { kind: "OPEN", tag: "em", attrs: [] },
    { kind: "TEXT", raw: `"middle"`, quoted: true },
    { kind: "CLOSE", close: "elem" },
    { kind: "TEXT", raw: `"last"`, quoted: true },
    { kind: "CLOSE", close: "elem" },
  ]);
});

check("empty-object and anonymous-object angle forms remain distinct tokens", () => {
  assert.deepEqual(token_summary(tokenize_hson(`<>`)), [
    { kind: "EMPTY_OBJ", raw: "<>" },
  ]);
  assert.deepEqual(token_summary(tokenize_hson(`<\n>`)), [
    { kind: "OPEN", tag: "_hson_obj", attrs: [] },
    { kind: "CLOSE", close: "obj" },
  ]);
  assert.deepEqual(token_summary(tokenize_hson(`<<a 1>>`)), [
    { kind: "OPEN", tag: "_hson_obj", attrs: [] },
    { kind: "OPEN", tag: "a", attrs: [] },
    { kind: "TEXT", raw: "1" },
    { kind: "CLOSE", close: "obj" },
    { kind: "CLOSE", close: "obj" },
  ]);
});

const equivalent_layouts = [
  [
    `<a
  <b 1>
  <c 2>
>
<d 3>`,
    `<a<b 1><c 2>><d 3>`,
  ],
  [
    `<p
  "first"
  <em "middle"/>
  "last"
/>`,
    `<p "first"<em "middle"/>"last"/>`,
  ],
  [
    `<items
  «
    1,
    [true, null],
    <
      <name "Ada">
      <age 31>
    >
  »
>`,
    `<items «1,[true,null],<<name "Ada"><age 31>>»>`,
  ],
  [
    `<
  tag
  "content"
>`,
    `<tag "content">`,
  ],
];

for (const [multiline, compact] of equivalent_layouts) {
  check(`multiline and compact graph equivalence: ${JSON.stringify(compact)}`, () => {
    assert.deepEqual(parse_hson(multiline), parse_hson(compact));
  });
}

check("unquoted HSON attribute inputs retain their existing string parse contract", () => {
  const root = parse_hson(`<tag count=2 enabled=true missing=null href=http://example.test/path disabled "content"/>`);
  const cluster = root.$_content[0];
  const tag = cluster.$_content[0];
  assert.deepEqual(tag.$_attrs, {
    count: "2",
    enabled: "true",
    missing: "null",
    href: "http://example.test/path",
    disabled: "disabled",
  });
});

check("CRLF and nested constructs retain absolute token starts", () => {
  const source = `<p\r\n  "a\r\nb"\r\n/>\r\n<a 1>`;
  const tokens = tokenize_hson(source);
  assert.deepEqual(tokens.map((token) => ({ kind: token.kind, pos: token.pos })), [
    { kind: "OPEN", pos: { line: 1, col: 1, index: 0 } },
    { kind: "TEXT", pos: { line: 2, col: 3, index: 6 } },
    { kind: "CLOSE", pos: { line: 4, col: 1, index: 14 } },
    { kind: "OPEN", pos: { line: 5, col: 1, index: 18 } },
    { kind: "TEXT", pos: { line: 5, col: 4, index: 21 } },
    { kind: "CLOSE", pos: { line: 5, col: 5, index: 22 } },
  ]);
  assert.equal(tokens[1].raw, `"a\\nb"`);
});

check("multiline attribute ranges use original CRLF indices", () => {
  const source = `<tag\r\n  attr="x"\r\n  "y"\r\n/>`;
  const open = tokenize_hson(source)[0];
  assert.equal(open.kind, "OPEN");
  assert.deepEqual(open.rawAttrs[0].start, { line: 2, col: 3, index: 8 });
  assert.deepEqual(open.rawAttrs[0].end, { line: 2, col: 10, index: 15 });
});

check("comments quoted tags and nested arrays share absolute positions", () => {
  const source = `// c\r\n[<\`a b\` 1>,[2]]`;
  const tokens = tokenize_hson(source);
  assert.deepEqual(tokens.map((token) => ({ kind: token.kind, pos: token.pos })), [
    { kind: "ARR_OPEN", pos: { line: 2, col: 1, index: 6 } },
    { kind: "OPEN", pos: { line: 2, col: 2, index: 7 } },
    { kind: "TEXT", pos: { line: 2, col: 9, index: 14 } },
    { kind: "CLOSE", pos: { line: 2, col: 10, index: 15 } },
    { kind: "ARR_OPEN", pos: { line: 2, col: 12, index: 17 } },
    { kind: "TEXT", pos: { line: 2, col: 13, index: 18 } },
    { kind: "ARR_CLOSE", pos: { line: 2, col: 14, index: 19 } },
    { kind: "ARR_CLOSE", pos: { line: 2, col: 15, index: 20 } },
  ]);
});

const round_trip_payloads = [
  {},
  [],
  { a: 1, b: true, c: null, d: "text" },
  { nested: { left: [1, 2, 3], right: { ok: true } }, tail: "done" },
  [1, "two", false, null, [3, 4], { name: "Ada", age: 31 }],
  { "spaced key": "value", "punctuation!?": { "dot.key": "kept" } },
  { multiline: "first\nsecond", escaped: `a "quote" and \\ slash` },
];

for (const payload of round_trip_payloads) {
  check(`canonical serialize/parse graph round trip: ${JSON.stringify(payload)}`, () => {
    const original = parse_json(payload);
    const wire = serialize_hson(original);
    assert.deepEqual(parse_hson(wire), original);
  });
}

check("representative large canonical payload round trips", () => {
  const payload = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [
    `key-${index}`,
    { index, enabled: index % 2 === 0, values: [index, `value-${index}`, null] },
  ]));
  const original = parse_json(payload);
  const wire = serialize_hson(original);
  assert.deepEqual(parse_hson(wire), original);
});

const malformed = [
  [`unterminated string`, `<tag "value/>`],
  [`unterminated quoted key`, `<\`tag "value">`],
  [`unterminated tag`, `<tag`],
  [`unterminated array`, `<items [1, 2>`],
  [`single-quoted content`, `<tag 'value'/>`],
  [`single-quoted attribute`, `<tag attr='value'/>`],
  [`attribute after content`, `<tag "content" attr="late"/>`],
  [`flag after content`, `<tag "content" late/>`],
  [`mismatched bracket array`, `[1, 2»`],
  [`mismatched guillemet array`, `«1, 2]`],
  [`missing array comma`, `[1 2]`],
  [`missing array item`, `[1,,2]`],
  [`invalid implicit-object closer`, `<<tag "value">/>`],
  [`unexpected closer`, `>`],
];

for (const [name, source] of malformed) {
  check(`rejects malformed input: ${name}`, () => {
    assert.throws(() => tokenize_hson(source));
  });
}

check("malformed content escape still fails at the parse boundary", () => {
  assert.throws(() => parse_hson(`<tag "bad\\qescape"/>`));
});

process.stdout.write(`# ${checks} HSON tokenizer checks passed\n`);
