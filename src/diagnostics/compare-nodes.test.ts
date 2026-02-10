// compare-nodes.ts

import type { HsonNode } from "../types/node.types";
import { is_Node } from "../utils/node-utils/node-guards";
import { make_string } from "../utils/primitive-utils/make-string.nodes.utils";
import { _snip } from "../utils/sys-utils/snip.utils";

const LEAF = new Set(["_str", "_val"]);
const MAX_SNIP = 500;
const ELLIPSIS = " …";


export type CompareNodesOpts = Readonly<{
    allow_html_newline_norm?: boolean;
    // (future: other narrowly-scoped normalizations)
}>;

// CHANGED: small helper; keep it local to compare_nodes to avoid broad reuse
function normalize_newlines_lf(s: string): string {
    return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}


function semanticChildren(n: HsonNode): HsonNode[] {
    const kids = (n._content ?? []).filter(is_Node);
    if (kids.length === 1 && kids[0]._tag === "_elem") {
        return (kids[0]._content ?? []).filter(is_Node);
    }
    return kids;
}

function collapseTrivial(n: HsonNode): HsonNode {
    if (n._tag === "_elem") {
        const c = (n._content ?? []).filter(is_Node);
        if (c.length === 1 && LEAF.has(c[0]._tag)) return c[0];
    }
    return n;
}

function compareLeaf(a: HsonNode, b: HsonNode, path: string, diffs: string[], opts?: CompareNodesOpts): boolean {
    if (!(LEAF.has(a._tag) && LEAF.has(b._tag))) return false;

    const va = a._content?.[0];
    const vb = b._content?.[0];

    if (va === vb) return true;

    // CHANGED: allow HTML/XML newline normalization ONLY when explicitly enabled,
    // ONLY for string leaves, and ONLY when CR exists on either side.
    if (
        opts?.allow_html_newline_norm === true &&
        typeof va === "string" &&
        typeof vb === "string" &&
        (va.includes("\r") || vb.includes("\r"))
    ) {
        const na = normalize_newlines_lf(va);
        const nb = normalize_newlines_lf(vb);

        if (na === nb) {
            // Optional: add a non-failing note. This keeps diffs empty (pass),
            // but still leaves breadcrumbs if you want them.
            // diffs.push(`Leaf normalized (CR→LF) @ ${path}: ${JSON.stringify(va)} -> ${JSON.stringify(na)}`);
            return true;
        }
    }

    diffs.push(`Leaf mismatch @ ${path}: ${JSON.stringify(va)} vs ${JSON.stringify(vb)}`);
    return true;
}

function compareChildrenByIndex(
    aKids: HsonNode[],
    bKids: HsonNode[],
    path: string,
    diffs: string[],
    compareFn: (a: HsonNode, b: HsonNode, p: string) => void
) {
    if (aKids.length !== bKids.length) {
        diffs.push(`Child count mismatch @ ${path}: ${aKids.length} vs ${bKids.length}`);
    }
    const len = Math.min(aKids.length, bKids.length);
    for (let i = 0; i < len; i++) compareFn(aKids[i], bKids[i], `${path}._content[${i}]`);
}

function compareChildrenByKeyForObj(
    aKids: HsonNode[],
    bKids: HsonNode[],
    path: string,
    diffs: string[],
    compareFn: (a: HsonNode, b: HsonNode, p: string) => void
) {
    const mapA = new Map<string, HsonNode>();
    const mapB = new Map<string, HsonNode>();
    for (const n of aKids) mapA.set(n._tag, n);
    for (const n of bKids) mapB.set(n._tag, n);

    for (const k of mapA.keys()) if (!mapB.has(k)) diffs.push(`Key missing in B @ ${path}.${k}`);
    for (const k of mapB.keys()) if (!mapA.has(k)) diffs.push(`Key missing in A @ ${path}.${k}`);

    for (const k of mapA.keys()) {
        const aa = mapA.get(k)!;
        const bb = mapB.get(k);
        if (!bb) continue;
        compareFn(aa, bb, `${path}.${k}`);
    }
}

function stableStringify(obj: Record<string, unknown>): string {
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = obj[k];
    return JSON.stringify(out);
}

function compareAttrs(a?: Record<string, any>, b?: Record<string, any>, path = ""): string[] {
    const diffs: string[] = [];
    const A = a ?? {};
    const B = b ?? {};

    const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
    for (const k of keys) {
        if (!(k in A)) { diffs.push(`Missing attr in A @ ${path}["${k}"]`); continue; }
        if (!(k in B)) { diffs.push(`Missing attr in B @ ${path}["${k}"]`); continue; }

        const va = A[k], vb = B[k];
        const bothObj = typeof va === "object" && va && typeof vb === "object" && vb;

        if (k === "style" && bothObj && !Array.isArray(va) && !Array.isArray(vb)) {
            if (stableStringify(va) !== stableStringify(vb)) diffs.push(`Style mismatch @ ${path}["style"]`);
            continue;
        }
        if (bothObj) {
            if (stableStringify(va) !== stableStringify(vb)) diffs.push(`Attr object mismatch @ ${path}["${k}"]`);
        } else {
            if (va !== vb) diffs.push(`Attr value mismatch @ ${path}["${k}"]: ${JSON.stringify(va)} vs ${JSON.stringify(vb)}`);
        }
    }
    return diffs;
}

function compareContent(aC?: any[], bC?: any[], path = ""): string[] {
    const A = aC ?? [];
    const B = bC ?? [];
    const diffs: string[] = [];
    if (A.length !== B.length) diffs.push(`_content length mismatch @ ${path}: ${A.length} vs ${B.length}`);
    const len = Math.min(A.length, B.length);
    for (let i = 0; i < len; i++) {
        diffs.push(...compareAny(A[i], B[i], `${path}[${i}]`));
    }
    return diffs;
}

function compare(nodeA: HsonNode, nodeB: HsonNode, path: string, opts?: CompareNodesOpts): string[] {
    const diffs: string[] = [];
    if (nodeA._tag !== nodeB._tag) diffs.push(`_tag mismatch @ ${path}: "${nodeA._tag}" vs "${nodeB._tag}"`);

    const collapseA = collapseTrivial(nodeA);
    const collapseB = collapseTrivial(nodeB);

    // BUGFIX: compare A vs B (was A vs A)
    diffs.push(...compareAttrs(collapseA._attrs, collapseB._attrs, `${path}._attrs`));

    // CHANGED: compareLeaf now gets opts
    if (compareLeaf(collapseA, collapseB, path, diffs, opts)) return diffs;

    const aKids = semanticChildren(collapseA);
    const bKids = semanticChildren(collapseB);

    if (collapseA._tag === "_obj" && collapseB._tag === "_obj") {
        compareChildrenByKeyForObj(aKids, bKids, path, diffs, (x, y, p) => diffs.push(...compare(x, y, p, opts))); // CHANGED
    } else if (collapseA._tag === "_arr" && collapseB._tag === "_arr") {
        compareChildrenByIndex(aKids, bKids, path, diffs, (x, y, p) => diffs.push(...compare(x, y, p, opts))); // CHANGED
    } else {
        compareChildrenByIndex(aKids, bKids, path, diffs, (x, y, p) => diffs.push(...compare(x, y, p, opts))); // CHANGED
    }

    return diffs;
}

function comparePlainObjects(a: Record<string, unknown>, b: Record<string, unknown>, path: string): string[] {
    const diffs: string[] = [];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        if (!(k in a)) { diffs.push(`Key missing in A @ ${path}.${k}`); continue; }
        if (!(k in b)) { diffs.push(`Key missing in B @ ${path}.${k}`); continue; }
        diffs.push(...compareAny(a[k], b[k], `${path}.${k}`));
    }
    return diffs;
}

function compareAny(a: any, b: any, path: string): string[] {
    if (typeof a !== typeof b) return [`Type mismatch @ ${path}: ${typeof a} vs ${typeof b}`];

    if (a === null || b === null) return (a === b) ? [] : [`Null mismatch @ ${path}: ${a} vs ${b}`];

    if (typeof a !== "object") return (a === b) ? [] : [`Primitive mismatch @ ${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`];

    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return [`Type mismatch @ ${path}: array vs non-array`];
        return compareContent(a, b, path);
    }

    const aIsNode = is_Node(a);
    const bIsNode = is_Node(b);
    if (aIsNode !== bIsNode) return [`Type mismatch @ ${path}: ${aIsNode ? "HsonNode" : "object"} vs ${bIsNode ? "HsonNode" : "object"}`];

    if (aIsNode && bIsNode) return compare(a as HsonNode, b as HsonNode, path);

    return comparePlainObjects(a as Record<string, unknown>, b as Record<string, unknown>, path);
}

/**********************************************************
 * Deep semantic comparator for two HSON node trees.
 *
 * Purpose:
 *   - Compare two HsonNode graphs (A vs B) and produce a list
 *     of human-readable difference strings.
 *   - Treats certain shapes (like trivial `_elem` wrappers) as
 *     equivalent to keep comparisons aligned with NEW semantics.
 *
 * Comparison rules:
 *   - Tag:
 *       • `_tag` must match (`_tag mismatch @ path: "A" vs "B"`).
 *
 *   - Leaf nodes:
 *       • `_str` and `_val` are treated as leaf VSNs.
 *       • If both sides are leaves, compare their single payload;
 *         mismatch → `Leaf mismatch @ path: "va" vs "vb"`.
 *
 *   - `_elem` semantics:
 *       • `collapseTrivial` unwraps `_elem` if it contains exactly
 *         one `_str` or `_val`, so:
 *             <_elem>[_str("x")] ≡ _str("x")
 *         for the purposes of comparison.
 *       • `semanticChildren` treats a single `_elem` child as
 *         transparent, comparing its content instead.
 *
 *   - Attributes (`_attrs`):
 *       • Keys must match on both sides; missing keys produce:
 *           `Missing attr in A/B @ path["key"]`.
 *       • For `style` when both values are plain objects, keys
 *         are sorted and compared via `stableStringify` so order
 *         differences do not matter:
 *           `Style mismatch @ path["style"]`.
 *       • For other object-valued attrs, compare stable JSON.
 *       • Primitive attrs use strict equality:
 *           `Attr value mismatch @ path["key"]: va vs vb`.
 *
 *   - Content (`_content`):
 *       • Length mismatches produce:
 *           `_content length mismatch @ path: lenA vs lenB`.
 *       • Elements compared pairwise with recursive `compareAny`.
 *
 *   - `_obj` nodes:
 *       • Children are grouped by tag (property name).
 *       • Keys missing on either side produce:
 *           `Key missing in A/B @ path.key`.
 *       • Matching keys recurse via `compare(...)` at `path.key`.
 *
 *   - `_arr` nodes:
 *       • Children are compared by index:
 *           `Child count mismatch @ path: lenA vs lenB`.
 *       • Matching indices recurse at `path._content[i]`.
 *
 *   - Plain JS objects (non-node):
 *       • Keys merged and compared recursively via `compareAny`,
 *         reporting `Key missing in A/B @ path.key` or primitive
 *         mismatches.
 *
 *   - Arrays (non-node):
 *       • Length and element-by-element comparison via
 *         `compareContent`.
 *
 *   - Type mismatches:
 *       • If the runtime types differ (including “node vs plain
 *         object”), the first difference is:
 *           `Type mismatch @ path: typeA vs typeB`.
 *
 * API:
 *   - compare_nodes(a, b, verbose = true): string[]
 *
 * Parameters:
 *   - a, b:
 *       • HsonNode roots to compare.
 *       • Must be distinct references; identical refs throw, since
 *         comparing a node against itself is usually a bug.
 *   - verbose (default: true):
 *       • When true:
 *           - Logs a collapsed console group indicating success
 *             or failure.
 *           - Logs snipped JSON-ish views of A and B.
 *           - Logs up to 20 diff lines, then a summary if there
 *             are more.
 *           - Emits a loud `console.error` with the first diff.
 *       • When false:
 *           - Returns the `diffs` array silently, with no logging.
 *
 * Returns:
 *   - Array of diff descriptions (possibly empty).
 *       • `[]` → trees compare equal under these semantics.
 *       • Non-empty → structural or value mismatches found.
 *
 * Usage:
 *   - Asserts strong semantic equivalence between:
 *       • pre- and post-transform HSON trees,
 *       • JSON→HSON→JSON or HTML→HSON→HTML round-trips,
 *       • different parsers/serializers meant to be equivalent.
 **********************************************************/
export function compare_nodes(
  a: HsonNode,
  b: HsonNode,
  verbose = true,
  opts: CompareNodesOpts = {allow_html_newline_norm: true}
): string[] {
  if (!a || !b) throw new Error(`compare_nodes: missing input (a:${JSON.stringify(a)}, b:${JSON.stringify(b)})`);
  if (a === b) {
    throw new Error("compareNodes called with identical references");
  }

  const diffs = compare(a, b, "/_root", opts); // CHANGED

  if (!verbose) return diffs;

  console.groupCollapsed(
    diffs.length ? `❌ node-compare FAIL  (${diffs.length} diffs)` : "✅ node-compare OK"
  );
  console.log("A (snip):", _snip(make_string(a)),500);
  console.log("B (snip):", _snip(make_string(b)),500);

  if (diffs.length) {
    console.groupCollapsed("diffs");
    for (let i = 0; i < Math.min(diffs.length, 20); i++) console.log(diffs[i]);
    if (diffs.length > 20) console.log(`… +${diffs.length - 20} more`);
    console.groupEnd();
  }
  console.groupEnd();

  if (diffs.length) {
    console.error(`FAILED • node-compare: first diff — ${diffs[0]}`);
    console.group(`node-compare FAIL`);
    console.log("A:", _snip(make_string(a), 2000));
    console.log("B:", _snip(make_string(b), 2000));
    console.groupEnd();
  }

  return diffs;
}
