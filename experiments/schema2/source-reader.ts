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

/**
 * Provisional private spelling: <data [<defs ...>, <members ...>]>.
 * A present root group is explicit even for a single clause. Object, members
 * and defs take successive named declarations, or <> for a present empty map.
 * Tuple and union govern expression arrays. Exact and ref govern Data literals.
 * A quoted application head never selects the grammar of an operation.
 */
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

  function readBody(role: string | undefined, depth: number): SchemaBody {
    const start = cursor.offset(), ch = cursor.peek();
    if ((ch === "[" || ch === "«") && (role === "data" || role === "tuple" || role === "union")) {
      const items: SchemaOccurrence[] = [];
      cursor.arrayItems(depth, () => items.push(declaration(depth + 1)));
      return located(expression_group(items), start);
    }
    if (ch === "<" && (role === "members" || role === "object" || role === "defs")) {
      const entries: SchemaOccurrence[] = [];
      if (cursor.emptyObjectAhead()) {
        cursor.assertNesting(depth);
        cursor.consume("<");
        cursor.skipTrivia();
        cursor.consume(">");
        return located(member_map(entries), start);
      }
      let end: number;
      do {
        entries.push(declaration(depth));
        end = cursor.offset();
        cursor.skipTrivia();
      } while (cursor.peek() === "<");
      return located(member_map(entries), start, end);
    }
    if (ch === "<" && role !== "exact" && role !== "ref" && !cursor.emptyObjectAhead()) {
      return declaration(depth);
    }
    return dataValue();
  }

  function declaration(depth: number): SchemaOccurrence {
    const start = cursor.offset();
    if (depth >= HSON_MAX_NESTING) invalid("Schema declaration exceeds the HSON nesting limit.");
    if (cursor.peek() !== "<") invalid("Expected a Schema declaration beginning with <.");
    cursor.consume("<");
    cursor.skipTrivia();
    const quoted = cursor.peek() === "'";
    const name = quoted ? cursor.quotedName() : cursor.bareName();
    const headers: SchemaHeader[] = [];
    let body: SchemaBody | undefined;
    let separated = cursor.skipTrivia();
    while (cursor.peek() !== ">") {
      if (!cursor.peek()) invalid(`Missing > for ${JSON.stringify(name)}.`, start);
      if (!separated) invalid("Expected trivia before a header or body.");
      const itemStart = cursor.offset();
      if (!is_hson_bare_name_start(cursor.peek())) {
        body = readBody(quoted ? undefined : name, depth + 1);
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
    cursor.skipTrivia();
    if (!cursor.peek()) invalid(`Missing > for ${JSON.stringify(name)}.`, start);
    if (cursor.peek() !== ">") invalid(`Expected > after the body of ${JSON.stringify(name)}.`);
    cursor.consume(">");
    return located((quoted ? application_name : operation)(name, body, headers), start);
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
