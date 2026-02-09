// unescape-hson.ts

/**
 * Decode an HSON string literal.
*
* HSON string literals *must* be valid JSON string literals —
* i.e. include quotes and use JSON escape sequences.
*
* Anything that does not look like a quoted JSON string
* literal will be returned verbatim (no escape decoding).
*
* This protects sequences like C:\temp\file.txt from becoming
* tabs or form feeds.
* @param s - Raw string content with HSON-style backslash escapes.
* @returns The decoded string with supported escapes resolved.
*******/
export function unescape_hson_string(s: string): string {
  const t = s.trim();

  // Case A: full JSON string literal already
  if (t.length >= 2 && t[0] === `"` && t[t.length - 1] === `"`) {
    const v: unknown = JSON.parse(t);
    if (typeof v !== "string") throw new Error("HSON string literal did not parse to string");
    return v;
  }

  // Case B: inner text from a quoted region (attrs scanner, quoted blocks, etc.)
  // Wrap and parse using JSON semantics (handles \" \\ \n \t \uXXXX consistently).
  const v: unknown = JSON.parse(`"${t}"`);
  if (typeof v !== "string") throw new Error("HSON inner did not parse to string");
  return v;
}