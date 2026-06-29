// style-setter.ts

import { CssKey, CssMap, CssMapBase, CssPseudoKey, CssValue, CssVarFacade, CssVarName, SetSurface } from "../../../types/css.types.js";
import { camel_to_kebab } from "../../transform/utils/attrs-utils/camel_to_kebab.js";
import { normalize_css_key } from "../../transform/utils/attrs-utils/normalize-css.js";
import { normalize_css_var_name } from "./style-getter.js";


// type guard for structured CssValue object
const isStructuredCssValue = (
  v: unknown,
): v is Readonly<{ value: string | number; unit?: string }> => {
  if (!v || typeof v !== "object") return false;

  const obj = v as Record<string, unknown>;

  // must have "value"
  if (!("value" in obj)) return false;

  const val = obj["value"];
  if (typeof val !== "string" && typeof val !== "number") return false;

  // unit optional but if present must be string
  if ("unit" in obj && obj["unit"] !== undefined && typeof obj["unit"] !== "string") {
    return false;
  }

  return true;
};

const isCssValue = (v: unknown): v is CssValue => {
  if (v === null || v === undefined) return true;

  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return true;

  return isStructuredCssValue(v);
};

const _PSEUDO_KEYS: ReadonlySet<string> = new Set([
  "_hover",
  "_active",
  "_focus",
  "_focusWithin",
  "_focusVisible",
  "_visited",
  "_checked",
  "_disabled",
  "__before",
  "__after",
]);

export function css_supports_decl(propCanon: string, value: string): boolean {
  // Custom props: allow through
  if (propCanon.startsWith("--")) return true;

  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return true;
  }

  const cssProp = camel_to_kebab(propCanon);

  try {
    return CSS.supports(cssProp, value);
  } catch {
    return false;
  }
}

//  detects CssValue object shape `{ value, unit? }`
const isCssValueObject = (v: unknown): v is Readonly<{ value: string | number; unit?: string }> => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return ("value" in o) && (typeof o.value === "string" || typeof o.value === "number");
};

// pseudo blocks must be “plain object maps” (and not the `{value,unit}` CssValue object)
const isPseudoDecls = (v: unknown): v is CssMapBase => {
  return !!v && typeof v === "object" && !Array.isArray(v) && !isCssValueObject(v);
};

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
  setMany: (map: CssMap) => TReturn;
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

  /** Remove a single *canonical* property. */
  remove: (propCanon: string) => void;

  /** Clear all properties for this handle. */
  clear: () => void;

  /**
   * Optional: allowlist keys for the proxy builder (autocomplete/constraints).
   * If omitted, the proxy allows any property string.
   */
  keys?: readonly string[];

  /**
   * Optional: handle pseudo-blocks passed via `setMany`.
   *
   * When provided, `make_style_setter` will treat entries whose keys match
   * `CssPseudoKey` (e.g. `_hover`, `__before`) as nested declaration maps
   * and route them here instead of applying them as regular properties.
   */
  applyPseudo?: (pseudo: CssPseudoKey, decls: CssMapBase) => void;

  applySelector?: (pattern: string, decls: CssMapBase) => void;
  
}>;

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
 * - `null | undefined` values are treated as **remove semantics** (calls `adapters.remove()`).
 * - keys passed via proxy or map entries are normalized via `normalize_css_prop_key()`.
 *
 * ## Pseudo blocks in `setMany`
 * If `setMany` receives keys that match `CssPseudoKey`, their values are
 * interpreted as nested declaration maps (not as `CssValue`s). Those maps
 * are forwarded to `adapters.applyPseudo` when available; otherwise they
 * are ignored. Pseudo maps do not recurse.
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
    const canon = normalize_css_key(prop);
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
      for (const [k, v] of Object.entries(map)) {
        // pseudo blocks routed to adapter hook (CssManager only)
        if (_PSEUDO_KEYS.has(k) && isPseudoDecls(v)) {
          const pseudo = k as CssPseudoKey;

          if (adapters.applyPseudo) adapters.applyPseudo(pseudo, v);
          continue;
        }
        const isNestedSelectorKey = (k: string): boolean => {
          const s = k.trim();
          return s.startsWith("&");
        };
        if (isNestedSelectorKey(k) && isPseudoDecls(v)) {
          if (adapters.applySelector) adapters.applySelector(k, v);
          continue;
        }
        // narrow to CssValue before calling setProp
        if (!isCssValue(v)) continue;

        if (v !== undefined && v !== null) {
          const prop = k.startsWith("--")
            ? normalize_css_var_name(k) ?? "--invalid-css-var-name"
            : k;

          setProp(prop as CssKey, v);
        }
      }
      return host;
    },
    remove(prop: CssKey): TReturn {
      adapters.remove(normalize_css_key(prop));
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
 * - `number | boolean` → stringified
 * - `{ value, unit? }` → `${value}${unit ?? ""}` (trimmed)
 *
 * This function is the *only* place where `CssValue` coercion rules should live, so that:
 * - `StyleManager` and `CssManager` backends behave identically, and
 * - tests can target one normalization surface rather than multiple call-sites.
 */
function renderCssValue(v: CssValue): string | null {
  if (v == null) return null;

  if (typeof v === "string") {
    const s = v.trim();
    return s === "" ? "" : s;
  }

  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    const obj = v as { value?: unknown; unit?: unknown };

    if ("value" in obj) {
      const raw = obj.value;
      const unit = typeof obj.unit === "string" ? obj.unit : "";
      const val =
        typeof raw === "string" ? raw.trim() :
          typeof raw === "number" ? String(raw) :
            raw == null ? "" :
              String(raw);

      return `${val}${unit}`.trim();
    }

    //  fallback so weird objects don't stringify to "[object Object]"
    return String(v);
  }
  return String(v);
}
