/// <reference path="../../types/css-tree-browser.d.ts" />
import { generate, parse, tokenize, tokenTypes } from "css-tree/dist/csstree.esm";
import type { Atrule, Block, CssNode, Declaration, Rule, StyleSheet } from "css-tree";
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet, render_portable_document_stylesheet, type PortableDocumentStylesheetRecord } from "./portable-document-stylesheet.js";
import { assert_browser_rawtext_text } from "../browser-realization/browser-realization-plan.js";
import type { KeyframeSelector } from "../../types/keyframes.types.js";
import type { PropertySyntax } from "../../types/at-property.types.js";

export class DocumentStylesheetError extends SyntaxError {
  readonly code: "CSS_SYNTAX" | "CSS_UNSUPPORTED" | "CSS_ADMISSION";
  readonly line: number;
  readonly column: number;
  readonly offset: number;
  readonly construct: string;
  constructor(code: DocumentStylesheetError["code"], message: string, line: number, column: number, source: string, construct: string) {
    super(message);
    this.name = "DocumentStylesheetError";
    this.code = code;
    this.line = line;
    this.column = column;
    this.offset = source.split("\n").slice(0, line - 1).reduce((sum, row) => sum + row.length + 1, 0) + column - 1;
    this.construct = construct;
  }
}

const PROPERTY_SYNTAX: ReadonlySet<string> = new Set<PropertySyntax>([
  "<number>", "<length>", "<angle>", "<time>", "<percentage>", "<color>",
  "<length-percentage>", "<angle-percentage>", "<number-percentage>", "<ident>", "*",
]);
function is_property_syntax(value: string): value is PropertySyntax { return PROPERTY_SYNTAX.has(value); }
function is_custom_property(value: string): value is `--${string}` { return value.startsWith("--") && value.length > 2; }
function is_keyframe_selector(value: string): value is KeyframeSelector {
  return value === "from" || value === "to" || /^(?:100|\d{1,2})(?:\.\d+)?%$/.test(value);
}
function is_stylesheet(value: CssNode): value is StyleSheet { return value.type === "StyleSheet"; }
function is_rule(value: CssNode): value is Rule { return value.type === "Rule"; }
function is_at_rule(value: CssNode): value is Atrule { return value.type === "Atrule"; }
function is_declaration(value: CssNode): value is Declaration { return value.type === "Declaration"; }

/** Parse complete authored CSS into the existing portable stylesheet vocabulary. */
export function parse_document_stylesheet(source: string, existingRuleKeys: readonly string[]): PortableDocumentStylesheetRecord {
  if (typeof source !== "string") throw new TypeError("CSS stylesheet source must be a string.");
  const fail = (code: DocumentStylesheetError["code"], message: string, node: CssNode | undefined, construct: string): never => {
    const position = node?.loc?.start;
    throw new DocumentStylesheetError(code, message, position?.line ?? 1, position?.column ?? 1, source, construct);
  };
  const withoutComments = (value: string): string => {
    let result = "";
    let after = 0;
    tokenize(value, (type, start, end) => {
      if (type !== tokenTypes.Comment) return;
      result += value.slice(after, start) + " ";
      after = end;
    });
    return (result + value.slice(after)).trim();
  };
  const text = (node: CssNode | null | undefined): string => node === null || node === undefined
    ? "" : withoutComments(generate(node));
  const parseErrors: { message: string; line: number; column: number }[] = [];
  const lineColumn = (offset: number): Readonly<{ line: number; column: number }> => {
    const rows = source.slice(0, offset).split("\n");
    return { line: rows.length, column: (rows[rows.length - 1]?.length ?? 0) + 1 };
  };
  const balance: { closing: number; offset: number }[] = [];
  let tokenFailure: Readonly<{ message: string; offset: number }> | undefined;
  tokenize(source, (type, start, end) => {
    if (tokenFailure) return;
    if (type === tokenTypes.BadString || type === tokenTypes.BadUrl
      || type === tokenTypes.Comment && !source.slice(start, end).endsWith("*/")) {
      tokenFailure = { message: "Unterminated CSS string, URL, or comment.", offset: start };
      return;
    }
    const closing = type === tokenTypes.LeftCurlyBracket ? tokenTypes.RightCurlyBracket
      : type === tokenTypes.LeftParenthesis || type === tokenTypes.Function ? tokenTypes.RightParenthesis
      : type === tokenTypes.LeftSquareBracket ? tokenTypes.RightSquareBracket : undefined;
    if (closing !== undefined) { balance.push({ closing, offset: start }); return; }
    if (type === tokenTypes.RightCurlyBracket || type === tokenTypes.RightParenthesis || type === tokenTypes.RightSquareBracket) {
      const open = balance.pop();
      if (open?.closing !== type) tokenFailure = { message: "Unmatched CSS closing delimiter.", offset: start };
    }
  });
  const unclosed = balance[balance.length - 1];
  if (tokenFailure || unclosed) {
    const problem = tokenFailure ?? { message: "Unclosed CSS block or function.", offset: unclosed!.offset };
    const position = lineColumn(problem.offset);
    throw new DocumentStylesheetError("CSS_SYNTAX", problem.message, position.line, position.column, source, "stylesheet");
  }
  let parsed: CssNode;
  try {
    parsed = parse(source, { positions: true, context: "stylesheet", onParseError: (error) => {
      parseErrors.push({ message: error.message, ...lineColumn(error.offset) });
    } });
  } catch (error) {
    const item = error instanceof Error ? error : new Error(String(error));
    const line = "line" in item && typeof item.line === "number" ? item.line : 1;
    const column = "column" in item && typeof item.column === "number" ? item.column : 1;
    throw new DocumentStylesheetError("CSS_SYNTAX", item.message, line, column, source, "stylesheet");
  }
  const syntaxError = parseErrors[0];
  if (syntaxError) throw new DocumentStylesheetError("CSS_SYNTAX", syntaxError.message,
    syntaxError.line, syntaxError.column, source, "stylesheet");
  const root = is_stylesheet(parsed) ? parsed : fail("CSS_SYNTAX", "Expected a complete CSS stylesheet.", parsed, "stylesheet");
  const rules: PortableDocumentStylesheetRecord["rules"][number][] = [];
  const properties: PortableDocumentStylesheetRecord["properties"][number][] = [];
  const keyframes: PortableDocumentStylesheetRecord["keyframes"][number][] = [];
  const order: PortableDocumentStylesheetRecord["order"][number][] = [];
  let number = 0;
  const usedRuleKeys = new Set(existingRuleKeys);
  const declarations = (block: Block, context: string, allowImportant = true): (readonly [string, string])[] => {
    const result: (readonly [string, string])[] = [];
    const seen = new Set<string>();
    block.children.forEach((child) => {
      const declaration = is_declaration(child) ? child : fail("CSS_UNSUPPORTED", `Nested ${child.type} is unsupported inside ${context}.`, child, child.type);
      const property = declaration.property.trim();
      if (!allowImportant && declaration.important) fail("CSS_ADMISSION", `!important is invalid in ${context}.`, child, property);
      const value = text(declaration.value) + (declaration.important ? " !important" : "");
      if (!property || !value) fail("CSS_SYNTAX", `Invalid declaration in ${context}.`, child, property);
      if (seen.has(property)) fail("CSS_UNSUPPORTED", `Duplicate declaration ${property} cannot be represented in ${context}.`, child, property);
      seen.add(property);
      result.push([property, value]);
    });
    return result;
  };
  const visit = (block: Block | StyleSheet, scopes: readonly string[]): void => {
    block.children.forEach((node) => {
      if (is_rule(node)) {
        const selector = text(node.prelude);
        if (!selector) fail("CSS_SYNTAX", "CSS selector is empty.", node, "selector");
        const pairs = declarations(node.block, `selector ${selector}`);
        if (pairs.length === 0) return;
        let ruleKey: string;
        do { ruleKey = `stylesheet:${++number}`; } while (usedRuleKeys.has(ruleKey));
        usedRuleKeys.add(ruleKey);
        rules.push({ ruleKey, selector, scopes: [...scopes], declarations: pairs });
        order.push({ kind: "rule", ruleKey, scopes: [...scopes] });
        return;
      }
      const at = is_at_rule(node) ? node : fail("CSS_SYNTAX", `Unexpected ${node.type} at stylesheet level.`, node, node.type);
      const name = at.name.toLowerCase();
      const params = text(at.prelude);
      if (name === "media" || name === "supports" || name === "layer" || name === "container" || name === "scope" || name === "starting-style") {
        const scopeBlock = at.block ?? fail("CSS_UNSUPPORTED", `@${name} statement cannot be represented.`, node, `@${name}`);
        if (!params && name !== "layer" && name !== "starting-style") fail("CSS_SYNTAX", `@${name} requires a condition or name.`, node, `@${name}`);
        const before = order.length;
        visit(scopeBlock, [...scopes, `@${name}${params ? ` ${params}` : ""}`]);
        if (name === "layer" && order.length === before) fail("CSS_UNSUPPORTED", "Empty @layer affects layer order and cannot be represented.", node, "@layer");
        return;
      }
      if (name === "property") {
        if (scopes.length) fail("CSS_UNSUPPORTED", "Scoped @property is not represented.", node, "@property");
        const propertyBlock = at.block ?? fail("CSS_SYNTAX", "@property requires a block.", node, "@property");
        const fields = new Map(declarations(propertyBlock, "@property", false));
        if (fields.size !== 3 && fields.size !== 2) fail("CSS_ADMISSION", "@property requires syntax, inherits, and optional initial-value.", node, "@property");
        if ([...fields.keys()].some((key) => !["syntax", "inherits", "initial-value"].includes(key))) fail("CSS_UNSUPPORTED", "Unsupported @property descriptor.", node, "@property");
        const spelling = fields.get("syntax") ?? "";
        if (!/^(["']).*\1$/.test(spelling)) fail("CSS_ADMISSION", "@property syntax must be a quoted string.", node, "@property");
        const syn = spelling.slice(1, -1);
        const checkedSyntax = is_property_syntax(syn) ? syn : fail("CSS_ADMISSION", "Unsupported @property syntax.", node, "@property");
        const inh = fields.get("inherits");
        if (inh !== "true" && inh !== "false") fail("CSS_ADMISSION", "Invalid @property inheritance.", node, "@property");
        const checkedName = is_custom_property(params) ? params : fail("CSS_ADMISSION", "Invalid @property name.", node, "@property");
        const init = fields.get("initial-value");
        if (syn !== "*" && !init) fail("CSS_ADMISSION", "@property initial-value is required for this syntax.", node, "@property");
        properties.push({ name: checkedName, syn: checkedSyntax, inh: inh === "true", ...(init === undefined ? {} : { init }) });
        order.push({ kind: "property", name: checkedName });
        return;
      }
      if (name === "keyframes") {
        if (scopes.length) fail("CSS_UNSUPPORTED", "Scoped @keyframes is not represented.", node, "@keyframes");
        const keyframesBlock = at.block ?? fail("CSS_SYNTAX", "@keyframes requires a block.", node, "@keyframes");
        const steps: { at: KeyframeSelector; declarations: readonly (readonly [string, string])[] }[] = [];
        keyframesBlock.children.forEach((child) => {
          const step = is_rule(child) ? child : fail("CSS_UNSUPPORTED", "Only keyframe steps are supported inside @keyframes.", child, "@keyframes");
          const selector = text(step.prelude);
          const checkedSelector = is_keyframe_selector(selector) ? selector : fail("CSS_UNSUPPORTED", `Keyframe selector ${selector} cannot be represented.`, child, selector);
          steps.push({ at: checkedSelector, declarations: declarations(step.block, `keyframe ${selector}`) });
        });
        if (!params || steps.length === 0) fail("CSS_ADMISSION", "@keyframes requires a name and steps.", node, "@keyframes");
        keyframes.push({ name: params, steps });
        order.push({ kind: "keyframes", name: params });
        return;
      }
      fail("CSS_UNSUPPORTED", `Unsupported CSS at-rule @${at.name}.`, node, `@${at.name}`);
    });
  };
  visit(root, []);
  try {
    const canonical = decode_portable_document_stylesheet({ rules, properties, keyframes, order });
    assert_browser_rawtext_text(render_portable_document_stylesheet(canonical), "style", "stylesheet");
    return encode_portable_document_stylesheet(canonical);
  }
  catch (error) {
    throw new DocumentStylesheetError("CSS_ADMISSION", error instanceof Error ? error.message : String(error), 1, 1, source, "stylesheet");
  }
}
