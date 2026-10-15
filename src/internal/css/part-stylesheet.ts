/// <reference path="../../types/css-tree-browser.d.ts" />
import { generate, ident, parse, walk, tokenize, tokenTypes } from "css-tree/dist/csstree.esm";
import type { Block, CssNode } from "css-tree";
import type { DocumentCssOrderEntry, DocumentCssRecord } from "../../types/document-css.types.js";
import { parse_document_stylesheet } from "./parse-document-stylesheet.js";
import { css_entry_identity, decode_portable_document_stylesheet, encode_portable_document_stylesheet,
  stylesheet_order_leaves, type PortableDocumentStylesheet } from "./portable-document-stylesheet.js";

/** Lower structural CSS nesting before admission through the ordinary managed codec. @internal */
export function parse_part_stylesheet(source: string): DocumentCssRecord {
  if (typeof source !== "string" || source.length > 4_000_000) throw new TypeError("Part CSS requires stylesheet text within the construction character limit.");
  const closing: number[] = [];
  let tokens = 0, emitted = 0;
  tokenize(source, (type, start, end) => {
    if (++tokens > 1_000_000 || closing.length > 128) throw new SyntaxError("Part CSS resource/depth limit exceeded.");
    if (type === tokenTypes.BadString || type === tokenTypes.BadUrl || type === tokenTypes.Comment && !source.slice(start, end).endsWith("*/")) throw new SyntaxError("Unterminated Part CSS token.");
    const expected = type === tokenTypes.LeftCurlyBracket ? tokenTypes.RightCurlyBracket : type === tokenTypes.LeftParenthesis || type === tokenTypes.Function ? tokenTypes.RightParenthesis : type === tokenTypes.LeftSquareBracket ? tokenTypes.RightSquareBracket : undefined;
    if (expected !== undefined) closing.push(expected);
    else if ([tokenTypes.RightCurlyBracket, tokenTypes.RightParenthesis, tokenTypes.RightSquareBracket].includes(type) && closing.pop() !== type) throw new SyntaxError("Unmatched Part CSS delimiter.");
  });
  if (closing.length) throw new SyntaxError("Unclosed Part CSS delimiter.");
  // CSSTree's style-block parser recognizes a nested rule only when it starts
  // with &. Keep its Raw recovery until we can split those blocks at token
  // boundaries and parse each declaration/rule in its own strict context.
  const ast = parse(source, { context: "stylesheet", positions: true });
  if (ast.type !== "StyleSheet") throw new SyntaxError("Part CSS requires a stylesheet.");
  const recover = (value: string): Readonly<{ node: CssNode; source: string }>[] => {
    const result: Readonly<{ node: CssNode; source: string }>[] = [];
    let start = 0, depth = 0, rule = false;
    let first: number | undefined, custom = false, propertyName = false;
    const flush = (end: number, isRule: boolean) => {
      const text = value.slice(start, end).trim();
      if (text) {
        const node = parse(text, { context: isRule ? "stylesheet" : "declaration", positions: true,
          ...(isRule ? {} : { onParseError(error: Error) { throw error; } }) });
        if (node.type === "StyleSheet" && node.children.size === 1
          && (node.children.first?.type === "Rule" || node.children.first?.type === "Atrule")) result.push({ node: node.children.first, source: text });
        else if (!isRule && node.type === "Declaration") result.push({ node, source: text });
        else throw new SyntaxError("Opaque Part CSS is unsupported.");
      }
      start = end; first = undefined; custom = false; propertyName = false; rule = false;
    };
    tokenize(value, (type, begin, end) => {
      if (++tokens > 1_000_000) throw new SyntaxError("Part CSS parsing token limit exceeded.");
      if (first === undefined && type !== tokenTypes.WhiteSpace && type !== tokenTypes.Comment && type !== tokenTypes.Semicolon) {
        first = type;
        propertyName = type === tokenTypes.Ident && ident.decode(value.slice(begin, end)).startsWith("--");
      } else if (propertyName && type !== tokenTypes.WhiteSpace && type !== tokenTypes.Comment) {
        custom = type === tokenTypes.Colon;
        propertyName = false;
      }
      if (type === tokenTypes.LeftCurlyBracket || type === tokenTypes.LeftParenthesis || type === tokenTypes.Function || type === tokenTypes.LeftSquareBracket) {
        if (depth === 0 && type === tokenTypes.LeftCurlyBracket && !custom) rule = true;
        depth++;
      } else if (type === tokenTypes.RightCurlyBracket || type === tokenTypes.RightParenthesis || type === tokenTypes.RightSquareBracket) {
        depth--;
        if (depth === 0 && rule) flush(end, true);
      } else if (depth === 0 && type === tokenTypes.Semicolon) {
        if (first !== undefined) flush(begin, first === tokenTypes.AtKeyword);
        start = end;
      }
    });
    if (depth !== 0) throw new SyntaxError("Opaque Part CSS block is unsupported.");
    if (first !== undefined) flush(value.length, first === tokenTypes.AtKeyword);
    return result;
  };
  const selector = (node: CssNode, parent?: string): string => {
    const selected = parse(generate(node), { context: "selectorList", onParseError(error) { throw error; } });
    let nesting = false, nestingCount = 0;
    walk(selected, part => { if (part.type === "NestingSelector") nestingCount++; });
    if ((parent?.length ?? 6) * nestingCount + generate(selected).length > 4_000_000) throw new SyntaxError("Part CSS selector expansion limit exceeded.");
    walk(selected, (part, item, list) => {
      if (part.type === "Raw") throw new SyntaxError("Opaque Part CSS selectors cannot be scoped.");
      if (part.type !== "NestingSelector") return;
      nesting = true;
      const replacement = parse(parent === undefined ? ":scope" : `:is(${parent})`, { context: "selector" });
      if (replacement.type !== "Selector" || replacement.children.first === null || !item || !list) throw new SyntaxError("Invalid CSS nesting selector.");
      list.replace(item, list.createItem(replacement.children.first));
    });
    if (selected.type !== "SelectorList") throw new SyntaxError("Invalid Part CSS selector list.");
    // Each selector without & receives the nesting parent's implicit descendant combinator.
    if (parent !== undefined && !nesting) return selected.children.toArray().map(child => `:is(${parent}) ${generate(child)}`).join(",");
    if (parent !== undefined && selected.children.size > 1) {
      // Mixed explicit/implicit lists must be lowered independently.
      return node.type === "SelectorList" ? node.children.toArray().map(child => selector(child, parent)).join(",") : generate(selected);
    }
    return generate(selected);
  };
  const lower = (block: Block, parent: string, origin: string): string => {
    const output: string[] = [], declarations: string[] = [];
    const flush = () => {
      if (!declarations.length) return;
      const rule = `${parent}{${declarations.splice(0).join(";")}}`;
      if ((emitted += rule.length) > 4_000_000) throw new SyntaxError("Part CSS expansion character limit exceeded.");
      output.push(rule);
    };
    block.children.toArray().flatMap(node => {
      if (node.type === "Raw") return recover(node.value);
      // A colon-bearing nested selector can initially look like a declaration
      // whose value recovers as Raw. Re-split its complete token sequence at the
      // same balanced block boundaries. Custom properties own their raw values.
      if (node.type === "Declaration" && node.value.type === "Raw" && !ident.decode(node.property).startsWith("--")) {
        if (node.loc === null || node.loc === undefined) throw new SyntaxError("Part CSS recovery requires exact source positions.");
        // Generating the mistaken declaration would remove whitespace before
        // its colon, changing `button :is(...)` into `button:is(...)`.
        return recover(origin.slice(node.loc.start.offset, node.loc.end.offset));
      }
      return [{ node, source: origin }];
    }).forEach(({ node, source }) => {
      if (node.type === "Declaration") { declarations.push(generate(node)); return; }
      flush();
      output.push(visit(node, parent, source));
    });
    flush(); return output.join("\n");
  };
  const visit = (node: CssNode, parent?: string, origin = source): string => {
    if (node.type === "Rule") return lower(node.block, selector(node.prelude, parent), origin);
    if (node.type === "Atrule") {
      const name = node.name.toLowerCase();
      if (name === "scope" && parent !== undefined) throw new SyntaxError("Nested @scope inside a Part style rule is unsupported.");
      if (["media", "supports", "layer", "container", "scope", "starting-style"].includes(name)) {
        if (node.block === null) throw new SyntaxError(`Part @${name} statements are unsupported.`);
        const header = `@${node.name}${node.prelude === null ? "" : ` ${generate(node.prelude)}`}`;
        const body = parent === undefined ? node.block.children.toArray().map(child => visit(child, undefined, origin)).join("\n") : lower(node.block, parent, origin);
        return `${header}{${body}}`;
      }
      if (parent !== undefined) throw new SyntaxError(`Nested Part @${name} is unsupported.`);
      return generate(node); // Existing parser admits only supported global definitions.
    }
    if (node.type === "Raw") throw new SyntaxError("Opaque Part CSS is unsupported.");
    throw new SyntaxError(`Unsupported Part CSS ${node.type}.`);
  };
  return parse_document_stylesheet(ast.children.toArray().map(node => visit(node)).join("\n"), []);
}

/** Scope inclusive descendants, retaining normal inheritance/cascade through nested Parts. @internal */
export function scope_part_stylesheet(css: DocumentCssRecord, rootName: string): DocumentCssRecord {
  const owner = `[hson\\:quad="${rootName}"]`, header = `@scope (${owner})`;
  const inclusive = (source: string): string => {
    const selectors = parse(source, { context: "selectorList", onParseError(error) { throw error; } });
    if (selectors.type !== "SelectorList") throw new SyntaxError("Invalid Part selector list.");
    selectors.children.forEach(selector => {
      if (selector.type !== "Selector") throw new SyntaxError("Invalid Part selector.");
      let scoped = false;
      walk(selector, node => {
        if (node.type === "Raw") throw new SyntaxError("Opaque Part CSS selectors cannot be scoped.");
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
    order: css.order.map(entry => entry.kind === "property" || entry.kind === "keyframes" ? { ...entry, owner }
      : { kind: "group", header, owner, entries: descend([entry]) }),
  }));
}

/** Remove only explicitly owned contributions whose root retired in this candidate. @internal */
export function retire_part_styles(stylesheet: PortableDocumentStylesheet, active: ReadonlySet<string>): PortableDocumentStylesheet {
  const record = encode_portable_document_stylesheet(stylesheet);
  const keep = (entries: readonly DocumentCssOrderEntry[]): DocumentCssOrderEntry[] => entries.flatMap(entry => {
    if (entry.owner !== undefined) {
      const root = /^\[hson\\:quid="([^"\\]+)"\]$/.exec(entry.owner)?.[1];
      if (root === undefined) throw new Error("Runtime Part CSS requires an exact root QUID owner.");
      if (!active.has(root)) return [];
    }
    return [entry.kind === "group" ? { ...entry, entries: keep(entry.entries) } : entry];
  });
  const order = keep(record.order), leaves = new Set(stylesheet_order_leaves(order).map(css_entry_identity));
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
