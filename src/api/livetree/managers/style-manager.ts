import { assert_mutation_publication_available } from "../lifecycle/mutation-publication.js";
import {
  active_subject_for_tree,
} from "../runtime/livetree-runtime.js";
// style-manager.ts

import { HsonAttrs, HsonNode, type CanonicalPublicAttrs } from "../../../core/types.js";
import { AllowedStyleKey, CssMap, CssVarFacade } from "../../../types/css.types.js";
import { kebab_to_camel } from "../../transform/utils/primitive-utils/kebab-to-camel.util.js";
import { get_el_for_node } from "../utils/node-map-helpers.js";
import { LiveTree } from "../livetree.js";
import { make_css_var_facade, make_style_setter, StyleSetter } from "./style-setter.js";
import { make_style_get_many, make_style_getter, StyleGetMany, StyleGetter } from "./style-getter.js";
import { ensure_node_attrs, prune_empty_node_attrs } from "../../../core/node-storage.js";
import { document_binding_for_node } from "../lifecycle/document-binding-state.js";
import { begin_mutation_publication } from "../lifecycle/mutation-publication.js";
import { parse_style_string } from "../../transform/utils/attrs-utils/parse-style.js";
import { serialize_style, inline_css_native_name } from "../../transform/utils/attrs-utils/serialize-style.js";
import { assert_inline_css_order, assert_inline_css_value, assert_inline_css_trim_safe, InlineCssError } from "../../../internal/css/inline-css.js";
import { canonical_public_attrs_equal, decode_public_attrs } from "../../../core/public-attrs.js";
import { render_css_declaration_value, is_typed_css_value } from "../../../core/inline-style.js";

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

export const parse_style_attr = (raw: string | undefined): Map<string, string> =>
    new Map(Object.entries(parse_style_string(raw ?? "")).map(([key, value]) =>
        [inline_css_native_name(key), value]));

function assertInlineProjectionSafe(value: unknown): void {
    if (typeof value === "string") assert_inline_css_trim_safe(value);
    else if (is_typed_css_value(value)) {
        if (typeof value.value === "string") assert_inline_css_trim_safe(value.value);
        if ("unit" in value && typeof value.unit === "string" && value.unit !== "_") {
            assert_inline_css_trim_safe(String(value.value) + value.unit);
        }
    }
}


function readStyleFromNode(node: HsonNode, propCanon: string): string | undefined {
    const attrs = node.$_attrs as HsonAttrs | undefined;
    const raw = attrs?.style;

    const kebabKey = inline_css_native_name(propCanon);

    if (raw && typeof raw === "object") {
        const styleObj = raw as CssMap;

        const direct = styleObj[propCanon as keyof CssMap];
        if (typeof direct === "string") return direct;
        const alias = Object.keys(styleObj).find(key => inline_css_native_name(key) === kebabKey);
        const value = alias === undefined ? undefined : styleObj[alias];
        return typeof value === "string" ? value : undefined;
    }

    if (typeof raw === "string") {
        const map = parse_style_attr(raw);
        return map.get(kebabKey);
    }

    return undefined;
}

function readAllStyleFromNode(node: HsonNode): StyleGetMany {
    const styleObj = readCanonicalStyleFromNode(node);
    const out: Record<string, string> = {};

    for (const [key, value] of Object.entries(styleObj)) {
        if (typeof value === "string") out[key] = value;
    }

    return out;
}

/** Read the complete canonical declaration bag without normalizing its values. */
function readCanonicalStyleFromNode(node: HsonNode): CssMap {
    const attrs = node.$_attrs as HsonAttrs | undefined;
    const raw = attrs?.style;

    if (raw && typeof raw === "object") {
        return { ...(raw as CssMap) };
    }

    if (typeof raw === "string") {
        const out: Record<string, string> = {};
        const map = parse_style_attr(raw);

        for (const [key, value] of map.entries()) {
            const storeKey = key.startsWith("-") ? key : kebab_to_camel(key);
            out[storeKey] = value;
        }
        return out;
    }

    return {};
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

/* --------------------------------- MANAGER ---------------------------------- */
/**
 * Inline style manager bound to a single `LiveTree` node.
 *
 * Responsibilities:
 * - Provides a typed, DX-friendly facade over inline styles via `set`
 *   and `setProperty`.
 * - Keeps Hson `$_attrs.style` and the DOM element's `style` attribute
 *   in sync by preflighting and publishing one complete retained state.
 * - Exposes runtime-derived style keys (via `keys()`) that represent
 *   the actual properties supported in the current environment.
 *
 * This manager is per-node: each `StyleManager` instance operates on
 * the `LiveTree` it was constructed with, not on selections.
 */
export class StyleManager<TTree extends LiveTree> {
    private readonly tree: TTree;
    private readonly runtimeKeys: ReadonlyArray<AllowedStyleKey>;
    public readonly setter: StyleSetter<TTree>;

    // read surface mirrors setter pattern
    public readonly getter: StyleGetter;
    /** Bulk-read declarations from this inline style scope. */

    public readonly getMany: () => StyleGetMany;
    /** Unified custom-property helper for this inline style scope. */
    public readonly var: CssVarFacade<TTree>;

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
    constructor(tree: TTree) {
        this.tree = tree;
        this.runtimeKeys = computeRuntimeKeys();

        this.setter = make_style_setter<TTree>(tree, {
            keys: this.runtimeKeys,
            normalizeKey: key => key,
            validateValue: assertInlineProjectionSafe,

            apply: (propCanon, value) => {
                this.apply(propCanon, value);
            },

            applyMany: (values) => {
                this.applyMany(values);
            },

            remove: (propCanon) => {
                this.remove(propCanon);
            },

            clear: () => {
                this.clearAll();
            },
        });
        // getter reads from the node’s style attr (internal truth)
        const getterAdapters = {
            read: (propCanon: string) => readStyleFromNode(active_subject_for_tree(this.tree), propCanon),
            readMany: () => readAllStyleFromNode(active_subject_for_tree(this.tree)),
        };

        this.getter = make_style_getter(getterAdapters);
        this.getMany = make_style_get_many(getterAdapters);
        this.var = make_css_var_facade<TTree>(
            this.tree,
            (name, value) => this.setter.set.var(name, value),
            // CHANGED: `.var.value()` should not route through the public `get`
            // surface. `get.var()` is being removed; this reads the inline-style
            // backend directly.
            (name) => readStyleFromNode(active_subject_for_tree(this.tree), name),
        );
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
     * - Preflights one CSS value and its ordering before publishing the
     *   complete style attribute and retained graph state.
     *
     * @param propertyName - CSS property name in camelCase or kebab-case.
     * @param value - New value for the property, or `null` to remove it.
     * @returns The underlying `LiveTree` instance, for chaining.
     */
    private apply(propertyName: string, value: string | number | null): LiveTree {
        const values: Record<string, string> = {};
        Object.defineProperty(values, propertyName, { value: value == null ? "" : String(value), enumerable: true });
        return this.applyMany(values);
    }

    /** Preflight the complete batch, then publish one graph/native final state. */
    private applyMany(values: Readonly<Record<string, string>>): LiveTree {
        const subject = active_subject_for_tree(this.tree);
        assert_mutation_publication_available(subject);
        if (Object.keys(values).length === 0) return this.tree;
        const stored = subject.$_attrs?.style;
        if (stored !== undefined && (stored === null || typeof stored !== "object" && typeof stored !== "string")) {
            throw new InlineCssError("INLINE_CSS_UNSUPPORTED", "Scalar style storage is not a declaration map; use attribute replacement or style.clear().");
        }
        const changes = new Map<string, string>();
        for (const [name, value] of Object.entries(values)) {
            const input = name.trim();
            const property = /^(?:cssfloat|css-float)$/i.test(input) ? "float" : inline_css_native_name(input);
            if (changes.has(property)) throw new InlineCssError("INLINE_CSS_UNSUPPORTED", "Inline CSS batch property names collide at the native property boundary.");
            if (value !== "") {
                assert_inline_css_value(property, value);
            }
            const key = property.startsWith("-") ? property : kebab_to_camel(property);
            changes.set(property, value === "" ? "" : parse_style_string(`${property}:${value}`)[key]);
        }
        const plan = (current: CssMap): CssMap => {
            const remaining = { ...current };
            let changed = false;
            const additions: string[] = [];
            const writes: [string, string][] = [];
            for (const [property, value] of changes) {
                const aliases = Object.keys(current).filter(key => inline_css_native_name(key) === property);
                if (aliases.length === 1 && current[aliases[0]] === value || aliases.length === 0 && value === "") continue;
                changed = true;
                for (const key of aliases) delete remaining[key];
                if (value !== "") {
                    additions.push(property);
                    writes.push([aliases[0] ?? (property.startsWith("-") ? property : kebab_to_camel(property)), value]);
                }
            }
            if (!changed) return remaining;
            for (const value of Object.values(remaining)) assertInlineProjectionSafe(value);
            const retained = Object.keys(remaining).filter(key => Boolean(render_css_declaration_value(remaining[key]))).map(inline_css_native_name).sort();
            if (new Set([...retained, ...additions]).size !== retained.length + additions.length) {
                throw new InlineCssError("INLINE_CSS_UNSUPPORTED", "Style property names collide during CSS projection.");
            }
            assert_inline_css_order([...retained, ...additions]);
            for (const [key, value] of writes) {
                Object.defineProperty(remaining, key, { value, enumerable: true, writable: true, configurable: true });
            }
            return remaining;
        };
        const binding = document_binding_for_node(subject);
        if (binding !== undefined) {
            binding.delegateAttrs({ kind: "transform", apply: (attrs: CanonicalPublicAttrs) => {
                const raw = attrs.style;
                const current = typeof raw === "string" ? parse_style_string(raw)
                    : typeof raw === "object" && raw !== null ? raw : {};
                const next = plan(current);
                return Object.keys(next).length === 0
                    ? { kind: "drop", name: "style" }
                    : { kind: "set", name: "style", value: next };
            } });
        } else this.publishStyle(plan(readCanonicalStyleFromNode(subject)));
        return this.tree;
    }

    private publishStyle(style: CssMap): void {
        const subject = active_subject_for_tree(this.tree);
        const current = decode_public_attrs(subject.$_attrs ?? {});
        const next = decode_public_attrs(Object.keys(style).length ? { ...subject.$_attrs, style }
            : Object.fromEntries(Object.entries(subject.$_attrs ?? {}).filter(([key]) => key !== "style")));
        if (current && next && canonical_public_attrs_equal(current, next)) return;
        const css = serialize_style(style);
        const element = get_el_for_node(subject);
        const previous = element?.getAttribute("style") ?? null;
        const finish = begin_mutation_publication([subject]);
        try {
            if (element) {
                if (css) element.setAttribute("style", css);
                else element.removeAttribute("style");
            }
            if (Object.keys(style).length) ensure_node_attrs(subject).style = style;
            else if (subject.$_attrs) { delete subject.$_attrs.style; prune_empty_node_attrs(subject); }
        } catch (error) {
            if (element && element.getAttribute("style") !== previous) {
                if (previous === null) element.removeAttribute("style");
                else element.setAttribute("style", previous);
            }
            throw error;
        } finally { finish(); }
    }

    /**
    * Remove a single inline style property from this node.
    *
    * Behavior:
    * - Normalizes the property name from camelCase to kebab-case (except
    *   for `--custom` variables).
    * - Publishes the remaining complete style map to graph and DOM.
    *
    * This is equivalent to calling `setProperty(propertyName, null)` but
    * uses the dedicated removal pathway.
    *
    * @param propertyName - CSS property name in camelCase or kebab-case.
    * @returns The underlying `LiveTree` instance, for chaining.
    */
    private remove(propertyName: string): LiveTree {
        return this.apply(propertyName, "");
    }


    /**
     * Remove all inline style state from the current tree node.
     *
     * This clears style at both layers:
     * - the internal Hson representation (`node.$_attrs.style`), and
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
        const subject = active_subject_for_tree(this.tree);
        assert_mutation_publication_available(subject);
        if (document_binding_for_node(subject) !== undefined) this.tree.attrs.drop("style");
        else this.publishStyle({});
    }
}
