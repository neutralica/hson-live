// data-manager.utils.ts

import { Primitive } from "../../../types-consts/core.types";
import { camel_to_kebab } from "../../../utils/attrs-utils/camel_to_kebab";
import { LiveTree } from "../livetree";


export type DatasetValue = Primitive | undefined;
export type DatasetObj = Record<string, DatasetValue>;

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
export class DataManager {
    private liveTree: LiveTree;

    /**
     * Creates a DataManager for a specific LiveTree.
     *
     * @param liveTree - The LiveTree whose current selection determines
     *   which nodes receive data-attribute updates.
     */
    constructor(liveTree: LiveTree) {
        this.liveTree = liveTree;
    }

    // normalize data key → data-* attribute name
    private formatData(key: string): string {
        // "userId" → "data-user-id"
        const kebab = camel_to_kebab(key);   // you already have this
        return `data-${kebab}`;
    }

    /**
     * Sets or removes a `data-*` attribute on all selected nodes.
     *
     * @param key - Logical name (e.g. `"userId"`). It will be normalized
     *   to kebab-case and prefixed with `"data-"`, producing
     *   `data-user-id`.
     *
     * @param value - New value. `null` removes the attribute.
     *
     * Behavior:
     *   - Delegates to `LiveTree.setAttrs`, ensuring both IR and DOM remain
     *     in sync.
     *   - Returns the underlying LiveTree to support chaining.
     *
     * Important:
     *   This uses the literal `"data-"` prefix — this is *not* the internal
     *   HSON metadata prefix and should not be renamed.
     */
    set(key: string, value: DatasetValue): LiveTree {
        const attrName = this.formatData(key); // "state" → "data-state"

        // null/undefined → remove the data-* attribute entirely
        if (value === null || value === undefined) {
            this.liveTree.setAttrs(attrName, null);
            return this.liveTree;
        }

        // everything else → string
        this.liveTree.setAttrs(attrName, String(value));
        return this.liveTree;
    }

    // 2) Multiple keys at once
    setMany(map: DatasetObj): LiveTree {
        const patch: Record<string, string | null> = {};

        for (const [key, value] of Object.entries(map)) {
            const attrName = this.formatData(key);

            if (value === null || value === undefined) {
                patch[attrName] = null;          // remove this data-* attr
            } else {
                patch[attrName] = String(value); // write as string
            }
        }

        if (Object.keys(patch).length > 0) {
            this.liveTree.setAttrs(patch);
        }

        return this.liveTree;
    }

    /**
     * Reads a `data-*` attribute from the first selected node.
     *
     * @param key - Attribute suffix (e.g. `"user-id"` or `"state"`). This
     *   method does not currently apply camel→kebab normalization.
     *
     * @returns The stored primitive string value, or `undefined` if the
     *   attribute does not exist or there is no selection.
     *
     * Notes:
     *   - Only inspects the first selected node.
     *   - Delegates to `LiveTree.getAttr`, which reads from the IR (not
     *     computed DOM attributes).
     *
     * Important:
     *   This uses the literal `"data-"` prefix — not the HSON metadata prefix.
     */
    get(key: string): Primitive | undefined {
        const dataAttrName = `data-${key}`;
        return this.liveTree.getAttr(dataAttrName);
    }
}
