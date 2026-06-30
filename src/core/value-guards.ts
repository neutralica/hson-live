// value-guards.ts

import type { BasicValue, JsonObj, JsonValue, Primitive } from "./types.js";

export function is_Object(x: unknown): x is JsonObj {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

export function is_Primitive(x: unknown): x is Primitive {
  return x === null || ["string", "number", "boolean"].includes(typeof x);
}

export function is_not_string(txt: JsonValue): txt is BasicValue {
  return (
    typeof txt === "number" ||
    txt === null ||
    typeof txt === "boolean"
  );
}

export function is_string(txt: JsonValue): txt is string {
  return typeof txt === "string";
}

export function is_void_node(content: readonly unknown[]) {
  return content.length === 0;
}

export function is_plain_object(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
