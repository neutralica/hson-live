// hson-tag-helpers.ts



export function is_bare_hson_key(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key);
}

export function needs_quoted_hson_key(key: string): boolean {
  return !is_bare_hson_key(key);
}

export function quote_hson_key(key: string): string {
  let escaped = "";
  for (const char of key) {
    if (char === "\\") escaped += "\\\\";
    else if (char === "`") escaped += "\\`";
    else if (char === "\b") escaped += "\\b";
    else if (char === "\f") escaped += "\\f";
    else if (char === "\n") escaped += "\\n";
    else if (char === "\r") escaped += "\\r";
    else if (char === "\t") escaped += "\\t";
    else if (char.charCodeAt(0) < 0x20) {
      escaped += `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
    } else escaped += char;
  }

  return `\`${escaped}\``;
}

export function serialize_hson_tag_name(tag: string): string {
  return is_bare_hson_key(tag) ? tag : quote_hson_key(tag);
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
