/// <reference path="../../types/css-tree-browser.d.ts" />
import { generate, ident, parse, walk } from "css-tree/dist/csstree.esm";
import { parse_style_selector } from "./relative-selector.js";
import type { DocumentCssRecord, DocumentCssOrderEntry } from "../../types/document-css.types.js";
import { css_entry_identity, decode_portable_document_stylesheet, encode_portable_document_stylesheet, stylesheet_order_leaves, type PortableDocumentStylesheet } from "./portable-document-stylesheet.js";

/** Scope inclusive descendants, retaining normal inheritance/cascade through nested Parts. @internal */
export function scope_part_stylesheet(css: DocumentCssRecord, rootName: string): DocumentCssRecord {
  const owner = `[hson\\:quad="${rootName}"]`, header = `@scope (${owner})`;
  const inclusive = (source: string): string => {
    const selectors = parse_style_selector(source);
    selectors.children.forEach(selector => {
      if (selector.type !== "Selector") throw new SyntaxError("Invalid Part selector.");
      let scoped = false;
      walk(selector, node => {
        if (node.type === "PseudoClassSelector" && ident.decode(node.name).toLowerCase() === "scope") scoped = true;
      });
      if (scoped) return; // Explicit &/:scope already determines its root relationship.
      // A scope-containing zero-specificity constraint disables native implicit
      // descendant anchoring. Constrain the first compound to the inclusive
      // subtree, allowing it to describe either the root or an ordinary descendant.
      const constraint = parse(":where(:scope,:scope *)", { context: "selector" });
      if (constraint.type !== "Selector" || constraint.children.first === null) throw new SyntaxError("Invalid inclusive Part scope.");
      const node = constraint.children.first;
      const boundary = selector.children.toArray().find(node => node.type === "Combinator" || node.type === "PseudoElementSelector");
      if (boundary === undefined) selector.children.appendData(node);
      else selector.children.forEach((part, item) => { if (part === boundary) selector.children.insertData(node, item); });
    });
    return generate(selectors);
  };
  const descend = (entries: readonly DocumentCssOrderEntry[]): DocumentCssOrderEntry[] => entries.map(entry => {
    if (entry.kind === "rule") return { ...entry, scopes: [header, ...entry.scopes] };
    if (entry.kind === "group") return { ...entry, entries: descend(entry.entries) };
    throw new Error("Part global definitions cannot be nested in a condition.");
  });
  return encode_portable_document_stylesheet(decode_portable_document_stylesheet({ ...css,
    rules: css.rules.map(rule => ({ ...rule, selector: inclusive(rule.selector), scopes: [header, ...rule.scopes] })),
    order: css.order.map(entry => entry.kind === "text" || entry.kind === "property" || entry.kind === "keyframes" ? { ...entry, owner }
      : { kind: "group", header, owner, entries: descend([entry]) }),
  }));
}

/** Remove only explicitly owned contributions whose root retired in this candidate. @internal */
export function retire_part_styles(stylesheet: PortableDocumentStylesheet, active: ReadonlySet<string>): PortableDocumentStylesheet {
  return retire_part_styles_by_owner(stylesheet, owner => {
    const root = /^\[hson\\:quid="([^"\\]+)"\]$/.exec(owner)?.[1];
    if (root === undefined) throw new Error("Runtime Part CSS requires an exact root QUID owner.");
    return active.has(root);
  });
}

/** Same ownership pruning for a validated portable candidate; no identity issuance. @internal */
export function retire_part_styles_by_owner(stylesheet: PortableDocumentStylesheet,
  active: (owner: string) => boolean): PortableDocumentStylesheet {
  const record = encode_portable_document_stylesheet(stylesheet);
  const keep = (entries: readonly DocumentCssOrderEntry[]): DocumentCssOrderEntry[] => entries.flatMap(entry => {
    if (entry.owner !== undefined) {
      if (!active(entry.owner)) return [];
    }
    return [entry.kind === "group" ? { ...entry, entries: keep(entry.entries) } : entry];
  });
  const order = keep(record.order), leaves = new Set(stylesheet_order_leaves(order).filter(entry => entry.kind !== "text").map(css_entry_identity));
  return decode_portable_document_stylesheet({ ...record, order,
    rules: record.rules.filter(rule => leaves.has(css_entry_identity({ kind: "rule", ruleKey: rule.ruleKey, scopes: rule.scopes }))),
    properties: record.properties.filter(item => leaves.has(css_entry_identity({ kind: "property", name: item.name }))),
    keyframes: record.keyframes.filter(item => leaves.has(css_entry_identity({ kind: "keyframes", name: item.name }))),
  });
}

/** Append contributions without losing structural ownership or merging equal groups. @internal */
export function merge_part_stylesheets(records: readonly DocumentCssRecord[]): PortableDocumentStylesheet {
  const rules: DocumentCssRecord["rules"][number][] = [], properties: DocumentCssRecord["properties"][number][] = [],
    keyframes: DocumentCssRecord["keyframes"][number][] = [], order: DocumentCssOrderEntry[] = [];
  const used = new Set<string>(); let next = 0;
  for (const record of records) {
    const keys = new Map<string, string>();
    for (const rule of record.rules) {
      let key = rule.ruleKey;
      while (used.has(JSON.stringify([rule.scopes, key]))) key = `stylesheet:${++next}`;
      keys.set(JSON.stringify([rule.scopes, rule.ruleKey]), key); used.add(JSON.stringify([rule.scopes, key]));
      rules.push({ ...rule, ruleKey: key });
    }
    const remap = (entries: readonly DocumentCssOrderEntry[]): DocumentCssOrderEntry[] => entries.map(entry => entry.kind === "group"
      ? { ...entry, entries: remap(entry.entries) } : entry.kind === "rule"
        ? { ...entry, ruleKey: keys.get(JSON.stringify([entry.scopes, entry.ruleKey]))! } : entry);
    properties.push(...record.properties); keyframes.push(...record.keyframes); order.push(...remap(record.order));
  }
  return decode_portable_document_stylesheet({ rules, properties, keyframes, order });
}
