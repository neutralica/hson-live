import { Primitive } from "../types/core.types";
import { STR_TAG, VAL_TAG, II_TAG, ARR_TAG, ROOT_TAG, OBJ_TAG, ELEM_TAG, VSN_TAGS, EVERY_VSN, ELEM_OBJ_ARR } from "../consts/constants";
import { _META_DATA_PREFIX, _DATA_INDEX } from "../consts/constants";
import { HsonNode, HsonMeta, HsonAttrs, NodeContent } from "../types/node.types";
import { make_string } from "../utils/primitive-utils/make-string.nodes.utils";
import { is_Node } from "../utils/node-utils/node-guards";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils";


/* 
   TODO - add 'alreadyAsserted' flag or similar to prevent multiple tree walks ?
   TODO - add 'dev mode' flag to trigger assert_invariants or not?
*/


type DevCfg = { throwOnFirst?: boolean };

/**********************************************************
 * Validate a complete HSON tree against the “NEW” node shape.
 *
 * Responsibilities:
 *   - Runs a fast structural sanity check (`assertNewShapeQuick`),
 *   - Walks the tree with `walk`, enforcing all VSN invariants:
 *       • meta keys are `data-_*` only,
 *       • VSNs (_str/_val/_obj/_arr/_elem/_root/_ii) have no `_attrs`,
 *       • `_ii` shape and placement rules,
 *       • `_arr` / `_obj` / `_elem` containment rules,
 *       • `_root` cluster rules,
 *       • primitives never appear outside _str/_val.
 *
 * Behavior:
 *   - Collects errors into `errs`.
 *   - If any are found, throws a single `_throw_transform_err` containing
 *     up to the first 12 messages plus a stringified snapshot of `root`.
 *
 * Parameters:
 *   - root: HsonNode to validate.
 *   - fn:   Label for the calling function, used in error messages.
 *   - cfg:  Optional config:
 *       • throwOnFirst (default: true) – stop at first error vs aggregate.
 **********************************************************/
export function assert_invariants(root: HsonNode, fn = '[source fn not given]', cfg: DevCfg = { throwOnFirst: true }): void {
  const errs: string[] = [];
  assertNewShapeQuick(root, fn);
  walk(root, '', root._tag, cfg, errs);
  if (errs.length) {
    const msg = errs.slice(0, 12).join('\n  - ');
    _throw_transform_err(`invariant violation(s):\n  - ${msg}`, fn, make_string(root));
  }
}

 /* ---------- core ---------- */
/**********************************************************
 * Recursive invariant checker over a HSON tree.
 *
 * Called by `assert_invariants` after the quick shape pass.
 *
 * Per-tag responsibilities:
 *   - All nodes:
 *       • meta keys must be `data-_*`.
 *       • VSNs may not carry `_attrs`.
 *   - _str / _val:
 *       • exactly one primitive child,
 *       • `_str` payload is string,
 *       • `_val` payload is non-string primitive.
 *   - _ii:
 *       • must appear directly under `_arr`,
 *       • no `_attrs`,
 *       • carries `data-_index` (or `data-__index` alias) as string in `_meta`,
 *       • exactly one child node.
 *   - _arr:
 *       • content is `_ii` nodes only, no bare primitives.
 *   - _elem:
 *       • content is normal element tags or _str/_val only,
 *       • no `_obj`, `_arr`, `_ii` directly inside.
 *   - _root:
 *       • at most one child,
 *       • if present, child is `_obj`, `_elem`, or `_arr`.
 *   - _obj:
 *       • children are nodes only,
 *       • children have no `_attrs`,
 *       • no `_elem` directly under `_obj`,
 *       • no duplicate non-VSN property tags.
 *   - default (normal tag):
 *       • recursively validates children,
 *       • primitives directly in `_content` are illegal.
 *
 * Path tracking:
 *   - Builds a human-readable `path` (e.g. "/_obj/[0]/tag:div") to
 *     include in each error.
 *
 * Config:
 *   - If `cfg.throwOnFirst` is true, returns early on first push to `errs`.
 **********************************************************/
function walk(n: HsonNode, path: string, parentTag: string | null, cfg: DevCfg, errs: string[]): void {
  const here = path + seg(n._tag);

  // meta keys: only data-_*
  if (n._meta) {
    for (const k of Object.keys(n._meta as HsonMeta)) {
      if (!k.startsWith(_META_DATA_PREFIX)) {
        push(errs, cfg, `${here}@meta:${k}: illegal meta key (only "${_META_DATA_PREFIX}*" allowed)`); if (cfg.throwOnFirst) return;
      }
    }
  }

  // VSNs never carry _attrs
  if (isVSN(n._tag) && n._attrs && Object.keys(n._attrs as HsonAttrs).length) {
    push(errs, cfg, `${here}: VSN "${n._tag}" must not have _attrs`); if (cfg.throwOnFirst) return;
  }

  // value wrappers
  if (n._tag === STR_TAG || n._tag === VAL_TAG) {
    const c = n._content ?? [];
    if (c.length !== 1) {
      push(errs, cfg, `${here}: ${n._tag} must have exactly one item in _content`); if (cfg.throwOnFirst) return;
    } else {
      const v = c[0] as Primitive;
      if (n._tag === STR_TAG && typeof v !== 'string') {
        push(errs, cfg, `${here}: _str payload must be string`); if (cfg.throwOnFirst) return;
      }
      if (n._tag === VAL_TAG && typeof v === 'string') {
        push(errs, cfg, `${here}: _val payload must be non-string primitive`); if (cfg.throwOnFirst) return;
      }
    }
    return; // leaf
  }

  // _ii allowed only directly under _arr; must have exactly one child node; meta only data-_index; no attrs
  if (n._tag === II_TAG) {
    if (parentTag !== ARR_TAG) { push(errs, cfg, `${here}: _ii must appear directly under _arr`); if (cfg.throwOnFirst) return; }
    if (n._attrs && Object.keys(n._attrs).length) { push(errs, cfg, `${here}: _ii must not have _attrs`); if (cfg.throwOnFirst) return; }
    const idx = n._meta?.[`${_META_DATA_PREFIX}index`] ?? n._meta?.[_DATA_INDEX];
    if (typeof idx !== 'string') { push(errs, cfg, `${here}: _ii must carry "${_META_DATA_PREFIX}index" as a string in _meta`); if (cfg.throwOnFirst) return; }

    const cc = n._content;
    if (cc.length !== 1) { push(errs, cfg, `${here}: _ii must contain exactly one child node`); if (cfg.throwOnFirst) return; }
    const only = cc[0];
    if (!is_Node(only)) { push(errs, cfg, `${here}: _ii child must be a node (found primitive/null)`); if (cfg.throwOnFirst) return; }
  }

  // _arr: only _ii children; no bare primitives
  if (n._tag === ARR_TAG) {
    const kids = n._content;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      const childPath = `${path}/_arr/[${i}]`;

      if (!is_Node(k)) { push(errs, cfg, `${childPath}: primitive/null outside _str/_val`); if (cfg.throwOnFirst) return; continue; }
      if (k._tag !== II_TAG) { push(errs, cfg, `${childPath}: only _ii allowed directly under _arr`); if (cfg.throwOnFirst) return; }

      walk(k, childPath, ARR_TAG, cfg, errs);
      if (cfg.throwOnFirst && errs.length) return;
    }
    return;
  }

  //  _elem validation — only element nodes (non-VSN) or _str/_val are allowed
  if (n._tag === ELEM_TAG) {
    const kids = n._content;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      const childPath = `${path}/_elem/[${i}]`;

      if (!is_Node(k)) { push(errs, cfg, `${childPath}: primitive/null outside _str/_val`); if (cfg.throwOnFirst) return; continue; }

      if (k._tag === OBJ_TAG || k._tag === ARR_TAG || k._tag === II_TAG) {
        push(errs, cfg, `${childPath}: _elem cannot contain ${k._tag} (only _str/_val or normal element tags allowed)`); if (cfg.throwOnFirst) return; continue;
      }

      walk(k as HsonNode, childPath, ELEM_TAG, cfg, errs);
      if (cfg.throwOnFirst && errs.length) return;
    }
    return;
  }

  // _root: 0 or 1 child; if present it must be cluster
  if (n._tag === ROOT_TAG) {
    const kids = n._content;
    if (kids.length > 1) { push(errs, cfg, `${here}: _root must contain at most one child`); if (cfg.throwOnFirst) return; }
    if (kids.length === 1) {
      const only = kids[0] as HsonNode | Primitive;
      if (!is_Node(only)) {
        push(errs, cfg, `${here}: _root child must be a node; found: primitive (${only})`); if (cfg.throwOnFirst) return;
      } else if (!(only._tag === OBJ_TAG || only._tag === ELEM_TAG || only._tag === ARR_TAG)) {
        push(errs, cfg, `${here}: _root child must be one of _obj/_elem/_arr`); if (cfg.throwOnFirst) return;
      }
    }
  }

  // _obj: shallow checks only; then recurse into each child
  if (n._tag === OBJ_TAG) {
    const kids = n._content;
    const seen = new Set<string>();

    for (let i = 0; i < kids.length; i++) {
      const p = kids[i];
      const pHere = `${here}/[${i}]`;

      // OBJ001 — primitives are illegal directly under _obj
      if (!is_Node(p)) {
        push(errs, cfg, `${pHere}: [ERR: OBJ001] primitive/null outside _str/_val`);
        if (cfg.throwOnFirst) return;
        continue;
      }

      // OBJ002 — direct children of _obj must not have _attrs
      if (p._attrs && Object.keys(p._attrs).length) {
        push(errs, cfg, `${pHere}: [ERR: OBJ002] _obj children must not have _attrs`);
        if (cfg.throwOnFirst) return;
      }

      // OBJ004 — _elem must not appear directly under _obj
      if (p._tag === ELEM_TAG) {
        push(errs, cfg, `${pHere}: [ERR: OBJ004] _elem is not allowed directly under _obj`);
        if (cfg.throwOnFirst) return;
      }

      // OBJ003 — duplicate *property* names (only enforce for non-VSN tags)
      if (!p._tag.startsWith('_')) {
        if (seen.has(p._tag)) {
          push(errs, cfg, `${pHere}: [ERR: OBJ003] duplicate property tag "${p._tag}" inside _obj`);
          if (cfg.throwOnFirst) return;
        }
        seen.add(p._tag);
      }

      // Recurse; deeper shape is validated by its own case (_str/_val/_arr/_obj/element)
      walk(p as HsonNode, pHere, OBJ_TAG, cfg, errs);
      if (cfg.throwOnFirst && errs.length) return;
    }

    return;
  }


  // recurse (nodes only); primitives are illegal outside _str/_val
  const kids = n._content ?? [];
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (is_Node(k)) {
      walk(k as HsonNode, here, n._tag, cfg, errs);
      if (cfg.throwOnFirst && errs.length) return;
    } else {
      push(errs, cfg, `${here}/[${i}]: primitive outside _str/_val`);
      if (cfg.throwOnFirst) return;
    }
  }
}

/*  ---------- helpers ---------- */
/**********************************************************
 * Predicate for determining whether a tag name is a “VSN”
 * (Virtual Structural Node) in the NEW HSON model.
 *
 * VSN set:
 *   - _str, _val, _arr, _obj, _elem, _root, _ii
 *
 * Used by:
 *   - `walk` and `assertNewShapeQuick` to enforce:
 *       • VSNs never carry `_attrs`,
 *       • certain placement rules (e.g., `_ii` under `_arr` only).
 **********************************************************/
function isVSN(t: string) {
  return t === STR_TAG || t === VAL_TAG || t === ARR_TAG || t === OBJ_TAG || t === ELEM_TAG || t === ROOT_TAG || t === II_TAG;
}

/**********************************************************
 * Build a human-readable path segment for an invariant path.
 *
 * Behavior:
 *   - VSN-like tags (starting with "_") → `"/_tag"`,
 *   - normal tags → `"/tag:<name>"`.
 *
 * Used in:
 *   - `walk`’s `path` tracking to make error messages easier to
 *     interpret when debugging malformed trees.
 **********************************************************/
function seg(t: string) { return t.startsWith('_') ? `/${t}` : `/tag:${t}`; }

/**********************************************************
 * Append a diagnostic string to the current error list.
 *
 * Notes:
 *   - Currently does not inspect `cfg`; the decision to stop early
 *     is handled by the caller immediately after `push`.
 *   - Kept as a dedicated helper so later logic (e.g., logging,
 *     deduplication, severity levels) can be centralized here.
 **********************************************************/
function push(errs: string[], cfg: DevCfg, s: string) { errs.push(s); }

/**********************************************************
 * Fast, non-recursive “NEW-shape” guard for HSON nodes.
 *
 * Purpose:
 *   - Detect legacy or mixed-shape trees *before* running the
 *     heavier `walk` invariant checker.
 *
 * Checks:
 *   1) Legacy meta shape:
 *        - Fails if `_meta.attrs` or `_meta.flags` is present.
 *   2) Meta key domain:
 *        - All keys in `_meta` must start with `data-_`.
 *   3) VSN + attrs:
 *        - Any VSN (_str/_val/_arr/_obj/_elem/_root/_ii) that carries
 *          non-empty `_attrs` is rejected.
 *   4) Traversal:
 *        - Uses an explicit stack to walk nodes (no recursion).
 *        - Only descends into `_content` entries that are nodes;
 *          primitives are left for `walk` to validate (e.g. “primitive
 *          outside _str/_val”).
 *
 * Errors:
 *   - Throws immediately on the first violation; this is a hard gate
 *     separating “old” and “new” representations.
 **********************************************************/
export function assertNewShapeQuick(n: any, where: string): void {
  const stack: any[] = [n];

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    const tag = node._tag as string | undefined;
    const meta = node._meta as HsonMeta | undefined;
    const attrs = node._attrs as HsonAttrs | undefined;

    // 1) OLD giveaways in _meta
    if (meta && ("attrs" in meta || "flags" in meta)) {
      throw new Error(`[NEW-only] old-shaped meta in ${where} at <${tag ?? "?"}>
  Found _meta.attrs or _meta.flags`);
    }

    // 2) Only data-_ keys allowed in _meta
    if (meta) {
      for (const k of Object.keys(meta)) {
        if (!k.startsWith(_META_DATA_PREFIX)) {
          throw new Error(`[NEW-only] illegal meta key "${k}" in ${where} at <${tag}> (only "data-_*" allowed)`);
        }
      }
    }

    // 3) VSNs must not carry _attrs
    if (tag && isVSN(tag) && attrs && Object.keys(attrs).length) {
      _throw_transform_err(` VSN <${tag}> with _attrs :  ${where}`, 'assertNewShapeQuick', n);
    }

    // 4) Recurse nodes-only
    const content = node._content as unknown[] | undefined;
    if (Array.isArray(content)) {
      // Don’t descend into leaves; main walk already validates payload shape/arity
      if (tag === STR_TAG || tag === VAL_TAG) {
        // optional: enforce arity here, but don’t throw on the primitive itself
        // if (content.length !== 1) throw new Error('...'); 
      } else {
        for (const c of content) {
          // Only push nodes; ignore primitives here.
          if (is_Node(c)) {
            stack.push(c as HsonNode);
          }
          // else: let main walk flag “primitive outside _str/_val”
        }
      }
    }
  }
}