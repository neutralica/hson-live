import { TransformError, type TransformErrorSource } from "./errors.js";
import { admit_hson_number } from "./hson-number.js";
import { BoundedStringWriter } from "./bounded-string-writer.js";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "./ordered-projected-value.js";

/** Parse structural JSON without materializing object order through ECMAScript objects. */
export function parse_ordered_json_text(source: string): OrderedProjectedValue {
  let index = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const sourcePosition = (offset: number): TransformErrorSource => {
    let line = 1, column = 1;
    for (let cursor = 0; cursor < offset; cursor += 1) {
      const unit = source[cursor];
      if (unit === "\r") { if (source[cursor + 1] === "\n" && cursor + 1 < offset) cursor += 1; line += 1; column = 1; }
      else if (unit === "\n") { line += 1; column = 1; }
      else column += 1;
    }
    return { index: offset, line, column };
  };
  const fail = (message: string): never => { throw new SyntaxError(`${message} at JSON index ${index}`); };
  const skipWhitespace = (): void => { while (index < source.length && /[ \t\n\r]/.test(source[index]!)) index += 1; };
  const parseStringToken = (): { value: string; start: number } => {
    if (source[index] !== `"`) fail("expected JSON string");
    const start = index; index += 1;
    const contentStart = index;
    let spanStart = index;
    let writer: BoundedStringWriter | undefined;
    while (index < source.length) {
      const unit = source[index]!;
      if (unit.charCodeAt(0) < 0x20) fail("unescaped control character in JSON string");
      if (unit === `"`) {
        let value: string;
        if (writer === undefined) value = source.slice(contentStart, index);
        else {
          writer.write(source.slice(spanStart, index));
          value = writer.finish();
        }
        index += 1;
        return { value, start };
      }
      if (unit !== "\\") { index += 1; continue; }
      writer ??= new BoundedStringWriter();
      writer.write(source.slice(spanStart, index));
      index += 1;
      if (index >= source.length) fail("unterminated JSON string escape");
      const escape = source[index]!; index += 1;
      switch (escape) {
        case `"`: writer.write(`"`); break;
        case "\\": writer.write("\\"); break;
        case "/": writer.write("/"); break;
        case "b": writer.write("\b"); break;
        case "f": writer.write("\f"); break;
        case "n": writer.write("\n"); break;
        case "r": writer.write("\r"); break;
        case "t": writer.write("\t"); break;
        case "u": {
          const hex = source.slice(index, index + 4);
          if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) fail("invalid JSON Unicode escape");
          writer.write(String.fromCharCode(Number.parseInt(hex, 16)));
          index += 4;
          break;
        }
        default: fail("invalid JSON string escape");
      }
      spanStart = index;
    }
    return fail("unterminated JSON string");
  };
  const parseNumber = (): number => {
    numberPattern.lastIndex = index;
    const match = numberPattern.exec(source);
    if (match === null) return fail("invalid JSON number");
    index += match[0].length; return admit_hson_number(Number(match[0]));
  };
  const parseArray = (path: string): readonly OrderedProjectedValue[] => {
    index += 1; skipWhitespace(); const values: OrderedProjectedValue[] = [];
    if (source[index] === "]") { index += 1; return ordered_projected_array(values); }
    while (index < source.length) {
      values.push(parseValue(`${path}[${values.length}]`)); skipWhitespace();
      if (source[index] === "]") { index += 1; return ordered_projected_array(values); }
      if (source[index] !== ",") fail("expected comma or array closer"); index += 1; skipWhitespace();
    }
    return fail("unterminated JSON array");
  };
  const parseObject = (path: string): OrderedProjectedObject => {
    index += 1; skipWhitespace();
    const entries: Array<readonly [string, OrderedProjectedValue]> = [];
    const firstDeclarations = new Map<string, number>();
    if (source[index] === "}") { index += 1; return ordered_projected_object(entries); }
    while (index < source.length) {
      const keyToken = parseStringToken(), key = keyToken.value, firstOffset = firstDeclarations.get(key);
      const propertyPath = `${path}[${JSON.stringify(key)}]`;
      if (firstOffset !== undefined) {
        const duplicateSource = sourcePosition(keyToken.start), firstSource = sourcePosition(firstOffset);
        throw new TransformError(`Duplicate decoded structural JSON property ${JSON.stringify(key)} at ${duplicateSource.line}:${duplicateSource.column}`, {
          operation: "parse-json", stage: "parsing", code: "HSON_JSON_DUPLICATE_PROPERTY", source: duplicateSource, path: propertyPath,
          related: [{ role: "first-declaration", source: firstSource }],
        });
      }
      firstDeclarations.set(key, keyToken.start); skipWhitespace();
      if (source[index] !== ":") fail("expected colon after JSON property name");
      index += 1; entries.push([key, parseValue(propertyPath)]); skipWhitespace();
      if (source[index] === "}") { index += 1; return ordered_projected_object(entries); }
      if (source[index] !== ",") fail("expected comma or object closer"); index += 1; skipWhitespace();
    }
    return fail("unterminated JSON object");
  };
  const parseValue = (path: string): OrderedProjectedValue => {
    skipWhitespace(); const unit = source[index];
    if (unit === `"`) return parseStringToken().value;
    if (unit === "{") return parseObject(path);
    if (unit === "[") return parseArray(path);
    if (source.startsWith("true", index)) { index += 4; return true; }
    if (source.startsWith("false", index)) { index += 5; return false; }
    if (source.startsWith("null", index)) { index += 4; return null; }
    if (unit === "-" || (unit !== undefined && unit >= "0" && unit <= "9")) return parseNumber();
    return fail("unexpected JSON token");
  };
  const value = parseValue("$"); skipWhitespace();
  if (index !== source.length) fail("trailing JSON source");
  return value;
}

/** Emit one deterministic structural encoding directly from the ordered carrier. */
export function emit_ordered_json(value: OrderedProjectedValue, depth = 0): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`cannot serialize non-finite JSON number ${String(value)}`);
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  const indent = "  ".repeat(depth), childIndent = "  ".repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((child) => `${childIndent}${emit_ordered_json(child, depth + 1)}`).join(",\n")}\n${indent}]`;
  }
  if (!is_ordered_projected_object(value)) throw new TypeError("invalid ordered JSON value");
  if (value.entries.length === 0) return "{}";
  return `{\n${value.entries.map(([key, child]) => `${childIndent}${JSON.stringify(key)}: ${emit_ordered_json(child, depth + 1)}`).join(",\n")}\n${indent}}`;
}
