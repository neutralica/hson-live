// find.ts

import { HsonQuery } from "../../../types/livetree.types";;
import { HsonNode } from "../../../types/node.types";
import { parse_selector } from "../../../utils/tree-utils/parse-selector";
import { LiveTree } from "../livetree";
import { make_tree_selector } from "../creation/make-tree-selector";
import { TreeSelector } from "../tree-selector";
import { search_nodes } from "./search";
import { FindWithById } from "../../../types/livetree.types";
import { ensure_quid } from "../../../quid/data-quid.quid";
import { wrap_in_tree } from "../create-livetree";

// “batching” helpers + queryish types

export type FindQuery = HsonQuery | string;
export type FindQueryMany = FindQuery | readonly FindQuery[];

type FindManyHelpers = {
    id: (ids: string | readonly string[]) => TreeSelector;
    byAttribute: (attr: string, value: string) => TreeSelector;
    byFlag: (flag: string) => TreeSelector;
    byTag: (tag: string) => TreeSelector;
};

export type FindManyMust = ((q: FindQueryMany, label?: string) => TreeSelector) & FindManyHelpers;

export type FindMany = ((q: FindQueryMany) => TreeSelector) & FindManyHelpers & {
    must: FindManyMust;
};

// ADDED: array type-guard so TS narrows correctly.
function isManyQuery(q: FindQueryMany): q is readonly FindQuery[] {
    return Array.isArray(q);
}

// CHANGED: no overloads; just accept the union and narrow.
function asManyQuery(q: FindQueryMany): readonly FindQuery[] {
    return isManyQuery(q) ? q : [q];
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
    const found: HsonNode[] = search_nodes([tree.node], query, { findFirst: false });

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
        out.push(...sel.toArray());              // CHANGED: use TreeSelector primitive
    }

    return make_tree_selector(out);
}

function normalizeOne(q: FindQuery): HsonQuery {
    return typeof q === "string" ? parse_selector(q) : q;
}

/**
 * Build a single-result finder (`find`) bound to a `LiveTree` subtree.
 *
 * The returned function accepts a query and exposes helpers
 * (`byId`, `byAttrs`, `byFlags`, `byTag`) plus a `.must(...)` variant that
 * throws when no match is found.
 *
 * @param tree - The `LiveTree` whose subtree will be searched.
 * @returns A `FindWithById` helper bound to that tree.
 */
export function make_find_for(tree: LiveTree): FindWithById {
  const base = ((q: FindQuery): LiveTree | undefined => {
    const query = typeof q === "string" ? parse_selector(q) : q;
    const found = search_nodes([tree.node], query, { findFirst: true });
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

  // CHANGED: sugar parity with findAll
  base.byId = (id: string): LiveTree | undefined =>
    base({ attrs: { id } });

  base.byAttrs = (attr: string, value: string): LiveTree | undefined =>
    base({ attrs: { [attr]: value } });

  base.byFlags = (flag: string): LiveTree | undefined =>
    base({ attrs: { [flag]: flag } });

  base.byTag = (tag: string): LiveTree | undefined =>
    base({ tag });

  mustBase.byId = (id: string): LiveTree =>
    mustBase({ attrs: { id } });

  mustBase.byAttrs = (attr: string, value: string): LiveTree =>
    mustBase({ attrs: { [attr]: value } });

  mustBase.byFlags = (flag: string): LiveTree =>
    mustBase({ attrs: { [flag]: flag } });

  mustBase.byTag = (tag: string): LiveTree =>
    mustBase({ tag });

  base.must = mustBase;

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
            const found = search_nodes([tree.node], query, { findFirst: false });
            for (const node of found) out.push(wrap_in_tree(tree, node));
        }

        return make_tree_selector(out);
    }) as FindMany;

    const mustBase = ((q: FindQueryMany, label?: string): TreeSelector => {
        const sel = base(q);
        if (sel.count() === 0) {
            const desc = label ?? "query";
            throw new Error(`[LiveTree.findAll.must] expected >=1 match for ${desc}`);
        }
        return sel;
    }) as FindMany["must"];

    // CHANGED: make sure these param types are explicit (no implicit any)
    base.id = (ids: string | readonly string[]): TreeSelector => {
        const list: readonly string[] = Array.isArray(ids) ? ids : [ids];
        return base(list.map((id) => ({ attrs: { id } })));
    };

    base.byAttribute = (attr: string, value: string): TreeSelector =>
        base({ attrs: { [attr]: value } });

    base.byFlag = (flag: string): TreeSelector =>
        base({ attrs: { [flag]: flag } });

    base.byTag = (tag: string): TreeSelector =>
        base({ tag });

    mustBase.id = (ids: string | readonly string[]): TreeSelector => {
        const list: readonly string[] = Array.isArray(ids) ? ids : [ids];
        return mustBase(list.map((id) => ({ attrs: { id } })));
    };

    mustBase.byAttribute = (attr: string, value: string): TreeSelector =>
        mustBase({ attrs: { [attr]: value } });

    mustBase.byFlag = (flag: string): TreeSelector =>
        mustBase({ attrs: { [flag]: flag } });

    mustBase.byTag = (tag: string): TreeSelector =>
        mustBase({ tag });

    base.must = mustBase;

    return base;
}
