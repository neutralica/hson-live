import { OBJ_TAG } from "../../../core/constants.js";
import {
  CREATE_ARR_CLOSE_TOKEN,
  CREATE_ARR_OPEN_TOKEN,
  CREATE_EMPTY_OBJ_TOKEN,
  CREATE_END_TOKEN,
  CREATE_OPEN_TOKEN,
  CREATE_TEXT_TOKEN,
} from "../token-factories.js";
import { ARR_SYMBOL, CLOSE_KIND } from "../token.types.js";
import type { ArraySymbol, CloseKind, Position, RawAttr, Tokens } from "../token.types.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";
import { is_persisted_quid } from "../../../core/hson-node-quid.js";
import {
  is_hson_bare_name_char,
  is_hson_bare_name_start,
} from "../../../core/hson-name.js";
import { assert_authored_hson_source_name } from "../utils/hson-utils/hson-source-name.js";

const MAX_NESTING = 75;
const NUMBER_LITERAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const HSON_TRIVIA = new Set([" ", "\t", "\n", "\r"]);

function isHsonTrivia(value: string): boolean {
  return HSON_TRIVIA.has(value);
}

function isUnsupportedWhitespace(value: string): boolean {
  return value !== "" && /\p{White_Space}/u.test(value) && !isHsonTrivia(value);
}

/**
 * Tokenize HSON with one absolute, newline-agnostic source cursor.
 *
 * Physical line boundaries are ordinary whitespace except inside a quoted
 * string and after `//`. Nested elements, object values, and arrays recurse
 * through this scanner without slicing or rebasing the source. Each complete
 * angle construct is closer-classified before its body is lowered.
 */
export function tokenize_hson(hson: string, depth = 0): Tokens[] {
  if (depth < 0 || depth >= MAX_NESTING) {
    _throw_transform_err(
      `stopping potentially infinite loop (depth must be between 0 and ${MAX_NESTING - 1})`,
      "tokenize_hson",
    );
  }

  return new HsonScanner(hson, depth).scan();
}

class HsonScanner {
  private readonly tokens: Tokens[] = [];
  private index = 0;
  private line = 1;
  private col = 1;

  public constructor(
    private readonly source: string,
    private readonly initialDepth: number,
  ) {}

  public scan(): Tokens[] {
    while (true) {
      this.skipTrivia();
      if (this.atEnd()) return this.tokens;

      const ch = this.peek();
      if (ch === "<") {
        this.scanAngle(this.initialDepth);
      } else if (ch === "«" || ch === "[") {
        this.scanArray(this.initialDepth);
      } else if (ch === `"`) {
        const pos = this.position();
        this.tokens.push(CREATE_TEXT_TOKEN(this.scanContentString(), true, pos));
      } else if (ch === "'") {
        this.fail(
          `unsupported quote delimiter (use double quotes only)`,
          undefined,
          "HSON_QUOTE_KIND_UNSUPPORTED",
        );
      } else if (ch === "`") {
        this.rejectLegacyBacktick();
      } else if (ch === ">" || ch === "/" || ch === "]" || ch === "»") {
        this.fail(
          this.tokens.length === 0
            ? `unexpected structural closer "${ch}"`
            : `trailing source begins with unexpected structural closer "${ch}"`,
          undefined,
          this.tokens.length === 0 ? "HSON_TOKENIZATION_ERROR" : "HSON_TRAILING_SOURCE",
        );
      } else {
        const pos = this.position();
        const raw = this.scanBareToken();
        if (!isPrimitiveLiteral(raw)) {
          const numericDefect = classifyNumberDefect(raw);
          this.fail(
            numericDefect === undefined
              ? `unexpected bare token outside tag header: "${raw}"`
              : `invalid HSON number "${raw}"`,
            numericDefect === undefined
              ? pos
              : this.positionAt(pos.index + numericDefect.offset),
            this.tokens.length > 0 && numericDefect === undefined
              ? "HSON_TRAILING_SOURCE"
              : numericDefect?.code ?? "HSON_PRIMITIVE_TOKEN_INVALID",
          );
        }
        this.assertFiniteNumberLiteral(raw, pos);
        this.tokens.push(CREATE_TEXT_TOKEN(raw, undefined, pos));
      }
    }
  }

  /**
   * Scan one complete angle construct. The matching closer is discovered from
   * raw source before the body is interpreted so object member names can never
   * be mistaken for element flags or attributes.
   */
  private scanAngle(depth: number): void {
    this.assertNesting(depth);
    const openPos = this.position();
    const closeKind = this.classifyAngleCloser(openPos);
    this.consumeExpected("<");

    if (closeKind === CLOSE_KIND.obj) {
      this.scanObjectAfterOpen(openPos, depth);
      return;
    }

    this.scanElementAfterOpen(openPos, depth);
  }

  /** Lower `name value` object members to the existing canonical token shape. */
  private scanObjectAfterOpen(openPos: Position, depth: number): void {
    // Preserve the compact empty-object token used by existing parser APIs.
    if (this.peek() === ">") {
      this.consumeExpected(">");
      this.tokens.push(CREATE_EMPTY_OBJ_TOKEN("<>", undefined, openPos));
      return;
    }

    this.skipTrivia();
    if (this.atEnd()) this.fail(`unterminated object`, openPos, "HSON_CONTAINER_UNTERMINATED");

    let quid: { value: string; start: Position; end: Position } | undefined;
    if (this.peek() === "@") {
      const quidPos = this.position();
      this.consumeExpected("@");
      if (this.atEnd() || isHsonTrivia(this.peek()) || this.peek() === ">") {
        this.fail(`missing persisted QUID value after "@"`, quidPos, "HSON_OBJECT_QUID_INVALID");
      }
      const value = this.scanBareToken();
      if (!is_persisted_quid(value)) {
        this.fail(`invalid persisted QUID "${value}"`, quidPos, "HSON_OBJECT_QUID_INVALID");
      }
      quid = { value, start: quidPos, end: this.previousPosition() };
      const separated = this.skipTrivia();
      if (this.peek() !== ">" && !separated) {
        this.fail(
          `required trivia is missing after persisted object QUID declaration`,
          this.position(),
          "HSON_REQUIRED_TRIVIA_MISSING",
        );
      }
    }

    this.tokens.push(CREATE_OPEN_TOKEN(OBJ_TAG, [], openPos, quid));
    if (this.peek() === ">") {
      const closePos = this.position();
      this.consumeExpected(">");
      this.tokens.push(CREATE_END_TOKEN(CLOSE_KIND.obj, closePos));
      return;
    }

    const declarations = new Map<string, Position>();
    while (true) {
      const namePos = this.position();
      if (this.peek() === ",") {
        this.fail(`object members do not use commas`, namePos, "HSON_OBJECT_COMMA_FORBIDDEN");
      }
      if (
        this.peek() === `"` || this.peek() === "[" || this.peek() === "«"
        || this.peek() === "+" || this.peek() === "-" || /\d/.test(this.peek())
      ) {
        this.fail(
          `unexpected object value where a member name is required`,
          namePos,
          "HSON_OBJECT_EXTRA_VALUE",
        );
      }
      if (this.peek() === "@") {
        this.fail(
          `object members cannot author persisted QUID declarations`,
          namePos,
          "HSON_OBJECT_QUID_FORBIDDEN",
        );
      }
      if (this.peek() === "<") {
        this.fail(
          `legacy doubled object syntax is not supported; expected an object member name`,
          namePos,
          "legacy-doubled-object-syntax",
        );
      }
      if (this.startsWith("/>")) {
        this.fail(`objects must close with ">", not "/>"`, namePos, "HSON_STRUCTURAL_MODE_CROSSING");
      }
      if (this.peek() === ">") {
        this.fail(`unexpected object closer; expected an object member name`, namePos);
      }

      const name = this.peek() === "'"
        ? this.scanQuotedName()
        : this.scanBareName("object member name");
      assert_authored_hson_source_name(name, namePos);
      const first = declarations.get(name);
      if (first !== undefined) {
        this.fail(
          `[duplicate-object-member] duplicate HSON object member "${name}"; first declared at ${first.line}:${first.col} (index ${first.index})`,
          namePos,
          "HSON_OBJECT_DUPLICATE_MEMBER",
          [{ role: "first-declaration", pos: first }],
        );
      }
      declarations.set(name, namePos);

      const separatedFromValue = this.skipTrivia();
      if (this.atEnd() || this.peek() === ">") {
        this.fail(`object member "${name}" is missing its value`, namePos, "missing-object-member-value");
      }
      if (!separatedFromValue) {
        this.fail(
          `required trivia is missing between object member name and value`,
          this.position(),
          "HSON_REQUIRED_TRIVIA_MISSING",
        );
      }
      if (this.peek() === "@") {
        this.fail(
          `object members cannot author persisted QUID declarations`,
          this.position(),
          "HSON_OBJECT_QUID_FORBIDDEN",
        );
      }

      this.tokens.push(CREATE_OPEN_TOKEN(name, [], namePos));
      this.scanObjectMemberValue(depth + 1, name);
      this.tokens.push(CREATE_END_TOKEN(CLOSE_KIND.obj, this.previousPosition()));

      const separated = this.skipTrivia();
      if (this.atEnd()) this.fail(`unterminated object`, openPos, "HSON_CONTAINER_UNTERMINATED");
      if (this.peek() === ">") {
        const closePos = this.position();
        this.consumeExpected(">");
        this.tokens.push(CREATE_END_TOKEN(CLOSE_KIND.obj, closePos));
        return;
      }
      if (this.peek() === ",") {
        this.fail(`object members do not use commas`, this.position(), "HSON_OBJECT_COMMA_FORBIDDEN");
      }
      if (!separated) {
        this.fail(
          `required trivia is missing between sibling object members`,
          this.position(),
          "HSON_REQUIRED_TRIVIA_MISSING",
        );
      }
    }
  }

  private scanObjectMemberValue(depth: number, memberName: string): void {
    this.assertNesting(depth);
    const ch = this.peek();
    if (ch === `"`) {
      const pos = this.position();
      this.tokens.push(CREATE_TEXT_TOKEN(this.scanContentString(), true, pos));
      return;
    }
    if (ch === "<") {
      const pos = this.position();
      if (this.classifyAngleCloser(pos) !== CLOSE_KIND.obj) {
        this.fail(
          `object member "${memberName}" cannot contain an element-mode value`,
          pos,
          "HSON_STRUCTURAL_MODE_CROSSING",
        );
      }
      this.scanAngle(depth);
      return;
    }
    if (ch === "«" || ch === "[") {
      this.scanArray(depth);
      return;
    }
    if (ch === "'") {
      this.fail(`unsupported quote delimiter (use double quotes only)`, undefined, "HSON_QUOTE_KIND_UNSUPPORTED");
    }
    if (ch === "`") {
      this.rejectLegacyBacktick();
    }

    const pos = this.position();
    const raw = this.scanBareToken();
    if (!isPrimitiveLiteral(raw)) {
      if (this.peek() === "=") {
        this.fail(
          `object member "${memberName}" cannot use authored metadata or attribute syntax`,
          pos,
          raw.startsWith("hson:")
            ? "HSON_AUTHORED_METADATA_FORBIDDEN"
            : "HSON_OBJECT_ATTRIBUTE_FORBIDDEN",
        );
      }
      const numericDefect = classifyNumberDefect(raw);
      this.fail(
        `invalid bare object value "${raw}" for member "${memberName}"; quote string values`,
        numericDefect === undefined
          ? pos
          : this.positionAt(pos.index + numericDefect.offset),
        numericDefect?.code ?? "HSON_OBJECT_FLAG_FORBIDDEN",
      );
    }
    this.assertFiniteNumberLiteral(raw, pos);
    this.tokens.push(CREATE_TEXT_TOKEN(raw, undefined, pos));
  }

  /** Existing named element syntax, selected only after a matching `/>`. */
  private scanElementAfterOpen(openPos: Position, depth: number): void {
    this.skipTrivia();
    if (this.atEnd()) this.fail(`unterminated angle construct`, openPos, "HSON_CONTAINER_UNTERMINATED");

    if (this.startsWith("/>")) {
      this.fail(`missing tag name before "/>"`, openPos, "HSON_ELEMENT_NAME_REQUIRED");
    }

    const tagPos = this.position();
    const tag = this.peek() === "'"
      ? this.scanQuotedName()
      : this.scanBareName("tag name");
    if (tag.length === 0) {
      this.fail(`element name must not decode to the empty string`, tagPos, "HSON_ELEMENT_NAME_REQUIRED");
    }
    assert_authored_hson_source_name(tag, tagPos);

    const attrs: RawAttr[] = [];
    const attrDeclarations = new Map<string, Position>();
    let quid: { value: string; start: Position; end: Position } | undefined;
    let openEmitted = false;
    let contentStarted = false;

    const emitOpen = (): void => {
      if (openEmitted) return;
      this.tokens.push(CREATE_OPEN_TOKEN(tag, attrs, openPos, quid));
      openEmitted = true;
    };

    while (true) {
      this.skipTrivia();
      if (this.atEnd()) this.fail(`unterminated tag <${tag}>`, openPos, "HSON_CONTAINER_UNTERMINATED");

      if (this.startsWith("/>")) {
        emitOpen();
        const closePos = this.position();
        this.consumeExpected("/");
        this.consumeExpected(">");
        this.tokens.push(CREATE_END_TOKEN(CLOSE_KIND.elem, closePos));
        return;
      }

      const ch = this.peek();

      if (ch === "@") {
        const quidPos = this.position();
        if (contentStarted) {
          this.fail(
            `persisted QUID declaration is forbidden after content begins`,
            quidPos,
            "HSON_ELEMENT_HEADER_AFTER_CONTENT",
          );
        }
        this.consumeExpected("@");
        if (this.atEnd() || isHsonTrivia(this.peek()) || this.startsWith("/>") || this.peek() === ">") {
          this.fail(`missing persisted QUID value after "@"`, quidPos, "HSON_ELEMENT_QUID_INVALID");
        }
        const value = this.scanBareToken();
        if (!is_persisted_quid(value)) {
          this.fail(`invalid persisted QUID "${value}"`, quidPos, "HSON_ELEMENT_QUID_INVALID");
        }
        if (quid !== undefined) {
          this.fail(
            `duplicate persisted QUID declaration`,
            quidPos,
            "HSON_ELEMENT_QUID_INVALID",
            [{ role: "first-declaration", pos: quid.start }],
          );
        }
        quid = { value, start: quidPos, end: this.previousPosition() };
        continue;
      }

      if (is_hson_bare_name_start(ch)) {
        const namePos = this.position();
        const name = this.scanBareName("attribute or flag");
        const nameEnd = this.previousPosition();
        assert_authored_hson_source_name(name, namePos);

        if (contentStarted) {
          this.fail(
            `element header item "${name}" is forbidden after content begins`,
            namePos,
            "HSON_ELEMENT_HEADER_AFTER_CONTENT",
          );
        }

        this.skipTrivia();
        if (name.startsWith("hson:")) {
          this.fail(
            `authored HSON metadata must not use element attribute syntax`,
            namePos,
            "HSON_AUTHORED_METADATA_FORBIDDEN",
          );
        }
        if (this.peek() === "=") {
          const attr = this.scanAttributeValue(name, namePos);
          this.assertUniqueAttribute(attrDeclarations, attr);
          attrs.push(attr);
          continue;
        }

        const attr = { name, start: namePos, end: nameEnd };
        this.assertUniqueAttribute(attrDeclarations, attr);
        attrs.push(attr);
        continue;
      }

      if (ch === "+" || ch === "-" || /\d/.test(ch)) {
        const valuePos = this.position();
        const raw = this.scanBareToken();
        if (!isPrimitiveLiteral(raw)) {
          const numericDefect = classifyNumberDefect(raw);
          this.fail(
            `invalid primitive content "${raw}"`,
            numericDefect === undefined
              ? valuePos
              : this.positionAt(valuePos.index + numericDefect.offset),
            numericDefect?.code ?? "HSON_ELEMENT_TYPED_CONTENT_FORBIDDEN",
          );
        }
        this.assertFiniteNumberLiteral(raw, valuePos);
        this.fail(
          `typed primitive content "${raw}" is forbidden in element mode`,
          valuePos,
          "HSON_ELEMENT_TYPED_CONTENT_FORBIDDEN",
        );
      }

      if (ch === `"`) {
        const valuePos = this.position();
        contentStarted = true;
        emitOpen();
        this.tokens.push(CREATE_TEXT_TOKEN(this.scanContentString(), true, valuePos));
        continue;
      }

      if (ch === "<") {
        const childPos = this.position();
        if (this.classifyAngleCloser(childPos) !== CLOSE_KIND.elem) {
          this.fail(
            `structural mode crossing: element <${tag}> cannot contain an object-mode value`,
            childPos,
            "HSON_STRUCTURAL_MODE_CROSSING",
          );
        }
        contentStarted = true;
        emitOpen();
        this.scanAngle(depth + 1);
        continue;
      }

      if (ch === "«" || ch === "[") {
        this.fail(
          `structural mode crossing: element branch <${tag}> cannot contain object/array structure (array value)`,
          this.position(),
          "HSON_STRUCTURAL_MODE_CROSSING",
        );
      }

      if (ch === "'") {
        this.fail(
          `single-quoted names are valid only in the element-name position, not as attributes or flags`,
          undefined,
          "HSON_NAME_INVALID_START",
        );
      }

      if (ch === "`") {
        this.rejectLegacyBacktick();
      }

      if (contentStarted) {
        const invalidPos = this.position();
        const raw = this.scanBareToken();
        this.fail(
          `unexpected bare token in <${tag}> content: "${raw}"`,
          invalidPos,
          "HSON_ELEMENT_HEADER_AFTER_CONTENT",
        );
      }

      this.fail(`unexpected token "${ch}" in <${tag}> element header`, undefined, "HSON_ELEMENT_ATTRIBUTE_VALUE_INVALID");
    }
  }

  private scanArray(depth: number): void {
    this.assertNesting(depth);
    const opener = this.peek();
    const closer = opener === "«" ? "»" : "]";
    const symbol: ArraySymbol = opener === "«" ? ARR_SYMBOL.guillemet : ARR_SYMBOL.bracket;
    const openPos = this.position();
    this.consumeExpected(opener);
    this.skipTrivia();
    let quid: { value: string; start: Position; end: Position } | undefined;
    if (this.peek() === "@") {
      const quidPos = this.position();
      this.consumeExpected("@");
      if (this.atEnd() || isHsonTrivia(this.peek()) || this.peek() === closer) {
        this.fail(`missing persisted QUID value after "@"`, quidPos, "HSON_ARRAY_QUID_INVALID");
      }
      const value = this.scanBareToken();
      if (!is_persisted_quid(value)) {
        this.fail(`invalid persisted QUID "${value}"`, quidPos, "HSON_ARRAY_QUID_INVALID");
      }
      quid = { value, start: quidPos, end: this.previousPosition() };
      const separated = this.skipTrivia();
      if (this.peek() !== closer && !separated) {
        this.fail(
          `required trivia is missing after persisted array QUID declaration`,
          this.position(),
          "HSON_REQUIRED_TRIVIA_MISSING",
        );
      }
    }
    this.tokens.push(CREATE_ARR_OPEN_TOKEN(symbol, openPos, quid));

    let expectItem = true;
    let sawItem = false;
    while (true) {
      this.skipTrivia();
      if (this.atEnd()) {
        this.fail(`unterminated ${opener}${closer} array`, openPos, "HSON_CONTAINER_UNTERMINATED");
      }

      if (this.peek() === closer) {
        const closePos = this.position();
        this.consumeExpected(closer);
        this.tokens.push(CREATE_ARR_CLOSE_TOKEN(symbol, closePos));
        return;
      }

      if (this.peek() === (closer === "]" ? "»" : "]")) {
        this.fail(
          `mismatched array closer "${this.peek()}"; expected "${closer}"`,
          undefined,
          "HSON_ARRAY_CLOSER_MISMATCH",
        );
      }

      if (!expectItem) {
        if (this.peek() !== ",") {
          this.fail(
            `expected "," or "${closer}" after array item`,
            undefined,
            "HSON_ARRAY_COMMA_MISSING",
          );
        }
        this.consumeExpected(",");
        expectItem = true;
        continue;
      }

      if (this.peek() === ",") {
        this.fail(
          sawItem ? `missing array item between commas` : `unexpected comma before first array item`,
          undefined,
          sawItem ? "HSON_ARRAY_ITEM_MISSING" : "HSON_ARRAY_COMMA_EXTRA",
        );
      }

      this.scanArrayItem(depth + 1);
      sawItem = true;
      expectItem = false;
    }
  }

  private scanArrayItem(depth: number): void {
    this.assertNesting(depth);
    const ch = this.peek();

    if (ch === "<") {
      this.scanAngle(depth);
      return;
    }

    if (ch === "«" || ch === "[") {
      this.scanArray(depth);
      return;
    }

    if (ch === `"`) {
      const pos = this.position();
      this.tokens.push(CREATE_TEXT_TOKEN(this.scanContentString(), true, pos));
      return;
    }

    if (ch === "'") {
      this.fail(`unsupported quote delimiter (use double quotes only)`, undefined, "HSON_QUOTE_KIND_UNSUPPORTED");
    }

    if (ch === "`") {
      this.rejectLegacyBacktick();
    }

    const pos = this.position();
    const raw = this.scanBareToken();
    if (!isPrimitiveLiteral(raw)) {
      const numericDefect = classifyNumberDefect(raw);
      this.fail(
        `unexpected bare array item: "${raw}"`,
        numericDefect === undefined
          ? pos
          : this.positionAt(pos.index + numericDefect.offset),
        numericDefect?.code ?? "HSON_PRIMITIVE_TOKEN_INVALID",
      );
    }
    this.assertFiniteNumberLiteral(raw, pos);
    this.tokens.push(CREATE_TEXT_TOKEN(raw, undefined, pos));
  }

  private scanAttributeValue(name: string, start: Position): RawAttr {
    this.consumeExpected("=");
    this.skipTrivia();
    if (this.atEnd() || this.startsWith("/>") || this.peek() === ">") {
      this.fail(`missing attribute value for "${name}"`, start, "HSON_ELEMENT_ATTRIBUTE_VALUE_INVALID");
    }

    if (this.peek() === "'") {
      this.fail(
        `unsupported single-quoted attribute value (use double quotes only)`,
        undefined,
        "HSON_QUOTE_KIND_UNSUPPORTED",
      );
    }

    if (this.peek() === "`") {
      this.rejectLegacyBacktick();
    }

    if (this.peek() === `"`) {
      const { text, end } = this.scanAttributeString(name);
      return { name, value: { text, quoted: true }, start, end };
    }

    const valueStart = this.position();
    let text = "";
    let end = valueStart;

    while (!this.atEnd()) {
      const ch = this.peek();
      if (this.startsWith("/>")) break;
      if (isHsonTrivia(ch) || isUnsupportedWhitespace(ch) || ch === "<" || ch === ">" || ch === `"` || ch === "'" || ch === "`" || ch === "«" || ch === "»" || ch === "[" || ch === "]") {
        break;
      }
      end = this.position();
      text += this.consume();
    }

    if (!text) this.fail(`missing attribute value for "${name}"`, start, "HSON_ELEMENT_ATTRIBUTE_VALUE_INVALID");
    if (text.includes("=")) {
      this.fail(
        `malformed unquoted attribute value for "${name}": "${text}"`,
        valueStart,
        "HSON_ELEMENT_ATTRIBUTE_VALUE_INVALID",
      );
    }

    return { name, value: { text, quoted: false }, start, end };
  }

  /** Return a complete strict JSON-compatible string literal. */
  private scanContentString(): string {
    const start = this.position();
    this.consumeExpected(`"`);
    let raw = `"`;

    while (!this.atEnd()) {
      const ch = this.peek();

      if (ch === `"`) {
        this.consumeExpected(`"`);
        return raw + `"`;
      }

      if (ch === "\\") {
        raw += this.scanJsonEscape("content string");
        continue;
      }

      if (ch.charCodeAt(0) < 0x20) {
        this.fail(
          `[invalid-json-string] unescaped control character in content string`,
          this.position(),
          "HSON_STRING_CONTROL_UNESCAPED",
        );
      }

      raw += this.consume();
    }

    const final = this.source[this.source.length - 1];
    this.fail(
      final === "'" ? `mixed quote boundary in quoted string` : `unterminated quoted string`,
      final === "'" ? this.positionAt(this.source.length - 1) : start,
      final === "'" ? "HSON_QUOTE_BOUNDARY_MISMATCH" : "HSON_STRING_UNTERMINATED",
    );
  }

  /** Attribute tokens retain their inner source text rather than outer quotes. */
  private scanAttributeString(name: string): { text: string; end: Position } {
    const start = this.position();
    this.consumeExpected(`"`);
    let text = "";

    while (!this.atEnd()) {
      const ch = this.peek();
      if (ch === `"`) {
        const end = this.position();
        this.consumeExpected(`"`);
        return { text, end };
      }

      if (ch === "\\") {
        text += this.scanJsonEscape(`quoted attribute "${name}"`);
        continue;
      }

      if (ch.charCodeAt(0) < 0x20) {
        this.fail(
          `[invalid-json-string] unescaped control character in quoted attribute "${name}"`,
          this.position(),
          "HSON_STRING_CONTROL_UNESCAPED",
        );
      }

      text += this.consume();
    }

    const final = this.source[this.source.length - 1];
    this.fail(
      final === "'"
        ? `mixed quote boundary in quoted attribute "${name}"`
        : `unterminated quoted attribute value for "${name}"`,
      final === "'" ? this.positionAt(this.source.length - 1) : start,
      final === "'" ? "HSON_QUOTE_BOUNDARY_MISMATCH" : "HSON_STRING_UNTERMINATED",
    );
  }

  private scanQuotedName(): string {
    const start = this.position();
    this.consumeExpected("'");
    let tag = "";

    while (!this.atEnd()) {
      const ch = this.peek();
      if (ch === "'") {
        this.consumeExpected("'");
        return tag;
      }

      if (ch === "\\") {
        const escapePos = this.position();
        this.consumeExpected("\\");
        if (this.atEnd() || this.peek().charCodeAt(0) < 0x20) {
          this.fail(
            `[invalid-name-escape] invalid quoted-name escape termination`,
            escapePos,
            "invalid-name-escape",
          );
        }
        const escaped = this.consume();
        if (escaped === "'") tag += "'";
        else if (escaped === "\\") tag += "\\";
        else if (escaped === "b") tag += "\b";
        else if (escaped === "f") tag += "\f";
        else if (escaped === "n") tag += "\n";
        else if (escaped === "r") tag += "\r";
        else if (escaped === "t") tag += "\t";
        else if (escaped === "u") {
          let hex = "";
          for (let offset = 0; offset < 4; offset += 1) {
            const digit = this.peek();
            if (!/^[0-9A-Fa-f]$/.test(digit)) {
              this.fail(
                `[invalid-name-escape] malformed unicode escape ${JSON.stringify(`\\u${hex}`)} in quoted HSON name`,
                escapePos,
                "invalid-name-escape",
              );
            }
            hex += this.consume();
          }
          tag += String.fromCharCode(Number.parseInt(hex, 16));
        }
        else {
          this.fail(
            `[invalid-name-escape] unsupported quoted-name escape ${JSON.stringify(`\\${escaped}`)}`,
            escapePos,
            "invalid-name-escape",
          );
        }
        continue;
      }

      if (ch.charCodeAt(0) < 0x20) {
        this.fail(
          `raw control character is forbidden in single-quoted HSON name`,
          this.position(),
          "HSON_NAME_CONTROL_UNESCAPED",
        );
      }

      tag += this.consume();
    }

    this.fail(`unterminated single-quoted HSON name`, start, "HSON_NAME_UNTERMINATED");
  }

  private scanJsonEscape(context: string): string {
    const escapePos = this.position();
    this.consumeExpected("\\");
    if (this.atEnd() || this.isNewline()) {
      this.fail(`[invalid-json-escape] invalid escape termination in ${context}`, escapePos, "invalid-json-escape");
    }

    const escaped = this.consume();
    if (`"\\/bfnrt`.includes(escaped)) return `\\${escaped}`;

    if (escaped === "u") {
      let hex = "";
      for (let offset = 0; offset < 4; offset += 1) {
        const digit = this.peek();
        if (!/^[0-9A-Fa-f]$/.test(digit)) {
          this.fail(
            `[invalid-json-escape] malformed unicode escape ${JSON.stringify(`\\u${hex}`)} in ${context}`,
            escapePos,
            "invalid-json-escape",
          );
        }
        hex += this.consume();
      }
      return `\\u${hex}`;
    }

    this.fail(
      `[invalid-json-escape] unsupported escape ${JSON.stringify(`\\${escaped}`)} in ${context}`,
      escapePos,
      "invalid-json-escape",
    );
  }

  private assertUniqueAttribute(
    declarations: Map<string, Position>,
    attr: RawAttr,
  ): void {
    const first = declarations.get(attr.name);
    if (first !== undefined) {
      this.fail(
        `[duplicate-attribute] duplicate HSON attribute "${attr.name}"; first declared at ${first.line}:${first.col} (index ${first.index})`,
        attr.start,
        "HSON_ELEMENT_DUPLICATE_ATTRIBUTE",
        [{ role: "first-declaration", pos: first }],
      );
    }
    declarations.set(attr.name, attr.start);
  }

  private scanBareName(where: string): string {
    const start = this.position();
    const first = this.peek();
    if (!is_hson_bare_name_start(first)) {
      this.fail(
        `malformed ${where}: expected a bare name or single-quoted name`,
        start,
        where === "tag name" ? "HSON_ELEMENT_NAME_REQUIRED" : "HSON_NAME_INVALID_START",
      );
    }

    let out = this.consume();
    while (!this.atEnd() && is_hson_bare_name_char(this.peek())) out += this.consume();
    return out;
  }

  private scanBareToken(): string {
    const start = this.position();
    let out = "";

    while (!this.atEnd()) {
      const ch = this.peek();
      if (ch === "`") this.rejectLegacyBacktick();
      if (
        isHsonTrivia(ch) || isUnsupportedWhitespace(ch) || ch === "<" || ch === ">" || ch === "/" ||
        ch === "[" || ch === "]" || ch === "«" || ch === "»" ||
        ch === "," || ch === `"` || ch === "'" || ch === "`" || ch === "="
      ) {
        break;
      }
      out += this.consume();
    }

    if (!out) this.fail(`unexpected token "${this.peek()}"`, start);
    return out;
  }

  /** Discover this angle's matching closer without changing the source cursor. */
  private classifyAngleCloser(openPos: Position): CloseKind {
    const stack: Array<"<" | "[" | "«"> = ["<"];
    let cursor = this.index + 1;
    let quoted: `"` | "'" | undefined;
    let quoteStart = -1;
    let expectAttributeValue = false;
    let unquotedAttributeValue = false;

    while (cursor < this.source.length) {
      const ch = this.source[cursor];
      const next = this.source[cursor + 1];

      if (quoted !== undefined) {
        if (ch === "\\") {
          if (cursor + 1 >= this.source.length || next.charCodeAt(0) < 0x20) {
            this.fail(
              quoted === `"`
                ? `[invalid-json-escape] invalid escape termination in quoted HSON string`
                : `[invalid-name-escape] invalid quoted-name escape termination`,
              this.positionAt(cursor),
              quoted === `"` ? "invalid-json-escape" : "invalid-name-escape",
            );
          }
          cursor += 2;
          continue;
        }
        if (ch.charCodeAt(0) < 0x20) {
          this.fail(
            quoted === `"`
              ? `unescaped control character in quoted HSON string`
              : `raw control character in single-quoted HSON name`,
            this.positionAt(cursor),
            quoted === `"` ? "HSON_STRING_CONTROL_UNESCAPED" : "HSON_NAME_CONTROL_UNESCAPED",
          );
        }
        if (ch === quoted) {
          quoted = undefined;
          quoteStart = -1;
        }
        cursor += 1;
        continue;
      }

      if (ch === "`") {
        this.rejectLegacyBacktick(this.positionAt(cursor));
      }

      // Element attributes retain the existing permissive unquoted value
      // grammar, including literal slash runs such as `href=foo//bar`. A
      // `//` inside that lexical value is not comment trivia.
      if (unquotedAttributeValue) {
        if (ch === "/" && next === ">") {
          unquotedAttributeValue = false;
        } else if (isHsonTrivia(ch) || isUnsupportedWhitespace(ch) || ch === "<" || ch === ">" || ch === "[" || ch === "]" || ch === "«" || ch === "»") {
          unquotedAttributeValue = false;
        } else {
          cursor += 1;
          continue;
        }
      }

      if (expectAttributeValue) {
        if (isHsonTrivia(ch)) {
          cursor += 1;
          continue;
        }
        if (isUnsupportedWhitespace(ch)) {
          this.fail(
            `unsupported whitespace character U+${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`,
            this.positionAt(cursor),
            "HSON_UNSUPPORTED_WHITESPACE",
          );
        }
        if (ch === "/" && next === "/") {
          cursor += 2;
          while (cursor < this.source.length && this.source[cursor] !== "\n" && this.source[cursor] !== "\r") {
            cursor += 1;
          }
          continue;
        }
        if (ch === "/" && next === ">") {
          expectAttributeValue = false;
        } else if (ch !== `"` && ch !== "'" && ch !== "<" && ch !== ">") {
          expectAttributeValue = false;
          unquotedAttributeValue = true;
          cursor += 1;
          continue;
        } else expectAttributeValue = false;
      }

      if (ch === `"` || ch === "'") {
        quoted = ch;
        quoteStart = cursor;
        cursor += 1;
        continue;
      }

      if (ch === "/" && next === "/") {
        cursor += 2;
        while (cursor < this.source.length && this.source[cursor] !== "\n" && this.source[cursor] !== "\r") {
          cursor += 1;
        }
        continue;
      }

      if (ch === "/" && next === "*") {
        this.fail(
          `block comments are not supported in authored HSON`,
          this.positionAt(cursor),
          "HSON_BLOCK_COMMENT_UNSUPPORTED",
        );
      }

      if (isUnsupportedWhitespace(ch)) {
        this.fail(
          `unsupported whitespace character U+${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`,
          this.positionAt(cursor),
          "HSON_UNSUPPORTED_WHITESPACE",
        );
      }

      if (ch === "/" && next !== ">" && stack.at(-1) === "<") {
        let afterSlash = cursor + 1;
        while (afterSlash < this.source.length && isHsonTrivia(this.source[afterSlash])) afterSlash += 1;
        if (this.source[afterSlash] === ">") {
          this.fail(
            `element closer must be the adjacent token "/>"`,
            this.positionAt(cursor),
            "HSON_ELEMENT_CLOSER_MALFORMED",
          );
        }
      }

      if (ch === "=") {
        expectAttributeValue = true;
        cursor += 1;
        continue;
      }

      if (ch === "<") {
        expectAttributeValue = false;
        unquotedAttributeValue = false;
        stack.push("<");
        cursor += 1;
        continue;
      }
      if (ch === "[") {
        stack.push("[");
        cursor += 1;
        continue;
      }
      if (ch === "«") {
        stack.push("«");
        cursor += 1;
        continue;
      }
      if (ch === "/" && next === ">" && stack.at(-1) === "<") {
        expectAttributeValue = false;
        unquotedAttributeValue = false;
        stack.pop();
        if (stack.length === 0) return CLOSE_KIND.elem;
        cursor += 2;
        continue;
      }
      if (ch === ">" && stack.at(-1) === "<") {
        expectAttributeValue = false;
        unquotedAttributeValue = false;
        stack.pop();
        if (stack.length === 0) return CLOSE_KIND.obj;
        cursor += 1;
        continue;
      }
      if (ch === "]" && stack.at(-1) === "[") {
        stack.pop();
        cursor += 1;
        continue;
      }
      if (ch === "»" && stack.at(-1) === "«") {
        stack.pop();
        cursor += 1;
        continue;
      }
      cursor += 1;
    }

    if (quoted === `"`) {
      const final = this.source[this.source.length - 1];
      this.fail(
        final === "'" ? `mixed quote boundary in quoted string` : `unterminated quoted string`,
        final === "'" ? this.positionAt(this.source.length - 1) : this.positionAt(quoteStart),
        final === "'" ? "HSON_QUOTE_BOUNDARY_MISMATCH" : "HSON_STRING_UNTERMINATED",
      );
    }
    if (quoted === "'") {
      this.fail(`unterminated single-quoted HSON name`, this.positionAt(quoteStart), "HSON_NAME_UNTERMINATED");
    }
    this.fail(`unterminated angle construct`, openPos, "HSON_CONTAINER_UNTERMINATED");
  }

  private skipTrivia(): boolean {
    const start = this.index;
    while (true) {
      while (!this.atEnd() && isHsonTrivia(this.peek())) this.consume();
      if (isUnsupportedWhitespace(this.peek())) {
        const ch = this.peek();
        this.fail(
          `unsupported whitespace character U+${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`,
          this.position(),
          "HSON_UNSUPPORTED_WHITESPACE",
        );
      }
      if (this.startsWith("/*")) {
        this.fail(
          `block comments are not supported in authored HSON`,
          this.position(),
          "HSON_BLOCK_COMMENT_UNSUPPORTED",
        );
      }
      if (!this.startsWith("//")) return this.index !== start;

      this.consumeExpected("/");
      this.consumeExpected("/");
      while (!this.atEnd() && !this.isNewline()) this.consume();
      if (!this.atEnd()) this.consume();
    }
  }

  private nextNonTriviaIs(expected: string): boolean {
    let ix = this.index;
    while (ix < this.source.length) {
      const ch = this.source[ix];
      if (isHsonTrivia(ch)) {
        ix++;
        continue;
      }
      if (this.source.startsWith("//", ix)) {
        ix += 2;
        while (ix < this.source.length && this.source[ix] !== "\n" && this.source[ix] !== "\r") ix++;
        continue;
      }
      return this.source.startsWith(expected, ix);
    }
    return false;
  }

  private assertNesting(depth: number): void {
    if (depth >= MAX_NESTING) {
      this.fail(`stopping potentially infinite loop (depth >= ${MAX_NESTING})`);
    }
  }

  private assertFiniteNumberLiteral(raw: string, pos: Position): void {
    if (NUMBER_LITERAL.test(raw) && !Number.isFinite(Number(raw))) {
      this.fail(`HSON number must be finite: "${raw}"`, pos, "HSON_NUMBER_NONFINITE");
    }
  }

  private position(): Position {
    return { line: this.line, col: this.col, index: this.index };
  }

  private positionAt(index: number): Position {
    let line = 1;
    let col = 1;
    let cursor = 0;
    while (cursor < index) {
      const ch = this.source[cursor];
      if (ch === "\r") {
        if (this.source[cursor + 1] === "\n") cursor += 1;
        line += 1;
        col = 1;
      } else if (ch === "\n") {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
      cursor += 1;
    }
    return { line, col, index };
  }

  private previousPosition(): Position {
    const index = Math.max(0, this.index - 1);
    return { line: this.line, col: Math.max(1, this.col - 1), index };
  }

  private peek(offset = 0): string {
    return this.source[this.index + offset] ?? "";
  }

  private startsWith(text: string): boolean {
    return this.source.startsWith(text, this.index);
  }

  private atEnd(): boolean {
    return this.index >= this.source.length;
  }

  private isNewline(): boolean {
    const ch = this.peek();
    return ch === "\n" || ch === "\r";
  }

  /** Consume one logical source character; CRLF advances one line but two indices. */
  private consume(): string {
    if (this.atEnd()) this.fail(`unexpected end of input`);
    const ch = this.source[this.index];

    if (ch === "\r") {
      if (this.source[this.index + 1] === "\n") this.index += 2;
      else this.index += 1;
      this.line += 1;
      this.col = 1;
      return "\n";
    }

    this.index += 1;
    if (ch === "\n") {
      this.line += 1;
      this.col = 1;
      return "\n";
    }

    this.col += 1;
    return ch;
  }

  private consumeExpected(expected: string): void {
    if (this.peek() !== expected) {
      this.fail(`expected "${expected}", got "${this.peek() || "eof"}"`);
    }
    this.consume();
  }

  private rejectLegacyBacktick(pos = this.position()): never {
    this.fail(
      `legacy backtick-delimited HSON names are invalid; use a single-quoted name`,
      pos,
      "HSON_NAME_LEGACY_BACKTICK",
    );
  }

  private fail(
    message: string,
    pos = this.position(),
    code = "HSON_TOKENIZATION_ERROR",
    related?: readonly { role: string; pos: Position }[],
  ): never {
    _throw_transform_err(
      `${message} at ${pos.line}:${pos.col} (index ${pos.index})`,
      "tokenize-hson",
      undefined,
      undefined,
      {
        code,
        stage: "tokenization",
        source: { index: pos.index, line: pos.line, column: pos.col },
        ...(related === undefined ? {} : {
          related: related.map((item) => ({
            role: item.role,
            source: { index: item.pos.index, line: item.pos.line, column: item.pos.col },
          })),
        }),
      },
    );
  }
}

function isPrimitiveLiteral(raw: string): boolean {
  return raw === "true" || raw === "false" || raw === "null" || NUMBER_LITERAL.test(raw);
}

type NumberDefect = Readonly<{
  code: string;
  offset: number;
}>;

function numberDefect(code: string, offset = 0): NumberDefect {
  return { code, offset };
}

function classifyNumberDefect(raw: string): NumberDefect | undefined {
  if (/^\+\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
    return numberDefect("HSON_NUMBER_LEADING_PLUS");
  }
  if (/^-?0\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
    return numberDefect("HSON_NUMBER_LEADING_ZERO", raw.startsWith("-") ? 2 : 1);
  }
  if (raw === "NaN" || raw === "Infinity" || raw === "+Infinity" || raw === "-Infinity") {
    return numberDefect("HSON_NUMBER_UNSUPPORTED_SPELLING");
  }
  if (/^[+-]?(?:0[xX][0-9A-Fa-f]+|\d[\d_]*_\d[\d_]*)$/.test(raw)) {
    return numberDefect("HSON_NUMBER_UNSUPPORTED_SPELLING");
  }
  if (/^[+-]?(?:\.\d+|\d+\.)$/.test(raw)) {
    return numberDefect("HSON_NUMBER_INCOMPLETE_FRACTION");
  }
  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?$/.test(raw)) {
    return numberDefect("HSON_NUMBER_INCOMPLETE_EXPONENT");
  }
  if (/^(?:[+-]{2,}|[+-]?\d+(?:\.\d+)?[+-]\d+)/.test(raw)) {
    return numberDefect("HSON_NUMBER_INVALID_SIGN");
  }
  if (/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[^\d]/.test(raw)) {
    return numberDefect("HSON_NUMBER_TRAILING_JUNK");
  }
  if (/^[+-.\d]/.test(raw)) return numberDefect("HSON_NUMBER_UNSUPPORTED_SPELLING");
  return undefined;
}
