// style-setter.ts

import { CssMap, CssMapBase, CssPseudoKey, CssValue } from "../../../types/css.types";
import { nrmlz_cssom_prop_key } from "../../../utils/attrs-utils/normalize-css";
import { SetSurface } from "../../../types/css.types";
import { CssKey } from "../../../types/css.types";
import { ClassApi, IdApi } from "../../../types/dom.types";
import { LiveTree } from "../livetree";



// ADDED: type guard for structured CssValue object
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
  "_hover", "_active", "_focus", "_focusWithin", "_disabled", "_before", "_after",
]);


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
    // CHANGED: avoid `as string`; read attr and validate type
    get: () => {
      const v = tree.getAttr("id");
      return typeof v === "string" ? v : undefined;
    },

    set: (id: string) => {
      tree.setAttrs("id", id);
      return tree;
    },

    clear: () => {
      tree.removeAttr("id");
      return tree;
    },
  };

}

export function make_class_api(tree: LiveTree): ClassApi {
  const getRaw = (): string | undefined => {
    const v = tree.getAttr("class");
    return (typeof v === "string" && v.trim().length > 0) ? v : undefined;
  };

  //  parse class string from getRaw() (avoid duplicate getAttr reads)
  const getSet = (): Set<string> => {
    const s = getRaw() ?? "";
    return new Set(s.split(/\s+/).filter(Boolean));
  };

  return {
    // CHANGED: avoid `as string`
    get: () => getRaw(),

    has: (name: string) => getSet().has(name),

    set: (cls) => {
      const next = Array.isArray(cls)
        ? cls.filter(Boolean).join(" ").trim()
        : (cls ?? "").trim();

      // CHANGED: use removeAttr for clearing, consistent with other methods
      if (!next) tree.removeAttr("class");
      else tree.setAttrs("class", next);

      return tree;
    },

    add: (...names) => {
      const set = getSet();
      for (const n of names) if (n) set.add(n);

      const next = [...set].join(" ");
      if (!next) tree.removeAttr("class");
      else tree.setAttrs("class", next);

      return tree;
    },

    remove: (...names) => {
      const set = getSet();
      for (const n of names) set.delete(n);

      const next = [...set].join(" ");
      if (!next) tree.removeAttr("class");
      else tree.setAttrs("class", next);

      return tree;
    },

    toggle: (name, force) => {
      const set = getSet();
      const has = set.has(name);
      const shouldHave = (force === undefined) ? !has : force;

      if (shouldHave) set.add(name);
      else set.delete(name);

      const next = [...set].join(" ");
      if (!next) tree.removeAttr("class");
      else tree.setAttrs("class", next);

      return tree;
    },

    clear: () => {
      tree.removeAttr("class");
      return tree;
    },
  };
}