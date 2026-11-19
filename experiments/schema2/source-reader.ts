import { hson_lexical_cursor } from "../../src/api/transform/parsers/tokenize-hson.js";
import { HSON_MAX_NESTING } from "../../src/core/constants.js";
import { read_transform_error_details } from "../../src/core/errors.js";
import { parse_canonical_hson_data } from "../../src/core/hson-data-canonical-codec.js";
import { is_hson_bare_name_start } from "../../src/core/hson-name.js";
import { host_source_position_at, source_point_range_at } from "../../src/internal/embedded-hson/embedded-hson-source.js";
import type { HsonSourceRange } from "../../src/internal/hson-source-provenance/hson-source-provenance.js";
import {
  application_name, expression_group, header, member_map, operation, value,
  type SchemaBody, type SchemaHeader, type SchemaOccurrence, type SchemaOrigin,
} from "./structure.js";

export class SchemaSourceError extends Error {
  constructor(
    source: string, readonly range: HsonSourceRange, readonly code: string, message: string,
    readonly origin?: SchemaOrigin, cause?: unknown,
  ) {
    const at = host_source_position_at(source, range.start)!;
    super(`${at.line}:${at.column} ${message}`, { cause });
    this.name = "SchemaSourceError";
  }
}

export type ReadSchemaSource = Readonly<{
  root: SchemaOccurrence;
  rangeOf(origin: SchemaOrigin): HsonSourceRange | undefined;
}>;

/** Read one governed declaration, attaching authored ranges to its owned occurrences. */
export function read_schema_source(source: string): ReadSchemaSource {
  if (typeof source !== "string") throw new TypeError("Expected authored Schema source text.");
  const cursor = hson_lexical_cursor(source);
  const ranges = new WeakMap<SchemaOrigin, HsonSourceRange>();

  function located<T extends SchemaOrigin>(record: T, start: number, end = cursor.offset()): T {
    ranges.set(record, Object.freeze({ start, end }));
    return record;
  }

  function invalid(message: string, at = cursor.offset()): never {
    throw new SchemaSourceError(source, source_point_range_at(source, at)!, "SCHEMA_SOURCE_SYNTAX", message);
  }

  function dataValue() {
    const start = cursor.offset();
    const text = cursor.dataSource();
    try {
      return located(value(parse_canonical_hson_data(text)), start);
    } catch (cause) {
      const details = read_transform_error_details(cause);
      if (details?.source) {
        const range = source_point_range_at(source, start + details.source.index)!;
        // The original Transform message can contain positions relative to the operand slice.
        throw new SchemaSourceError(source, range, details.code, `Invalid HSON Data operand (${details.code}).`, undefined, cause);
      }
      throw new SchemaSourceError(source, { start, end: cursor.offset() }, details?.code ?? "SCHEMA_DATA_OPERAND",
        cause instanceof Error ? cause.message : String(cause), undefined, cause);
    }
  }

  function openObject(depth: number) {
    const start = cursor.offset();
    cursor.assertNesting(depth);
    cursor.consume("<");
    cursor.skipTrivia();
    const entries: SchemaOccurrence[] = [];
    while (cursor.peek() !== ">") {
      if (!cursor.peek()) invalid("Missing > for open object.", start);
      if (cursor.peek() !== "'") invalid("Expected a single-quoted member name or >.");
      const memberStart = cursor.offset();
      const name = cursor.quotedName();
      const { headers, body, end } = contents(name, depth + 1, true);
      entries.push(located(application_name(name, body, headers), memberStart, end));
      cursor.skipTrivia();
    }
    cursor.consume(">");
    return located(member_map(entries), start);
  }

  function rootClauses(depth: number): SchemaBody {
    const start = cursor.offset();
    const first = declaration(depth);
    cursor.skipTrivia();
    if (cursor.peek() !== "<") return first;
    const clauses = [first];
    let end: number;
    do {
      clauses.push(declaration(depth));
      end = cursor.offset();
      cursor.skipTrivia();
    } while (cursor.peek() === "<");
    // The group covers the actual clause sequence. Only tuple and union consume array delimiters.
    return located(expression_group(clauses), start, end);
  }

  function readBody(role: string | undefined, depth: number): SchemaBody {
    const start = cursor.offset(), ch = cursor.peek();
    if (role === "data") return rootClauses(depth);
    if ((ch === "[" || ch === "«") && (role === "tuple" || role === "union")) {
      const items: SchemaOccurrence[] = [];
      cursor.arrayItems(depth, () => items.push(declaration(depth + 1)));
      return located(expression_group(items), start);
    }
    if (ch === "<" && (role === "object" || role === "defs")) return openObject(depth);
    if (ch === "<" && role !== "exact" && role !== "ref" && !cursor.emptyObjectAhead()) {
      return declaration(depth);
    }
    return dataValue();
  }

  // bodyDepth counts authored containers. The unwrapped name itself adds no level.
  function contents(name: string, bodyDepth: number, member: boolean) {
    const headEnd = cursor.offset();
    const headers: SchemaHeader[] = [];
    let body: SchemaBody | undefined;
    let separated = cursor.skipTrivia();
    while (cursor.peek() && cursor.peek() !== ">" && !(member && cursor.peek() === "'")) {
      if (!separated) invalid("Expected trivia before a header or body.");
      const itemStart = cursor.offset();
      if (!is_hson_bare_name_start(cursor.peek())) {
        body = readBody(member ? undefined : name, bodyDepth);
        break;
      }

      const word = cursor.bareName();
      const wordEnd = cursor.offset();
      // In a content position these are Data primitives, including after flags.
      if (word === "null" || word === "true" || word === "false") {
        body = located(value(parse_canonical_hson_data(word)), itemStart);
        break;
      }
      separated = cursor.skipTrivia();
      if (cursor.peek() !== "=") {
        headers.push(located(header(word), itemStart, wordEnd));
        continue;
      }
      cursor.consume("=");
      cursor.skipTrivia();
      let operand: SchemaHeader["operand"];
      if (cursor.peek() === '"') {
        operand = cursor.headerText(word);
      } else if (cursor.peek() === "{") {
        cursor.consume("{");
        cursor.skipTrivia();
        operand = dataValue();
        cursor.skipTrivia();
        if (cursor.peek() !== "}") invalid("Expected } after one HSON Data operand.");
        cursor.consume("}");
      } else {
        invalid("Expected a double-quoted header value or {HSON Data}.");
      }
      headers.push(located(header(word, operand), itemStart));
      separated = cursor.skipTrivia();
    }
    const last = body ?? headers.at(-1);
    return { headers, body, end: last ? ranges.get(last)!.end : headEnd };
  }

  function declaration(depth: number): SchemaOccurrence {
    const start = cursor.offset();
    if (depth >= HSON_MAX_NESTING) invalid("Schema declaration exceeds the HSON nesting limit.");
    if (cursor.peek() !== "<") invalid("Expected a Schema operation beginning with <.");
    cursor.consume("<");
    cursor.skipTrivia();
    const name = cursor.bareName();
    const { headers, body } = contents(name, depth + 1, false);
    cursor.skipTrivia();
    if (!cursor.peek()) invalid(`Missing > for ${JSON.stringify(name)}.`, start);
    if (cursor.peek() !== ">") invalid(`Expected > after the body of ${JSON.stringify(name)}.`);
    cursor.consume(">");
    return located(operation(name, body, headers), start);
  }

  try {
    cursor.skipTrivia();
    const root = declaration(0);
    cursor.skipTrivia();
    if (cursor.peek()) invalid("Trailing source after the Schema declaration.");
    return { root, rangeOf: origin => ranges.get(origin) };
  } catch (cause) {
    const details = read_transform_error_details(cause);
    if (!details || !(cause instanceof Error)) throw cause;
    const range = source_point_range_at(source, details.source?.index ?? cursor.offset())!;
    throw new SchemaSourceError(source, range, details.code, cause.message, undefined, cause);
  }
}
