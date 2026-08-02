import type { JsonValue } from "../../../../core/types.js";
import {
  TransformError,
  type TransformErrorSource,
} from "../../../../core/errors.js";
import { hsonNumber } from "../../../../core/hson-number.js";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  ordered_projected_value_from_json,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../../../../core/ordered-projected-value.js";

/**
 * Parse JSON text without first materializing object properties through the
 * ECMAScript own-property enumeration model. Object names are validated after
 * JSON escape decoding, so neither source order nor an earlier duplicate can
 * disappear before HSON admission.
 */
export function parse_ordered_json_text(source: string): OrderedProjectedValue {
  let index = 0;

  const sourcePosition = (offset: number): TransformErrorSource => {
    let line = 1;
    let column = 1;
    for (let cursor = 0; cursor < offset; cursor += 1) {
      const unit = source[cursor];
      if (unit === "\r") {
        if (source[cursor + 1] === "\n" && cursor + 1 < offset) cursor += 1;
        line += 1;
        column = 1;
      } else if (unit === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
    return { index: offset, line, column };
  };

  const fail = (message: string): never => {
    throw new SyntaxError(`${message} at JSON index ${index}`);
  };

  const skipWhitespace = (): void => {
    while (index < source.length) {
      const unit = source[index];
      if (unit !== " " && unit !== "\t" && unit !== "\n" && unit !== "\r") return;
      index += 1;
    }
  };

  const parseStringToken = (): { value: string; start: number } => {
    if (source[index] !== `"`) fail("expected JSON string");
    const start = index;
    index += 1;
    let value = "";
    while (index < source.length) {
      const unit = source[index]!;
      if (unit.charCodeAt(0) < 0x20) fail("unescaped control character in JSON string");
      if (unit === `"`) {
        index += 1;
        return { value, start };
      }
      if (unit !== "\\") {
        value += unit;
        index += 1;
        continue;
      }

      index += 1;
      if (index >= source.length) fail("unterminated JSON string escape");
      const escape = source[index]!;
      index += 1;
      switch (escape) {
        case `"`: value += `"`; break;
        case "\\": value += "\\"; break;
        case "/": value += "/"; break;
        case "b": value += "\b"; break;
        case "f": value += "\f"; break;
        case "n": value += "\n"; break;
        case "r": value += "\r"; break;
        case "t": value += "\t"; break;
        case "u": {
          const hex = source.slice(index, index + 4);
          if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
            fail("invalid JSON Unicode escape");
          }
          value += String.fromCharCode(Number.parseInt(hex, 16));
          index += 4;
          break;
        }
        default: fail("invalid JSON string escape");
      }
    }
    return fail("unterminated JSON string");
  };

  const parseString = (): string => parseStringToken().value;

  const parseNumber = (): number => {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(index));
    if (match === null) return fail("invalid JSON number");
    index += match[0].length;
    return hsonNumber(Number(match[0]));
  };

  const parseArray = (path: string): readonly OrderedProjectedValue[] => {
    index += 1;
    skipWhitespace();
    const values: OrderedProjectedValue[] = [];
    if (source[index] === "]") {
      index += 1;
      return ordered_projected_array(values);
    }
    while (index < source.length) {
      values.push(parseValue(`${path}[${values.length}]`));
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return ordered_projected_array(values);
      }
      if (source[index] !== ",") fail("expected comma or array closer");
      index += 1;
      skipWhitespace();
    }
    return fail("unterminated JSON array");
  };

  const parseObject = (path: string): OrderedProjectedObject => {
    index += 1;
    skipWhitespace();
    const entries: Array<readonly [string, OrderedProjectedValue]> = [];
    // Retain offsets while the object is valid. Computing line/column walks
    // source text, so eagerly deriving a position for every property makes a
    // large duplicate-free document quadratic. Duplicate evidence is rare and
    // is the only point where either full source coordinate is required.
    const firstDeclarations = new Map<string, number>();
    if (source[index] === "}") {
      index += 1;
      return ordered_projected_object(entries);
    }
    while (index < source.length) {
      const keyToken = parseStringToken();
      const key = keyToken.value;
      const firstOffset = firstDeclarations.get(key);
      const propertyPath = `${path}[${JSON.stringify(key)}]`;
      if (firstOffset !== undefined) {
        const duplicateSource = sourcePosition(keyToken.start);
        const firstSource = sourcePosition(firstOffset);
        throw new TransformError(
          `Duplicate decoded structural JSON property ${JSON.stringify(key)} at ${duplicateSource.line}:${duplicateSource.column}`,
          {
            operation: "parse-json",
            stage: "parsing",
            code: "HSON_JSON_DUPLICATE_PROPERTY",
            source: duplicateSource,
            path: propertyPath,
            related: [{ role: "first-declaration", source: firstSource }],
          },
        );
      }
      firstDeclarations.set(key, keyToken.start);
      skipWhitespace();
      if (source[index] !== ":") fail("expected colon after JSON property name");
      index += 1;
      const value = parseValue(propertyPath);
      entries.push([key, value]);
      skipWhitespace();
      if (source[index] === "}") {
        index += 1;
        return ordered_projected_object(entries);
      }
      if (source[index] !== ",") fail("expected comma or object closer");
      index += 1;
      skipWhitespace();
    }
    return fail("unterminated JSON object");
  };

  const parseValue = (path: string): OrderedProjectedValue => {
    skipWhitespace();
    const unit = source[index];
    if (unit === `"`) return parseString();
    if (unit === "{") return parseObject(path);
    if (unit === "[") return parseArray(path);
    if (source.startsWith("true", index)) {
      index += 4;
      return true;
    }
    if (source.startsWith("false", index)) {
      index += 5;
      return false;
    }
    if (source.startsWith("null", index)) {
      index += 4;
      return null;
    }
    if (unit === "-" || (unit !== undefined && unit >= "0" && unit <= "9")) {
      return parseNumber();
    }
    return fail("unexpected JSON token");
  };

  const value = parseValue("$");
  skipWhitespace();
  if (index !== source.length) fail("trailing JSON source");
  return value;
}

export function ordered_json_from_runtime_value(value: JsonValue): OrderedProjectedValue {
  return ordered_projected_value_from_json(value);
}

export function ordered_json_to_runtime_value(value: OrderedProjectedValue): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (Array.isArray(value)) return value.map(ordered_json_to_runtime_value);
  if (!is_ordered_projected_object(value)) throw new TypeError("invalid ordered JSON value");
  const record: Record<string, JsonValue> = Object.create(null);
  for (const [key, child] of value.entries) record[key] = ordered_json_to_runtime_value(child);
  return record;
}

export function emit_ordered_json(value: OrderedProjectedValue, depth = 0): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`cannot serialize non-finite JSON number ${String(value)}`);
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }

  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((child) =>
      `${childIndent}${emit_ordered_json(child, depth + 1)}`
    ).join(",\n")}\n${indent}]`;
  }
  if (!is_ordered_projected_object(value)) throw new TypeError("invalid ordered JSON value");
  if (value.entries.length === 0) return "{}";
  return `{\n${value.entries.map(([key, child]) =>
    `${childIndent}${JSON.stringify(key)}: ${emit_ordered_json(child, depth + 1)}`
  ).join(",\n")}\n${indent}}`;
}
