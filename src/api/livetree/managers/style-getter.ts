import { AllowedStyleKey, CssKey, CssVarName } from "../../../types/css.types.js";
import { camel_to_kebab } from "../../../utils/attrs-utils/camel_to_kebab.js";
import { normalize_css_key } from "../../../utils/attrs-utils/normalize-css.js";

/**
 * Backend contract for style reads.
 *
 * Implementations should return the *internal truth* (HSON attrs or
 * CssManager state), not computed styles from the browser.
 */
export type StyleGetMany = Readonly<Record<string, string>>;

export type StyleGetterAdapters = Readonly<{
  /** Return rendered string value for canonical prop, or undefined if absent. */
  read: (propCanon: string) => string | undefined;

  /**
   * Optional bulk read hook for diagnostics and round-tripping into
   * setMany-compatible objects. Backends that cannot enumerate declarations may
   * omit this and get an empty object from getMany().
   */
  readMany?: () => StyleGetMany;
}>;

type ReservedGetSurfaceKey = "property" | "var" | "vars";
type DirectStyleGetKey = Exclude<AllowedStyleKey, ReservedGetSurfaceKey>;

export type GetSurface = {
  [K in DirectStyleGetKey]: () => string | undefined;
}
  & Record<CssVarName, () => string | undefined>
  & Record<`${string}-${string}`, () => string | undefined>
  & {
    /** Read a property by any supported CSS key spelling. */
    property: (prop: CssKey) => string | undefined;

    // deprecated
    // /** Read a CSS custom property. Accepts `"--x"`, `"-x"`, or `"x"`. */
    // var: (name: string) => string | undefined;

    /**
     * Read a selected list of CSS custom properties.
     *
     * Invalid names and missing declarations are omitted. Returned keys are
     * canonical custom-property names in `--x` form.
     */
    vars: (names: readonly string[]) => Readonly<Partial<Record<CssVarName, string>>>;
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
 * Create the canonical bulk-read function for a style-like handle.
 *
 * This lives beside, not under, `get` so CSS property names such as `all` keep
 * their normal meaning on the getter proxy.
 */
export function make_style_get_many(adapters: StyleGetterAdapters): () => StyleGetMany {
  return (): StyleGetMany => adapters.readMany?.() ?? {};
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

  const getVars = (names: readonly string[]): Readonly<Partial<Record<CssVarName, string>>> => {
    const out: Partial<Record<CssVarName, string>> = {};

    for (const name of names) {
      const canon = normalize_css_var_name(name);
      if (!canon) continue;

      const value = adapters.read(canon);
      if (value === undefined) continue;

      out[canon] = value;
    }

    return out;
  };

  const base = {
    property: getProp,
    // var: getVar,
    vars: getVars,
  };

  // changed: mirror StyleSetter's fluent key surface, e.g. css.get.width().
  const surface = new Proxy(base, {
    get(target, key, receiver) {
      if (typeof key !== "string") {
        return Reflect.get(target, key, receiver);
      }

      if (key === "property" || key === "vars") {
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
