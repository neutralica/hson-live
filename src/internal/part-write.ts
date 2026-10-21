import type { HsonAuthored } from "../api/transform/transform.types.js";
import { qualify_authored_document_source, serialize_authored_document } from "../api/document/hson-authored.js";
import { is_bare_hson_name } from "../core/hson-name.js";
import { is_public_attr_name } from "../core/public-attrs.js";
import type { HsonNode } from "../core/types.js";

type Writer = (...input: readonly unknown[]) => HsonAuthored;
const writers = new WeakMap<object, Writer>();

/** @internal Attach before freezing; only governed whole-member owners register. */
export function attach_part_write<T extends object>(target: T, write: Writer): T {
  Object.defineProperty(target, "write", { value: write, enumerable: true });
  writers.set(target, write);
  return target;
}

/** @internal Forward detached authoring, without forwarding mutation authority. */
export function forward_part_write<T extends object>(target: T, raw: object, assertReadable: () => void): T {
  const write = writers.get(raw);
  return write === undefined ? target : attach_part_write(target, (...input) => {
    assertReadable();
    const source = write(...input);
    assertReadable();
    return source;
  });
}

/** @internal Pure connector authoring. The owner encloses caller capture in its fence. */
export function write_part_invocation(library: string, member: string, input: readonly unknown[]): HsonAuthored {
  if (input.length > 1) throw new TypeError("Part.write requires at most one scalar argument record.");
  const attrs: Record<string, string> = Object.create(null);
  attrs.lib = library;
  attrs.at = member;
  if (input.length !== 0) {
    const record = input[0];
    if (typeof record !== "object" || record === null || Array.isArray(record)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(record))) {
      throw new TypeError("Part.write requires a plain scalar argument record.");
    }
    for (const name of Reflect.ownKeys(record)) {
      // style is decoded as structured CSS; __proto__ cannot round-trip through
      // the established attribute decoder. Neither can be a scalar parameter.
      if (typeof name !== "string" || !is_bare_hson_name(name) || !is_public_attr_name(name)
        || name === "lib" || name === "at" || name === "style" || name === "__proto__") {
        throw new TypeError("Invalid or reserved Part.write argument name.");
      }
      const field = Object.getOwnPropertyDescriptor(record, name);
      if (field === undefined || !field.enumerable || !Object.hasOwn(field, "value")) {
        throw new TypeError("Part.write arguments require own enumerable data fields.");
      }
      const value: unknown = field.value;
      if (value !== null && typeof value !== "string" && typeof value !== "boolean"
        && !(typeof value === "number" && Number.isFinite(value))) {
        throw new TypeError("Part.write arguments require finite scalar values.");
      }
      attrs[name] = String(value);
    }
  }
  const quads = new Map<HsonNode, string>();
  const source = serialize_authored_document({ $_tag: "hson-part", $_attrs: attrs, $_content: [] }, quads);
  return serialize_authored_document(qualify_authored_document_source(source, quads), quads);
}
