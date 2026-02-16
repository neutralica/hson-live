// style.getter.ts (new file)

import { CssKey } from "../../../types/css.types";
import { nrmlz_cssom_prop_key } from "../../../utils/attrs-utils/normalize-css";

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

/**
 * Read-only accessor surface returned by `make_style_getter`.
 */
export type StyleGetter = Readonly<{
  /** Read a property (accepts any CssKey, normalized internally). */
  property: (prop: CssKey) => string | undefined;

  /** Convenience: read a CSS var. Accepts "--x" or "x". */
  var: (name: string) => string | undefined;
}>;

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
    // CHANGED: reuse your canonicalization; MUST match whatever set uses
    const canon = nrmlz_cssom_prop_key(prop);
    return adapters.read(canon);
  };

  const getVar = (name: string): string | undefined => {
    const canon = name.startsWith("--") ? name : `--${name}`;
    return adapters.read(canon);
  };

  return { property: getProp, var: getVar };
}
