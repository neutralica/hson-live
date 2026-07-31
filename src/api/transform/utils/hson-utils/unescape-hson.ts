// unescape-hson.ts

/**
 * Decode an HSON string literal.
*
* HSON string literals *must* be valid JSON string literals —
* i.e. include quotes and use JSON escape sequences.
*
 * @param s - Raw string content with HSON-style backslash escapes.
 * @returns The decoded string with supported escapes resolved.
*******/
export function unescape_hson_string(s: string): string {
  const literal = s.startsWith(`"`) && s.endsWith(`"`) ? s : `"${s}"`;
  const value: unknown = JSON.parse(literal);
  if (typeof value !== "string") {
    throw new Error("HSON string literal did not parse to string");
  }
  return value;
}
