// data-manager.utils.ts

import { Primitive } from "../../../core/types.js";
import { AttrValue } from "../../../core/types.js";
import { camel_to_kebab } from "../../transform/utils/attrs-utils/camel_to_kebab.js";
import { LiveTree } from "../livetree.js";
import { removeAttrImpl, setAttrsImpl, getAttrImpl } from "./attr-handle.js";


export type DatasetValue = AttrValue;
export type DatasetMap = Record<string, DatasetValue>;

export interface DataApi<TTree> {
    set(key: string, value: DatasetValue): TTree;
    setMany(map: DatasetMap): TTree;
    get(key: string): Primitive | undefined;
    drop(key: string): TTree;
}

// /**
//  * DataManager(2)
//  * --------------
//  * A lightweight helper for manipulating `data-*` attributes on a LiveTree node/s.
//  *
//  * This is conceptually similar to `HTMLElement.dataset`, but with two key
//  * differences:
//  *
//  *   1. It operates on *HSON nodes*, not DOM elements.
//  *      (When nodes are mounted, DOM attributes are also synced.)
//  *
//  *   2. Keys are provided in logical form (e.g. `"userId"`), and the manager
//  *      automatically normalizes to real HTML attribute names
//  *      (`data-user-id`).
//  *
//  * Usage:
//  *   tree.data.set("userId", "42");
//  *   const user = tree.data.get("userId");
//  *
//  * Behavior notes:
//  *   - `null` removes the attribute.
//  *   - Reads (`get`) reflect the first selected node.
//  *   - No attempt is made to coerce to/from numbers; everything is stored
//  *     as strings, matching real HTML.
//  */

// export class DataManager<TTree extends LiveTree> {
//     private liveTree: TTree;

//     constructor(liveTree: TTree) {
//         this.liveTree = liveTree;
//     }

//     private formatData(key: string): string {
//         const raw = String(key).trim();

//         if (!raw) {
//             throw new Error("Dataset key must be non-empty");
//         }

//         const kebab = camel_to_kebab(raw).trim();

//         if (!kebab) {
//             throw new Error("Dataset key must normalize to a non-empty name");
//         }

//         return `data-${kebab}`;
//     }

//     set(key: string, value: DatasetValue): TTree {
//         const attrName = this.formatData(key);

//         if (value === null || value === undefined) {
//             removeAttrImpl(this.liveTree, attrName);
//             return this.liveTree;
//         }

//         setAttrsImpl(this.liveTree, attrName, String(value));
//         return this.liveTree;
//     }

//     setMany(map: DatasetMap): TTree {
//         for (const [key, value] of Object.entries(map)) {
//             this.set(key, value);
//         }

//         return this.liveTree;
//     }

//     get(key: string): Primitive | undefined {
//         const attrName = this.formatData(key);
//         const value = getAttrImpl(this.liveTree, attrName);

//         return value;
//     }
// }

/* replacement for above class: */
export function make_data_api<TTree extends LiveTree>(tree: TTree): DataApi<TTree> {
    const formatData = (key: string): string => {
        const raw = String(key).trim();

        if (!raw) {
            throw new Error("Dataset key must be non-empty");
        }

        const kebab = camel_to_kebab(raw).trim();

        if (!kebab) {
            throw new Error("Dataset key must normalize to a non-empty name");
        }

        return `data-${kebab}`;
    };

    const setOne = (key: string, value: DatasetValue): TTree => {
        const attrName = formatData(key);

        if (value === null || value === undefined) {
            removeAttrImpl(tree, attrName);
            return tree;
        }

        setAttrsImpl(tree, attrName, String(value));
        return tree;
    };

    return {
        set: (key, value) => {
            return setOne(key, value);
        },

        setMany: (map) => {
            for (const [key, value] of Object.entries(map)) {
                setOne(key, value);
            }

            return tree;
        },

        get: (key) => {
            const attrName = formatData(key);
            const value = getAttrImpl(tree, attrName);

            return value;
        },

        drop: (key) => {
            const attrName = formatData(key);
            removeAttrImpl(tree, attrName);

            return tree;
        },
    };
}