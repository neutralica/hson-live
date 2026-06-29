// namespace-svg.ts

/*******
 * Ensure required SVG XML namespaces are present on the root <svg> element.
 *
 * This is a normalization / hygiene pass for inline SVG markup that may be
 * missing namespace declarations. Many SVG snippets found “in the wild”
 * omit these, which can cause downstream parsing or DOM integration issues,
 * especially when treated as XML-adjacent rather than loose HTML.
 *
 * Behavior:
 * - If no `<svg>` tag is present, returns the input unchanged.
 * - Checks whether the root `<svg>` element already declares:
 *   - `xmlns="http://www.w3.org/2000/svg"`
 *   - `xmlns:xlink="http://www.w3.org/1999/xlink"` (only if `xlink:` is used)
 * - Injects missing namespace declarations directly into the opening `<svg>`
 *   tag, preserving all existing attributes verbatim.
 *
 * Scope / limitations:
 * - Only the *first* `<svg>` opening tag is modified.
 * - Does not attempt to validate SVG structure or rewrite nested elements.
 * - Uses regex-based detection suitable for preflight normalization, not
 *   full XML parsing.
 *
 * Idempotency:
 * - Safe to run multiple times; namespaces are only added if missing.
 *
 * @param src - Markup string that may contain an inline SVG fragment.
 * @returns The same markup with required SVG namespaces injected when needed.
 *******/
export function namespace_svg(src: string): string {
    if (!/<svg\b/i.test(src)) return src;

    const hasSvgNS = /<svg\b[^>]*\bxmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(src);
    const usesXlink = /\bxlink:/i.test(src);
    const hasXlink = /<svg\b[^>]*\bxmlns:xlink\s*=/i.test(src);

    return src.replace(/<svg\b([^>]*)>/i, (_m, attrs) => {
        let add = "";
        if (!hasSvgNS) add += ` xmlns="http://www.w3.org/2000/svg"`;
        if (usesXlink && !hasXlink) add += ` xmlns:xlink="http://www.w3.org/1999/xlink"`;
        return `<svg${attrs}${add}>`;
    });
}
