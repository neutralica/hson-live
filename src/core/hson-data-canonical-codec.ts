import { assert_valid_hson_data_name, is_bare_hson_name, serialize_hson_name } from "./hson-name.js";
import { admit_hson_number } from "./hson-number.js";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedValue,
} from "./ordered-projected-value.js";

/** Canonical serializer for the data-only Hson grammar. */
export function serialize_canonical_hson_data(
  value: OrderedProjectedValue,
  options: Readonly<{ noBreak?: boolean }> = {},
): string {
  return emit_canonical_hson_data(value, 0, options.noBreak === true);
}

function emit_canonical_hson_data(value: OrderedProjectedValue, depth: number, compact: boolean): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    admit_hson_number(value);
    return Object.is(value, -0) ? "-0" : String(value);
  }
  const pad = "  ".repeat(depth), childPad = "  ".repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return "«»";
    if (compact) return `«${value.map((child) => emit_canonical_hson_data(child, 0, true)).join(",")}»`;
    const children = value.map((child) => `${childPad}${emit_canonical_hson_data(child, depth + 1, false).trimStart()}`);
    return `«\n${children.join(",\n")}\n${pad}»`;
  }
  if (!is_ordered_projected_object(value)) throw new TypeError("Invalid canonical Hson data carrier.");
  if (value.entries.length === 0) return "<>";
  if (compact) return `<${value.entries.map(([name, child]) => {
    assert_valid_hson_data_name(name);
    return `${serialize_hson_name(name)} ${emit_canonical_hson_data(child, 0, true)}`;
  }).join(" ")}>`;
  const members = value.entries.map(([name, child]) => {
    assert_valid_hson_data_name(name);
    return `${childPad}${serialize_hson_name(name)} ${emit_canonical_hson_data(child, depth + 1, false).trimStart()}`;
  });
  if (members.length === 1 && !members[0]!.includes("\n")) return `<${members[0]!.trimStart()}>`;
  return `<\n${members.join("\n")}\n${pad}>`;
}

/** Parser for one complete value in the canonical data-only Hson grammar. */
export function parse_canonical_hson_data(source: string): OrderedProjectedValue {
  let index = 0;
  const fail = (message: string): never => { throw new SyntaxError(`${message} at Hson index ${index}`); };
  const skip = (): void => { while (/\s/.test(source[index] ?? "")) index += 1; };
  const parseJsonString = (): string => {
    const start = index;
    if (source[index] !== '"') fail("Expected a string");
    index += 1;
    let escaped = false;
    while (index < source.length) {
      const unit = source[index++]!;
      if (!escaped && unit === '"') {
        try { return JSON.parse(source.slice(start, index)) as string; }
        catch { return fail("Invalid canonical Hson string"); }
      }
      if (!escaped && unit.charCodeAt(0) < 0x20) fail("Unescaped control character in string");
      escaped = !escaped && unit === "\\";
    }
    return fail("Unterminated string");
  };
  const parseQuotedName = (): string => {
    index += 1;
    let result = "";
    while (index < source.length) {
      const unit = source[index++]!;
      if (unit === "'") return result;
      if (unit.charCodeAt(0) < 0x20) fail("Raw control character in quoted name");
      if (unit !== "\\") { result += unit; continue; }
      const escaped = source[index++];
      if (escaped === "'" || escaped === "\\") result += escaped;
      else if (escaped === "b") result += "\b";
      else if (escaped === "f") result += "\f";
      else if (escaped === "n") result += "\n";
      else if (escaped === "r") result += "\r";
      else if (escaped === "t") result += "\t";
      else if (escaped === "u") {
        const hex = source.slice(index, index + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail("Invalid Unicode quoted-name escape");
        result += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
      } else return fail("Unsupported quoted-name escape");
    }
    return fail("Unterminated quoted name");
  };
  const parseName = (): string => {
    if (source[index] === "'") return parseQuotedName();
    const start = index;
    while (/[A-Za-z0-9_-]/.test(source[index] ?? "")) index += 1;
    const result = source.slice(start, index);
    if (!is_bare_hson_name(result)) fail("Invalid canonical Hson data name");
    return result;
  };
  const parseNumber = (): number => {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(index));
    if (match === null) return fail("Invalid Hson number");
    index += match[0].length;
    return admit_hson_number(Number(match[0]));
  };
  const parseValue = (): OrderedProjectedValue => {
    skip();
    const unit = source[index];
    if (unit === '"') return parseJsonString();
    if (unit === "«") {
      index += 1; skip();
      const items: OrderedProjectedValue[] = [];
      if (source[index] === "»") { index += 1; return ordered_projected_array(items); }
      while (index < source.length) {
        items.push(parseValue()); skip();
        if (source[index] === "»") { index += 1; return ordered_projected_array(items); }
        if (source[index] !== ",") fail("Expected an array comma or closer");
        index += 1;
      }
      return fail("Unterminated Hson array");
    }
    if (unit === "<") {
      index += 1; skip();
      const entries: Array<readonly [string, OrderedProjectedValue]> = [], names = new Set<string>();
      if (source[index] === ">") { index += 1; return ordered_projected_object(entries); }
      while (index < source.length) {
        const memberName = parseName();
        assert_valid_hson_data_name(memberName);
        if (names.has(memberName)) fail(`Duplicate Hson data name ${JSON.stringify(memberName)}`);
        names.add(memberName);
        if (!/\s/.test(source[index] ?? "")) fail("Expected whitespace after a data name");
        entries.push([memberName, parseValue()]);
        const valueEnd = index;
        skip();
        if (source[index] === ">") { index += 1; return ordered_projected_object(entries); }
        if (index === valueEnd) fail("Expected whitespace between data members");
      }
      return fail("Unterminated Hson object");
    }
    if (source.startsWith("true", index)) { index += 4; return true; }
    if (source.startsWith("false", index)) { index += 5; return false; }
    if (source.startsWith("null", index)) { index += 4; return null; }
    if (unit === "-" || /[0-9]/.test(unit ?? "")) return parseNumber();
    return fail("Expected canonical Hson data");
  };
  const result = parseValue();
  skip();
  if (index !== source.length) fail("Trailing Hson source");
  return result;
}
