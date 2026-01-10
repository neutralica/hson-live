// build-wire-attrs.ts


import { _META_DATA_PREFIX } from "../../consts/constants";
import { HsonNode } from "../../types-consts/node.types";
import { serialize_style } from "../attrs-utils/serialize-style";

/**
 * Build a DOM-ready attribute map for an `HsonNode`.
 *
 * This is the “wire format” step: it flattens a node’s internal `_attrs` plus
 * selected `_meta` keys into a plain `{ [name]: string }` dictionary suitable
 * for `Element.setAttribute(...)` / element construction.
 *
 * Rules:
 * - User attributes (`n._attrs`) are copied as string values.
 *   - Special-case: `"style"`
 *     - If `style` is an object (your `StyleObject` shape), it is serialized to
 *       CSS text via `serialize_style(...)`.
 *     - If `style` is already a string, it is passed through unchanged.
 * - Meta attributes (`n._meta`) are *not* generally exposed.
 *   - Only keys beginning with the `_META_DATA_PREFIX` (e.g. `"data-_"`) are
 *     included, and the key is preserved exactly.
 *
 * Notes / invariants:
 * - This function does not validate attribute names or escape values; it assumes
 *   earlier stages enforced the “safe” boundary (or you are building trusted DOM).
 * - It intentionally ignores non-`data-_` meta so internal bookkeeping doesn’t
 *   leak into rendered markup.
 *
 * @param n - Source HSON node whose `_attrs` and `_meta` will be projected onto
 *            a DOM attribute dictionary.
 * @returns A string-valued attribute record representing the node’s wire attrs.
 */
export function build_wire_attrs(n: HsonNode): Record<string, string> {
  const out: Record<string, string> = {};

  // 1) user attrs (primitives only; style handled elsewhere)
  const a = n._attrs;
  if (a) {
    for (const [k, v] of Object.entries(a)) {
      //  handle style instead of skipping it
      if (k === "style") {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          //  object → CSS text
          out.style = serialize_style(v as Record<string, string>);
        } else if (typeof v === "string") {
          //  already a CSS string; pass through
          out.style = v;
        }
        continue; //  done with style
      }

      // un primitives/other attrs
      out[k] = String(v as any);
    }
  }

  // 2) meta: only keys that start with 'data-_', keep EXACT key
  const m = n._meta;
  if (m) {
    for (const [k, v] of Object.entries(m)) {
      if (k.startsWith(_META_DATA_PREFIX)) out[k] = String(v);
    }
  }

  return out;
}
