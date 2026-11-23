import { AUTHORED_EVENT_FLAGS } from "../core/authored-event-names.js";
import {
  AUTHORED_EVENT_NAMES, native_event_family, type EventArgumentQualifier, type NativeEventFamily,
} from "./event-argument-plan.js";
import { scan_formdata_operation } from "./event-operation-source.js";
import { part_reference_checkpoint, scan_part_reference, type PartReference } from "./part-placeholder.js";
import { decode_part_string_sigils } from "./part-scalar-source.js";

export type EventRange = Readonly<{ start: number; end: number }>;
export type EventSourceRole =
  | "head" | "structural" | "outcomeOpen" | "outcomeClose" | "declarationClose" | "selectorDomain" | "selectorName" | "destinationDomain" | "action"
  | "option" | "argument" | "qualifier" | "assignment" | "separator"
  | "nativeRoot" | "nativeProperty" | "operation" | "field"
  | "localSigil" | "incomingSigil" | "referenceRoot" | "referencePath" | "referencePunctuation" | "referenceSeparator" | "referenceBracket" | "referenceOptional"
  | "dataPunctuation" | "dataMember" | "dataValue" | "string" | "quote" | "escape" | "number" | "boolean" | "comment";
export type EventSourceSpan = EventRange & Readonly<{ role: EventSourceRole }>;

type Header = EventRange & Readonly<{ raw: string; valued: boolean; assignment?: number; argument?: string }>;
type Operand = EventRange & Readonly<{
  qualifier: EventArgumentQualifier;
  form: "quoted" | "data" | "bare" | "missing";
  closed?: boolean;
  bounded: boolean;
}>;
type OperationSource = Readonly<{ methodEnd: number; field?: EventRange; complete: boolean }>;
type ReferenceSlot = Readonly<{
  source: string;
  cursor: number;
  quoted: boolean;
  quoteMissing: boolean;
  escapedSigil: boolean;
  hasPartReference: boolean;
  part?: Readonly<{ parsed: PartReference; checkpoint?: NonNullable<ReturnType<typeof part_reference_checkpoint>> }>;
  operation?: OperationSource;
  map: (range: EventRange) => EventRange | undefined;
}>;
export type EventCompletionSlot =
  | Readonly<{ kind: "head"; range: EventRange; hasOpener: boolean }>
  | Readonly<{ kind: "outcome" | "outcomeClose" | "declarationClose"; range: EventRange }>
  | Readonly<{ kind: "header"; range: EventRange; item?: Header; outcome?: "missing" | "outer-present" }>
  | Readonly<{ kind: "operand"; range: EventRange; operand: Operand; reference?: ReferenceSlot }>;

export type EventAuthoringObservation = Readonly<{
  spans: readonly EventSourceSpan[];
  slot?: EventCompletionSlot;
  flags: readonly Header[];
  arguments: readonly Header[];
  family?: NativeEventFamily;
}>;

export function event_destination_domain(raw: string): "host" | "local" | undefined {
  return raw.startsWith("host:") ? "host" : raw.startsWith("local:") ? "local" : undefined;
}

/** Receives scanner boundaries, including those reached before strict admission could succeed. */
export class EventAuthoringObserver {
  private readonly spans: EventSourceSpan[] = [];
  private readonly headers: Header[] = [];
  private readonly operands: Operand[] = [];
  private readonly comments: EventRange[] = [];
  private readonly headerGaps: EventRange[] = [];
  private readonly closers: { kind: "outcomeClose" | "declarationClose"; range: EventRange }[] = [];
  private headRange: EventRange | undefined;
  private headHasOpener = false;
  private headerEnd: number | undefined;
  private outcome: "missing" | "outer-present" | undefined;

  constructor(private readonly source: string, private readonly cursor?: number) {}

  public role(role: EventSourceRole, start: number, end = start + 1): void {
    if (start < end) this.spans.push({ role, start, end });
  }

  public quotedString(start: number, end: number, closed: boolean): void {
    this.role("quote", start);
    const from = start + 1, to = end - Number(closed);
    const parts = decodeQuotedPrefix(this.source.slice(from, to)).escapes.map(
      escape => ({ start: from + escape.start, end: from + escape.end, role: "escape" as const }));
    this.fillOperand(from, to, "string", parts);
    if (closed) this.role("quote", end - 1);
  }

  public comment(start: number, end: number): void {
    this.comments.push({ start, end });
    this.role("comment", start, end);
  }

  public head(open: number, nameStart: number, nameEnd: number, complete: boolean): void {
    this.role("structural", open);
    this.role("head", nameStart, nameEnd);
    this.headRange = { start: nameStart, end: nameEnd };
    this.headHasOpener = true;
    if (complete && nameEnd !== this.source.length) this.headRange = undefined;
  }

  public emptyHead(at: number): void {
    if (at === this.source.length) this.headRange = { start: at, end: at };
  }

  public header(start: number, raw: string, valued: boolean, argument: string | undefined, assignment?: number): void {
    const end = start + raw.length;
    this.headers.push({ start, end, raw, valued, argument, assignment });
    const domain = !valued ? event_destination_domain(raw) : undefined;
    if (!valued && AUTHORED_EVENT_FLAGS.has(raw)) this.role("option", start, end);
    else if (!valued && raw.startsWith("on:")) {
      this.role("selectorDomain", start, start + 2);
      let part = start + 2;
      for (const segment of raw.slice(2).split(":").slice(1)) {
        this.role("separator", part++);
        this.role("selectorName", part, part + segment.length);
        part += segment.length;
      }
    } else if (domain !== undefined) {
      const colon = start + domain.length;
      this.role("destinationDomain", start, colon);
      this.role("separator", colon);
      this.role("action", colon + 1, end);
    } else if (argument !== undefined) {
      const colon = start + argument.length;
      this.role("argument", start, colon);
      if (colon < end) {
        this.role("separator", colon);
        this.role("qualifier", colon + 1, end);
      }
    }
  }

  public gap(start: number, end: number): void {
    if (start < end) this.headerGaps.push({ start, end });
  }

  public endHeader(at: number, outcome?: "missing" | "outer-present"): void {
    this.headerEnd = at;
    this.outcome = outcome;
  }

  public closer(kind: "outcomeClose" | "declarationClose", start: number, end: number): void {
    this.closers.push({ kind, range: { start, end } });
  }

  public operand(qualifier: EventArgumentQualifier, form: Operand["form"], start: number, end: number,
    bounded: boolean, closed?: boolean): void {
    this.operands.push({ qualifier, form, start, end, bounded, closed });
  }

  public finish(): EventAuthoringObservation {
    const flags = this.headers.filter(header => !header.valued && (AUTHORED_EVENT_FLAGS.has(header.raw)
      || header.raw.startsWith("on:") || event_destination_domain(header.raw) !== undefined));
    const selectors = flags.filter(header => header.raw.startsWith("on:"));
    const family = selectors.length === 1 ? native_event_family(AUTHORED_EVENT_NAMES.get(selectors[0]!.raw)) : undefined;
    const flagHeaders = new Set(flags);
    const arguments_ = this.headers.filter(header => header.argument !== undefined && !flagHeaders.has(header));
    const cursor = this.cursor;
    let slot: EventCompletionSlot | undefined;
    const editable = cursor !== undefined && !this.comments.some(range => range.start < cursor && cursor <= range.end);
    if (editable) {
      if (this.headRange !== undefined && this.headRange.start <= cursor && cursor <= this.headRange.end) {
        slot = { kind: "head", range: this.headRange, hasOpener: this.headHasOpener };
      } else {
        const item = this.headers.find(header => header.start <= cursor && cursor <= header.end);
        const gap = this.headerGaps.find(gap => gap.start <= cursor && cursor <= gap.end);
        const completedItem = item === undefined || AUTHORED_EVENT_FLAGS.has(item.raw) || AUTHORED_EVENT_NAMES.has(item.raw)
          || event_destination_domain(item.raw) !== undefined && !item.raw.endsWith(":");
        if (gap !== undefined && (gap.start < cursor || completedItem)) {
          slot = { kind: "header", range: { start: cursor, end: cursor },
            outcome: cursor === this.headerEnd ? this.outcome : undefined };
        } else if (item !== undefined) {
          slot = { kind: "header", range: item, item,
            outcome: cursor === this.headerEnd && cursor === item.end ? this.outcome : undefined };
        }
      }
      if (slot === undefined && this.outcome !== undefined && cursor === this.headerEnd && this.outcome === "outer-present") {
        slot = { kind: "outcome", range: { start: cursor, end: cursor } };
      }
      const closer = this.closers.find(({ range }) => range.start <= cursor && cursor <= range.end);
      if (closer !== undefined) slot = { kind: closer.kind, range: { start: cursor, end: cursor } };
    }
    for (const operand of this.operands) {
      const reference = operand.form === "quoted" || operand.form === "bare" ? this.observeReferenceOperand(operand, family) : undefined;
      if (editable && operand.bounded && operand.start <= cursor && cursor <= operand.end
        && !(cursor === operand.end && (operand.closed
          || slot?.kind === "header" && slot.item === undefined && (reference?.part?.checkpoint?.complete || reference?.operation?.complete)))) {
        slot = { kind: "operand", range: operand, operand, reference };
      }
    }
    return { spans: this.spans.sort((a, b) => a.start - b.start), flags, arguments: arguments_, family, slot };
  }

  private observeReferenceOperand(operand: Operand, family: NativeEventFamily | undefined): ReferenceSlot | undefined {
    const { start, end, form, closed, qualifier } = operand;
    if (start === end) return undefined;
    const quoted = form === "quoted";
    const from = start + Number(quoted), to = end - Number(quoted && closed);
    const raw = this.source.slice(from, to);
    const decoded = quoted ? decodeQuotedPrefix(raw) : undefined;
    const value = decoded?.value ?? raw;
    const map = (range: EventRange): EventRange | undefined => {
      const a = decoded === undefined ? range.start : decoded.boundaries[range.start];
      const b = decoded === undefined ? range.end : decoded.boundaries[range.end];
      return a === undefined || b === undefined ? undefined : { start: from + a, end: from + b };
    };
    if (quoted) this.role("quote", start);
    const literalSigils = quoted ? decode_part_string_sigils(raw) : undefined;
    const parts: EventSourceSpan[] = [];
    const emit = (role: EventSourceRole, a: number, b: number): void => {
      const range = map({ start: a, end: b });
      if (range !== undefined && range.start < range.end) parts.push({ ...range, role });
    };
    const literal = (role: EventSourceRole, a: number, b: number, closed: boolean): void => {
      emit("quote", a, a + 1);
      const end = b - Number(closed);
      let next = a + 1;
      for (const escape of decodeQuotedPrefix(value.slice(next, end)).escapes) {
        const from = a + 1 + escape.start, to = a + 1 + escape.end;
        emit(role, next, from);
        emit("escape", from, to);
        next = to;
      }
      emit(role, next, end);
      if (closed) emit("quote", end, b);
    };
    const sigil = (a: number, b: number) => emit(value[a] === "%" ? "incomingSigil" : "localSigil", a, b);
    const punctuate = (a: number, b: number) => {
      const punctuation = value[a];
      emit(punctuation === "." || punctuation === ":" ? "referenceSeparator"
        : punctuation === "[" || punctuation === "]" ? "referenceBracket"
        : punctuation === "?" ? "referenceOptional" : "referencePunctuation", a, b);
    };
    let parsed: PartReference | undefined;
    let operation: OperationSource | undefined;
    let hasPartReference = false;
    for (let at = 0; at < value.length; at++) {
      if (literalSigils?.has(at) || (value[at] !== "%" && value[at] !== "^")) continue;
      if (at !== 0 && (!quoted || qualifier !== "str")) break;
      let consumed = at;
      if (value.startsWith("^{formdata:", at) && at === 0) {
        let methodEnd = 0, field: EventRange | undefined, complete = false;
        try {
          complete = scan_formdata_operation(value, at, (segment, a, b, closed) => {
            if (segment === "sigil") sigil(a, b);
            else if (segment === "field") {
              literal("field", a, b, closed === true);
              if (closed) field = { start: a, end: b };
            } else {
              if (segment === "punctuation") punctuate(a, b);
              else emit(segment === "root" ? "nativeRoot" : "operation", a, b);
              if (segment === "method") methodEnd = b;
            }
          })?.reference.end === value.length;
        } catch { /* An unfinished operation retains the scanner's prefix. */ }
        operation = { methodEnd, field, complete };
        break;
      }
      const native = family !== undefined && value.startsWith(`^{${family}`, at)
        && /[.\[?}]|^$/u.test(value[at + family.length + 2] ?? "");
      if (!native && value[at + 1] === "{") hasPartReference = true;
      const reference = scan_part_reference(value, at, true, (segment, a, b, closed) => {
        consumed = Math.max(b, consumed);
        if (segment === "sigil") sigil(a, b);
        else if (segment === "punctuation" || segment === "close") punctuate(a, b);
        else if (segment === "root") emit(native ? "nativeRoot" : "referenceRoot", a, b);
        else if (segment === "key") literal(native ? "nativeProperty" : "referencePath", a, b, closed === true);
        else emit(native ? "nativeProperty" : "referencePath", a, b);
      });
      if (at === 0 && reference?.end === value.length) parsed = reference;
      if (reference !== undefined) at = reference.end - 1;
      else if (!quoted || qualifier !== "str") break;
      else if (consumed > at) at = consumed - 1;
    }
    if (quoted) {
      // Escapes own their bytes even when the decoded character is part of a reference.
      for (const escape of decoded!.escapes) parts.push({ start: from + escape.start, end: from + escape.end, role: "escape" });
      const base = qualifier === "num" && /^[-.\dEe+]+$/.test(value) ? "number"
        : qualifier === "bool" && (value === "true" || value === "false") ? "boolean" : "string";
      this.fillOperand(from, to, base, parts);
      if (closed) this.role("quote", end - 1);
    } else {
      for (const part of parts) this.spans.push(part);
    }
    if (this.cursor === undefined || this.cursor < from || this.cursor > to || decoded?.complete === false) return undefined;
    const cursor = decoded === undefined ? this.cursor - from : decoded.boundaries.indexOf(this.cursor - from);
    if (cursor < 0) return undefined;
    const part = parsed === undefined ? undefined : { parsed, checkpoint: part_reference_checkpoint(value, cursor) };
    return { source: value, cursor, map, quoted, quoteMissing: quoted && !closed, escapedSigil: literalSigils?.has(0) ?? false,
      hasPartReference, part, operation };
  }

  private fillOperand(start: number, end: number, base: EventSourceRole, parts: readonly EventSourceSpan[]): void {
    const points = [...new Set([start, end, ...parts.flatMap(span => [span.start, span.end])])].sort((a, b) => a - b);
    let active = 0;
    const semantic = parts.filter(span => span.role !== "escape");
    const escapes = parts.filter(span => span.role === "escape").sort((a, b) => a.start - b.start);
    let escape = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      while (semantic[active] !== undefined && semantic[active]!.end <= a) active++;
      while (escapes[escape] !== undefined && escapes[escape]!.end <= a) escape++;
      const role = escapes[escape]?.start !== undefined && escapes[escape]!.start <= a ? "escape"
        : semantic[active]?.start !== undefined && semantic[active]!.start <= a ? semantic[active]!.role : base;
      this.role(role, a, b);
    }
  }
}

/** The attribute scanner has bounded the operand. Map its decoded JSON units back to authored bytes. */
function decodeQuotedPrefix(raw: string) {
  const boundaries = [0];
  const escapes: EventRange[] = [];
  let value = "";
  let complete = true;
  for (let start = 0; start < raw.length;) {
    let end = start + 1;
    if (raw[start] === "\\") {
      if (raw[end] === "u") {
        end++;
        while (end < start + 6 && /^[0-9A-Fa-f]$/.test(raw[end] ?? "")) end++;
      } else end = Math.min(raw.length, end + 1);
      escapes.push({ start, end });
      if (complete) {
        try { value += JSON.parse('"' + raw.slice(start, end) + '"'); }
        catch { complete = false; }
      }
    } else if (complete) value += raw[start];
    if (complete) boundaries.push(end);
    start = end;
  }
  return { boundaries, value, escapes, complete };
}
