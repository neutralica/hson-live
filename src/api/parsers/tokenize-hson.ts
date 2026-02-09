// tokenize-hson.old.hson.ts

import { OBJ_TAG } from "../../consts/constants";
import { CREATE_ARR_OPEN_TOKEN, CREATE_ARR_CLOSE_TOKEN, CREATE_EMPTY_OBJ_TOKEN, CREATE_END_TOKEN, CREATE_OPEN_TOKEN, CREATE_TEXT_TOKEN } from "../../consts/factories";
import { CLOSE_KIND, ARR_SYMBOL, TOKEN_KIND } from "../../types/token.types";
import { Position, CloseKind, Tokens, RawAttr } from "../../types/token.types";
import { lex_text_piece } from "../../utils/hson-utils/lex-text-piece";
import { slice_balanced_arr } from "../../utils/hson-utils/slice-balance";
import { split_top_level } from "../../utils/hson-utils/split-top-2";
import { is_quote, scan_quoted_block } from "../../utils/hson-utils/tokenize-full-string";
import { _throw_transform_err } from "../../utils/sys-utils/throw-transform-err.utils";


/**
 * Construct a `Position` object representing a concrete source location
 * within the original HSON text.
 *
 * The returned position is used by the tokenizer and parser to annotate
 * tokens and errors with:
 * - `line`  - 1-based line number.
 * - `col`   - 1-based column number on that line.
 * - `index` - 0-based absolute character offset in the full string.
 *
 * @param lineno - 1-based line number.
 * @param colno - 1-based column (character) index within the line.
 * @param posix - 0-based absolute character index in the whole input.
 * @returns A `Position` triple capturing all three coordinates.
 */
const _pos = (lineno: number, colno: number, posix: number): Position => ({ line: lineno, col: colno, index: posix });

/**
 * Union type for items pushed on the tokenizer's context stack.
 *
 * Variants:
 * - `{ type: "TAG"; tag: string }`
 *   Represents an open tag (`<foo ...>`) whose close delimiter has not yet
 *   been seen. The `tag` is the raw tag name.
 *
 * - `{ type: "CLUSTER"; close?: CloseKind; implicit?: boolean }`
 *   Represents a cluster context such as an object or element block, tracking:
 *   - `close`    - the close kind (e.g. object vs element semantics).
 *   - `implicit` - `true` when the cluster was implied by layout/markup
 *                  rather than an explicit delimiter.
 *
 * - `{ type: "IMPLICIT_OBJECT" }`
 *   Marks an implicit object scope introduced by syntaxes like:
 *     `< <prop val>>`
 *   which are later normalized into the explicit `_obj` layer.
 *
 * The stack is used to enforce well-formed nesting and resolve close
 * delimiters back to their originating context.
 */
type ContextStackItem =
    | { type: 'TAG'; tag: string }
    | { type: 'CLUSTER'; close?: CloseKind; implicit?: boolean } /* replaces the old _obj/_elem sentinels */
    | { type: 'IMPLICIT_OBJECT' };

/**
 * Detects a line that is *only* a lone `<` (with optional trailing
 * whitespace), e.g.:
 *
 *   "<"
 *   "<   "
 *
 * This is used to distinguish incomplete or structural markers from
 * real tag headers, and helps avoid mis-parsing stray `<` characters
 * as valid opening tags.
 *
 * Matches only when:
 * - The line starts with `<`, optionally followed by spaces.
 * - No non-space characters appear after the `<`.
 */
const LONE_OPEN_ANGLE_REGEX = /^<\s*$/;

/**
 * Detects the beginning of an implicit object construct on a line, e.g.:
 *
 *   "< <prop val>>"
 *   "    <   <"
 *
 * Semantics:
 * - Line may start with arbitrary whitespace.
 * - Must contain `<` followed by optional whitespace and then another `<`.
 * - The second `<` must be followed by either whitespace or end-of-line.
 *
 * This pattern signals that an `_obj` cluster is being opened implicitly,
 * and instructs the tokenizer to push an `IMPLICIT_OBJECT`/`CLUSTER`
 * context instead of treating the sequence as a normal tag name.
 */
const IMPLICIT_OBJECT_START_REGEX = /^\s*<\s*<(\s|$)/; /* ensures second '<' is followed by space or EOL */

/* debug log */
const _VERBOSE = false;
const boundLog = console.log.bind(console, '%c[hson tokenizer]', 'color: maroon; background: lightblue;');
const _log = _VERBOSE ? boundLog : () => { };;

let tokenFirst: boolean = true;

/**
 * Tokenize a raw HSON source string into a flat `Tokens[]` stream suitable
 * for `parse_tokens`.
 *
 * Responsibilities:
 * - Splits the input into lines and tracks line/column/absolute offsets
 *   using `_pos(...)` so downstream errors can be reported with precise
 *   positions.
 * - Maintains a `contextStack` of `ContextStackItem` entries to track:
 *   - open tags,
 *   - cluster contexts (object/element semantics),
 *   - implicit object scopes.
 * - Enforces a recursion/depth limit (`maxDepth`) to prevent runaway
 *   expansion or infinite recursion from malicious or malformed input.
 *
 * Core behaviors:
 * - Uses `ensureQuotedLiteral` to validate quoted text segments and detect
 *   unterminated string literals early.
 * - Uses `isPrimitiveLex` to distinguish bare identifiers that should be
 *   treated as scalar values (e.g. `true`, `42`) from flag-style attributes.
 * - Accumulates tag attributes via `readAttrs`, which returns structured
 *   `RawAttr[]` and the updated scan position within the trimmed header.
 * - Manages per-line offset accounting via `_bump_line` and `_bump_array`
 *   so that multi-line constructs still have accurate absolute indices.
 *
 * Debugging:
 * - When `_VERBOSE` is enabled, logs detailed tokenization traces to the
 *   console via a pre-bound logger (`_log`).
 *
 * Errors:
 * - On structural or lexical violations (e.g. unterminated strings, depth
 *   overflow, impossible token transitions), throws via `_throw_transform_err`
 *   with contextual information about where the failure occurred.
 *
 * @param hson - Full HSON source string to be tokenized.
 * @param depth - Internal recursion depth guard (callers normally omit).
 * @returns An ordered array of `Tokens` representing the token stream for
 *   the parser.
 * @see parse_tokens
 * @see readAttrs
 */
export function tokenize_hson(hson: string, depth = 0): Tokens[] {

    const maxDepth = 50;
    _log(`[token_from_hson called with depth=${depth}]`);
    if (tokenFirst) {
        if (_VERBOSE) {
            console.groupCollapsed('---> tokenizing hson')
            console.log('input hson string')
            console.log(hson);
            console.groupEnd();
            tokenFirst = false;
        }
    }
    if (depth >= maxDepth) {
        _throw_transform_err(`stopping potentially infinite loop (depth >= ${maxDepth})`, 'tokenize_hson');
    }

    const finalTokens: Tokens[] = [];
    const contextStack: ContextStackItem[] = [];
    const splitLines = hson.split(/\r\n|\r|\n/);
    let ix = 0;

    _log(`[token_from_hson depth=${depth}]; total lines: ${splitLines.length}`);

    function ensureQuotedLiteral(lit: string, where: string) {
        const t = lit.trim();

        // CHANGED: if it looks like a quoted literal, it must be JSON-style: "..."
        if (t.startsWith("'") || t.startsWith("`")) {
            _throw_transform_err(
                `[${where}] unsupported quote delimiter (use double quotes only): ${lit}`,
                "tokenize-hson"
            );
        }

        const piece = lex_text_piece(lit);

        // CHANGED: starts with " but not properly closed => hard error
        if (t.startsWith('"') && !piece.quoted) {
            _throw_transform_err(
                `[${where}] unterminated quoted literal: ${lit}`,
                "tokenize-hson"
            );
        }

        return piece; // { text: full literal OR unquoted text, quoted flag }
    }

    /**
     * Decide whether a bare token in attribute position should be treated as
     * a *primitive value* rather than a flag-style attribute.
     *
     * Rules (after trimming):
     * - Empty string → `false` (not a primitive).
     * - `"true" | "false" | "null"` → primitive.
     * - Numeric-like forms matching:
     *     /^-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?$/
     *   (integers, floats, scientific notation) → primitive.
     *
     * This is used when encountering an attribute-like token without an
     * explicit `=`. If it passes this check, the tokenizer treats it as
     * a bare value rather than as a boolean/flag attribute.
     *
     * @param string - Raw token text.
     * @returns `true` if the token represents a primitive literal, `false` otherwise.
     */
    function isPrimitiveLex(string: string): boolean {
        const t = string.trim();
        if (!t) return false;
        if (t === 'true' || t === 'false' || t === 'null') return true;
        // number-ish (int, float, sci). no +/- signs for attrs; fine to accept here
        return /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(t);
    }

    /**
     * Advance the tokenizer’s line/offset cursors by a single line.
     *
     * Side effects:
     * - Increments the global `_offset` by `line.length + 1` to account for
     *   the line content plus a newline.
     * - Increments the current line index `ix` to point at the next line
     *   in `splitLines`.
     *
     * This helper keeps all line-advance logic centralized so that position
     * tracking remains consistent.
     *
     * @param line - The current line string being consumed.
     */
    function _bump_line(line: string) { _offset += line.length + 1; ix++; }

    /**
 * Advance the tokenizer’s line/offset cursors by a fixed number of
 * subsequent lines starting at the current index.
 *
 * For each of the next `count` lines:
 * - Adds `line.length + 1` to the global `_offset`.
 * - Skips forward in `splitLines`.
 *
 * After the loop:
 * - Increments `ix` by `count`, effectively jumping ahead by that many
 *   logical lines in the tokenization process.
 *
 * Used when multi-line constructs can be skipped in bulk once they have
 * been structurally accounted for.
 *
 * @param count - How many following lines to advance over.
 */
    function _bump_array(count: number) {
        for (let n = 0; n < count; n++) {
            const L = splitLines[ix + n] ?? '';
            _offset += L.length + 1;
        }
        ix += count;
    }

    /**
 * Parse a slice of a tag header into structured `RawAttr[]` entries.
 *
 * Input window:
 * - Operates on the substring `trimLine[startIx:endIx]`, where:
 *   - `trimLine` is the tag header line with leading indentation removed.
 *   - `startIx` is the index of the first character after the tag name.
 *   - `endIx` is the index where the trailing closer (e.g. `>` or `/>`)
 *     begins.
 *
 * Behavior:
 * - Scans from `startIx` to `endIx`, skipping whitespace between tokens.
 * - For each attribute:
 *   - Reads a valid name matching `[A-Za-z_:][\\w:.-]*`.
 *   - If followed by `=`:
 *     - Parses a quoted value (`"..."` or `'...'`) with escape handling,
 *       or an unquoted value up to the next whitespace.
 *     - Records `value` as `{ text, quoted: boolean }`.
 *   - If *not* followed by `=`:
 *     - Uses `isPrimitiveLex(name)`:
 *       - If `true`, stops and returns early so the caller can treat this
 *         position as a primitive literal rather than an attribute name.
 *       - If `false`, records a *flag* attribute (no value).
 * - Produces `start`/`end` `Position` objects for each attribute using
 *   the line/column metadata provided (`lineNo`, `leadCol`, `_offset`).
 *
 * Return contract:
 * - `attrs`: the list of parsed `RawAttr` entries in left-to-right order.
 * - `endIx`: the index of the first unconsumed character in `trimLine`
 *   after attribute scanning, for the caller to continue scanning.
 *
 * @param trimLine - The trimmed header line containing the tag and attrs.
 * @param startIx - Index (in `$trimLine`) where attribute parsing begins.
 * @param endIx - Index (in `$trimLine`) where attribute parsing must stop.
 * @param lineNo - 1-based line number for position metadata.
 * @param leadCol - Column of the first non-space character in the line.
 * @returns An object with `{ attrs, endIx }` for downstream tokenization.
 */
    function readAttrs(
        trimLine: string,
        startIx: number,                /* first char after tag name */
        endIx: number,                  /* start index of the trailing closer in trimLine */
        lineNo: number,
        leadCol: number                 /* first non-space col in currentLine (1-based) */
    ): { attrs: RawAttr[]; endIx: number } {
        const out: RawAttr[] = [];
        let ix = startIx;
        const end = endIx;

        let inQuote: '"' | null = null;
        let escaped = false;

        const _col = (relIx: number) => leadCol + relIx;                 /* 1-based col */
        const _mkpos = (relIx: number): Position => {
            const col = _col(relIx);
            return { line: lineNo, col, index: _offset + col - 1 };
        };

        const _skip_whitespace = () => { while (ix < end && /\s/.test(trimLine[ix])) ix++; };

        while (ix < end) {
            _skip_whitespace();
            if (ix >= end) break;

            /* attr name must start with letter/_/: */
            if (!/[A-Za-z_:]/.test(trimLine[ix])) break;

            const nameStart = ix;
            ix++; while (ix < end && /[\w:.\-]/.test(trimLine[ix])) ix++;
            const name = trimLine.slice(nameStart, ix);
            const startPos = _mkpos(nameStart);

            _skip_whitespace();

            if (ix < end && trimLine[ix] === '=') {
                ix++; _skip_whitespace();
                let valStart = ix;
                if (trimLine[ix] === "'") {
                    _throw_transform_err(
                        `unsupported single-quoted attribute value (use " only)`,
                        "tokenize_hson.readAttrs"
                    );
                }
                if (ix < end && (trimLine[ix] === '"')) {
                    inQuote = trimLine[ix] as '"'; ix++; valStart = ix;
                    while (ix < end) {
                        const ch = trimLine[ix];
                        if (escaped) { escaped = false; ix++; continue; }
                        if (ch === '\\') { escaped = true; ix++; continue; }
                        if (ch === inQuote) break;
                        ix++;
                    }
                    const text = trimLine.slice(valStart, ix);
                    if (ix < end && trimLine[ix] === inQuote) ix++;
                    const endPos = _mkpos(ix);
                    out.push({ name, value: { text, quoted: true }, start: startPos, end: endPos });
                } else {
                    while (ix < end && !/\s/.test(trimLine[ix])) ix++;
                    const endPos = _mkpos(ix);
                    // CHANGED: store full JSON string literal for quoted values (Option B)
                    const inner = trimLine.slice(valStart, ix);

                    // CHANGED: normalize: only allow double-quoted JSON literals as the stored form
                    // If the source quote was single, we convert by JSON-stringifying the inner *as text*.
                    // (This means single-quoted attrs become “literal text”, not a JS-like escape soup.)
                    const full =
                        inQuote === '"'
                            ? `"${inner}"`                    // keep raw inner, still escaped as authored
                            : JSON.stringify(inner);          // normalize single-quoted input into a JSON literal

                    out.push({ name, value: { text: full, quoted: true }, start: startPos, end: endPos });
                }
            } else {
                if (isPrimitiveLex(name)) {
                    return { attrs: out, endIx: nameStart };
                }
                const endPos = _mkpos(ix);
                out.push({ name, start: startPos, end: endPos }); /* flag */
            }
        }

        return { attrs: out, endIx: ix };
    }

    let _offset = 0;
    while (ix < splitLines.length) {
        const currentIx = ix;
        const currentLine = splitLines[ix];
        const trimLine = currentLine.trim();
        // near tokenizer setup (top of function/file)
        const getLine = (n: number) => splitLines[n] ?? '';

        _log(`[token_from_hson depth=${depth} L=${currentIx + 1}/${splitLines.length}]: processing: "${trimLine}" (Original: "${currentLine}")`);

        /* Step A */
        /* skip empty/comment lines */
        if (!trimLine || trimLine.startsWith('//')) {
            _log(`[token_from_hson depth=${depth} L=${currentIx + 1}] skipping comment/empty`);
            _bump_line(currentLine);
            continue;
        }

        /* Step B: lone '<' implicit object trigger */
        if (LONE_OPEN_ANGLE_REGEX.test(currentLine)) {
            _log(`[tokenize_hson depth=${depth} L=${currentIx + 1}] lone '<' detected`);

            contextStack.push({ type: 'IMPLICIT_OBJECT' });
            contextStack.push({ type: 'CLUSTER', close: CLOSE_KIND.obj, implicit: true });

            // emit a real OPEN for a synthetic _obj
            const lineNo = currentIx + 1;
            const leadCol = currentLine.search(/\S|$/) + 1;
            const posOpen = _pos(lineNo, leadCol, _offset + leadCol - 1);
            finalTokens.push(CREATE_OPEN_TOKEN(OBJ_TAG, /*rawAttrs*/[], posOpen));     // NEW

            _bump_line(currentLine);
            continue;
        }

        /* Step C */
        /* handle empty arrays «» */
        if (/^«\s*»\s*$/.test(trimLine) || /^\[\s*\]\s*$/.test(trimLine)) {
            const arrayOpener = trimLine.startsWith('«') ? ARR_SYMBOL.guillemet : ARR_SYMBOL.bracket;
            const col = currentLine.search(/\S|$/) + 1; /* first non-space, 1-based */
            const p = _pos(currentIx + 1, col, _offset + col - 1);

            _log(`[quick]: empty array detected (${arrayOpener})`);
            finalTokens.push(CREATE_ARR_OPEN_TOKEN(arrayOpener, p));
            finalTokens.push(CREATE_ARR_CLOSE_TOKEN(arrayOpener, p));

            _bump_line(currentLine);
            continue;
        }

        /* Step D */
        /* handle _array delimiters */
        if (trimLine.startsWith('«') || trimLine.startsWith('[')) {
            const opener = trimLine.startsWith('«') ? '«' : '[';
            const closer = opener === '«' ? '»' : ']';
            const closerSymbol = opener === '«' ? ARR_SYMBOL.guillemet : ARR_SYMBOL.bracket;

            _log(`[tokenize_hson]: processing array (${closerSymbol})`);

            /* build a joined view from the current line onward */
            const joinedFromHere = splitLines.slice(ix).join('\n');
            const colInLine = currentLine.indexOf(opener) + 1;     /* 1-based col */
            const startInJoined = currentLine.indexOf(opener) + 1; /* index after opener */

            /* slice the balanced body (quote-aware, nested-pair aware) */
            const { body, endIndex } = slice_balanced_arr(joinedFromHere, startInJoined, opener, closer);

            /* compute how many lines were consumed up to the closer */
            const consumedText = joinedFromHere.slice(0, endIndex + 1); /* includes closer */
            const linesConsumed = consumedText.split('\n').length - 1;

            const pOpen = _pos(currentIx + 1, colInLine, _offset + colInLine - 1);
            const pClose = _pos(currentIx + 1 + linesConsumed, 1, _offset + consumedText.length);

            finalTokens.push(CREATE_ARR_OPEN_TOKEN(closerSymbol, pOpen));

            /* split the array body by top-level commas (quote/array/header aware) */
            const items = split_top_level(body, ',');

            for (const itemRaw of items) {
                const item = itemRaw.trim();
                if (!item) continue;

                if (item.startsWith('<') || item.startsWith('«') || item.startsWith('[')) {
                    finalTokens.push(...tokenize_hson(item, depth + 1));
                } else {
                    //  quote-aware, without endIx
                    const piece = ensureQuotedLiteral(item, 'array');
                    finalTokens.push(
                        CREATE_TEXT_TOKEN(piece.text, piece.quoted ? true : undefined, pOpen)
                    );
                }
            }


            finalTokens.push(CREATE_ARR_CLOSE_TOKEN(closerSymbol, pClose));

            /* advance main loop to the line containing the closer */
            _bump_array(linesConsumed + 1);
            continue;
        }

        /* step E  handle closers */
        const closerMatch = currentLine.match(/^\s*(\/?>)\s*(?:\/\/.*)?$/);
        if (closerMatch) {
            const closerLex = closerMatch[1];
            if (closerLex) {
                const close = closerLex === '/>' ? CLOSE_KIND.elem : CLOSE_KIND.obj;
                const col = currentLine.indexOf(closerLex) + 1;
                const pos = _pos(currentIx + 1, col, _offset + col - 1);

                // const top = contextStack[contextStack.length - 1];
                // if (!top || top.type !== 'CLUSTER') {
                //     _throw_transform_err(`[step e] closer '${closerLex}' but stack top is ${make_string(top)}`, 'tokenize-hson');
                // }
                // if (top.close && top.close !== close) {
                //     _throw_transform_err(`[step e] mismatched closer '${closerLex}' for cluster '${top.close}'`, 'tokenize-hson');
                // }

                // pop cluster and optionally emit END
                const popped = contextStack.pop() as Extract<ContextStackItem, { type: 'CLUSTER' }>;
                const isObjClose = (close === CLOSE_KIND.obj);

                // Always emit CLOSE for normal clusters,
                // and ALSO emit it when this is the implicit per-item object box.
                if (!popped.implicit || isObjClose) {
                    finalTokens.push(CREATE_END_TOKEN(close, pos));
                } else {
                    _log(`[step e] suppress END for implicit non-object cluster at L${currentIx + 1}`);
                }

                // pop IMPLICIT_OBJECT marker when we close the obj box.
                const top = contextStack[contextStack.length - 1];
                if (isObjClose && top && (top as any).type === 'IMPLICIT_OBJECT') {
                    contextStack.pop();
                }

                // clean up implicit marker if present
                const maybeImplicit = contextStack[contextStack.length - 1];
                if (maybeImplicit && maybeImplicit.type === 'IMPLICIT_OBJECT' && close === CLOSE_KIND.obj) {
                    contextStack.pop();
                }

                _bump_line(currentLine);
                continue;
            }
        }


        /* step F: open tags */
        if (trimLine.startsWith('<')) {
            // f.0 exact empty-object token "<>"
            if (/^<>\s*$/.test(trimLine)) {
                const lineNo = currentIx + 1;
                const leadCol = currentLine.search(/\S|$/) + 1;   // first non-space col on this line
                const colOpen = leadCol;                           // '<' sits here
                const posOpen = _pos(lineNo, colOpen, _offset + colOpen - 1);

                finalTokens.push(CREATE_EMPTY_OBJ_TOKEN('<>', /*quoted*/ false, posOpen));
                _bump_line(currentLine);
                continue;
            }


            /* f.1 implicit object opener "< <...": accept preamble, no tokens, structure only */
            if (IMPLICIT_OBJECT_START_REGEX.test(trimLine)) {
                _log(`[step f depth=${depth} L=${currentIx + 1}] implicit object opener`);
                contextStack.push({ type: 'IMPLICIT_OBJECT' });
                contextStack.push({ type: 'CLUSTER' });/* pending close kind */

                const secondIx = trimLine.indexOf('<', trimLine.indexOf('<') + 1);
                const inner = secondIx >= 0 ? trimLine.substring(secondIx).trim() : '';
                if (inner) {
                    const innerTokens = tokenize_hson(inner, depth + 1);
                    finalTokens.push(...innerTokens);
                }
                _bump_line(currentLine);
                continue;
            }

            /* f.2 read tag header minimally: name + find header end (no attrs yet) */
            let ixHeader = 1;                               /* after '<' */
            const lineLen = trimLine.length;
            while (ixHeader < lineLen && /\s/.test(trimLine[ixHeader])) ixHeader++;

            const tagNameStartIx = ixHeader;
            while (ixHeader < lineLen && /[A-Za-z0-9:._-]/.test(trimLine[ixHeader])) ixHeader++;
            const tag = trimLine.slice(tagNameStartIx, ixHeader);
            if (!tag) _throw_transform_err(`[step f depth=${depth} L=${currentIx + 1}] malformed tag in "${trimLine}"`, 'tokenize-hson');

            const lineNo = currentIx + 1;
            const leadCol = currentLine.search(/\S|$/) + 1;          /* first non-space col */
            const colOpen = leadCol;                                  /* '<' sits here */
            const posOpen = _pos(lineNo, colOpen, _offset + colOpen - 1);

            /* f.3 detect trailing closer @ end of the raw line (ignore //comment) */
            const mTrail = currentLine.match(/(\/?>)\s*(?:\/\/.*)?$/);
            const closerLex = mTrail ? (mTrail[1] as ('>' | '/>')) : null;

            let rawAttrs: RawAttr[] = [];
            let tailRaw = '';

            /* compute relative indices against trimLine */
            const leadSpaces = currentLine.match(/^\s*/)?.[0].length ?? 0;

            if (closerLex) {
                const closerLen = closerLex === '/>' ? 2 : 1;

                /* absolute index of the closer in currentLine */
                const closerAbs = currentLine.lastIndexOf(closerLex);
                if (closerAbs < 0) {
                    _throw_transform_err(`internal: trailing closer not found in "${currentLine}"`, 'tokenize-hson', currentLine);
                }

                /* relative index inside trimLine */
                const closerRel = Math.max(0, closerAbs - leadSpaces);

                /* parse attrs up to the closer; capture where we stopped for tail */
                const { attrs, endIx: attrsEndIx } =
                    readAttrs(trimLine, ixHeader /* after name */, closerRel, lineNo, leadCol);

                rawAttrs = attrs;

                /* anything between attrs end and trailing closer is the inline tail */
                tailRaw = trimLine.slice(attrsEndIx, closerRel).trim();
            } else {
                /* no same-line closer: parse attrs until we can’t read more */
                const { attrs } = readAttrs(trimLine, ixHeader, trimLine.length, lineNo, leadCol);
                rawAttrs = attrs;
            }

            /* emit open */
            finalTokens.push(CREATE_OPEN_TOKEN(tag, rawAttrs, posOpen));

            /* inline tail (if any) */
            if (tailRaw) {
                if (tailRaw.startsWith('<') || tailRaw.startsWith('«') || tailRaw.startsWith('[')) {
                    finalTokens.push(...tokenize_hson(tailRaw, depth + 1));
                } else {
                    const parts = split_top_level(tailRaw, ',');
                    if (parts.length > 1) {
                        _throw_transform_err(
                            `[step f] multiple inline items not allowed after <${tag}>: "${tailRaw}"`,
                            'tokenize-hson'
                        );
                    }
                    const lit = parts[0].trim();

                    //  quote-aware, without endIx
                    const piece = ensureQuotedLiteral(lit, 'step f');
                    finalTokens.push(
                        CREATE_TEXT_TOKEN(piece.text, piece.quoted ? true : undefined, posOpen)
                    );
                }
            }

            /* close now or defer to step e */
            if (closerLex) {
                const closerLen = closerLex === '/>' ? 2 : 1;
                const colCloserAbs = leadCol + (trimLine.length - closerLen);
                const posClose = _pos(lineNo, colCloserAbs, _offset + colCloserAbs - 1);
                const closeKind = (closerLex === '/>') ? CLOSE_KIND.elem : CLOSE_KIND.obj;
                finalTokens.push(CREATE_END_TOKEN(closeKind, posClose));
                _bump_line(currentLine);
                continue;
            } else {
                contextStack.push({ type: 'CLUSTER' });  /* pending: Step E will close */
                _bump_line(currentLine);
                continue;
            }
        } // ---- end of step F ---=|


        /* step G: standalone text/primitive lines */
        {
            // detect leading quote *before* any comment handling
            const lead = currentLine.search(/\S|$/);
            const ch = currentLine[lead];

            if (is_quote(ch)) {
                const pos = _pos(ix + 1, lead + 1, _offset + lead);
                const { raw, endLine, endCol } = scan_quoted_block(splitLines, ix, lead);

                // emit one TEXT token with quoted=true and the inner raw
                finalTokens.push(CREATE_TEXT_TOKEN(raw, /*quoted*/ true, pos));

                // allow whitespace or // comment only after the closer line
                const tail = getLine(endLine).slice(endCol);
                if (!/^\s*(?:\/\/.*)?$/.test(tail)) {
                    _throw_transform_err('unexpected trailing characters after quoted text', 'tokenize_hson');
                }

                // advance past the consumed lines 
                for (let k = ix; k <= endLine; k++) _bump_line(getLine(k));
                continue;
            }

            // non-quoted
            const m = currentLine.match(/^\s*(.+?)(?:\s*\/\/.*)?\s*$/);
            const body = m ? m[1] : '';

            // quick primitive check (true/false/null/number with optional exp)
            const isPrim = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(body);

            if (isPrim) {
                const p = _pos(ix + 1, (currentLine.match(/^\s*/)?.[0].length ?? 0) + 1, _offset + (currentLine.match(/^\s*/)?.[0].length ?? 0));
                finalTokens.push(CREATE_TEXT_TOKEN(body, /*quoted*/ undefined, p));
                _bump_line(currentLine);
                continue;
            }

            // fall through: not a standalone text/primitive line; other steps (F, etc.) handle it
        }

        _bump_line(currentLine);
        continue;

    } // ---- end while loop ---=|


    /* end-of-file stats */
    _log(
        `[tokenize_hson depth=${depth}] processed all lines\n` +
        `  contextStack size: ${contextStack.length}\n` +
        `  total tokens: ${finalTokens.length}`
    );

    /* final check — only at top level */
    if (depth === 0 && contextStack.length > 0) {
        const residual = contextStack.map((c) => {
            if (c.type === 'CLUSTER') return `<cluster ${c.close ?? 'pending'}>`;
            if (c.type === 'IMPLICIT_OBJECT') return '< < (implicit object)';
            /* c.type === 'TAG' */
            return '<tag?>';
        }).join(', ');
        _throw_transform_err(`final check failed: tokenizer finished with ${contextStack.length} unclosed items: ${residual}`, 'tokenize-hson');
    }

    if (_VERBOSE) {
        logTokens();
    }

    function logTokens(): void {
        console.groupCollapsed('returning tokens (summary)');
        for (const t of finalTokens) {
            switch (t.kind) {
                case TOKEN_KIND.OPEN:
                    console.log(`OPEN <${t.tag}> @ L${t.pos.line}:C${t.pos.col}`);
                    break;
                case TOKEN_KIND.CLOSE:
                    console.log(`END ${t.close} @ L${t.pos.line}:C${t.pos.col}`);
                    break;
                case TOKEN_KIND.ARR_OPEN:
                    console.log(`ARR_OPEN ${t.symbol} @ L${t.pos.line}:C${t.pos.col}`);
                    break;
                case TOKEN_KIND.ARR_CLOSE:
                    console.log(`ARR_CLOSE ${t.symbol} @ L${t.pos.line}:C${t.pos.col}`);
                    break;
                case TOKEN_KIND.TEXT:
                    console.log(`TEXT "${t.raw}" @ L${t.pos.line}:C${t.pos.col}`);
                    break;
                case TOKEN_KIND.EMPTY_OBJ:
                    console.log(`EMPTY_OBJ "${t}" @ L${t.pos.line}:C${t.pos.col}`);
                    break;
            }
        }
        console.groupEnd();
    }

    /* return new tokens; no _root wrapping here — parser will handle it */
    return finalTokens as Tokens[];
}


