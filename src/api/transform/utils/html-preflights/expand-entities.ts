// expand-entities.ts

const htmlNamedToNumeric: Record<string, string> = {
    copy: '&#169;',
    nbsp: '&#160;',
    eacute: '&#233;',
    /* add more if needed */
};

/*******
 * Expand selected named HTML entities into their numeric equivalents.
 *
 * This performs a conservative, explicit rewrite of a small allowlist of
 * named entities (e.g. `&copy;`) into numeric character references
 * (e.g. `&#169;`).
 *
 * Behavior:
 * - Leaves the core XML/HTML entities untouched:
 *   `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`
 * - Rewrites only entities explicitly listed in `htmlNamedToNumeric`.
 * - Leaves unknown entities unchanged so that later parsing or validation
 *   stages can decide how to handle them.
 *
 * Rationale:
 * - Numeric entities are unambiguous and safer to carry across parsing
 *   boundaries (HTML ↔ XML ↔ HSON).
 * - Keeping the mapping explicit avoids silently expanding entities that
 *   may not be universally supported or desired.
 *
 * Scope:
 * - This is *not* a general HTML entity decoder.
 * - It does not handle numeric-to-character decoding.
 * - It does not validate whether an entity is semantically valid in context.
 *
 * @param input - Source text potentially containing named HTML entities.
 * @returns Text with known named entities expanded to numeric references.
 *******/
export function expand_entities(input: string): string {
    return input.replace(/&([a-zA-Z0-9]+);/g, (full, entity) => {
        /* leave amp, lt, gt, quot, apos alone */
        if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(entity)) {
            return full;
        }
        if (entity in htmlNamedToNumeric) {
            return htmlNamedToNumeric[entity];
        }
        return full; /* unknown entity — leave unchanged (parser will error if needed) */
    });
}
