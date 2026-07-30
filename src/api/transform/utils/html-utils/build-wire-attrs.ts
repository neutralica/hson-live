// build-wire-attrs.ts


import {
  hson_metadata_policy,
  hson_metadata_value_is_valid,
} from "../../../../core/hson-metadata.js";
import { HsonNode } from "../../../../core/types.js";
import { serialize_style } from "../attrs-utils/serialize-style.js";

/**
 * Build a DOM-ready attribute map for an `HsonNode`.
 *
 * This is the “wire format” step: it flattens a node’s internal `$_attrs` plus
 * selected `$_meta` keys into a plain `{ [name]: string }` dictionary suitable
 * for `Element.setAttribute(...)` / element construction.
 *
 * Rules:
 * - User attributes (`n.$_attrs`) are copied as string values.
 *   - Special-case: `"style"`
 *     - If `style` is an object (your `StyleObject` shape), it is serialized to
 *       CSS text via `serialize_style(...)`.
 *     - If `style` is already a string, it is passed through unchanged.
 * - Exact registered metadata is projected through its owned markup spelling.
 *
 * Notes / invariants:
 * - This function does not validate attribute names or escape values; it assumes
 *   earlier stages enforced the “safe” boundary (or you are building trusted DOM).
 * - Unknown or misplaced metadata rejects instead of leaking or being dropped.
 *
 * @param n - Source HSON node whose `$_attrs` and `$_meta` will be projected onto
 *            a DOM attribute dictionary.
 * @returns A string-valued attribute record representing the node’s wire attrs.
 */
export function build_wire_attrs(n: HsonNode): Record<string, string> {
  const out: Record<string, string> = {};

  // 1) user attrs (primitives only; style handled elsewhere)
  const a = n.$_attrs;
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

  // 2) exact registered metadata projected to its markup spelling
  const m = n.$_meta;
  if (m) {
    for (const [k, v] of Object.entries(m)) {
      const policy = hson_metadata_policy(n.$_tag, k);
      if (!policy.valid) {
        throw new Error(`Invalid HSON metadata "${k}" on <${n.$_tag}>: ${policy.reason}`);
      }
      if (!hson_metadata_value_is_valid(k, v)) {
        throw new Error(`Invalid value for HSON metadata "${k}" on <${n.$_tag}>.`);
      }
      out[policy.definition.markupName] = v;
    }
  }

  return out;
}
