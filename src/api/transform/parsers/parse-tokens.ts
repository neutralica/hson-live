// parse-tokens.ts

import { STR_TAG, VAL_TAG, ARR_TAG, OBJ_TAG, ELEM_TAG, ROOT_TAG, II_TAG, HSON_SYS_PREFIX, EVERY_VSN } from "../../../core/constants.js";
import { CREATE_NODE } from "../../../core/factories.js";
import { TOKEN_KIND, CLOSE_KIND, TokenEmptyObj } from "../token.types.js";
import { HSON_META_INDEX } from "../../../core/constants.js";
import { HsonNode, NodeContent } from "../../../core/types.js";
import { Tokens, CloseKind, TokenOpen, TokenClose, TokenArrayOpen, TokenArrayClose, TokenKind, TokenText } from "../token.types.js";
import { coerce } from "../utils/primitive-utils/coerce-string.utils.js";
import { _snip } from "../utils/sys-utils/snip.utils.js";
import { unwrap_root_obj } from "../utils/json-utils/unwrap-root-obj.js";
import { split_attrs_meta } from "../utils/hson-utils/split-attrs-meta.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";
import { is_string } from "../../../core/value-guards.js";
import { Primitive } from "../../../core/types.js";
import { assign_ingested_hson_node_quid } from "../utils/hson-utils/quid-ingress.js";

export type ParseTokensOptions = Readonly<{
    /** Internal LiveMap/LiveHost compatibility for persisted document fragments. */
    allowTopLevelTextFragment?: boolean;
}>;


/**
 * Create a canonical HSON leaf node from a primitive value.
 *
 * Rules:
 * - `string`  → `<_hson_str>` node with `$_content: [value]`.
 * - non-string primitive (`number | boolean | null`) → `<_hson_val>` node with `$_content: [value]`.
 *
 * Notes:
 * - Empty optional containers are omitted from leaf nodes created here.
 * - This is the preferred constructor for primitive payloads to keep string vs non-string
 *   semantics explicit in the IR.
 *
 * @param v - Primitive value to wrap as a leaf node.
 * @returns A new `HsonNode` using `_hson_str` or `_hson_val` depending on the runtime type of `v`.
 */
export const make_leaf = (v: Primitive): HsonNode =>
(is_string(v)
    ? CREATE_NODE({ $_tag: STR_TAG, $_content: [v] })
    : CREATE_NODE({ $_tag: VAL_TAG, $_content: [v] }));


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
 *   shaping content into `_hson_elem` or `_hson_obj` clusters based on the tag’s
 *   close kind (`CLOSE_KIND.elem` vs `CLOSE_KIND.obj`).
 * - Uses `readArray` to parse `ARR_OPEN`…`ARR_CLOSE` sequences into
 *   `_hson_arr` nodes full of `_hson_ii` children, each tagged with `index`.
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
 * - If the sole top-level node is already `<_hson_root>`, return it directly.
 * - Otherwise, synthesize a `_hson_root` node according to the top-level shape:
 *   - A single cluster node (`_hson_obj`, `_hson_arr`, `_hson_elem`) is wrapped as-is.
 *   - A single standard tag is wrapped in `_hson_obj` or `_hson_elem` depending on
 *     its recorded close kind.
 *   - A sole primitive leaf is attached directly beneath `_hson_root`.
 *   - No nodes at all remain an internal empty-root parser state; `parse_hson`
 *     rejects trivia-only source before that state can become a source result.
 *   - Multiple top-level nodes are wrapped in `_hson_obj` or `_hson_elem` only
 *     when their close kinds are unanimous; mixed structural modes reject.
 *
 * Error handling:
 * - Any unexpected token kind in a given context (inside tags, arrays,
 *   or at the top level) results in a transform error.
 * - Missing closing tokens, malformed `_hson_root` / VSN shapes, or invalid
 *   payloads for special tags (e.g. `<_hson_val>`) also throw.
 *
 * @param tokens - Token array produced by `tokenize_hson`.
 * @returns A `_hson_root`-wrapped `HsonNode` representing the parsed HSON tree.
 * @see tokenize_hson
 * @see make_leaf
 * @see unwrap_root_obj
 */
export function parse_tokens(tokens: Tokens[], options: ParseTokensOptions = {}): HsonNode {
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
            _throw_transform_err(`expected ${expected}, got ${tok.kind}`, "parse_tokens");
        }
        return tok;
    }


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
    function readTag(): { node: HsonNode; closeKind: CloseKind; open: TokenOpen } {
        // NOTE: _take() returning any is sketchy; narrow immediately.
        const tok = _take();
        if (!isTokenOpen(tok)) {
            _throw_transform_err(`expected OPEN, got ${tok?.kind ?? "eof"}`, "parse_tokens");
        }
        const open = tok as TokenOpen;

        const { attrs, meta } = split_attrs_meta(open.rawAttrs);
        const node = CREATE_NODE({ $_tag: open.tag, $_meta: meta });
        if (open.quid !== undefined) {
            assign_ingested_hson_node_quid(node, open.quid.value, "parse_tokens");
        }

        // VSNs carry no $_attrs
        const isVSN =
            open.tag === STR_TAG || open.tag === VAL_TAG ||
            open.tag === ARR_TAG || open.tag === OBJ_TAG ||
            open.tag === ELEM_TAG || open.tag === ROOT_TAG ||
            open.tag === II_TAG;

        if (!isVSN && Object.keys(attrs).length) {
            node.$_attrs = attrs;
        }

        let sawClose: TokenClose | null = null;
        const kids: HsonNode[] = [];
        const ordinaryChildClosers: Array<Readonly<{
            tag: string;
            closeKind: CloseKind;
            open: TokenOpen;
        }>> = [];
        let sawNestedArray = false;
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
                sawNestedArray = true;
                continue;
            }

            //  nested tag
            if (isTokenOpen(t)) {
                const child = readTag();
                kids.push(child.node);
                if (!EVERY_VSN.includes(child.node.$_tag)) {
                    ordinaryChildClosers.push({
                        tag: child.node.$_tag,
                        closeKind: child.closeKind,
                        open: child.open,
                    });
                }
                continue;
            }

            //  nested text → primitive leaf
            if (isTokenText(t)) {
                const tt = _take(TOKEN_KIND.TEXT);
                const prim = tt.quoted ? JSON.parse(tt.raw) : coerce(tt.raw);
                kids.push(make_leaf(prim));
                continue;
            }

            _throw_transform_err(`unexpected token ${t.kind} inside <${open.tag}>`, "parse_tokens");
        }

        // strong narrow
        if (sawClose === null) {
            _throw_transform_err(`missing CLOSE for <${open.tag}>`, "parse_tokens");
        }
        const closeKind: CloseKind = sawClose.close;

        if (!isVSN) {
            const incompatible = ordinaryChildClosers.find((child) => child.closeKind !== closeKind);
            if (incompatible) {
                _throw_transform_err(
                    `structural mode crossing: <${open.tag}> closes as ${closeKind} but child <${incompatible.tag}> closes as ${incompatible.closeKind} at ${incompatible.open.pos.line}:${incompatible.open.pos.col}`,
                    "parse_tokens.structural-mode",
                );
            }
            if (closeKind === CLOSE_KIND.elem && (sawNestedArray || sawEmptyObjShorthand)) {
                _throw_transform_err(
                    `structural mode crossing: element branch <${open.tag}> cannot contain object/array structure at ${open.pos.line}:${open.pos.col}`,
                    "parse_tokens.structural-mode",
                );
            }
        }

        // ---------- <_hson_root>: choose cluster by its own closer; never mix modes ----------
        if (open.tag === ROOT_TAG) {
            //  explicit "<>" under root => single empty _hson_obj cluster
            if (sawEmptyObjShorthand) {
                node.$_content = [CREATE_NODE({ $_tag: OBJ_TAG })];
                return { node, closeKind, open };
            }

            if (kids.length === 1 && kids[0].$_tag === ARR_TAG) {
                node.$_content = kids; // passthrough array cluster
            } else if (kids.length > 0) {
                const clusterTag = (closeKind === CLOSE_KIND.elem) ? ELEM_TAG : OBJ_TAG;
                node.$_content = [CREATE_NODE({ $_tag: clusterTag, $_content: kids })];
            } else {
                node.$_content = [];
            }
            return { node, closeKind, open };
        }

        // ---------- VSN passthroughs ----------
        if (open.tag === OBJ_TAG || open.tag === ARR_TAG || open.tag === ELEM_TAG) {
            node.$_content = kids as NodeContent;
            return { node, closeKind, open };
        }

        if (open.tag === STR_TAG || open.tag === VAL_TAG || open.tag === II_TAG) {
            node.$_content = kids as NodeContent;
            return { node, closeKind, open };
        }

        // ---------- Normal tag: SINGLE-MODE shaping (no _hson_elem/_hson_obj mixing) ----------
        if (closeKind === CLOSE_KIND.obj) {
            // OBJECT semantics: ensure exactly one inner _hson_obj OR pass through a single _hson_arr/_hson_obj
            if (kids.length === 1 && (kids[0].$_tag === OBJ_TAG || kids[0].$_tag === ARR_TAG)) {
                node.$_content = [kids[0]]; // passthrough a single cluster
            } else {
                node.$_content = [CREATE_NODE({
                    $_tag: OBJ_TAG,
                    $_content: kids as NodeContent
                })];
            }

            // Guardrail: object mode must yield a single _hson_obj/_hson_arr
            const c = node.$_content as HsonNode[];
            if (!(c.length === 1 && (c[0].$_tag === OBJ_TAG || c[0].$_tag === ARR_TAG))) {
                _throw_transform_err("object semantics must yield a single _hson_obj/_hson_arr child", "parse_tokens.object");
            }
        } else {
            // Empty ordinary elements retain the canonical $_content: [] form.
            if (kids.length === 0) {
                node.$_content = [];
            } else if (kids.length === 1 && kids[0].$_tag === ELEM_TAG) {
                node.$_content = kids as NodeContent; // already clustered
            } else {
                node.$_content = [CREATE_NODE({
                    $_tag: ELEM_TAG,
                    $_content: kids as NodeContent
                })];
            }

            // Guardrail: element mode must yield a single _hson_elem
            const c = node.$_content as HsonNode[];
            if (!(c.length === 0 || (c.length === 1 && c[0].$_tag === ELEM_TAG))) {
                _throw_transform_err("element semantics must yield a single _hson_elem child", "parse_tokens.element");
            }
        }

        return { node, closeKind, open };
    }



    /* parse an array starting at ARRAY_OPEN */

    function readArray(): HsonNode {
        const arrOpen = _take();
        if (!arrOpen || arrOpen.kind !== TOKEN_KIND.ARR_OPEN) {
            _throw_transform_err(`expected ARR_OPEN, got ${arrOpen?.kind ?? "eof"}`, "parse_tokens");
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
                childNode = CREATE_NODE({ $_tag: OBJ_TAG, $_content: [] });

            } else if (t.kind === TOKEN_KIND.TEXT) {
                // FIX: keep primitives inside the array (do NOT push to outer "nodes")
                const tt = _take() as TokenText;
                const prim = tt.quoted ? JSON.parse(tt.raw) : coerce(tt.raw);
                childNode = make_leaf(prim); // ← was: nodes.push(...); continue;

            } else if (t.kind === TOKEN_KIND.OPEN) {
                childNode = readTag().node;
            } else if (t.kind === TOKEN_KIND.ARR_OPEN) {
                childNode = readArray();
            } else {
                _throw_transform_err(`unexpected ${t.kind} in array`, "parse_tokens");
            }

            const passThruVSNs = new Set<string>([OBJ_TAG, ARR_TAG, ELEM_TAG, STR_TAG, VAL_TAG]);
            if (!passThruVSNs.has(childNode.$_tag)) {
                // standard tag → wrap in _hson_obj to honor always-wrap in JSON-mode
                childNode = CREATE_NODE({ $_tag: OBJ_TAG, $_content: [childNode] });
            }
            childNode = unwrap_root_obj(childNode);
            items.push((CREATE_NODE({
                $_tag: II_TAG,
                $_meta: { [HSON_META_INDEX]: String(idx) },
                $_content: [childNode],
            })));
            idx++;
        }

        return CREATE_NODE({ $_tag: ARR_TAG, $_content: items });
    }

    /* drive the stream */
    while (ix < N) {
        const t = _peek(); if (!t) break;

        if (t.kind === TOKEN_KIND.OPEN) {
            // mark top-level so we record the closer
            const { node, closeKind } = readTag();
            nodes.push(node);
            topCloseKinds.push(closeKind); // <-- record
            continue;
        }
        if (t.kind === TOKEN_KIND.ARR_OPEN) {
            nodes.push(readArray());
            topCloseKinds.push("obj"); // arrays are object-closer at top
            continue;
        }
        if (t.kind === TOKEN_KIND.EMPTY_OBJ) {
            _take(TOKEN_KIND.EMPTY_OBJ);
            nodes.push(CREATE_NODE({ $_tag: OBJ_TAG, $_content: [] }));
            topCloseKinds.push("obj");
            continue;
        }
        if (t.kind === TOKEN_KIND.TEXT) {
            const tt = _take(TOKEN_KIND.TEXT);
            const prim = tt.quoted ? JSON.parse(tt.raw) : coerce(tt.raw);
            nodes.push(make_leaf(prim));
            topCloseKinds.push("elem");
            continue;
        }

        _throw_transform_err(`unexpected top-level token ${t.kind}`, "parse_tokens");
    }

    if (nodes.length === 1 && nodes[0].$_tag === ROOT_TAG) {
        return nodes[0];
    }

    /* implicit-root fallback (no explicit <_hson_root>) ----------------------------*/
    {
        const kids = nodes;

        // 0) single <_hson_root> already (kept earlier) — nothing to do

        // 1) one complete semantic cluster or primitive → keep as-is
        if (kids.length === 1 && (
            kids[0].$_tag === OBJ_TAG
            || kids[0].$_tag === ARR_TAG
            || kids[0].$_tag === ELEM_TAG
            || (kids[0].$_tag === STR_TAG && !options.allowTopLevelTextFragment)
            || kids[0].$_tag === VAL_TAG
        )) {
            const child = kids[0];
            return CREATE_NODE({ $_tag: ROOT_TAG, $_content: [child] });
        }

        // 2) single standard tag → wrap according to its closer
        if (kids.length === 1 && typeof kids[0].$_tag === "string" && !kids[0].$_tag.startsWith(HSON_SYS_PREFIX)) {
            const mode = topCloseKinds[0] === CLOSE_KIND.obj ? OBJ_TAG : ELEM_TAG; // CHANGED
            return CREATE_NODE({
                $_tag: ROOT_TAG,
                $_content: [CREATE_NODE({ $_tag: mode, $_content: [kids[0]] })],
            });
        }

        // 3) empty → empty object cluster
        if (kids.length === 0) {
            return CREATE_NODE({
                $_tag: ROOT_TAG,
                $_content: [CREATE_NODE({ $_tag: OBJ_TAG, $_content: [] })],
            });
        }

        // A complete bare primitive is one semantic value. Primitive leaves
        // cannot participate in a top-level structural fragment.
        const containsValueLeaf = kids.some((child) => child.$_tag === VAL_TAG);
        const containsStringLeaf = kids.some((child) => child.$_tag === STR_TAG);
        if (containsValueLeaf || (containsStringLeaf && !options.allowTopLevelTextFragment)) {
            _throw_transform_err(
                "a top-level primitive must be the sole semantic HSON value",
                "parse_tokens.root-shaping",
            );
        }

        // 4) multiple top-level nodes require one unanimous structural mode.
        const allObj = topCloseKinds.length > 0 && topCloseKinds.every(k => k === CLOSE_KIND.obj);
        const allElem = topCloseKinds.length > 0 && topCloseKinds.every(k => k === CLOSE_KIND.elem);
        if (!allObj && !allElem) {
            _throw_transform_err(
                `mixed top-level structural modes are invalid (${topCloseKinds.join(", ")})`,
                "parse_tokens.structural-mode",
            );
        }
        const clusterTag = allObj ? OBJ_TAG : ELEM_TAG;

        return CREATE_NODE({
            $_tag: ROOT_TAG,
            $_content: [CREATE_NODE({ $_tag: clusterTag, $_content: kids })],
        });
    }

}
