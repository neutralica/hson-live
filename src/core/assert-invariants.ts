// assert-invariants.ts

import {
  ARR_TAG,
  ELEM_TAG,
  HSON_SYS_PREFIX,
  II_TAG,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
  _DATA_INDEX,
  _META_DATA_PREFIX,
} from "./constants.js";
import { _throw_transform_err } from "./errors.js";
import { is_Node } from "./node-guards.js";
import { make_string } from "./stringify.js";
import type { HsonAttrs, HsonMeta, HsonNode, Primitive } from "./types.js";

type DevCfg = { throwOnFirst?: boolean };

export function assert_invariants(root: HsonNode, fn = "[source fn not given]", cfg: DevCfg = { throwOnFirst: true }): void {
  const errs: string[] = [];
  assertNewShapeQuick(root, fn);
  walk(root, "", root.$_tag, cfg, errs);
  if (errs.length) {
    const msg = errs.slice(0, 12).join("\n  - ");
    _throw_transform_err(`invariant violation(s):\n  - ${msg}`, fn, make_string(root));
  }
}

function walk(n: HsonNode, path: string, parentTag: string | null, cfg: DevCfg, errs: string[]): void {
  const here = path + seg(n.$_tag);

  if (n.$_meta) {
    for (const k of Object.keys(n.$_meta as HsonMeta)) {
      if (!k.startsWith(_META_DATA_PREFIX)) {
        push(errs, cfg, `${here}@meta:${k}: illegal meta key (only "${_META_DATA_PREFIX}*" allowed)`); if (cfg.throwOnFirst) return;
      }
    }
  }

  if (isVSN(n.$_tag) && n.$_attrs && Object.keys(n.$_attrs as HsonAttrs).length) {
    push(errs, cfg, `${here}: VSN "${n.$_tag}" must not have $_attrs`); if (cfg.throwOnFirst) return;
  }

  if (n.$_tag === STR_TAG || n.$_tag === VAL_TAG) {
    const c = n.$_content ?? [];
    if (c.length !== 1) {
      push(errs, cfg, `${here}: ${n.$_tag} must have exactly one item in $_content`); if (cfg.throwOnFirst) return;
    } else {
      const v = c[0] as Primitive;
      if (n.$_tag === STR_TAG && typeof v !== "string") {
        push(errs, cfg, `${here}: _hson_str payload must be string`); if (cfg.throwOnFirst) return;
      }
      if (n.$_tag === VAL_TAG && typeof v === "string") {
        push(errs, cfg, `${here}: _hson_val payload must be non-string primitive`); if (cfg.throwOnFirst) return;
      }
    }
    return;
  }

  if (n.$_tag === II_TAG) {
    if (parentTag !== ARR_TAG) { push(errs, cfg, `${here}: _hson_ii must appear directly under _hson_arr`); if (cfg.throwOnFirst) return; }
    if (n.$_attrs && Object.keys(n.$_attrs).length) { push(errs, cfg, `${here}: _hson_ii must not have $_attrs`); if (cfg.throwOnFirst) return; }
    const idx = n.$_meta?.[`${_META_DATA_PREFIX}index`] ?? n.$_meta?.[_DATA_INDEX];
    if (typeof idx !== "string") { push(errs, cfg, `${here}: _hson_ii must carry "${_META_DATA_PREFIX}index" as a string in $_meta`); if (cfg.throwOnFirst) return; }

    const cc = n.$_content;
    if (cc.length !== 1) { push(errs, cfg, `${here}: _hson_ii must contain exactly one child node`); if (cfg.throwOnFirst) return; }
    const only = cc[0];
    if (!is_Node(only)) { push(errs, cfg, `${here}: _hson_ii child must be a node (found primitive/null)`); if (cfg.throwOnFirst) return; }
  }

  if (n.$_tag === ARR_TAG) {
    const kids = n.$_content;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      const childPath = `${path}/_hson_arr/[${i}]`;

      if (!is_Node(k)) { push(errs, cfg, `${childPath}: primitive/null outside _hson_str/_hson_val`); if (cfg.throwOnFirst) return; continue; }
      if (k.$_tag !== II_TAG) { push(errs, cfg, `${childPath}: only _hson_ii allowed directly under _hson_arr`); if (cfg.throwOnFirst) return; }

      walk(k, childPath, ARR_TAG, cfg, errs);
      if (cfg.throwOnFirst && errs.length) return;
    }
    return;
  }

  if (n.$_tag === ELEM_TAG) {
    const kids = n.$_content;

    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      const childPath = `${path}/_hson_elem/[${i}]`;

      if (!is_Node(k)) {
        push(errs, cfg, `${childPath}: primitive/null outside _hson_str`);
        if (cfg.throwOnFirst) return;
        continue;
      }

      if (k.$_tag === VAL_TAG) {
        push(errs, cfg, `${childPath}: _hson_elem cannot contain _hson_val; quote scalar text as _hson_str instead`);
        if (cfg.throwOnFirst) return;
        continue;
      }

      if (k.$_tag === OBJ_TAG || k.$_tag === ARR_TAG || k.$_tag === II_TAG) {
        push(errs, cfg, `${childPath}: _hson_elem cannot contain ${k.$_tag} (only _hson_str or normal element tags allowed)`);
        if (cfg.throwOnFirst) return;
        continue;
      }

      walk(k, childPath, ELEM_TAG, cfg, errs);
      if (cfg.throwOnFirst && errs.length) return;
    }

    return;
  }

  if (n.$_tag === ROOT_TAG) {
    const kids = n.$_content;
    if (kids.length > 1) { push(errs, cfg, `${here}: _hson_root must contain at most one child`); if (cfg.throwOnFirst) return; }
    if (kids.length === 1) {
      const only = kids[0] as HsonNode | Primitive;
      if (!is_Node(only)) {
        push(errs, cfg, `${here}: _hson_root child must be a node; found: primitive (${only})`); if (cfg.throwOnFirst) return;
      } else if (!(only.$_tag === OBJ_TAG || only.$_tag === ELEM_TAG || only.$_tag === ARR_TAG)) {
        push(errs, cfg, `${here}: _hson_root child must be one of _hson_obj/_hson_elem/_hson_arr`); if (cfg.throwOnFirst) return;
      }
    }
  }

  if (n.$_tag === OBJ_TAG) {
    const kids = n.$_content;
    const seen = new Set<string>();

    for (let i = 0; i < kids.length; i++) {
      const p = kids[i];
      const pHere = `${here}/[${i}]`;

      if (!is_Node(p)) {
        push(errs, cfg, `${pHere}: [ERR: OBJ001] primitive/null outside _hson_str/_hson_val`);
        if (cfg.throwOnFirst) return;
        continue;
      }

      if (p.$_attrs && Object.keys(p.$_attrs).length) {
        push(errs, cfg, `${pHere}: [ERR: OBJ002] _hson_obj children must not have $_attrs`);
        if (cfg.throwOnFirst) return;
      }

      if (p.$_tag === ELEM_TAG) {
        push(errs, cfg, `${pHere}: [ERR: OBJ004] _hson_elem is not allowed directly under _hson_obj`);
        if (cfg.throwOnFirst) return;
      }

      if (!p.$_tag.startsWith(HSON_SYS_PREFIX)) {
        if (seen.has(p.$_tag)) {
          push(errs, cfg, `${pHere}: [ERR: OBJ003] duplicate property tag "${p.$_tag}" inside _hson_obj`);
          if (cfg.throwOnFirst) return;
        }
        seen.add(p.$_tag);
      }

      walk(p, pHere, OBJ_TAG, cfg, errs);
      if (cfg.throwOnFirst && errs.length) return;
    }

    return;
  }

  const kids = n.$_content ?? [];
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (is_Node(k)) {
      walk(k, here, n.$_tag, cfg, errs);
      if (cfg.throwOnFirst && errs.length) return;
    } else {
      push(errs, cfg, `${here}/[${i}]: primitive outside _hson_str/_hson_val`);
      if (cfg.throwOnFirst) return;
    }
  }
}

function isVSN(t: string) {
  return t === STR_TAG || t === VAL_TAG || t === ARR_TAG || t === OBJ_TAG || t === ELEM_TAG || t === ROOT_TAG || t === II_TAG;
}

function seg(t: string) {
  return t.startsWith(HSON_SYS_PREFIX) ? `/${t}` : `/tag:${t}`;
}

function push(errs: string[], _cfg: DevCfg, s: string) {
  errs.push(s);
}

export function assertNewShapeQuick(n: any, where: string): void {
  const stack: any[] = [n];

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    const tag = node.$_tag as string | undefined;
    const meta = node.$_meta as HsonMeta | undefined;
    const attrs = node.$_attrs as HsonAttrs | undefined;

    if (meta && ("attrs" in meta || "flags" in meta)) {
      throw new Error(`[NEW-only] old-shaped meta in ${where} at <${tag ?? "?"}>
  Found $_meta.attrs or $_meta.flags`);
    }

    if (meta) {
      for (const k of Object.keys(meta)) {
        if (!k.startsWith(_META_DATA_PREFIX)) {
          throw new Error(`[NEW-only] illegal meta key "${k}" in ${where} at <${tag}> (only "data-_*" allowed)`);
        }
      }
    }

    if (tag && isVSN(tag) && attrs && Object.keys(attrs).length) {
      _throw_transform_err(` VSN <${tag}> with $_attrs :  ${where}`, "assertNewShapeQuick", n);
    }

    const content = node.$_content as unknown[] | undefined;
    if (Array.isArray(content)) {
      if (tag === STR_TAG || tag === VAL_TAG) {
        continue;
      }

      for (const c of content) {
        if (is_Node(c)) {
          stack.push(c);
        }
      }
    }
  }
}
