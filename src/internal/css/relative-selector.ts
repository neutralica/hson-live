import { parse_complete_css_list } from "./complete-list.js";
/// <reference path="../../types/css-tree-browser.d.ts" />
import { parse, generate, walk } from "css-tree/dist/csstree.esm";

/** Every list arm must start with its subject; nested functions cannot hide an unanchored arm. */
export function relative_css_selector(pattern: string, subject: string): string {
  const ast = parse_complete_css_list(pattern, 'selectorList');
  if (ast.type !== 'SelectorList' || !ast.children.size) throw new SyntaxError('Expected relative CSS selector list.');
  ast.children.forEach(selector => {
    if (selector.type !== 'Selector' || selector.children.first?.type !== 'NestingSelector') throw new SyntaxError('Each CSS selector must start with &.');
  });
  walk(ast, (node, item, list) => {
    if (node.type === 'Raw') throw new SyntaxError('Opaque CSS selectors are unsupported.');
    if (node.type !== 'NestingSelector') return;
    const subjects = parse(subject, { context: 'selectorList' });
    const replacement = parse(subjects.type === 'SelectorList' && subjects.children.size > 1 ? `:is(${subject})` : subject, { context: 'selector' });
    if (replacement.type !== 'Selector' || !item || !list) throw new SyntaxError('Invalid CSS subject.');
    list.replace(item, replacement.children.copy());
  });
  return generate(ast);
}
