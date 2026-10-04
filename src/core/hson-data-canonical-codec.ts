import { parse_hson } from "../api/transform/parsers/parse-hson.js";
import { assert_canonical_hson_data_value, projected_value_from_hson_node } from "./projected-value-graph.js";
import { HSON_META_INDEX, II_TAG } from "./constants.js";
import { is_Node } from "./node-guards.js";
import type { HsonNode } from "./types.js";
import { assert_valid_hson_data_name, serialize_hson_name } from "./hson-name.js";
import { admit_hson_number } from "./hson-number.js";
import {
  is_ordered_projected_object,
  type OrderedProjectedValue,
} from "./ordered-projected-value.js";

/** Canonical serializer for the data-only Hson grammar. */
export function serialize_canonical_hson_data(
  value: OrderedProjectedValue,
  options: Readonly<{ noBreak?: boolean }> = {},
): string {
  assert_canonical_hson_data_value(value);
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

/** Admit ordinary Hson syntax without materializing ordered members through JS objects. */
export function parse_canonical_hson_data(source: string): OrderedProjectedValue {
  const root = parse_hson(source);
  const inspect = (node: HsonNode): void => {
    if (node.$_attrs !== undefined || node.$_meta !== undefined
      && (node.$_tag !== II_TAG || Object.keys(node.$_meta).some(key => key !== HSON_META_INDEX))) {
      throw new TypeError("Hson data cannot carry attributes or authored metadata.");
    }
    for (const child of node.$_content) if (is_Node(child)) inspect(child);
  };
  inspect(root);
  return projected_value_from_hson_node(root);
}
