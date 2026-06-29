// preflight-attrs-escaping.ts


function is_entity_start(src: string, ampIndex: number): boolean {
  const rest = src.slice(ampIndex);
  return /^&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]{1,31});/.test(rest);
}

/*********
 * Escape literal angle brackets inside quoted attribute values only.
 *
 * This performs a single-pass state-machine scan over the source string and
 * replaces `<` → `&lt;` and `>` → `&gt;` *only* when the parser is inside a
 * quoted attribute value (`"..."` or `'...'`) within a tag.
 *
 * Everything else is left untouched:
 * - Text nodes are not escaped.
 * - Tag structure (`<tag ...>`) is preserved verbatim.
 * - Unquoted attribute values are not modified.
 *
 * This is intentionally not regex-based:
 * - Regex splitting fails in the presence of nested quotes or malformed attrs.
 * - A small explicit state machine is more predictable and debuggable here.
 *
 * States tracked:
 * - Text: outside of any tag
 * - Tag: inside `< ... >` but not inside a quoted value
 * - EqWait: just saw `=` and are waiting to see if a quoted value begins
 * - QuotedD / QuotedS: inside `"..."` or `'...'` attribute values
 *
 * Use case:
 * - Prevent accidental tag breaks when attribute values contain `<` or `>`
 *   that should be treated as literal text, not markup.
 *
 * @param src - Raw markup string.
 * @returns Markup with angle brackets escaped *only* inside quoted attributes.
 *********/
export function esc_attrs_quoted_angles(src: string): string {
  enum S { Text, Tag, AttrName, EqWait, QuotedD, QuotedS }
  let s = S.Text, q = 0, out = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src.charCodeAt(i);
    const c = src[i];

    switch (s) {
      case S.Text:
        if (c === "<") { s = S.Tag; }
        out += c;
        break;

      case S.Tag:
        if (c === ">") { s = S.Text; out += c; break; }
        if (c === "'" || c === '"') { // attr value starting w/o '=' — rare, still treat as quoted
          s = (c === '"') ? S.QuotedD : S.QuotedS; out += c; break;
        }
        if (/\s/.test(c)) { out += c; break; }
        if (c === "=") { s = S.EqWait; out += c; break; }
        // heuristic: after a name and '=', we’ll hit EqWait; until then we’re in attr name / tag name
        out += c;
        break;

      case S.EqWait: {
        if (c === '"') { s = S.QuotedD; q = 0; out += c; break; }
        if (c === "'") { s = S.QuotedS; q = 0; out += c; break; }
        // unquoted value begins; revert to Tag state, but NOT quoted
        s = S.Tag; out += c; break;
      }

      case S.QuotedD:
        if (c === '"') { s = S.Tag; out += c; break; }
        // CHANGED: XML parsing rejects bare ampersands even when HTML accepts them.
        // if (c === "<") { out += "&lt;"; break; }
        // if (c === ">") { out += "&gt;"; break; }
        // out += c; break;
        
        if (c === "<") { out += "&lt;"; break; }
        if (c === ">") { out += "&gt;"; break; }
        // Preserve existing named/numeric entities to avoid double-escaping.
        if (c === "&" && !is_entity_start(src, i)) { out += "&amp;"; break; }
        out += c; break;

      case S.QuotedS:
        if (c === "'") { s = S.Tag; out += c; break; }
        // CHANGED: XML parsing rejects bare ampersands even when HTML accepts them.
        // if (c === "<") { out += "&lt;"; break; }
        // if (c === ">") { out += "&gt;"; break; }
        // out += c; break;
        
        if (c === "<") { out += "&lt;"; break; }
        if (c === ">") { out += "&gt;"; break; }
        // Preserve existing named/numeric entities to avoid double-escaping.
        if (c === "&" && !is_entity_start(src, i)) { out += "&amp;"; break; }
        out += c; break;
    }
  }
  return out;
}
