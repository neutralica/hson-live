// tree-selector.ts

import { LiveTree } from "../livetree";
import { TreeSelector } from "../tree-selector-2";

/**
 * Construct a `TreeSelector2` over a set of `LiveTree` instances.
 *
 * The selector keeps a defensive copy and exposes iteration helpers,
 * plus broadcast proxies for `listen`, `style`, `css`, and `data`.
 */
export function make_tree_selector(trees: LiveTree[]): TreeSelector {
  return new TreeSelector(trees);
}
