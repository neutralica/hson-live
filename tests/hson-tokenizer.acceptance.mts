import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { hsonTransform } from "../src/api/transform/index.ts";
import { parse_json } from "../src/api/transform/parsers/parse-json.ts";
import { parse_tokens } from "../src/api/transform/parsers/parse-tokens.ts";
import { serialize_hson } from "../src/api/transform/serializers/serialize-hson.ts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import { tokenize_hson } from "../src/api/transform/parsers/tokenize-hson.ts";
import { encode_persisted_quid, is_persisted_quid } from "../src/core/persisted-quid.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { JsonValue } from "../src/core/types.ts";
import type { Tokens } from "../src/api/transform/token.types.ts";

let checks = 0;

function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function token_summary(tokens: readonly Tokens[]) {
  return tokens.map((token) => {
    switch (token.kind) {
      case "OPEN":
        return {
          kind: token.kind,
          tag: token.tag,
          ...(token.quid ? { quid: token.quid.value } : {}),
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

function authored_node(source: string): ReturnType<typeof parse_hson> {
  const root = parse_hson(source);
  const cluster = root.$_content[0];
  assert.ok(is_Node(cluster));
  const node = cluster.$_content[0];
  assert.ok(is_Node(node));
  return node;
}

function authored_attr(source: string, name = "value"): unknown {
  return authored_node(source).$_attrs?.[name];
}

function authored_content(source: string): unknown {
  const node = authored_node(source);
  const cluster = node.$_content[0];
  assert.ok(is_Node(cluster));
  const leaf = cluster.$_content[0];
  assert.ok(is_Node(leaf));
  return leaf.$_content[0];
}

function assert_authored_rejection(
  source: string,
  classification: string,
  authoredName?: string,
): void {
  assert.throws(
    () => parse_hson(source),
    (cause) => cause instanceof Error
      && cause.message.includes(classification)
      && (authoredName === undefined || cause.message.includes(`"${authoredName}"`))
      && /at \d+:\d+ \(index \d+\)/.test(cause.message),
  );
}

check("object-value grammar covers empty, one, multiple, nested, array, and array-item objects", () => {
  const fixtures: ReadonlyArray<readonly [string, JsonValue]> = [
    [`<>`, {}],
    [`<a "1">`, { a: "1" }],
    [`<a "1" b "2">`, { a: "1", b: "2" }],
    [`<a <b "2" c "3"> d false>`, { a: { b: "2", c: "3" }, d: false }],
    [`<a «1,2» b null>`, { a: [1, 2], b: null }],
    [`«<a "1" b "2">»`, [{ a: "1", b: "2" }]],
  ];
  for (const [source, json] of fixtures) {
    assert.deepEqual(parse_hson(source), parse_json(json));
  }
});

check("object member names and physical-line comments use required trivia", () => {
  const source = `<true "literal-looking"\n  \`unusual name\`// name/value separator\n  "value"\n  a// name/value separator\n  true\n  b false>`;
  assert.deepEqual(parse_hson(source), parse_json({
    true: "literal-looking",
    "unusual name": "value",
    a: true,
    b: false,
  }));
  assert.throws(() => parse_hson(`<a"1">`), /trivia.*name.*value|separator/i);
  assert.throws(() => parse_hson(`<a "1"b "2">`), /trivia.*member|separator/i);
  assert.throws(() => parse_hson(`<a\/\* comment \*\/"1">`), /block|unexpected|trivia/i);
});

check("object members require one complete value and reject object headers", () => {
  for (const source of [
    `<a>`,
    `<a "1" b>`,
    `<a bare>`,
    `<a flag "value">`,
    `<a title="value" "content">`,
    `<a @0000000000000001 1>`,
  ]) {
    assert.throws(
      () => parse_hson(source),
      (cause) => cause instanceof Error && /at \d+:\d+ \(index \d+\)/.test(cause.message),
      source,
    );
  }
});

check("legacy property-angle and anonymous-object aliases reject", () => {
  for (const source of [
    `<a 1><b 2>`,
    `<<a 1>>`,
    `«<<a 1><b 2>>»`,
    `<record <a 1><b 2>>`,
  ]) {
    assert.throws(
      () => parse_hson(source),
      (cause) => cause instanceof Error && /at \d+:\d+ \(index \d+\)/.test(cause.message),
      source,
    );
  }
});

check("object pairs stay stable across member cardinality and layout", () => {
  const compactSources = [`<>`, `<b "2">`, `<a "1" b "2">`];
  const readableSources = [
    `<\n>`,
    `<\n  b "2"\n>`,
    `<\n  a "1"\n  b "2"\n>`,
  ];
  for (let index = 0; index < compactSources.length; index += 1) {
    assert.deepEqual(parse_hson(readableSources[index]), parse_hson(compactSources[index]));
  }
});

check("object duplicate tracking is case-sensitive and reports both positions", () => {
  assert.throws(
    () => parse_hson(`<a 1 a 2>`),
    /\[duplicate-object-member\].*first declared at 1:2 \(index 1\).*at 1:6 \(index 5\)/,
  );
  assert.deepEqual(parse_hson(`<a 1 A 2>`), parse_json({ a: 1, A: 2 }));
});

check("element grammar and canonical graph remain unchanged", () => {
  const fixtures: ReadonlyArray<readonly [string, string]> = [
    [`<a/>`, `<a/>`],
    [`<a "text"/>`, `<a "text"/>`],
    [`<a flag/>`, `<a flag/>`],
    [`<a title="value"/>`, `<a title="value"/>`],
    [`<a href=foo//bar/>`, `<a href="foo//bar"/>`],
    [`<a href=// layout\nfoo//bar/>`, `<a href="foo//bar"/>`],
    [`<a <b/>/>`, `<a\n  <b/>\n/>`],
    [
      `<a @0000000000000001 style="color: red" "before" <b/> "after"/>`,
      `<a @0000000000000001 style="color: red"\n  "before"\n  <b/>\n  "after"\n/>`,
    ],
    [`<a/><b/>`, `<a/>\n<b/>`],
  ];
  for (const [source, expected] of fixtures) {
    const before = parse_hson(source);
    assert.deepEqual(parse_tokens(tokenize_hson(source)), before);
    const wire = serialize_hson(detach_hson_root_value(before));
    assert.equal(wire, expected);
    assert.deepEqual(parse_hson(wire), before);
  }
});

check("header @quid is represented separately from ordinary attributes", () => {
  const open = tokenize_hson(`<panel class="settings" @4k7m2v9d1r6x8qwc hidden/>`)[0];
  assert.equal(open.kind, "OPEN");
  if (open.kind !== "OPEN") return;
  assert.equal(open.quid?.value, "4k7m2v9d1r6x8qwc");
  assert.deepEqual(open.rawAttrs.map((attr) => attr.name), ["class", "hidden"]);
});

check("@quid rejects missing, duplicate, and post-content declarations", () => {
  assert.throws(() => tokenize_hson(`<panel @/>`), /missing persisted QUID/);
  assert.throws(() => tokenize_hson(`<panel @4k7m2v9d1r6x8qwc @0000000000000000/>`), /duplicate persisted QUID/);
  assert.throws(() => tokenize_hson(`<panel "text" @4k7m2v9d1r6x8qwc/>`), /forbidden after content/);
});

check("persisted QUIDs use the canonical 80-bit Base32 contract", () => {
  assert.equal(encode_persisted_quid(new Uint8Array(10)), "0000000000000000");
  assert.equal(encode_persisted_quid(new Uint8Array(10).fill(255)), "zzzzzzzzzzzzzzzz");
  assert.equal(is_persisted_quid("4k7m2v9d1r6x8qwc"), true);
  for (const value of ["", "4k7m2v9d1r6x8qw", "4k7m2v9d1r6x8qwcc", "4K7M2V9D1R6X8QWC", "4k7m2v9d1r6x8qwi", "4k7m2v9d1r6x8qw-"]) {
    assert.equal(is_persisted_quid(value), false);
  }
});

const token_cases = [
  {
    name: "canonical multiline object members",
    source: `<
  name "Ada"
  age 42
>`,
    expected: [
      { kind: "OPEN", tag: "_hson_obj", attrs: [] },
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
    name: "nested arrays and object item",
    source: `<items
  «
    1,
    [true, null],
    <
      name "Ada"
    >
  »
>`,
    expected: [
      { kind: "OPEN", tag: "_hson_obj", attrs: [] },
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
      { kind: "CLOSE", close: "obj" },
    ],
  },
  {
    name: "quoted key attributes flags and metadata",
    source: `<\`display name\` @0000000000000001 count=2 enabled=true missing=null disabled "Ada"/>`,
    expected: [
      {
        kind: "OPEN",
        tag: "display name",
        quid: "0000000000000001",
        attrs: [
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

for (const fixture of token_cases) {
  check(`canonical tokens: ${fixture.name}`, () => {
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
  `<a 1 b 2>`,
  `<parent <child "value"/>/>`,
  `<\`this is always a tag\`
  attribute="long value"
  disabled
  "content"
/>`,
  `<p "first" <em "middle"/> "last"/>`,
  `<
  tag "content"
>`,
  `[1, «true, [null, "deep"]», <name "Ada" age 31>]`,
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

check("compact and layout-separated empty objects retain canonical tokens", () => {
  assert.deepEqual(token_summary(tokenize_hson(`<>`)), [
    { kind: "EMPTY_OBJ", raw: "<>" },
  ]);
  assert.deepEqual(token_summary(tokenize_hson(`<\n>`)), [
    { kind: "OPEN", tag: "_hson_obj", attrs: [] },
    { kind: "CLOSE", close: "obj" },
  ]);
  assert.throws(() => tokenize_hson(`<<a 1>>`), /legacy doubled object syntax/);
});

const equivalent_layouts = [
  [
    `<
  a <
    b 1
    c 2
  >
  d 3
>`,
    `<a <b 1 c 2> d 3>`,
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
      name "Ada"
      age 31
    >
  »
>`,
    `<items «1,[true,null],<name "Ada" age 31>»>`,
  ],
  [
    `<
  tag "content"
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
  assert.ok(is_Node(cluster));
  const tag = cluster.$_content[0];
  assert.ok(is_Node(tag));
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
    { kind: "OPEN", pos: { line: 5, col: 2, index: 19 } },
    { kind: "TEXT", pos: { line: 5, col: 4, index: 21 } },
    { kind: "CLOSE", pos: { line: 5, col: 4, index: 21 } },
    { kind: "CLOSE", pos: { line: 5, col: 5, index: 22 } },
  ]);
  const text = tokens[1];
  assert.equal(text?.kind, "TEXT");
  if (text?.kind !== "TEXT") throw new Error("expected quoted TEXT token");
  assert.equal(text.raw, `"a\\nb"`);
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
    { kind: "OPEN", pos: { line: 2, col: 3, index: 8 } },
    { kind: "TEXT", pos: { line: 2, col: 9, index: 14 } },
    { kind: "CLOSE", pos: { line: 2, col: 9, index: 14 } },
    { kind: "CLOSE", pos: { line: 2, col: 10, index: 15 } },
    { kind: "ARR_OPEN", pos: { line: 2, col: 12, index: 17 } },
    { kind: "TEXT", pos: { line: 2, col: 13, index: 18 } },
    { kind: "ARR_CLOSE", pos: { line: 2, col: 14, index: 19 } },
    { kind: "ARR_CLOSE", pos: { line: 2, col: 15, index: 20 } },
  ]);
});

const round_trip_payloads: readonly JsonValue[] = [
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
    const wire = serialize_hson(detach_hson_root_value(original));
    assert.deepEqual(parse_hson(wire), original);
  });
}

check("representative large canonical payload round trips", () => {
  const payload = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [
    `key-${index}`,
    { index, enabled: index % 2 === 0, values: [index, `value-${index}`, null] },
  ]));
  const original = parse_json(payload);
  const wire = serialize_hson(detach_hson_root_value(original));
  assert.deepEqual(parse_hson(wire), original);
});

for (const reserved of [
  "_hson_root",
  "_hson_elem",
  "_hson_obj",
  "_hson_arr",
  "_hson_ii",
  "_hson_str",
  "_hson_val",
]) {
  check(`authored reserved name rejects in bare and backtick spellings: ${reserved}`, () => {
    assert_authored_rejection(`<${reserved}>`, "[authored-reserved-name]", reserved);
    assert_authored_rejection(`<\`${reserved}\`>`, "[authored-reserved-name]", reserved);
    if (reserved === "_hson_obj") {
      assert.throws(
        () => hsonTransform.fromHson(`<${reserved}>`).toNode(),
        /\[authored-reserved-name\]/,
      );
    }
  });
}

check("authored reserved empty object-mode form rejects at name admission", () => {
  assert_authored_rejection(`<_hson_obj>`, "[authored-reserved-name]", "_hson_obj");
});

check("authored reserved empty element-mode form rejects at name admission", () => {
  assert_authored_rejection(`<_hson_elem/>`, "[authored-reserved-name]", "_hson_elem");
});

check("authored reserved populated form rejects before parser construction", () => {
  assert_authored_rejection(`<_hson_obj 1>`, "[authored-reserved-name]", "_hson_obj");
});

check("authored reserved nested form rejects at its nested source position", () => {
  assert_authored_rejection(`<outer <_hson_obj>>`, "[authored-reserved-name]", "_hson_obj");
});

check("authored reserved property position rejects", () => {
  assert_authored_rejection(`<_hson_obj 1>`, "[authored-reserved-name]", "_hson_obj");
});

check("authored reserved tag position rejects", () => {
  assert_authored_rejection(`<outer <_hson_elem/>/>`, "[authored-reserved-name]", "_hson_elem");
});

check("future reserved bare names reject at authored admission", () => {
  assert_authored_rejection(`<_hson_future>`, "[authored-reserved-name]", "_hson_future");
});

check("future reserved backtick names reject after decoding", () => {
  assert_authored_rejection(`<\`_hson_future\`/>`, "[authored-reserved-name]", "_hson_future");
});

for (const [name, source] of [
  ["value/value", `<tag a="1" a="2"/>`],
  ["flag/flag", `<tag disabled disabled/>`],
  ["flag/value", `<tag disabled disabled="1"/>`],
  ["value/flag", `<tag disabled="1" disabled/>`],
  ["style/style", `<tag style="color:red" style="color:blue"/>`],
  ["colonized", `<tag data:item="1" data:item="2"/>`],
  ["whitespace-separated", `<tag a="1"    a="2"/>`],
  ["comment-separated", `<tag a="1" // declaration boundary\n a="2"/>`],
] as const) {
  check(`duplicate HSON attributes reject before storage: ${name}`, () => {
    assert_authored_rejection(source, "[duplicate-attribute]");
    if (name === "value/value") {
      assert.throws(() => hsonTransform.fromHson(source).toNode(), /\[duplicate-attribute\]/);
    }
  });
}

check("HSON attribute duplicate identity is case-sensitive", () => {
  assert.deepEqual(authored_node(`<tag a="1" A="2"/>`).$_attrs, { a: "1", A: "2" });
});

check("distinct colonized HSON attribute names remain distinct", () => {
  assert.deepEqual(authored_node(`<tag data:a="1" data:A="2"/>`).$_attrs, {
    "data:a": "1",
    "data:A": "2",
  });
});

check("quoted HSON attributes decode every JSON simple escape", () => {
  const cases = [
    [String.raw`\"`, `"`],
    [String.raw`\\`, `\\`],
    [String.raw`\/`, `/`],
    [String.raw`\b`, `\b`],
    [String.raw`\f`, `\f`],
    [String.raw`\n`, `\n`],
    [String.raw`\r`, `\r`],
    [String.raw`\t`, `\t`],
  ] as const;
  for (const [spelling, expected] of cases) {
    assert.equal(authored_attr(`<tag value="${spelling}"/>`), expected, spelling);
  }
});

check("quoted HSON attributes decode JSON unicode escapes", () => {
  assert.equal(authored_attr(String.raw`<tag value="\u0041\u03A9"/>`), "AΩ");
});

for (const [name, spelling] of [
  ["unknown q", String.raw`\q`],
  ["unknown v", String.raw`\v`],
  ["zero", String.raw`\0`],
  ["hex", String.raw`\x41`],
  ["incomplete unicode", String.raw`\u12`],
  ["malformed unicode", String.raw`\uZZZZ`],
] as const) {
  check(`quoted HSON attributes reject invalid JSON escape: ${name}`, () => {
    assert_authored_rejection(`<tag value="${spelling}"/>`, "[invalid-json-escape]");
    if (name === "unknown q") {
      assert.throws(
        () => hsonTransform.fromHson(`<tag value="${spelling}"/>`).toNode(),
        /\[invalid-json-escape\]/,
      );
    }
  });
}

check("quoted HSON attributes reject a trailing escape without discarding its slash", () => {
  assert_authored_rejection(`<tag value="bad${"\\"}`, "[invalid-json-escape]");
});

check("content strings decode every JSON escape and unicode spelling", () => {
  const cases = [
    [String.raw`\"`, `"`],
    [String.raw`\\`, `\\`],
    [String.raw`\/`, `/`],
    [String.raw`\b`, `\b`],
    [String.raw`\f`, `\f`],
    [String.raw`\n`, `\n`],
    [String.raw`\r`, `\r`],
    [String.raw`\t`, `\t`],
    [String.raw`\u0041`, `A`],
  ] as const;
  for (const [spelling, expected] of cases) {
    assert.equal(authored_content(`<tag "${spelling}"/>`), expected, spelling);
  }
});

for (const [name, spelling] of [
  ["unknown", String.raw`\q`],
  ["incomplete unicode", String.raw`\u12`],
  ["malformed unicode", String.raw`\uZZZZ`],
] as const) {
  check(`content strings reject invalid JSON escape: ${name}`, () => {
    assert_authored_rejection(`<tag "${spelling}"/>`, "[invalid-json-escape]");
  });
}

check("content strings reject a trailing escape", () => {
  assert_authored_rejection(`<tag "bad${"\\"}`, "[invalid-json-escape]");
});

for (const [name, source, expected] of [
  ["escaped backtick", "<`tick\\`name` 1>", "tick`name"],
  ["escaped backslash", "<`back\\\\slash` 1>", "back\\slash"],
  ["newline escape", "<`line\\nname` 1>", "line\nname"],
  ["carriage-return escape", "<`line\\rname` 1>", "line\rname"],
  ["tab escape", "<`line\\tname` 1>", "line\tname"],
  ["literal forward slash", "<`path/name` 1>", "path/name"],
] as const) {
  check(`backtick HSON names accept ${name}`, () => {
    assert.equal(authored_node(source).$_tag, expected);
  });
}

for (const [name, spelling] of [
  ["unknown", String.raw`\q`],
  ["unicode", String.raw`\u0041`],
  ["backspace", String.raw`\b`],
  ["form feed", String.raw`\f`],
  ["escaped forward slash", String.raw`\/`],
  ["zero", String.raw`\0`],
  ["hex", String.raw`\x41`],
] as const) {
  check(`backtick HSON names reject restricted escape: ${name}`, () => {
    assert_authored_rejection(`<\`name${spelling}\` 1>`, "[invalid-name-escape]");
  });
}

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
emit_hson_live_test_completion("transform.hson-tokenizer", checks, checks, 0);
