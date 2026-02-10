// serialize-hson.new.render.ts

import { Primitive } from "../../types/core.types";
import { ARR_TAG, ELEM_OBJ_ARR, ELEM_TAG, EVERY_VSN, II_TAG, OBJ_TAG, ROOT_TAG, STR_TAG, VAL_TAG } from "../../consts/constants";
import { _snip } from "../../utils/sys-utils/snip.utils";
import { serialize_style } from "../../utils/attrs-utils/serialize-style";
import { serialize_primitive_hson } from "../../utils/primitive-utils/serialize-primitive.utils";
import { is_Node } from "../../utils/node-utils/node-guards";
import { assert_invariants } from "../../diagnostics/assert-invariants.test";
import { _META_DATA_PREFIX } from "../../consts/constants";
import { HsonAttrs, HsonMeta, HsonNode } from "../../types/node.types";
import { _throw_transform_err } from "../../utils/sys-utils/throw-transform-err.utils";


/* debug log */
let _VERBOSE = false;
const _log = _VERBOSE
    ?
    console.log
    : () => { };

/**
 * Build a per-traversal cycle guard for HSON serialization.
 *
 * Behavior:
 * - Internally holds a `WeakSet<object>` of visited nodes.
 * - `enter(node)`:
 *    - Throws a transform error if `node` has already been seen, indicating
 *      a cycle in the graph (`serialize-hson: cycle detected in node graph`).
 *    - Otherwise records the node as seen.
 * - `leave(node)`:
 *    - Removes `node` from the `WeakSet` to avoid unbounded memory growth
 *      across large trees (optional, but kept here for long-lived traversals).
 *
 * Intended usage:
 * - Construct once at the start of serialization and pass it down the
 *   recursive `emitNode` calls to detect structural cycles early.
 *
 * @returns An object with `enter` and `leave` methods implementing cycle guards.
 */
function cycleGuard() {
    const seen = new WeakSet<object>();
    return {
        enter(node: object) {
            if (seen.has(node)) {
                _throw_transform_err("serialize-hson: cycle detected in node graph", 'serialize_hson.cycleGuard.enter');
            }
            seen.add(node);
        },
        leave(node: object) {
            // optional: omit to reduce overhead; keeping it avoids memory growth across huge trees
            seen.delete(node);
        }
    };
}

/**
 * Determine whether an `_attrs` object should be treated as “empty” for
 * serialization purposes.
 *
 * Rules:
 * - `undefined` or `null` → considered empty.
 * - An object with *no own enumerable keys* → considered empty.
 * - A `style: ""` entry still counts as *present* (i.e. not empty) because
 *   it represents an explicitly set style attribute on the wire.
 *
 * This predicate is used to decide when attribute clusters can be elided
 * or when certain shorthand forms (e.g. self-close value) are allowed.
 *
 * @param attrs - The HSON `_attrs` object to inspect.
 * @returns `true` if there are no own keys, `false` otherwise.
 */
function isEmptyAttrs(attrs?: HsonAttrs): boolean {
    if (!attrs) return true;
    for (const _k in attrs) return false;
    return true;
}

/**
 * Validate and normalize a `_meta` object for on-wire serialization.
 *
 * Constraints enforced:
 * - Only keys starting with the `data-` meta prefix (`_META_DATA_PREFIX`)
 *   are permitted. Any other key causes a transform error.
 * - All values must be strings; non-string values cause a transform error.
 *
 * Behavior:
 * - `undefined` or empty input → returns an empty object `{}`.
 * - Valid entries are copied into a fresh `{ [key: string]: string }` object,
 *   which is safe for direct string interpolation in attribute lists.
 *
 * This function makes the `_meta` contract explicit and prevents accidental
 * leakage of internal bookkeeping fields into serialized HSON.
 *
 * @param meta - The HSON `_meta` object to validate.
 * @returns A plain `{ [key: string]: string }` object containing only
 *   allowed `data-*` meta keys.
 * @throws On illegal keys or non-string values.
 */
function assertAndReturnMeta(meta?: HsonMeta): Record<string, string> {
    _log('assert & return _meta')
    if (!meta) return {};
    const out: Record<string, string> = {};
    for (const k of Object.keys(meta)) {
        if (!k.startsWith(_META_DATA_PREFIX)) {
            _throw_transform_err(`serialize-hson: illegal meta key "${k}" (only "${_META_DATA_PREFIX}*" allowed)`, 'serialize_hson');
        }
        const v = (meta as Record<string, unknown>)[k];
        if (typeof v !== "string") {
            _throw_transform_err(`serialize-hson: meta "${k}" must be a string`, 'serialize_hson');
        }
        out[k] = v;
    }
    return out;
}

/**
 * Render a HSON `_attrs` object into a canonical HTML-style attribute string.
 *
 * Behavior:
 * - Early exits for `undefined` or empty objects, returning `""`.
 * - Partitions entries into:
 *   - non-flag attributes: `value !== key`
 *   - flag attributes: `value === key` (e.g. `{ disabled: "disabled" }`)
 * - For non-flags:
 *   - Special-cases `style`:
 *     - If the value is an object, renders it via `serialize_style` to a
 *       canonical CSS string (sorted/normalized) and quotes it.
 *   - String values:
 *     - Escapes double quotes (`" → \"`) and renders as ` key="value"`.
 *   - Non-string primitives:
 *     - Rendered as ` key=value` with no quotes.
 * - For flags:
 *   - Rendered as bare tokens: ` key` (no `=value`).
 *
 * Output format:
 * - Each attribute is prefixed with a leading space.
 * - Order is “non-flags first, then flags”, preserving relative order
 *   within each group.
 *
 * @param attrs - The HSON `_attrs` to render.
 * @returns A space-prefixed attribute string suitable for `<tag${attrs}>`.
 */
function formatAttrsNEW(attrs: HsonAttrs | undefined): string {
    if (!attrs) return "";
    const entries = Object.entries(attrs);
    if (!entries.length) return "";
    _log('formatting _attrs')


    // partition without sorting: non-flags first, then flags (value === key)
    const nonFlags = entries.filter(([k, v]) => v !== k);
    const flags = entries.filter(([k, v]) => v === k);

    const kv = (k: string, v: Primitive | Record<string, string>) => {
        if (k === "style" && v && typeof v === "object" && !Array.isArray(v)) {
            // style object → canonical CSS string
            return ` style="${serialize_style(v as Record<string, string>)}"`;
        }
        if (typeof v === "string") {
            return ` ${k}="${v.replace(/"/g, '\\"')}"`;
        }
        return ` ${k}=${String(v)}`;
    };

    const parts: string[] = [];
    for (const [k, v] of nonFlags) parts.push(kv(k, v as any));
    for (const [k] of flags) parts.push(` ${k}`); // flags as bare keys

    return parts.join("");
}

/**
 * Merge user `_attrs` and `_meta` into a single attribute string for HSON tags.
 *
 * Composition:
 * - User attributes:
 *   - Rendered via `formatAttrsNEW(attrs)` (style, flags, etc.).
 * - System/meta attributes:
 *   - Filtered and validated via `assertAndReturnMeta(meta)`.
 *   - Sorted by key and rendered as:
 *       ` data-foo="..." data-bar="..."`
 *     with inner quotes escaped.
 *
 * Behavior:
 * - Each component may be empty; the final string is just `user + sys`.
 * - Always returns a string that can be spliced directly into `<tag${attrsStr}>`.
 *
 * @param attrs - User-facing `_attrs` from the node.
 * @param meta - `_meta` payload (usually `data-*` keys) from the node.
 * @returns A combined attribute string including both user and meta attrs.
 */
function buildAttrString(attrs: HsonAttrs | undefined, meta: HsonMeta | undefined): string {
    _log('building attrs string');
    const user = formatAttrsNEW(attrs);
    const sys = (() => {
        const m = assertAndReturnMeta(meta);
        if (!Object.keys(m).length) return "";
        const parts = Object.keys(m).sort().map(k => ` ${k}="${m[k].replace(/"/g, '\\"')}"`);
        return parts.join("");
    })();
    return `${user}${sys}`;
}

/**
 * Probe whether a node can be rendered as a compact “self-close with value”
 * HSON form, and return that primitive value if so.
 *
 * Conditions for success:
 * - Node has *no* `_attrs` (or only an empty `_attrs`) and *no* `_meta`.
 * - `_content` exists and contains exactly one child, which is a node.
 * - That child is either:
 *   - a leaf `_str` or `_val`, or
 *   - a single `_obj` wrapper around such a leaf.
 * - The leaf has exactly one primitive payload.
 *
 * Return semantics:
 * - `<_str>` leaf → returns a `string` (including `""`).
 * - `<_val>` leaf → returns a `number | boolean | null`.
 * - Any mismatch or structural deviation → returns `undefined`.
 *
 * Callers:
 * - Used by `emitNode` to decide whether a tag can be emitted as:
 *     `<tag value />`
 *   (element semantics) or as a compact value-bearing form in object
 *   semantics, instead of a multi-line block.
 *
 * @param node - Candidate `HsonNode` to inspect.
 * @returns The primitive value if a valid self-close shape, otherwise `undefined`.
 */
function getSelfCloseValueNEW(node: HsonNode): Primitive | undefined {

    // must not carry attrs or meta
    if (!isEmptyAttrs(node._attrs)) return undefined;
    if (node._meta && Object.keys(node._meta).length) return undefined;

    // must have exactly one child which is a node
    if (!node._content || node._content.length !== 1 || !is_Node(node._content[0])) {
        return undefined;
    }

    // unwrap at most one level of _obj to reach the scalar leaf
    let child = node._content[0] as HsonNode;

    if (child._tag === OBJ_TAG) {
        const objKids = child._content as HsonNode[] | undefined;
        if (!objKids || objKids.length !== 1 || !is_Node(objKids[0])) return undefined;
        child = objKids[0] as HsonNode;
    }

    // leaf must have exactly one primitive payload
    if (!child._content || child._content.length !== 1) return undefined;
    const prim = child._content[0] as unknown;

    if (child._tag === STR_TAG) {
        return (typeof prim === "string") ? (prim as string) : undefined;
    }

    if (child._tag === VAL_TAG) {
        return (typeof prim === "number" || typeof prim === "boolean" || prim === null)
            ? (prim as Primitive)
            : undefined;
    }

    return undefined;
}


/* -------------------------------------------------------------------------- */
/* core serializer                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Marker type for the “cluster semantics” of a node’s parent during
 * serialization.
 *
 * Values:
 * - `OBJ_TAG`  - Parent is in object mode; children typically serialize as
 *                property bodies (e.g. `<key ...>` blocks).
 * - `ELEM_TAG` - Parent is in element mode; children behave like HTML nodes.
 * - `ARR_TAG`  - Parent is array-like; children are `_ii`-wrapped items.
 *
 * `emitNode` uses this context to:
 * - Pick appropriate closers (`>` vs `/>`) in ambiguous cases.
 * - Decide when primitive children should be emitted as inline values
 *   vs object blocks.
 */
export type ParentCluster = typeof OBJ_TAG | typeof ELEM_TAG | typeof ARR_TAG;


/**
 * Recursively serialize a single `HsonNode` into HSON wire format.
 *
 * Responsibilities:
 * - Enforce invariants on all VSNs (`_str`, `_val`, `_root`, `_obj`, `_arr`,
 *   `_elem`, `_ii`) and throw structured errors on violations.
 * - Encode structural semantics (object vs element vs array) into the
 *   chosen HSON surface syntax (closers, clusters, shorthands).
 * - Respect parent cluster context (`parentCluster`) to avoid accidental
 *   drift between JSON-mode and HTML-mode semantics.
 * - Cooperate with `cycleGuard` to detect and prevent graph cycles.
 *
 * Key behaviors:
 * 1. Primitive leaves (`_str`, `_val`):
 *    - Require exactly one primitive in `_content`.
 *    - `_str` → `JSON.stringify(value)` to preserve quoting and escapes.
 *    - `_val` → raw `number | boolean | null` literal.
 *
 * 2. `_ii` index nodes:
 *    - Should not appear on the HSON wire; if encountered, unwrap once and
 *      serialize the child at the same depth.
 *
 * 3. `_arr` clusters:
 *    - Rendered as `« ... »` blocks.
 *    - Each array item is normalized such that:
 *      - Empty object item → `<>` shorthand.
 *      - Non-object items are serialized directly or wrapped in objects
 *        depending on their shape.
 *
 * 4. `_root`:
 *    - Expects a single cluster child (`_obj | _elem | _arr`).
 *    - Emits only the child cluster (no `<_root>` tag on wire).
 *    - Special-cases empty `_obj` cluster as `<>` shorthand.
 *
 * 5. `_obj` / `_elem` clusters:
 *    - Never serialized with their own tag names (“melted” on the wire).
 *    - `_obj`:
 *      - Empty → `<>`.
 *      - Properties become `<key ...>` blocks with nested content.
 *    - `_elem`:
 *      - Children are serialized as peers at the same depth.
 *
 * 6. Standard tags (“normal” HTML-like elements):
 *    - Attribute/meta handling via `buildAttrString`.
 *    - Attempts compact representations in this order:
 *      - `inlineShape(...)` → one-line primitive or void forms.
 *      - `getSelfCloseValueNEW(...)` → compact value-bearing form.
 *    - When in `OBJ_TAG` parent context:
 *      - Prefers block forms (with inner lines) over one-liners to
 *        keep JSON-mode visually distinct.
 *    - Otherwise:
 *      - Uses HTML-like self-closing or multi-line `<tag ...>\n...\n</>` forms.
 *
 * 7. Whitespace & padding:
 *    - Indentation is controlled by `depth` using two spaces per level.
 *    - Children are joined with `\\n` and trailing pure-whitespace strings
 *      are filtered out.
 *
 * Error handling:
 * - Any structural anomaly (unknown VSN, illegal attrs on clusters,
 *   malformed leaf payloads, inconsistent `_root` shape, etc.) results in
 *   `_throw_transform_err` with a descriptive label and source tag.
 *
 * @param node - The current `HsonNode` to serialize.
 * @param depth - Current indentation depth (0-based).
 * @param parentCluster - Parent cluster context (`_obj`, `_elem`, `_arr`), or
 *   `undefined` at the top.
 * @param guard - Cycle guard instance from `cycleGuard()`, used to detect
 *   revisiting the same object graph node.
 * @returns The HSON string representation of `node`, including indentation.
 */
function emitNode(
    node: HsonNode,
    depth: number,
    parentCluster: ParentCluster | undefined,
    guard: ReturnType<typeof cycleGuard>
): string {
    _log('entering emitNode()');
    guard.enter(node);
    try {
        const pad = "  ".repeat(depth);

        if (node._tag.startsWith("_") && !EVERY_VSN.includes(node._tag)) {
            _throw_transform_err(`unknown VSN-like tag: <${node._tag}>`, 'parse-html');
        }

        /* 1) VSN leafs: _str / _val */
        if (node._tag === STR_TAG || node._tag === VAL_TAG) {
            _log('leaf node detected: ', node._tag);
            if (!node._content || node._content.length !== 1) {
                _throw_transform_err(`serialize-hson: ${node._tag} must contain exactly one primitive`, 'serialize_hson.cycleGuard.enter');
            }
            const v = node._content[0];

            if (node._tag === STR_TAG) {
                if (typeof v !== "string") {
                    const vErr = node._content?.[0];
                    console.warn("STR payload not string:", vErr, node);
                    _throw_transform_err(`serialize-hson: _str must contain a string`, 'serialize_hson.emitNode()')
                }
                return pad + JSON.stringify(v);
            }

            if (!(typeof v === "number" || typeof v === "boolean" || v === null)) {
                _throw_transform_err("serialize-hson: _val must contain number|boolean|null : ", 'serialize_hson.emitNode()', `${v}`);
            }
            return pad + String(v);
        }

        /* 2) _ii should not be on HSON wire — unwrap defensively if leaked */
        if (node._tag === II_TAG) {
            _log('index node detected');
            const c = node._content?.[0];
            if (!is_Node(c)) {
                _throw_transform_err("serialize-hson: _ii must contain exactly one child node", 'serialize_hson.emitNode()');
            }
            return emitNode(c, depth, parentCluster, guard);  // <-- same depth
        }
        /* 3) _arr cluster → « … » */
        if (node._tag === ARR_TAG) {
            const items = (node._content ?? []) as HsonNode[];
            if (!items.length) return `${pad}«»`;

            const subpad = pad + "  ";

            const inner = items.map((it) => {
                if (!is_Node(it)) {
                    _throw_transform_err('serialize-hson: non-node item in _arr', 'emitNode');
                }

                /* is this an appropriate place for this guard? */
                if (it._tag !== II_TAG) {
                    _throw_transform_err('serialize-hson: only _ii allowed directly under _arr', 'emitNode');
                }

                // Unwrap expected _ii index wrapper (not on wire)
                let item = it;
                const c = item._content ?? [];
                if (c.length !== 1 || !is_Node(c[0])) {
                    _throw_transform_err('serialize-hson: _ii must contain exactly one child node', 'emitNode');
                }
                item = c[0] as HsonNode;

                if (item._tag === OBJ_TAG) {
                    const props = (item._content ?? []) as HsonNode[];
                    if (props.length === 0) {
                        // Empty object item: shorthand
                        return `${subpad}<>`;
                    }
                    // Non-empty object item: explicit object-cluster wrapper
                    const body = props.map(p => emitNode(p, depth + 2, OBJ_TAG, guard)).join("\n");
                    return `${subpad}<\n${body}\n${subpad}>`;
                }

                // Non-object items (arrays/elements/scalars): emit as-is
                return emitNode(item, depth + 1, undefined, guard);
            }).join(",\n");

            return `${pad}«\n${inner}\n${pad}»`;
        }



        /* 5) _root: keep on wire (current policy); choose closer by melted child */
        if (node._tag === ROOT_TAG) {
            const kids = (node._content ?? []) as HsonNode[];

            if (kids.length === 0) {
                // no generic `<>`. An empty document is an empty fragment.
                return ""; // emit nothing
            }

            if (kids.length !== 1) {
                _throw_transform_err('_root must have exactly one cluster child', 'serialize_hson');
            }

            const cluster = kids[0];
            if (!ELEM_OBJ_ARR.includes(cluster._tag)) {
                _throw_transform_err('_root child must be _obj | _elem | _arr', 'serialize_hson');
            }

            // emit *only* the child cluster, with no `_root` and no synthetic sentinel.
            const inner = emitNode(cluster, 0, cluster._tag as ParentCluster, guard);

            // Special case: if (cluster is _obj and has 0 props) return "<>"
            if (cluster._tag === OBJ_TAG && (cluster._content?.length ?? 0) === 0) {
                return "<>"; // optional shorthand, matches parser C above
            }

            return inner.trim();
        }


        /* 4) _obj / _elem clusters: melt; never emit their tags */
        if (node._tag === OBJ_TAG || node._tag === ELEM_TAG) {
            _log('cluster node detected: ', node._tag);
            if (node._attrs && Object.keys(node._attrs).length) {
                _throw_transform_err(`serialize-hson: ${node._tag} may not carry _attrs`, 'serialize_hson.emitNode()');
            }

            const kids = (node._content ?? []) as HsonNode[];

            if (node._tag === OBJ_TAG && kids.length === 0) {
                return `${pad}<>`;
            }
            const cluster: ParentCluster = node._tag;
            if (node._tag === OBJ_TAG) {
                return kids.map(prop => {
                    // narrow
                    if (!is_Node(prop)) {
                        _throw_transform_err("serialize-hson: non-node in _obj._content", "emitNode");
                    }
                    const key = prop._tag as string;
                    const inner = (Array.isArray(prop._content) ? prop._content[0] : null) as HsonNode | null;
                    if (!inner) return `${pad}<${key} />`;

                    // Dive through wrapper _obj if present
                    const rendered =
                        inner._tag === OBJ_TAG
                            ? (inner._content as HsonNode[])
                                .map(grand => emitNode(grand, depth + 1, cluster, guard))
                                .join("\n")
                            : emitNode(inner, depth + 1, cluster, guard);

                    return `${pad}<${key}\n${rendered}\n${pad}>`;
                }).join("\n");
            }
            return (node._content ?? [])
                .map(k => emitNode(
                    k as HsonNode,
                    depth,
                    ELEM_TAG as ParentCluster, // ← keep element context for child emission
                    guard
                ))
                .join("\n");
        }


        /* 6) Standard tag element */
        const INLINE_VSNS = new Set<string>([STR_TAG, VAL_TAG]);

        function hasOwnProps(o: object | undefined | null): boolean {
            return !!(o && Object.keys(o).length);
        }

        function inlineShape(n: HsonNode):
            | { kind: 'void' }
            | { kind: 'text'; value: Primitive }
            | undefined {

            // must have no attrs/meta payload (empty objects are OK)
            if (hasOwnProps(n._attrs)) return undefined;
            if (hasOwnProps(n._meta)) return undefined;

            const c = n._content ?? [];

            // empty -> <tag />
            if (c.length === 0) return { kind: 'void' };

            // exactly one child: could be _str/_val OR an _elem wrapper
            if (c.length === 1 && typeof c[0] === "object" && c[0] && "_tag" in c[0]) {
                let child = c[0] as HsonNode;

                // unwrap a single _elem wrapper (HTML-origin nodes often look like: tag -> _elem -> _str/_val)
                if (child._tag === ELEM_TAG) {
                    const ec = child._content ?? [];
                    if (ec.length === 0) return { kind: 'void' }; // <tag><_elem /></tag> -> treat as void
                    if (ec.length === 1 && typeof ec[0] === "object" && ec[0] && "_tag" in ec[0]) {
                        child = ec[0] as HsonNode;
                    } else {
                        return undefined;
                    }
                }

                // now check primitive wrappers
                if (INLINE_VSNS.has(child._tag)) {
                    const v = child._content?.[0];
                    if (v === undefined) return undefined;
                    // keep strings single-line only
                    if (typeof v === "string" && v.includes("\n")) return undefined;
                    return { kind: 'text', value: v as Primitive };
                }
            }

            return undefined;
        }

        _log('building attrs string for standard tag');
        const attrsStr = buildAttrString(node._attrs, node._meta);

        const shape = inlineShape(node);
        if (shape !== undefined) {
            if (parentCluster === OBJ_TAG) {
                // CHANGED: OBJ-mode should be inline for primitive/void too.
                // This removes the inconsistent newline policy vs getSelfCloseValueNEW.
                if (shape.kind === "void") {
                    return `${pad}<${node._tag}${attrsStr}  <>`; // OBJ closer implied by ">"
                    // NOTE: this line already ends with ">" because <> is the value token.
                } else {
                    return `${pad}<${node._tag}${attrsStr}  ${serialize_primitive_hson(shape.value)}>`;
                }
            }

            // ELEM-mode: inline with elem-closer
            return shape.kind === "void"
                ? `${pad}<${node._tag}${attrsStr} />`
                : `${pad}<${node._tag}${attrsStr} ${serialize_primitive_hson(shape.value)} />`; // TODO remove space before closer
        }

        // One-liner primitive value (no attrs/meta; single _str/_val child)
        const selfVal = getSelfCloseValueNEW(node);
        if (selfVal !== undefined) {
            if (parentCluster === OBJ_TAG) {
                // block in JSON-mode
                return `${pad}<${node._tag}${attrsStr}  ${serialize_primitive_hson(selfVal)}>`;
            }
            // element semantics ok to self-close
            return `${pad}<${node._tag}${attrsStr} ${serialize_primitive_hson(selfVal)} />`; // TODO -- remove space before closing tag
        }

        const children = (node._content ?? []) as HsonNode[];

        if (!children.length) {
            if (parentCluster === OBJ_TAG) {
                // empty property in object semantics → explicit empty object cluster
                return `${pad}<${node._tag}${attrsStr}\n${pad}  <>\n${pad}>`;
            } else {
                // close on same line in _elem too
                return `${pad}<${node._tag}${attrsStr} />`; // TODO -- remove space before closing />
            }
        }

        // Decide closer by *single* child cluster (elem → '/>', obj/arr → '>').
        // If the shape isn’t a single cluster, prefer element closer to avoid obj-mode drift.
        let closer = '/>';
        if (
            children.length === 1 &&
            is_Node(children[0]) &&
            (children[0]._tag === OBJ_TAG || children[0]._tag === ARR_TAG || children[0]._tag === ELEM_TAG)
        ) {
            closer = (children[0]._tag === ELEM_TAG) ? '/>' : '>';
        }

        const inner = children
            .map(ch => emitNode(
                ch,
                depth + 1,
                // arrays live under _obj semantics when printed
                ch._tag === ARR_TAG ? OBJ_TAG : parentCluster,
                guard
            ))
            .filter(s => /\S/.test(s)) // drop pure-whitespace emissions
            .join("\n");

        // If nothing actually rendered, self-close regardless of computed closer.
        if (inner.length === 0) {
            return `${pad}<${node._tag}${attrsStr} ${closer}`; // TODO -- remove space before closer
        }

        // Use the computed closer.
        return `${pad}<${node._tag}${attrsStr}\n${inner}\n${pad}${closer}`;
    } finally {
        guard.leave(node);
    }
}

/**
 * Public entry point for serializing a HSON tree to HSON wire format.
 *
 * Pipeline:
 * 1. Validate the root:
 *    - Root must be a valid `HsonNode` (`is_Node(root)`).
 *    - `assert_invariants(root, "serialize_hson")` enforces internal IR
 *      constraints before any serialization is attempted.
 *
 * 2. Initialize a cycle guard:
 *    - `cycleGuard()` is used to detect structural cycles in the node graph
 *      during recursive traversal (defensive against pathological inputs).
 *
 * 3. Delegate serialization:
 *    - Calls `emitNode(root, 0, undefined, guard)` to produce the full
 *      HSON representation.
 *
 * 4. Trim:
 *    - Leading/trailing whitespace is removed from the final string via
 *      `.trim()`, yielding a clean top-level HSON document.
 *
 * Contracts:
 * - Accepts only well-formed `HsonNode` trees.
 * - Throws `_throw_transform_err` when invariants are violated or cycles
 *   are detected.
 *
 * @param root - The root `HsonNode` to serialize.
 * @returns A trimmed HSON string representing the full tree.
 * @throws If `root` is not a node, invariants fail, or a cycle is detected.
 * @see emitNode
 * @see cycleGuard
 */
export function serialize_hson(root: HsonNode): string {
    if (!is_Node(root)) {
        _throw_transform_err("serialize-hson: root must be a HsonNode", 'serialize-hson');
    }
    assert_invariants(root, 'serialize_hson');
    const guard = cycleGuard();
    const out = emitNode(root, 0, undefined, guard);
    return out.trim();
}
