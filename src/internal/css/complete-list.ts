/// <reference path="../../types/css-tree-browser.d.ts" />
import { parse, tokenize, tokenTypes } from 'css-tree/dist/csstree.esm';

/** CSSTree accepts a final comma at EOF. Check token-level list boundaries before its AST
 * lowering can erase empty arms. Functions, strings, brackets and escaped commas stay tokens.
 */
export function parse_complete_css_list(source: string, context: 'selectorList' | 'mediaQueryList') {
  if (source.length > 4_000_000) throw new SyntaxError('CSS list resource limit exceeded.');
  const closing: number[] = [];
  let arm = false, arms = 1, count = 0;
  tokenize(source, (type, start, end) => {
    if (++count > 1_000_000 || closing.length > 128) throw new SyntaxError('CSS list resource limit exceeded.');
    if (type === tokenTypes.BadString || type === tokenTypes.BadUrl
      || type === tokenTypes.Comment && !source.slice(start, end).endsWith('*/')) throw new SyntaxError('Invalid CSS list token.');
    if (type === tokenTypes.WhiteSpace || type === tokenTypes.Comment) return;
    if (type === tokenTypes.Comma && !closing.length) {
      if (!arm) throw new SyntaxError('Empty CSS list arm.');
      arm = false; arms++; return;
    }
    arm = true;
    const expected = type === tokenTypes.Function || type === tokenTypes.LeftParenthesis ? tokenTypes.RightParenthesis
      : type === tokenTypes.LeftSquareBracket ? tokenTypes.RightSquareBracket : type === tokenTypes.LeftCurlyBracket ? tokenTypes.RightCurlyBracket : undefined;
    if (expected !== undefined) closing.push(expected);
    else if ([tokenTypes.RightParenthesis, tokenTypes.RightSquareBracket, tokenTypes.RightCurlyBracket].includes(type)
      && closing.pop() !== type) throw new SyntaxError('Unmatched CSS list delimiter.');
  });
  if (!arm || closing.length) throw new SyntaxError('Incomplete CSS list.');
  const ast = parse(source, { context, onParseError(error) { throw error; } });
  if ((ast.type !== 'SelectorList' && ast.type !== 'MediaQueryList') || ast.children.size !== arms) throw new SyntaxError('Incomplete CSS list AST.');
  return ast;
}
