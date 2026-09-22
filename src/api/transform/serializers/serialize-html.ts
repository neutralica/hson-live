// serialize-html.ts

import { Primitive } from '../../../core/types.js'
import { is_Primitive } from '../../../core/value-guards.js';
import { ELEM_TAG, EVERY_VSN, HSON_SYS_PREFIX, HTML_KEY_PREFIX, OBJ_TAG, ROOT_TAG, STR_TAG, VAL_TAG } from '../../../core/constants.js';
import { build_wire_attrs } from '../utils/html-utils/build-wire-attrs.js';
import { escape_html_text } from '../utils/html-utils/escape-html.js';
import { make_string } from '../../../core/stringify.js';
import { _snip } from '../utils/sys-utils/snip.utils.js';
import { is_Node } from '../../../core/node-guards.js';
import { assert_invariants } from '../../../core/assert-invariants.js';
import { collect_hson_node_quid_claims } from '../../../core/hson-node-quid.js';
import { clone_node } from '../../../core/clone-node.js';
import { HsonNode } from '../../../core/types.js';
import { _throw_transform_err } from '../utils/sys-utils/throw-transform-err.utils.js';
import { encode_html_key_tag } from '../utils/html-utils/encode-html-tag.js';
import { can_melt_html_text_leaf, encode_html_raw_text, encode_html_text_leaf } from '../utils/html-utils/html-text-transport.js';

const RAWTEXT = new Set(["style", "script"]);

/** Extract canonical RAWTEXT string leaves without merging their boundaries. */
function raw_text_values(nodes: readonly (HsonNode | Primitive)[]): string[] {
  const content = nodes.length === 1 && is_Node(nodes[0]) && nodes[0].$_tag === ELEM_TAG
    ? nodes[0].$_content
    : nodes;
  return content.map((child) => {
    if (!is_Node(child) || child.$_tag !== STR_TAG || child.$_content.length !== 1
      || typeof child.$_content[0] !== "string") {
      _throw_transform_err("RAWTEXT transport requires string leaves", "serialize_html");
    }
    return child.$_content[0];
  });
}


//  strict XML attribute escaper (XML 1.0) + control-char guard
export function escape_attr(v: string): string {
  // reject illegal XML 1.0 control chars (except \t \n \r)
  for (let i = 0; i < v.length; i++) {
    const code = v.charCodeAt(i);
    const illegal =
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0B ||
      code === 0x0C ||
      (code >= 0x0E && code <= 0x1F);
    if (illegal) {
      _throw_transform_err(
        `Illegal XML control char U+${code.toString(16).padStart(4, "0")} in attribute value`,
        "escape_attr",
        v
      );
    }
  }

  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(`"`, "&quot;")
    .replaceAll("'", "&apos;");
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
  if (typeof p === 'string') return escape_html_text(p);
  return escape_html_text(typeof p === "number" && Object.is(p, -0) ? "-0" : String(p));
}

/**
 * Low-level XML serializer for Hson nodes.
 *
 * Role:
 * - Convert a `HsonNode | Primitive` tree to an XML-like string that is
 *   *structurally faithful* to the Hson IR, suitable as an intermediate
 *   for later HTML normalization (`serialize_html`).
 *
 * Special cases:
 * - Primitive input:
 *   - Delegated to `primitive_to_xml(p)`.
 *
 * - `_hson_str`: emits HTML text, with a reserved boundary comment when exact
 *   code units or leaf topology require it.
 *
 * - `_hson_val`:
 *   - Must have exactly one primitive in `$_content`.
 *   - Rendered as `<_hson_val>…</_hson_val>` with escaped contents to preserve
 *     type boundaries on round trip.
 *
 * - `_hson_elem`: melts into HTML children. Reserved boundary comments retain
 *   adjacent, empty, and whitespace-sensitive text leaves.
 *
 * - `_hson_root`:
 *   - Must contain exactly one child.
 *   - That child is serialized directly; `<_hson_root>` is melted and does not
 *     appear in the XML surface.
 *
 * - `_hson_obj`:
 *   - Serialized as a literal `<_hson_obj>…</_hson_obj>` wrapper, where each
 *     property child is serialized recursively. This preserves object
 *     structure in the XML form.
 *
 * Default path (all other tags, including `_hson_arr`, `_hson_ii`, and normal HTML):
 * - Builds an opening tag `<tag ...>`:
 *   - Attributes come from `build_wire_attrs(node)`; for `<svg>`,
 *     ensures `xmlns` is set if missing.
 *   - Attribute values are escaped via `escape_attr`.
 * - Children:
 *   - RAWTEXT tags (`style`, `script`) use the reserved lexical codec for
 *     every nonempty textual body.
 *   - Others map children to either:
 *       - recursive `serialize_xml` for nodes, or
 *       - `primitive_to_xml` for primitives.
 *   - Concatenate children without extra whitespace by default.
 *
 * Invariants:
 * - Throws on unknown VSN-like tags (`_<something>` not in `EVERY_VSN`).
 * - Throws when `_hson_str` / `_hson_val` shape is invalid.
 *
 * @param node - Node or primitive to serialize.
 * @returns XML string representation of the node.
 */
function serialize_xml_node(node: HsonNode | Primitive | undefined): string {
  if (is_Primitive(node)) return primitive_to_xml(node);
  if (node === undefined) {
    _throw_transform_err('undefined node received', 'serialize_html', node);
  }

  const {
    $_tag: rawTag,
    $_content: content = [],
  } = node;

  // NEW: wire-format tag for XML output
  const tag = encode_html_key_tag(rawTag);

  // correct origin label for error
  if (
    node.$_tag.startsWith(HSON_SYS_PREFIX) &&
    !node.$_tag.startsWith(HTML_KEY_PREFIX) &&
    !EVERY_VSN.includes(node.$_tag)
  ) {
    _throw_transform_err(`unknown VSN-like tag: <${node.$_tag}>`, "serialize-hson");
  }

  switch (tag) {
    // Semantic string leaves remain HTML text; reserved comments retain
    // boundaries and code units that HTML/XML would otherwise erase.
    case STR_TAG: {
      if (content.length !== 1 || typeof content[0] !== "string") {
        _throw_transform_err("invalid _hson_str leaf", "serialize_html");
      }
      return encode_html_text_leaf(content[0]);
    }

    // keep <_hson_val> literal for round-trip typing
    case VAL_TAG: {
      if (!content || content.length !== 1) {
        _throw_transform_err('<_hson_val> must contain exactly one value', 'serialize_html');
      }
      const v = content[0] as Primitive;
      return `<${VAL_TAG}>${primitive_to_xml(v)}</${VAL_TAG}>`;
    }

    // Melt ordinary element content when the text-node boundaries are already
    // unambiguous. Otherwise emit a reserved text boundary so adjacent,
    // empty, sentinel-like, and boundary-whitespace strings remain injective.
    case ELEM_TAG: {
      const kids = content as (HsonNode | Primitive)[];
      return kids.map((child, index) => {
        if (is_Node(child) && child.$_tag === STR_TAG) {
          const value = child.$_content[0];
          if (typeof value !== "string") _throw_transform_err("invalid _hson_str leaf", "serialize_html");
          const previous = kids[index - 1];
          const next = kids[index + 1];
          if (can_melt_html_text_leaf(value)
            && !(is_Node(previous) && previous.$_tag === STR_TAG)
            && !(is_Node(next) && next.$_tag === STR_TAG)) return escape_html_text(value);
        }
        return serialize_xml_node(child);
      }).join("");
    }

    // melt _hson_root (must have exactly one cluster child)
    case ROOT_TAG: {
      const kids = content as HsonNode[];
      if (kids.length !== 1) {
        _throw_transform_err('_hson_root must have exactly one child', 'serialize_html');
      }
      const only = kids[0];
      if (only.$_tag === STR_TAG || only.$_tag === VAL_TAG) {
        return `<${OBJ_TAG}>${serialize_xml_node(only)}</${OBJ_TAG}>`;
      }
      return serialize_xml_node(only);
    }

    // object cluster → each property becomes an HTML element
    case OBJ_TAG: {
      const props = (content as HsonNode[]) ?? [];
      const inner = props.map(serialize_xml_node).join('\n');
      return `<${OBJ_TAG}>\n${inner}\n</${OBJ_TAG}>`;
    }

  }
  // --------------- default path: literal tags (incl. _hson_arr/_hson_ii and normal HTML) ---------------

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

  // One reserved lexical mode keeps all nonempty RAWTEXT bodies unambiguous.
  let inner: string;
  if (RAWTEXT.has(tag.toLowerCase())) {
    inner = encode_html_raw_text(raw_text_values(kids));
  } else {
    inner = kids.map(ch => is_Node(ch) ? serialize_xml_node(ch as HsonNode)
      : primitive_to_xml(ch as Primitive))
      .join("");
  }

  return `${openAttrs}>${inner}</${tag}>`;
}

/** Serialize one canonical graph value into its HTML transport spelling. */
export function serialize_xml(node: HsonNode | Primitive | undefined): string {
  if (is_Node(node) && (node.$_tag === STR_TAG || node.$_tag === VAL_TAG)) {
    return `<${OBJ_TAG}>${serialize_xml_node(node)}</${OBJ_TAG}>`;
  }
  return serialize_xml_node(node);
}

/**
 * Public HTML serializer for Hson trees (2.0 surface).
 *
 * Pipeline:
 * 1. Clone & guard:
 *    - `clone_node($node)` to avoid mutating the original IR.
 *    - Require that the clone is a valid `HsonNode`, otherwise throw.
 *
 * 2. Invariant check:
 *    - `assert_invariants(clone, "serialize_html")` ensures that the
 *      internal Hson structure is well-formed before any emission.
 *
 * 3. XML stage:
 *    - Delegates to `serialize_xml(clone)` to produce an XML-like string
 *      that faithfully represents Hson semantics (including `_hson_val`, `_hson_obj`,
 *      `_hson_arr`, `_hson_ii`, etc.).
 *
 * 4. HTML normalization:
 *    - Converts boolean attributes from `key="key"` to `key` using a regex
 *      replacement; this matches standard HTML boolean attribute semantics.
 *
 * 5. Finalization:
 *    - Returns the transport string without altering text data.
 *
 * Characteristics:
 * - String content is HTML text. Reserved comments preserve text topology.
 * - `_hson_val` uses a `<_hson_val>…</_hson_val>` literal representation.
 * - `_hson_elem` and `_hson_root` never appear as HTML carrier tags.
 * - `_hson_obj` and other clusters remain visible where necessary to preserve
 *   Hson’s JSON-mode structure.
 *
 * @param node - Root Hson node or primitive to serialize as HTML.
 * @returns An HTML transport string for trusted Transform ingress.
 * @throws If invariants fail or if the input is not a valid HsonNode.
 */
export function serialize_html(node: HsonNode | Primitive): string {

  if (typeof node === "object" && node !== null) {
    // Serialization validates canonical value and placement only. Duplicate
    // valid claims remain cold data and are emitted faithfully.
    assert_invariants(node, "serialize_html");
    collect_hson_node_quid_claims(node);
  }
  const clone = clone_node(node);
  if (!is_Node(clone)) {
    _throw_transform_err('input node cannot be undefined for node_to_html', 'serialize_html', make_string(node));
  }

  // tree assertions throw if structure is off
  assert_invariants(clone, 'serialize_html');

  const xmlString = serialize_xml(clone);

  // HTML boolean attrs: key="key" → key
  const htmlString = xmlString.replace(/\b([^\s=]+)="\1"/g, '$1');

  return htmlString;

}
