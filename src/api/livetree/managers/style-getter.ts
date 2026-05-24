import { AllowedStyleKey, CssKey, CssVarName } from "../../../types/css.types.js";
import { normalize_css_key } from "../../../utils/attrs-utils/normalize-css.js";

/**
 * Backend contract for style reads.
 *
 * Implementations should return the *internal truth* (HSON attrs or
 * CssManager state), not computed styles from the browser.
 */
export type StyleGetterAdapters = Readonly<{
  /** Return rendered string value for canonical prop, or undefined if absent. */
  read: (propCanon: string) => string | undefined;
}>;


export type GetSurface = {
  [K in AllowedStyleKey]: () => string | undefined;
}
  & Record<CssVarName, () => string | undefined>
  & Record<`${string}-${string}`, () => string | undefined>
  & {
    /** Read a property by any supported CSS key spelling. */
    property: (prop: CssKey) => string | undefined;

    /** Read a CSS custom property. Accepts `"--x"`, `"-x"`, or `"x"`. */
    var: (name: string) => string | undefined;
  };

export type StyleGetter = GetSurface;


/**
 * Normalize user-facing CSS custom property names.
 *
 * Accepts:
 * - `"--x"` canonical custom-property names
 * - `"x"` convenience names
 * - `"-x"` common single-hyphen typo/convenience names
 */
export function normalize_css_var_name(name: string): CssVarName | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("--")) {
    // changed: bare "--" is not a usable custom-property name
    if (trimmed.length <= 2) return undefined;
    return trimmed as CssVarName;
  }

  // changed: tolerate a single leading hyphen, or any accidental leading run.
  const bare = trimmed.startsWith("-") ? trimmed.replace(/^-+/, "") : trimmed;
  if (!bare) return undefined;

  return `--${bare}` as CssVarName;
}

/**
 * Create a `StyleGetter` bound to a backend read adapter.
 *
 * - Normalizes property names to the canonical CSS form used by setters.
 * - Provides a `var()` helper that accepts either `"--x"` or `"x"`.
 *
 * @param adapters - Backend read hooks returning rendered values.
 * @returns A `StyleGetter` that exposes canonicalized reads.
 */
export function make_style_getter(adapters: StyleGetterAdapters): StyleGetter {
  const getProp = (prop: CssKey): string | undefined => {
    const canon = normalize_css_key(prop);
    return adapters.read(canon);
  };

  const getVar = (name: string): string | undefined => {
    const canon = normalize_css_var_name(name);
    if (!canon) return undefined;
    return adapters.read(canon);
  };

  const base = {
    property: getProp,
    var: getVar,
  };

  // changed: mirror StyleSetter's fluent key surface, e.g. css.get.width().
  const surface = new Proxy(base, {
    get(target, key, receiver) {
      if (typeof key !== "string") {
        return Reflect.get(target, key, receiver);
      }

      if (key === "property" || key === "var") {
        return Reflect.get(target, key, receiver);
      }

      // changed: bracket-access custom vars are read through var normalization.
      if (key.startsWith("--")) {
        return (): string | undefined => getVar(key);
      }

      return (): string | undefined => getProp(key as CssKey);
    },
  });

  return surface as StyleGetter;
}
