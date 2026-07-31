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
const NUMBER_LITERAL = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

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
        this.fail(`unsupported quote delimiter (use double quotes only)`);
      } else if (ch === "`") {
        this.fail(`backticks are only valid for tag names`);
      } else if (ch === ">" || ch === "/" || ch === "]" || ch === "»") {
        this.fail(`unexpected structural closer "${ch}"`);
      } else {
        const pos = this.position();
        const raw = this.scanBareToken();
        if (!isPrimitiveLiteral(raw)) {
          this.fail(`unexpected bare token outside tag header: "${raw}"`, pos);
        }
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
    if (this.atEnd()) this.fail(`unterminated object`, openPos);

    this.tokens.push(CREATE_OPEN_TOKEN(OBJ_TAG, [], openPos));
    if (this.peek() === ">") {
      const closePos = this.position();
      this.consumeExpected(">");
      this.tokens.push(CREATE_END_TOKEN(CLOSE_KIND.obj, closePos));
      return;
    }

    const declarations = new Map<string, Position>();
    while (true) {
      const namePos = this.position();
      if (this.peek() === "@") {
        this.fail(`object members cannot author persisted QUID declarations`, namePos);
      }
      if (this.peek() === "<") {
        this.fail(`legacy doubled object syntax is not supported; expected an object member name`, namePos);
      }
      if (this.startsWith("/>")) {
        this.fail(`objects must close with ">", not "/>"`, namePos);
      }
      if (this.peek() === ">") {
        this.fail(`unexpected object closer; expected an object member name`, namePos);
      }

      const name = this.peek() === "`"
        ? this.scanQuotedTagName()
        : this.scanBareName("object member name");
      assert_authored_hson_source_name(name, namePos);
      const first = declarations.get(name);
      if (first !== undefined) {
        this.fail(
          `[duplicate-object-member] duplicate HSON object member "${name}"; first declared at ${first.line}:${first.col} (index ${first.index})`,
          namePos,
        );
      }
      declarations.set(name, namePos);

      if (!this.skipTrivia()) {
        this.fail(`required trivia is missing between object member name and value`, this.position());
      }
      if (this.atEnd() || this.peek() === ">") {
        this.fail(`object member "${name}" is missing its value`, namePos);
      }
      if (this.peek() === "@") {
        this.fail(`object members cannot author persisted QUID declarations`, this.position());
      }

      this.tokens.push(CREATE_OPEN_TOKEN(name, [], namePos));
      this.scanObjectMemberValue(depth + 1, name);
      this.tokens.push(CREATE_END_TOKEN(CLOSE_KIND.obj, this.previousPosition()));

      const separated = this.skipTrivia();
      if (this.atEnd()) this.fail(`unterminated object`, openPos);
      if (this.peek() === ">") {
        const closePos = this.position();
        this.consumeExpected(">");
        this.tokens.push(CREATE_END_TOKEN(CLOSE_KIND.obj, closePos));
        return;
      }
      if (!separated) {
        this.fail(`required trivia is missing between sibling object members`, this.position());
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
        this.fail(`object member "${memberName}" cannot contain an element-mode value`, pos);
      }
      this.scanAngle(depth);
      return;
    }
    if (ch === "«" || ch === "[") {
      this.scanArray(depth);
      return;
    }
    if (ch === "'") {
      this.fail(`unsupported quote delimiter (use double quotes only)`);
    }
    if (ch === "`") {
      this.fail(`backticks are only valid for object member or element names`);
    }

    const pos = this.position();
    const raw = this.scanBareToken();
    if (!isPrimitiveLiteral(raw)) {
      this.fail(`invalid bare object value "${raw}" for member "${memberName}"; quote string values`, pos);
    }
    this.tokens.push(CREATE_TEXT_TOKEN(raw, undefined, pos));
  }

  /** Existing named element syntax, selected only after a matching `/>`. */
  private scanElementAfterOpen(openPos: Position, depth: number): void {
    this.skipTrivia();
    if (this.atEnd()) this.fail(`unterminated angle construct`, openPos);

    if (this.startsWith("/>")) {
      this.fail(`missing tag name before "/>"`, openPos);
    }

    const tagPos = this.position();
    const tag = this.peek() === "`"
      ? this.scanQuotedTagName()
      : this.scanBareName("tag name");
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
      if (this.atEnd()) this.fail(`unterminated tag <${tag}>`, openPos);

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
        if (contentStarted) this.fail(`persisted QUID declaration is forbidden after content begins`, quidPos);
        this.consumeExpected("@");
        if (this.atEnd() || /\s/.test(this.peek()) || this.startsWith("/>") || this.peek() === ">") {
          this.fail(`missing persisted QUID value after "@"`, quidPos);
        }
        const value = this.scanBareToken();
        if (!is_persisted_quid(value)) this.fail(`invalid persisted QUID "${value}"`, quidPos);
        if (quid !== undefined) this.fail(`duplicate persisted QUID declaration`, quidPos);
        quid = { value, start: quidPos, end: this.previousPosition() };
        continue;
      }

      if (is_hson_bare_name_start(ch)) {
        const namePos = this.position();
        const name = this.scanBareName("attribute or flag");
        const nameEnd = this.previousPosition();

        if (!contentStarted) {
          this.skipTrivia();

          if (this.peek() === "=") {
            const attr = this.scanAttributeValue(name, namePos);
            this.assertUniqueAttribute(attrDeclarations, attr);
            attrs.push(attr);
            continue;
          }

          if (!isPrimitiveLiteral(name)) {
            const attr = { name, start: namePos, end: nameEnd };
            this.assertUniqueAttribute(attrDeclarations, attr);
            attrs.push(attr);
            continue;
          }
        }

        if (isPrimitiveLiteral(name)) {
          contentStarted = true;
          emitOpen();
          this.tokens.push(CREATE_TEXT_TOKEN(name, undefined, namePos));
          continue;
        }

        const suffix = this.nextNonTriviaIs("=") ? `; attributes are forbidden after content begins` : "";
        this.fail(`unexpected bare token in <${tag}> content: "${name}"${suffix}`, namePos);
      }

      if (ch === "+" || ch === "-" || /\d/.test(ch)) {
        const valuePos = this.position();
        const raw = this.scanBareToken();
        if (!isPrimitiveLiteral(raw)) {
          this.fail(`invalid primitive content "${raw}"`, valuePos);
        }
        contentStarted = true;
        emitOpen();
        this.tokens.push(CREATE_TEXT_TOKEN(raw, undefined, valuePos));
        continue;
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
          this.fail(`structural mode crossing: element <${tag}> cannot contain an object-mode value`, childPos);
        }
        contentStarted = true;
        emitOpen();
        this.scanAngle(depth + 1);
        continue;
      }

      if (ch === "«" || ch === "[") {
        contentStarted = true;
        emitOpen();
        this.scanArray(depth + 1);
        continue;
      }

      if (ch === "'") {
        this.fail(`unsupported quote delimiter (use double quotes only)`);
      }

      if (ch === "`") {
        this.fail(`backticks are only valid for tag names`);
      }

      if (contentStarted) {
        const invalidPos = this.position();
        const raw = this.scanBareToken();
        const suffix = this.nextNonTriviaIs("=") ? `; attributes are forbidden after content begins` : "";
        this.fail(`unexpected bare token in <${tag}> content: "${raw}"${suffix}`, invalidPos);
      }

      this.fail(`unexpected token "${ch}" in <${tag}> element header`);
    }
  }

  private scanArray(depth: number): void {
    this.assertNesting(depth);
    const opener = this.peek();
    const closer = opener === "«" ? "»" : "]";
    const symbol: ArraySymbol = opener === "«" ? ARR_SYMBOL.guillemet : ARR_SYMBOL.bracket;
    const openPos = this.position();
    this.consumeExpected(opener);
    this.tokens.push(CREATE_ARR_OPEN_TOKEN(symbol, openPos));

    let expectItem = true;
    while (true) {
      this.skipTrivia();
      if (this.atEnd()) this.fail(`unterminated ${opener}${closer} array`, openPos);

      if (this.peek() === closer) {
        const closePos = this.position();
        this.consumeExpected(closer);
        this.tokens.push(CREATE_ARR_CLOSE_TOKEN(symbol, closePos));
        return;
      }

      if (this.peek() === (closer === "]" ? "»" : "]")) {
        this.fail(`mismatched array closer "${this.peek()}"; expected "${closer}"`);
      }

      if (!expectItem) {
        if (this.peek() !== ",") {
          this.fail(`expected "," or "${closer}" after array item`);
        }
        this.consumeExpected(",");
        expectItem = true;
        continue;
      }

      if (this.peek() === ",") {
        this.fail(`missing array item before comma`);
      }

      this.scanArrayItem(depth + 1);
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
      this.fail(`unsupported quote delimiter (use double quotes only)`);
    }

    if (ch === "`") {
      this.fail(`backticks are only valid for tag names`);
    }

    const pos = this.position();
    const raw = this.scanBareToken();
    if (!isPrimitiveLiteral(raw)) {
      this.fail(`unexpected bare array item: "${raw}"`, pos);
    }
    this.tokens.push(CREATE_TEXT_TOKEN(raw, undefined, pos));
  }

  private scanAttributeValue(name: string, start: Position): RawAttr {
    this.consumeExpected("=");
    this.skipTrivia();
    if (this.atEnd() || this.startsWith("/>") || this.peek() === ">") {
      this.fail(`missing attribute value for "${name}"`, start);
    }

    if (this.peek() === "'") {
      this.fail(`unsupported single-quoted attribute value (use double quotes only)`);
    }

    if (this.peek() === "`") {
      this.fail(`backticks are only valid for tag names`);
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
      if (/\s/.test(ch) || ch === "<" || ch === ">" || ch === `"` || ch === "'" || ch === "`" || ch === "«" || ch === "»" || ch === "[" || ch === "]") {
        break;
      }
      end = this.position();
      text += this.consume();
    }

    if (!text) this.fail(`missing attribute value for "${name}"`, start);
    if (text.includes("=")) {
      this.fail(`malformed unquoted attribute value for "${name}": "${text}"`, valueStart);
    }

    return { name, value: { text, quoted: false }, start, end };
  }

  /** Return a complete JSON-compatible literal, preserving multiline HSON text. */
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

      if (this.isNewline()) {
        this.consume();
        raw += "\\n";
        continue;
      }

      if (ch === "\t") {
        this.consume();
        raw += "\\t";
        continue;
      }

      if (ch.charCodeAt(0) < 0x20) {
        this.fail(`[invalid-json-string] unescaped control character in content string`);
      }

      raw += this.consume();
    }

    this.fail(`unterminated quoted string`, start);
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

      if (this.isNewline()) {
        this.consume();
        text += "\\n";
        continue;
      }

      if (ch === "\t") {
        this.consume();
        text += "\\t";
        continue;
      }

      if (ch.charCodeAt(0) < 0x20) {
        this.fail(`[invalid-json-string] unescaped control character in quoted attribute "${name}"`);
        continue;
      }

      text += this.consume();
    }

    this.fail(`unterminated quoted attribute value for "${name}"`, start);
  }

  private scanQuotedTagName(): string {
    const start = this.position();
    this.consumeExpected("`");
    let tag = "";

    while (!this.atEnd()) {
      const ch = this.peek();
      if (ch === "`") {
        this.consumeExpected("`");
        return tag;
      }

      if (this.isNewline()) {
        this.fail(`unterminated quoted tag name`, start);
      }

      if (ch === "\\") {
        const escapePos = this.position();
        this.consumeExpected("\\");
        if (this.atEnd() || this.isNewline()) {
          this.fail(`[invalid-name-escape] invalid escape termination in backtick HSON name`, escapePos);
        }
        const escaped = this.consume();
        if (escaped === "`") tag += "`";
        else if (escaped === "\\") tag += "\\";
        else if (escaped === "n") tag += "\n";
        else if (escaped === "r") tag += "\r";
        else if (escaped === "t") tag += "\t";
        else {
          this.fail(
            `[invalid-name-escape] unsupported escape ${JSON.stringify(`\\${escaped}`)} in backtick HSON name`,
            escapePos,
          );
        }
        continue;
      }

      tag += this.consume();
    }

    this.fail(`unterminated quoted tag name`, start);
  }

  private scanJsonEscape(context: string): string {
    const escapePos = this.position();
    this.consumeExpected("\\");
    if (this.atEnd() || this.isNewline()) {
      this.fail(`[invalid-json-escape] invalid escape termination in ${context}`, escapePos);
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
          );
        }
        hex += this.consume();
      }
      return `\\u${hex}`;
    }

    this.fail(
      `[invalid-json-escape] unsupported escape ${JSON.stringify(`\\${escaped}`)} in ${context}`,
      escapePos,
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
      );
    }
    declarations.set(attr.name, attr.start);
  }

  private scanBareName(where: string): string {
    const start = this.position();
    const first = this.peek();
    if (!is_hson_bare_name_start(first)) {
      this.fail(`malformed ${where}: expected a bare name or backtick-quoted name`, start);
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
      if (
        /\s/.test(ch) || ch === "<" || ch === ">" || ch === "/" ||
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
    let quoted: `"` | "`" | undefined;
    let quoteStart = -1;
    let expectAttributeValue = false;
    let unquotedAttributeValue = false;

    while (cursor < this.source.length) {
      const ch = this.source[cursor];
      const next = this.source[cursor + 1];

      if (quoted !== undefined) {
        if (ch === "\\") {
          if (cursor + 1 >= this.source.length || next === "\n" || next === "\r") {
            this.fail(
              quoted === `"`
                ? `[invalid-json-escape] invalid escape termination in quoted HSON string`
                : `[invalid-name-escape] invalid escape termination in backtick HSON name`,
              this.positionAt(cursor),
            );
          }
          cursor += 2;
          continue;
        }
        if (ch === quoted) {
          quoted = undefined;
          quoteStart = -1;
        }
        cursor += 1;
        continue;
      }

      // Element attributes retain the existing permissive unquoted value
      // grammar, including literal slash runs such as `href=foo//bar`. A
      // `//` inside that lexical value is not comment trivia.
      if (unquotedAttributeValue) {
        if (ch === "/" && next === ">") {
          unquotedAttributeValue = false;
        } else if (/\s/.test(ch) || ch === "<" || ch === ">" || ch === "[" || ch === "]" || ch === "«" || ch === "»") {
          unquotedAttributeValue = false;
        } else {
          cursor += 1;
          continue;
        }
      }

      if (expectAttributeValue) {
        if (/\s/.test(ch)) {
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
        if (ch !== `"` && ch !== "`" && ch !== "<" && ch !== ">") {
          expectAttributeValue = false;
          unquotedAttributeValue = true;
          cursor += 1;
          continue;
        }
        expectAttributeValue = false;
      }

      if (ch === `"` || ch === "`") {
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

    if (quoted === `"`) this.fail(`unterminated quoted string`, this.positionAt(quoteStart));
    if (quoted === "`") this.fail(`unterminated quoted tag name`, this.positionAt(quoteStart));
    this.fail(`unterminated angle construct`, openPos);
  }

  private skipTrivia(): boolean {
    const start = this.index;
    while (true) {
      while (!this.atEnd() && /\s/.test(this.peek())) this.consume();
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
      if (/\s/.test(ch)) {
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

  private fail(message: string, pos = this.position()): never {
    _throw_transform_err(
      `${message} at ${pos.line}:${pos.col} (index ${pos.index})`,
      "tokenize-hson",
    );
  }
}

function isPrimitiveLiteral(raw: string): boolean {
  return raw === "true" || raw === "false" || raw === "null" || NUMBER_LITERAL.test(raw);
}
