/// <reference path="../../types/css-tree-browser.d.ts" />
import { ident, lexer, parse, tokenize, tokenTypes, walk } from "css-tree/dist/csstree.esm";
import type { CssNode, Declaration } from "css-tree";
import { kebab_to_camel } from "../../api/transform/utils/primitive-utils/kebab-to-camel.util.js";
import { inline_css_native_name } from "../../api/transform/utils/attrs-utils/serialize-style.js";

/** A whole-input admission failure, never a browser recovery instruction. */
export class InlineCssError extends SyntaxError {
  readonly code: "INLINE_CSS_SYNTAX" | "INLINE_CSS_UNSUPPORTED";
  readonly offset: number;
  constructor(code: InlineCssError["code"], message: string, offset = 0) {
    super(message);
    this.name = "InlineCssError";
    this.code = code;
    this.offset = offset;
  }
}

type InlineDeclaration = Readonly<{ property: string; key: string; value: string; important: boolean; offset: number }>;
const syntax = (message: string, offset = 0): never => { throw new InlineCssError("INLINE_CSS_SYNTAX", message, offset); };
const unsupported = (message: string, offset = 0): never => { throw new InlineCssError("INLINE_CSS_UNSUPPORTED", message, offset); };

/** The existing projection uses JS trim. Refuse to feed it a value when that
 * would remove any CSS token content, at either boundary. */
export function assert_inline_css_trim_safe(raw: string, offset = 0): void {
  const leading = raw.length - raw.trimStart().length;
  const trailing = raw.trimEnd().length;
  // A prefix prevents the tokenizer treating a value-leading BOM as a
  // stylesheet-leading BOM. Here it is declaration content, not source trivia.
  tokenize(`:${raw}`, (type, from, to) => {
    if (from === 0) return;
    const start = from - 1, end = to - 1;
    if (type !== tokenTypes.WhiteSpace && type !== tokenTypes.Comment
      && (start < leading || end > trailing)) unsupported("Significant CSS boundary content would be lost during projection.", offset + start);
  });
}

/** Only these distinct physical longhands are proven to commute here. Other
 * names remain usable, but admission may not move them past another property. */
const COMMUTING_LONGHANDS = new Set([
  "color", "background-color", "display", "opacity", "width", "height",
  "position", "z-index", "top", "right", "bottom", "left",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "content", "font-size", "font-weight", "line-height", "transform",
]);
// These have no shorthand or logical/physical alias in this supported domain.
const UNGROUPED_LONGHANDS = new Set(["color", "content", "display", "opacity", "position", "z-index"]);
const VENDOR_USER_SELECT = new Set(["-webkit-user-select", "-moz-user-select", "-ms-user-select", "-o-user-select"]);
function commute(a: string, b: string): boolean {
  if (a === "all" || b === "all") return false;
  return a.startsWith("--") || b.startsWith("--")
    || VENDOR_USER_SELECT.has(a) && COMMUTING_LONGHANDS.has(b) || VENDOR_USER_SELECT.has(b) && COMMUTING_LONGHANDS.has(a)
    || !a.startsWith("-") && !b.startsWith("-") && (UNGROUPED_LONGHANDS.has(a) || UNGROUPED_LONGHANDS.has(b))
    || COMMUTING_LONGHANDS.has(a) && COMMUTING_LONGHANDS.has(b);
}

/** Collapsing a fallback needs more than grammar recognition: a later valid
 * specification value may still be unsupported by the receiving browser. */
function collapse_safe_literal(property: string, value: string): boolean {
  const text = value.toLowerCase();
  if (/^(?:initial|inherit|unset|revert|revert-layer)$/.test(text)) return true;
  if (/^(?:color|background-color|(?:border-(?:top|right|bottom|left)-color))$/.test(property)) {
    return /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|black|white|red|green|blue|yellow|gray|grey|orange|purple|pink|transparent|currentcolor)$/.test(text);
  }
  if (property === "display") return /^(?:none|block|inline|inline-block|flex|inline-flex|grid|inline-grid|table|table-row|table-cell|list-item)$/.test(text);
  if (property === "opacity") return /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+))%?$/.test(text);
  if (/^(?:width|height|(?:min|max)-(?:width|height)|(?:margin|padding)(?:-(?:top|right|bottom|left))?)$/.test(property)) {
    return text.split(/\s+/).every(part => /^(?:auto|none|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|em|rem|ex|ch|cm|mm|in|pt|pc|vw|vh|vmin|vmax|%)?)$/.test(part)
      && (property.startsWith("margin") || !part.startsWith("-")));
  }
  return false;
}

function check_tokens(source: string): void {
  const stack: { closing: number; variable: boolean; argument: number }[] = [];
  tokenize(source, (type, start, end) => {
    const text = source.slice(start, end);
    let finalSlashes = 0;
    for (let i = text.length - 1; i >= 0 && text[i] === "\\"; i--) finalSlashes++;
    if (finalSlashes % 2) syntax("Unterminated CSS escape.", start);
    const parent = stack.at(-1);
    if (parent?.variable && parent.argument < 2 && type !== tokenTypes.WhiteSpace && type !== tokenTypes.Comment) {
      if (parent.argument === 0) {
        if (type !== tokenTypes.Ident || !ident.decode(text).startsWith("--") || ident.decode(text).length < 3) syntax("Invalid var() property reference.", start);
        parent.argument = 1;
      } else if (type !== tokenTypes.RightParenthesis) {
        if (type !== tokenTypes.Comma) syntax("Invalid var() argument separator.", start);
        parent.argument = 2;
      }
    }
    if (type === tokenTypes.BadString || type === tokenTypes.BadUrl
      || type === tokenTypes.Comment && !text.endsWith("*/")) syntax("Malformed CSS token.", start);
    if (type === tokenTypes.String) {
      let slashes = 0;
      for (let i = text.length - 2; i >= 0 && text[i] === "\\"; i--) slashes++;
      if (text.length < 2 || text.at(-1) !== text[0] || slashes % 2) syntax("Unterminated CSS string.", start);
    }
    if (type === tokenTypes.Url) {
      let slashes = 0;
      for (let i = text.length - 2; i >= 0 && text[i] === "\\"; i--) slashes++;
      if (!text.endsWith(")") || slashes % 2) syntax("Unterminated CSS URL.", start);
    }
    if (type === tokenTypes.Delim && text === "\\") syntax("Invalid CSS escape.", start);
    const closing = type === tokenTypes.Function || type === tokenTypes.LeftParenthesis ? tokenTypes.RightParenthesis
      : type === tokenTypes.LeftSquareBracket ? tokenTypes.RightSquareBracket
      : type === tokenTypes.LeftCurlyBracket ? tokenTypes.RightCurlyBracket : undefined;
    if (closing !== undefined) stack.push({ closing, variable: type === tokenTypes.Function && ident.decode(text.slice(0, -1)).toLowerCase() === "var", argument: 0 });
    else if (type === tokenTypes.RightParenthesis || type === tokenTypes.RightSquareBracket || type === tokenTypes.RightCurlyBracket) {
      if (stack.pop()?.closing !== type) syntax("Unmatched CSS delimiter.", start);
    }
  });
  if (stack.length) syntax("Unclosed CSS delimiter.", source.length);
}

type MathKind = "number" | "length" | "percentage" | "length-percentage" | "time" | "angle";
type MathValue = Readonly<{ kind: MathKind; number?: number }>;
const LENGTH_UNITS = new Set("px em rem ex rex ch rch cap rcap ic ric lh rlh cm mm q in pt pc vw vh vi vb vmin vmax svw svh svi svb svmin svmax lvw lvh lvi lvb lvmin lvmax dvw dvh dvi dvb dvmin dvmax cqw cqh cqi cqb cqmin cqmax".split(" "));
// CSS Values math families outside the existing proof domain. The lexer's
// var() exemption must not turn unsupported functions into supported math.
const UNPROVEN_MATH_FUNCTIONS = new Set([
  "min", "max", "clamp", "round", "mod", "rem",
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "pow", "sqrt", "hypot", "log", "exp", "abs", "sign",
  "calc-size", "random", "progress", "media-progress", "container-progress",
]);
const CALC_FUNCTIONS = new Set(["calc", "-webkit-calc", "-moz-calc"]);
function math_domain(property: string): readonly MathKind[] | undefined {
  if (/^(?:(?:min-|max-)?(?:width|height)|(?:margin|padding)(?:-(?:top|right|bottom|left))?|top|right|bottom|left|inset(?:-(?:block|inline)(?:-(?:start|end))?)?|font-size|text-indent|flex-basis|(?:row-|column-)?gap)$/.test(property)) return ["length", "percentage", "length-percentage"];
  if (property === "line-height") return ["number", "length", "percentage", "length-percentage"];
  if (property === "opacity") return ["number", "percentage"];
  if (/^(?:z-index|order|flex-grow|flex-shrink|font-weight)$/.test(property)) return ["number"];
  if (/^(?:animation|transition)-(?:delay|duration)$/.test(property)) return ["time"];
  return undefined;
}

/** A bounded numeric type check, independent of native DOM availability.
 * Runtime variables cannot supply a proven arithmetic type. Products require
 * a concrete numeric factor; ordinary non-arithmetic var() remains separate. */
function check_math(source: string, node: CssNode, property: string): void {
  const expression = (items: readonly CssNode[], offset: number): MathValue => {
    let cursor = 0;
    const atom = (): MathValue => {
      const item = items[cursor++];
      if (!item) return syntax("Incomplete calc() expression.", offset);
      if (item.type === "Parentheses") return expression(item.children.toArray(), item.loc?.start.offset ?? offset);
      if (item.type === "Function") {
        const name = ident.decode(item.name).toLowerCase();
        if (name === "calc") return expression(item.children.toArray(), item.loc?.start.offset ?? offset);
        if (name === "var") return unsupported("var() arithmetic has no statically proven dimensional type, including its fallback.", item.loc?.start.offset);
        return unsupported("Unsupported function inside calc().", item.loc?.start.offset);
      }
      if (item.type === "Number" || item.type === "Dimension" || item.type === "Percentage") {
        const value = Number(item.value);
        if (!Number.isFinite(value)) return unsupported("Nonfinite calc() operand.", item.loc?.start.offset);
        if (item.type === "Number") return { kind: "number", number: value };
        if (item.type === "Percentage") return { kind: "percentage" };
        const unit = ident.decode(item.unit).toLowerCase();
        if (LENGTH_UNITS.has(unit)) return { kind: "length" };
        if (unit === "s" || unit === "ms") return { kind: "time" };
        if (/^(?:deg|rad|grad|turn)$/.test(unit)) return { kind: "angle" };
        return unsupported("Unsupported calc() dimension.", item.loc?.start.offset);
      }
      if (item.type === "Identifier") {
        const name = ident.decode(item.name).toLowerCase();
        if (name === "e" || name === "pi") return { kind: "number", number: name === "e" ? Math.E : Math.PI };
        if (/^(?:infinity|-infinity|nan)$/.test(name)) return unsupported("Nonfinite calc() constant is outside the supported domain.", item.loc?.start.offset);
      }
      return syntax("Invalid calc() operand.", item.loc?.start.offset);
    };
    const numeric = (a: MathValue, b: MathValue, operator: string, kind: MathKind): MathValue => {
      if (kind !== "number" || a.number === undefined || b.number === undefined) return { kind };
      const number = operator === "+" ? a.number + b.number : operator === "-" ? a.number - b.number : operator === "*" ? a.number * b.number : a.number / b.number;
      if (!Number.isFinite(number)) return unsupported("Nonfinite calc() result.", offset);
      return { kind, number };
    };
    const product = (): MathValue => {
      let result = atom();
      while (items[cursor]?.type === "Operator") {
        const item = items[cursor];
        if (item.type !== "Operator") break;
        const operator = item.value.trim();
        if (operator !== "*" && operator !== "/") break;
        cursor++;
        const right = atom();
        if (operator === "/") {
          if (right.kind !== "number" || right.number === undefined || right.number === 0) return unsupported("calc() division requires a proven nonzero numeric divisor.", item.loc?.start.offset);
          result = numeric(result, right, operator, result.kind);
        } else {
          if (!(result.kind === "number" && result.number !== undefined) && !(right.kind === "number" && right.number !== undefined)) return unsupported("calc() multiplication requires a proven numeric factor.", item.loc?.start.offset);
          result = numeric(result, right, operator, result.kind === "number" ? right.kind : result.kind);
        }
      }
      return result;
    };
    let result = product();
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item.type !== "Operator" || !/^[+-]$/.test(item.value.trim())) return syntax("Invalid calc() operator.", item.loc?.start.offset);
      const loc = item.loc;
      if (!loc || !/[\t\n\f\r ]/.test(source[loc.start.offset - 1] ?? "") || !/[\t\n\f\r ]/.test(source[loc.end.offset] ?? "")) return syntax("calc() addition and subtraction require whitespace.", loc?.start.offset);
      const right = product();
      let kind: MathKind;
      if (result.kind === right.kind) kind = result.kind;
      else if ([result.kind, right.kind].every(k => k === "length" || k === "percentage" || k === "length-percentage")) kind = "length-percentage";
      else return unsupported("Incompatible calc() addition dimensions.", loc.start.offset);
      result = numeric(result, right, item.value.trim(), kind);
    }
    return result;
  };
  walk(node, item => {
    if (item.type !== "Function") return;
    const name = ident.decode(item.name).toLowerCase();
    if (UNPROVEN_MATH_FUNCTIONS.has(name)) unsupported(`Unsupported inline math function ${name}() has no dimensional proof.`, item.loc?.start.offset);
    // var() fallback children are Raw, so the ordinary AST walk cannot see
    // nested arithmetic there. Parse in the same CSS value context, preserving
    // offsets, quoting and escapes. This does not infer a variable's type.
    if (name === "var") {
      item.children.forEach(child => {
        if (child.type !== "Raw") return;
        // Leave ordinary component-value fallbacks in their established domain.
        // Function tokens distinguish math from strings, comments and URLs.
        let containsMath = false;
        tokenize(child.value, (type, start, end) => {
          if (type !== tokenTypes.Function) return;
          const functionName = ident.decode(child.value.slice(start, end - 1)).toLowerCase();
          if (CALC_FUNCTIONS.has(functionName) || UNPROVEN_MATH_FUNCTIONS.has(functionName)) containsMath = true;
        });
        if (!containsMath) return;
        const fallback = parse(child.value, { context: "value", positions: true,
          offset: child.loc?.start.offset ?? 0,
          onParseError: error => syntax(error.message, error.offset) });
        check_math(source, fallback, property);
      });
      return;
    }
    if (!CALC_FUNCTIONS.has(name)) return;
    const domain = math_domain(property) ?? unsupported("calc() is not supported for this inline property.", item.loc?.start.offset);
    const result = expression(item.children.toArray(), item.loc?.start.offset ?? 0);
    if (!domain.includes(result.kind)) unsupported("calc() result is not admissible for this property.", item.loc?.start.offset);
    // Nested arithmetic is checked in its enclosing expression, not against
    // the property's result domain (a numeric denominator is lawful).
    return walk.skip;
  });
}

function declaration(source: string, node: Declaration): InlineDeclaration {
  const offset = node.loc?.start.offset ?? 0;
  const decoded = ident.decode(node.property);
  const property = decoded.startsWith("--") ? decoded : decoded.toLowerCase();
  // Escapes may decode to names the existing CSS projection cannot emit.
  if (!/^(?:--[A-Za-z0-9_\u0080-\uffff-]+|-?[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff-]*)$/.test(property)) {
    unsupported("CSS property cannot be represented by the inline style projection.", offset);
  }
  const key = property.startsWith("-") ? property : kebab_to_camel(property);
  if (!property.startsWith("--") && inline_css_native_name(key) !== property) unsupported("CSS property name would change during projection.", offset);
  const loc = node.value.loc;
  if (!loc) return syntax("Missing CSS declaration value.", offset);
  const raw = source.slice(loc.start.offset, loc.end.offset);
  assert_inline_css_trim_safe(raw, loc.start.offset);
  const value = raw.trim();
  if (!value) unsupported("Empty CSS values cannot be realized by the flat style projection.", offset);
  if (typeof node.important === "string" && ident.decode(node.important).toLowerCase() !== "important") syntax("Invalid CSS priority.", offset);
  // This proof/rejection precedes the lexer's broad var() matching exemption.
  if (!property.startsWith("--")) check_math(source, node.value, property);
  if (!property.startsWith("--") && lexer.getProperty(property)) {
    if (/^(?:(?:min-|max-)?(?:width|height)|padding(?:-(?:top|right|bottom|left))?|border(?:-(?:top|right|bottom|left))?-width|font-size|line-height|(?:row-|column-)?gap|flex-grow|flex-shrink)$/.test(property)
      && node.value.type === "Value") {
      node.value.children.forEach(item => {
        if ((item.type === "Number" || item.type === "Dimension" || item.type === "Percentage") && Number(item.value) < 0) unsupported(`Negative literal is invalid for ${property}.`, item.loc?.start.offset);
      });
    }
    const result = lexer.matchDeclaration({ ...node, property });
    if (result.error && !result.error.message.includes("Matching for a tree with var() is not supported")) {
      unsupported(`Unsupported or invalid value for ${property}.`, offset);
    }
  }
  return { property, key, value, important: Boolean(node.important), offset };
}

function declarations(source: string): InlineDeclaration[] {
  if (source.startsWith("\ufeff")) unsupported("A declaration-list BOM cannot be discarded as stylesheet source trivia.");
  check_tokens(source);
  let ast;
  try {
    ast = parse(source, { context: "declarationList", positions: true,
      onParseError: error => syntax(error.message, error.offset) });
  } catch (error) {
    if (error instanceof InlineCssError) throw error;
    return syntax(error instanceof Error ? error.message : "Invalid CSS declaration list.");
  }
  if (ast.type !== "DeclarationList") return syntax("Expected a CSS declaration list.");
  const result: InlineDeclaration[] = [];
  ast.children.forEach(node => {
    if (node.type !== "Declaration") syntax("Only inline declarations are supported.", node.loc?.start.offset);
    else result.push(declaration(source, node));
  });
  return result;
}

/** Admit CSS text only when the flat, canonically sorted map can reproduce it. */
export function parse_inline_css(source: string): Record<string, string> {
  const items = declarations(source);
  assert_inline_css_order(items.map(item => item.property));
  const winners = new Map<string, InlineDeclaration>();
  for (const item of items) {
    const previous = winners.get(item.key);
    if (previous && previous.value !== item.value && !item.property.startsWith("--")
      && (!collapse_safe_literal(item.property, previous.value) || !collapse_safe_literal(item.property, item.value))) {
      unsupported("Fallback declarations cannot be collapsed faithfully.", item.offset);
    }
    if (!previous || !previous.important || item.important) winners.set(item.key, item);
  }
  const result: Record<string, string> = {};
  for (const [key, item] of winners) Object.defineProperty(result, key, {
    value: item.value + (item.important ? " !important" : ""), enumerable: true, configurable: true, writable: true,
  });
  return result;
}

/** Also used before a public inline mutation, without coercing retained leaves. */
export function assert_inline_css_order(properties: readonly string[]): void {
  for (let i = 0; i < properties.length; i++) for (let j = i + 1; j < properties.length; j++) {
    const a = properties[i], b = properties[j];
    if (a > b && !commute(a, b)) unsupported("Declaration order cannot be preserved by the flat inline style map.");
  }
}

/** A setter supplies one value, never an additional declaration list. */
export function assert_inline_css_value(property: string, value: string): void {
  let depth = 0;
  tokenize(value, (type, start) => {
    if (type === tokenTypes.Function || type === tokenTypes.LeftParenthesis || type === tokenTypes.LeftSquareBracket || type === tokenTypes.LeftCurlyBracket) depth++;
    else if (type === tokenTypes.RightParenthesis || type === tokenTypes.RightSquareBracket || type === tokenTypes.RightCurlyBracket) depth--;
    else if (type === tokenTypes.Semicolon && depth === 0) syntax("A style setter requires one declaration value.", start);
  });
  const items = declarations(`${property}:${value}`);
  if (items.length !== 1 || items[0].property !== property) syntax("A style setter requires one declaration.");
}
