import { parse_complete_css_list } from "./complete-list.js";
/// <reference path="../../types/css-tree-browser.d.ts" />
import { parse, generate, ident, tokenize, tokenTypes, walk } from "css-tree/dist/csstree.esm";
import { mentions_identity_attribute } from "./managed-css-lexical.js";

/** Opaque function contents stay untouched only when no required transform is hidden. */
function assert_opaque_argument(source: string): void {
  let colon = false;
  tokenize(source, (type, start, end) => {
    if (type === tokenTypes.WhiteSpace || type === tokenTypes.Comment) return;
    const token = source.slice(start, end);
    if (type === tokenTypes.Delim && token === "&"
      || colon && (type === tokenTypes.Ident || type === tokenTypes.Function)
      && ident.decode(type === tokenTypes.Function ? token.slice(0, -1) : token).toLowerCase() === "scope") {
      throw new SyntaxError("Opaque CSS argument hides nesting or scope syntax.");
    }
    colon = type === tokenTypes.Colon;
  });
  if (mentions_identity_attribute(source)) throw new SyntaxError("Opaque CSS argument hides a subject identity reference.");
}

/** Style-handle selectors must be complete; :has() may contain relative arms. */
export function parse_style_selector(source: string, allowLeadingCombinator = false) {
  const ast = parse_complete_css_list(source, 'selectorList');
  if (ast.type !== 'SelectorList') throw new SyntaxError('Expected CSS selector list.');
  ast.children.forEach(arm => {
    if (!allowLeadingCombinator && arm.type === 'Selector' && arm.children.first?.type === 'Combinator') {
      throw new SyntaxError('Unanchored CSS combinator.');
    }
  });
  walk(ast, function (node) {
    if (node.type === 'Raw') {
      if (this.function?.type !== 'PseudoClassSelector' && this.function?.type !== 'PseudoElementSelector') {
        throw new SyntaxError('Opaque selector structure cannot be transformed.');
      }
      assert_opaque_argument(node.value);
    }
    if (node.type !== 'Selector') return;
    let combinator = false;
    node.children.forEach(part => {
      if (part.type === 'Combinator' && combinator) throw new SyntaxError('Adjacent CSS combinators.');
      combinator = part.type === 'Combinator';
    });
    if (combinator) throw new SyntaxError('Incomplete CSS selector.');
  });
  return ast;
}

/** Append a recognized pseudo suffix to each arm without changing its specificity. */
export function append_css_pseudo(selector: string, suffix: string): string {
  const ast = parse_style_selector(selector);
  const pseudo = parse(suffix, { context: 'selector' });
  if (pseudo.type !== 'Selector') throw new SyntaxError('Expected CSS selector.');
  ast.children.forEach(arm => {
    if (arm.type !== 'Selector') throw new SyntaxError('Expected CSS selector arm.');
    arm.children.appendList(pseudo.children.copy());
  });
  const composed = generate(ast);
  parse_style_selector(composed);
  return composed;
}

/** Node handles append each arm to one subject, or use the anchored nesting grammar. */
export function scope_css_selector(pattern: string, subject: string): string {
  const ast = parse_style_selector(pattern, true);
  let nesting = false;
  walk(ast, node => { if (node.type === 'NestingSelector') nesting = true; });
  if (nesting) return relative_css_selector(pattern, subject, true);
  const prefix = parse(subject, { context: 'selector' });
  if (prefix.type !== 'Selector') throw new SyntaxError('Expected CSS selector.');
  ast.children.forEach(arm => {
    if (arm.type !== 'Selector') throw new SyntaxError('Expected CSS selector arm.');
    arm.children.prependList(prefix.children.copy());
  });
  const composed = generate(ast);
  parse_style_selector(composed);
  return composed;
}

/** Structured keys have one selector and one leading anchor. Direct handles retain lists. */
export function relative_css_selector(pattern: string, subject: string, direct = false): string {
  const ast = parse_style_selector(pattern);
  let anchors = 0;
  walk(ast, node => { if (node.type === 'NestingSelector') anchors++; });
  if (!direct && (ast.children.size !== 1 || anchors !== 1)) {
    throw new SyntaxError('Structured CSS requires one selector with one leading &.');
  }
  ast.children.forEach(selector => {
    if (selector.type !== 'Selector' || selector.children.first?.type !== 'NestingSelector') throw new SyntaxError('Each CSS selector must start with &.');
  });
  const subjects = parse_style_selector(subject);
  // A direct list receiver keeps CSS nesting's maximum parent specificity.
  const replacementText = subjects.children.size > 1 ? `:is(${subject})` : subject;
  if (pattern.length + anchors * (replacementText.length - 1) > 4_000_000) throw new SyntaxError('CSS selector expansion resource limit exceeded.');
  const replacement = parse(replacementText, { context: 'selector' });
  walk(ast, (node, item, list) => {
    if (node.type !== 'NestingSelector') return;
    if (replacement.type !== 'Selector' || !item || !list) throw new SyntaxError('Invalid CSS subject.');
    list.replace(item, replacement.children.copy());
  });
  const composed = generate(ast);
  parse_style_selector(composed);
  return composed;
}
