// encode-html-tag.ts

import { EVERY_VSN, HTML_KEY_PREFIX } from "../../../../core/constants.js";




export function is_html_safe_tag_name(tag: string): boolean {
  return /^[_a-z][a-z0-9_-]*$/.test(tag);
}

export function needs_encoded_html_key(tag: string): boolean {
  return !is_html_safe_tag_name(tag) || tag.startsWith(HTML_KEY_PREFIX);
}

export function encode_html_key_tag(tag: string): string {
  if (EVERY_VSN.includes(tag)) return tag;

  if (!needs_encoded_html_key(tag)) return tag;

  let out = HTML_KEY_PREFIX;

  for (const ch of tag) {
    const cp = ch.codePointAt(0);

    if (cp === undefined) continue;

    const safe = /^[a-z0-9-]$/.test(ch);

    if (safe) {
      out += ch;
      continue;
    }

    out += `_x${cp.toString(16).toLowerCase()}-`;
  }

  return out;
}

export function decode_html_key_tag(tag: string): string {
  if (!tag.startsWith(HTML_KEY_PREFIX)) return tag;

  const body = tag.slice(HTML_KEY_PREFIX.length);

  return body.replace(/_x([0-9A-Fa-f]+)-/g, (_m, hex: string) => {
    return String.fromCodePoint(Number.parseInt(hex, 16));
  });
}