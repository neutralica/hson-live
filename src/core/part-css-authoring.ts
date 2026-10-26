import { assert_part_public_path, assert_part_object_access } from "./part-css-access.js";
import { is_ordered_projected_value } from './ordered-projected-value.js';
import { css_data_entries, normalize_css_map } from './css-map.js';

/** Prepare declaration operations first, then detach the complete contribution.
 * Deletion against this initially empty definition leaves no stored declaration.
 * Retain authored spellings/values; no deletion markers enter portable Part data. */
function capture_css_authoring(input: unknown): unknown {
  normalize_css_map(input);
  const active = new WeakSet<object>();
  const copy = (value: unknown, depth: number): unknown => {
    if (typeof value !== 'object' || value === null) return value;
    if (depth > 64 || active.has(value)) throw new TypeError('Invalid or cyclic CSS authoring data.');
    active.add(value);
    try {
      const output: Record<string, unknown> = Object.create(null);
      for (const [key, item] of css_data_entries(value)) if (item !== undefined) output[key] = copy(item, depth + 1);
      return output;
    } finally { active.delete(value); }
  };
  return copy(input, 0);
}

/** Only call with an authenticated Parts-library path; ordinary data is unchanged. */
export function normalize_part_css_authoring(input: unknown, path: readonly (string | number)[] = []): unknown {
  if (is_ordered_projected_value(input)) return input;
  assert_part_public_path(path);
  if (path.length > 1) return input;
  const output: Record<string, unknown> = Object.create(null);
  const fields = css_data_entries(input);
  if (path.length === 1 && fields.some(([key]) => key === "css" || key === "stylesheet")
    && !(fields.some(([key]) => key === "kind") && fields.some(([key]) => key === "document"))) {
    throw new TypeError("Part CSS writes require a complete definition.");
  }
  for (const [key, value] of fields) {
    if (path.length === 0) output[key] = normalize_part_css_authoring(value, [key]);
    else if (key !== 'css') output[key] = value;
    else if (value !== undefined) output[key] = capture_css_authoring(value);
  }
  return output;
}

/** Qualify object commands before generic JSON admission, only for authenticated Parts. */
export function part_object_arguments(path: readonly (string | number)[], method: string, input: readonly unknown[]): readonly unknown[] {
  assert_part_object_access(path, method, input);
  const args = [...input];
  if (method === "setKey" && typeof args[0] === "string") args[1] = normalize_part_css_authoring(args[1], [...path, args[0]]);
  if (method === "setMany") args[0] = normalize_part_css_authoring(args[0], path);
  return args;
}

export function part_object_boundary<T extends object>(api: T, path: readonly (string | number)[]): T {
  return new Proxy(api, { get(target, key, receiver) {
    const value: unknown = Reflect.get(target, key, receiver);
    return typeof value === "function" ? (...args: unknown[]) =>
      Reflect.apply(value, target, part_object_arguments(path, String(key), args)) : value;
  } });
}
