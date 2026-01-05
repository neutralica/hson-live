// style-manager.ts

import { HsonAttrs, HsonNode } from "../../../types-consts/node.types";
import { AllowedStyleKey, CssMap } from "../../../types-consts/css.types";
import { serialize_style } from "../../../utils/attrs-utils/serialize-style";
import { camel_to_kebab } from "../../../utils/attrs-utils/camel_to_kebab";
import { kebab_to_camel } from "../../../utils/primitive-utils/kebab-to-camel.util";
import { element_for_node } from "../../../utils/tree-utils/node-map-helpers";
import { LiveTree } from "../livetree";
import { make_style_setter, StyleSetter } from "./style-setter";

/* ------------------------------ RUNTIME KEYS -------------------------------- */

/**
 * Minimal fallback list of allowed style keys used when no DOM is present
 * (e.g. tests, server-side/Node environments).
 *
 * This list is intentionally small and generic but covers common layout,
 * typography, and transform properties so that style APIs remain usable
 * even without runtime probing.
 */
// TODO/BUG -- I am not sure I like this pattern 
const FALLBACK_KEYS: ReadonlyArray<AllowedStyleKey> = Object.freeze([
    "color",
    "backgroundColor",
    "borderColor",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "opacity",
    "display",
    "position",
    "top",
    "left",
    "right",
    "bottom",
    "width",
    "height",
    "margin",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "padding",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "transform",
]);

/**
 * Remove a single inline style declaration from a node and its DOM element.
 *
 * Behavior:
 * - Normalizes the internal key:
 *   - Custom properties (`--*`) are kept verbatim.
 *   - Normal properties are converted from kebab-case to camelCase to
 *     match the HSON style object shape.
 * - Updates the HSON model:
 *   - Deletes the property from `_attrs.style`.
 *   - Removes `_attrs.style` entirely if it becomes empty.
 * - Updates the DOM:
 *   - If an associated `HTMLElement` exists, calls
 *     `el.style.removeProperty(kebabName)`.
 *
 * @param node - The HSON node whose style should be updated.
 * @param kebabName - The CSS property name in kebab-case (or `--var` form).
 */
function removeStyleFromNode(node: HsonNode, kebabName: string): void {
    // 1) Normalize internal key (HSON uses camelCase for normal props, verbatim for custom)
    const internalKey =
        kebabName.startsWith("--")
            ? kebabName
            : kebab_to_camel(kebabName); // you already have this alongside camel_to_kebab

    // 2) Update node model (_attrs.style is CssObject now)
    const attrs = (node as any)._attrs as HsonAttrs | undefined;
    const styleObj = (attrs?.style as CssMap | undefined) ?? undefined;

    if (styleObj) {
        // drop from CssObject
        delete (styleObj as any)[internalKey];

        // if now empty, remove style entirely
        if (!Object.keys(styleObj).length) {
            if (attrs) {
                delete (attrs as any).style;
            }
        } else {
            if (attrs) {
                (attrs as any).style = styleObj;
            }
        }
    }

    // 3) Update DOM
    const el = element_for_node(node) as HTMLElement | undefined;
    if (!el) return;

    // Use DOM’s own removeProperty for the kebab name
    el.style.removeProperty(kebabName);
}

/**
 * Probe the runtime to discover supported style property keys.
 *
 * Behavior:
 * - If `document` or `document.documentElement` is unavailable, returns
 *   `FALLBACK_KEYS` (Node/tests).
 * - Otherwise:
 *   - Reads keys from `document.documentElement.style`.
 *   - Filters out `"cssText"` and any keys containing `"-"` (i.e. only
 *     keeps canonical camelCase properties).
 *   - Deduplicates and freezes the resulting array.
 *
 * The returned array is used to:
 * - Drive autocomplete and typing for `style.set` via `AllowedStyleKey`.
 * - Build the `StyleSetterFacade` proxy in a runtime-aware way.
 *
 * @returns A readonly array of allowed style keys for this runtime.
 */
function computeRuntimeKeys(): ReadonlyArray<AllowedStyleKey> {
    if (typeof document === "undefined" || !document.documentElement) {
        return FALLBACK_KEYS;
    }
    const style = document.documentElement.style;
    const raw = Object.keys(style as unknown as Record<string, unknown>);
    const filtered = raw.filter((k) => k !== "cssText" && !k.includes("-"));
    const typed = filtered.filter((k): k is AllowedStyleKey => true);
    return Object.freeze(Array.from(new Set(typed)));
}

/* --------------------------------- HELPERS ---------------------------------- */

/**
 * Normalize `node._attrs.style` to an object map of kebab keys to values.
 *
 * Behavior:
 * - If `a.style` is a string:
 *   - Parses it as CSS text (`"foo: bar; baz: qux"`).
 *   - Produces a `Record<string, string>` with trimmed keys and values.
 *   - Stores the object back into `a.style`.
 * - If `a.style` is already an object:
 *   - Returns it as `Record<string, string>`.
 * - If `a.style` is missing or falsy:
 *   - Creates a fresh object, assigns it to `a.style`, and returns it.
 *
 * This function provides a single normalization point so that the rest
 * of the style system can assume `_attrs.style` is an object.
 *
 * @param a - Attribute bag (typically `node._attrs`) to normalize.
 * @returns A mutable style object with kebab property keys.
 */
function ensureStyleObject(a: Record<string, unknown>): Record<string, string> {
    // prefer object going forward; upgrade string-once if present.
    const prev = a.style;
    if (typeof prev === "string") {
        const out: Record<string, string> = Object.create(null);
        const text = prev.trim();
        if (text) {
            for (const seg of text.split(";")) {
                const s = seg.trim();
                if (!s) continue;
                const idx = s.indexOf(":");
                if (idx <= 0) continue;
                const k = s.slice(0, idx).trim();
                const v = s.slice(idx + 1).trim();
                if (k) {
                    const storeKey = k.startsWith("--") ? k : kebab_to_camel(k);
                    out[storeKey] = v;
                }
            }
        }
        a.style = out;
        return out;
    }
    if (prev && typeof prev === "object") {
        const obj = prev as Record<string, string>;
        // normalize any kebab keys to camelCase once on read
        const needsNormalize = Object.keys(obj).some(k => k.includes("-"));
        if (!needsNormalize) return obj;

        const normalized: Record<string, string> = Object.create(null);
        for (const [k, v] of Object.entries(obj)) {
            const storeKey = k.startsWith("--") ? k : kebab_to_camel(k);
            normalized[storeKey] = v;
        }
        a.style = normalized;
        return normalized;
    }
    const fresh: Record<string, string> = Object.create(null);
    a.style = fresh;
    return fresh;
}

/**
 * Write a single style property to both DOM and HSON for a node.
 *
 * Behavior:
 * 1. DOM:
 *    - If an `HTMLElement` is mapped for the node:
 *      - `value === ""` → `el.style.removeProperty(kebabName)`.
 *      - Otherwise → `el.style.setProperty(kebabName, value)`.
 * 2. HSON:
 *    - Ensures `_attrs` exists and normalizes `_attrs.style` to an object
 *      via `ensureStyleObject`.
 *    - `value === ""`:
 *        - Deletes the key from the style object if present.
 *    - Otherwise:
 *        - Sets `styleObj[kebabName] = value`.
 *
 * This keeps the in-memory HSON representation and the live DOM
 * element in sync for the given property.
 *
 * @param node - The HSON node to update.
 * @param kebabName - CSS property name in kebab-case (or `--var` form).
 * @param value - The string value to assign; empty string removes the property.
 * @see ensureStyleObject
 */
function applyStyleToNode(node: HsonNode, kebabName: string, value: string): void {
    const el = element_for_node(node);

    // CHANGED: allow SVGElement too (and any Element with a style decl)
    if (el instanceof Element) {
        if (value === "") {
            (el as any).style.removeProperty(kebabName);
        } else {
            (el as any).style.setProperty(kebabName, value);
        }
    }

    // 2) mirror into node._attrs.style (object form) … unchanged
    const attrs = (node._attrs ??= {}) as Record<string, unknown>;
    const styleObj = ensureStyleObject(attrs);
    const internalKey = kebabName.startsWith("--") ? kebabName : kebab_to_camel(kebabName);

    if (value === "") {
        if (Object.prototype.hasOwnProperty.call(styleObj, internalKey)) {
            delete styleObj[internalKey];
        }
    } else {
        styleObj[internalKey] = value;
    }
}

/* --------------------------------- MANAGER ---------------------------------- */
/**
 * Inline style manager bound to a single `LiveTree` node.
 *
 * Responsibilities:
 * - Provides a typed, DX-friendly facade over inline styles via `set`
 *   and `setProperty`.
 * - Keeps HSON `_attrs.style` and the DOM element's `style` attribute
 *   in sync through helpers such as `applyStyleToNode` and
 *   `removeStyleFromNode`.
 * - Exposes runtime-derived style keys (via `keys()`) that represent
 *   the actual properties supported in the current environment.
 *
 * This manager is per-node: each `StyleManager` instance operates on
 * the `LiveTree` it was constructed with, not on selections.
 */
export class StyleManager {
    // accept the real LiveTree2; do not reference private methods.
    private readonly tree: LiveTree;
    private readonly runtimeKeys: ReadonlyArray<AllowedStyleKey>;
    // private readonly _set: StyleSetterFacade;
    public readonly setter: StyleSetter<LiveTree>;

    /**
     * Create a `StyleManager` for a given `LiveTree`.
     *
     * Implementation details:
     * - Stores the `LiveTree` instance for all subsequent style operations.
     * - Computes `runtimeKeys` once via `computeRuntimeKeys()`, probing the
     *   runtime for supported style properties.
     * - Builds `setter` via `make_style_setter`, producing a fluent style API.
     *
     * @param tree - The `LiveTree` whose node (and mapped DOM element) will
     *               be styled by this manager.
     * @see computeRuntimeKeys
     * @see make_style_setter
     */
    constructor(tree: LiveTree) {
        this.tree = tree;
        // compute keys once (DOM probe if available).
        this.runtimeKeys = computeRuntimeKeys();
        // build the proxy using those keys.
        // this._set = buildSetFacade(this.tree, this.runtimeKeys);
        this.setter = make_style_setter<LiveTree>(
            tree,
            {
            // OPTIONAL: if you have runtimeKeys in camelCase, feed them
            keys: this.runtimeKeys,

            apply: (propCanon, value) => {
                // assumes setProperty accepts canonical camelCase or --var
                this.apply(propCanon, value);
            },

            remove: (propCanon) => {
                this.remove(propCanon);
            },

            clear: () => {
                this.clearAll();
            },
        });
    }

    /**
     * Set a single inline style property on this node.
     *
     * Behavior:
     * - Accepts property names in camelCase or kebab-case.
     *   - CamelCase names are normalized to kebab-case via `camel_to_kebab`,
     *     except for custom properties starting with `--`, which are left
     *     as-is.
     * - `value`:
     *   - `null` or `undefined` → treated as `""` and removes the declaration.
     *   - string/number → converted to string and applied as-is (units are
     *     the caller's responsibility).
     * - Delegates to `applyStyleToNode`, which updates both the HSON node
     *   and the corresponding DOM element.
     *
     * @param propertyName - CSS property name in camelCase or kebab-case.
     * @param value - New value for the property, or `null` to remove it.
     * @returns The underlying `LiveTree` instance, for chaining.
     * @see applyStyleToNode
     */
    private apply(propertyName: string, value: string | number | null): LiveTree {

        const kebab = propertyName.startsWith("--")
            ? propertyName
            : camel_to_kebab(propertyName);

        const val = value == null ? "" : String(value);
        applyStyleToNode(this.tree.node, kebab, val);
        const el = this.tree.asDomElement() as any;
        return this.tree;
    }

    /**
     * Remove a single inline style property from this node.
     *
     * Behavior:
     * - Normalizes the property name from camelCase to kebab-case (except
     *   for `--custom` variables).
     * - Delegates to `removeStyleFromNode`, which clears the property from
     *   the node's style object and the DOM `style` attribute.
     *
     * This is equivalent to calling `setProperty(propertyName, null)` but
     * uses the dedicated removal pathway.
     *
     * @param propertyName - CSS property name in camelCase or kebab-case.
     * @returns The underlying `LiveTree` instance, for chaining.
     * @see removeStyleFromNode
     */
    private remove(propertyName: string): LiveTree {
        const kebab = camel_to_kebab(propertyName);
        const node = this.tree.node;
        removeStyleFromNode(node, kebab);

        return this.tree;
    }

    /**
     * Remove all inline style state from the current tree node.
     *
     * This clears style at both layers:
     * - the internal HSON representation (`node._attrs.style`), and
     * - the live DOM element’s inline `style` attribute, if present.
     *
     * This method is intentionally **destructive and local**:
     * - it does not affect QUID-scoped CSS rules managed by `CssManager`,
     * - it does not traverse or modify child nodes,
     * - it does not trigger any re-rendering beyond the immediate DOM mutation.
     *
     * It is used internally to support operations like `cssReplace`, reset-style
     * semantics, or teardown paths where inline styles must be fully discarded.
     *
     * If the node has no attributes or no associated DOM element, the operation
     * is a no-op.
     */
    private clearAll(): void {
        const node = this.tree.node;
        if (!node._attrs) return;

        const attrs = node._attrs as HsonAttrs;
        delete (attrs as any).style;

        const el = element_for_node(node) as HTMLElement | undefined;
        if (el) el.removeAttribute("style");
    }

}
