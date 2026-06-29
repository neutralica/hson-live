// quoted-unquoted.ts

/*********
 * Quote unquoted HTML attribute values so the result is XML-friendly.
 *
 * HTML permits unquoted attribute values (including empty values like `data-x=`),
 * but XML requires attribute values to be quoted.
 *
 * This function scans the input and rewrites only *start tags* (`<tag ...>`):
 * - End tags (`</...>`), comments (`<!--...-->`), doctypes (`<!...>`), and
 *   processing instructions (`<?...?>`) are passed through unchanged.
 * - Quoted attribute values (`name="..."` / `name='...'`) are preserved verbatim.
 * - Unquoted values (`name=value`) become `name="value"`.
 * - Empty-before-terminator forms (`name=` followed by whitespace or `>`) become
 *   `name=""`.
 * - Boolean attributes with no `=` (e.g. `disabled`) are left as-is (they are
 *   handled separately by flag/boolean expansion if desired).
 *
 * Design notes:
 * - Single-pass, quote-aware walk (no regex): safer around embedded `>` in quotes,
 *   mixed quoting, and unusual whitespace.
 * - Does not entity-escape `&`, `<`, or `>` inside values; keep this function’s
 *   job narrowly “add quotes”. Perform escaping in a later dedicated pass.
 *
 * @param src - Raw HTML-ish markup.
 * @returns The same markup, but with all unquoted attribute values quoted.
 *********/
export function quote_unquoted_attrs(src: string): string {
  let out = "";
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { out += src.slice(i); break; }
    const gt = src.indexOf(">", lt + 1);
    if (gt < 0) { out += src.slice(i); break; }

    out += src.slice(i, lt);
    const tag = src.slice(lt, gt + 1);

    // Skip end tags, comments, doctype, processing instructions
    const body = tag.slice(1);
    if (body.startsWith("/") || body.startsWith("!") || body.startsWith("?")) {
      out += tag; i = gt + 1; continue;
    }

    // Walk the tag, respecting quotes
    let t = 1;              // inside `tag`
    let buf = "<";

    // 1) element name
    while (t < tag.length && !/\s|\/|>/.test(tag[t])) buf += tag[t++];

    // 2) attributes
    let lastT = -1;         // progress guard
    while (t < tag.length) {
      if (t === lastT) { buf += tag[t]; t++; continue; }
      lastT = t;

      const c = tag[t];

      // End or self-close
      if (c === ">" || (c === "/" && tag[t + 1] === ">")) {
        buf += tag.slice(t);
        t = tag.length;
        break;
      }

      // Whitespace
      if (/\s/.test(c)) { buf += c; t++; continue; }

      // Attribute name
      const nameStart = t;
      while (t < tag.length && !/\s|=|\/|>/.test(tag[t])) t++;
      if (t === nameStart) { buf += tag[t]; t++; continue; } // stray char, advance
      buf += tag.slice(nameStart, t);

      // Spaces after name
      while (t < tag.length && /\s/.test(tag[t])) { buf += tag[t++]; }

      // Boolean attribute (no '=')
      if (tag[t] !== "=") { continue; }

      // '='
      buf += tag[t++];
      // Spaces after '='
      while (t < tag.length && /\s/.test(tag[t])) { buf += tag[t++]; }

      const q = tag[t];
      if (q === '"' || q === "'") {
        // Quoted: copy verbatim until matching quote
        const qch = q; buf += qch; t++;
        while (t < tag.length && tag[t] !== qch) { buf += tag[t++]; }
        if (t < tag.length) { buf += tag[t++]; } // closing quote
      } else {
        // UNQUOTED: capture run up to whitespace or '>'
        const vStart = t;
        while (t < tag.length && !/\s|>/.test(tag[t])) t++;
        const raw = tag.slice(vStart, t);
        // Important: DO NOT escape '&' here — ampSafe will handle it once later.
        // Also don't touch quotes here; an unquoted run cannot legally contain `"`.
        buf += `"${raw}"`;
      }
    }

    out += buf;
    i = gt + 1;
  }

  return out;
}
