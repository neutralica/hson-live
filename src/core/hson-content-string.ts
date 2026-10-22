/** Decode source layout before JSON escapes. The scanner validates escape/control syntax.
 * Boundaries mark zero-width content in the scanner's LF-normalized raw interior.
 */
export function decode_hson_content_string(interior: string, boundaries: readonly number[] = []): string {
  let source = interior.replace(/\r\n|\r/g, "\n");
  if (source.startsWith("\n") && boundaries[0] !== 0) {
    // A slot is content even when its value is empty. It stops framing and
    // indentation just as nonempty content does, without contributing a glyph.
    const closingLine = source.lastIndexOf("\n") + 1;
    const end = /^[ \t]*$/.test(source.slice(closingLine)) && !boundaries.some(offset => offset >= closingLine)
      ? Math.max(1, closingLine - 1) : source.length;
    const lines = source.slice(1, end).split("\n");
    let margin: string | undefined;
    let offset = 1;
    let boundary = 0;
    for (const line of lines) {
      while (boundary < boundaries.length && boundaries[boundary]! < offset) boundary++;
      const first = boundaries[boundary];
      const slot = first !== undefined && first <= offset + line.length ? first - offset : undefined;
      offset += line.length + 1;
      if (/^[ \t]*$/.test(line) && slot === undefined) continue;
      const prefix = /^[ \t]*/.exec(line)![0].slice(0, slot);
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
