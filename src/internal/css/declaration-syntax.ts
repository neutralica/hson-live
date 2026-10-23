import { native_managed_property } from "./managed-css-lexical.js";
import { parse_document_stylesheet } from './parse-document-stylesheet.js';

/** Syntax qualification only; property/value browser support is a separate question. */
export function assert_css_declaration_syntax(property: string, value: string): void {
  const sheet = parse_document_stylesheet(`:scope{${property}:${value}}`, []);
  const rule = sheet.rules[0];
  if (sheet.rules.length !== 1 || sheet.order.length !== 1 || rule?.selector !== ':scope'
    || rule.scopes.length || rule.declarations.length !== 1 || rule.declarations[0]?.[0] !== native_managed_property(property)) {
    throw new TypeError('CSS value must remain inside one declaration.');
  }
}
