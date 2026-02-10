

type Range = { start: number; end: number };

type ListFrame = { name: "ul" | "ol"; liOpen: boolean };

type TableFrame = { trOpen: boolean; cellOpen: "td" | "th" | null };

function ranges_from_matches(src: string, re: RegExp): Range[] {
  const out: Range[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function in_ranges(sorted: Range[], i: number): boolean {
  // Linear is fine for test inputs, but we can do cheap binary without drama.
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = sorted[mid]!;
    if (i < r.start) hi = mid - 1;
    else if (i >= r.end) lo = mid + 1;
    else return true;
  }
  return false;
}

function is_vsn(nameLower: string): boolean {
  return nameLower.startsWith("_");
}

function is_void(nameLower: string): boolean {
  // NOTE: keep in sync with expand_void_tags
  return /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(nameLower);
}

function starts_block_that_autocloses_p(nameLower: string): boolean {
  // HTML auto-closes <p> when a block element starts (non-exhaustive but solid).
  return /^(address|article|aside|blockquote|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|main|nav|ol|pre|section|table|ul)$/i.test(
    nameLower
  );
}

/**
 * Preflight-normalize *minimal* HTML optional-end-tag behavior so XML parsing won't choke.
 * Scope (intentional):
 * - Lists: <ul>/<ol>/<li> (insert </li> where HTML would imply it)
 * - Paragraphs: <p> (insert </p> where HTML would imply it)
 *
 * Explicit non-goals:
 * - No table/DL heuristics, no “best effort” structural repairs beyond li/p.
 */
export function optional_endtag_preflight(src: string): string {
  // Fast exit: nothing tag-like
  if (!src.includes("<")) return src;

  // Protect raw-text blocks, comments, CDATA (treat as opaque)
  const RAW = /<(script|style|textarea|noscript|xmp|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  const COMM = /<!--[\s\S]*?-->/g;
  const CDATA = /<!\[CDATA\[[\s\S]*?\]\]>/g;

  const holes: Range[] = [
    ...ranges_from_matches(src, RAW),
    ...ranges_from_matches(src, COMM),
    ...ranges_from_matches(src, CDATA),
  ].sort((a, b) => a.start - b.start);

  const inserts: Array<{ at: number; text: string }> = [];

  const openList: ListFrame[] = [];
  let pOpen = false;
  const openTable: TableFrame[] = [];
  const topTable = () => openTable[openTable.length - 1];

  const closeCell = (at: number, t: TableFrame) => {
    if (t.cellOpen) {
      inserts.push({ at, text: `</${t.cellOpen}>` });
      t.cellOpen = null;
    }
  };
  const closeRow = (at: number, t: TableFrame) => {
    if (t.trOpen) {
      inserts.push({ at, text: "</tr>" });
      t.trOpen = false;
    }
  };

  const closeRowImplicit = (at: number, t: TableFrame) => {
    let txt = "";
    if (t.cellOpen) { txt += `</${t.cellOpen}>`; t.cellOpen = null; }
    if (t.trOpen) { txt += "</tr>"; t.trOpen = false; }
    if (txt) inserts.push({ at, text: txt });
  };
  // Cheap tag walker (NOT a parser; keep scope small)
  const TAG = /<\s*(\/)?\s*([a-zA-Z_:][-a-zA-Z0-9_:.]*)\b[^>]*?(\/?)\s*>/g;

  let m: RegExpExecArray | null;
  while ((m = TAG.exec(src))) {
    const iTag = m.index;
    if (in_ranges(holes, iTag)) continue;

    const isClose = !!m[1];
    const rawName = m[2]!;
    const selfClose = !!m[3];

    const name = rawName.toLowerCase();

    // Skip HSON-internal tags
    if (is_vsn(name)) continue;

    // Skip void and explicit self-close on open tags
    if (!isClose && (selfClose || is_void(name))) {
      // voids don't affect li/p “open” state in this preflight
      continue;
    }

    // --- P behavior (very small model) ---
    if (!isClose && name === "p") {
      // If a <p> starts while one is open, HTML auto-closes the previous.
      if (pOpen) inserts.push({ at: iTag, text: "</p>" });
      pOpen = true;
      continue;
    }

    if (!isClose && name === "table") {
      openTable.push({ trOpen: false, cellOpen: null });
      continue;
    }

    if (!isClose && (name === "thead" || name === "tbody" || name === "tfoot")) {
      const t = topTable();
      if (t) { closeCell(iTag, t); closeRow(iTag, t); }
      continue;
    }

    if (!isClose && name === "tr") {
      const t = topTable();
      if (t) { closeCell(iTag, t); closeRowImplicit(iTag, t); t.trOpen = true; }
      continue;
    }

    if (!isClose && (name === "td" || name === "th")) {
      const t = topTable();
      if (t) {
        if (t.cellOpen) inserts.push({ at: iTag, text: `</${t.cellOpen}>` });
        t.cellOpen = name as "td" | "th";
      }
      continue;
    }

    if (isClose && (name === "td" || name === "th")) {
      const t = topTable();
      if (t) t.cellOpen = null;
      continue;
    }

    if (isClose && name === "tr") {
      const t = topTable();
      if (t) { closeCell(iTag, t); t.trOpen = false; }
      continue;
    }

    // on </table> or section close (implicit row close)
    if (isClose && (name === "table" || name === "thead" || name === "tbody" || name === "tfoot")) {
      const t = topTable();
      if (t) closeRowImplicit(iTag, t);
      if (name === "table") openTable.pop();
      continue;
    }

    if (!isClose && pOpen && starts_block_that_autocloses_p(name)) {
      // Block element starts: HTML auto-closes <p> before it.
      inserts.push({ at: iTag, text: "</p>" });
      pOpen = false;
      // fallthrough: block tag still processed for list logic below
    }

    if (isClose && name === "p") {
      // Explicit close clears state (even if malformed nesting, this is “preflight”)
      pOpen = false;
      continue;
    }

    // --- Lists ---
    if (!isClose && (name === "ul" || name === "ol")) {
      openList.push({ name: name as "ul" | "ol", liOpen: false });
      continue;
    }

    if (!isClose && name === "li") {
      const last = openList[openList.length - 1];
      if (last) {
        if (last.liOpen) inserts.push({ at: iTag, text: "</li>" });
        last.liOpen = true;
      }
      continue;
    }

    if (isClose && name === "li") {
      const last = openList[openList.length - 1];
      if (last) last.liOpen = false;
      continue;
    }

    if (isClose && (name === "ul" || name === "ol")) {
      const last = openList[openList.length - 1];
      if (last && last.liOpen) {
        inserts.push({ at: iTag, text: "</li>" });
        last.liOpen = false;
      }
      // Pop one level if it matches; tolerate malformed nesting by searching back.
      if (last && last.name === name) {
        openList.pop();
      } else {
        for (let i = openList.length - 2; i >= 0; i--) {
          if (openList[i]!.name === name) {
            openList.length = i;
            break;
          }
        }
        openList.pop();
      }
      continue;
    }
  }

  if (!inserts.length) return src;

  // Apply right-to-left
  inserts.sort((a, b) => b.at - a.at);

  let out = src;
  for (const ins of inserts) {
    if (in_ranges(holes, ins.at)) continue;
    out = out.slice(0, ins.at) + ins.text + out.slice(ins.at);
  }

  return out;
}