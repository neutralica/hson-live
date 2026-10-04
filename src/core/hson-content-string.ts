/** Decode source layout before JSON escapes. The scanner validates escape/control syntax. */
export function decode_hson_content_string(interior: string): string {
  let source = interior.replace(/\r\n|\r/g, "\n");
  if (source.startsWith("\n")) {
    source = source.slice(1);
    const closingLine = source.lastIndexOf("\n") + 1;
    if (/^[ \t]*$/.test(source.slice(closingLine))) {
      source = source.slice(0, closingLine === 0 ? 0 : closingLine - 1);
    }
    const lines = source.split("\n");
    let margin: string | undefined;
    for (const line of lines) {
      if (/^[ \t]*$/.test(line)) continue;
      const prefix = /^[ \t]*/.exec(line)![0];
      if (margin === undefined) margin = prefix;
      else {
        let length = 0;
        while (length < margin.length && length < prefix.length && margin[length] === prefix[length]) length += 1;
        margin = margin.slice(0, length);
      }
    }
    const common = margin ?? "";
    source = lines.map(line => {
      let length = 0;
      while (length < common.length && line[length] === common[length]) length += 1;
      return line.slice(length);
    }).join("\n");
  }
  // Physical tabs and LF are legal source characters, but token lowering stays
  // JSON compatible. Escaped backslashes/newlines remain distinct throughout.
  return JSON.parse('"' + source.replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"') as string;
}

/** Readable formatted strings and compact JSON escapes share one exact value. */
export function serialize_hson_content_string(value: string, depth: number, compact: boolean): string {
  if (compact || !value.includes("\n")) return JSON.stringify(value);
  const encoded = value.split("\n").map(line => {
    const escaped = JSON.stringify(line).slice(1, -1);
    // Escape semantic leading spaces so the source margin cannot consume them.
    return escaped.replace(/^ +/, spaces => "\\u0020".repeat(spaces.length));
  });
  const pad = "  ".repeat(depth + 1);
  const prefix = encoded.some(line => line !== "") ? pad : "";
  return '"\n' + encoded.map(line => prefix + line).join("\n") + '\n' + "  ".repeat(depth) + '"';
}
