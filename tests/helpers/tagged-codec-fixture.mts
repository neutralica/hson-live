import { hson } from "../../src/hson.ts";
import type { JsonValue } from "../../src/core/types.ts";

/** Machine input construction deliberately bypasses the graph encoder. */
export function tagged_node(tag: string, content: JsonValue[] = [], meta: JsonValue = { presence: "absent" }): JsonValue {
  return { type: "node", tag, attrs: { presence: "absent" }, meta, content };
}

export function tagged_item(index: string, value: JsonValue): JsonValue {
  return tagged_node("_hson_ii", [value], {
    presence: "present", entries: [{ key: "index", value: { type: "string", value: index } }],
  });
}

export function machine_payload(representation: JsonValue): string {
  return hson.fromJson(representation).toHson().noBreak().serialize();
}

export function exact_tagged_payload(value: JsonValue): string {
  return machine_payload({ valueKind: "canonical-graph-content", value });
}

export const invalid_tagged_graphs = Object.freeze([
  { name: "permuted array", value: tagged_node("_hson_arr", [
    tagged_item("1", tagged_node("_hson_str", [{ type: "string", value: "b" }])),
    tagged_item("0", tagged_node("_hson_str", [{ type: "string", value: "a" }])),
  ]) },
  { name: "empty metadata", value: tagged_node("span", [], { presence: "present", entries: [] }) },
  { name: "nested empty metadata", value: tagged_node("_hson_elem", [
    tagged_node("span", [], { presence: "present", entries: [] }),
  ]) },
  { name: "nested ROOT", value: tagged_node("_hson_arr", [
    tagged_item("0", tagged_node("_hson_root", [tagged_node("_hson_obj")])),
  ]) },
  { name: "structural OBJ child", value: tagged_node("_hson_obj", [tagged_node("_hson_obj")]) },
  { name: "unwrapped scalar relationship", value: tagged_node("span", [
    tagged_node("_hson_str", [{ type: "string", value: "text" }]),
  ]) },
  { name: "standalone OBJ scalar", value: tagged_node("_hson_obj", [
    tagged_node("_hson_str", [{ type: "string", value: "text" }]),
  ]) },
]);

function record(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Alter inner machine fields while retaining the surrounding current envelope. */
export function corrupt_tagged_payload(payload: string, kind: "empty metadata" | "nested empty metadata" | "permuted array"): string {
  const representation = hson.fromHson(payload).toJson().value();
  if (!record(representation)) throw new Error("Expected machine envelope.");
  const root = representation.value ?? representation.root;
  if (!record(root)) throw new Error("Expected tagged root.");
  const nodes: Array<{ [key: string]: JsonValue }> = [];
  const visit = (value: JsonValue): void => {
    if (!record(value) || value.type !== "node" || !Array.isArray(value.content)) return;
    nodes.push(value);
    for (const child of value.content) visit(child);
  };
  visit(root);
  if (kind === "permuted array") {
    const array = nodes.find(value => value.tag === "_hson_arr" && Array.isArray(value.content) && value.content.length >= 2);
    if (!array || !Array.isArray(array.content)) throw new Error("Expected two array children.");
    [array.content[0], array.content[1]] = [array.content[1], array.content[0]];
  } else {
    const target = kind === "empty metadata" ? root : nodes[1];
    if (!target) throw new Error("Expected nested node.");
    target.meta = { presence: "present", entries: [] };
  }
  return machine_payload(representation);
}
