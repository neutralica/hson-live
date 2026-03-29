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
  // preserve authored whitespace; do not trim quoted content
  const t = s;

  // Case A: full JSON string literal already
  if (t.length >= 2 && t[0] === `"` && t[t.length - 1] === `"`) {
    const v: unknown = JSON.parse(t);
    if (typeof v !== "string") {
      throw new Error("HSON string literal did not parse to string");
    }
    return v;
  }

  // Case B: inner text from a quoted HSON region.
  // decode explicit escape sequences, but preserve literal newlines/spaces.
  let out = "";
  let i = 0;

  while (i < t.length) {
    const ch = t[i];

    if (ch !== "\\") {
      out += ch;
      i++;
      continue;
    }

    // trailing backslash: preserve literally
    if (i + 1 >= t.length) {
      out += "\\";
      i++;
      continue;
    }

    const nxt = t[i + 1];

    switch (nxt) {
      case `"`: out += `"`; break;
      case `\\`: out += `\\`; break;
      case `n`: out += `\n`; break;
      case `r`: out += `\r`; break;
      case `t`: out += `\t`; break;
      case `b`: out += `\b`; break;
      case `f`: out += `\f`; break;

      case `u`: {
        const hex = t.slice(i + 2, i + 6);
        if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 6;
          continue;
        }

        // invalid \u escape: preserve literally
        out += "\\u";
        i += 2;
        continue;
      }

      default:
        // preserve unknown escapes literally, but drop the escape slash
        // only if you want JS-like behavior. Safer here is to preserve both.
        out += "\\" + nxt;
        break;
    }

    i += 2;
  }

  return out;
}