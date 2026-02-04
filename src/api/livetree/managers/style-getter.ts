// style.getter.ts (new file)

import { CssKey } from "../../../types/css.types";
import { nrmlz_cssom_prop_key } from "../../../utils/attrs-utils/normalize-css";

// ADDED: backend contract for reads (internal truth, not computed style)
export type StyleGetterAdapters = Readonly<{
  /** Return rendered string value for canonical prop, or undefined if absent. */
  read: (propCanon: string) => string | undefined;
}>;

// ADDED: read surface
export type StyleGetter = Readonly<{
  /** Read a property (accepts any CssKey, normalized internally). */
  property: (prop: CssKey) => string | undefined;

  /** Convenience: read a CSS var. Accepts "--x" or "x". */
  var: (name: string) => string | undefined;
}>;

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