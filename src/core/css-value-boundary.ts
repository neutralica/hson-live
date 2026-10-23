const css_space = (char: string | undefined): boolean => char !== undefined && /[ \t\r\n\f]/.test(char);

/** Remove only boundary CSS whitespace, preserving escape terminators, strings and comments.
 * Kept parser-free because canonical inline data also serves lightweight endpoints.
 */
export function trim_css_value_boundary(source: string): string {
  let start = 0, end = 0, cursor = 0;
  while (css_space(source[start])) start++;
  cursor = start;
  const escape = (): void => {
    cursor++; // backslash
    if (/[0-9a-f]/i.test(source[cursor] ?? '')) {
      let digits = 0;
      while (digits++ < 6 && /[0-9a-f]/i.test(source[cursor] ?? '')) cursor++;
      if (source[cursor] === '\r' && source[cursor + 1] === '\n') cursor += 2;
      else if (css_space(source[cursor])) cursor++;
    } else if (cursor < source.length) {
      if (source[cursor] === '\r' && source[cursor + 1] === '\n') cursor++;
      cursor++;
    }
  };
  while (cursor < source.length) {
    const char = source[cursor];
    if (css_space(char)) { cursor++; continue; }
    if (char === '\\') escape();
    else if (char === '"' || char === "'") {
      const quote = char; cursor++;
      while (cursor < source.length) {
        if (source[cursor] === '\\') escape();
        else if (source[cursor++] === quote) break;
      }
    } else if (char === '/' && source[cursor + 1] === '*') {
      const close = source.indexOf('*/', cursor + 2);
      cursor = close < 0 ? source.length : close + 2;
    } else cursor++;
    end = cursor;
  }
  return source.slice(start, end);
}
