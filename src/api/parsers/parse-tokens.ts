// parse-tokens.transform.hson.ts

import { STR_TAG, VAL_TAG, ARR_TAG, OBJ_TAG, ELEM_TAG, ROOT_TAG, II_TAG } from "../../consts/constants.js";
import { CREATE_NODE } from "../../consts/factories.js";
import { TOKEN_KIND, CLOSE_KIND, TokenEmptyObj } from "../../types/token.types.js";
import { _DATA_INDEX } from "../../consts/constants.js";
import { HsonNode, NodeContent } from "../../types/node.types.js";
import { Tokens, CloseKind, TokenOpen, TokenClose, TokenArrayOpen, TokenArrayClose, TokenKind, TokenText } from "../../types/token.types.js";
import { coerce } from "../../utils/primitive-utils/coerce-string.utils.js";
import { _snip } from "../../utils/sys-utils/snip.utils.js";
import { unwrap_root_obj } from "../../utils/json-utils/unwrap-root-obj.js";
import { split_attrs_meta } from "../../utils/hson-utils/split-attrs-meta.js";
import { _throw_transform_err } from "../../utils/sys-utils/throw-transform-err.utils.js";
import { is_string } from "../../utils/core-utils/guards.core.js";
import { Primitive } from "../../types/core.types.js";



/**
 * Create a canonical HSON leaf node from a primitive value.
 *
 * Rules:
 * - `string`  → `<_str>` node with `_content: [value]`.
 * - non-string primitive (`number | boolean | null`) → `<_val>` node with `_content: [value]`.
 *
 * Notes:
 * - `_meta` is always initialized to an empty object for leaf nodes created here.
 * - This is the preferred constructor for primitive payloads to keep string vs non-string
 *   semantics explicit in the IR.
 *
 * @param v - Primitive value to wrap as a leaf node.
 * @returns A new `HsonNode` using `_str` or `_val` depending on the runtime type of `v`.
 */
export const make_leaf = (v: Primitive): HsonNode =>
(is_string(v)
    ? CREATE_NODE({ _tag: STR_TAG, _meta: {}, _content: [v] })
    : CREATE_NODE({ _tag: VAL_TAG, _meta: {}, _content: [v] }));


/**
 * Assemble a flat token stream into a hierarchical `HsonNode` tree.
 *
 * This is the second stage of the HSON parser: it consumes the output of
 * `tokenize_hson` and builds the final IR, enforcing the HSON clustering
 * and close-mode rules.
 *
 * High-level behavior:
 * - Walks the token array once, maintaining an index (`ix`) into `$tokens`.
 * - Uses `readTag` to parse element/VSN tags (`OPEN`…`CLOSE`) into nodes,
 *   shaping content into `_elem` or `_obj` clusters based on the tag’s
 *   close kind (`CLOSE_KIND.elem` vs `CLOSE_KIND.obj`).
 * - Uses `readArray` to parse `ARR_OPEN`…`ARR_CLOSE` sequences into
 *   `_arr` nodes full of `_ii` children, each tagged with `data-_index`.
 * - Handles shorthand empty objects (`EMPTY_OBJ`, i.e. `<>`) both at
 *   top-level and inside arrays.
 * - Converts `TEXT` tokens into primitive leaves:
 *   - quoted text → `JSON.parse(raw)` to decode string literals
 *   - unquoted text → `coerce(raw)` for primitive inference
 *   then wraps the result with `make_leaf`.
 * - Tracks the close kind for each top-level construct in `topCloseKinds`
 *   so that implicit roots can be shaped correctly later.
 *
 * Root synthesis:
 * - If the sole top-level node is already `<_root>`, return it directly.
 * - Otherwise, synthesize a `_root` node according to the top-level shape:
 *   - A single cluster node (`_obj`, `_arr`, `_elem`) is wrapped as-is.
 *   - A single standard tag is wrapped in `_obj` or `_elem` depending on
 *     its recorded close kind.
 *   - No nodes at all produce a `_root` with an empty `_obj` cluster.
 *   - Multiple top-level nodes are wrapped in `_obj` or `_elem` if the
 *     close kinds are unanimous; mixed modes default to `_elem`.
 *
 * Error handling:
 * - Any unexpected token kind in a given context (inside tags, arrays,
 *   or at the top level) results in a transform error.
 * - Missing closing tokens, malformed `_root` / VSN shapes, or invalid
 *   payloads for special tags (e.g. `<_val>`) also throw.
 *
 * @param tokens - Token array produced by `tokenize_hson`.
 * @returns A `_root`-wrapped `HsonNode` representing the parsed HSON tree.
 * @see tokenize_hson
 * @see make_leaf
 * @see unwrap_root_obj
 */
export function parse_tokens(tokens: Tokens[]): HsonNode {
    const nodes: HsonNode[] = [];
    const topCloseKinds: CloseKind[] = [];

    let ix = 0;
    const N = tokens.length;
    function _peek(): Tokens | undefined { return tokens[ix]; }
    function _take(kind: typeof TOKEN_KIND.OPEN): TokenOpen;
    function _take(kind: typeof TOKEN_KIND.CLOSE): TokenClose;
    function _take(kind: typeof TOKEN_KIND.ARR_OPEN): TokenArrayOpen;
    function _take(kind: typeof TOKEN_KIND.ARR_CLOSE): TokenArrayClose;
    function _take(kind: typeof TOKEN_KIND.TEXT): TokenText;
    function _take(kind: typeof TOKEN_KIND.EMPTY_OBJ): TokenEmptyObj;
    function _take(): Tokens | null;

    // runtime impl checks when an expected kind is passed
    function _take(expected?: TokenKind): any {
        const tok = tokens[ix++] as Tokens | undefined;
        if (!tok) return null;
        if (expected && tok.kind !== expected) {
            _throw_transform_err(`expected ${expected}, got ${tok.kind}`, 'parse_tokens');
        }
        return tok;
    }


    // // CHANGED: raw is now the *full* quoted literal, including quotes.
    // // CHANGED: accept either a full JSON string literal ("...") OR inner text (...\n...)
    // // and always decode with JSON.parse exactly once.
    // function decode_quoted_text(raw: string): string {
    //     const s = raw;

    //     // Fast path: full literal already.
    //     if (s.length >= 2 && s[0] === `"` && s[s.length - 1] === `"`) {
    //         const v = JSON.parse(s);
    //         if (typeof v !== "string") {
    //             _throw_transform_err("quoted literal did not parse to string", "parse_tokens.decode_quoted_text", s);
    //         }
    //         return v;
    //     }

    //     // Inner-text path: wrap it into a JSON string literal.
    //     // NOTE: JSON does not allow literal CR or LF in a string token, so if your tokenizer
    //     // can hand us raw newlines here, they must have been represented as '\n' already.
    //     // If not, this will (correctly) throw and reveal the upstream bug.
    //     const v = JSON.parse(`"${s}"`);
    //     if (typeof v !== "string") {
    //         _throw_transform_err("quoted inner did not parse to string", "parse_tokens.decode_quoted_text", s);
    //     }
    //     return v;
    // }
    // function decode_quoted_literal(raw: string): string {
    //     // raw is the full JSON string literal including quotes
    //     const v = JSON.parse(raw);
    //     if (typeof v !== "string") {
    //         _throw_transform_err(
    //             "quoted text did not decode to string",
    //             "parse-tokens.decode_json_string_literal"
    //         );
    //     }

    //     // CHANGED: guard against XML 1.0–illegal control chars in resulting text
    //     // (tab, LF, CR are allowed; most others under 0x20 are not)
    //     if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v)) {
    //         const m = v.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/)!;
    //         const code = m[0].charCodeAt(0);
    //         _throw_transform_err(
    //             `decoded string contains XML-invalid control char U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
    //             "parse-tokens.decode_json_string_literal"
    //         );
    //     }

    //     return v;
    // }

    //  type guard helps in places without overloads
    function isTokenOpen(t: Tokens | null | undefined): t is TokenOpen {
        return !!t && t.kind === TOKEN_KIND.OPEN;
    }

    function isTokenClose(t: Tokens | null | undefined): t is TokenClose {
        return !!t && t.kind === TOKEN_KIND.CLOSE;
    }
    function isTokenText(t: Tokens | null | undefined): t is TokenText {
        return !!t && t.kind === TOKEN_KIND.TEXT;
    }
    function isTokenArrOpen(t: Tokens | null | undefined): t is TokenArrayOpen {
        return !!t && t.kind === TOKEN_KIND.ARR_OPEN;
    }
    function readTag(isTopLevel = false): { node: HsonNode; closeKind: CloseKind } {
        // NOTE: _take() returning any is sketchy; narrow immediately.
        const tok = _take();
        if (!isTokenOpen(tok)) {
            _throw_transform_err(`expected OPEN, got ${tok?.kind ?? 'eof'}`, 'parse_tokens');
        }
        const open = tok as TokenOpen;

        const { attrs, meta } = split_attrs_meta(open.rawAttrs);
        const node = CREATE_NODE({ _tag: open.tag, _meta: meta });

        // VSNs carry no _attrs
        const isVSN =
            open.tag === STR_TAG || open.tag === VAL_TAG ||
            open.tag === ARR_TAG || open.tag === OBJ_TAG ||
            open.tag === ELEM_TAG || open.tag === ROOT_TAG ||
            open.tag === II_TAG;

        if (!isVSN && Object.keys(attrs).length) {
            node._attrs = attrs;
        }

        let sawClose: TokenClose | null = null;
        const kids: HsonNode[] = [];
        let sawEmptyObjShorthand = false; // <-- NEW

        // --- gather children
        while (ix < N) {
            const t = _peek(); if (!t) break;

            //  end of this tag
            if (isTokenClose(t)) {
                sawClose = _take(TOKEN_KIND.CLOSE);
                break;
            }

            //  empty object shorthand "<>"
            if (t.kind === TOKEN_KIND.EMPTY_OBJ) {
                _take(TOKEN_KIND.EMPTY_OBJ);
                sawEmptyObjShorthand = true;
                continue;
            }

            //  nested array
            if (isTokenArrOpen(t)) {
                kids.push(readArray());
                continue;
            }

            //  nested tag
            if (isTokenOpen(t)) {
                kids.push(readTag(false).node);
                continue;
            }

            //  nested text → primitive leaf
            if (isTokenText(t)) {
                const tt = _take(TOKEN_KIND.TEXT);
                const prim = tt.quoted ? JSON.parse(tt.raw) : coerce(tt.raw);
                kids.push(make_leaf(prim));
                continue;
            }

            _throw_transform_err(`unexpected token ${t.kind} inside <${open.tag}>`, 'parse_tokens');
        }

        // strong narrow
        if (sawClose === null) {
            _throw_transform_err(`missing CLOSE for <${open.tag}>`, 'parse_tokens');
        }
        const closeKind: CloseKind = sawClose.close;

        // ---------- <_root>: choose cluster by its own closer; never mix modes ----------
        if (open.tag === ROOT_TAG) {
            //  explicit "<>" under root => single empty _obj cluster
            if (sawEmptyObjShorthand) {
                node._content = [CREATE_NODE({ _tag: OBJ_TAG })];
                if (isTopLevel) topCloseKinds.push(closeKind);
                return { node, closeKind };
            }

            if (kids.length === 1 && kids[0]._tag === ARR_TAG) {
                node._content = kids; // passthrough array cluster
            } else if (kids.length > 0) {
                const clusterTag = (closeKind === CLOSE_KIND.elem) ? ELEM_TAG : OBJ_TAG;
                node._content = [CREATE_NODE({ _tag: clusterTag, _content: kids })];
            } else {
                node._content = [];
            }
            if (isTopLevel) topCloseKinds.push(closeKind);
            return { node, closeKind };
        }

        // ---------- VSN passthroughs ----------
        if (open.tag === OBJ_TAG || open.tag === ARR_TAG || open.tag === ELEM_TAG) {
            node._content = kids as NodeContent;
            if (isTopLevel) topCloseKinds.push(closeKind);
            return { node, closeKind };
        }

        if (open.tag === STR_TAG || open.tag === VAL_TAG || open.tag === II_TAG) {
            node._content = kids as NodeContent;
            if (isTopLevel) topCloseKinds.push(closeKind);
            return { node, closeKind };
        }

        // ---------- Normal tag: SINGLE-MODE shaping (no _elem/_obj mixing) ----------
        if (closeKind === CLOSE_KIND.obj) {
            // OBJECT semantics: ensure exactly one inner _obj OR pass through a single _arr/_obj
            if (kids.length === 1 && (kids[0]._tag === OBJ_TAG || kids[0]._tag === ARR_TAG)) {
                node._content = [kids[0]]; // passthrough a single cluster
            } else {
                node._content = [CREATE_NODE({
                    _tag: OBJ_TAG,
                    _content: kids as NodeContent
                })];
            }

            // Guardrail: object mode must yield a single _obj/_arr
            const c = node._content as HsonNode[];
            if (!(c.length === 1 && (c[0]._tag === OBJ_TAG || c[0]._tag === ARR_TAG))) {
                _throw_transform_err("object semantics must yield a single _obj/_arr child", "parse_tokens.object");
            }
        } else {
            // ELEMENT semantics: ensure exactly one inner _elem (idempotent)
            if (kids.length === 1 && kids[0]._tag === ELEM_TAG) {
                node._content = kids as NodeContent; // already clustered
            } else {
                node._content = [CREATE_NODE({
                    _tag: ELEM_TAG,
                    _content: kids as NodeContent
                })];
            }

            // Guardrail: element mode must yield a single _elem
            const c = node._content as HsonNode[];
            if (!(c.length === 1 && c[0]._tag === ELEM_TAG)) {
                _throw_transform_err("element semantics must yield a single _elem child", "parse_tokens.element");
            }
        }

        if (isTopLevel) topCloseKinds.push(closeKind);
        return { node, closeKind };
    }



    /* parse an array starting at ARRAY_OPEN */

    function readArray(): HsonNode {
        const arrOpen = _take();
        if (!arrOpen || arrOpen.kind !== TOKEN_KIND.ARR_OPEN) {
            _throw_transform_err(`expected ARR_OPEN, got ${arrOpen?.kind ?? 'eof'}`, 'parse_tokens');
        }
        const items: HsonNode[] = [];
        let idx = 0;

        while (ix < N) {
            const t = _peek(); if (!t) break;
            if (t.kind === TOKEN_KIND.ARR_CLOSE) { _take(); break; }

            let childNode: HsonNode;

            if (t.kind === TOKEN_KIND.EMPTY_OBJ) {

                _take();
                // build an empty object *item*
                childNode = CREATE_NODE({ _tag: OBJ_TAG, _meta: {}, _content: [] });

            } else if (t.kind === TOKEN_KIND.TEXT) {
                // FIX: keep primitives inside the array (do NOT push to outer "nodes")
                const tt = _take() as TokenText;
                const prim = tt.quoted ? JSON.parse(tt.raw) : coerce(tt.raw);
                childNode = make_leaf(prim); // ← was: nodes.push(...); continue;

            } else if (t.kind === TOKEN_KIND.OPEN) {
                childNode = readTag(false).node;
            } else if (t.kind === TOKEN_KIND.ARR_OPEN) {
                childNode = readArray();
            } else {
                _throw_transform_err(`unexpected ${t.kind} in array`, 'parse_tokens');
            }

            const passThruVSNs = new Set<string>([OBJ_TAG, ARR_TAG, ELEM_TAG, STR_TAG, VAL_TAG]);
            if (!passThruVSNs.has(childNode._tag)) {
                // standard tag → wrap in _obj to honor always-wrap in JSON-mode
                childNode = CREATE_NODE({ _tag: OBJ_TAG, _meta: {}, _content: [childNode] });
            }
            childNode = unwrap_root_obj(childNode);
            items.push((CREATE_NODE({
                _tag: II_TAG,
                _meta: { [_DATA_INDEX]: String(idx) },
                _content: [childNode],
            })));
            idx++;
        }

        return CREATE_NODE({ _tag: ARR_TAG, _meta: {}, _content: items });
    }

    /* drive the stream */
    while (ix < N) {
        const t = _peek(); if (!t) break;

        if (t.kind === TOKEN_KIND.OPEN) {
            // mark top-level so we record the closer
            const { node, closeKind } = readTag(true); // <-- true
            nodes.push(node);
            topCloseKinds.push(closeKind); // <-- record
            continue;
        }
        if (t.kind === TOKEN_KIND.ARR_OPEN) {
            nodes.push(readArray());
            topCloseKinds.push('obj'); // arrays are object-closer at top
            continue;
        }
        if (t.kind === TOKEN_KIND.EMPTY_OBJ) {
            _take(TOKEN_KIND.EMPTY_OBJ);
            nodes.push(CREATE_NODE({ _tag: OBJ_TAG, _meta: {}, _content: [] }));
            topCloseKinds.push('obj');
            continue;
        }
        if (t.kind === TOKEN_KIND.TEXT) {
            const tt = _take(TOKEN_KIND.TEXT);
            const prim = tt.quoted ? JSON.parse(tt.raw) : coerce(tt.raw);
            nodes.push(make_leaf(prim));
            topCloseKinds.push('elem');
            continue;
        }

        _throw_transform_err(`unexpected top-level token ${t.kind}`, 'parse_tokens');
    }

    if (nodes.length === 1 && nodes[0]._tag === ROOT_TAG) {
        return nodes[0];
    }

    /* implicit-root fallback (no explicit <_root>) ----------------------------*/
    {
        const kids = nodes;

        // 0) single <_root> already (kept earlier) — nothing to do

        // 1) already a single cluster → keep as-is
        if (kids.length === 1 && (kids[0]._tag === OBJ_TAG || kids[0]._tag === ARR_TAG || kids[0]._tag === ELEM_TAG)) {
            const child = kids[0];
            return CREATE_NODE({ _tag: ROOT_TAG, _meta: {}, _content: [child] });
        }

        // 2) single standard tag → wrap according to its closer
        if (kids.length === 1 && typeof kids[0]._tag === 'string' && !kids[0]._tag.startsWith('_')) {
            const mode = topCloseKinds[0] === CLOSE_KIND.obj ? OBJ_TAG : ELEM_TAG; // CHANGED
            return CREATE_NODE({
                _tag: ROOT_TAG, _meta: {},
                _content: [CREATE_NODE({ _tag: mode, _meta: {}, _content: [kids[0]] })],
            });
        }

        // 3) empty → empty object cluster
        if (kids.length === 0) {
            return CREATE_NODE({
                _tag: ROOT_TAG, _meta: {},
                _content: [CREATE_NODE({ _tag: OBJ_TAG, _meta: {}, _content: [] })],
            });
        }

        // 4) multiple top-level nodes → choose by unanimous closer; mixed ⇒ element
        const allObj = topCloseKinds.length > 0 && topCloseKinds.every(k => k === CLOSE_KIND.obj);
        const allElem = topCloseKinds.length > 0 && topCloseKinds.every(k => k === CLOSE_KIND.elem);
        const clusterTag = allObj ? OBJ_TAG : (allElem ? ELEM_TAG : ELEM_TAG); // mixed → _elem

        return CREATE_NODE({
            _tag: ROOT_TAG, _meta: {},
            _content: [CREATE_NODE({ _tag: clusterTag, _meta: {}, _content: kids })],
        });
    }

}
