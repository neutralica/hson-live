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
   * CHANGED: optional bulk read hook for diagnostics and round-tripping into
   * setMany-compatible objects. Backends that cannot enumerate declarations may
   * omit this and get an empty object from get.all().
   */
  readMany?: () => StyleGetMany;
}>;

type ReservedGetSurfaceKey = "all" | "stringAll" | "property" | "var";
type DirectStyleGetKey = Exclude<AllowedStyleKey, ReservedGetSurfaceKey>;

export type GetSurface = {
  [K in DirectStyleGetKey]: () => string | undefined;
}
  & Record<CssVarName, () => string | undefined>
  & Record<`${string}-${string}`, () => string | undefined>
  & {
    /** Read a property by any supported CSS key spelling. */
    property: (prop: CssKey) => string | undefined;

    /**
     * Read every enumerable declaration available to this getter.
     * The returned object should be suitable for passing back into setMany().
     */
    all: () => StyleGetMany;

    /**
     * Serialize all enumerable declarations as CSS declaration text.
     * This is for diagnostics/display; prefer all() when round-tripping into setMany().
     */
    stringAll: () => string;

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

function style_get_many_key_to_css_prop(key: string): string {
  const k = key.trim();
  if (!k) return "";
  if (k.startsWith("--")) return k;

  const lower = k.toLowerCase();

  // CHANGED: vendor-prefixed declaration keys may be stored without the
  // leading dash, but serialized CSS should restore it.
  if (
    lower.startsWith("webkit-")
    || lower.startsWith("moz-")
    || lower.startsWith("ms-")
    || lower.startsWith("o-")
  ) {
    return `-${lower}`;
  }

  const kebab = k.includes("-") ? lower : camel_to_kebab(k);

  // CHANGED: camelCase vendor keys like `webkitAppearance` serialize as
  // `-webkit-appearance`, not `webkit-appearance`.
  if (
    kebab.startsWith("webkit-")
    || kebab.startsWith("moz-")
    || kebab.startsWith("ms-")
    || kebab.startsWith("o-")
  ) {
    return `-${kebab}`;
  }

  return kebab;
}

function stringify_style_get_many(map: StyleGetMany): string {
  return Object.entries(map)
    .map(([key, value]) => {
      const prop = style_get_many_key_to_css_prop(key);
      if (!prop) return "";
      return `${prop}: ${value};`;
    })
    .filter((line) => line.length > 0)
    .join(" ");
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
  const getAll = (): StyleGetMany => {
    // CHANGED: not every backend can enumerate declarations. For those cases,
    // expose a safe empty object rather than making get.all unavailable.
    return adapters.readMany?.() ?? {};
  };

  const getStringAll = (): string => {
    // CHANGED: keep structured round-tripping and string diagnostics separate.
    return stringify_style_get_many(getAll());
  };

  const base = {
    property: getProp,
    all: getAll,
    stringAll: getStringAll,
    var: getVar,
  };

  // changed: mirror StyleSetter's fluent key surface, e.g. css.get.width().
  const surface = new Proxy(base, {
    get(target, key, receiver) {
      if (typeof key !== "string") {
        return Reflect.get(target, key, receiver);
      }

      if (key === "property" || key === "all" || key === "stringAll" || key === "var") {
        return Reflect.get(target, key, receiver);
      }

      // CHANGED: `all` is a real CSS property, but this surface reserves
      // get.all() for bulk reads. Use get.property("all") to read the CSS
      // `all` property directly.

      // changed: bracket-access custom vars are read through var normalization.
      if (key.startsWith("--")) {
        return (): string | undefined => getVar(key);
      }

      return (): string | undefined => getProp(key as CssKey);
    },
  });

  return surface as StyleGetter;
}
