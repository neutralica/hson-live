// @hson-live-external-test
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";

import { hson } from "../src/hson.ts";
import { TransformError } from "../src/core/errors.ts";

let checks = 0;

function check(name: string, body: () => void): void {
  body();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function rejection(
  source: string,
  code: string,
  location?: Readonly<{ index: number; line: number; column: number }>,
): TransformError {
  let observed: TransformError | undefined;
  assert.throws(
    () => hson.fromHson(source).toNode(),
    (cause) => {
      if (!(cause instanceof TransformError)) return false;
      observed = cause;
      return cause.code === code
        && (location === undefined || JSON.stringify(cause.source) === JSON.stringify(location));
    },
  );
  if (observed === undefined) throw new Error(`expected ${code}`);
  return observed;
}

check("legacy backtick-delimited object names reject", () => {
  rejection("<`white space` 1>", "HSON_NAME_LEGACY_BACKTICK");
});

check("legacy backtick-delimited element names reject", () => {
  rejection("<`white space` \"value\"/>", "HSON_NAME_LEGACY_BACKTICK");
});

check("escaped legacy backtick delimiters do not invoke compatibility syntax", () => {
  rejection("<`tick\\`name` 1>", "HSON_NAME_LEGACY_BACKTICK");
});

check("raw root backticks reject as authored syntax", () => {
  rejection("`name`", "HSON_NAME_LEGACY_BACKTICK");
});

check("raw array backticks reject as authored syntax", () => {
  rejection("[1,`name`]", "HSON_NAME_LEGACY_BACKTICK");
});

check("raw backticks cannot become object values", () => {
  rejection("<name `value`>", "HSON_NAME_LEGACY_BACKTICK");
});

check("unterminated single-quoted names reject", () => {
  rejection("<'unterminated 1>", "HSON_NAME_UNTERMINATED");
});

check("raw apostrophes inside quoted names do not double or escape themselves", () => {
  rejection("<'don't' 1>", "HSON_NAME_UNTERMINATED");
});

check("invalid quoted-name letter escapes reject", () => {
  rejection("<'bad\\qescape' 1>", "invalid-name-escape");
});

check("escaped backticks are not a supported quoted-name escape", () => {
  rejection("<'bad\\`escape' 1>", "invalid-name-escape");
});

check("zero-digit Unicode escapes reject", () => {
  rejection("<'bad\\u' 1>", "invalid-name-escape");
});

check("two-digit Unicode escapes reject", () => {
  rejection("<'bad\\u12' 1>", "invalid-name-escape");
});

check("malformed Unicode escapes reject", () => {
  rejection("<'bad\\u12xz' 1>", "invalid-name-escape");
});

check("trailing quoted-name backslashes reject", () => {
  rejection("<'bad\\", "invalid-name-escape");
});

check("raw horizontal tabs inside quoted names reject", () => {
  rejection("<'bad\tname' 1>", "HSON_NAME_CONTROL_UNESCAPED");
});

check("raw line feeds inside quoted names reject", () => {
  rejection("<'bad\nname' 1>", "HSON_NAME_CONTROL_UNESCAPED");
});

check("raw carriage returns inside quoted names reject", () => {
  rejection("<'bad\rname' 1>", "HSON_NAME_CONTROL_UNESCAPED");
});

check("single quotes do not delimit root string values", () => {
  rejection("'value'", "HSON_QUOTE_KIND_UNSUPPORTED");
});

check("single quotes do not delimit object string values", () => {
  rejection("<'name' 'value'>", "HSON_QUOTE_KIND_UNSUPPORTED");
});

check("single quotes do not delimit attribute values", () => {
  rejection("<name attr='value'/>", "HSON_QUOTE_KIND_UNSUPPORTED");
});

check("double quotes do not delimit object member names", () => {
  rejection("<\"name\" 1>", "HSON_OBJECT_EXTRA_VALUE");
});

check("quoted object members still require owned values", () => {
  rejection("<'name'>", "missing-object-member-value");
});

check("quoted sibling ownership cannot omit required trivia", () => {
  rejection("<'left' 1'right' 2>", "HSON_REQUIRED_TRIVIA_MISSING");
});

check("legacy backtick rejection owns the exact source location", () => {
  rejection("\n  <`legacy` 1>", "HSON_NAME_LEGACY_BACKTICK", {
    index: 4,
    line: 2,
    column: 4,
  });
});

check("quoted-name escape rejection owns the exact backslash location", () => {
  rejection("\n  <'bad\\q' 1>", "invalid-name-escape", {
    index: 8,
    line: 2,
    column: 8,
  });
});

process.stdout.write(`# ${checks} quoted-name rejection checks passed\n`);
emit_hson_live_test_completion("transform.hson-quoted-name-rejection", checks, checks, 0);
