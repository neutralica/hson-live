// serialize-html.new.render.ts

import { Primitive } from '../../types-consts/core.types'
import { is_Primitive } from '../../utils/cote-utils/guards.core';
import { ELEM_TAG, EVERY_VSN, OBJ_TAG, ROOT_TAG, STR_TAG, VAL_TAG } from '../../consts/constants';
import { build_wire_attrs } from '../../utils/html-utils/build-wire-attrs';
import { escape_html } from '../../utils/html-utils/escape-html';
import { make_string } from '../../utils/primitive-utils/make-string.nodes.utils';
import { _snip } from '../../utils/sys-utils/snip.utils';
import { is_Node } from '../../utils/node-utils/node-guards';
import { assert_invariants } from '../../diagnostics/assert-invariants.test';
import { clone_node } from '../../utils/node-utils/clone-node';
import { HsonNode } from '../../types-consts/node.types';
import { _throw_transform_err } from '../../utils/sys-utils/throw-transform-err.utils';

  const RAWTEXT = new Set(["style", "script"]);

/**
 * Collect raw textual content from a subtree without trimming or escaping.
 *
 * Behavior:
 * - Walks a mixed list of `HsonNode | Primitive`.
 * - For `_str` nodes:
 *   - Takes the first `_content` entry (if any),
 *   - Uses it as a string if already a string, otherwise stringifies it.
 * - For other node types:
 *   - Recursively descends into their `_content`.
 * - For primitive leaves:
 *   - Appends `String(primitive)` directly.
 *
 * Notes:
 * - Does not perform any HTML/XML escaping.
 * - Does not collapse whitespace or remove newlines.
 *
 * Intended use:
 * - Raw-text serialization for RAWTEXT elements like `<style>` and `<script>`
 *   where content should be preserved verbatim as much as possible.
 *
 * @param nodes - The mixed child list to traverse.
 * @returns Concatenated raw text content.
 */
function collect_raw_text(nodes: (HsonNode | Primitive)[] | undefined): string {
  if (!nodes || !nodes.length) return "";
  let out = "";
  for (const ch of nodes) {
    if (is_Node(ch)) {
      if (ch._tag === STR_TAG) {
        const seg = (ch._content?.[0] ?? "") as unknown;
        out += typeof seg === "string" ? seg : String(seg);
      } else {
        // descend, in case someone wrapped _str in an extra node
        out += collect_raw_text(ch._content as any);
      }
    } else {
      // primitive leaf: take as-is (no entity escaping)
      out += String(ch);
    }
  }
  return out;
}

/**
 * Escape a string for safe use inside a double-quoted XML/HTML attribute.
 *
 * Escapes the following:
 * - `&` → `&amp;`
 * - `"` → `&quot;`
 * - `<` → `&lt;`
 *
 * Does *not* escape `'` or `>`; sufficient for the attribute formats this
 * serializer emits (`key="value"`).
 *
 * @param v - Raw attribute value.
 * @returns Escaped attribute-safe string.
 */
function escape_attr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Serialize a primitive value into escaped XML text.
 *
 * Rules:
 * - If `p` is a string:
 *   - Return `escape_html(p)` directly (text-escaped string).
 * - For non-string primitives (number, boolean, null):
 *   - Convert to string with `String(p)` and then escape via `escape_html`.
 *
 * This is the primitive-level counterpart to `serialize_xml`, ensuring
 * consistent escaping for bare primitive nodes and text children.
 *
 * @param p - Primitive value to serialize.
 * @returns Escaped XML-safe text representation.
 */
function primitive_to_xml(p: Primitive): string {
  //  strings escape as text, others stringify+escape
  if (typeof p === 'string') return escape_html(p);
  return escape_html(String(p));
}

/**
 * Low-level XML serializer for HSON nodes.
 *
 * Role:
 * - Convert a `HsonNode | Primitive` tree to an XML-like string that is
 *   *structurally faithful* to the HSON IR, suitable as an intermediate
 *   for later HTML normalization (`serialize_html`).
 *
 * Special cases:
 * - Primitive input:
 *   - Delegated to `primitive_to_xml(p)`.
 *
 * - `_str`:
 *   - Must have exactly one string in `_content`.
 *   - Empty string is rendered as `""` (two quotes) so that the parser
 *     can distinguish “empty” from “missing”.
 *   - Non-empty strings are rendered as bare escaped text.
 *
 * - `_val`:
 *   - Must have exactly one primitive in `_content`.
 *   - Rendered as `<_val>…</_val>` with escaped contents to preserve
 *     type boundaries on round trip.
 *
 * - `_elem`:
 *   - Flattened away; serializes each child in `_content` and joins with
 *     newlines. No explicit `<_elem>` tag appears in the XML.
 *
 * - `_root`:
 *   - Must contain exactly one child.
 *   - That child is serialized directly; `<_root>` is melted and does not
 *     appear in the XML surface.
 *
 * - `_obj`:
 *   - Serialized as a literal `<_obj>…</_obj>` wrapper, where each
 *     property child is serialized recursively. This preserves object
 *     structure in the XML form.
 *
 * Default path (all other tags, including `_arr`, `_ii`, and normal HTML):
 * - Builds an opening tag `<tag ...>`:
 *   - Attributes come from `build_wire_attrs(node)`; for `<svg>`,
 *     ensures `xmlns` is set if missing.
 *   - Attribute values are escaped via `escape_attr`.
 * - Children:
 *   - RAWTEXT tags (`style`, `script`) use `collect_raw_text` with a
 *     guard against `</style` / `</script` sequences.
 *   - Others map children to either:
 *       - recursive `serialize_xml` for nodes, or
 *       - `primitive_to_xml` for primitives.
 *   - Concatenate children without extra whitespace by default.
 *
 * Invariants:
 * - Throws on unknown VSN-like tags (`_<something>` not in `EVERY_VSN`).
 * - Throws when `_str` / `_val` shape is invalid.
 *
 * @param node - Node or primitive to serialize.
 * @returns XML string representation of the node.
 */
export function serialize_xml(node: HsonNode | Primitive | undefined): string {
  if (is_Primitive(node)) return primitive_to_xml(node);
  if (node === undefined) {
    _throw_transform_err('undefined node received', 'serialize_html', node);
  }

  const { _tag: tag, _content: content = [] } = node;

  // correct origin label for error
  if (tag.startsWith('_') && !EVERY_VSN.includes(tag)) {
    _throw_transform_err(`unknown VSN-like tag: <${tag}>`, 'serialize_html');
  }

  switch (tag) {
    // _str always melts to bare text
    case STR_TAG: {
      if (!content || content.length !== 1 || typeof content[0] !== 'string') {
        _throw_transform_err('<_str> must contain exactly one string', 'serialize_html');
      }
      const s = content[0] as string;

      // Special case: empty string must be visible in HTML
      if (s === '') {
        return '""'; // two quotes; will be decoded by HTML parser back to _str([""])
      }

      // Non-empty strings remain melted as plain text
      return escape_html(s);
    }

    // keep <_val> literal for round-trip typing
    case VAL_TAG: {
      if (!content || content.length !== 1) {
        _throw_transform_err('<_val> must contain exactly one value', 'serialize_html');
      }
      const v = content[0] as Primitive;
      return `<${VAL_TAG}>${escape_html(String(v))}</${VAL_TAG}>`;
    }

    // flatten element cluster
    case ELEM_TAG: {
      return (content as (HsonNode | Primitive)[]).map(ch => serialize_xml(ch as any)).join('\n');
    }

    // melt _root (must have exactly one cluster child)
    case ROOT_TAG: {
      const kids = content as HsonNode[];
      if (kids.length !== 1) {
        _throw_transform_err('_root must have exactly one child', 'serialize_html');
      }
      return serialize_xml(kids[0]);
    }

    // object cluster → each property becomes an HTML element
    case OBJ_TAG: {
      const props = (content as HsonNode[]) ?? [];
      const inner = props.map(serialize_xml).join('\n');
      return `<${OBJ_TAG}>\n${inner}\n</${OBJ_TAG}>`;
    }

  }
  // --------------- default path: literal tags (incl. _arr/_ii and normal HTML) ---------------

  let openAttrs = `<${tag}`;
  const attrs = build_wire_attrs(node);
  if (tag === "svg") {
  // ensure default SVG ns on the root svg element if not present
  if (!("xmlns" in attrs)) attrs.xmlns = "http://www.w3.org/2000/svg";
}

  for (const k of Object.keys(attrs).sort()) {
    openAttrs += ` ${k}="${escape_attr(attrs[k])}"`;
  }

  const kids = (content as (HsonNode | Primitive)[]) ?? [];

  // RAW-TEXT MODE: style/script → emit verbatim, no escaping/trim/collapse
  let inner: string;
  if (RAWTEXT.has(tag.toLowerCase())) {
    inner = collect_raw_text(kids)
      .replace(/<\/(style|script)/gi, "<\\/$1>"); // guard early close
  } else {
    inner = kids.map(ch => is_Node(ch) ? serialize_xml(ch as HsonNode)
      : primitive_to_xml(ch as Primitive))
      .join("");
  }

  return `${openAttrs}>${inner}</${tag}>`;
}

/**
 * Public HTML serializer for HSON trees (2.0 surface).
 *
 * Pipeline:
 * 1. Clone & guard:
 *    - `clone_node($node)` to avoid mutating the original IR.
 *    - Require that the clone is a valid `HsonNode`, otherwise throw.
 *
 * 2. Invariant check:
 *    - `assert_invariants(clone, "serialize_html")` ensures that the
 *      internal HSON structure is well-formed before any emission.
 *
 * 3. XML stage:
 *    - Delegates to `serialize_xml(clone)` to produce an XML-like string
 *      that faithfully represents HSON semantics (including `_val`, `_obj`,
 *      `_arr`, `_ii`, etc.).
 *
 * 4. HTML normalization:
 *    - Converts boolean attributes from `key="key"` to `key` using a regex
 *      replacement; this matches standard HTML boolean attribute semantics.
 *
 * 5. Safety guard:
 *    - Asserts that no literal `<_str>` tag leaks into the final HTML.
 *      If such a tag is present, throws a transform error; `_str` must
 *      always be melted into text at the serialization boundary.
 *
 * 6. Finalization:
 *    - Returns `htmlString.trim()` to remove leading/trailing whitespace.
 *
 * Characteristics:
 * - `_str` appears only as escaped text in the output.
 * - `_val` uses a `<_val>…</_val>` literal representation.
 * - `_elem` and `_root` are structure-only and never appear as tags.
 * - `_obj` and other clusters remain visible where necessary to preserve
 *   HSON’s JSON-mode structure.
 *
 * @param node - Root HSON node or primitive to serialize as HTML.
 * @returns A trimmed HTML string ready for DOM insertion or inspection.
 * @throws If invariants fail, if `_str` leaks as a literal tag, or if the
 *   input is not a valid HsonNode.
 */
export function serialize_html(node: HsonNode | Primitive): string {

  const clone = clone_node(node);
  if (!is_Node(clone)) {
    _throw_transform_err('input node cannot be undefined for node_to_html', 'serialize_html', make_string(node));
  }

  // tree assertions throw if structure is off
  assert_invariants(clone, 'serialize_html');

  const xmlString = serialize_xml(clone);

  // HTML boolean attrs: key="key" → key
  const htmlString = xmlString.replace(/\b([^\s=]+)="\1"/g, '$1');

  // guard: never let literal <_str> leak into output
  if (/<\s*_str\b/.test(htmlString)) {
    _throw_transform_err('literal <_str> leaked into HTML output', 'serialize_html', htmlString.slice(0, 400));
  }
  return htmlString.trim();

}
