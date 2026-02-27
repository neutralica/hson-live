// parse-html.new.transform.hson.ts (new)

import { HsonNode } from "../../types/node.types.js";
import { ROOT_TAG, ELEM_TAG, STR_TAG, EVERY_VSN, VAL_TAG, OBJ_TAG, ARR_TAG, II_TAG } from "../../consts/constants.js";
import { CREATE_NODE } from "../../consts/factories.js";
import { is_Primitive, is_string } from "../../utils/core-utils/guards.core.js";
import { _snip } from "../../utils/sys-utils/snip.utils.js";
import { _throw_transform_err } from "../../utils/sys-utils/throw-transform-err.utils.js";
import { parse_html_attrs } from "../../utils/html-utils/parse_html_attrs.js";
import { coerce } from "../../utils/primitive-utils/coerce-string.utils.js";
import { assert_invariants } from "../../diagnostics/assert-invariants.test.js";
import { expand_entities } from "../../utils/html-preflights/expand-entities.js";
import { expand_flags } from "../../utils/html-preflights/expand-flags.js";
import { expand_void_tags } from "../../utils/html-preflights/expand-self-closing.js";
import { escape_text } from "../../utils/html-preflights/escape-text.js";
import { strip_html_comments } from "../../utils/html-preflights/strip-html-comments.js";
import { wrap_cdata } from "../../safety/wrap-cdata.js";
import { optional_endtag_preflight } from "../../utils/html-preflights/optional-endtag.js";
import { escape_attr_angles } from "../../safety/escape_angles.js";
import { dedupe_attrs_html } from "../../safety/dedupe-attrs.js";
import { quote_unquoted_attrs } from "../../utils/html-preflights/quoted-unquoted.js";
import { mangle_illegal_attrs } from "../../utils/html-preflights/mangle-illegal-attrs.js";
import { namespace_svg } from "../../utils/html-preflights/namespace-svg.js";
import { is_indexed } from "../../utils/node-utils/node-guards.js";
import { Primitive } from "../../types/core.types.js";
import { should_try_optional_endtags, should_try_void_expand } from "../../utils/html-preflights/preflight-helpers.js";



/**
 *DEBUG - remove when clear 
 **/
function find_invalid_xml_char(s: string): { index: number; code: number } | null {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        // XML 1.0 valid chars:
        // #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD]
        if (
            c === 0x9 || c === 0xA || c === 0xD ||
            (c >= 0x20 && c <= 0xD7FF) ||
            (c >= 0xE000 && c <= 0xFFFD)
        ) {
            continue;
        }
        return { index: i, code: c };
    }
    return null;
}

function snip_context(s: string, at: number, radius = 80): string {
    const start = Math.max(0, at - radius);
    const end = Math.min(s.length, at + radius);
    return s.slice(start, end)
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

/**
 * Parse HTML/XML (trusted or pre-sanitized) into a rooted `HsonNode` tree.
 *
 * Input forms:
 * - `string`:
 *     - Runs a preflight pipeline to coerce HTML into XML-safe markup
 *       before parsing.
 * - `Element`:
 *     - Skips string preprocessing and converts the element subtree
 *       directly via `convert`.
 *
 * String pipeline (high level):
 * 1. Strip HTML comments (`strip_html_comments`).
 * 2. Expand boolean/flag attributes (`expand_flags`).
 * 3. Escape text + expand entities (`escape_text`, `expand_entities`).
 * 4. Namespace SVG and sanitize attributes (`namespace_svg`, `mangle_illegal_attrs`).
 * 5. Attempt XML parse via `DOMParser("application/xml")`.
 * 6. On parse errors, apply gated repairs in order:
 *    - Deduplicate attributes (`dedupe_attrs_html`) for duplicate-attr errors.
 *    - Patch bare ampersands (`amp_fix`) for entity errors.
 *    - Quote unquoted attrs (`quote_unquoted_attrs`) and re-amp-fix.
 *    - Escape literal `<` inside attrs (`escape_attr_angles`).
 *    - Expand void tags (`expand_void_tags`) and re-amp-fix.
 *    - Balance optional end tags (`optional_endtag_preflight`).
 *    - If the error is “extra content”, wrap in `<_root>…</_root>` and retry,
 *      optionally re-running void expansion on the wrapped source.
 * 7. If parsing still fails, throw a transform error with context.
 * 8. Convert `documentElement` via `convert`.
 * 9. Wrap the converted tree via `wrap_as_root` to ensure a `_root` node.
 * 10. Validate invariants with `assert_invariants`.
 *
 * @param input - Raw HTML/XML string or an existing `Element` subtree.
 * @returns A `_root`-wrapped `HsonNode` tree ready for downstream use.
 * @see convert
 * @see wrap_as_root
 * @see assert_invariants
 */
export function parse_html(input: string | Element): HsonNode {
    let inputElement: Element;
    if (typeof input === "string") {
        const stripped = strip_html_comments(input);
        const bools = expand_flags(stripped);
        const safe = escape_text(bools);
        const ents = expand_entities(safe);

        // CONFIRM: keep these if required for XML compliance on your edge.
        // If not strictly required, gate them later too.
        const svgSafe = namespace_svg(ents);
        const mangled = mangle_illegal_attrs(svgSafe);
        let xmlSrc = mangled;
        const parser = new DOMParser();
        let parsed = parser.parseFromString(xmlSrc, "application/xml");
        let err = parsed.querySelector("parsererror");

        const errText = () => (err?.textContent ?? "");
        const hasErr = () => Boolean(err);

        // CHANGED: single helper to reduce drift + ensure we re-read parsererror each time

        const tryParse = (candidate: string, label: string) => {
            // CHANGED: commit the candidate to xmlSrc *before* parsing, so later steps repair the current text
            xmlSrc = candidate;

            parsed = parser.parseFromString(xmlSrc, "application/xml");
            err = parsed.querySelector("parsererror");

            // (Optional) trace label somewhere if you want
            // _log(`tryParse:${label} err=${!!err}`);
        };

        // CHANGED: amp-fix is dangerous; only apply when parser error looks entity-related
        const amp_fix = (src: string) =>
            src.replace(
                /&(?!(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]{1,31});)/g,
                "&amp;"
            );

        // ---- Repair pass (gated, ordered, no duplicates) ----

        if (hasErr()) {
            const msg = errText();

            // 0) Invalid XML control chars: bail early with a good message (your existing logic)
            const bad = find_invalid_xml_char(xmlSrc);
            if (bad) {
                const hex = `0x${bad.code.toString(16).toUpperCase()}`;
                const ctx = snip_context(xmlSrc, bad.index);
                _throw_transform_err(
                    `XML parse failed: invalid control character ${hex} at index ${bad.index}\n` +
                    `Context: “…${ctx}…”`,
                    "parse-html"
                );
            }

            // 1) Duplicate attributes: only then dedupe
            if (/Duplicate|redefined/i.test(msg)) {
                const deduped = dedupe_attrs_html(xmlSrc);
                tryParse(deduped, "dedupe_attrs_html");
            }
        }

        if (hasErr()) {
            const msg = errText();

            // 2) Entity / ampersand problems: only then amp-fix
            // (Patterns vary by engine; keep loose but still clearly entity-related.)
            if (/Entity|reference to entity|The entity name must immediately follow the '&' in the entity reference/i.test(msg)) {
                tryParse(amp_fix(xmlSrc), "amp_fix(entity)");
            }
        }

        if (hasErr()) {
            const msg = errText();

            // 3) Unquoted attribute values: only then quote them (and re-run amp fix once)
            // IMPORTANT: do NOT run this for tag mismatch errors; it's a regex and can worsen things.
            if (/AttValue|attribute value|expected ['"]|quotation mark/i.test(msg)) {
                const quoted = quote_unquoted_attrs(xmlSrc);
                // quoting can introduce bare &, so do amp_fix once immediately after
                tryParse(amp_fix(quoted), "quote_unquoted_attrs(+amp_fix)");
            }
        }
        if (hasErr()) {
            const msg = errText();

            // 4) Literal '<' inside attribute values
            // DOMParser messages vary; keep it narrow-ish but not brittle.
            if (/Unescaped/i.test(msg) && /attribute/i.test(msg) && /</.test(xmlSrc)) {
                tryParse(escape_attr_angles(xmlSrc), "escape_attr_angles(< in attr)");
            }
        }
        if (hasErr()) {
            const msg = errText();

            // 4) Void tags left unclosed: only then expand void tags (and re-run amp_fix once)
            if (should_try_void_expand(msg)) {
                const voidFixed = expand_void_tags(xmlSrc);
                tryParse(amp_fix(voidFixed), "expand_void_tags(+amp_fix)");
            }
        }

        if (hasErr()) {
            const msg = errText();

            // 5) Optional end tags (<li>, <p>) only: THEN run optional_endtag_preflight
            if (should_try_optional_endtags(msg)) {
                const balanced = optional_endtag_preflight(xmlSrc);
                tryParse(balanced, "optional_endtag_preflight(li/p only)");
            }
        }

        if (hasErr()) {
            const msg = errText();

            // 6) Multiple top-level nodes ("extra content"): wrap a root and retry.
            if (/extra content/i.test(msg)) {
                // CHANGED: keep a local candidate so we can apply *post-wrap* repairs to the wrapped source.
                let wrapped = `<${ROOT_TAG}>\n${xmlSrc}\n</${ROOT_TAG}>`;

                // Keep your existing optional endtag pass (safe-ish) on the wrapped source.
                wrapped = optional_endtag_preflight(wrapped);

                // Attempt parse of the wrapped source.
                tryParse(wrapped, "wrap_root(+optional_endtag_preflight)");

                // CHANGED: If wrapping exposed a void-tag mismatch (embed/input/meta/etc),
                // apply expand_void_tags to the *wrapped* string (NOT the old xmlSrc) and retry.
                if (hasErr()) {
                    const msg2 = errText();
                    if (should_try_void_expand(msg2)) {
                        const voidFixedWrapped = expand_void_tags(wrapped);
                        // quoting/void expansion can surface bare '&' in some broken inputs → amp_fix once.
                        tryParse(amp_fix(voidFixedWrapped), "wrap_root(+optional_endtag_preflight+void_expand)");
                    }
                }

                // OPTIONAL (leave out unless you need it):
                // If you want to give optional_endtag_preflight a second shot after void-fix:
                /*
                if (hasErr()) {
                  const msg3 = errText();
                  if (should_try_optional_endtags(msg3)) {
                    const balanced2 = optional_endtag_preflight(wrapped);
                    tryParse(balanced2, "wrap_root(+optional_endtag_preflight#2)");
                  }
                }
                */
            }
        }

        if (hasErr()) {
            const msg = errText();
            _throw_transform_err(
                `XML parse failed:\n${msg}\n` +
                `Snippet:\n${snip_context(xmlSrc, 0)}`,
                "parse-html"
            );
        }

        inputElement = parsed.documentElement!;
    } else {
        inputElement = input;
    }
    const actualContentRootNode = convert(inputElement);
    const final = wrap_as_root(actualContentRootNode);

    assert_invariants(final, "parse-html");
    return final;
}

// --- recursive conversion function ---
/**
 * Recursively convert a DOM `Element` subtree into a `HsonNode` subtree.
 *
 * Responsibilities:
 * - Validate tag semantics and VSN usage:
 *   - Reject literal `<_str>` elements.
 *   - Reject unknown tags starting with `_` that are not recognized VSNs.
 * - Parse attributes and meta via `parse_html_attrs`.
 * - Handle special raw-text elements (`<style>`, `<script>`):
 *   - Treat their entire (optionally CDATA-wrapped) text content as a
 *     single `_str` child.
 * - Convert children:
 *   - Calls `elementToNode` to transform child DOM nodes into a mix of
 *     primitives and `HsonNode`s.
 *   - Wrap primitives into `_str` or `_val` nodes as appropriate.
 * - Handle VSN tags explicitly:
 *   - `<_val>`:
 *       - Enforce exactly one payload value.
 *       - Coerce strings to non-string primitives via `coerce`.
 *       - Reject any payload that still resolves to a string.
 *   - `<_obj>`:
 *       - Children treated as property nodes, returned as `_obj`.
 *   - `<_arr>`:
 *       - Children must be valid index tags, returned as `_arr`.
 *   - `<_ii>`:
 *       - Must have exactly one child, returned as `_ii` with optional meta.
 *   - `<_elem>`:
 *       - Disallowed in incoming HTML (internal-only wrapper).
 * - Default HTML element path:
 *   - For zero children:
 *       - Produce an element with an empty `_elem` cluster.
 *   - For a single cluster child (`_obj`, `_arr`, `_elem`):
 *       - Pass through the cluster unchanged.
 *   - For mixed/multiple non-cluster children:
 *       - Wrap once in `_elem` to form a pure element-mode cluster.
 *
 * @param el - DOM element to convert.
 * @returns A `HsonNode` representing the converted subtree.
 * @see elementToNode
 * @see parse_html_attrs
 */
function convert(el: Element): HsonNode {
    if (!(el instanceof Element)) {
        _throw_transform_err('input to convert function is not Element', '[(parse-html): convert()]', el);
    }

    const baseTag = el.tagName;
    const tagLower = baseTag.toLowerCase();
    const { attrs: sortedAcc, meta: metaAcc } = parse_html_attrs(el);

    if (tagLower === STR_TAG) {
        _throw_transform_err('literal <_str> is not allowed in input HTML', 'parse-html');
    }
    if (tagLower.startsWith('_') && !EVERY_VSN.includes(tagLower)) {
        _throw_transform_err(`unknown VSN-like tag: <${tagLower}>`, 'parse-html');
    }

    // Raw text elements: treat their textContent as a single string node
    const specialExceptions = ['style', 'script'];
    if (specialExceptions.includes(tagLower)) {
        let text_content = el.textContent?.trim();

        //  handle <![CDATA[ ... ]]> safely
        if (text_content?.startsWith("<![CDATA[")) {
            const end = text_content.indexOf("]]>");
            if (end === -1) {
                _throw_transform_err("Malformed CDATA block: missing closing ']]>'", "parse-html");
            }
            text_content = text_content.slice("<![CDATA[".length, end);
        }

        if (text_content) {
            const str = CREATE_NODE({ _tag: STR_TAG, _content: [text_content] });
            return CREATE_NODE({
                _tag: baseTag,
                _attrs: sortedAcc,
                _meta: metaAcc && Object.keys(metaAcc).length ? metaAcc : undefined,
                // no inner _elem — children go directly
                _content: [str],
            });
        }
    }

    // Build children (DOM → HSON)
    const childNodes: HsonNode[] = [];
    const children = elementToNode(el.childNodes, tagLower);

    for (const child of children) {
        if (is_Primitive(child)) {
            const tag = is_string(child) ? STR_TAG : VAL_TAG;
            childNodes.push(CREATE_NODE({ _tag: tag, _content: [child] }));
        } else {
            childNodes.push(child as HsonNode);
        }
    }


    // ---------- VSN tags in HTML ----------

    if (tagLower === VAL_TAG) {
        // minimal, canonical <_val> handling (coerce strings → non-string primitive)
        if (childNodes.length !== 1) {
            _throw_transform_err('<_val> must contain exactly one value', 'parse-html');
        }

        const only = children[0] as unknown; // pre-wrapped atom from elementToNode

        const coerceNonString = (s: string): Primitive => {
            const v = coerce(s);
            return v as Primitive;
        };

        let prim: Primitive | undefined;

        if (is_Primitive(only)) {
            prim = (typeof only === 'string') ? coerceNonString(only) : (only as Primitive);
        } else if (only && typeof only === 'object' && '_tag' in (only as any)) {
            const n = only as HsonNode;
            if (n._tag !== VAL_TAG && n._tag !== STR_TAG) {
                _throw_transform_err('<_val> must contain a primitive or _str/_val', 'parse-html');
            }
            const c = n._content?.[0];
            if (c === undefined) _throw_transform_err('<_val> payload is empty', 'parse-html');
            prim = (typeof c === 'string') ? coerceNonString(c) : (c as Primitive);
        } else {
            _throw_transform_err('<_val> payload is not an atom', 'parse-html');
        }

        if (typeof prim === 'string') {
            _throw_transform_err('<_val> cannot contain a string after coercion', 'parse-html', prim);
        }

        return CREATE_NODE({ _tag: VAL_TAG, _content: [prim as Primitive] });
    }

    if (tagLower === OBJ_TAG) {
        // Children are property nodes (already produced under this element)
        return CREATE_NODE({ _tag: OBJ_TAG, _content: childNodes });
    }

    if (tagLower === ARR_TAG) {
        if (!childNodes.every(node => is_indexed(node))) {
            _throw_transform_err('_array children are not valid index tags', 'parse-html');
        }
        return CREATE_NODE({ _tag: ARR_TAG, _content: childNodes });
    }

    if (tagLower === II_TAG) {
        if (childNodes.length !== 1) {
            _throw_transform_err('<_ii> must have exactly one child', 'parse-html');
        }
        return CREATE_NODE({
            _tag: II_TAG,
            _content: [childNodes[0]],
            _meta: metaAcc && Object.keys(metaAcc).length ? metaAcc : undefined,
        });
    }

    if (tagLower === ELEM_TAG) {
        _throw_transform_err('_elem tag found in html', 'parse-html');
    }

    // ---------- Default: normal HTML element ----------

    if (childNodes.length === 0) {
        // Void element, stay in element mode with empty cluster
        return CREATE_NODE({
            _tag: baseTag,
            _attrs: sortedAcc,
            _meta: metaAcc && Object.keys(metaAcc).length ? metaAcc : undefined,
            _content: [
                CREATE_NODE({ _tag: ELEM_TAG, _meta: {}, _content: [] })
            ]
        });
    }

    if (childNodes.length === 1) {
        const only = childNodes[0];

        // Pass through explicit clusters untouched (no mixing, no extra box)
        if (only._tag === OBJ_TAG || only._tag === ARR_TAG || only._tag === ELEM_TAG) {
            return CREATE_NODE({
                _tag: baseTag,
                _attrs: sortedAcc,
                _meta: metaAcc && Object.keys(metaAcc).length ? metaAcc : undefined,
                _content: [only]
            });
        }
    }

    // Otherwise, we have multiple non-cluster children (text/elements):
    // wrap once in _elem (pure element mode).
    return CREATE_NODE({
        _tag: baseTag,
        _attrs: sortedAcc,
        _meta: metaAcc && Object.keys(metaAcc).length ? metaAcc : undefined,
        _content: [
            CREATE_NODE({
                _tag: ELEM_TAG,
                _meta: {},
                _content: childNodes
            })
        ]
    });
}

/**
 * Ensure a `HsonNode` tree is rooted at `_root` with correct clustering.
 *
 * Rules:
 * - If `node._tag === ROOT_TAG`:
 *     - Return the node as-is (already rooted).
 * - If `node` is a cluster node (`_obj`, `_arr`, `_elem`):
 *     - Wrap directly under a new `_root`:
 *       `{ _tag: _root, _content: [node] }`.
 * - Otherwise (normal HTML-ish element/leaf):
 *     - Wrap in an `_elem` cluster, then under `_root`:
 *       `{ _tag: _root, _content: [ { _tag: _elem, _content: [node] } ] }`.
 *
 * This keeps `_root` as a pure structural top-level wrapper while
 * preserving the intended element vs. cluster semantics.
 *
 * @param node - The `HsonNode` to normalize as a root.
 * @returns A `_root`-tagged `HsonNode` tree.
 */
function wrap_as_root(node: HsonNode): HsonNode {
    if (node._tag === ROOT_TAG) return node; // already rooted
    if (node._tag === OBJ_TAG || node._tag === ARR_TAG || node._tag === ELEM_TAG) {
        return CREATE_NODE({ _tag: ROOT_TAG, _content: [node] });
    }
    return CREATE_NODE({
        _tag: ROOT_TAG,
        _content: [CREATE_NODE({ _tag: ELEM_TAG, _content: [node] })],
    });
}


/**
 * Convert a DOM child node list into a sequence of HSON children.
 *
 * Behavior:
 * - Iterates over the given `ChildNode`s:
 *   - `ELEMENT_NODE`:
 *       - Recursively converted via `convert`, returning a `HsonNode`.
 *   - `TEXT_NODE`:
 *       - Reads `textContent` and handles it in context:
 *         - If `trimmed === '""'`, emit an explicit `_str` with `""`.
 *         - If `parentTag === "_obj"`:
 *             - Whitespace is *data*, not layout.
 *             - Remove at most one leading newline and one trailing newline.
 *             - Do **not** trim; emit the remaining raw string if non-empty.
 *         - Otherwise:
 *             - Emit trimmed text when it has non-whitespace content.
 *             - Ignore pure layout whitespace.
 *   - Other node types are ignored.
 *
 * @param els - The DOM child nodes to transform.
 * @returns An array of `HsonNode | Primitive` representing the converted children.
 * @see convert
 */
function elementToNode(
  els: NodeListOf<ChildNode>,
  parentTag: string, // already lowercased
): (HsonNode | Primitive)[] {
  const children: (HsonNode | Primitive)[] = [];

  for (const kid of Array.from(els)) {
    if (kid.nodeType === Node.ELEMENT_NODE) {
      children.push(convert(kid as Element));
      continue;
    }

    if (kid.nodeType === Node.TEXT_NODE) {
      const raw = kid.textContent ?? "";

       /* handle the empty-string sentinel after trimming */
      const trimmed = raw.trim();
      if (trimmed === '""') {
        children.push(CREATE_NODE({
          _tag: STR_TAG,
          _meta: {},
          _content: [""],
        }));
        continue;
      }

       /* inside <_obj>, whitespace is *data*, not layout;
            remove a single leading/trailing newline wrapper, keep everything else */
      if (parentTag === "_obj") {
        let unboxed = raw;

         /* remove exactly one leading newline (and one trailing newline), if present */
        unboxed = unboxed.replace(/^\r?\n/, "");
        unboxed = unboxed.replace(/\r?\n$/, "");

         /* IMPORTANT: do NOT trim here. If the payload is "   ", we keep it */
        if (unboxed.length > 0) {
          children.push(unboxed);
        }
        continue;
      }

       /* ignore layout-only whitespace between elements */
      if (trimmed.length > 0) {
        children.push(trimmed);
      }

      continue;
    }
  }

  return children;
}
