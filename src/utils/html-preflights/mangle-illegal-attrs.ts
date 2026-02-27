// mangle-illegal-attrs.ts
import { _TRANSIT_ATTRS, _TRANSIT_PREFIX } from "../../consts/constants.js";

/*  XML 1.0 Name production (approx; good enough for preflight) */
const XML_NAME = /^[A-Za-z_:\u00C0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][\w.\-:\u00B7\u0300-\u036F\u203F-\u2040]*$/u;

/*  Turn any non-ASCII or disallowed chars into _xHHHH_ sequences (ASCII-safe) */
function xHHHdisallowed(name: string): string {
  let ok = true;
  if (!XML_NAME.test(name)) ok = false;
  if (ok) return name;
  let out = "_attr";
  for (let i = 0; i < name.length; i++) {
    const cp = name.codePointAt(i)!;
    const ch = name[i];
    if (/^[A-Za-z0-9._:\-]$/.test(ch)) { out += ch; }
    else { out += `_x${cp.toString(16)}_`; if (cp > 0xffff) i++; }
  }
  return out;
}


// (1) find tag end safely (quotes-aware),
// (2) parse attributes without regex footguns,
// (3) preserve values exactly,
// (4) handle colon attrs as “illegal unless xml/xmlns”,
// (5) avoid safe-name collisions, and
// (6) avoid double-inserting _TRANSIT_ATTRS if already present.

export function mangle_illegal_attrs(src: string): string {
  let out = "";
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      out += src.slice(i);
      break;
    }

    out += src.slice(i, lt);

    const tagEnd = find_tag_end(src, lt);
    if (tagEnd < 0) {
      // CHANGED: if malformed (no closing '>'), bail by copying rest
      out += src.slice(lt);
      break;
    }

    const tag = src.slice(lt, tagEnd + 1);

    // Skip: end tags, comments, doctypes, processing instructions
    if (is_skippable_tag(tag)) {
      out += tag;
      i = tagEnd + 1;
      continue;
    }

    // Only rewrite start-tags and attributes
    const rewritten = rewrite_start_tag_attrs(tag);

    out += rewritten;
    i = tagEnd + 1;
  }

  return out;
}

// ----------------------- helpers -----------------------

function is_skippable_tag(tag: string): boolean {
  // tag includes leading '<' and trailing '>'
  // CHANGED: more explicit + correct ordering for "<!--"
  if (tag.startsWith("</")) return true;
  if (tag.startsWith("<!--")) return true;
  if (tag.startsWith("<!")) return true;   // doctype, CDATA in some contexts, etc.
  if (tag.startsWith("<?")) return true;   // processing instruction
  return false;
}

function find_tag_end(src: string, lt: number): number {
  // CHANGED: scan until '>' not inside quotes
  let inQuote: "'" | '"' | null = null;

  for (let i = lt + 1; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === ">") return i;
  }
  return -1;
}

function rewrite_start_tag_attrs(tag: string): string {
  // tag: "<name ...>" or "<name .../>"
  // We will preserve:
  // - original whitespace between tokens
  // - original attribute values (quoted/unquoted)
  // - original "/>" vs ">" closing
  // We will rewrite:
  // - attribute names only

  // Split off the initial "<tagname" portion.
  const nameInfo = read_tag_name(tag);
  if (!nameInfo) return tag;

  const { tagNameEnd } = nameInfo;

  // Find where the closing begins (either "/>" or ">")
  const closeInfo = read_tag_close(tag);
  if (!closeInfo) return tag;

  const { closeStart, closeText } = closeInfo;

  const head = tag.slice(0, tagNameEnd);          // "<p" or "<custom-name"
  const attrsSrc = tag.slice(tagNameEnd, closeStart); // everything between tag name and close
  const tail = closeText;                          // ">" or "/>"

  const { attrsOut, attrMap, hasTransitAlready } = rewrite_attrs(attrsSrc);

  // CHANGED: only append transit map if we changed something AND transit attr isn't already present
  if (!hasTransitAlready && Object.keys(attrMap).length > 0) {
    const mapJson = JSON.stringify(attrMap)
      .replace(/</g, "\\u003C")
      .replace(/>/g, "\\u003E");

    // NOTE: single quotes chosen to keep double quotes untouched;
    // assumes earlier steps/gates keep single quotes acceptable in your pipeline.
    return `${head}${attrsOut} ${_TRANSIT_ATTRS}='${mapJson}'${tail}`;
  }

  return `${head}${attrsOut}${tail}`;
}

function read_tag_name(tag: string): { tagNameEnd: number } | null {
  // tag starts with '<' and is not skippable
  let i = 1;

  // Allow leading whitespace after '<' (tolerant)
  while (i < tag.length && is_ws(tag[i]!)) i++;

  // Read name chars until whitespace, '/', or '>'
  const start = i;
  while (i < tag.length) {
    const ch = tag[i]!;
    if (is_ws(ch) || ch === "/" || ch === ">") break;
    i++;
  }

  if (i === start) return null;

  // tagNameEnd is index right after the name
  return { tagNameEnd: i };
}

function read_tag_close(tag: string): { closeStart: number; closeText: string } | null {
  // tag ends with '>' always
  // close is either "/>" or ">"
  // We want the boundary where close begins, preserving any whitespace before it.
  let j = tag.length - 1;
  if (tag[j] !== ">") return null;

  // Look for "/>" with optional whitespace before '/'
  // e.g. " />" or "/>"
  // We'll treat the final '>' as part of closeText.
  const beforeGt = j - 1;
  if (beforeGt >= 0 && tag[beforeGt] === "/") {
    return { closeStart: beforeGt, closeText: tag.slice(beforeGt) }; // "/>"
  }

  return { closeStart: j, closeText: ">" };
}

function rewrite_attrs(attrsSrc: string): {
  attrsOut: string;
  attrMap: Record<string, string>;
  hasTransitAlready: boolean;
} {
  let out = "";
  let i = 0;

  const attrMap: Record<string, string> = Object.create(null);
  const usedSafe = new Set<string>();

  // CHANGED: detect if _TRANSIT_ATTRS already exists on this element;
  // if so, do not add another mapping attribute.
  let hasTransitAlready = false;

  while (i < attrsSrc.length) {
    // Copy whitespace verbatim
    if (is_ws(attrsSrc[i]!)) {
      out += attrsSrc[i]!;
      i++;
      continue;
    }

    // Read attribute name token
    const nameStart = i;
    while (i < attrsSrc.length) {
      const ch = attrsSrc[i]!;
      if (is_ws(ch) || ch === "=" || ch === "/" || ch === ">") break;
      i++;
    }
    const rawName = attrsSrc.slice(nameStart, i);
    if (!rawName) break;

    if (rawName === _TRANSIT_ATTRS) hasTransitAlready = true;

    // Read optional "=value" (including the exact whitespace around '=')
    const eqStart = i;

    // Consume whitespace after name
    while (i < attrsSrc.length && is_ws(attrsSrc[i]!)) i++;

    let eqval = "";
    if (i < attrsSrc.length && attrsSrc[i] === "=") {
      // include "="
      i++;

      // include any whitespace after '='
      while (i < attrsSrc.length && is_ws(attrsSrc[i]!)) i++;

      // now parse value: quoted or unquoted
      if (i < attrsSrc.length && (attrsSrc[i] === '"' || attrsSrc[i] === "'")) {
        const q = attrsSrc[i] as '"' | "'";
        i++; // consume quote
        while (i < attrsSrc.length && attrsSrc[i] !== q) i++;
        if (i < attrsSrc.length) i++; // consume closing quote
        eqval = attrsSrc.slice(eqStart, i);
      } else {
        // unquoted: read until whitespace or tag end-ish
        while (i < attrsSrc.length) {
          const ch = attrsSrc[i]!;
          if (is_ws(ch) || ch === "/" || ch === ">") break;
          i++;
        }
        eqval = attrsSrc.slice(eqStart, i);
      }
    } else {
      // No "=value" — flag attribute
      // eqval remains ""
      // i currently at first non-ws or end; but we consumed ws after name.
      // We want to preserve that ws we skipped; so we reconstruct as:
      // name + (whatever ws existed) + (rest)
      // CHANGED: keep the exact whitespace between name and next token:
      // we already skipped it, so re-add from attrsSrc.
      // eqStart points to original i before skipping ws.
      const wsBetween = attrsSrc.slice(eqStart, i);
      // We'll attach that wsBetween after the (possibly rewritten) name.
      // Store it in eqval so output order stays simple.
      eqval = wsBetween;
    }

    // CHANGED: namespace-aware attribute name policy:
    // - allow xml:* and xmlns:* untouched (real XML namespace machinery)
    // - everything else containing ":" must be mangled (via xHHHdisallowed, presumably)
    const safe0 = safe_attr_name(rawName);

    // CHANGED: avoid collisions: if safe name already used for a different raw name, disambiguate.
    let safe = safe0;
    if (safe !== rawName) {
      safe = disambiguate_safe_name(safe0, usedSafe, rawName, attrMap);
    } else if (usedSafe.has(safe)) {
      // Even unchanged names can collide if duplicated attrs exist in source;
      // you already have a dedupe pass elsewhere, so here we just disambiguate
      // to keep XML parseable if duplicates slip through.
      safe = disambiguate_safe_name(safe0, usedSafe, rawName, attrMap);
    }

    usedSafe.add(safe);

    if (safe !== rawName) {
      attrMap[safe] = rawName;
    }

    out += safe + eqval;
  }

  return { attrsOut: out, attrMap, hasTransitAlready };
}

function safe_attr_name(name: string): string {
  // preserve true XML namespace attrs
  if (name === "xmlns") return name;
  if (name.startsWith("xmlns:")) return name;
  if (name.startsWith("xml:")) return name;

  // CHANGED: colon in attr name => XML namespace syntax; treat as illegal for HTML-origin attrs
  if (name.includes(":")) {
    // pick a stable encoding that is XML-name-safe
    // (don’t use ":"; don’t introduce leading digits; keep it readable)
    return name.replace(/:/g, "__COLON__");
  }

  return xHHHdisallowed(name);
}

function disambiguate_safe_name(
  base: string,
  used: Set<string>,
  rawName: string,
  map: Record<string, string>
): string {
  // CHANGED: stable-ish disambiguation that avoids collisions.
  // Prefer suffixes that are XML-name friendly.
  if (!used.has(base) && !(base in map)) return base;

  let n = 1;
  while (true) {
    const candidate = `${base}__${n}`;
    if (!used.has(candidate) && !(candidate in map)) return candidate;
    n++;
  }
}

function is_ws(ch: string): boolean {
  // space / tab / newline / carriage return / formfeed
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

// /*******
//  * Rewrite illegal / non-XML attribute names into an ASCII-safe form and
//  * record a reversible mapping on the element.
//  *
//  * This is a *transport* helper used when HTML-ish input may contain
//  * attribute names that are not valid under XML-ish “Name” rules (or when
//  * downstream tooling expects XML-safe names). It rewrites those attribute
//  * names into a safe token form and appends a special transit attribute
//  * containing a per-element JSON map of:
//  *
//  *   { "<mangledName>": "<originalName>" }
//  *
//  * Behavior:
//  * - Scans the source text for `<...>` tag spans and rewrites attributes
//  *   *within* those spans only; text nodes outside tags are passed through.
//  * - Skips closing tags, comments, doctype, and processing instructions.
//  * - For each attribute name, calls `xHHHdisallowed(name)`:
//  *   - If the name matches the XML-ish `XML_NAME` regex, it is left as-is.
//  *   - Otherwise it is replaced with an ASCII-safe name derived from the
//  *     original, using `_xHHHH_` escape sequences for disallowed characters.
//  * - If *any* attributes on a tag were rewritten, appends a transit attribute
//  *   (e.g. `data--attrmap`) whose value is a JSON string of the mapping.
//  *
//  * Important constraints / assumptions:
//  * - This expects attribute values to already be *quoted* when present
//  *   (e.g. by `quote_unquoted_attrs`) so the simple regex-based scan does
//  *   not accidentally split on whitespace inside values.
//  * - This does not attempt to fully parse HTML; it’s a practical preflight
//  *   pass that operates on well-formed-ish markup.
//  * - Only attribute *names* are mangled; element tag names are left untouched.
//  *
//  * Security / robustness notes:
//  * - The mapping JSON is written into a single-quoted attribute value and
//  *   additionally escapes literal `<` and `>` to avoid accidentally creating
//  *   new tag boundaries in later string-based processing.
//  * - The mapping attribute is intended to be consumed and removed during
//  *   a controlled “transit” decode step (e.g. when converting back to HSON),
//  *   not left in final user-facing markup.
//  *
//  * @param src - Markup source containing tags whose attribute names may need mangling.
//  * @returns The source with illegal attribute names rewritten and mapping data attached
//  *          per element when any rewrite occurred.
//  *******/
// export function mangle_illegal_attrs(src: string): string {
//   let out = "";
//   let i = 0;
//   while (i < src.length) {
//     const lt = src.indexOf("<", i);
//     if (lt < 0) { out += src.slice(i); break; }
//     const gt = src.indexOf(">", lt + 1);
//     if (gt < 0) { out += src.slice(i); break; }

//     out += src.slice(i, lt);
//     const tag = src.slice(lt, gt + 1);

//     // Skip comments/doctype/processing
//     if (/^<\/|^<!|^<\?/.test(tag.slice(1))) { out += tag; i = gt + 1; continue; }

//     const attrMap: Record<string, string> = {};

//     const rewritten = tag.replace(
//       // name[=value]? capturing name, value separately (value already quoted by previous step)
//       /(<[^\s\/>]+)|(\s+)([^\s"'=\/><]+)(\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')))?/g,
//       (m, openTag, space, name, eqval) => {
//         if (openTag) return openTag; // element name untouched here
//         const safe = xHHHdisallowed(name);
//         if (safe !== name) attrMap[safe] = name;
//         return `${space}${safe}${eqval ?? ""}`;
//       }
//     );

//     if (Object.keys(attrMap).length > 0) {
//       // append a per-element mapping attribute (ASCII-safe JSON)
//       const mapJson = JSON.stringify(attrMap)
//         .replace(/</g, "\\u003C") // avoid accidental tag starts
//         .replace(/>/g, "\\u003E");
//       const withMap = rewritten.replace(/>$/, ` ${_TRANSIT_ATTRS}='${mapJson}'>`);
//       out += withMap;
//     } else {
//       out += rewritten;
//     }

//     i = gt + 1;
//   }
//   return out;
// }
