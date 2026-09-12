// hson-tag-helpers.ts

import { is_bare_hson_name, quote_hson_name, serialize_hson_name } from "../../../../core/hson-name.js";

export const is_bare_hson_key = is_bare_hson_name;

export function needs_quoted_hson_key(key: string): boolean {
  return !is_bare_hson_key(key);
}

export function quote_hson_key(key: string): string {
  return quote_hson_name(key);
}

export function serialize_hson_tag_name(tag: string): string {
  return serialize_hson_name(tag);
}

export function unquote_hson_key(src: string): string {
  if (!src.startsWith("'") || !src.endsWith("'")) {
    return src;
  }

  const inner = src.slice(1, -1);
  let out = "";
  let escaped = false;

  for (const ch of inner) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    out += ch;
  }

  if (escaped) out += "\\";

  return out;
}
