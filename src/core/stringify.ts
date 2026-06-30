// stringify.ts

import { _DATA_INDEX, _DATA_QUID } from "./constants.js";
import { is_Node } from "./node-guards.js";
import type { HsonAttrs, HsonMeta, HsonNode } from "./types.js";

export function make_string_pretty(value: unknown, indent = 2): string {
  return JSON.stringify(canon(value), null, indent);
}

export const make_string = make_string_pretty;

export function isRef(x: unknown): x is object {
  return x !== null && (typeof x === "object" || typeof x === "function");
}

function canon(v: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (Array.isArray(v)) return v.map(x => canon(x, seen));

  if (isRef(v)) {
    if (seen.has(v)) return "[[Circular]]";
    seen.add(v);

    if (is_Node(v)) return orderNode(v, seen);
    return orderPlainObject(v as Record<string, unknown>, seen);
  }

  return v;
}

function orderNode(n: HsonNode, seen: WeakSet<object>) {
  const out: any = {};

  out.$_tag = n.$_tag;

  if (n.$_attrs && Object.keys(n.$_attrs).length) {
    out.$_attrs = orderAttrs(n.$_attrs);
  }

  if (n.$_meta && Object.keys(n.$_meta).length) {
    out.$_meta = orderMeta(n.$_meta);
  }

  if (Array.isArray(n.$_content) && n.$_content.length) {
    out.$_content = n.$_content.map(c => canon(c, seen));
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
