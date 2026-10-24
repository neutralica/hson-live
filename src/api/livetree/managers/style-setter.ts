import { assert_css_declaration_syntax } from "../../../internal/css/declaration-syntax.js";
import { normalize_css_map, css_property, css_declaration, css_data_entries, CSS_PSEUDOS, type NormalizedCssMap } from "../../../core/css-map.js";
import { append_css_pseudo, relative_css_selector } from "../../../internal/css/relative-selector.js";
// style-setter.ts

import { CssKey, CssMap, CssMapBase, CssPseudoKey, CssValue, CssVarFacade, CssVarName, SetSurface } from "../../../types/css.types.js";
import type { CssMapInputCheck, CssRelativeMap } from "../../../core/style.types.js";
import { is_css_declaration_value, render_css_declaration_value } from "../../../core/inline-style.js";
import { normalize_css_key, canon_to_css_prop } from "../../transform/utils/attrs-utils/normalize-css.js";
import { normalize_css_var_name } from "./style-getter.js";


// type guard for structured CssValue object
const isCssValue = (v: unknown): v is CssValue => {
  return typeof v !== "boolean" && is_css_declaration_value(v);
};

export function css_supports_decl(propCanon: string, value: string): boolean {
  // Custom props: allow through
  if (propCanon.startsWith("--")) return true;

  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return true;
  }

  const cssProp = canon_to_css_prop(propCanon);

  try {
    return CSS.supports(cssProp, value);
  } catch {
    return false;
  }
}

// generic “proxy surface” builder 
export function make_set_surface<TReturn>(
  setProp: (prop: CssKey, v: CssValue) => TReturn,
): SetSurface<TReturn> {
  return new Proxy({} as SetSurface<TReturn>, {
    get(_t, rawKey: string | symbol) {
      if (rawKey === "var") {
        // changed: match css.get.var; accept "--x", "-x", or "x".
        return (name: string, v: CssValue) => {
          const canon = normalize_css_var_name(name);
          if (!canon) return setProp("--invalid-css-var-name", v);
          return setProp(canon, v);
        };
      }

      if (typeof rawKey !== "string") return undefined;

      // changed: bracket access to custom props uses the same var normalizer.
      if (rawKey.startsWith("--")) {
        return (v: CssValue) => {
          const canon = normalize_css_var_name(rawKey);
          if (!canon) return setProp("--", v);
          return setProp(canon, v);
        };
      }

      return (v: CssValue) => setProp(rawKey, v);
    },
  });
}

/**
 * Create the canonical custom-property facade for a style-like handle.
 *
 * This helper is backend-neutral: inline style, QUID-scoped CSS, and global CSS
 * can expose the same `.var.name/key/set/value` shape while wiring `set` and
 * `value` to their own storage scopes.
 */
export function make_css_var_facade<TReturn>(
  host: TReturn,
  setVar: (name: string, value: CssValue) => TReturn,
  readVar: (name: string) => string | undefined,
): CssVarFacade<TReturn> {
  const canonName = (name: string): CssVarName => {
    const canon = normalize_css_var_name(name);
    if (!canon) throw new Error(`invalid CSS custom property name: ${name}`);
    return canon as CssVarName;
  };

  return {
    name: (name: string): CssVarName => canonName(name),
    key: (name: string): `var(${CssVarName})` => `var(${canonName(name)})`,
    set: (name: string, value: CssValue): TReturn => setVar(canonName(name), value),
    value: (name: string): string | undefined => readVar(canonName(name)),
  };
}

const isInvalidCssVarName = (propCanon: string): boolean => propCanon === "--invalid-css-var-name";

/**
 * Fluent write surface for styles.
 *
 * A `StyleSetter` is a *handle* bound to some target (one element’s inline style,
 * one QUID-scoped CSS rule block, a multi-selection broadcast, etc.).
 *
 * The same API is used across backends; differences live behind `StyleSetterAdapters`.
 *
 * - `setProp` / `setMany` write values.
 * - `remove` deletes a single property.
 * - `clear` deletes all properties for the handle.
 * - `set` is a Proxy-based convenience surface (`setter.set.backgroundColor("...")`).
 *
 * All methods return the same `StyleSetter` for chaining.
 */
export type StyleSetter<TReturn> = {
  /** Proxy builder: setter.set.backgroundColor("aquamarine") */
  set: SetSurface<TReturn>;

  setProp: (prop: CssKey, v: CssValue) => TReturn;
  setMany: <const T extends CssRelativeMap>(map: T & CssMapInputCheck<NoInfer<T>, false, false>) => TReturn;
  remove: (prop: CssKey) => TReturn;
  clear: () => TReturn;
};

/**
 * Backend interface used by `make_style_setter()` to perform actual writes.
 *
 * This is the “bridge” between the generic fluent API (`StyleSetter`) and a concrete style backend
 * (inline style via `StyleManager`, QUID-scoped stylesheet rules via `CssManager`, etc.).
 *
 * ## Invariants expected by implementers
 * - `propCanon` is already normalized to canonical CSS form (camelCase or `--custom-prop`).
 * - `value` is already rendered to a string (no additional coercion should be needed).
 * - `remove()` and `clear()` should be idempotent (safe to call repeatedly).
 *
 * Implementers are responsible for:
 * - choosing the storage/write strategy (DOM `style=""`, CSSStyleRule text, etc.),
 * - ensuring the target exists (or no-op if it does not),
 * - updating any “dirty” flags / re-render triggers used by the backend.
 */
export type StyleSetterAdapters = Readonly<{
  /**
   * Apply a single *canonical* property (camelCase or --var) with a rendered string value.
   * `value` is already normalized/rendered when this is called.
   */
  apply: (propCanon: string, value: string) => void;
  /** Inline-only batch publication; other stylesheet backends keep their rules. */
  applyMany?: (values: Readonly<Record<string, string>>) => void;
  /** Inline-specific input qualification before shared CSS value projection. */
  normalizeKey?: (key: string) => string;
  validateValue?: (value: CssValue) => void;

  /** Remove a single *canonical* property. */
  remove: (propCanon: string) => void;

  /** Clear all properties for this handle. */
  clear: () => void;

  /**
   * Optional: handle pseudo-blocks passed via `setMany`.
   *
   * When provided, `make_style_setter` will treat entries whose keys match
   * `CssPseudoKey` (e.g. `_hover`, `__before`) as nested declaration maps
   * and route them here instead of applying them as regular properties.
   */
  applyPseudo?: (pseudo: CssPseudoKey, decls: CssMapBase) => void;

  applySelector?: (pattern: string, decls: CssMapBase) => void;

  /** Pure branch composition in this receiver's actual publication context. */
  resolveBranch?: (key: string) => string;

}>;

/** Use the same branch spelling and composition for preflight and publication. */
export function style_branch_pattern(key: string): string {
  return Object.hasOwn(CSS_PSEUDOS, key) ? `&${CSS_PSEUDOS[key]}` : key;
}

export function compose_style_branch(selector: string, key: string): string {
  return Object.hasOwn(CSS_PSEUDOS, key)
    ? append_css_pseudo(selector, CSS_PSEUDOS[key])
    : relative_css_selector(key, selector);
}

/** Pure complete preparation; publication adapters are never invoked here. */
export function prepare_style_map(map: CssMap, adapters: StyleSetterAdapters): NormalizedCssMap {
  const normalized = normalize_css_map(map, false);
  // Inline projection must inspect original lexical boundaries before shared trimming.
  const validateOriginal = (value: unknown): void => {
    for (const [, item] of css_data_entries(value)) {
      if (item === undefined) continue;
      if (isCssValue(item)) adapters.validateValue?.(item);
      else validateOriginal(item);
    }
  };
  if (adapters.validateValue) validateOriginal(map);
  const validate = (
    value: NormalizedCssMap,
    resolveBranch = adapters.resolveBranch,
  ): void => {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") {
        if (!adapters.applyMany && item !== "") assert_css_declaration_syntax(key, item);
        adapters.validateValue?.(item);
      } else {
        if (Object.hasOwn(CSS_PSEUDOS, key)) {
          if (!adapters.applyPseudo) throw new TypeError("Inline style does not support pseudo declarations.");
        } else {
          if (!adapters.applySelector) throw new TypeError("This CSS handle does not support relative selectors.");
        }
        if (!resolveBranch) throw new TypeError("This CSS handle has no selector context.");
        const selector = resolveBranch(key);
        // Branch adapters publish through a global rule handle thereafter.
        validate(item, child => compose_style_branch(selector, child));
      }
    }
  };
  validate(normalized);
  return normalized;
}

/**
 * Create a `StyleSetter`: a small, fluent, backend-agnostic “write surface” for CSS style.
 *
 * ## What this is
 * `StyleSetter` is intentionally dumb: it holds no state and performs no DOM/CSSOM logic
 * itself. It only:
 *  1) normalizes property keys to a canonical CSS form, and
 *  2) renders/coerces values into strings (or “remove”),
 * then delegates the actual write/remove/clear work to the provided `adapters`.
 *
 * ## Where it sits in the system (wiring diagram)
 * - `LiveTree.style` / `TreeSelector.style` returns a StyleSetter backed by a
 *   `StyleManager` adapter (inline style on the element).
 * - `LiveTree.css` / `TreeSelector.css` typically returns a StyleSetter backed by a
 *   `CssManager` adapter (QUID-scoped rules in a stylesheet).
 *
 * This means: the same API (setProp/setMany/remove/clear and the `setter.set.*` proxy)
 * can be used regardless of whether the underlying mechanism is inline styles or stylesheet rules.
 *
 * ## Adapter contract (important invariants)
 * The adapters are called with:
 * - `propCanon`: already normalized to canonical CSS form (camelCase or `--custom-prop`).
 * - `value`: a rendered string value (already normalized/coerced by `renderCssValue()`).
 *
 * Adapters should treat these as “ready to apply”:
 * - `apply(propCanon, value)` must perform the write for that backend.
 * - `remove(propCanon)` must delete/unset that property for that backend.
 * - `clear()` must remove all properties for that handle/backend target.
 *
 * `make_style_setter()` guarantees:
 * - `setProp` retains null/undefined deletion; `setMany` omits undefined and rejects null.
 * - keys passed via proxy or map entries are normalized via `normalize_css_prop_key()`.
 *
 * ## Pseudo blocks in `setMany`
 * If `setMany` receives keys that match `CssPseudoKey`, their values are
 * interpreted as nested declaration maps (not as `CssValue`s). Those maps
 * are forwarded to `adapters.applyPseudo` when available; otherwise they
 * rejected. Supported branches are recursively preflighted before publication.
 *
 * ## Proxy builder notes
 * The returned `setter.set` is a Proxy that converts property access into calls:
 *   `setter.set.backgroundColor("red")` → `setProp("backgroundColor", "red")`
 *   `setter.set["background-color"]("red")` → `setProp("background-color", "red")`
 *   `setter.set.var("--k", 1)` → `setProp("--k", 1)`
 *
 * @param adapters Backend callbacks that implement apply/remove/clear for a specific target
 * (inline style, QUID stylesheet block, etc.).
 *
 * @returns A fluent `StyleSetter` that delegates mutations to the provided adapters.
 */
export function make_style_setter<TReturn>(
  host: TReturn,
  adapters: StyleSetterAdapters,
): StyleSetter<TReturn> {

  const setProp = (prop: CssKey, v: CssValue): TReturn => {
    if (!isInvalidCssVarName(prop)) css_property(prop);
    if (v !== null && v !== undefined) {
      const text = css_declaration(v);
      if (!adapters.applyMany && text !== "") assert_css_declaration_syntax(css_property(prop), text);
    }
    const canon = adapters.normalizeKey?.(prop) ?? normalize_css_key(prop);
    adapters.validateValue?.(v);
    const rendered = renderCssValue(v);

    // changed: invalid custom-property convenience input becomes a no-op.
    if (isInvalidCssVarName(canon)) return host;

    if (rendered == null) {
      adapters.remove(canon);
      return host;
    }

    adapters.apply(canon, rendered);
    return host;
  };

  const api: StyleSetter<TReturn> = {
    // build proxy surface right here; it returns host for chaining
    set: make_set_surface<TReturn>((prop, v) => setProp(prop, v)),

    setProp,
    setMany(map: CssMap): TReturn {
      const normalized = prepare_style_map(map, adapters);
      if (adapters.applyMany) {
        const values: Record<string, string> = {};
        for (const [key, value] of Object.entries(normalized)) {
          if (typeof value !== "string") throw new TypeError("Inline CSS requires declarations.");
          values[adapters.normalizeKey?.(key) ?? normalize_css_key(key)] = value;
        }
        adapters.applyMany(values);
      } else for (const [key, value] of Object.entries(normalized)) {
        if (typeof value === "string") setProp(key, value);
        // The shared normalizer has validated all declaration and branch keys.
        else if (Object.hasOwn(CSS_PSEUDOS, key)) adapters.applyPseudo?.(key as CssPseudoKey, value as CssMapBase);
        else adapters.applySelector?.(key, value as CssMapBase);
      }
      return host;
    },
    remove(prop: CssKey): TReturn {
      adapters.remove(adapters.normalizeKey?.(prop) ?? normalize_css_key(prop));
      return host;
    },

    clear(): TReturn {
      adapters.clear();
      return host;
    },
  };

  return api;
}


/* ----------------------------- normalization ----------------------------- */

/**
 * Coerce a `CssValue` into a CSS-ready string, or return `null` to signal “remove”.
 *
 * Semantics:
 * - `null | undefined` → `null` (meaning: remove the property)
 * - `string` → trimmed string (empty string is allowed and preserved)
 * - finite numbers → stringified
 * - `{ value, unit? }` → `${value}${unit ?? ""}` (trimmed)
 *
 * This function is the *only* place where `CssValue` coercion rules should live, so that:
 * - `StyleManager` and `CssManager` backends behave identically, and
 * - tests can target one normalization surface rather than multiple call-sites.
 */
function renderCssValue(v: CssValue): string | null {
  const rendered = render_css_declaration_value(v);
  if (rendered !== undefined) return rendered;
  throw new Error("CSS declaration value is invalid.");
}
