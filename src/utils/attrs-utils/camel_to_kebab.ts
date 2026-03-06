// camel_to_kebab.ts
/*******
 * Convert a camelCase (or mixed) property name into kebab-case.
 *
 * Purpose:
 * - Primarily used to convert JS-style property names (e.g. `backgroundColor`)
 *   into CSS-style property names (e.g. `background-color`).
 *
 * Rules:
 * - Collapses underscores and whitespace into `-`.
 * - Inserts a `-` between a lowercase/digit and a following uppercase letter.
 * - Collapses repeated hyphens into a single `-`.
 * - Lowercases the final output.
 *
 * Notes:
 * - This is intended for standard (non-custom) CSS properties.
 * - Custom properties (`--foo`) should typically be preserved verbatim instead
 *   of being passed through this function.
 *
 * @param str - Input property name (e.g. `"backgroundColor"`).
 * @returns The kebab-cased property name (e.g. `"background-color"`).
 *******/

export function camel_to_kebab(str: string): string {
  return str
    .replace(/[_\s]+/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/-+/g, "-")
    .toLowerCase();
}
