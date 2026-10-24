/// <reference path="../../types/css-tree-browser.d.ts" />
import { generate, ident, parse, tokenize, tokenTypes, walk } from "css-tree/dist/csstree.esm";
import type { CssNode, ListItem, List } from "css-tree";
import { HSON_META_QUID } from "../../core/constants.js";
import { HSON_METADATA_REGISTRY } from "../../core/hson-metadata.js";
import { is_persisted_quid } from "../../core/hson-node-quid.js";
import { is_document_quad_name, PORTABLE_DOCUMENT_QUAD_ATTRIBUTE } from "../document-quad-name.js";
import { managed_css_group_header, mentions_identity_attribute } from "./managed-css-lexical.js";
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

/** The SSR carrier and translator share the exact portable attribute spelling. */
const PORTABLE_ATTRIBUTE = PORTABLE_DOCUMENT_QUAD_ATTRIBUTE;
const RUNTIME_ATTRIBUTE = HSON_METADATA_REGISTRY[HSON_META_QUID].markupName;

/** Preserve identity-free future syntax; only attribute names enter exact admission. @internal */
export function document_css_mentions_subject_identity(input: PortableDocumentStylesheetRecord): boolean {
  const mentions = mentions_identity_attribute;
  const groups = (entries: readonly PortableDocumentCssEntry[]): boolean => entries.some(entry =>
    entry.owner !== undefined && mentions(entry.owner) || (entry.kind === "group" ? mentions(entry.header) || groups(entry.entries)
      : entry.kind === "rule" && entry.scopes.some(mentions)));
  return input.rules.some(rule => mentions(rule.selector) || rule.scopes.some(mentions)) || groups(input.order);
}

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

/** Walk the exact Cut 8C selector coordinates once; declarations are never references. */
function visit_document_css_identities(input: PortableDocumentStylesheetRecord,
  visit: (node: Extract<CssNode, { type: "AttributeSelector" }>) => CssNode | void,
  subjectsOnly: boolean): PortableDocumentStylesheetRecord {
  const rewrite = (ast: CssNode): boolean => {
    let changed = false, featureTests = 0;
    walk(ast, { enter(node: CssNode, item: ListItem<CssNode> | null, list: List<CssNode> | null) {
      if (node.type === "Declaration") return walk.skip;
      // @supports selector() asks about syntax, not membership of a subject.
      // Cut 8C's explicit translator retains its original all-reference mode.
      const kind: string = node.type;
      if (kind === "FeatureFunction") featureTests++;
      if (node.type === "Raw" && mentions_identity_attribute(node.value)) {
        throw new SyntaxError("Opaque CSS selector or group prelude cannot be identity-translated.");
      }
      if (node.type !== "AttributeSelector") return;
      const name = attribute_name(node.name.name), localName = name.local.toLowerCase();
      if (localName !== RUNTIME_ATTRIBUTE && localName !== PORTABLE_ATTRIBUTE) return;
      if (subjectsOnly && featureTests) {
        identity_value(node, localName);
        return;
      }
      const replacement = visit(node);
      if (replacement !== undefined) {
        if (!item || !list) throw new Error("CSS subject replacement requires a selector item.");
        list.replace(item, list.createItem(replacement));
      }
      changed = true;
    }, leave(node: CssNode) { const kind: string = node.type; if (kind === "FeatureFunction") featureTests--; } });
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
    const owner = entry.owner === undefined ? {} : { owner: selector(entry.owner) };
    if (entry.kind === "group") return { ...entry, ...owner, header: header(entry.header), entries: order(entry.entries) };
    if (entry.kind === "rule") return { ...entry, ...owner, scopes: scopes(entry.scopes) };
    return { ...entry, ...owner };
  });
  return encode_portable_document_stylesheet(decode_portable_document_stylesheet({ ...canonical,
    rules: canonical.rules.map(rule => ({ ...rule, selector: selector(rule.selector), scopes: scopes(rule.scopes) })),
    order: order(canonical.order),
  }));
}

function identity_value(node: Extract<CssNode, { type: "AttributeSelector" }>, attribute: string): string {
  const name = attribute_name(node.name.name);
  if (name.namespaced || name.local !== attribute || node.matcher !== "=" || node.flags !== null || node.value === null) {
    throw new SyntaxError("Unsupported or mixed CSS identity attribute selector.");
  }
  return node.value.type === "String" ? node.value.value : ident.decode(node.value.name);
}

/** Pure extraction grants no issuance or ownership. The Library must prove each demand. @internal */
export function document_css_subject_identities(input: PortableDocumentStylesheetRecord,
  direction: "outbound" | "inbound"): readonly string[] {
  if (!document_css_mentions_subject_identity(input)) return [];
  const values = new Set<string>();
  visit_document_css_identities(input, node => {
    const value = identity_value(node, direction === "outbound" ? RUNTIME_ATTRIBUTE : PORTABLE_ATTRIBUTE);
    if (direction === "outbound" ? !is_persisted_quid(value) : !is_document_quad_name(value)) {
      throw new TypeError("Invalid CSS subject identity reference.");
    }
    values.add(value);
  }, true);
  return Object.freeze([...values]);
}

/** Replace an omitted identity attribute with a false atom of equal (0,1,0)
 * specificity. Functional selector wrappers retain their matching/cascade rules. */
export function omit_part_css_subjects(input: PortableDocumentStylesheetRecord, absent: ReadonlySet<string>): PortableDocumentStylesheetRecord {
  if (absent.size === 0) return input;
  return visit_document_css_identities(input, node => {
    if (!absent.has(identity_value(node, PORTABLE_ATTRIBUTE))) return;
    const selector = parse(":nth-child(0)", { context: "selector" });
    if (selector.type !== "Selector" || selector.children.first === null) throw new Error("Invalid empty CSS subject selector.");
    return selector.children.first;
  }, true);
}

/** Compare portable checkpoint semantics across disposable payload renaming; no runtime identity is created. @internal */
export function remap_portable_document_css_identities(input: PortableDocumentStylesheetRecord,
  names: ReadonlyMap<string, string>): PortableDocumentStylesheetRecord {
  if (!document_css_mentions_subject_identity(input)) return input;
  return visit_document_css_identities(input, node => {
    const name = identity_value(node, PORTABLE_ATTRIBUTE), replacement = names.get(name);
    if (replacement === undefined || !is_document_quad_name(replacement)) throw new Error("Unresolved portable CSS correspondence.");
    node.value = { type: "String", value: replacement };
  }, true);
}

/**
 * Translate exact identity attribute nodes in existing portable CSS data.
 * Callers select one Library and prove local issuance/admission and disposition;
 * this pure consumer validates vocabulary and bijection, never graph ownership.
 * Opaque selectors/preludes and non-exact identity tests reject conservatively.
 * No runtime, capture, allocation, stylesheet ownership or transport integration.
 * Ordinary consumers select subjectsOnly. sameRuntime is reserved for a caller's
 * independently proved exact living-owner restoration, never portable admission.
 * @internal
 */
export function translate_document_css_identities(
  input: PortableDocumentStylesheetRecord,
  direction: "outbound" | "inbound",
  correspondence: CssIdentityCorrespondence,
  subjectsOnly = false,
  sameRuntime = false,
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
      || (direction === "outbound" ? name !== `_${quid}` : !sameRuntime && name.slice(1) === quid))) {
      throw new TypeError("Incoherent disposable CSS identity correspondence.");
    }
    byName.set(name, quid); byQuid.set(quid, name);
  }
  const sourceAttribute = direction === "outbound" ? RUNTIME_ATTRIBUTE : PORTABLE_ATTRIBUTE;
  const targetAttribute = direction === "outbound" ? PORTABLE_ATTRIBUTE : RUNTIME_ATTRIBUTE;
  const mapping = direction === "outbound" ? byQuid : byName;

  const result = visit_document_css_identities(input, node => {
    const value = identity_value(node, sourceAttribute);
    const replacement = mapping.get(value);
    if (replacement === undefined) throw new TypeError("Unresolved CSS identity selector reference.");
    node.name.name = ident.encode(targetAttribute);
    node.value = { type: "String", value: replacement };
  }, subjectsOnly);
  check();
  return result;
}
