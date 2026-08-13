import { decode_public_attrs } from "./public-attrs.js";
import type {
  CanonicalPublicAttrs,
  CanonicalPublicAttrValue,
} from "./types.js";

function canonical_attrs(
  values: Readonly<Record<string, CanonicalPublicAttrValue>>,
): CanonicalPublicAttrs {
  const attrs = decode_public_attrs(values);
  if (attrs === undefined) {
    throw new Error("Canonical public-attribute transition produced an invalid attribute bag.");
  }
  return attrs;
}

/** Return whether one canonical attribute is in same-name flag form. */
export function canonical_attr_is_flag(
  attrs: CanonicalPublicAttrs,
  name: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(attrs, name) && attrs[name] === name;
}

/** Plan one complete canonical bag after setting one attribute. */
export function plan_public_attr_set(
  current: CanonicalPublicAttrs,
  name: string,
  value: CanonicalPublicAttrValue,
): CanonicalPublicAttrs {
  return canonical_attrs({ ...current, [name]: value });
}

/** Plan one complete canonical bag after an attribute PATCH/overlay. */
export function plan_public_attrs_set_many(
  current: CanonicalPublicAttrs,
  values: CanonicalPublicAttrs,
): CanonicalPublicAttrs {
  return canonical_attrs({ ...current, ...values });
}

/** Plan one complete canonical bag after removing one attribute. */
export function plan_public_attr_drop(
  current: CanonicalPublicAttrs,
  name: string,
): CanonicalPublicAttrs {
  const next: Record<string, CanonicalPublicAttrValue> = { ...current };
  delete next[name];
  return canonical_attrs(next);
}

/** Plan one complete canonical bag after removing several attributes. */
export function plan_public_attrs_drop_many(
  current: CanonicalPublicAttrs,
  names: readonly string[],
): CanonicalPublicAttrs {
  const next: Record<string, CanonicalPublicAttrValue> = { ...current };
  for (const name of names) delete next[name];
  return canonical_attrs(next);
}

/** Plan an exact complete-bag replacement. */
export function plan_public_attrs_replace(
  values: CanonicalPublicAttrs,
): CanonicalPublicAttrs {
  return canonical_attrs(values);
}

/** Plan a complete empty attribute bag. */
export function plan_public_attrs_clear(): CanonicalPublicAttrs {
  return canonical_attrs({});
}

/** Plan one atomic semantic flag-set transition. */
export function plan_public_flags_set(
  current: CanonicalPublicAttrs,
  names: readonly string[],
): CanonicalPublicAttrs {
  const next: Record<string, CanonicalPublicAttrValue> = { ...current };
  for (const name of names) next[name] = name;
  return canonical_attrs(next);
}

/** Plan one atomic semantic flag-clear transition. */
export function plan_public_flags_clear(
  current: CanonicalPublicAttrs,
  names: readonly string[],
): CanonicalPublicAttrs {
  const next: Record<string, CanonicalPublicAttrValue> = { ...current };
  for (const name of names) {
    if (canonical_attr_is_flag(current, name)) delete next[name];
  }
  return canonical_attrs(next);
}
