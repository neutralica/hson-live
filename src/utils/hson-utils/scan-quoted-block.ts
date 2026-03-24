// tokenize-full-string.ts

import { Position } from "../../types/token.types.js";
import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";


type QuoteDelim = '"' | "'" | '`';

/**
 * Check whether a character is a supported quote delimiter.
 *
 * @param ch - Single character to test.
 * @returns True when `ch` is `"`, `'`, or `` ` ``.
 */
export function is_quote(ch: string): ch is QuoteDelim {
  return ch === '"';
}

export function scan_quoted_block(
  lines: string[],
  lineIdx: number,
  colIdx: number
): { raw: string; endLine: number; endCol: number; delim: QuoteDelim } {
  const line = lines[lineIdx] ?? "";
  const opener = line[colIdx];

  // CHANGED: only support double-quoted blocks
  if (opener !== '"') {
    _throw_transform_err(
      `scan_quoted_block: unsupported quote delimiter (use " only) at ${lineIdx + 1}:${colIdx + 1}`,
      "tokenize_hson.scan_quoted_block"
    );
  }

  const delim: QuoteDelim = '"';

  let i = lineIdx;
  let j = colIdx + 1;

  // CHANGED: full-literal contract; include opening quote
  let raw = '"';

  // CHANGED: track whether the previous char was a backslash in source
  let escaped = false;

  while (i < lines.length) {
    const cur = lines[i] ?? "";

    while (j < cur.length) {
      const ch = cur[j];

      if (escaped) {
        // CHANGED: preserve authored escape exactly as a JSON-style escape pair
        raw += "\\" + ch;
        escaped = false;
        j++;
        continue;
      }

      if (ch === "\\") {
        // CHANGED: defer emission until we know the escaped char
        escaped = true;
        j++;
        continue;
      }

      if (ch === delim) {
        // CHANGED: close the normalized literal
        raw += '"';
        return { raw, endLine: i, endCol: j + 1, delim };
      }

      // CHANGED: normalize control chars/newlines into JSON-safe escapes
      if (ch === "\t") {
        raw += "\\t";
        j++;
        continue;
      }

      if (ch === "\r") {
        raw += "\\r";
        j++;
        continue;
      }

      // CHANGED: a bare double quote should only terminate; reaching here means just emit content
      raw += ch;
      j++;
    }

    // CHANGED: if the source line ends with a dangling backslash, preserve it literally
    // rather than silently carrying escape state across the physical newline.
    if (escaped) {
      raw += "\\\\";
      escaped = false;
    }

    // CHANGED: preserve physical line breaks as \n inside the normalized literal
    raw += "\\n";
    i++;
    j = 0;
  }

  _throw_transform_err(
    "unterminated quoted string",
    "tokenize_hson.scan_quoted_block"
  );
}

type TagCloserLex = ">" | "/>" | null;

export function scan_tag_header_block(
  lines: string[],
  lineIdx: number,
  colIdx: number, // 0-based col of the opening '<'
  lineOffsets: number[]
): {
  raw: string;
  endLine: number;   // 0-based
  endCol: number;    // 1-based column after the last consumed char
  closer: TagCloserLex;
  posAt: (ix: number) => Position;
} {
  const firstLine = lines[lineIdx] ?? "";
  if (firstLine[colIdx] !== "<") {
    _throw_transform_err(
      `scan_tag_header_block: expected '<' at ${lineIdx + 1}:${colIdx + 1}`,
      "tokenize_hson.scan_tag_header_block"
    );
  }

  const rawParts: string[] = [];
  const posMap: Position[] = [];

  const pushChar = (ch: string, li: number, cj: number): void => {
    rawParts.push(ch);
    posMap.push({
      line: li + 1,
      col: cj + 1,
      index: lineOffsets[li] + cj,
    });
  };

  let i = lineIdx;
  let j = colIdx;

  let inQuote = false;
  let escaped = false;

  while (i < lines.length) {
    const cur = lines[i] ?? "";

    while (j < cur.length) {
      const ch = cur[j];
      pushChar(ch, i, j);

      if (inQuote) {
        if (escaped) {
          escaped = false;
          j++;
          continue;
        }

        if (ch === "\\") {
          escaped = true;
          j++;
          continue;
        }

        if (ch === '"') {
          inQuote = false;
          j++;
          continue;
        }

        j++;
        continue;
      }

      if (ch === '"') {
        inQuote = true;
        escaped = false;
      }

      j++;
    }

    // CHANGED: if quote is still open, preserve newline and continue scanning
    if (inQuote) {
      rawParts.push("\n");
      posMap.push({
        line: i + 1,
        col: cur.length + 1,
        index: lineOffsets[i] + cur.length,
      });
      i++;
      j = 0;
      continue;
    }

    // CHANGED: once we're at end-of-line and not inQuote, this logical header is complete.
    // Detect a trailing closer at the end of THIS physical line only.
    const tailLine = cur;
    const mTrail = tailLine.match(/(\/?>)\s*(?:\/\/.*)?$/);
    const closer = mTrail ? (mTrail[1] as TagCloserLex) : null;

    const raw = rawParts.join("");

    return {
      raw,
      endLine: i,
      endCol: cur.length + 1, // 1-based col after last physical char
      closer,
      posAt: (ix: number): Position => {
        const p = posMap[ix];
        if (!p) {
          _throw_transform_err(
            `scan_tag_header_block.posAt: index ${ix} out of range`,
            "tokenize_hson.scan_tag_header_block"
          );
        }
        return p;
      },
    };
  }

  _throw_transform_err(
    "unterminated quoted attribute value in tag header",
    "tokenize_hson.scan_tag_header_block"
  );
}