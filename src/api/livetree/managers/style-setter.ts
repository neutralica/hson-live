// style-setter.ts

import { CssMap, CssMapBase, CssPseudoKey, CssValue } from "../../../types/css.types.js";
import { nrmlz_cssom_prop_key } from "../../../utils/attrs-utils/normalize-css.js";
import { SetSurface } from "../../../types/css.types.js";
import { CssKey } from "../../../types/css.types.js";
import { ClassApi, IdApi } from "../../../types/dom.types.js";
import { LiveTree } from "../livetree.js";
import { getAttrImpl, removeAttrImpl, setAttrsImpl } from "./attr-handle.js";


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
  // Custom props: can't validate meaningfully; allow.
  if (propCanon.startsWith("--")) return true;

  // If CSS.supports doesn't exist (rare), fail open.
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return true;

  try {
    return CSS.supports(propCanon, value);
  } catch {
    // CSS.supports can throw on weird inputs; treat as unsupported.
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

// CHANGED: generic “proxy surface” builder that returns whatever your setProp returns.
export function make_set_surface<TReturn>(
  setProp: (prop: CssKey, v: CssValue) => TReturn,
): SetSurface<TReturn> {
  return new Proxy({} as SetSurface<TReturn>, {
    get(_t, rawKey: string | symbol) {
      if (rawKey === "var") {
        return (name: `--${string}`, v: CssValue) => setProp(name, v);
      }
      if (typeof rawKey !== "string") return undefined;

      return (v: CssValue) => setProp(rawKey, v);
    },
  });
}

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
    const canon = nrmlz_cssom_prop_key(prop);
    const rendered = renderCssValue(v);

    if (rendered == null) {
      adapters.remove(canon);
      return host;
    }

    adapters.apply(canon, rendered);
    return host;
  };

  const api: StyleSetter<TReturn> = {
    // CHANGED: build proxy surface right here; it returns host for chaining
    set: make_set_surface<TReturn>((prop, v) => setProp(prop, v)),

    setProp,
    setMany(map: CssMap): TReturn {
      for (const [k, v] of Object.entries(map)) {
        // ADDED: pseudo blocks routed to adapter hook (CssManager only)
        if (_PSEUDO_KEYS.has(k) && isPseudoDecls(v)) {
          const pseudo = k as CssPseudoKey;

          if (adapters.applyPseudo) adapters.applyPseudo(pseudo, v);
          continue;
        }

        // CHANGED: narrow to CssValue before calling setProp
        if (!isCssValue(v)) continue;

        // CHANGED: k from Object.entries is string; cast is fine because setProp normalizes anyway
        if (v !== undefined && v !== null) setProp(k as CssKey, v);
      }
      return host;
    },
    remove(prop: CssKey): TReturn {
      adapters.remove(nrmlz_cssom_prop_key(prop));
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
export function make_id_api(tree: LiveTree): IdApi {
  return {
    // CHANGED: read from underlying attr impl to avoid calling tree.id.get() (recursion)
    get: () => {
      const v = getAttrImpl(tree, "id");
      return typeof v === "string" ? v : undefined;
    },

    // CHANGED: write via attr impl (id is just an attribute)
    set: (id: string) => {
      setAttrsImpl(tree, "id", id);
      return tree;
    },

    // CHANGED: clear via remove impl
    clear: () => {
      removeAttrImpl(tree, "id");
      return tree;
    },
  };
}
export function make_class_api(tree: LiveTree): ClassApi {
  // CHANGED: read from attrs, not tree.classlist.get() (avoids self-recursion)
  const getRaw = (): string | undefined => {
    const v = tree.attr.get("class");
    return (typeof v === "string" && v.trim().length > 0) ? v : undefined;
  };

  // CHANGED: keep parsing centralized; uses getRaw() once per op
  const getSet = (): Set<string> => {
    const s = getRaw() ?? "";
    return new Set(s.split(/\s+/).filter(Boolean));
  };

  // CHANGED: centralize write semantics (empty => drop)
  const write = (names: Iterable<string>): LiveTree => {
    const next = Array.from(names).filter(Boolean).join(" ").trim();
    if (!next) tree.attr.drop("class");
    else tree.attr.set("class", next);
    return tree;
  };

  return {
    get: () => getRaw(),

    has: (name: string) => getSet().has(name),

    set: (cls) => {
      const next = Array.isArray(cls)
        ? cls.filter(Boolean).join(" ").trim()
        : (cls ?? "").trim();

      // CHANGED: write via attrs (no tree.classlist.*)
      if (!next) tree.attr.drop("class");
      else tree.attr.set("class", next);

      return tree;
    },

    add: (...names) => {
      const set = getSet();
      for (const n of names) if (n) set.add(n);
      return write(set);
    },

    remove: (...names) => {
      const set = getSet();
      for (const n of names) if (n) set.delete(n);
      return write(set);
    },

    toggle: (name, force) => {
      const set = getSet();
      const has = set.has(name);
      const shouldHave = (force === undefined) ? !has : force;

      if (shouldHave) set.add(name);
      else set.delete(name);

      return write(set);
    },

    clear: () => {
      // CHANGED: drop via attrs
      tree.attr.drop("class");
      return tree;
    },
  };
}