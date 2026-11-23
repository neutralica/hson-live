import { PART_DECLARATION, PART_LOCAL_REFERENCE_MIGRATION, is_part_parameter_name, is_part_scalar_argument, part_argument_name, type PartArgumentKind, part_declaration_issue, part_direction_issue, part_reference_checkpoint, scan_part_reference, whole_part_reference, part_structural_reference, type PartReference } from "../../../internal/part-placeholder.js";
import { admit_hson_number } from "../../../core/hson-number.js";
import { escape_cross_slot_part_references } from "../../../internal/part-scalar-source.js";
import { serialize_primitive_hson } from "../utils/primitive-utils/serialize-primitive.utils.js";
import { decode_hson_content_string } from "../../../core/hson-content-string.js";
import { HSON_MAX_NESTING, HSON_SYS_PREFIX, OBJ_TAG } from "../../../core/constants.js";
import {
  CREATE_ARR_CLOSE_TOKEN,
  CREATE_ARR_OPEN_TOKEN,
  CREATE_EMPTY_OBJ_TOKEN,
  CREATE_END_TOKEN,
  CREATE_OPEN_TOKEN,
  CREATE_TEXT_TOKEN,
} from "../token-factories.js";
import { ARR_SYMBOL, CLOSE_KIND } from "../token.types.js";
import type { ArraySymbol, CloseKind, Position, RawAttr, Tokens, AuthoredQuadDeclaration } from "../token.types.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";
import { read_transform_error_details } from "../../../core/errors.js";
import { is_persisted_quid } from "../../../core/hson-node-quid.js";
import {
  is_hson_bare_name_char,
  is_hson_bare_name_start,
  is_valid_hson_data_name,
} from "../../../core/hson-name.js";
import { assert_authored_hson_source_name } from "../utils/hson-utils/hson-source-name.js";
import { AUTHORED_EVENT_FLAGS, AUTHORED_EVENT_TAG } from "../../../core/authored-event-names.js";
import { scan_formdata_operation } from "../../../internal/event-operation-source.js";
import { AUTHORED_EVENT_NAMES, EVENT_ARGUMENT_QUALIFIERS, type EventArgumentQualifier } from "../../../internal/event-argument-plan.js";
import { EventAuthoringObserver, event_destination_domain, type EventAuthoringObservation } from "../../../internal/event-authoring-source.js";
import type {
  HsonSourceLexicalCollector,
  HsonTokenSourceEvidence,
} from "../../../internal/hson-source-provenance/hson-source-provenance.js";

const NUMBER_LITERAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const HSON_TRIVIA = new Set([" ", "\t", "\n", "\r"]);
type EditorStringObservation = { value: string; boundaries: number[] };

export type HsonTemplateSlot = Readonly<{ offset: number; substitution: number }>;
export type HsonEditorMode = "canonical" | "data" | "document" | "schema";
export type HsonEditorDataFact = Readonly<{
  path: readonly (string | number)[];
  range: Readonly<{ start: number; end: number }>;
} & ({ kind: "scalar"; value: string | number | boolean | null } | { kind: "object" | "array" | "unknown" | "member" })>;
export type HsonGrammarCheckpoint = Readonly<{
  kind: "member" | "value" | "tag" | "header" | "child" | "attribute-value" | "parameter";
  path: readonly (string | number)[];
  existing: readonly string[];
  range: Readonly<{ start: number; end: number }>;
  openContainers: readonly ("object" | "array" | "element")[];
  rootType?: "data" | "document";
  /** Interior of a scanner-proven quoted value, including an unfinished EOF value. */
  quoted?: Readonly<{ complete: boolean; closingDelimiters: readonly string[] }>;
  /** Authored data observed by the scanner; interpolation values remain unknown. */
  dataFacts?: readonly HsonEditorDataFact[];
  /** Incomplete source at a Schema root member checkpoint. */
  schemaContinuation?: "missing-operand" | "unterminated";
  /** Scanner-confirmed closing delimiter for a complete Schema envelope. */
  schemaRootClose?: number;
  /** Scanner-owned header observation, including attributes after the cursor. */
  element?: Readonly<{ tag: string; start: number; attributes: readonly RawAttr[]; contentTags: readonly string[] }>;
  attribute?: string;
  /** Lexical observation only; consumers establish semantic Part placement. */
  parameter?: Readonly<{ complete: boolean; prefix: string; namespace: "incoming" | "local"; optional?: true; structural?: boolean; rawAttribute?: RawAttr }>;
  /** Grammar slot only: an occupied value has not yet established an edit range. */
  pendingValue?: boolean;
}>;
export type HsonInterpolationRole = "canonical-value" | "data-value" | "document-content" | "quoted-string";

/** Observe the production scanner at a cursor, before incomplete suffixes fail. */
export function hson_grammar_checkpoint(
  source: string, cursor: number, mode: HsonEditorMode,
  slots: readonly HsonTemplateSlot[] = [],
): HsonGrammarCheckpoint | undefined {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > source.length || source.length > 128_000) return undefined;
  const stop = {};
  let result: HsonGrammarCheckpoint | undefined;
  const dataFacts: HsonEditorDataFact[] = [];
  const scanner = new HsonScanner(source, 0, undefined, mode === "data" || mode === "document" ? slots : slots.filter(slot => slot.offset < cursor),
    mode === "schema" ? "data" : mode, slots.map(() => ""), mode, cursor, checkpoint => {
      if (result === undefined || (mode === "document" || mode === "schema" && result.kind === "member" && result.path.length === 0) && result.kind === checkpoint.kind
        && result.range.start === result.range.end && checkpoint.range.start < checkpoint.range.end) result = checkpoint;
      // Schema root fields, Data discriminators and Document attributes may follow the cursor. Stop at
      // the first syntax failure, retaining only facts the scanner actually saw.
      if (mode !== "data" && mode !== "document" && !(mode === "schema" && result.kind === "member" && result.path.length === 0)) throw stop;
    }, undefined, undefined, mode === "document", fact => { dataFacts.push(fact); });
  try { scanner.scan(); } catch (error) {
    if (error !== stop && result === undefined) return undefined;
    const details = read_transform_error_details(error);
    const code = details?.code;
    if ((mode === "data" || mode === "schema") && code === "HSON_OBJECT_DUPLICATE_MEMBER") return undefined;
    if (mode === "schema" && result?.kind === "member" && result.path.length === 0) {
      if (code === "HSON_CONTAINER_UNTERMINATED") return { ...result, schemaContinuation: "unterminated", dataFacts };
      // A missing operand is editable only at the observed name. An error in
      // a nested operand may still hide later siblings of the root.
      if (code === "missing-object-member-value" && details?.source?.index === result.range.start) {
        return { ...result, schemaContinuation: "missing-operand", dataFacts };
      }
      return undefined;
    }
  }
  if (result && (mode === "data" || mode === "schema" && result.kind === "member" && result.path.length === 0)) {
    return { ...result, dataFacts, ...(mode === "schema" && scanner.schemaRootClose !== undefined
      ? { schemaRootClose: scanner.schemaRootClose } : {}) };
  }
  return result;
}

/** Observe roles only on original source and complete slots; recover in place. */
export function hson_interpolation_roles(source: string, mode: HsonEditorMode, slots: readonly HsonTemplateSlot[]): readonly (HsonInterpolationRole | undefined)[] {
  const roles: (HsonInterpolationRole | undefined)[] = Array(slots.length).fill(undefined);
  if (mode === "schema" || source.length > 128_000) return roles;
  const substitutions = slots.map(() => "");
  const scanner = new HsonScanner(source, 0, undefined, slots, mode, substitutions, mode, undefined, undefined,
    (index, role) => { roles[index] = role; }, index => { roles[index] = undefined; }, mode === "document");
  // Callbacks retain observed evidence even when scanning stops. Unreached slots
  // stay unknown: truncating source or slots could change their grammar.
  try { scanner.scan(); } catch { /* A later syntax error does not erase earlier proven roles. */ }
  return roles;
}

/** Preserve raw authored source and private substitution boundaries. */
export function scan_hson_template_segments(
  raw: readonly string[],
  substitutions: readonly unknown[],
): Readonly<{ source: string; slots: readonly HsonTemplateSlot[] }> {
  let source = "";
  const slots: HsonTemplateSlot[] = [];
  for (let index = 0; index < substitutions.length; index += 1) {
    source += raw[index]!;
    slots.push({ offset: source.length, substitution: index });
  }
  source += raw[substitutions.length] ?? "";
  return { source, slots };
}

function isHsonTrivia(value: string): boolean {
  return HSON_TRIVIA.has(value);
}

function isUnsupportedWhitespace(value: string): boolean {
  return value !== "" && /\p{White_Space}/u.test(value) && !isHsonTrivia(value);
}

type AttributeOperand = Readonly<{ end: number } & (
  { kind: "quoted" | "reference" | "selector" }
  | { kind: "invalid"; code: string; message: string; unterminatedQuotedKey?: boolean }
)>;

/** Source-only classification shared with closer lookahead. Receiving semantics
 * remain with Part admission; only invocation coordinates admit bare literals. */
function classifyAttributeOperand(source: string, start: number,
  { tag, name, framing = false }: { tag?: string; name?: string; framing?: boolean } = {}): AttributeOperand {
  if (source[start] === '"') return { kind: "quoted", end: start };
  let end = start;
  let references = 0;
  while (end < source.length) {
    const ch = source[end]!;
    if (source.startsWith("%{", end) || source.startsWith("^{", end) || source.startsWith("#{", end)) {
      const legacy = source.startsWith("#{", end);
      const reference = scan_part_reference(source, end);
      if (reference === undefined) {
        // Admission measures the rejected operand for diagnostics. Framing
        // stops at the failed sigil so the enclosing walk sees its delimiters.
        let quotedKey = false;
        while (!framing && end < source.length) {
          const recoveryChar = source[end]!;
          if (quotedKey) {
            if (recoveryChar === "\\") { end = Math.min(end + 2, source.length); continue; }
            if (recoveryChar === '"') quotedKey = false;
          } else {
            if (recoveryChar === "[" && source[end + 1] === '"') {
              quotedKey = true;
              end += 2;
              continue;
            }
            if (isHsonTrivia(recoveryChar) || isUnsupportedWhitespace(recoveryChar)
              || /[<>"]/.test(recoveryChar) || source.startsWith("/>", end) || source.startsWith("//", end)) break;
          }
          end++;
        }
        return { kind: "invalid", end, code: "HSON_PART_REFERENCE_INVALID", unterminatedQuotedKey: quotedKey,
          message: legacy ? PART_LOCAL_REFERENCE_MIGRATION : "Invalid or incomplete Part reference in attribute value." };
      }
      references++;
      end = reference.end;
      continue;
    }
    if (isHsonTrivia(ch) || isUnsupportedWhitespace(ch) || /[<>"'`«»\[\]]/.test(ch)
      || source.startsWith("/>", end) || (framing || references > 0) && source.startsWith("//", end)) break;
    end++;
  }
  const text = source.slice(start, end);
  const boundary = end === source.length || isHsonTrivia(source[end]!) || source.startsWith("/>", end)
    || references > 0 && source.startsWith("//", end) || source[end] === '"' || source[end] === "<";
  if (references !== 0) {
    if (boundary && whole_part_reference(text) !== undefined) return { kind: "reference", end };
    return { kind: "invalid", end, code: "HSON_ATTRIBUTE_QUOTES_REQUIRED",
      message: "Partial attribute interpolation requires double quotes; only one complete Part reference may stand bare." };
  }
  if (tag?.toLowerCase() === "hson-part" && (name === "lib" || name === "at")) {
    const segments = text.split("/");
    if (boundary && segments.length <= (name === "lib" ? 1 : 2)
      && segments.every(segment => segment.length > 0 && !/[\\{}=]/.test(segment))) {
      return { kind: "selector", end };
    }
    return { kind: "invalid", end, code: "HSON_PART_SELECTOR_INVALID",
      message: `Invalid bare ${name} selector; use a ${name === "lib" ? "Library name" : "member or Library/member"}, or double-quote the value.` };
  }
  return { kind: "invalid", end, code: text.includes("=") ? "HSON_ELEMENT_ATTRIBUTE_VALUE_INVALID" : "HSON_ATTRIBUTE_QUOTES_REQUIRED",
    message: text.includes("=") ? "Malformed unquoted attribute value." : "Literal attribute values require double quotes." };
}

/**
 * Tokenize Hson with one absolute, newline-agnostic source cursor.
 *
 * Physical line boundaries are ordinary whitespace except inside a quoted
 * string and after `//`. Nested elements, object values, and arrays recurse
 * through this scanner without slicing or rebasing the source. Each complete
 * angle construct is closer-classified before its body is lowered.
 */
export function tokenize_hson(
  hson: string,
  depth = 0,
  collector?: HsonSourceLexicalCollector,
  templateSlots: readonly HsonTemplateSlot[] = [],
  interpolationMode?: "canonical" | "document" | "data",
  substitutions: readonly unknown[] = [],
  editorMode?: HsonEditorMode,
): Tokens[] {
  if (depth < 0 || depth >= HSON_MAX_NESTING) {
    _throw_transform_err(
      `Hson nesting depth must be between 0 and ${HSON_MAX_NESTING - 1}`,
      "tokenize_hson",
    );
  }

  return new HsonScanner(hson, depth, collector, templateSlots, interpolationMode, substitutions, editorMode).scan();
}

/** Editor-only framing. A closed element may still fail its own parse. */
export function completed_hson_element_ranges(source: string, slots: readonly HsonTemplateSlot[]) {
  const ranges: { start: number; end: number }[] = [];
  const scanner = new HsonScanner(source, 0, undefined, slots, "document", slots.map(() => ""));
  try {
    scanner.scan((start, end) => ranges.push({ start, end }));
  } catch {
    // Without a scanner-proven closer the remaining source has unknown nesting.
  }
  return ranges;
}

/** Explicit authored document-Library context; ordinary scanners retain their grammar. @internal */
export function tokenize_authored_document_library(hson: string, collector?: HsonSourceLexicalCollector,
  template?: Readonly<{ slots: readonly HsonTemplateSlot[]; substitutions: readonly unknown[] }>,
): Tokens[] {
  return new HsonScanner(hson, 0, collector, template?.slots, template === undefined ? undefined : "document",
    template?.substitutions, template === undefined ? undefined : "document", undefined, undefined, undefined, undefined, true).scan();
}

type EventArgumentToken = Readonly<{
  name: string;
  qualifier: EventArgumentQualifier;
  header: Position;
  start: Position;
  end: Position;
  operand: { kind: "quoted"; raw: string } | { kind: "reference"; reference: PartReference }
    | { kind: "data"; tokens: Tokens[] }
    | { kind: "operation"; operation: NonNullable<ReturnType<typeof scan_formdata_operation>> };
}>;

/** Dedicated authored event envelope. Only the inline Data operand emits Hson tokens. @internal */
export function tokenize_authored_event(source: string) {
  return new HsonScanner(source, 0).scanEventDeclaration();
}

/** @internal Lexical access for declaration readers. */
export function hson_lexical_cursor(source: string) {
  return new HsonScanner(source, 0).lexicalCursor();
}

/** Check the boundary that will follow a completed whole Event operand. @internal */
export function authored_event_operand_ends_at(source: string, end: number, quoted: boolean): boolean {
  if (end === source.length) return true;
  if (quoted && source[end++] !== '"') return false;
  return end === source.length || isHsonTrivia(source[end]!) || source.startsWith("//", end) || source[end] === "<";
}

function event_argument_header(raw: string) {
  const [name, type, extra] = raw.split(":");
  const argument = name !== undefined && extra === undefined && is_part_parameter_name(name) && is_valid_hson_data_name(name)
    ? name : undefined;
  return { argument, qualifier: EVENT_ARGUMENT_QUALIFIERS.find(qualifier => qualifier === type), type };
}

/** Observe source roles and a single editable slot without admitting an Event. @internal */
export function observe_authored_event(source: string, cursor?: number, incompleteHead?: Readonly<{
  openingOffset: number; nameRange: Readonly<{ start: number; end: number }>;
}>): EventAuthoringObservation {
  const observer = new EventAuthoringObserver(source, cursor);
  if (incompleteHead !== undefined) {
    observer.head(incompleteHead.openingOffset, incompleteHead.nameRange.start, incompleteHead.nameRange.end, false);
  }
  const scanner = new HsonScanner(source, 0, {
    recordAttribute() {},
    recordToken(token, { roles }) {
      for (const range of [roles.open, roles.close]) {
        if (range !== undefined) observer.role("dataPunctuation", range.start, range.end);
      }
      if (roles.name !== undefined) observer.role("dataMember", roles.name.start, roles.name.end);
      if (token.kind === "TEXT" && roles.value !== undefined) {
        const { start, end } = roles.value;
        if (source[start] === '"') observer.quotedString(start, end, true);
        else observer.role(source[start] === "n" ? "dataValue" : /[tf]/.test(source[start] ?? "") ? "boolean" : "number", start, end);
      }
    },
  });
  try { scanner.scanEventDeclaration(observer); }
  catch { /* Keep the scanner's proven prefix while a declaration is under edit. */ }
  return observer.finish();
}

class HsonScanner {
  private readonly tokens: Tokens[] = [];
  private index = 0;
  private line = 1;
  private col = 1;
  private nextSlot = 0;
  private eventObserver: EventAuthoringObserver | undefined;

  public constructor(
    private readonly source: string,
    private readonly initialDepth: number,
    private readonly collector?: HsonSourceLexicalCollector,
    private readonly templateSlots: readonly HsonTemplateSlot[] = [],
    private readonly interpolationMode?: "canonical" | "document" | "data",
    private readonly substitutions: readonly unknown[] = [],
    private readonly editorMode?: HsonEditorMode,
    private readonly editorCursor?: number,
    private readonly editorCheckpoint?: (checkpoint: HsonGrammarCheckpoint) => void,
    private readonly editorSlot?: (index: number, role: HsonInterpolationRole) => void,
    private readonly editorRejectedSlot?: (index: number) => void,
    private readonly authoredQuads = false,
    private readonly editorDataFact?: (fact: HsonEditorDataFact) => void,
  ) {}
  private readonly editorPath: (string | number)[] = [];
  private readonly editorContainers: ("object" | "array" | "element")[] = [];
  private readonly editorClosingDelimiters: string[] = [];
  private editorExisting: readonly string[] = [];
  private editorRootType: "data" | "document" | undefined;
  schemaRootClose: number | undefined;
  private editorCommentEof = false;
  private editorElement: HsonGrammarCheckpoint["element"];
  private editorAttribute: string | undefined;

  public lexicalCursor() {
    return {
      offset: () => this.index,
      position: () => this.position(),
      peek: () => this.peek(),
      consume: (delimiter: string) => this.consumeExpected(delimiter),
      triviaAhead: () => isHsonTrivia(this.peek()) || this.startsWith("//"),
      skipTrivia: () => this.skipTrivia(),
      bareName: () => this.scanBareName("name"),
      quotedName: () => this.scanQuotedName(),
      headerText: (name: string): string => JSON.parse('"' + this.scanAttributeString(name).text + '"'),
      emptyObjectAhead: () => this.peek() === "<" && this.nextNonTriviaIs(">", this.index + 1),
      assertNesting: (depth: number) => this.assertNesting(depth),
      // Bound one value exactly as for an inline Data operand. Admission of that
      // slice still belongs to the canonical Data reader, including QUID checks.
      dataSource: () => {
        const start = this.index, first = this.tokens.length;
        this.scanObjectMemberValue(0, "operand", "}");
        this.tokens.length = first;
        return this.source.slice(start, this.index);
      },
      arrayItems: (depth: number, readItem: () => void) => {
        const first = this.tokens.length;
        this.scanArray(depth, readItem);
        this.tokens.length = first;
      },
    };
  }

  public scanEventDeclaration(observer?: EventAuthoringObserver): Readonly<{
    start: Position;
    flags: ReadonlyMap<string, Position>;
    args: readonly EventArgumentToken[];
  }> {
    this.eventObserver = observer;
    const code = "HSON_EVENT_DECLARATION_INVALID";
    const invalid = (message: string, at = this.position()): never => this.fail(message, at, code);
    this.skipTrivia();
    const start = this.position();
    if (this.peek() !== "<") {
      observer?.emptyHead(this.index);
      invalid("Expected one literal <hson:event declaration.");
    }
    this.consumeExpected("<");
    this.skipTrivia();
    const headStart = this.index;
    if (!this.startsWith(AUTHORED_EVENT_TAG)) invalid("Expected one literal <hson:event declaration.");
    if (this.scanBareName("event tag") !== AUTHORED_EVENT_TAG) invalid("Expected one literal <hson:event declaration.");
    observer?.head(start.index, headStart, this.index, true);
    const flags = new Map<string, Position>();
    const args: EventArgumentToken[] = [];
    const names = new Map<string, Position>();
    const completing = observer !== undefined;
    const headerTrivia = (): boolean => {
      const start = this.index;
      const separated = this.skipTrivia();
      observer?.gap(start, this.index);
      return separated;
    };
    let separated = headerTrivia();
    while (this.peek() !== "<") {
      if (this.atEnd() || this.peek() === ">" || this.startsWith("/>")) {
        observer?.endHeader(this.index, this.atEnd() ? "missing" : this.peek() === ">" ? "outer-present" : undefined);
        invalid("An authored event requires an outcome object <>.");
      }
      if (!separated) invalid("Expected trivia between authored event header items.");
      const at = this.position();
      const raw = this.scanBareName("event header item");
      const gapStart = this.index;
      separated = this.skipTrivia();
      const hasValue = this.peek() === "=";
      const { argument, qualifier, type: qualifierText } = event_argument_header(raw);
      const namedArgument = argument !== undefined && qualifier !== undefined;
      // Continue across recoverable items so edits can account for tokens on both sides.
      observer?.header(at.index, raw, hasValue, argument, hasValue ? this.index : undefined);
      if (!hasValue) observer?.gap(gapStart, this.index);
      if (!hasValue && (AUTHORED_EVENT_FLAGS.has(raw) || raw.startsWith("on:") || event_destination_domain(raw) !== undefined)) {
        const first = flags.get(raw);
        if (first !== undefined && !completing) this.fail(`Duplicate authored event header item ${JSON.stringify(raw)}.`, at, code,
          [{ role: "first-declaration", pos: first }]);
        flags.set(raw, at);
        continue;
      }

      if (!namedArgument && !completing) {
        if (!hasValue && qualifierText !== "doc") invalid(`Unsupported authored event header item ${JSON.stringify(raw)}. Named arguments use name:type=value.`, at);
        return invalid(`Invalid Event argument ${JSON.stringify(raw)}. Use name:str, name:num, name:bool, name:arr, or name:data followed by a value.`, at);
      }
      if (namedArgument) {
        const first = names.get(argument);
        if (first !== undefined && !completing) this.fail(`Duplicate Event argument ${JSON.stringify(argument)}.`, at, code,
          [{ role: "first-declaration", pos: first }]);
        names.set(argument, at);
      }
      if (!hasValue) {
        if (completing) continue;
        invalid(`Expected a value after ${raw}=.`, at);
      }
      observer?.role("assignment", this.index);
      this.consumeExpected("=");
      const operandGap = this.index;
      separated = this.skipTrivia();
      const valueStart = this.position();
      if (observer !== undefined && (this.eventHeaderEnd(this.index)
        || separated && this.eventHeaderAhead(this.index) !== undefined)) {
        // Keep the entire editable trivia interval after a missing operand.
        if (namedArgument) observer.operand(qualifier, "missing", operandGap, valueStart.index, true);
        continue;
      }
      let operand: EventArgumentToken["operand"];
      if (this.peek() === "{" && (qualifier === "data" || qualifier === "arr" || qualifier === "bool" || completing)) {
        const firstToken = this.tokens.length;
        let closed = false, empty = false;
        try {
          observer?.role("dataPunctuation", this.index);
          this.consumeExpected("{");
          this.skipTrivia();
          if (this.peek() === "}") {
            if (!completing) invalid(`${raw} requires one Hson Data value.`);
            observer?.role("dataPunctuation", this.index);
            this.consumeExpected("}");
            closed = true;
            empty = true;
            continue;
          }
          this.scanObjectMemberValue(1, raw, "}");
          this.skipTrivia();
          if (this.peek() !== "}") invalid(`${raw} requires one Hson Data value followed by }.`);
          observer?.role("dataPunctuation", this.index);
          this.consumeExpected("}");
          closed = true;
          operand = { kind: "data", tokens: this.tokens.slice(firstToken) };
        } finally {
          if (namedArgument && observer !== undefined) {
            observer.operand(qualifier, "data", valueStart.index, !closed && this.peek() === "}" ? this.index + 1 : this.index,
              this.atEnd() || closed || this.peek() === "}", closed || this.peek() === "}");
          }
          if (empty) separated = headerTrivia();
        }
      } else if (this.peek() === '"') {
        let value: string | undefined;
        let failure: unknown;
        try {
          value = this.scanAttributeString(raw, qualifier === "str" || qualifier === "num" ? qualifier : undefined).text;
        } catch (cause) {
          if (observer === undefined) throw cause;
          failure = cause;
        }
        if (observer !== undefined) {
          const code = read_transform_error_details(failure)?.code;
          const newline = code === "HSON_STRING_CONTROL_UNESCAPED" && this.isNewline() ? this.index : undefined;
          const close = value !== undefined ? this.index : this.atEnd() ? undefined : this.structuralBoundary(valueStart, '"', true)?.end;
          const boundedQuote = close !== undefined && this.eventOperandBoundary(close);
          // Framing owns a closing quote at an operand boundary, even
          // when the strict reader stops inside the string. Probe only
          // when framing could not establish a bounded close.
          const wordEnd = !boundedQuote && namedArgument && qualifier === "bool" && (newline !== undefined || value !== undefined
            || code === "HSON_STRING_UNTERMINATED") ? this.eventBooleanWordEnd(valueStart.index) : undefined;
          if (wordEnd !== undefined && this.confirmEventBooleanBoundary(wordEnd, close === undefined ? undefined : close - 1, newline)) {
            observer.operand("bool", "quoted", valueStart.index, wordEnd, true, false);
            this.index = wordEnd;
            this.line = valueStart.line;
            this.col = valueStart.col + wordEnd - valueStart.index;
            separated = headerTrivia();
            continue;
          }
          if (value === undefined && (close !== undefined || code === "invalid-json-escape" || code === "HSON_STRING_CONTROL_UNESCAPED")) {
            observer.quotedString(valueStart.index, close ?? this.source.length, close !== undefined);
            if (!boundedQuote || close === undefined) throw failure;
            while (this.index < close) this.consume();
            separated = headerTrivia();
            continue;
          }
          if (namedArgument) observer.operand(qualifier, "quoted", valueStart.index, this.index,
            boundedQuote || value === undefined && this.atEnd(), value !== undefined);
        }
        if (value === undefined) throw failure;
        operand = { kind: "quoted", raw: value };
      } else if (this.startsWith("^{formdata:")) {
        let operation;
        let end = valueStart.index;
        try {
          operation = scan_formdata_operation(this.source, this.index, observer === undefined ? undefined : (_segment, _start, to) => { end = to; });
        } catch (cause) {
          if (!completing) return invalid(cause instanceof Error ? cause.message : String(cause), valueStart);
          if (this.source[end] === "}") end++;
          const bounded = authored_event_operand_ends_at(this.source, end, false);
          if (namedArgument) observer.operand(qualifier, "bare", valueStart.index, end, bounded);
          if (!bounded) return invalid("Expected a FormData Event operation.", valueStart);
          while (this.index < end) this.consume();
          separated = headerTrivia();
          continue;
        }
        if (operation === undefined) return invalid("Expected a FormData Event operation.", valueStart);
        while (this.index < operation.reference.end) this.consume();
        const bounded = authored_event_operand_ends_at(this.source, this.index, false);
        if (namedArgument) observer?.operand(qualifier, "bare", valueStart.index, this.index, bounded);
        if (!bounded) invalid("A FormData operation must occupy the whole Event argument.", valueStart);
        operand = { kind: "operation", operation };
      } else {
        const classified = classifyAttributeOperand(this.source, valueStart.index);
        const reference = classified.kind === "reference" ? scan_part_reference(this.source, valueStart.index) : undefined;
        if (namedArgument) observer?.operand(qualifier, "bare", valueStart.index, classified.end,
          authored_event_operand_ends_at(this.source, classified.end, false) && (classified.kind !== "invalid"
            || !classified.unterminatedQuotedKey || classified.end === this.source.length));
        if (reference === undefined) {
          if (completing && !(classified.kind === "invalid" && classified.unterminatedQuotedKey)
            && (classified.end > this.index || this.atEnd() || this.peek() === "<")) {
            // The operand classifier bounds malformed bare values and references.
            // Resume at the next header item without interpreting operand text as flags.
            while (this.index < classified.end) this.consume();
            separated = headerTrivia();
            continue;
          }
          const expected = qualifier === "data" ? "{Hson Data}" : "a double-quoted literal";
          const message = this.startsWith("#{") ? PART_LOCAL_REFERENCE_MIGRATION
            : `Expected ${expected} or one whole Part reference for ${raw}.`;
          const { end } = classified;
          return this.fail(message, valueStart, code, end > valueStart.index
            ? [{ role: "value-end", pos: this.positionAt(end) }] : undefined);
        }
        while (this.index < reference.end) this.consume();
        operand = { kind: "reference", reference };
      }
      if (namedArgument) args.push({ name: argument, qualifier, header: at, start: valueStart, end: this.position(), operand });
      separated = headerTrivia();
    }
    observer?.endHeader(this.index);
    observer?.role("outcomeOpen", this.index);
    this.consumeExpected("<");
    const outcomeStart = this.index;
    this.skipTrivia();
    if (this.peek() !== ">") {
      if (this.atEnd()) observer?.closer("outcomeClose", outcomeStart, this.index);
      invalid("Nonempty authored event outcomes are unsupported. Use <>.");
    }
    observer?.role("outcomeClose", this.index);
    this.consumeExpected(">");
    const outerStart = this.index;
    this.skipTrivia();
    if (this.peek() !== ">") {
      if (this.atEnd()) observer?.closer("declarationClose", outerStart, this.index);
      invalid("Expected > after the single authored event outcome object.");
    }
    observer?.role("declarationClose", this.index);
    this.consumeExpected(">");
    this.skipTrivia();
    if (!this.atEnd()) invalid("Expected exactly one authored event declaration.");
    return { start, flags, args };
  }

  private slotHere(): HsonTemplateSlot | undefined {
    const slot = this.templateSlots[this.nextSlot];
    return slot?.offset === this.index ? slot : undefined;
  }

  private emitSlot(context: "canonical-value" | "document-content" | "data-value"): void {
    const slot = this.slotHere();
    if (slot === undefined) return;
    if (this.interpolationMode !== "canonical" && context !== (this.interpolationMode === "document" ? "document-content" : "data-value")) {
      this.rejectSlot(context === "document-content" ? "document content under a data tag" : "a data value under a document tag");
    }
    this.editorSlot?.(slot.substitution, context);
    this.observeData({ kind: "unknown" }, this.index);
    this.emit({ kind: "INTERPOLATION_SLOT", slot: slot.substitution, context, pos: this.position() });
    this.nextSlot += 1;
  }

  private rejectSlot(where: string): never {
    this.fail(`interpolation cannot appear in ${where}`, this.position(), "HSON_INTERPOLATION_POSITION_INVALID");
  }

  /** Only role discovery may discard a boundary inside an already-known lexeme. */
  private recoverRejectedSlots(): boolean {
    if (this.editorRejectedSlot === undefined) return false;
    let recovered = false;
    for (let slot = this.slotHere(); slot !== undefined; slot = this.slotHere()) {
      this.editorRejectedSlot(slot.substitution);
      this.nextSlot += 1;
      recovered = true;
    }
    return recovered;
  }

  private quotedSlot(): { slot: number; value: string } {
    const slot = this.slotHere();
    if (slot === undefined) this.rejectSlot("a quoted string");
    const candidate = this.substitutions[slot.substitution];
    let value: string;
    if (typeof candidate === "string") value = candidate;
    else if (candidate === null || typeof candidate === "boolean" || typeof candidate === "number") {
      if (typeof candidate === "number" && !Number.isFinite(candidate)) {
        this.fail("quoted interpolation requires a finite number", this.position(), "HSON_NUMBER_NONFINITE");
      }
      value = serialize_primitive_hson(typeof candidate === "number" ? admit_hson_number(candidate) : candidate);
    } else this.fail("quoted interpolation requires a primitive string, finite number, boolean, or null", this.position(), "HSON_QUOTED_INTERPOLATION_STRING_REQUIRED");
    this.nextSlot += 1;
    return { slot: slot.substitution, value };
  }

  private emit<TToken extends Tokens>(token: TToken): TToken {
    this.tokens.push(token);
    return token;
  }

  private recordToken(token: Tokens, evidence: HsonTokenSourceEvidence): void {
    this.collector?.recordToken(token, evidence);
  }

  private observeData(value: { kind: "scalar"; value: string | number | boolean | null } | { kind: "object" | "array" | "unknown" | "member" }, start: number): void {
    if (this.editorMode === "data" || this.editorMode === "schema" && this.editorPath.length === 1) this.editorDataFact?.({ ...value, path: [...this.editorPath], range: { start, end: this.index } });
  }

  private bareValueCheckpoint(start: number, raw: string): void {
    if (this.editorMode !== "data") return;
    // Only a complete primitive or its unambiguous keyword prefix is editable.
    if (isPrimitiveLiteral(raw) || ["true", "false", "null"].some(value => value.startsWith(raw))) this.completionSlot("value", start);
  }

  private completionSlot(kind: Parameters<NonNullable<HsonSourceLexicalCollector["completionSlot"]>>[0], start?: number, pendingValue = false): void {
    const occupiedDataValue = this.editorMode === "data" && kind === "value" && start === undefined
      && (this.slotHere() !== undefined || !this.atEnd() && ![">", "]", "»", ","].includes(this.peek()));
    if (this.editorCheckpoint !== undefined && !this.editorCommentEof && !occupiedDataValue) {
      let boundary = start ?? this.index;
      if (start === undefined) while (boundary > 0 && isHsonTrivia(this.source[boundary - 1])) boundary--;
      const cursor = this.editorCursor;
      if (cursor !== undefined && cursor >= boundary && cursor <= this.index) {
        this.editorCheckpoint({ kind, path: [...this.editorPath], existing: [...this.editorExisting],
          range: start === undefined ? { start: cursor, end: cursor } : { start: boundary, end: this.index },
          ...(this.editorElement === undefined ? {} : { element: this.editorElement }),
          ...(this.editorAttribute === undefined ? {} : { attribute: this.editorAttribute }),
          ...(pendingValue ? { pendingValue: true } : {}),
          openContainers: [...this.editorContainers], ...(this.editorRootType === undefined ? {} : { rootType: this.editorRootType }) });
      }
    }
    if (this.collector?.completionSlot === undefined) return;
    if (start !== undefined) {
      this.collector.completionSlot(kind, { start, end: this.index });
      return;
    }
    // Only trivia at a grammar boundary, never comments or guessed token text.
    let boundary = this.index;
    while (boundary > 0 && isHsonTrivia(this.source[boundary - 1])) boundary--;
    this.collector.completionSlot(kind, { start: boundary, end: this.index });
  }

  public scan(onElementRange?: (start: number, end: number) => void): Tokens[] {
    const framing = onElementRange !== undefined;
    while (true) {
      this.skipTrivia(framing);
      // A data checkpoint belongs to one root value. Trailing roots cannot
      // contribute discriminator facts at the same logical paths.
      if (this.editorCheckpoint !== undefined && this.editorMode === "data" && this.tokens.length > 0) return this.tokens;
      this.completionSlot("value");
      if (this.slotHere() !== undefined) {
        this.emitSlot(this.interpolationMode === "canonical" ? "canonical-value" : this.interpolationMode === "document" ? "document-content" : "data-value");
        continue;
      }
      if (this.atEnd()) {
        if (this.nextSlot !== this.templateSlots.length) this.rejectSlot("a completed Hson value");
        return this.tokens;
      }

      const ch = this.peek();
      if (onElementRange && (ch === "<" || ch === "[" || ch === "«" || ch === '"' || ch === "'")) {
        const start = this.index;
        const boundary = this.structuralBoundary(this.position(), ch);
        if (boundary.kind === CLOSE_KIND.elem) onElementRange(start, boundary.end);
        while (this.nextSlot < this.templateSlots.length && this.templateSlots[this.nextSlot]!.offset < boundary.end) this.nextSlot++;
        while (this.index < boundary.end) this.consume();
      } else if (ch === "<") {
        this.scanAngle(this.initialDepth);
      } else if (ch === "«" || ch === "[") {
        this.scanArray(this.initialDepth);
      } else if (ch === `"`) {
        const pos = this.position();
        const value = this.scanContentString();
        const token = this.emit({ ...CREATE_TEXT_TOKEN(value.raw, true, pos), ...(value.directValue === undefined ? {} : { directValue: value.directValue }) });
        if (this.collector !== undefined) this.recordToken(token, {
          roles: { coverage: { start: pos.index, end: this.index }, value: { start: pos.index, end: this.index } },
        });
      } else if (ch === "'") {
        this.fail(
          `unsupported quote delimiter (use double quotes only)`,
          undefined,
          "HSON_QUOTE_KIND_UNSUPPORTED",
        );
      } else if (ch === "`") {
        this.rejectLegacyBacktick();
      } else if (framing && (ch === "/" || ch === "," || ch === "=")) {
        // Stray separators carry no nesting at the top level. skipTrivia
        // already checked the slash for a literal comment opener.
        this.consume();
      } else if (ch === ">" || ch === "/" || ch === "]" || ch === "»") {
        this.fail(
          this.tokens.length === 0
            ? `unexpected structural closer "${ch}"`
            : `trailing source begins with unexpected structural closer "${ch}"`,
          undefined,
          this.tokens.length === 0 ? "HSON_TOKENIZATION_ERROR" : "HSON_TRAILING_SOURCE",
        );
      } else {
        const pos = this.position();
        const raw = this.scanBareToken();
        // A top-level bare token ends at trivia, a delimiter, a slot or EOF.
        // Its spelling matters to admission, but cannot change nesting.
        if (framing) continue;
        this.bareValueCheckpoint(pos.index, raw);
        if (!isPrimitiveLiteral(raw)) {
          const numericDefect = classifyNumberDefect(raw);
          this.fail(
            numericDefect === undefined
              ? `unexpected bare token outside tag header: "${raw}"`
              : `invalid Hson number "${raw}"`,
            numericDefect === undefined
              ? pos
              : this.positionAt(pos.index + numericDefect.offset),
            this.tokens.length > 0 && numericDefect === undefined
              ? "HSON_TRAILING_SOURCE"
              : numericDefect?.code ?? "HSON_PRIMITIVE_TOKEN_INVALID",
          );
        }
        this.assertFiniteNumberLiteral(raw, pos);
        if (this.editorDataFact !== undefined) this.observeData({ kind: "scalar", value: JSON.parse(raw) }, pos.index);
        const token = this.emit(CREATE_TEXT_TOKEN(raw, undefined, pos));
        if (this.collector !== undefined) this.recordToken(token, {
          roles: { coverage: { start: pos.index, end: this.index }, value: { start: pos.index, end: this.index } },
        });
      }
    }
  }

  /**
   * Scan one complete angle construct. The matching closer is discovered from
   * raw source before the body is interpreted so object member names can never
   * be mistaken for element flags or attributes.
   */
  private scanAngle(depth: number): void {
    this.assertNesting(depth);
    const openPos = this.position();
    const closeKind = this.editorMode === undefined ? this.classifyAngleCloser(openPos) : this.editorAngleCloser(openPos);
    if (this.editorMode === "data" || this.editorMode === "schema") {
      if (closeKind !== CLOSE_KIND.obj) this.fail("element syntax is not a data value", openPos, "HSON_STRUCTURAL_MODE_CROSSING");
    } else if (this.editorMode === "document" && closeKind !== CLOSE_KIND.elem) {
      this.fail("object syntax is not document content", openPos, "HSON_STRUCTURAL_MODE_CROSSING");
    }
    this.consumeExpected("<");

    if (closeKind === CLOSE_KIND.obj) {
      this.observeData({ kind: "object" }, openPos.index);
      this.scanObjectAfterOpen(openPos, depth);
      return;
    }

    this.scanElementAfterOpen(openPos, depth);
  }

  private editorAngleCloser(openPos: Position): CloseKind {
    try { return this.classifyAngleCloser(openPos); }
    catch (error) {
      // Source-fact observation in an explicit Document region may advance to
      // the actual fault. Lookahead failure alone must not erase earlier headers.
      // This does not admit source; cursor edits still require lexical ranges.
      if (this.editorMode === "document" && this.collector?.elementHeader !== undefined) return CLOSE_KIND.elem;
      // The requested cursor ends inside this angle. Only the explicit semantic
      // tag mode may decide its unfinished grammar; canonical remains ambiguous.
      const code = read_transform_error_details(error)?.code;
      if (code !== "HSON_CONTAINER_UNTERMINATED"
        && !(code === "HSON_STRING_UNTERMINATED" && this.editorMode !== "canonical" && this.editorCursor === this.source.length)) throw error;
      if (this.editorMode === "data" || this.editorMode === "schema") return CLOSE_KIND.obj;
      if (this.editorMode === "document") return CLOSE_KIND.elem;
      throw error;
    }
  }

  /** Lower `name value` object members to the existing canonical token shape. */
  private scanObjectAfterOpen(openPos: Position, depth: number): void {
    this.editorContainers.push("object");
    this.editorClosingDelimiters.push(">");
    const previousExisting = this.editorExisting;
    this.editorExisting = [];
    this.completionSlot("member");
    if (this.slotHere() !== undefined) this.rejectSlot("an object member name");
    // Preserve the compact empty-object token used by existing parser APIs.
    if (this.peek() === ">") {
      this.consumeExpected(">");
      const token = this.emit(CREATE_EMPTY_OBJ_TOKEN("<>", undefined, openPos));
      if (this.collector !== undefined) this.recordToken(token, {
        roles: {
          coverage: { start: openPos.index, end: this.index },
          open: { start: openPos.index, end: openPos.index + 1 },
          close: { start: this.index - 1, end: this.index },
        },
      });
      this.editorContainers.pop();
      this.editorClosingDelimiters.pop();
      this.editorExisting = previousExisting;
      return;
    }

    this.skipTrivia(false, true);
    this.completionSlot("member");
    if (this.atEnd()) this.fail(`unterminated object`, openPos, "HSON_CONTAINER_UNTERMINATED");

    let quid: { value: string; start: Position; end: Position } | undefined;
    if (this.peek() === "@") {
      const quidPos = this.position();
      this.consumeExpected("@");
      if (this.atEnd() || isHsonTrivia(this.peek()) || this.peek() === ">") {
        this.fail(`missing persisted QUID value after "@"`, quidPos, "HSON_OBJECT_QUID_INVALID");
      }
      const value = this.scanBareToken();
      if (!is_persisted_quid(value)) {
        this.fail(`invalid persisted QUID "${value}"`, quidPos, "HSON_OBJECT_QUID_INVALID");
      }
      quid = { value, start: quidPos, end: this.previousPosition() };
      const separated = this.skipTrivia(false, true);
      if (this.peek() !== ">" && !separated) {
        this.fail(
          `required trivia is missing after persisted object QUID declaration`,
          this.position(),
          "HSON_REQUIRED_TRIVIA_MISSING",
        );
      }
    }

    const objectOpen = this.emit(CREATE_OPEN_TOKEN(OBJ_TAG, [], openPos, quid));
    if (this.collector !== undefined) this.recordToken(objectOpen, {
      roles: { open: { start: openPos.index, end: openPos.index + 1 } },
      coverageStart: openPos.index,
    });
    if (this.peek() === ">") {
      const closePos = this.position();
      this.consumeExpected(">");
      const token = this.emit(CREATE_END_TOKEN(CLOSE_KIND.obj, closePos));
      if (this.collector !== undefined) this.recordToken(token, {
        roles: { close: { start: closePos.index, end: closePos.index + 1 } },
        coverageEnd: closePos.index + 1,
      });
      return;
    }

    const declarations = new Map<string, Position>();
    while (true) {
      const namePos = this.position();
      this.completionSlot("member");
      if (this.slotHere() !== undefined) this.rejectSlot("an object member name");
      if (this.peek() === ",") {
        this.fail(`object members do not use commas`, namePos, "HSON_OBJECT_COMMA_FORBIDDEN");
      }
      if (
        this.peek() === `"` || this.peek() === "[" || this.peek() === "«"
        || this.peek() === "+" || this.peek() === "-" || /\d/.test(this.peek())
      ) {
        this.fail(
          `unexpected object value where a member name is required`,
          namePos,
          "HSON_OBJECT_EXTRA_VALUE",
        );
      }
      if (this.peek() === "@") {
        this.fail(
          `object members cannot author persisted QUID declarations`,
          namePos,
          "HSON_OBJECT_QUID_FORBIDDEN",
        );
      }
      if (this.peek() === "<" && namePos.index === openPos.index + 1) {
        this.fail(
          `legacy doubled object syntax is not supported; expected an object member name`,
          namePos,
          "legacy-doubled-object-syntax",
        );
      }
      if (this.startsWith("/>")) {
        this.fail(`objects must close with ">", not "/>"`, namePos, "HSON_STRUCTURAL_MODE_CROSSING");
      }
      if (this.peek() === ">") {
        this.fail(`unexpected object closer; expected an object member name`, namePos);
      }

      const quotedName = this.peek() === "'";
      const name = quotedName
        ? this.scanQuotedName()
        : this.scanBareName("object member name");
      const nameEnd = this.index;
      this.completionSlot("member", namePos.index);
      assert_authored_hson_source_name(name, namePos);
      // The edited name is removed by replacement. All other declarations
      // still participate in the scanner's ordinary duplicate check.
      const editingName = this.editorMode === "schema" && this.editorPath.length === 0 &&
        this.editorCursor !== undefined && this.editorCursor >= namePos.index && this.editorCursor <= nameEnd;
      const first = declarations.get(name);
      if (!editingName && first !== undefined) {
        this.fail(
          `[duplicate-object-member] duplicate Hson object member "${name}"; first declared at ${first.line}:${first.col} (index ${first.index})`,
          namePos,
          "HSON_OBJECT_DUPLICATE_MEMBER",
          [{ role: "first-declaration", pos: first }],
        );
      }
      if (!editingName) declarations.set(name, namePos);
      this.editorExisting = [...declarations.keys()];
      this.editorPath.push(name);
      this.observeData({ kind: "member" }, namePos.index);

      const separatedFromValue = this.skipTrivia();
      if (separatedFromValue) this.completionSlot("value");
      if (this.slotHere() === undefined && (this.atEnd() || this.peek() === ">")) {
        this.fail(`object member "${name}" is missing its value`, namePos, "missing-object-member-value");
      }
      const adjacentStructuralValue = !quotedName
        && (this.peek() === "<" || this.peek() === "«" || this.peek() === "[");
      if (!separatedFromValue && !adjacentStructuralValue) {
        this.fail(
          `required trivia is missing between object member name and value`,
          this.position(),
          "HSON_REQUIRED_TRIVIA_MISSING",
        );
      }
      if (this.peek() === "@") {
        this.fail(
          `object members cannot author persisted QUID declarations`,
          this.position(),
          "HSON_OBJECT_QUID_FORBIDDEN",
        );
      }

      const memberOpen = this.emit(CREATE_OPEN_TOKEN(name, [], namePos));
      if (this.collector !== undefined) this.recordToken(memberOpen, {
        roles: { name: { start: namePos.index, end: nameEnd } },
        coverageStart: namePos.index,
      });
      this.scanObjectMemberValue(depth + 1, name);
      this.editorPath.pop();
      const memberEnd = this.index;
      const memberClose = this.emit(CREATE_END_TOKEN(CLOSE_KIND.obj, this.previousPosition()));
      if (this.collector !== undefined) this.recordToken(memberClose, {
        roles: {},
        coverageEnd: memberEnd,
      });

      const separated = this.skipTrivia(false, true);
      if (separated) this.completionSlot("member");
      if (this.atEnd()) this.fail(`unterminated object`, openPos, "HSON_CONTAINER_UNTERMINATED");
      if (this.peek() === ">") {
        const closePos = this.position();
        if (this.editorMode === "schema" && this.editorContainers.length === 1) this.schemaRootClose = closePos.index;
        this.consumeExpected(">");
        const token = this.emit(CREATE_END_TOKEN(CLOSE_KIND.obj, closePos));
        if (this.collector !== undefined) this.recordToken(token, {
          roles: { close: { start: closePos.index, end: closePos.index + 1 } },
          coverageEnd: closePos.index + 1,
        });
        this.editorExisting = previousExisting;
        this.editorContainers.pop();
        this.editorClosingDelimiters.pop();
        return;
      }
      if (this.peek() === ",") {
        this.fail(`object members do not use commas`, this.position(), "HSON_OBJECT_COMMA_FORBIDDEN");
      }
      if (!separated) {
        this.fail(
          `required trivia is missing between sibling object members`,
          this.position(),
          "HSON_REQUIRED_TRIVIA_MISSING",
        );
      }
    }
  }

  private scanObjectMemberValue(depth: number, memberName: string, terminator?: "}"): void {
    this.assertNesting(depth);
    if (this.slotHere() !== undefined) { this.emitSlot("data-value"); return; }
    const ch = this.peek();
    if (ch === `"`) {
      const pos = this.position();
      const value = this.scanContentString();
      if (this.editorMode === "schema" && this.editorPath.length === 1) {
        try {
          const parsed: unknown = JSON.parse(value.raw);
          if (typeof parsed === "string") this.observeData({ kind: "scalar", value: parsed }, pos.index);
          if (memberName === "type" && (parsed === "data" || parsed === "document")) this.editorRootType = parsed;
        } catch { /* Invalid strings are handled by the scanner. */ }
      }
      const token = this.emit({ ...CREATE_TEXT_TOKEN(value.raw, true, pos), ...(value.directValue === undefined ? {} : { directValue: value.directValue }) });
      if (this.collector !== undefined) this.recordToken(token, {
        roles: { coverage: { start: pos.index, end: this.index }, value: { start: pos.index, end: this.index } },
      });
      return;
    }
    if (ch === "<") {
      const pos = this.position();
      if ((this.editorMode === undefined ? this.classifyAngleCloser(pos) : this.editorAngleCloser(pos)) !== CLOSE_KIND.obj) {
        this.fail(
          `object member "${memberName}" cannot contain an element-mode value`,
          pos,
          "HSON_STRUCTURAL_MODE_CROSSING",
        );
      }
      this.scanAngle(depth);
      return;
    }
    if (ch === "«" || ch === "[") {
      this.scanArray(depth);
      return;
    }
    if (ch === "'") {
      this.fail(`unsupported quote delimiter (use double quotes only)`, undefined, "HSON_QUOTE_KIND_UNSUPPORTED");
    }
    if (ch === "`") {
      this.rejectLegacyBacktick();
    }

    const pos = this.position();
    const raw = this.scanBareToken(terminator);
    this.bareValueCheckpoint(pos.index, raw);
    if (!isPrimitiveLiteral(raw)) {
      if (this.peek() === "=") {
        this.fail(
          `object member "${memberName}" cannot use authored metadata or attribute syntax`,
          pos,
          raw.startsWith("hson:")
            ? "HSON_AUTHORED_METADATA_FORBIDDEN"
            : "HSON_OBJECT_ATTRIBUTE_FORBIDDEN",
        );
      }
      const numericDefect = classifyNumberDefect(raw);
      this.fail(
        `invalid bare object value "${raw}" for member "${memberName}"; quote string values`,
        numericDefect === undefined
          ? pos
          : this.positionAt(pos.index + numericDefect.offset),
        numericDefect?.code ?? "HSON_OBJECT_FLAG_FORBIDDEN",
      );
    }
    this.assertFiniteNumberLiteral(raw, pos);
    if (this.editorDataFact !== undefined) this.observeData({ kind: "scalar", value: JSON.parse(raw) }, pos.index);
    const token = this.emit(CREATE_TEXT_TOKEN(raw, undefined, pos));
    if (this.collector !== undefined) this.recordToken(token, {
      roles: { coverage: { start: pos.index, end: this.index }, value: { start: pos.index, end: this.index } },
    });
  }

  /** Existing named element syntax, selected only after a matching `/>`. */
  private scanElementAfterOpen(openPos: Position, depth: number): void {
    this.editorContainers.push("element");
    this.editorClosingDelimiters.push("/>");
    this.skipTrivia();
    this.completionSlot("tag");
    if (this.slotHere() !== undefined) this.rejectSlot("an element name");
    if (this.atEnd()) this.fail(`unterminated angle construct`, openPos, "HSON_CONTAINER_UNTERMINATED");

    if (this.startsWith("/>")) {
      this.fail(`missing tag name before "/>"`, openPos, "HSON_ELEMENT_NAME_REQUIRED");
    }

    const tagPos = this.position();
    const tag = this.peek() === "'"
      ? this.scanQuotedName()
      : this.scanBareName("tag name");
    const tagEnd = this.index;
    this.completionSlot("tag", tagPos.index);
    if (tag.length === 0) {
      this.fail(`element name must not decode to the empty string`, tagPos, "HSON_ELEMENT_NAME_REQUIRED");
    }
    assert_authored_hson_source_name(tag, tagPos);
    if (tag.toLowerCase() === AUTHORED_EVENT_TAG) {
      this.fail("hson:event is reserved for declarations in a Part's events collection.", tagPos, "HSON_EVENT_DECLARATION_INVALID");
    }

    const attrs: RawAttr[] = [];
    const previousElement = this.editorElement;
    if (this.editorCheckpoint !== undefined) this.editorElement = { tag, start: openPos.index, attributes: attrs, contentTags: [...previousElement?.contentTags ?? [], tag] };
    const attrDeclarations = new Map<string, Position>();
    let quid: { value: string; start: Position; end: Position } | undefined;
    let openEmitted = false;
    let quad: AuthoredQuadDeclaration | undefined;
    let contentStarted = false;
    let separatedBeforeSlot = false;
    const observeHeader = (complete = false): void => {
      this.collector?.elementHeader?.(tag, { start: openPos.index, end: this.index }, attrs, complete);
    };
    observeHeader();

    const emitOpen = (): void => {
      if (openEmitted) return;
      for (const attr of attrs) if (attr.name.toLowerCase() === PART_DECLARATION) {
        const issue = part_declaration_issue(attr.name, attr.value !== undefined)
          ?? (depth !== this.initialDepth || tag.toLowerCase() === "hson-part" ? "hson:part is only allowed on the single Part definition root." : undefined);
        if (issue !== undefined) this.fail(issue, attr.start, "HSON_PART_DECLARATION_INVALID");
      }
      observeHeader(true);
      if (tag.toLowerCase() === "hson-part" || attrs.some(attr => attr.name === PART_DECLARATION)) {
        for (const attr of attrs) {
          const argument = tag.toLowerCase() === "hson-part" ? part_argument_name(attr.name) : undefined;
          if (is_part_scalar_argument(argument) && attr.value === undefined) {
            this.fail(`Part :${argument.kind} requires a quoted literal or a Part reference.`, attr.start, "HSON_PART_ARGUMENT_INVALID");
          }
          const issue = part_direction_issue(tag, attr.name, attr.value === undefined);
          if (issue !== undefined) this.fail(issue, attr.start, "HSON_PART_DIRECTION_INVALID");
        }
      }
      if (attrs.some(attr => attr.name.startsWith("^{"))) part_structural_reference({ $_tag: tag,
        $_attrs: Object.fromEntries(attrs.map(attr => [attr.name, attr.value?.text ?? attr.name])), $_content: [] });
      const token = this.emit(CREATE_OPEN_TOKEN(tag, attrs, openPos, quid));
      if (quad !== undefined) token.quad = quad;
      if (this.collector !== undefined) this.recordToken(token, {
        roles: {
          name: { start: tagPos.index, end: tagEnd },
          open: { start: openPos.index, end: openPos.index + 1 },
        },
        coverageStart: openPos.index,
      });
      openEmitted = true;
    };

    while (true) {
      const separated = this.skipTrivia();
      if (separated) separatedBeforeSlot = true;
      this.completionSlot(contentStarted ? "child" : "header");
      if (this.slotHere() !== undefined) {
        if (!contentStarted && !separatedBeforeSlot) this.rejectSlot("an element header without a separating space");
        contentStarted = true;
        emitOpen();
        this.emitSlot("document-content");
        continue;
      }
      if (this.atEnd()) this.fail(`unterminated tag <${tag}>`, openPos, "HSON_CONTAINER_UNTERMINATED");

      if (this.startsWith("/>")) {
        emitOpen();
        const closePos = this.position();
        this.consumeExpected("/");
        this.consumeExpected(">");
        const token = this.emit(CREATE_END_TOKEN(CLOSE_KIND.elem, closePos));
        if (this.collector !== undefined) this.recordToken(token, {
          roles: { close: { start: closePos.index, end: closePos.index + 2 } },
          coverageEnd: closePos.index + 2,
        });
        this.editorContainers.pop();
        this.editorClosingDelimiters.pop();
        this.editorElement = previousElement;
        return;
      }

      const ch = this.peek();

      if (ch === "#" && this.source[this.index + 1] === "{") {
        this.fail(PART_LOCAL_REFERENCE_MIGRATION, this.position(), "HSON_PART_REFERENCE_INVALID");
      }
      if (ch === "^" && this.source[this.index + 1] === "{") {
        const start = this.position();
        const reference = scan_part_reference(this.source, this.index);
        const cursor = this.editorCursor;
        if (this.editorMode === "document" && cursor !== undefined && cursor >= start.index + 2) {
          const editable = reference ?? scan_part_reference(this.source, start.index, true);
          const end = editable?.end ?? cursor;
          const safeSuffix = editable !== undefined || /^[ \t\r\n]*(?:\/>|$)/.test(this.source.slice(cursor));
          const checkpoint = safeSuffix ? part_reference_checkpoint(this.source.slice(start.index, end), cursor - start.index) : undefined;
          if (checkpoint !== undefined && tag.toLowerCase() === "hson-part" && !contentStarted && separatedBeforeSlot) {
            this.editorCheckpoint?.({ kind: "parameter", path: [], existing: [],
              range: { start: start.index + checkpoint.start, end: start.index + checkpoint.end },
              openContainers: [...this.editorContainers], element: this.editorElement,
              parameter: { namespace: "local", structural: true, prefix: checkpoint.prefix, complete: checkpoint.complete,
                ...(checkpoint.optional ? { optional: true } : {}) } });
          }
        }
        if (tag.toLowerCase() !== "hson-part" || contentStarted || !separatedBeforeSlot || reference === undefined || reference.path.length) {
          this.fail("standalone local Document references require an empty hson-part connector", start, "HSON_PART_STRUCTURE_INVALID");
        }
        while (this.index < reference.end) this.consume();
        const name = this.source.slice(start.index, this.index);
        const attr: RawAttr = { name, start, end: this.previousPosition() };
        this.assertUniqueAttribute(attrDeclarations, attr);
        this.collector?.recordAttribute(attr, { coverage: { start: start.index, end: this.index },
          name: { start: start.index, end: this.index }, value: { start: start.index, end: this.index } });
        attrs.push(attr); observeHeader(); separatedBeforeSlot = false;
        continue;
      }

      if (ch === "@") {
        const quidPos = this.position();
        if (contentStarted) {
          this.fail(
            this.authoredQuads && this.startsWith("@:")
              ? "authored QUAD declaration is forbidden after content begins"
              : "persisted QUID declaration is forbidden after content begins",
            quidPos,
            "HSON_ELEMENT_HEADER_AFTER_CONTENT",
          );
        }
        this.consumeExpected("@");
        if (this.authoredQuads && this.peek() === ":") {
          this.consumeExpected(":");
          if (this.slotHere() !== undefined) this.rejectSlot("an authored QUAD name");
          if (!/^[A-Za-z_$]$/.test(this.peek())) {
            this.fail("invalid authored QUAD name", quidPos, "HSON_LIBRARY_QUAD_INVALID");
          }
          const value = this.scanBareToken();
          if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) || value.length > 128) {
            this.fail("invalid authored QUAD name", quidPos, "HSON_LIBRARY_QUAD_INVALID");
          }
          if (tag.startsWith(HSON_SYS_PREFIX)) this.fail("QUAD subject must be an ordinary document element", quidPos, "HSON_LIBRARY_QUAD_INELIGIBLE");
          if (quad !== undefined) this.fail("duplicate authored QUAD declaration on one subject", quidPos,
            "HSON_LIBRARY_QUAD_DUPLICATE", [{ role: "first-declaration", pos: quad.start }]);
          quad = { value, start: quidPos, end: this.previousPosition() };
          separatedBeforeSlot = false;
          continue;
        }
        if (this.atEnd() || isHsonTrivia(this.peek()) || this.startsWith("/>") || this.peek() === ">") {
          this.fail(`missing persisted QUID value after "@"`, quidPos, "HSON_ELEMENT_QUID_INVALID");
        }
        const value = this.scanBareToken();
        if (!is_persisted_quid(value)) {
          this.fail(`invalid persisted QUID "${value}"`, quidPos, "HSON_ELEMENT_QUID_INVALID");
        }
        if (quid !== undefined) {
          this.fail(
            `duplicate persisted QUID declaration`,
            quidPos,
            "HSON_ELEMENT_QUID_INVALID",
            [{ role: "first-declaration", pos: quid.start }],
          );
        }
        quid = { value, start: quidPos, end: this.previousPosition() };
        separatedBeforeSlot = false;
        continue;
      }

      if (is_hson_bare_name_start(ch)) {
        const namePos = this.position();
        const name = this.scanBareName("attribute or flag");
        if (!contentStarted) this.completionSlot("header", namePos.index);
        const nameEnd = this.previousPosition();
        assert_authored_hson_source_name(name, namePos);

        if (contentStarted) {
          this.fail(
            `element header item "${name}" is forbidden after content begins`,
            namePos,
            "HSON_ELEMENT_HEADER_AFTER_CONTENT",
          );
        }

        const separatedAfterName = this.skipTrivia();
        if (this.slotHere() !== undefined && !separatedAfterName) this.rejectSlot("an attribute or flag name");
        separatedBeforeSlot = separatedAfterName;
        if (name.startsWith("hson:") && name.toLowerCase() !== PART_DECLARATION) {
          this.fail(
            `authored Hson metadata must not use element attribute syntax`,
            namePos,
            "HSON_AUTHORED_METADATA_FORBIDDEN",
          );
        }
        if (this.peek() === "=") {
          this.editorAttribute = name;
          const attr = this.scanAttributeValue(tag, name, namePos);
          this.editorAttribute = undefined;
          this.assertUniqueAttribute(attrDeclarations, attr);
          attrs.push(attr);
          observeHeader();
          separatedBeforeSlot = false;
          continue;
        }

        const attr = { name, start: namePos, end: nameEnd };
        this.collector?.recordAttribute(attr, {
          coverage: { start: namePos.index, end: nameEnd.index + 1 },
          name: { start: namePos.index, end: nameEnd.index + 1 },
        });
        this.assertUniqueAttribute(attrDeclarations, attr);
        attrs.push(attr);
        observeHeader();
        continue;
      }

      if (ch === "+" || ch === "-" || /\d/.test(ch)) {
        const valuePos = this.position();
        const raw = this.scanBareToken();
        if (!isPrimitiveLiteral(raw)) {
          const numericDefect = classifyNumberDefect(raw);
          this.fail(
            `invalid primitive content "${raw}"`,
            numericDefect === undefined
              ? valuePos
              : this.positionAt(valuePos.index + numericDefect.offset),
            numericDefect?.code ?? "HSON_ELEMENT_TYPED_CONTENT_FORBIDDEN",
          );
        }
        this.assertFiniteNumberLiteral(raw, valuePos);
        this.fail(
          `typed primitive content "${raw}" is forbidden in element mode`,
          valuePos,
          "HSON_ELEMENT_TYPED_CONTENT_FORBIDDEN",
        );
      }

      if (ch === `"`) {
        const valuePos = this.position();
        contentStarted = true;
        emitOpen();
        const value = this.scanContentString();
        const token = this.emit({ ...CREATE_TEXT_TOKEN(value.raw, true, valuePos), ...(value.directValue === undefined ? {} : { directValue: value.directValue }) });
        if (this.collector !== undefined) this.recordToken(token, {
          roles: { coverage: { start: valuePos.index, end: this.index }, value: { start: valuePos.index, end: this.index } },
        });
        continue;
      }

      if (ch === "<") {
        const childPos = this.position();
        if ((this.editorMode === undefined ? this.classifyAngleCloser(childPos) : this.editorAngleCloser(childPos)) !== CLOSE_KIND.elem) {
          this.fail(
            `structural mode crossing: element <${tag}> cannot contain an object-mode value`,
            childPos,
            "HSON_STRUCTURAL_MODE_CROSSING",
          );
        }
        contentStarted = true;
        emitOpen();
        this.scanAngle(depth + 1);
        continue;
      }

      if (ch === "«" || ch === "[") {
        this.fail(
          `structural mode crossing: element branch <${tag}> cannot contain object/array structure (array value)`,
          this.position(),
          "HSON_STRUCTURAL_MODE_CROSSING",
        );
      }

      if (ch === "'") {
        this.fail(
          `single-quoted names are valid only in the element-name position, not as attributes or flags`,
          undefined,
          "HSON_NAME_INVALID_START",
        );
      }

      if (ch === "`") {
        this.rejectLegacyBacktick();
      }


      if (contentStarted) {
        const invalidPos = this.position();
        const raw = this.scanBareToken();
        this.fail(
          `unexpected bare token in <${tag}> content: "${raw}"`,
          invalidPos,
          "HSON_ELEMENT_HEADER_AFTER_CONTENT",
        );
      }

      this.fail(`unexpected token "${ch}" in <${tag}> element header`, undefined, "HSON_ELEMENT_ATTRIBUTE_VALUE_INVALID");
    }
  }

  private scanArray(depth: number, readItem?: () => void): void {
    this.observeData({ kind: "array" }, this.index);
    this.editorContainers.push("array");
    this.assertNesting(depth);
    const opener = this.peek();
    const closer = opener === "«" ? "»" : "]";
    this.editorClosingDelimiters.push(closer);
    const symbol: ArraySymbol = opener === "«" ? ARR_SYMBOL.guillemet : ARR_SYMBOL.bracket;
    const openPos = this.position();
    this.consumeExpected(opener);
    this.skipTrivia();
    let quid: { value: string; start: Position; end: Position } | undefined;
    if (this.peek() === "@") {
      // An items-only consumer has no receiving array node for identity metadata.
      if (readItem !== undefined) this.fail("An item group cannot carry array identity metadata.", this.position(), "HSON_ARRAY_QUID_FORBIDDEN");
      const quidPos = this.position();
      this.consumeExpected("@");
      if (this.atEnd() || isHsonTrivia(this.peek()) || this.peek() === closer) {
        this.fail(`missing persisted QUID value after "@"`, quidPos, "HSON_ARRAY_QUID_INVALID");
      }
      const value = this.scanBareToken();
      if (!is_persisted_quid(value)) {
        this.fail(`invalid persisted QUID "${value}"`, quidPos, "HSON_ARRAY_QUID_INVALID");
      }
      quid = { value, start: quidPos, end: this.previousPosition() };
      const separated = this.skipTrivia();
      if (this.peek() !== closer && !separated) {
        this.fail(
          `required trivia is missing after persisted array QUID declaration`,
          this.position(),
          "HSON_REQUIRED_TRIVIA_MISSING",
        );
      }
    }
    const arrayOpen = this.emit(CREATE_ARR_OPEN_TOKEN(symbol, openPos, quid));
    if (this.collector !== undefined) this.recordToken(arrayOpen, {
      roles: { open: { start: openPos.index, end: openPos.index + 1 } },
      coverageStart: openPos.index,
    });

    let expectItem = true;
    let sawItem = false;
    let itemIndex = 0;
    while (true) {
      this.skipTrivia();
      if (expectItem) {
        this.editorPath.push(itemIndex);
        this.completionSlot("value");
        this.editorPath.pop();
      }
      if (expectItem && this.slotHere() !== undefined) {
        this.editorPath.push(itemIndex++);
        this.scanArrayItem(depth + 1);
        this.editorPath.pop();
        sawItem = true;
        expectItem = false;
        continue;
      }
      if (this.atEnd()) {
        this.fail(`unterminated ${opener}${closer} array`, openPos, "HSON_CONTAINER_UNTERMINATED");
      }

      if (this.peek() === closer) {
        const closePos = this.position();
        this.consumeExpected(closer);
        const token = this.emit(CREATE_ARR_CLOSE_TOKEN(symbol, closePos));
        if (this.collector !== undefined) this.recordToken(token, {
          roles: { close: { start: closePos.index, end: closePos.index + 1 } },
          coverageEnd: closePos.index + 1,
        });
        this.editorContainers.pop();
        this.editorClosingDelimiters.pop();
        return;
      }

      if (this.peek() === (closer === "]" ? "»" : "]")) {
        this.fail(
          `mismatched array closer "${this.peek()}"; expected "${closer}"`,
          undefined,
          "HSON_ARRAY_CLOSER_MISMATCH",
        );
      }

      if (!expectItem) {
        if (this.peek() !== ",") {
          this.fail(
            `expected "," or "${closer}" after array item`,
            undefined,
            "HSON_ARRAY_COMMA_MISSING",
          );
        }
        this.consumeExpected(",");
        expectItem = true;
        continue;
      }

      if (this.peek() === ",") {
        this.fail(
          sawItem ? `missing array item between commas` : `unexpected comma before first array item`,
          undefined,
          sawItem ? "HSON_ARRAY_ITEM_MISSING" : "HSON_ARRAY_COMMA_EXTRA",
        );
      }

      this.editorPath.push(itemIndex++);
      if (readItem === undefined) this.scanArrayItem(depth + 1);
      else readItem();
      this.editorPath.pop();
      sawItem = true;
      expectItem = false;
    }
  }

  private scanArrayItem(depth: number): void {
    this.assertNesting(depth);
    if (this.slotHere() !== undefined) { this.emitSlot("data-value"); return; }
    const ch = this.peek();

    if (ch === "<") {
      this.scanAngle(depth);
      return;
    }

    if (ch === "«" || ch === "[") {
      this.scanArray(depth);
      return;
    }

    if (ch === `"`) {
      const pos = this.position();
      const value = this.scanContentString();
      const token = this.emit({ ...CREATE_TEXT_TOKEN(value.raw, true, pos), ...(value.directValue === undefined ? {} : { directValue: value.directValue }) });
      if (this.collector !== undefined) this.recordToken(token, {
        roles: { coverage: { start: pos.index, end: this.index }, value: { start: pos.index, end: this.index } },
      });
      return;
    }

    if (ch === "'") {
      this.fail(`unsupported quote delimiter (use double quotes only)`, undefined, "HSON_QUOTE_KIND_UNSUPPORTED");
    }

    if (ch === "`") {
      this.rejectLegacyBacktick();
    }

    const pos = this.position();
    const raw = this.scanBareToken();
    this.bareValueCheckpoint(pos.index, raw);
    if (!isPrimitiveLiteral(raw)) {
      const numericDefect = classifyNumberDefect(raw);
      this.fail(
        `unexpected bare array item: "${raw}"`,
        numericDefect === undefined
          ? pos
          : this.positionAt(pos.index + numericDefect.offset),
        numericDefect?.code ?? "HSON_PRIMITIVE_TOKEN_INVALID",
      );
    }
    this.assertFiniteNumberLiteral(raw, pos);
    if (this.editorDataFact !== undefined) this.observeData({ kind: "scalar", value: JSON.parse(raw) }, pos.index);
    const token = this.emit(CREATE_TEXT_TOKEN(raw, undefined, pos));
    if (this.collector !== undefined) this.recordToken(token, {
      roles: { coverage: { start: pos.index, end: this.index }, value: { start: pos.index, end: this.index } },
    });
  }

  private scanAttributeValue(tag: string, name: string, start: Position): RawAttr {
    this.consumeExpected("=");
    this.skipTrivia();
    // Structural probes retain the grammar slot; completion needs occupied bounds.
    this.completionSlot("attribute-value", undefined, this.editorMode === "document"
      && (this.slotHere() !== undefined || !this.atEnd() && !this.startsWith("/>") && this.peek() !== ">"));
    const startsWithSlot = this.slotHere() !== undefined;
    if (startsWithSlot && this.editorRejectedSlot === undefined) this.rejectSlot("an unquoted attribute value; use name=\"${value}\"");
    if (!startsWithSlot && (this.atEnd() || this.startsWith("/>") || this.peek() === ">")) {
      this.fail(`missing attribute value for "${name}"`, start, "HSON_ELEMENT_ATTRIBUTE_VALUE_INVALID");
    }

    if (this.peek() === "'") {
      this.fail(
        `unsupported single-quoted attribute value (use double quotes only)`,
        undefined,
        "HSON_QUOTE_KIND_UNSUPPORTED",
      );
    }

    if (this.peek() === "`") {
      this.rejectLegacyBacktick();
    }

    const operand = classifyAttributeOperand(this.source, this.index, { tag, name });
    if (!startsWithSlot && operand.kind === "quoted") {
      const valueStart = this.position();
      const kind = tag.toLowerCase() === "hson-part" ? part_argument_name(name)?.kind : undefined;
      const { text, end, direct } = this.scanAttributeString(name, kind);
      const attr: RawAttr = { name, value: { text, quoted: true,
        ...(direct === undefined ? {} : { direct, ...(kind === "str" ? { rawInterpolated: true } : {}) }) }, start, end };
      this.collector?.recordAttribute(attr, {
        coverage: { start: start.index, end: end.index + 1 },
        name: { start: start.index, end: start.index + name.length },
        value: { start: valueStart.index, end: end.index + 1 },
      });
      return attr;
    }

    const valueStart = this.position();
    const observation = this.editorStringObservation();
    let text = "";
    let end = valueStart;
    let recovered = false;

    while (this.index < operand.end || this.slotHere() !== undefined) {
      if (this.slotHere() !== undefined) {
        if (this.recoverRejectedSlots()) { recovered = true; continue; }
        this.rejectSlot("an unquoted attribute value; use name=\"${value}\"");
      }
      if (this.index >= operand.end) break;
      end = this.position();
      const character = this.consume();
      text += character;
      this.observeStringCharacter(observation, character);
    }

    if (!text && !recovered) this.fail(`missing attribute value for "${name}"`, start, "HSON_ELEMENT_ATTRIBUTE_VALUE_INVALID");

    if (this.editorMode === "document" && !recovered) {
      this.documentStringCheckpoint(valueStart.index, true, "attribute-value", observation, false);
      this.completionSlot("attribute-value", valueStart.index);
    }

    if (!recovered && operand.kind === "invalid") {
      this.fail(`${operand.message} Attribute: "${name}".`, valueStart, operand.code,
        [{ role: "value-end", pos: this.position() }]);
    }

    const attr = { name, value: { text, quoted: false }, start, end };
    this.collector?.recordAttribute(attr, {
      coverage: { start: start.index, end: end.index + 1 },
      name: { start: start.index, end: start.index + name.length },
      value: { start: valueStart.index, end: end.index + 1 },
    });
    return attr;
  }

  /** Scan ordinary physical multiline content, lowering to JSON-compatible token raw. */
  private scanContentString(): { raw: string; directValue?: string } {
    const start = this.position();
    this.consumeExpected(`"`);
    const interpolations: number[] = [];
    const boundaries: number[] = [];
    let raw = `"`;
    const observation = this.editorStringObservation();

    while (!this.atEnd() || this.slotHere() !== undefined) {
      if (this.slotHere() !== undefined) {
        const { slot, value } = this.quotedSlot();
        interpolations.push(slot);
        boundaries.push(raw.length - 1);
        // Runtime text is never source layout: escape its newlines, controls,
        // quotes and backslashes. Protect spaces from the literal margin too.
        raw += JSON.stringify(value).slice(1, -1).replace(/ /g, "\\u0020");
        continue;
      }
      const ch = this.peek();

      if (ch === `"`) {
        if (interpolations.length === 0) {
          this.documentStringCheckpoint(start.index + 1, true, "value", observation);
          this.quotedValueCheckpoint(start.index + 1, true);
        }
        this.consumeExpected(`"`);
        const lowered = raw.includes("\n") || raw.includes("\t")
          ? JSON.stringify(decode_hson_content_string(raw.slice(1), boundaries)) : raw + `"`;
        if (interpolations.length !== 0) {
          for (const slot of interpolations) this.editorSlot?.(slot, "quoted-string");
          this.observeData({ kind: "unknown" }, start.index);
          return { raw: lowered, directValue: JSON.parse(lowered) };
        }
        if (this.editorDataFact !== undefined) this.observeData({ kind: "scalar", value: JSON.parse(lowered) }, start.index);
        return { raw: lowered };
      }

      if (ch === "\\") {
        const escape = this.scanJsonEscape("content string");
        raw += escape;
        if (observation !== undefined) this.observeStringCharacter(observation, JSON.parse('"' + escape + '"'));
        continue;
      }

      if (ch.charCodeAt(0) < 0x20 && ch !== "\n" && ch !== "\r" && ch !== "\t") {
        this.fail(
          `[invalid-json-string] unescaped control character in content string`,
          this.position(),
          "HSON_STRING_CONTROL_UNESCAPED",
        );
      }

      const character = this.consume();
      raw += character;
      this.observeStringCharacter(observation, character);
    }

    if (interpolations.length === 0) {
      this.documentStringCheckpoint(start.index + 1, false, "value", observation);
      this.quotedValueCheckpoint(start.index + 1, false);
    }
    const final = this.source[this.source.length - 1];
    const mixed = final === "'" && !raw.includes("\n");
    this.fail(mixed ? `mixed quote boundary in quoted string` : `unterminated quoted string`,
      mixed ? this.positionAt(this.source.length - 1) : start,
      mixed ? "HSON_QUOTE_BOUNDARY_MISMATCH" : "HSON_STRING_UNTERMINATED");
  }

  private quotedValueCheckpoint(start: number, complete: boolean): void {
    const cursor = this.editorCursor;
    if (this.editorMode !== "schema" && this.editorMode !== "data" || cursor === undefined || cursor < start || cursor > this.index) return;
    // Without a closing quote, only an EOF cursor with an unambiguous value
    // prefix is editable. Never consume a malformed suffix or another member.
    if (!complete && (cursor !== this.index || /[\r\n<>«»]/.test(this.source.slice(start, this.index)))) return;
    this.editorCheckpoint?.({ kind: "value", path: [...this.editorPath], existing: [...this.editorExisting],
      range: { start, end: this.index }, openContainers: [...this.editorContainers],
      ...(this.editorRootType === undefined ? {} : { rootType: this.editorRootType }), quoted: { complete, closingDelimiters: [...this.editorClosingDelimiters].reverse() } });
  }

  private editorStringObservation(): EditorStringObservation | undefined {
    return this.editorMode === "document" && this.editorCheckpoint !== undefined ? { value: "", boundaries: [this.index] } : undefined;
  }

  private observeStringCharacter(observation: EditorStringObservation | undefined, character: string): void {
    if (observation !== undefined) { observation.value += character; observation.boundaries.push(this.index); }
  }

  /** Observe string interiors only after the production scanner has checked escapes
   * and interpolation boundaries. A malformed suffix never becomes an edit range. */
  private documentStringCheckpoint(start: number, complete: boolean, kind: "value" | "attribute-value", observation: EditorStringObservation | undefined, quoted = true): void {
    const cursor = this.editorCursor;
    if (observation === undefined || cursor === undefined || cursor > this.index) return;
    if (quoted && kind === "attribute-value" && cursor === start - 1) {
      if (complete) this.editorCheckpoint?.({ kind, path: [...this.editorPath], existing: [], range: { start: start - 1, end: this.index + 1 },
        openContainers: [...this.editorContainers], ...(this.editorElement === undefined ? {} : { element: this.editorElement }),
        ...(this.editorAttribute === undefined ? {} : { attribute: this.editorAttribute }) });
      return;
    }
    const decodedCursor = observation.boundaries.indexOf(cursor);
    if (decodedCursor < 0) return; // An editor cursor inside an escape is not an exact decoded boundary.
    if (!complete && (cursor !== this.index || /[\r\n<>«»]/.test(this.source.slice(start, this.index)))) return;
    const parameter = part_reference_checkpoint(observation.value, decodedCursor);
    let range = { start, end: this.index };
    let parameterComplete = false;
    let rawAttribute: RawAttr | undefined;
    if (parameter !== undefined) {
      parameterComplete = parameter.complete;
      const mappedStart = observation.boundaries[parameter.start], mappedEnd = observation.boundaries[parameter.end];
      if (mappedStart === undefined || mappedEnd === undefined) return;
      range = { start: mappedStart, end: mappedEnd };
      const name = this.editorAttribute;
      if (name !== undefined) rawAttribute = { name, value: { text: this.source.slice(start, this.index), quoted },
        start: this.positionAt(start), end: this.position() };
    } else if (kind !== "attribute-value") return;
    this.editorCheckpoint?.({ kind: parameter === undefined ? kind : "parameter", path: [...this.editorPath], existing: [], range,
      openContainers: [...this.editorContainers], ...(this.editorElement === undefined ? {} : { element: this.editorElement }),
      ...(this.editorAttribute === undefined ? {} : { attribute: this.editorAttribute }),
      ...(parameter === undefined ? {} : { parameter: { complete: parameterComplete, prefix: parameter.prefix, namespace: parameter.namespace,
        ...(parameter.optional ? { optional: true } : {}),
        ...(rawAttribute === undefined ? {} : { rawAttribute }) } }),
      ...(quoted ? { quoted: { complete, closingDelimiters: [...this.editorClosingDelimiters].reverse() } } : {}) });
  }

  /** Attribute tokens retain their inner source text rather than outer quotes. */
  private scanAttributeString(name: string, kind?: PartArgumentKind): { text: string; end: Position; direct?: boolean } {
    const start = this.position();
    this.consumeExpected(`"`);
    const interpolations: number[] = [];
    const stringSlots: number[] = [];
    let text = "";
    const observation = this.editorStringObservation();

    while (!this.atEnd() || this.slotHere() !== undefined) {
      if (this.slotHere() !== undefined) {
        if (kind === "num") {
          this.fail("Part :num does not accept quoted template interpolation.", this.position(), "HSON_PART_ARGUMENT_INVALID");
        }
        const { slot, value } = this.quotedSlot();
        interpolations.push(slot);
        if (kind === "str") stringSlots.push(text.length);
        const encoded = JSON.stringify(value).slice(1, -1);
        text += kind === "str" ? encoded.replace(/[%^#]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`) : encoded;
        continue;
      }
      const ch = this.peek();
      if (ch === `"`) {
        if (interpolations.length === 0) this.documentStringCheckpoint(start.index + 1, true, "attribute-value", observation);
        const end = this.position();
        this.consumeExpected(`"`);
        if (interpolations.length !== 0) {
          for (const slot of interpolations) this.editorSlot?.(slot, "quoted-string");
          // Keep unknown interpolated values out of literal-only source facts.
          return { text: kind === "str" ? escape_cross_slot_part_references(text, stringSlots) : JSON.parse('"' + text + '"'), end, direct: true };
        }
        return { text, end };
      }

      if (ch === "\\") {
        const escape = this.scanJsonEscape(`quoted attribute "${name}"`);
        text += escape;
        if (observation !== undefined) this.observeStringCharacter(observation, JSON.parse('"' + escape + '"'));
        continue;
      }

      if (ch.charCodeAt(0) < 0x20) {
        this.fail(
          `[invalid-json-string] unescaped control character in quoted attribute "${name}"`,
          this.position(),
          "HSON_STRING_CONTROL_UNESCAPED",
        );
      }

      const character = this.consume();
      text += character;
      this.observeStringCharacter(observation, character);
    }

    if (interpolations.length === 0) this.documentStringCheckpoint(start.index + 1, false, "attribute-value", observation);
    const final = this.source[this.source.length - 1];
    this.fail(
      final === "'"
        ? `mixed quote boundary in quoted attribute "${name}"`
        : `unterminated quoted attribute value for "${name}"`,
      final === "'" ? this.positionAt(this.source.length - 1) : start,
      final === "'" ? "HSON_QUOTE_BOUNDARY_MISMATCH" : "HSON_STRING_UNTERMINATED",
    );
  }

  private scanQuotedName(): string {
    const start = this.position();
    this.consumeExpected("'");
    let tag = "";

    while (!this.atEnd()) {
      if (this.slotHere() !== undefined) this.rejectSlot("a quoted name");
      const ch = this.peek();
      if (ch === "'") {
        this.consumeExpected("'");
        return tag;
      }

      if (ch === "\\") {
        const escapePos = this.position();
        this.consumeExpected("\\");
        if (this.atEnd() || this.peek().charCodeAt(0) < 0x20) {
          this.fail(
            `[invalid-name-escape] invalid quoted-name escape termination`,
            escapePos,
            "invalid-name-escape",
          );
        }
        const escaped = this.consume();
        if (escaped === "'") tag += "'";
        else if (escaped === "\\") tag += "\\";
        else if (escaped === "b") tag += "\b";
        else if (escaped === "f") tag += "\f";
        else if (escaped === "n") tag += "\n";
        else if (escaped === "r") tag += "\r";
        else if (escaped === "t") tag += "\t";
        else if (escaped === "u") {
          let hex = "";
          for (let offset = 0; offset < 4; offset += 1) {
            const digit = this.peek();
            if (!/^[0-9A-Fa-f]$/.test(digit)) {
              this.fail(
                `[invalid-name-escape] malformed unicode escape ${JSON.stringify(`\\u${hex}`)} in quoted Hson name`,
                escapePos,
                "invalid-name-escape",
              );
            }
            hex += this.consume();
          }
          tag += String.fromCharCode(Number.parseInt(hex, 16));
        }
        else {
          this.fail(
            `[invalid-name-escape] unsupported quoted-name escape ${JSON.stringify(`\\${escaped}`)}`,
            escapePos,
            "invalid-name-escape",
          );
        }
        continue;
      }

      if (ch.charCodeAt(0) < 0x20) {
        this.fail(
          `raw control character is forbidden in single-quoted Hson name`,
          this.position(),
          "HSON_NAME_CONTROL_UNESCAPED",
        );
      }

      tag += this.consume();
    }

    this.fail(`unterminated single-quoted Hson name`, start, "HSON_NAME_UNTERMINATED");
  }

  private scanJsonEscape(context: string): string {
    const escapePos = this.position();
    this.consumeExpected("\\");
    if (this.atEnd() || this.isNewline()) {
      this.fail(`[invalid-json-escape] invalid escape termination in ${context}`, escapePos, "invalid-json-escape");
    }

    const escaped = this.consume();
    if (`"\\/bfnrt`.includes(escaped)) return `\\${escaped}`;

    if (escaped === "u") {
      let hex = "";
      for (let offset = 0; offset < 4; offset += 1) {
        const digit = this.peek();
        if (!/^[0-9A-Fa-f]$/.test(digit)) {
          this.fail(
            `[invalid-json-escape] malformed unicode escape ${JSON.stringify(`\\u${hex}`)} in ${context}`,
            escapePos,
            "invalid-json-escape",
          );
        }
        hex += this.consume();
      }
      return `\\u${hex}`;
    }

    this.fail(
      `[invalid-json-escape] unsupported escape ${JSON.stringify(`\\${escaped}`)} in ${context}`,
      escapePos,
      "invalid-json-escape",
    );
  }

  private assertUniqueAttribute(
    declarations: Map<string, Position>,
    attr: RawAttr,
  ): void {
    const first = declarations.get(attr.name);
    if (first !== undefined) {
      this.fail(
        `[duplicate-attribute] duplicate Hson attribute "${attr.name}"; first declared at ${first.line}:${first.col} (index ${first.index})`,
        attr.start,
        "HSON_ELEMENT_DUPLICATE_ATTRIBUTE",
        [{ role: "first-declaration", pos: first }],
      );
    }
    declarations.set(attr.name, attr.start);
  }

  private scanBareName(where: string): string {
    const start = this.position();
    const first = this.peek();
    if (!is_hson_bare_name_start(first)) {
      this.fail(
        `malformed ${where}: expected a bare name or single-quoted name`,
        start,
        where === "tag name" ? "HSON_ELEMENT_NAME_REQUIRED" : "HSON_NAME_INVALID_START",
      );
    }

    let out = this.consume();
    while (!this.atEnd() && is_hson_bare_name_char(this.peek())) out += this.consume();
    return out;
  }

  private scanBareToken(terminator?: "}"): string {
    const start = this.position();
    let out = "";

    while (!this.atEnd()) {
      const ch = this.peek();
      if (this.slotHere() !== undefined) break;
      if (ch === "`") this.rejectLegacyBacktick();
      if (
        isHsonTrivia(ch) || isUnsupportedWhitespace(ch) || ch === "<" || ch === ">" || ch === "/" ||
        ch === "[" || ch === "]" || ch === "«" || ch === "»" ||
        ch === "," || ch === `"` || ch === "'" || ch === "`" || ch === "=" || ch === terminator
      ) {
        break;
      }
      out += this.consume();
    }

    if (!out) this.fail(`unexpected token "${this.peek()}"`, start);
    return out;
  }

  /** Discover this angle's matching closer without changing the source cursor. */
  private classifyAngleCloser(openPos: Position): CloseKind {
    return this.structuralBoundary(openPos).kind;
  }

  private structuralBoundary(openPos: Position): { kind: CloseKind; end: number };
  private structuralBoundary(openPos: Position, opener: "<" | "[" | "«" | '"' | "'"): { kind: CloseKind | "string" | "array"; end: number };
  private structuralBoundary(openPos: Position, opener: '"', allowUnclosed: true): { kind: "string"; end: number } | undefined;
  private structuralBoundary(openPos: Position, opener?: "<" | "[" | "«" | '"' | "'", allowUnclosed = false) {
    // Admission classifies an angle. Framing can also enter this same walk
    // at a top-level quote or array, without decoding its contents.
    const framing = opener !== undefined;
    const stack: Array<"<" | "[" | "«"> = [];
    let quoted: '"' | "'" | undefined;
    if (opener === '"' || opener === "'") quoted = opener;
    else stack.push(opener ?? "<");
    let cursor = openPos.index + 1;
    let slotIndex = this.nextSlot;
    let quoteStart = openPos.index;
    let quoteAttribute = false;
    let quoteMultiline = false;
    let expectAttributeValue = false;
    let invalidReference: Readonly<{ start: number; operand: AttributeOperand & { kind: "invalid" } }> | undefined;

    while (cursor < this.source.length) {
      const ch = this.source[cursor];
      if (framing) {
        while (slotIndex < this.templateSlots.length && this.templateSlots[slotIndex]!.offset <= cursor) slotIndex++;
      }
      const next = framing ? this.literalNext(cursor, slotIndex) : this.source[cursor + 1];

      if (quoted !== undefined) {
        if (ch === "\\") {
          if (!framing && (next === undefined || next.charCodeAt(0) < 0x20)) {
            this.fail(
              quoted === `"`
                ? `[invalid-json-escape] invalid escape termination in quoted Hson string`
                : `[invalid-name-escape] invalid quoted-name escape termination`,
              this.positionAt(cursor),
              quoted === `"` ? "invalid-json-escape" : "invalid-name-escape",
            );
          }
          // Even an invalid escape stays inside the quote. A slot or EOF
          // ends the literal escape before it can consume a following quote.
          cursor += next === undefined ? 1 : 2;
          continue;
        }
        if (ch === "\n" || ch === "\r") quoteMultiline = true;
        // A forbidden control character does not end a quote. Framing still
        // requires its literal closing quote and the enclosing angle closer.
        if (!framing && ch.charCodeAt(0) < 0x20 && (quoted !== `"` || quoteAttribute || !["\n", "\r", "\t"].includes(ch))) {
          this.fail(
            quoted === `"`
              ? `unescaped control character in quoted Hson string`
              : `raw control character in single-quoted Hson name`,
            this.positionAt(cursor),
            quoted === `"` ? "HSON_STRING_CONTROL_UNESCAPED" : "HSON_NAME_CONTROL_UNESCAPED",
          );
        }
        if (ch === quoted) {
          if (stack.length === 0) return { kind: "string", end: cursor + 1 };
          quoted = undefined;
          quoteStart = -1;
        }
        cursor += 1;
        continue;
      }

      if (ch === "`") {
        this.rejectLegacyBacktick(this.positionAt(cursor));
      }

      const startsAttributeQuote = expectAttributeValue;
      if (expectAttributeValue) {
        if (isHsonTrivia(ch) || framing && isUnsupportedWhitespace(ch)) {
          cursor += 1;
          continue;
        }
        if (isUnsupportedWhitespace(ch)) {
          this.fail(
            `unsupported whitespace character U+${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`,
            this.positionAt(cursor),
            "HSON_UNSUPPORTED_WHITESPACE",
          );
        }
        if (ch === "/" && next === "/") {
          cursor += 2;
          while (cursor < this.source.length && this.source[cursor] !== "\n" && this.source[cursor] !== "\r") {
            cursor += 1;
          }
          continue;
        }
        if (ch === "/" && (next === ">" || framing && next === "*")) {
          expectAttributeValue = false;
        } else if (ch !== `"` && ch !== "'" && ch !== "<" && ch !== ">") {
          expectAttributeValue = false;
          // The operand lookahead recognizes reference sigils, quoted keys
          // and escapes. Keep those searches within one literal segment.
          const slotOffset = framing ? this.templateSlots[slotIndex]?.offset : undefined;
          const segment = slotOffset === undefined ? this.source : this.source.slice(0, slotOffset);
          const operand = classifyAttributeOperand(segment, cursor, { framing });
          if (!framing && operand.kind === "invalid" && operand.code === "HSON_PART_REFERENCE_INVALID"
            && !this.templateSlots.some(slot => slot.offset >= cursor && slot.offset <= operand.end)) {
            invalidReference ??= { start: cursor, operand };
          }
          if (operand.end > cursor) {
            cursor = operand.end;
            continue;
          }
        } else expectAttributeValue = false;
      }

      if (ch === `"` || ch === "'") {
        quoted = ch;
        quoteAttribute = startsAttributeQuote;
        quoteMultiline = false;
        quoteStart = cursor;
        cursor += 1;
        continue;
      }

      if (ch === "/" && next === "/") {
        cursor += 2;
        while (cursor < this.source.length && this.source[cursor] !== "\n" && this.source[cursor] !== "\r") {
          cursor += 1;
        }
        continue;
      }

      if (ch === "/" && next === "*") {
        this.fail(
          `block comments are not supported in authored Hson`,
          this.positionAt(cursor),
          "HSON_BLOCK_COMMENT_UNSUPPORTED",
        );
      }

      if (!framing && isUnsupportedWhitespace(ch)) {
        this.fail(
          `unsupported whitespace character U+${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`,
          this.positionAt(cursor),
          "HSON_UNSUPPORTED_WHITESPACE",
        );
      }

      if (!framing && ch === "/" && next !== ">" && stack.at(-1) === "<") {
        let afterSlash = cursor + 1;
        while (afterSlash < this.source.length && isHsonTrivia(this.source[afterSlash])) afterSlash += 1;
        if (this.source[afterSlash] === ">") {
          this.fail(
            `element closer must be the adjacent token "/>"`,
            this.positionAt(cursor),
            "HSON_ELEMENT_CLOSER_MALFORMED",
          );
        }
      }

      if (ch === "=") {
        expectAttributeValue = true;
        cursor += 1;
        continue;
      }

      if (ch === "<") {
        expectAttributeValue = false;
        stack.push("<");
        cursor += 1;
        continue;
      }
      if (ch === "[") {
        stack.push("[");
        cursor += 1;
        continue;
      }
      if (ch === "«") {
        stack.push("«");
        cursor += 1;
        continue;
      }
      if (ch === "/" && next === ">" && stack.at(-1) === "<") {
        expectAttributeValue = false;
        stack.pop();
        if (stack.length === 0) return { kind: CLOSE_KIND.elem, end: cursor + 2 };
        cursor += 2;
        continue;
      }
      if (ch === ">" && stack.at(-1) === "<") {
        expectAttributeValue = false;
        stack.pop();
        if (stack.length === 0) return { kind: CLOSE_KIND.obj, end: cursor + 1 };
        cursor += 1;
        continue;
      }
      if (ch === "]" && stack.at(-1) === "[") {
        stack.pop();
        if (stack.length === 0) return { kind: "array", end: cursor + 1 };
        cursor += 1;
        continue;
      }
      if (ch === "»" && stack.at(-1) === "«") {
        stack.pop();
        if (stack.length === 0) return { kind: "array", end: cursor + 1 };
        cursor += 1;
        continue;
      }
      cursor += 1;
    }

    if (allowUnclosed) return undefined;
    if (invalidReference !== undefined && this.editorMode === undefined) {
      this.fail(invalidReference.operand.message, this.positionAt(invalidReference.start), invalidReference.operand.code,
        [{ role: "value-end", pos: this.positionAt(invalidReference.operand.end) }]);
    }
    if (quoted === `"`) {
      const final = this.source[this.source.length - 1];
      this.fail(
        final === "'" && !quoteMultiline ? `mixed quote boundary in quoted string` : `unterminated quoted string`,
        final === "'" && !quoteMultiline ? this.positionAt(this.source.length - 1) : this.positionAt(quoteStart),
        final === "'" && !quoteMultiline ? "HSON_QUOTE_BOUNDARY_MISMATCH" : "HSON_STRING_UNTERMINATED",
      );
    }
    if (quoted === "'") {
      this.fail(`unterminated single-quoted Hson name`, this.positionAt(quoteStart), "HSON_NAME_UNTERMINATED");
    }
    this.fail(`unterminated angle construct`, openPos, "HSON_CONTAINER_UNTERMINATED");
  }

  private skipTrivia(framing = false, memberTrivia = false): boolean {
    const start = this.index;
    while (true) {
      while (this.slotHere() === undefined && !this.atEnd()
        && (isHsonTrivia(this.peek()) || framing && isUnsupportedWhitespace(this.peek()))) this.consume();
      if (this.slotHere() !== undefined) return this.index !== start;
      if (isUnsupportedWhitespace(this.peek())) {
        const ch = this.peek();
        this.fail(
          `unsupported whitespace character U+${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`,
          this.position(),
          "HSON_UNSUPPORTED_WHITESPACE",
        );
      }
      const afterSlash = framing ? this.literalNext(this.index, this.nextSlot) : this.peek(1);
      if (this.peek() !== "/") return this.index !== start;
      if (afterSlash === "*") {
        this.fail(
          `block comments are not supported in authored Hson`,
          this.position(),
          "HSON_BLOCK_COMMENT_UNSUPPORTED",
        );
      }
      if (afterSlash !== "/") return this.index !== start;

      // A following comment ends this whitespace interval. Observe its member
      // slot now, before scanning on to the next token or comment.
      if (memberTrivia && this.editorMode === "schema" && this.editorPath.length === 0 &&
        this.editorCursor !== undefined && this.editorCursor <= this.index) this.completionSlot("member");
      const commentStart = this.index;
      this.consumeExpected("/");
      this.consumeExpected("/");
      while (true) {
        if (this.slotHere() !== undefined) {
          if (framing) { this.nextSlot++; continue; }
          if (this.recoverRejectedSlots()) continue;
          this.rejectSlot("a comment");
        }
        if (this.atEnd() || this.isNewline()) break;
        this.consume();
      }
      this.eventObserver?.comment(commentStart, this.index);
      if (this.atEnd() || this.editorCursor !== undefined && this.editorCursor >= commentStart && this.editorCursor <= this.index) this.editorCommentEof = true;
      if (!this.atEnd()) this.consume();
    }
  }

  private eventHeaderEnd(at: number): boolean {
    return at === this.source.length || this.source[at] === "<" || this.source[at] === ">" || this.source.startsWith("/>", at);
  }

  private eventOperandBoundary(at: number): boolean {
    return this.eventHeaderEnd(at) || authored_event_operand_ends_at(this.source, at, false);
  }

  private eventBooleanWordEnd(start: number): number | undefined {
    // The longest Boolean word has five letters. One more character rules
    // out a longer word without scanning the rest of an invalid literal.
    const word = /^[A-Za-z]+/.exec(this.source.slice(start + 1, start + 7))?.[0];
    if (word === undefined || !("true".startsWith(word) || "false".startsWith(word))) return undefined;
    const end = start + 1 + word.length;
    return this.eventOperandBoundary(end) ? end : undefined;
  }

  /** Confirm a header name and its boundary before giving it authority over an operand. */
  private eventHeaderAhead(start: number, includeUnknown = false): { end: number; next: number; qualifier?: EventArgumentQualifier; unknown?: true } | undefined {
    if (!is_hson_bare_name_start(this.source[start] ?? "")) return undefined;
    let end = start + 1;
    while (is_hson_bare_name_char(this.source[end] ?? "")) end++;
    const raw = this.source.slice(start, end);
    const next = this.nextNonTrivia(end);
    if (this.source[next] === "=") {
      const { argument, qualifier } = event_argument_header(raw);
      return argument !== undefined && qualifier !== undefined ? { end, next, qualifier }
        : includeUnknown ? { end, next, unknown: true } : undefined;
    }
    if (!this.eventOperandBoundary(end)) return undefined;
    if (AUTHORED_EVENT_FLAGS.has(raw) || AUTHORED_EVENT_NAMES.has(raw)
      || (event_destination_domain(raw) !== undefined && !raw.endsWith(":"))) return { end, next };
    return includeUnknown ? { end, next, unknown: true } : undefined;
  }

  private confirmEventBooleanBoundary(wordEnd: number, possibleQuote: number | undefined, newline: number | undefined): boolean {
    // A silent cursor uses the same operand readers. Stop at the first damaged
    // operand: a subsequent Boolean gets its own decision there, so successive
    // probes traverse disjoint header items apart from that boundary operand.
    let operandOwnsQuote = false;
    const observeQuote = possibleQuote === undefined ? undefined : (at: number) => {
      if (at === possibleQuote) operandOwnsQuote = true;
    };
    const probe = new HsonScanner(this.source, this.initialDepth, observeQuote === undefined ? undefined : {
      recordAttribute() {},
      recordToken(token, { roles }) {
        if (token.kind === "TEXT" && roles.value !== undefined) observeQuote(roles.value.start);
      },
    });
    let ownsQuote = possibleQuote === undefined;
    const suffixTrivia = (from: number, end = this.nextNonTrivia(from)): number => {
      // Only actual comment trivia can skip a quote. On a later physical
      // line it can own an interior quote that cannot close an operand.
      if (!ownsQuote && newline !== undefined && possibleQuote !== undefined && possibleQuote > newline
        && from <= possibleQuote && possibleQuote < end && !this.eventOperandBoundary(possibleQuote + 1)) ownsQuote = true;
      return end;
    };
    let next = suffixTrivia(wordEnd);
    let establishedItem = false;
    while (!this.eventHeaderEnd(next)) {
      // Trivia and skipped malformed items cannot claim the original close.
      if (!ownsQuote && possibleQuote !== undefined && next > possibleQuote) return false;
      const header = this.eventHeaderAhead(next, true);
      if (header === undefined) return false;
      if (header.unknown) return establishedItem && ownsQuote;
      if (header.qualifier === undefined) {
        if (newline !== undefined && next > newline) establishedItem = true;
        next = suffixTrivia(header.end, header.next);
      } else {
        const afterAssignment = header.next + 1;
        const start = suffixTrivia(afterAssignment);
        if (this.eventHeaderEnd(start) || start > afterAssignment && this.eventHeaderAhead(start) !== undefined) {
          next = start;
          continue;
        }
        operandOwnsQuote = false;
        const end = probe.eventRecoveryOperandEnd(start, ownsQuote ? undefined : observeQuote);
        if (end === undefined || !this.eventOperandBoundary(end)) {
          // An independently bounded header item preserves the prefix when a
          // later argument has its own error. A line break can also separate
          // two incomplete Boolean words followed only by trivia.
          if (establishedItem && (ownsQuote || operandOwnsQuote && possibleQuote !== undefined
            && !this.eventOperandBoundary(possibleQuote + 1))) return true;
          if (newline === undefined || next <= newline || this.source[start] !== '"'
            || !ownsQuote && start !== possibleQuote) return false;
          if (header.qualifier !== "bool" || !probe.isNewline()) return false;
          const nextWordEnd = probe.eventBooleanWordEnd(start);
          return nextWordEnd !== undefined && this.nextNonTrivia(nextWordEnd) > probe.index;
        }
        ownsQuote ||= operandOwnsQuote;
        establishedItem = true;
        next = suffixTrivia(end);
      }
    }
    if (!ownsQuote) return false;
    if (next === this.source.length) return true;
    // A structural marker alone could be text inside the original quote.
    if (this.source[next] === "<") {
      next = this.nextNonTrivia(next + 1);
      if (this.source[next] === ">") next = this.nextNonTrivia(next + 1);
      else return next === this.source.length;
    }
    if (this.source[next] === ">") next = this.nextNonTrivia(next + 1);
    return next === this.source.length;
  }

  private eventRecoveryOperandEnd(start: number, observeQuote?: (at: number) => void): number | undefined {
    this.index = start;
    try {
      if (this.peek() === '"') {
        this.scanAttributeString("Event argument");
        observeQuote?.(start);
        return this.index;
      }
      if (this.peek() === "{") {
        this.consumeExpected("{");
        this.skipTrivia();
        if (this.peek() !== "}") this.scanObjectMemberValue(1, "operand", "}");
        this.skipTrivia();
        this.consumeExpected("}");
        this.tokens.length = 0;
        return this.index;
      }
      if (this.startsWith("^{formdata:")) return scan_formdata_operation(this.source, start,
        observeQuote === undefined ? undefined : (segment, at) => { if (segment === "field") observeQuote(at); })?.reference.end;
      const operand = classifyAttributeOperand(this.source, start);
      if (observeQuote !== undefined) scan_part_reference(this.source, start, false,
        (segment, at) => { if (segment === "key" && this.source[at] === '"') observeQuote(at); });
      return operand.kind === "reference" ? operand.end : undefined;
    } catch (error) {
      if (observeQuote !== undefined) {
        const details = read_transform_error_details(error);
        if (details?.code === "HSON_STRING_UNTERMINATED" && details.source !== undefined) observeQuote(details.source.index);
      }
      return undefined;
    }
  }

  private nextNonTriviaIs(expected: string, start = this.index): boolean {
    const next = this.nextNonTrivia(start);
    return next < this.source.length && this.source.startsWith(expected, next);
  }

  private nextNonTrivia(start: number): number {
    let ix = start;
    while (ix < this.source.length) {
      const ch = this.source[ix];
      if (isHsonTrivia(ch)) {
        ix++;
        continue;
      }
      if (this.source.startsWith("//", ix)) {
        ix += 2;
        while (ix < this.source.length && this.source[ix] !== "\n" && this.source[ix] !== "\r") ix++;
        continue;
      }
      break;
    }
    return ix;
  }

  private assertNesting(depth: number): void {
    if (depth >= HSON_MAX_NESTING) {
      this.fail(`Hson nesting depth must be less than ${HSON_MAX_NESTING}`, undefined, "HSON_NESTING_LIMIT");
    }
  }

  private assertFiniteNumberLiteral(raw: string, pos: Position): void {
    if (NUMBER_LITERAL.test(raw) && !Number.isFinite(Number(raw))) {
      this.fail(`Hson number must be finite: "${raw}"`, pos, "HSON_NUMBER_NONFINITE");
    }
  }

  private position(): Position {
    return { line: this.line, col: this.col, index: this.index };
  }

  private positionAt(index: number): Position {
    let line = 1;
    let col = 1;
    let cursor = 0;
    while (cursor < index) {
      const ch = this.source[cursor];
      if (ch === "\r") {
        if (this.source[cursor + 1] === "\n") cursor += 1;
        line += 1;
        col = 1;
      } else if (ch === "\n") {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
      cursor += 1;
    }
    return { line, col, index };
  }

  private previousPosition(): Position {
    const index = Math.max(0, this.index - 1);
    return { line: this.line, col: Math.max(1, this.col - 1), index };
  }

  private peek(offset = 0): string {
    return this.source[this.index + offset] ?? "";
  }

  /** Lookahead within the current literal segment. */
  private literalNext(index: number, nextSlot: number): string | undefined {
    const next = index + 1;
    return this.templateSlots[nextSlot]?.offset === next ? undefined : this.source[next];
  }

  private startsWith(text: string): boolean {
    return this.source.startsWith(text, this.index);
  }

  private atEnd(): boolean {
    return this.index >= this.source.length;
  }

  private isNewline(): boolean {
    const ch = this.peek();
    return ch === "\n" || ch === "\r";
  }

  /** Consume one logical source character; CRLF advances one line but two indices. */
  private consume(): string {
    // Literal lexemes (including names, escapes and comments) cannot cross a
    // substitution. Only emitSlot/quotedSlot may consume a semantic boundary.
    if (this.slotHere() !== undefined) this.rejectSlot("a lexical token");
    if (this.atEnd()) this.fail(`unexpected end of input`);
    const ch = this.source[this.index];

    if (ch === "\r") {
      if (this.source[this.index + 1] === "\n"
        && this.templateSlots[this.nextSlot]?.offset !== this.index + 1) this.index += 2;
      else this.index += 1;
      this.line += 1;
      this.col = 1;
      return "\n";
    }

    this.index += 1;
    if (ch === "\n") {
      this.line += 1;
      this.col = 1;
      return "\n";
    }

    this.col += 1;
    return ch;
  }

  private consumeExpected(expected: string): void {
    if (this.peek() !== expected) {
      this.fail(`expected "${expected}", got "${this.peek() || "eof"}"`);
    }
    this.consume();
  }

  private rejectLegacyBacktick(pos = this.position()): never {
    this.fail(
      `legacy backtick-delimited Hson names are invalid; use a single-quoted name`,
      pos,
      "HSON_NAME_LEGACY_BACKTICK",
    );
  }

  private fail(
    message: string,
    pos = this.position(),
    code = "HSON_TOKENIZATION_ERROR",
    related?: readonly { role: string; pos: Position }[],
  ): never {
    _throw_transform_err(
      `${message} at ${pos.line}:${pos.col} (index ${pos.index})`,
      "tokenize-hson",
      undefined,
      undefined,
      {
        code,
        stage: "tokenization",
        source: { index: pos.index, line: pos.line, column: pos.col },
        ...(related === undefined ? {} : {
          related: related.map((item) => ({
            role: item.role,
            source: { index: item.pos.index, line: item.pos.line, column: item.pos.col },
          })),
        }),
      },
    );
  }
}

function isPrimitiveLiteral(raw: string): boolean {
  return raw === "true" || raw === "false" || raw === "null" || NUMBER_LITERAL.test(raw);
}

type NumberDefect = Readonly<{
  code: string;
  offset: number;
}>;

function numberDefect(code: string, offset = 0): NumberDefect {
  return { code, offset };
}

function classifyNumberDefect(raw: string): NumberDefect | undefined {
  if (/^\+\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
    return numberDefect("HSON_NUMBER_LEADING_PLUS");
  }
  if (/^-?0\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
    return numberDefect("HSON_NUMBER_LEADING_ZERO", raw.startsWith("-") ? 2 : 1);
  }
  if (raw === "NaN" || raw === "Infinity" || raw === "+Infinity" || raw === "-Infinity") {
    return numberDefect("HSON_NUMBER_UNSUPPORTED_SPELLING");
  }
  if (/^[+-]?(?:0[xX][0-9A-Fa-f]+|\d[\d_]*_\d[\d_]*)$/.test(raw)) {
    return numberDefect("HSON_NUMBER_UNSUPPORTED_SPELLING");
  }
  if (/^[+-]?(?:\.\d+|\d+\.)$/.test(raw)) {
    return numberDefect("HSON_NUMBER_INCOMPLETE_FRACTION");
  }
  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?$/.test(raw)) {
    return numberDefect("HSON_NUMBER_INCOMPLETE_EXPONENT");
  }
  if (/^(?:[+-]{2,}|[+-]?\d+(?:\.\d+)?[+-]\d+)/.test(raw)) {
    return numberDefect("HSON_NUMBER_INVALID_SIGN");
  }
  if (/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[^\d]/.test(raw)) {
    return numberDefect("HSON_NUMBER_TRAILING_JUNK");
  }
  if (/^[+-.\d]/.test(raw)) return numberDefect("HSON_NUMBER_UNSUPPORTED_SPELLING");
  return undefined;
}
