const css_space = (char: string | undefined): boolean => char !== undefined && /[ \t\r\n\f]/.test(char);
const name_char = (char: string | undefined): boolean => char !== undefined && /[a-zA-Z0-9_\u0080-\uffff-]/.test(char);
const hex = (char: string | undefined): boolean => char !== undefined && /[0-9a-fA-F]/.test(char);

/**
 * Hson's declaration-slot language, not a CSS property/value grammar.
 *
 * Only closed strings/comments may contain literal ; { }. Other components
 * have balanced ()/[]; escapes must finish inside the authored text. Function
 * names must be unescaped, and literal url() requires exactly a quoted string
 * (plus CSS whitespace). Thus a browser cannot enter unquoted/bad-URL recovery
 * and reinterpret our strings/comments as structural CSS. Name runs deliberately
 * overapproximate identifiers (including numbers/hash names); no CSS AST or
 * browser support decision is evidence for admission.
 *
 * At EOF there is no lexical state or block left to consume generated text.
 * Escaped punctuation is token content, never a structural delimiter. The scan
 * is linear, nonrecursive, bounded to 4M UTF-16 units and 128 nested components.
 * This operation does not trim, decode, or otherwise rewrite the authored value.
 */
export function assert_css_declaration_syntax(_property: string, value: string): void {
  const fail = (): never => { throw new TypeError('CSS value must remain inside one declaration.'); };
  if (typeof value !== 'string' || value.length > 4_000_000 || /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(value)) fail();
  const closing: string[] = [];
  let cursor = 0;
  const escape = (string: boolean): void => {
    cursor++; // backslash
    if (cursor === value.length) fail();
    const char = value[cursor];
    if (char === '\n' || char === '\r' || char === '\f') {
      if (!string) fail();
      if (char === '\r' && value[cursor + 1] === '\n') cursor++;
      cursor++;
    } else if (hex(char)) {
      let digits = 0;
      while (digits < 6 && hex(value[cursor])) { cursor++; digits++; }
      if (value[cursor] === '\r' && value[cursor + 1] === '\n') cursor += 2;
      else if (css_space(value[cursor])) cursor++;
    } else cursor++;
  };
  const string = (): void => {
    const quote = value[cursor++];
    while (cursor < value.length) {
      const char = value[cursor];
      if (char === quote) { cursor++; return; }
      if (char === '\n' || char === '\r' || char === '\f') fail();
      if (char === '\\') escape(true);
      else cursor++;
    }
    fail();
  };
  while (cursor < value.length) {
    const char = value[cursor];
    if (char === '"' || char === "'") { string(); continue; }
    if (char === '/' && value[cursor + 1] === '*') {
      const end = value.indexOf('*/', cursor + 2);
      if (end < 0) fail();
      cursor = end + 2;
      continue;
    }
    if (char === ';' || char === '{' || char === '}') fail();
    if (name_char(char) || char === '\\') {
      const start = cursor;
      let escaped = false;
      while (name_char(value[cursor]) || value[cursor] === '\\') {
        if (value[cursor] === '\\') { escaped = true; escape(false); }
        else cursor++;
      }
      if (value[cursor] === '(') {
        // Reject the entire escaped function-name class, not selected spellings.
        if (escaped) fail();
        if (value.slice(start, cursor).toLowerCase() === 'url') {
          if (closing.length === 128) fail(); // The quoted URL is itself one component.
          cursor++;
          while (css_space(value[cursor])) cursor++;
          if (value[cursor] !== '"' && value[cursor] !== "'") fail();
          string();
          while (css_space(value[cursor])) cursor++;
          if (value[cursor] !== ')') fail();
          cursor++;
        }
      }
      continue;
    }
    if (char === '(' || char === '[') {
      if (closing.length === 128) fail();
      closing.push(char === '(' ? ')' : ']');
    } else if (char === ')' || char === ']') {
      if (closing.pop() !== char) fail();
    }
    cursor++;
  }
  if (closing.length) fail();
}
