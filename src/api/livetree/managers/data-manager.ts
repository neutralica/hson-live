// data-manager.utils.ts

import { Primitive } from "../../../types/core.types.js";
import { AttrValue } from "../../../types/node.types.js";
import { camel_to_kebab } from "../../../utils/attrs-utils/camel_to_kebab.js";
import { LiveTree } from "../livetree.js";


export type DatasetValue = Primitive | undefined;
export type DatasetObj = Record<string, DatasetValue>;
type DataTreeLike<TOwner> = {
  attr: {
    set: (name: string, value: AttrValue) => TOwner;
    get: (name: string) => Primitive | undefined;
  };
};

/**
 * DataManager(2)
 * --------------
 * A lightweight helper for manipulating `data-*` attributes on a LiveTree node/s.
 *
 * This is conceptually similar to `HTMLElement.dataset`, but with two key
 * differences:
 *
 *   1. It operates on *HSON nodes*, not DOM elements.
 *      (When nodes are mounted, DOM attributes are also synced.)
 *
 *   2. Keys are provided in logical form (e.g. `"userId"`), and the manager
 *      automatically normalizes to real HTML attribute names
 *      (`data-user-id`).
 *
 * Usage:
 *   tree.data.set("userId", "42");
 *   const user = tree.data.get("userId");
 *
 * Behavior notes:
 *   - `null` removes the attribute.
 *   - Reads (`get`) reflect the first selected node.
 *   - No attempt is made to coerce to/from numbers; everything is stored
 *     as strings, matching real HTML.
 */
export class DataManager<TTree extends DataTreeLike<TTree>> {
  private liveTree: TTree;

  constructor(liveTree: TTree) {
    this.liveTree = liveTree;
  }

  private formatData(key: string): string {
    const raw = String(key).trim();
    if (!raw) {
      throw new Error("Dataset key must be non-empty");
    }

    const kebab = camel_to_kebab(raw).trim();
    if (!kebab) {
      throw new Error("Dataset key must normalize to a non-empty name");
    }

    return `data-${kebab}`;
  }

  set(key: string, value: DatasetValue): TTree {
    const attrName = this.formatData(key);

    if (value === null || value === undefined) {
      this.liveTree.attr.set(attrName, null);
      return this.liveTree;
    }

    this.liveTree.attr.set(attrName, String(value));
    return this.liveTree;
  }

  setMany(map: DatasetObj): TTree {
    for (const [key, value] of Object.entries(map)) {
      const attrName = this.formatData(key);

      if (value === null || value === undefined) {
        this.liveTree.attr.set(attrName, null);
      } else {
        this.liveTree.attr.set(attrName, String(value));
      }
    }

    return this.liveTree;
  }

  get(key: string): Primitive | undefined {
    const attrName = this.formatData(key); // be consistent with set()
    return this.liveTree.attr.get(attrName);
  }
}