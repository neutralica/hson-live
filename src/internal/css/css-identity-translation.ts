/// <reference path="../../types/css-tree-browser.d.ts" />
import { generate, ident, parse, tokenize, tokenTypes, walk } from "css-tree/dist/csstree.esm";
import type { CssNode } from "css-tree";
import { HSON_META_QUID } from "../../core/constants.js";
import { HSON_METADATA_REGISTRY } from "../../core/hson-metadata.js";
import { is_persisted_quid } from "../../core/hson-node-quid.js";
import { is_document_quad_name } from "../document-quad-name.js";
import { managed_css_group_header } from "./managed-css-lexical.js";
import {
  css_array_items,
  decode_portable_document_stylesheet,
  encode_portable_document_stylesheet,
  type PortableDocumentCssEntry,
  type PortableDocumentStylesheetRecord,
} from "./portable-document-stylesheet.js";

/** One Library's caller-validated subjects. This facility grants no identity authority. @internal */
export type CssIdentityCorrespondence = Readonly<{
  associations: readonly Readonly<{ name: string; quid: string; disposition: "authored" | "disposable" }>[];
  /** Check both before consuming correspondence and before returning translated CSS. */
  assertCurrent: () => void;
}>;

/** Provisional CSS-only carrier; no HTML/SSR marker or realization contract. */
const PORTABLE_ATTRIBUTE = "hson:quad";
const RUNTIME_ATTRIBUTE = HSON_METADATA_REGISTRY[HSON_META_QUID].markupName;

/** CSSTree retains a qualified attribute name as raw Identifier spelling.
 * Only a Delim token is a namespace separator; escaped pipes belong to Ident.
 */
function attribute_name(spelling: string): Readonly<{ local: string; namespaced: boolean }> {
  let local = "", namespaced = false;
  tokenize(spelling, (type, start, end) => {
    const token = spelling.slice(start, end);
    if (type === tokenTypes.Delim && token === "|") namespaced = true;
    if (type === tokenTypes.Ident) local = ident.decode(token);
  });
  return { local, namespaced };
}

function own_field(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new TypeError("Invalid CSS identity correspondence.");
  }
  const field = Object.getOwnPropertyDescriptor(input, key);
  if (!field?.enumerable || !Object.hasOwn(field, "value")) throw new TypeError("CSS identity correspondence requires own data fields.");
  return field.value;
}

/**
 * Translate exact identity attribute nodes in existing portable CSS data.
 * Callers select one Library and prove local issuance/admission and disposition;
 * this pure consumer validates vocabulary and bijection, never graph ownership.
 * Opaque selectors/preludes and non-exact identity tests reject conservatively.
 * No runtime, capture, allocation, stylesheet ownership or transport integration.
 * @internal
 */
export function translate_document_css_identities(
  input: PortableDocumentStylesheetRecord,
  direction: "outbound" | "inbound",
  correspondence: CssIdentityCorrespondence,
): PortableDocumentStylesheetRecord {
  if (direction !== "outbound" && direction !== "inbound") throw new TypeError("Invalid CSS identity translation direction.");
  const check = own_field(correspondence, "assertCurrent");
  if (typeof check !== "function") throw new TypeError("CSS identity translation requires a caller fence.");
  check();
  const byName = new Map<string, string>(), byQuid = new Map<string, string>();
  for (const entry of css_array_items(own_field(correspondence, "associations"))) {
    const name = own_field(entry, "name"), quid = own_field(entry, "quid"), disposition = own_field(entry, "disposition");
    if (!is_document_quad_name(name) || !is_persisted_quid(quid)
      || (disposition !== "authored" && disposition !== "disposable")
      || byName.has(name) || byQuid.has(quid)) throw new TypeError("Invalid or ambiguous CSS identity correspondence.");
    if (disposition === "disposable" && (name[0] !== "_" || !is_persisted_quid(name.slice(1))
      || (direction === "outbound" ? name !== `_${quid}` : name.slice(1) === quid))) {
      throw new TypeError("Incoherent disposable CSS identity correspondence.");
    }
    byName.set(name, quid); byQuid.set(quid, name);
  }
  const sourceAttribute = direction === "outbound" ? RUNTIME_ATTRIBUTE : PORTABLE_ATTRIBUTE;
  const targetAttribute = direction === "outbound" ? PORTABLE_ATTRIBUTE : RUNTIME_ATTRIBUTE;
  const mapping = direction === "outbound" ? byQuid : byName;

  const rewrite = (ast: CssNode): boolean => {
    let changed = false;
    walk(ast, { enter(node: CssNode) {
      // Conditions such as @supports declarations and @container style() are
      // ordinary declaration data, including Raw custom-property values.
      if (node.type === "Declaration") return walk.skip;
      if (node.type === "Raw") throw new SyntaxError("Opaque CSS selector or group prelude cannot be identity-translated.");
      if (node.type !== "AttributeSelector") return;
      const name = attribute_name(node.name.name), localName = name.local.toLowerCase();
      if (localName !== RUNTIME_ATTRIBUTE && localName !== PORTABLE_ATTRIBUTE) return;
      if (name.namespaced || name.local !== sourceAttribute || node.matcher !== "=" || node.flags !== null || node.value === null) {
        throw new SyntaxError("Unsupported or mixed CSS identity attribute selector.");
      }
      const value = node.value.type === "String" ? node.value.value : ident.decode(node.value.name);
      const replacement = mapping.get(value);
      if (replacement === undefined) throw new TypeError("Unresolved CSS identity selector reference.");
      node.name.name = ident.encode(targetAttribute);
      node.value = { type: "String", value: replacement };
      changed = true;
    } });
    return changed;
  };
  const selector = (source: string): string => {
    const ast = parse(source, { context: "selectorList", onParseError(error) { throw error; } });
    return rewrite(ast) ? generate(ast) : source;
  };
  const header = (source: string): string => {
    managed_css_group_header(source);
    const ast = parse(`${source}{}`, { context: "stylesheet", onParseError(error) { throw error; } });
    if (ast.type !== "StyleSheet" || ast.children.size !== 1) throw new SyntaxError("Expected one CSS group.");
    const group = ast.children.first;
    if (group?.type !== "Atrule") throw new SyntaxError("Expected a CSS group header.");
    if (!rewrite(ast)) return source;
    return `@${group.name}${group.prelude === null ? "" : ` ${generate(group.prelude)}`}`;
  };
  const canonical = encode_portable_document_stylesheet(decode_portable_document_stylesheet(input));
  const scopes = (items: readonly string[]): string[] => items.map(header);
  const order = (items: readonly PortableDocumentCssEntry[]): PortableDocumentCssEntry[] => items.map(entry => {
    if (entry.kind === "group") return { kind: "group", header: header(entry.header), entries: order(entry.entries) };
    if (entry.kind === "rule") return { ...entry, scopes: scopes(entry.scopes) };
    return { ...entry };
  });
  // Rewrite every duplicated header coordinate with the same deterministic
  // function. Keep opaque rule keys and independent group occurrences intact.
  const result = encode_portable_document_stylesheet(decode_portable_document_stylesheet({
    ...canonical,
    rules: canonical.rules.map(rule => ({ ...rule, selector: selector(rule.selector), scopes: scopes(rule.scopes) })),
    order: order(canonical.order),
  }));
  check();
  return result;
}
