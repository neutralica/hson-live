// snip.utils.ts

/**
 * Truncate a string for compact diagnostics.
 *
 * @param s - Input string.
 * @param n - Max length before truncation (default 100).
 * @returns The original string when short enough, or a snipped version.
 */
export const _snip = (s: string, n: number = 100): string =>
  s.length > n ? s.slice(0, n) + "…" : s;
