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
import type { ArraySymbol, Position, RawAttr, Tokens } from "../token.types.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";
import { is_persisted_quid } from "../../../core/persisted-quid.js";

const MAX_NESTING = 75;
const NUMBER_LITERAL = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const BARE_NAME_START = /[A-Za-z_:]/;
const BARE_NAME_CHAR = /[A-Za-z0-9:._-]/;

/**
 * Tokenize HSON with one absolute, newline-agnostic source cursor.
 *
 * Physical line boundaries are ordinary whitespace except inside a quoted
 * string and after `//`. Nested tags, arrays, and anonymous objects recurse
 * through this scanner without slicing or rebasing the source.
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

  /** Scan `<tag ...>`, `<>`, or an anonymous object `< <child ...> >`. */
  private scanAngle(depth: number): void {
    this.assertNesting(depth);
    const openPos = this.position();
    this.consumeExpected("<");

    // Preserve the existing token distinction: only the adjacent spelling
    // `<>` is EMPTY_OBJ. A layout-separated `< ... >` is an anonymous object.
    if (this.peek() === ">") {
      this.consumeExpected(">");
      this.tokens.push(CREATE_EMPTY_OBJ_TOKEN("<>", undefined, openPos));
      return;
    }

    this.skipTrivia();
    if (this.atEnd()) this.fail(`unterminated angle construct`, openPos);

    if (this.peek() === "<" || this.peek() === ">") {
      this.scanAnonymousObject(openPos, depth + 1);
      return;
    }

    if (this.startsWith("/>")) {
      this.fail(`missing tag name before "/>"`, openPos);
    }

    const tag = this.peek() === "`"
      ? this.scanQuotedTagName()
      : this.scanBareName("tag name");

    const attrs: RawAttr[] = [];
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

      if (this.peek() === ">") {
        emitOpen();
        const closePos = this.position();
        this.consumeExpected(">");
        this.tokens.push(CREATE_END_TOKEN(CLOSE_KIND.obj, closePos));
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

      if (BARE_NAME_START.test(ch)) {
        const namePos = this.position();
        const name = this.scanBareName("attribute or flag");
        const nameEnd = this.previousPosition();

        if (!contentStarted) {
          this.skipTrivia();

          if (this.peek() === "=") {
            attrs.push(this.scanAttributeValue(name, namePos));
            continue;
          }

          if (!isPrimitiveLiteral(name)) {
            attrs.push({ name, start: namePos, end: nameEnd });
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

      this.fail(`unexpected token "${ch}" in <${tag}> header`);
    }
  }

  /** The first `<` is the object wrapper; the next `<` starts its first child. */
  private scanAnonymousObject(openPos: Position, depth: number): void {
    this.assertNesting(depth);
    this.tokens.push(CREATE_OPEN_TOKEN(OBJ_TAG, [], openPos));

    while (true) {
      this.skipTrivia();
      if (this.atEnd()) this.fail(`unterminated implicit object`, openPos);

      if (this.peek() === ">") {
        const closePos = this.position();
        this.consumeExpected(">");
        this.tokens.push(CREATE_END_TOKEN(CLOSE_KIND.obj, closePos));
        return;
      }

      if (this.startsWith("/>")) {
        this.fail(`implicit objects must close with ">", not "/>"`);
      }

      const ch = this.peek();
      if (ch === "<") {
        this.scanAngle(depth);
      } else if (ch === "«" || ch === "[") {
        this.scanArray(depth);
      } else if (ch === `"`) {
        const pos = this.position();
        this.tokens.push(CREATE_TEXT_TOKEN(this.scanContentString(), true, pos));
      } else if (ch === "'") {
        this.fail(`unsupported quote delimiter (use double quotes only)`);
      } else {
        const pos = this.position();
        const raw = this.scanBareToken();
        if (!isPrimitiveLiteral(raw)) {
          this.fail(`unexpected bare token in implicit object: "${raw}"`, pos);
        }
        this.tokens.push(CREATE_TEXT_TOKEN(raw, undefined, pos));
      }
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

  /** Return a complete JSON-compatible literal, preserving current text semantics. */
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
        this.consumeExpected("\\");
        if (this.atEnd()) this.fail(`unterminated quoted string`, start);

        if (this.isNewline()) {
          raw += "\\\\";
          this.consume();
          raw += "\\n";
        } else {
          raw += "\\" + this.consume();
        }
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
        text += this.consume();
        if (this.atEnd()) this.fail(`unterminated quoted attribute value for "${name}"`, start);
        text += this.consume();
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
        this.consumeExpected("\\");
        if (this.atEnd()) this.fail(`unterminated quoted tag name`, start);
        const escaped = this.consume();
        if (escaped === "n") tag += "\n";
        else if (escaped === "r") tag += "\r";
        else if (escaped === "t") tag += "\t";
        else tag += escaped;
        continue;
      }

      tag += this.consume();
    }

    this.fail(`unterminated quoted tag name`, start);
  }

  private scanBareName(where: string): string {
    const start = this.position();
    const first = this.peek();
    if (!BARE_NAME_START.test(first)) {
      this.fail(`malformed ${where}: expected a bare name or backtick-quoted name`, start);
    }

    let out = this.consume();
    while (!this.atEnd() && BARE_NAME_CHAR.test(this.peek())) out += this.consume();
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

  private skipTrivia(): void {
    while (true) {
      while (!this.atEnd() && /\s/.test(this.peek())) this.consume();
      if (!this.startsWith("//")) return;

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
