// find.ts

import { HsonQuery } from "../../../types/livetree.types.js";;
import { HsonNode } from "../../../types/node.types.js";
import { parse_selector } from "../../../utils/livetree-utils/parse-selector.js";
import { LiveTree } from "../livetree.js";
import { make_tree_selector } from "../creation/make-tree-selector.js";
import { TreeSelector } from "../creation/tree-selector.js";
import { search_nodes } from "./search.js";
import { FindWithById } from "../../../types/livetree.types.js";
import { SvgLiveTree } from "../../../types/svg.types.js";
import { _DATA_QUID, ensure_quid, get_node_by_quid } from "../../../quid/data-quid.quid.js";
import { wrap_in_tree } from "../creation/create-livetree.js";
import { is_Node } from "../../../utils/node-utils/node-guards.js";

// “batching” helpers + queryish types

export type FindQuery = HsonQuery | string;
export type FindQueryMany = FindQuery | readonly FindQuery[];

type FindManyHelpers = {
  /** Existing helper: accepts one id or many ids. */
  id: (ids: string | readonly string[]) => TreeSelector;

  /** CHANGED: explicit collection aliases. */
  byId: (id: string) => TreeSelector;
  byIds: (...ids: string[]) => TreeSelector;

  byAttribute: (attr: string, value: string) => TreeSelector;
  byAttr: (attr: string, value: string) => TreeSelector;
  byAttrs: (attr: string, value: string) => TreeSelector;

  byFlag: (flag: string) => TreeSelector;
  byFlags: (flag: string) => TreeSelector;

  byTag: (tag: string) => TreeSelector;
  byClass: (className: string) => TreeSelector;
  byData: (key: string, value: string) => TreeSelector;
};

export type FindManyMust = ((q: FindQueryMany, label?: string) => TreeSelector) &
FindManyHelpers;
export type FindMany = ((q: FindQueryMany) => TreeSelector) & FindManyHelpers & {
must: FindManyMust;
};

// array type-guard so TS narrows correctly.
function isManyQuery(q: FindQueryMany): q is readonly FindQuery[] {
  return Array.isArray(q);
}

function node_in_subtree(root: HsonNode, target: HsonNode): boolean {
  if (root === target) return true;
  for (const child of root._content ?? []) {
    if (typeof child === "string") continue;
    if (is_Node(child) && node_in_subtree(child, target)) return true;
  }
  return false;
}

// no overloads; just accept the union and narrow.
function asManyQuery(q: FindQueryMany): readonly FindQuery[] {
  return isManyQuery(q) ? q : [q];
}

function normalize_data_attr_name(key: string): string {
  const k = key.trim();
  if (!k) throw new Error("byData: empty data key");
  return k.startsWith("data-") ? k : `data-${k}`;
}

function class_query(className: string): HsonQuery {
  const cls = className.trim();
  if (!cls) throw new Error("byClass: empty class name");

  // CHANGED: first-pass class lookup is exact-match against the class attr.
  // Token-aware matching for `class="a b"` should be handled later in search_nodes
  // or by adding a predicate-like query shape.
  return { attrs: { class: cls } };
}

function as_svg_tree(hit: LiveTree | undefined): SvgLiveTree | undefined {
  if (!hit) return undefined;
  return hit.svg.inScope() ? hit as unknown as SvgLiveTree : undefined;
}

function must_as_svg_tree(hit: LiveTree, label: string): SvgLiveTree {
  const svg = as_svg_tree(hit);
  if (!svg) {
    throw new Error(`[LiveTree.find.must.asSvg] expected SVG-scoped match for ${label}`);
  }
  return svg;
}

type TextFindQuery = HsonQuery & Readonly<{
  text?: unknown;
}>;

type SplitFindQuery = Readonly<{
  searchQuery: HsonQuery;
  text: string | RegExp | undefined;
}>;

function split_text_query(query: HsonQuery): SplitFindQuery {
  const maybeText = (query as TextFindQuery).text;
  if (maybeText === undefined) return { searchQuery: query, text: undefined };

  if (typeof maybeText !== "string" && !(maybeText instanceof RegExp)) {
    throw new Error("find query text must be a string or RegExp");
  }

  const { text: _text, ...rest } = query as TextFindQuery;
  return { searchQuery: rest as HsonQuery, text: maybeText };
}

function node_text_content(node: HsonNode): string {
  let out = "";

  for (const child of node._content ?? []) {
    if (typeof child === "string") {
      out += child;
      continue;
    }

    if (is_Node(child)) {
      out += node_text_content(child);
    }
  }

  return out;
}

function node_matches_text(node: HsonNode, text: string | RegExp): boolean {
  const actual = node_text_content(node);

  if (typeof text === "string") {
    return actual.includes(text);
  }

  text.lastIndex = 0;
  return text.test(actual);
}

function search_nodes_for_find(
  roots: HsonNode[],
  query: HsonQuery,
  opts: { findFirst: boolean },
): HsonNode[] {
  const split = split_text_query(query);

  // CHANGED: search_nodes does not own object-query text matching yet. Strip
  // text before the structural search, then filter ordered candidates here.
  // For findFirst+text we must search all structural candidates, because the
  // first structural hit might fail the text constraint while a later one hits.
  const candidates = search_nodes(
    roots,
    split.searchQuery,
    { findFirst: split.text === undefined ? opts.findFirst : false },
  );

  if (split.text === undefined) return candidates;

  const filtered = candidates.filter((node) => node_matches_text(node, split.text!));
  return opts.findFirst ? filtered.slice(0, 1) : filtered;
}

/**
 * Find *all* matching nodes under a `LiveTree` and return them as a `TreeSelector`.
 *
 * Semantics:
 * - Rooted search: delegates to `search_nodes([tree.node], query, { findFirst: false })`,
 *   so the traversal is confined to this tree’s subtree.
 * - For each matching `HsonNode`, constructs a child `LiveTree` via
 *   `wrap_in_tree`, preserving the original host root.
 * - Packs the resulting `LiveTree[]` into a `TreeSelector` via
 *   `make_tree_selector`, giving the caller broadcast helpers
 *   (`setAttrs`, `style`, `listen`, etc.).
 *
 * Selector handling:
 * - If `q` is a string, it is parsed via `parse_selector` into `HsonQuery`.
 * - If `q` is already an `HsonQuery`, it is used as-is.
 *
 * Return value:
 * - Always returns a `TreeSelector` (possibly empty). All mutation
 *   helpers on the selector are no-ops when the selection is empty.
 *
 * @param tree - The `LiveTree` whose subtree will be searched.
 * @param q - A selector string or `HsonQuery` describing matches.
 * @returns A `TreeSelector` containing all matching nodes.
 */
export function find_all_in_tree(tree: LiveTree, q: HsonQuery | string): TreeSelector {
  const query = typeof q === "string" ? parse_selector(q) : q;
  const found: HsonNode[] = search_nodes_for_find([tree.node], query, { findFirst: false });

  const trees = found.map(node => wrap_in_tree(tree, node)); // ← changed
  return make_tree_selector(trees);
}

/**
 * Find *all* matching nodes for one or many queries and union the results.
 *
 * @param tree - The `LiveTree` whose subtree will be searched.
 * @param q - A selector/query or list of queries to match (OR semantics).
 * @returns A `TreeSelector` containing all matches across all queries.
 */
// NEW: many-query helper (OR/union semantics)
export function find_all_in_tree_many(tree: LiveTree, q: FindQueryMany): TreeSelector {
  const qs = asManyQuery(q);

  const out: LiveTree[] = [];
  for (const one of qs) {
    const sel = find_all_in_tree(tree, one);  // returns TreeSelector
    out.push(...sel.array());              // use TreeSelector primitive
  }

  return make_tree_selector(out);
}

function normalizeOne(q: FindQuery): HsonQuery {
  return typeof q === "string" ? parse_selector(q) : q;
}

/**
 * Build a single-result finder bound to a `LiveTree` subtree.
 *
 * The returned function searches only within `tree.node` and exposes helper
 * lookups for common cases:
 * - `byId(id)`
 * - `byAttrs(attr, value)`
 * - `byFlags(flag)`
 * - `byTag(tag)`
 * - `byQuid(quid)`
 *
 * A matching `.must(...)` surface is also provided and throws when no match
 * exists.
 *
 * @param tree - The `LiveTree` whose subtree will be searched.
 * @returns A `find` helper bound to that subtree.
 */
export function make_find_for(tree: LiveTree): FindWithById {
  const base = ((q: FindQuery): LiveTree | undefined => {
    const query = typeof q === "string" ? parse_selector(q) : q;
    const found = search_nodes_for_find([tree.node], query, { findFirst: true });
    if (!found.length) return undefined;
    return wrap_in_tree(tree, found[0]);
  }) as FindWithById;

  const mustBase = ((q: FindQuery, label?: string): LiveTree => {
    const res = base(q);
    if (!res) {
      const desc = label ?? (typeof q === "string" ? q : JSON.stringify(q));
      throw new Error(`[LiveTree.find.must] expected match for ${desc}`);
    }
    return res;
  }) as FindWithById["must"];

  // sugar parity with findAll
  base.byId = (id: string): LiveTree | undefined =>
    base({ attrs: { id } });

  base.byAttribute = (attr: string, value: string): LiveTree | undefined =>
    base({ attrs: { [attr]: value } });

  base.byFlag = (flag: string): LiveTree | undefined =>
    base({ attrs: { [flag]: flag } });

  base.byTag = (tag: string): LiveTree | undefined =>
    base({ tag });

  // CHANGED: more readable aliases for the existing singular find surface.

  base.byClass = (className: string): LiveTree | undefined =>
    base(class_query(className));

  base.byData = (key: string, value: string): LiveTree | undefined =>
    base({ attrs: { [normalize_data_attr_name(key)]: value } });

  mustBase.byId = (id: string): LiveTree =>
    mustBase({ attrs: { id } });

  mustBase.byAttribute = (attr: string, value: string): LiveTree =>
    mustBase({ attrs: { [attr]: value } });

  mustBase.byFlag = (flag: string): LiveTree =>
    mustBase({ attrs: { [flag]: flag } });

  mustBase.byTag = (tag: string): LiveTree =>
    mustBase({ tag });

  // CHANGED: must-surface aliases match the non-must finder surface.

  mustBase.byClass = (className: string): LiveTree =>
    mustBase(class_query(className));

  mustBase.byData = (key: string, value: string): LiveTree =>
    mustBase({ attrs: { [normalize_data_attr_name(key)]: value } });

  const asSvgBase = ((q: FindQuery): SvgLiveTree | undefined => {
    return as_svg_tree(base(q));
  }) as FindWithById["asSvg"];

  asSvgBase.byId = (id: string): SvgLiveTree | undefined =>
    as_svg_tree(base.byId(id));

  asSvgBase.byAttribute = (attr: string, value: string): SvgLiveTree | undefined =>
    as_svg_tree(base.byAttribute(attr, value));

  asSvgBase.byFlag = (flag: string): SvgLiveTree | undefined =>
    as_svg_tree(base.byFlag(flag));

  asSvgBase.byTag = (tag: string): SvgLiveTree | undefined =>
    as_svg_tree(base.byTag(tag));

  asSvgBase.byClass = (className: string): SvgLiveTree | undefined =>
    as_svg_tree(base.byClass(className));

  asSvgBase.byData = (key: string, value: string): SvgLiveTree | undefined =>
    as_svg_tree(base.byData(key, value));

  asSvgBase.byQuid = (quid: string): SvgLiveTree | undefined =>
    as_svg_tree(base.byQuid(quid));

  const mustAsSvg = ((q: FindQuery, label?: string): SvgLiveTree => {
    const hit = mustBase(q, label);
    const desc = label ?? (typeof q === "string" ? q : JSON.stringify(q));
    return must_as_svg_tree(hit, desc);
  }) as FindWithById["must"]["asSvg"];

  mustAsSvg.byId = (id: string): SvgLiveTree =>
    must_as_svg_tree(mustBase.byId(id), `id:${id}`);

  mustAsSvg.byAttribute = (attr: string, value: string): SvgLiveTree =>
    must_as_svg_tree(mustBase.byAttribute(attr, value), `${attr}:${value}`);

  mustAsSvg.byFlag = (flag: string): SvgLiveTree =>
    must_as_svg_tree(mustBase.byFlag(flag), `flag:${flag}`);

  mustAsSvg.byTag = (tag: string): SvgLiveTree =>
    must_as_svg_tree(mustBase.byTag(tag), `tag:${tag}`);

  mustAsSvg.byClass = (className: string): SvgLiveTree =>
    must_as_svg_tree(mustBase.byClass(className), `class:${className}`);

  mustAsSvg.byData = (key: string, value: string): SvgLiveTree =>
    must_as_svg_tree(mustBase.byData(key, value), `data-${key}:${value}`);

  mustAsSvg.byQuid = (quid: string): SvgLiveTree =>
    must_as_svg_tree(mustBase.byQuid(quid), `quid:${quid}`);

  base.asSvg = asSvgBase;
  mustBase.asSvg = mustAsSvg;

  base.must = mustBase;

  base.byQuid = (quid: string): LiveTree | undefined => {
    const node = get_node_by_quid(quid);
    if (!node) return undefined;
    if (!node_in_subtree(tree.node, node)) return undefined;
    return wrap_in_tree(tree, node);
  };

  mustBase.byQuid = (quid: string): LiveTree => {
    const hit = base.byQuid(quid);
    if (!hit) {
      throw new Error(`[LiveTree.find.must] expected match for quid:${quid}`);
    }
    return hit;
  };

  return base;
}

/**
 * Build a multi-result finder (`findAll`) bound to a `LiveTree` subtree.
 *
 * The returned function accepts a single query or list of queries and
 * exposes helper shortcuts (`id`, `byAttribute`, `byFlag`, `byTag`) plus
 * a `.must(...)` variant that throws when empty.
 *
 * @param tree - The `LiveTree` whose subtree will be searched.
 * @returns A `FindMany` helper bound to that tree.
 */
export function make_find_all_for(tree: LiveTree): FindMany {
  const base = ((q: FindQueryMany): TreeSelector => {
    const qs = asManyQuery(q);

    const out: LiveTree[] = [];
    for (const one of qs) {
      const query = normalizeOne(one);
      const found = search_nodes_for_find([tree.node], query, { findFirst: false });
      for (const node of found) out.push(wrap_in_tree(tree, node));
    }

    return make_tree_selector(out);
  }) as FindMany;

  const mustBase = ((q: FindQueryMany, label?: string): TreeSelector => {
    const sel = base(q);
    if (sel.length === 0) {
      const desc = label ?? "query";
      throw new Error(`[LiveTree.findAll.must] expected >=1 match for ${desc}`);
    }
    return sel;
  }) as FindMany["must"];

  // make sure these param types are explicit (no implicit any)
  base.id = (ids: string | readonly string[]): TreeSelector => {
    const list: readonly string[] = Array.isArray(ids) ? ids : [ids];
    return base(list.map((id) => ({ attrs: { id } })));
  };

  // CHANGED: explicit collection aliases. byId returns a TreeSelector of
  // length 0 or 1 in normal HTML, while byIds is the variadic many-id form.
  base.byId = (id: string): TreeSelector => base.id(id);
  base.byIds = (...ids: string[]): TreeSelector => base.id(ids);

  base.byAttribute = (attr: string, value: string): TreeSelector =>
    base({ attrs: { [attr]: value } });

  base.byAttr = base.byAttribute;
  base.byAttrs = base.byAttribute;

  base.byFlag = (flag: string): TreeSelector =>
    base({ attrs: { [flag]: flag } });

  base.byFlags = base.byFlag;

  base.byTag = (tag: string): TreeSelector =>
    base({ tag });

  base.byClass = (className: string): TreeSelector =>
    base(class_query(className));

  base.byData = (key: string, value: string): TreeSelector =>
    base({ attrs: { [normalize_data_attr_name(key)]: value } });

  mustBase.id = (ids: string | readonly string[]): TreeSelector => {
    const list: readonly string[] = Array.isArray(ids) ? ids : [ids];
    return mustBase(list.map((id) => ({ attrs: { id } })));
  };

  mustBase.byId = (id: string): TreeSelector => mustBase.id(id);
  mustBase.byIds = (...ids: string[]): TreeSelector => mustBase.id(ids);

  mustBase.byAttribute = (attr: string, value: string): TreeSelector =>
    mustBase({ attrs: { [attr]: value } });

  mustBase.byAttr = mustBase.byAttribute;
  mustBase.byAttrs = mustBase.byAttribute;

  mustBase.byFlag = (flag: string): TreeSelector =>
    mustBase({ attrs: { [flag]: flag } });

  mustBase.byFlags = mustBase.byFlag;

  mustBase.byTag = (tag: string): TreeSelector =>
    mustBase({ tag });

  mustBase.byClass = (className: string): TreeSelector =>
    mustBase(class_query(className));

  mustBase.byData = (key: string, value: string): TreeSelector =>
    mustBase({ attrs: { [normalize_data_attr_name(key)]: value } });

  base.must = mustBase;

  return base;
}
