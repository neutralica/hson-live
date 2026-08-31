// assert-invariants.ts

import {
  ARR_TAG,
  ELEM_TAG,
  EVERY_VSN,
  HSON_SYS_PREFIX,
  II_TAG,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
  HSON_META_QUID,
  HSON_META_INDEX,
  HSON_META_MARKUP_PREFIX,
  HSON_META_TRANSIT_PREFIX,
  _TRANSIT_PREFIX,
} from "./constants.js";
import { validate_hson_node_quid } from "./hson-node-quid.js";
import { _throw_transform_err } from "./errors.js";
import { is_valid_inline_style } from "./inline-style.js";
import { is_Node } from "./node-guards.js";
import { make_string } from "./stringify.js";
import { is_valid_hson_attribute_name } from "./hson-name.js";
import {
  hson_metadata_candidate_key,
  hson_metadata_policy,
  hson_metadata_value_is_valid,
} from "./hson-metadata.js";
import { analyze_hson_array_indexes } from "./hson-array-indexes.js";
import { classify_ordinary_hson_structure } from "./hson-structural-mode.js";
import {
  enumerable_own_data_array_items,
  enumerable_own_data_entries,
  has_inherited_property,
  own_enumerable_data_property,
} from "./node-storage.js";
import type { HsonAttrs, HsonMeta, HsonNode, Primitive } from "./types.js";

type DevCfg = { throwOnFirst?: boolean };
type InvariantIssue = Readonly<{
  message: string;
  code?: string;
  path?: string;
}>;

export function assert_invariants(root: HsonNode, fn = "[source fn not given]", cfg: DevCfg = { throwOnFirst: true }): void {
  const errs: InvariantIssue[] = [];
  assertNewShapeQuick(root, fn);
  walk(root, "", root.$_tag, cfg, errs);
  if (errs.length) {
    const msg = errs.slice(0, 12).map((issue) => issue.message).join("\n  - ");
    const first = errs[0];
    _throw_transform_err(
      `invariant violation(s):\n  - ${msg}`,
      fn,
      make_string(root),
      undefined,
      {
        code: first?.code ?? "HSON_CANONICAL_INVARIANT_VIOLATION",
        stage: "canonical-invariant-admission",
        ...(first?.path === undefined ? {} : { path: first.path }),
      },
    );
  }
}

function walk(n: HsonNode, path: string, parentTag: string | null, cfg: DevCfg, errs: InvariantIssue[]): void {
  const here = path + seg(n.$_tag);

  if (
    Object.hasOwn(n, "$_attrs")
    && is_plain_record(n.$_attrs)
    && Object.keys(n.$_attrs).length === 0
  ) {
    push(
      errs,
      cfg,
      `${here}: empty $_attrs is not canonical; omit the attribute container`,
      { code: "HSON_EMPTY_ATTRIBUTES", path: `${here}/$_attrs` },
    );
    if (cfg.throwOnFirst) return;
  }

  if (
    Object.hasOwn(n, "$_meta")
    && is_plain_record(n.$_meta)
    && Object.keys(n.$_meta).length === 0
  ) {
    push(
      errs,
      cfg,
      `${here}: empty $_meta is not canonical; omit the metadata container`,
      { code: "HSON_EMPTY_METADATA", path: `${here}/$_meta` },
    );
    if (cfg.throwOnFirst) return;
  }

  if (n.$_tag.startsWith(HSON_SYS_PREFIX) && !EVERY_VSN.includes(n.$_tag)) {
    push(errs, cfg, `${here}: unknown VSN-like tag "${n.$_tag}"`); if (cfg.throwOnFirst) return;
  }

  if (n.$_meta) {
    if (Object.hasOwn(n.$_meta, HSON_META_QUID)) {
      try {
        validate_hson_node_quid(n);
      } catch {
        push(errs, cfg, `${here}: quid must be a canonical persisted QUID on an eligible standard tag`); if (cfg.throwOnFirst) return;
      }
    }
    for (const k of Object.keys(n.$_meta as HsonMeta)) {
      const policy = hson_metadata_policy(n.$_tag, k);
      if (!policy.valid) {
        push(
          errs,
          cfg,
          `${here}@meta:${JSON.stringify(k)}: ${policy.reason}`,
        );
        if (cfg.throwOnFirst) return;
      }
      const value = (n.$_meta as Readonly<Record<string, unknown>>)[k];
      if (!hson_metadata_value_is_valid(k, value)) {
        push(errs, cfg, `${here}@meta:${JSON.stringify(k)}: invalid metadata value`); if (cfg.throwOnFirst) return;
      }
    }
  }

  if (isVSN(n.$_tag) && n.$_attrs && Object.keys(n.$_attrs as HsonAttrs).length) {
    push(errs, cfg, `${here}: VSN "${n.$_tag}" must not have $_attrs`); if (cfg.throwOnFirst) return;
  }
  if (!isVSN(n.$_tag) && n.$_attrs) {
    for (const key of Object.keys(n.$_attrs)) {
      const lowerKey = key.toLowerCase();
      const metadataCandidate = hson_metadata_candidate_key(key);
      if (metadataCandidate !== undefined) {
        const policy = hson_metadata_policy(n.$_tag, metadataCandidate);
        push(
          errs,
          cfg,
          policy.valid
            ? `${here}@attrs:${JSON.stringify(key)}: reserved metadata must be stored in $_meta`
            : `${here}@attrs:${JSON.stringify(key)}: ${policy.reason}`,
        );
        if (cfg.throwOnFirst) return;
      }
      if (lowerKey.startsWith(HSON_META_TRANSIT_PREFIX)) {
        push(errs, cfg, `${here}@attrs:${JSON.stringify(key)}: private Hson metadata transit name is forbidden`); if (cfg.throwOnFirst) return;
      }
      if (lowerKey.startsWith(_TRANSIT_PREFIX)) {
        push(errs, cfg, `${here}@attrs:${JSON.stringify(key)}: private ordinary-attribute transit name is forbidden`); if (cfg.throwOnFirst) return;
      }
      if (!is_valid_hson_attribute_name(key)) {
        push(errs, cfg, `${here}@attrs:${JSON.stringify(key)}: invalid Hson attribute name`); if (cfg.throwOnFirst) return;
      }
    }
  }

  if (!isVSN(n.$_tag)) {
    const structure = classify_ordinary_hson_structure(n);
    if (structure.kind === "invalid") {
      push(errs, cfg, `${here}: ${structure.reason}`); if (cfg.throwOnFirst) return;
      return;
    }
    if (structure.kind === "legacy-empty-element-wrapper") {
      push(errs, cfg, `${here}: empty _hson_elem is not valid retained canonical state; use $_content: []`); if (cfg.throwOnFirst) return;
      return;
    }
    if (parentTag === ELEM_TAG && structure.kind !== "empty-element" && structure.kind !== "element") {
      push(errs, cfg, `${here}: element branch requires recursively element-structured ordinary nodes (found ${structure.kind})`); if (cfg.throwOnFirst) return;
      return;
    }
    if (parentTag === OBJ_TAG
      && structure.kind !== "object"
      && structure.kind !== "object-scalar"
      && structure.kind !== "array") {
      push(
        errs,
        cfg,
        `${here}: object property must retain an object scalar, _hson_obj, or _hson_arr relationship (found ${structure.kind})`,
        structure.kind === "element"
          ? { code: "HSON_OBJECT_ELEMENT_STRUCTURAL_CROSSING", path: here }
          : undefined,
      ); if (cfg.throwOnFirst) return;
      return;
    }
    if (parentTag === II_TAG) {
      push(errs, cfg, `${here}: ordinary node must be wrapped by _hson_obj before array membership`); if (cfg.throwOnFirst) return;
      return;
    }
    if (structure.kind === "empty-element") return;
    walk(structure.cluster, here, n.$_tag, cfg, errs);
    return;
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
      if (n.$_tag === VAL_TAG) {
        if (typeof v === "number" && !Number.isFinite(v)) {
          push(errs, cfg, `${here}/$_content[0]: invalid Hson number ${String(v)}; numbers must be finite`); if (cfg.throwOnFirst) return;
        }
        const validPayload = v === null
          || typeof v === "boolean"
          || (typeof v === "number" && Number.isFinite(v));
        if (!validPayload) {
          push(
            errs,
            cfg,
            `${here}/$_content[0]: _hson_val payload must be a finite number, boolean, or null (found ${String(v)})`,
          );
          if (cfg.throwOnFirst) return;
        }
      }
    }
    return;
  }

  if (n.$_tag === II_TAG) {
    if (parentTag !== ARR_TAG) { push(errs, cfg, `${here}: _hson_ii must appear directly under _hson_arr`); if (cfg.throwOnFirst) return; }
    if (n.$_attrs && Object.keys(n.$_attrs).length) { push(errs, cfg, `${here}: _hson_ii must not have $_attrs`); if (cfg.throwOnFirst) return; }

    const cc = n.$_content;
    if (cc.length !== 1) { push(errs, cfg, `${here}: _hson_ii must contain exactly one child node`); if (cfg.throwOnFirst) return; }
    const only = cc[0];
    if (!is_Node(only)) { push(errs, cfg, `${here}: _hson_ii child must be a node (found primitive/null)`); if (cfg.throwOnFirst) return; }
    if (is_Node(only) && !isVSN(only.$_tag)) {
      push(errs, cfg, `${here}: direct ordinary _hson_ii child must be wrapped by _hson_obj`); if (cfg.throwOnFirst) return;
    }
    if (is_Node(only) && only.$_tag === ELEM_TAG) {
      push(errs, cfg, `${here}: _hson_arr cannot contain an element-mode value; arrays cannot cross object/element structural modes`); if (cfg.throwOnFirst) return;
    }
  }

  if (n.$_tag === ARR_TAG) {
    const kids = n.$_content;
    const indexAnalysis = analyze_hson_array_indexes(kids);
    if (!indexAnalysis.valid) {
      push(errs, cfg, `${here}: ${indexAnalysis.reason}`);
      if (cfg.throwOnFirst) return;
    } else if (indexAnalysis.reordered) {
      push(errs, cfg, `${here}: physical _hson_ii order must match canonical index order`);
      if (cfg.throwOnFirst) return;
    }
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

    if (kids.length === 0) {
      push(errs, cfg, `${here}: empty _hson_elem is not valid retained canonical state`);
      return;
    }

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

      if (k.$_tag !== STR_TAG && k.$_tag.startsWith(HSON_SYS_PREFIX)) {
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
    if (kids.length === 0) return;
    if (kids.length === 1 && is_Node(kids[0]) && (
      kids[0].$_tag === OBJ_TAG
      || kids[0].$_tag === ELEM_TAG
      || kids[0].$_tag === ARR_TAG
      || kids[0].$_tag === STR_TAG
      || kids[0].$_tag === VAL_TAG
    )) {
      walk(kids[0], `${path}/_hson_root/[0]`, ROOT_TAG, cfg, errs);
      return;
    }
    for (let index = 0; index < kids.length; index += 1) {
      const child = kids[index];
      const childPath = `${path}/_hson_root/[${index}]`;
      if (!is_Node(child)) {
        push(errs, cfg, `${childPath}: primitive/null outside _hson_str`);
        if (cfg.throwOnFirst) return;
        continue;
      }
      if (child.$_tag !== STR_TAG && child.$_tag.startsWith(HSON_SYS_PREFIX)) {
        push(errs, cfg, `${childPath}: document root content must be _hson_str or an ordinary element`);
        if (cfg.throwOnFirst) return;
        continue;
      }
      walk(child, childPath, ELEM_TAG, cfg, errs);
      if (cfg.throwOnFirst && errs.length) return;
    }
    return;
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
        push(
          errs,
          cfg,
          `${pHere}: [ERR: OBJ004] _hson_elem is not allowed directly under _hson_obj`,
          { code: "OBJ004", path: pHere },
        );
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

function push(
  errs: InvariantIssue[],
  _cfg: DevCfg,
  s: string,
  details?: Readonly<{ code?: string; path?: string }>,
) {
  errs.push({ message: s, ...details });
}

function is_plain_record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertNewShapeQuick(n: unknown, where: string): void {
  type Frame =
    | { kind: "enter"; value: unknown; path: string }
    | { kind: "leave"; value: object };
  const stack: Frame[] = [{ kind: "enter", value: n, path: "" }];
  const active = new WeakMap<object, string>();
  const complete = new WeakSet<object>();

  while (stack.length) {
    const frame = stack.pop();
    if (!frame) break;
    if (frame.kind === "leave") {
      active.delete(frame.value);
      complete.add(frame.value);
      continue;
    }

    const node = frame.value;
    if (!is_plain_record(node)) {
      throw new Error(`[NEW-only] node must be a plain object in ${where} at ${frame.path || "/"}`);
    }

    const tagProperty = own_enumerable_data_property(node, "$_tag");
    if (tagProperty === undefined || !tagProperty.present || typeof tagProperty.value !== "string") {
      throw new Error(`[NEW-only] node has invalid $_tag in ${where}`);
    }
    const tag = tagProperty.value;

    const contentProperty = own_enumerable_data_property(node, "$_content");
    if (contentProperty === undefined || !contentProperty.present || !Array.isArray(contentProperty.value)) {
      throw new Error(`[NEW-only] node <${tag}> must carry an array $_content in ${where}`);
    }
    const content = contentProperty.value;
    const contentItems = enumerable_own_data_array_items(content);
    if (contentItems === undefined) {
      throw new Error(`[NEW-only] node <${tag}> must carry dense enumerable own data items in $_content in ${where}`);
    }
    const here = `${frame.path}/${tag}`;
    const origin = active.get(node);
    if (origin !== undefined) {
      throw new Error(`[NEW-only] cycle detected in ${where} at ${here} (reference returns to ${origin})`);
    }
    if (complete.has(node)) continue;
    active.set(node, here);
    stack.push({ kind: "leave", value: node });

    const metaProperty = own_enumerable_data_property(node, "$_meta");
    const attrsProperty = own_enumerable_data_property(node, "$_attrs");
    if (metaProperty === undefined) {
      throw new Error(`[NEW-only] $_meta must be an enumerable own data property when present in ${where} at <${tag}>`);
    }
    if (attrsProperty === undefined) {
      throw new Error(`[NEW-only] $_attrs must be an enumerable own data property when present in ${where} at <${tag}>`);
    }
    const hasMeta = metaProperty.present;
    const hasAttrs = attrsProperty.present;
    const metaValue = metaProperty.present ? metaProperty.value : undefined;
    const attrsValue = attrsProperty.present ? attrsProperty.value : undefined;

    if (hasMeta && !is_plain_record(metaValue)) {
      throw new Error(`[NEW-only] $_meta must be a plain object when present in ${where} at <${tag}>`);
    }
    if (hasAttrs && !is_plain_record(attrsValue)) {
      throw new Error(`[NEW-only] $_attrs must be a plain object when present in ${where} at <${tag}>`);
    }

    const meta = is_plain_record(metaValue) ? metaValue : undefined;
    const attrs = is_plain_record(attrsValue) ? attrsValue : undefined;
    const metaEntries = meta === undefined ? [] : enumerable_own_data_entries(meta);
    const attrsEntries = attrs === undefined ? [] : enumerable_own_data_entries(attrs);

    if (metaEntries === undefined) {
      throw new Error(`[NEW-only] $_meta entries must be enumerable own data properties in ${where} at <${tag}>`);
    }
    if (attrsEntries === undefined) {
      throw new Error(`[NEW-only] $_attrs entries must be enumerable own data properties in ${where} at <${tag}>`);
    }
    if (meta && (
      has_inherited_property(meta, HSON_META_QUID)
      || has_inherited_property(meta, HSON_META_INDEX)
    )) {
      throw new Error(`[NEW-only] $_meta must not inherit canonical metadata fields in ${where} at <${tag}>`);
    }

    if (metaEntries.some(([key]) => key === "attrs" || key === "flags")) {
      throw new Error(`[NEW-only] old-shaped meta in ${where} at <${tag ?? "?"}>
  Found $_meta.attrs or $_meta.flags`);
    }

    if (typeof tag === "string") {
      for (const [key, value] of metaEntries) {
        const policy = hson_metadata_policy(tag, key);
        if (policy.valid && !policy.definition.validateValue(value)) {
          throw new Error(`[NEW-only] invalid metadata value for "${key}" in ${where} at <${tag}>`);
        }
      }
    }

    for (const [key, value] of attrsEntries) {
      const validPrimitive = value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
      const validStyle = key === "style" && is_valid_inline_style(value);
      if (!validPrimitive && !validStyle) {
        throw new Error(`[NEW-only] malformed attribute value for "${key}" in ${where} at <${tag}>`);
      }
    }

    if (tag && isVSN(tag) && attrsEntries.length) {
      _throw_transform_err(` VSN <${tag}> with $_attrs :  ${where}`, "assertNewShapeQuick");
    }

    if (tag === STR_TAG || tag === VAL_TAG) continue;

    for (let index = contentItems.length - 1; index >= 0; index--) {
      const child = contentItems[index];
      if (typeof child === "object" && child !== null) {
        stack.push({ kind: "enter", value: child, path: `${here}/$_content[${index}]` });
      }
    }
  }
}
