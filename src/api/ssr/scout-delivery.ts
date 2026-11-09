import { Parser } from "htmlparser2";
import type { LocusSession, LocusSessionHtmlNow } from "../../types/locus.core.types.js";
import type { HsonAuthored } from "../transform/transform.types.js";
import { scout_delivery_session } from "../../internal/scout-delivery-session.js";
import { write_scout_part_internal } from "../../internal/part-write.js";
import { read_livemap_part_internal } from "../livemap/livemap.libraries.js";
import { parse_authored_document_library } from "../livemap/livemap.document.quad.js";
import { expand_document_composition, document_composition_options } from "../livemap/livemap.document.composition.js";
import { realize_document } from "../../internal/document-cut.js";
import { encode_ignition, ignition_path, SCOUT_LOADER_ATTRIBUTE } from "../scout/scout.ignition.js";

/** Deliver one authorized capture with an authored Scout Part and the standard module.
 * The returned HTTP response contains a credential and is private and non-cacheable.
 * Serve scout-auto.js at the supplied module path and its matching scout-hosted.js
 * companion in the same directory. Deploy both files from the same build. */
export function deliver_scout(session: LocusSession, now: LocusSessionHtmlNow,
  scout: Readonly<{ write: (args: Readonly<{ payload: string }>) => HsonAuthored }>,
  paths: Readonly<{ endpoint: string; module: string }>): Response {
  const owner = scout_delivery_session(session, now);
  let claimed = false;
  try {
    owner.begin(() => { claimed = true; });
    // Without a trusted response origin an absolute base cannot be proved safe.
    // Relative bases preserve the document origin for our origin-relative loader.
    const parser = new Parser({ onopentag(name, attrs) {
      if (name === "base" && Object.hasOwn(attrs, "href")) {
        const href = attrs.href;
        if (!/^[A-Za-z0-9_./?#=&%\-]*$/.test(href)
          || new URL(href, "https://scout.invalid/").origin !== "https://scout.invalid") {
          throw new Error("Scout delivery cannot verify an absolute or foreign HTML base; use a relative base href for standard delivery.");
        }
      }
    } });
    parser.end(now.html);
    const endpoint = ignition_path(paths.endpoint), module = ignition_path(paths.module);
    const token = session.credential;
    if (token === undefined) throw new Error("Scout delivery requires a retained session credential.");
    const payload = encode_ignition(now, now.document, token, endpoint);
    const source = write_scout_part_internal(scout, payload);
    const parsed = parse_authored_document_library(source);
    if (parsed.declarations.length) throw new Error("Scout delivery does not support authored identity contributions.");
    const realized = expand_document_composition("scout-delivery", () => ({ root: parsed.root }),
      document_composition_options(undefined), (collection, member) => {
        const part = read_livemap_part_internal(owner.map, collection, member);
        if (part.css !== undefined || part.quads !== undefined) throw new Error("Scout Parts cannot contribute CSS or authored identities.");
        return part;
      });
    if (realized.interactions.length) throw new Error("Scout delivery cannot carry authored interactions.");
    if (realized.styles.length || realized.quads?.length || realized.scoped.document.length
      || realized.scoped.occurrences.some(occurrence => occurrence.bindings.length)) {
      throw new Error("Scout delivery cannot discard CSS or identity contributions.");
    }
    const html = realize_document(realized.root);
    // Exact expected serialization validates the realized declaration and opaque scalar.
    if (html !== `<hson-scout hidden="">${payload}</hson-scout>`
      && html !== `<hson-scout hidden="hidden">${payload}</hson-scout>`) throw new Error("Part must realize exactly one hidden Scout carrying its payload.");
    if (!now.html.startsWith("<!doctype html><html") || !now.html.endsWith("</body></html>")
      || now.html.includes(SCOUT_LOADER_ATTRIBUTE) || /<hson-scout[\s>]/i.test(now.html)) {
      throw new Error("Scout delivery requires a complete captured HTML document without delivery infrastructure.");
    }
    owner.assert();
    return new Response(now.html.slice(0, -7) + html
      + `<script type="module" src="${module}" ${SCOUT_LOADER_ATTRIBUTE}="1"></script></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
  } catch (cause) {
    try { if (claimed) session.revoke(); } catch { /* Keep the delivery failure primary. */ }
    throw cause;
  }
}
