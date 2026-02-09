// dedupe-attrs.ts

/***********************************************
 * dedupe_attrs_html
 *
 * Normalize and de-duplicate HTML attributes in
 * a serialized HTML string.
 *
 * Behavior:
 * - Walks every start/self-closing tag:
 *     <tag ...attrs...> or <tag ...attrs... />
 * - For each tag:
 *   - Lowercases attribute names for comparison.
 *   - Keeps only the *last* non-class value for
 *     each attribute (e.g. `id="x" id="y"` → id="y").
 *   - Treats flag-like attributes (no value or
 *     value equal to the name) as boolean flags
 *     and normalizes them to key="key".
 *   - Special-cases `class`:
 *       - Splits into tokens.
 *       - Deduplicates token list.
 *       - Rejoins as a single space-separated
 *         `class="a b c"` string.
 * - Rebuilds attributes in order of first
 *   appearance per tag.
 * - Always quotes attribute values on output.
 *
 * Notes:
 * - This operates on raw HTML source, not on
 *   the DOM.
 * - Self-closing vs non-self-closing is
 *   preserved based on the original closing
 *   slash in the match.
 *
 * @param src  Serialized HTML markup to normalize.
 * @returns    A new HTML string with attributes
 *             deduplicated and normalized as above.
 ***********************************************/
export function dedupe_attrs_html(src: string): string {
  return src.replace(
    /<([a-zA-Z][^\s>/]*)([^>]*?)(\s*\/?)>/g,
    (_m: string, tag: string, attrs: string, self: string) => {
      //
      type Seen = {
        val?: string;
        isFlag: boolean;
        // for class
        classTokens?: string[];
      };
      const seen = new Map<string, Seen>();
      const order: string[] = [];

      let i = 0;
      while (i < attrs.length) {
        // whitespace passthrough
        const ws = /^\s+/.exec(attrs.slice(i));
        if (ws) { i += ws[0].length; continue; }

        // name
        const nm = /^[^\s"'=\/><]+/.exec(attrs.slice(i));
        if (!nm) { i++; continue; }
        const nameRaw = nm[0];
        const nameKey = nameRaw.toLowerCase();
        i += nameRaw.length;

        // maybe '='
        const eq = /^\s*=\s*/.exec(attrs.slice(i));
        let value: string | undefined;
        let quoted: '"' | "'" | null = null;

        if (eq) {
          i += eq[0].length;
          const q = attrs[i];
          if (q === '"' || q === "'") {
            quoted = q as '"' | "'";
            i++;
            const end = attrs.indexOf(q, i);
            value = (end === -1) ? attrs.slice(i) : attrs.slice(i, end);
            i = (end === -1) ? attrs.length : end + 1;
          } else {
            const v = /^[^\s>]+/.exec(attrs.slice(i));
            value = v ? v[0] : '';
            i += value.length;
          }
        }

        // classify flag vs value
        const isFlagLike =
          value === undefined || value === '' || value.toLowerCase() === nameKey;

        // init record
        if (!seen.has(nameKey)) {
          seen.set(nameKey, { isFlag: false });
          order.push(nameKey);
        }
        const rec = seen.get(nameKey)!;

        if (nameKey === 'class') {
          // collect tokens
          const tokens = (value ?? nameKey) // flag-like class → "class"
            .split(/\s+/).filter(Boolean);
          if (!rec.classTokens) rec.classTokens = [];
          for (const t of tokens) {
            if (!rec.classTokens.includes(t)) rec.classTokens.push(t);
          }
          // class never “flag-true”; treat as valued
          rec.val = rec.classTokens.join(' ');
        } else {
          if (isFlagLike) {
            rec.isFlag = true;
            rec.val = nameKey; // canonical
          } else {
            // keep LAST non-flag value
            rec.val = value!;
          }
        }
      }

      // rebuild attrs in original name order (by first appearance)
      let out = '';
      for (const k of order) {
        const rec = seen.get(k)!;
        // class empty → drop
        if (k === 'class' && (!rec.val || !rec.val.trim())) continue;
        const esc_attr = (x: string) =>
          x
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/"/g, "&quot;");
        const v = rec.val ?? k;
        // always quote on output
        out += ` ${k}="${esc_attr(v)}"`;
      }
      const end = self && self.includes('/') ? ' />' : '>';
      return `<${tag}${out}${end}`;
    }
  );
}