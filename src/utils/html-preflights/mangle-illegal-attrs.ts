// mangle-illegal-attrs.ts
import { _TRANSIT_ATTRS, _TRANSIT_PREFIX } from "../../consts/constants";

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

/*******
 * Rewrite illegal / non-XML attribute names into an ASCII-safe form and
 * record a reversible mapping on the element.
 *
 * This is a *transport* helper used when HTML-ish input may contain
 * attribute names that are not valid under XML-ish “Name” rules (or when
 * downstream tooling expects XML-safe names). It rewrites those attribute
 * names into a safe token form and appends a special transit attribute
 * containing a per-element JSON map of:
 *
 *   { "<mangledName>": "<originalName>" }
 *
 * Behavior:
 * - Scans the source text for `<...>` tag spans and rewrites attributes
 *   *within* those spans only; text nodes outside tags are passed through.
 * - Skips closing tags, comments, doctype, and processing instructions.
 * - For each attribute name, calls `xHHHdisallowed(name)`:
 *   - If the name matches the XML-ish `XML_NAME` regex, it is left as-is.
 *   - Otherwise it is replaced with an ASCII-safe name derived from the
 *     original, using `_xHHHH_` escape sequences for disallowed characters.
 * - If *any* attributes on a tag were rewritten, appends a transit attribute
 *   (e.g. `data--attrmap`) whose value is a JSON string of the mapping.
 *
 * Important constraints / assumptions:
 * - This expects attribute values to already be *quoted* when present
 *   (e.g. by `quote_unquoted_attrs`) so the simple regex-based scan does
 *   not accidentally split on whitespace inside values.
 * - This does not attempt to fully parse HTML; it’s a practical preflight
 *   pass that operates on well-formed-ish markup.
 * - Only attribute *names* are mangled; element tag names are left untouched.
 *
 * Security / robustness notes:
 * - The mapping JSON is written into a single-quoted attribute value and
 *   additionally escapes literal `<` and `>` to avoid accidentally creating
 *   new tag boundaries in later string-based processing.
 * - The mapping attribute is intended to be consumed and removed during
 *   a controlled “transit” decode step (e.g. when converting back to HSON),
 *   not left in final user-facing markup.
 *
 * @param src - Markup source containing tags whose attribute names may need mangling.
 * @returns The source with illegal attribute names rewritten and mapping data attached
 *          per element when any rewrite occurred.
 *******/
export function mangle_illegal_attrs(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { out += src.slice(i); break; }
    const gt = src.indexOf(">", lt + 1);
    if (gt < 0) { out += src.slice(i); break; }

    out += src.slice(i, lt);
    const tag = src.slice(lt, gt + 1);

    // Skip comments/doctype/processing
    if (/^<\/|^<!|^<\?/.test(tag.slice(1))) { out += tag; i = gt + 1; continue; }

    const attrMap: Record<string, string> = {};

    const rewritten = tag.replace(
      // name[=value]? capturing name, value separately (value already quoted by previous step)
      /(<[^\s\/>]+)|(\s+)([^\s"'=\/><]+)(\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')))?/g,
      (m, openTag, space, name, eqval) => {
        if (openTag) return openTag; // element name untouched here
        const safe = xHHHdisallowed(name);
        if (safe !== name) attrMap[safe] = name;
        return `${space}${safe}${eqval ?? ""}`;
      }
    );

    if (Object.keys(attrMap).length > 0) {
      // append a per-element mapping attribute (ASCII-safe JSON)
      const mapJson = JSON.stringify(attrMap)
        .replace(/</g, "\\u003C") // avoid accidental tag starts
        .replace(/>/g, "\\u003E");
      const withMap = rewritten.replace(/>$/, ` ${_TRANSIT_ATTRS}='${mapJson}'>`);
      out += withMap;
    } else {
      out += rewritten;
    }

    i = gt + 1;
  }
  return out;
}
