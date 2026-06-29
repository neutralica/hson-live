// canonicalize.ts

/**
 * Produce a canonical JSON string for an arbitrary value.
 *
 * This is intended for stable comparisons (tests, caches, diffs), not for
 * serialization fidelity or performance. Objects are recursively normalized
 * by sorting keys lexicographically at every level before stringification.
 *
 * Behavior:
 * - Primitives are returned as-is through JSON.stringify.
 * - Arrays preserve order, but their elements are canonicalized.
 * - Plain objects are deep-copied with keys sorted deterministically.
 *
 * Notes:
 * - Property order is the only normalization performed; values are not coerced.
 * - Cyclic structures are not supported and will throw via JSON.stringify.
 *
 * @param x - Any JSON-serializable value.
 * @returns A deterministic JSON string representation.
 */
export function canonicalize(x: unknown): string {
    return JSON.stringify(sortKeys(x));
}

function sortKeys(v: unknown): unknown {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(sortKeys);
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);
    return out;
}

// canonicalize CRLF/CR into LF for HTML/XML newline normalization comparisons.
export function normalize_newlines_lf(s: string): string {
  // CRLF -> LF, then remaining CR -> LF
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}