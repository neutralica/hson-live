// make-string.nodes.utils.ts

import { is_Node } from "../node-utils/node-guards.js";
import { HsonNode, HsonAttrs, HsonMeta } from "../../types/node.types.js";
import { _DATA_INDEX, _DATA_QUID } from "../../consts/constants.js";

/**
 * Deterministically stringify arbitrary values for debugging and snapshots.
 *
 * Produces stable JSON output by canonicalizing key order and normalizing
 * known HSON shapes before calling `JSON.stringify`.
 *
 * Features:
 * - Stable key ordering for plain objects (sorted keys).
 * - HSON-aware ordering for nodes:
 *   - `_tag` first
 *   - `_attrs` next (sorted; `style` objects sorted too)
 *   - `_meta` next (prioritizes `data-_quid` and `data-_index`)
 *   - `_content` last (recursively canonicalized)
 * - Handles arrays recursively.
 * - Detects circular references and replaces repeats with the string `"[[Circular]]"`.
 *
 * Notes:
 * - This is a debug/diagnostic utility, not a serializer for persistence.
 * - Functions, symbols, and other non-JSON values will stringify per JSON rules.
 *
 * @param value - Any value to stringify.
 * @param indent - `JSON.stringify` indentation (default `2`).
 * @returns A pretty-printed JSON string with stable ordering.
 */
export function make_string_pretty(value: unknown, indent = 2): string {
  return JSON.stringify(canon(value), null, indent);
}

/** Backward-compatible alias */
export const make_string = make_string_pretty;

/**
 * Check whether a value is reference-like (object or function).
 *
 * @param x - Value to test.
 * @returns True when `x` is an object or function and not null.
 */
export function isRef(x: unknown): x is object {
  return x !== null && (typeof x === 'object' || typeof x === 'function');
}

// ---- internals ----
function canon(v: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  // Arrays: walk, but don't add array itself (optional)
  if (Array.isArray(v)) return v.map(x => canon(x, seen));

  if (isRef(v)) {                       
    if (seen.has(v)) return "[[Circular]]";
    seen.add(v);                          // safe: v is an object/function

    if (is_Node(v)) return orderNode(v as HsonNode, seen);
    return orderPlainObject(v as Record<string, unknown>, seen);
  }

  // Primitive stays primitive (true/false/"", etc.)
  return v;
}


function orderNode(n: HsonNode, seen: WeakSet<object>) {
  const out: any = {};

  // 1) canonical node-key order
  out._tag = n._tag;

  // 2) _attrs (sorted keys; style object also sorted)
  if (n._attrs && Object.keys(n._attrs).length) {
    out._attrs = orderAttrs(n._attrs);
  }

  // 3) _meta (sorted keys)
  if (n._meta && Object.keys(n._meta).length) {
    out._meta = orderMeta(n._meta);
  }

  // 4) _content (recursively canonicalized)
  if (Array.isArray(n._content) && n._content.length) {
    out._content = n._content.map(c => canon(c, seen));
  }

  return out;
}

function orderAttrs(a: HsonAttrs) {
  const out: any = {};
  for (const k of Object.keys(a).sort()) {
    const v = (a as any)[k];
    if (k === "style" && v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = orderStyleObject(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function orderStyleObject(s: Record<string, unknown>) {
  const out: any = {};
  for (const k of Object.keys(s).sort()) out[k] = s[k];
  return out;
}

function orderMeta(m: HsonMeta) {
  const out: any = {};
  // prioritize _meta keys
  const priority = [_DATA_QUID, _DATA_INDEX];
  const keys = [
    ...priority.filter(k => k in (m as any)),
    ...Object.keys(m).sort().filter(k => !priority.includes(k)),
  ];
  for (const k of keys) out[k] = (m as any)[k];
  return out;
}

function orderPlainObject(obj: Record<string, unknown>, seen: WeakSet<object>) {
  const out: any = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = canon(obj[k], seen);
  }
  return out;
}
