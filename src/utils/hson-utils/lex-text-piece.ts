// lex-text-piece.ts


export function lex_text_piece(s: string): { text: string; quoted: boolean } {
  // unchanged: normalize outer whitespace
  const t = s.trim();
  if (!t) return { text: "", quoted: false };

  // CHANGED: only accept JSON-style double quotes for quoted literals
  const q = t[0];
  if (q === "'" && t[t.length - 1] === "'") {
    const inner = t.slice(1, -1);
    return { text: JSON.stringify(inner), quoted: true }; // normalized JSON literal
  }
  const isDq = q === '"' && t.length >= 2 && t[t.length - 1] === '"';
  if (!isDq) return { text: t, quoted: false };
  return { text: t, quoted: true };
}