

export function is_bare_hson_key(key: string): boolean {
  return /^[A-Za-z_:][A-Za-z0-9:._-]*$/.test(key);
}

export function needs_quoted_hson_key(key: string): boolean {
  return !is_bare_hson_key(key);
}

export function quote_hson_key(key: string): string {
  const escaped = key
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`");

  return `\`${escaped}\``;
}



export function serialize_hson_tag_name(tag: string): string {

  if (is_bare_hson_key(tag)) return tag;

  return "`" + tag

    .replaceAll("\\", "\\\\")

    .replaceAll("`", "\\`") + "`";

}

export function unquote_hson_key(src: string): string {
  if (!src.startsWith("`") || !src.endsWith("`")) {
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

