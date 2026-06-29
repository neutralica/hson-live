// kebab-to-camel.util.ts

/**
 * Convert a kebab-case CSS/property name into camelCase.
 *
 * Behavior:
 * - Collapses multiple consecutive dashes into a single dash.
 * - Handles leading vendor prefixes:
 *   - `-ms-foo` → `msFoo`
 *   - `-webkit-foo` → `WebkitFoo`
 * - Converts each `-x` sequence into `X`.
 * - Leaves non-dashed strings unchanged.
 *
 * This is intended for normalizing CSS property names parsed from
 * strings into a JS-friendly form, not for arbitrary identifier munging.
 *
 * @param s - Input string in kebab-case form.
 * @returns The camelCase equivalent.
 */
export function kebab_to_camel(s: string): string {
  if (!s) return s;

  // collapse runs of dashes
  let x = s.replace(/-+/g, "-");

  // vendor prefix at start
  if (x.startsWith("-")) {
    const rest = x.slice(1);
    if (rest.startsWith("ms-")) {
      x = "ms-" + rest.slice(3);
    } else if (rest.length) {
      x = rest[0].toUpperCase() + rest.slice(1);
    } else {
      x = ""; // just "-"
    }
  }

  // turn -a into A
  return x.replace(/-([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}
