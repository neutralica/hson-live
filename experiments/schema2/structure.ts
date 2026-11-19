import type { OrderedProjectedValue } from "../../src/core/ordered-projected-value.js";
import { assert_canonical_hson_data_value } from "../../src/core/projected-value-graph.js";

/**
 * Construct one record per authored occurrence, bottom-up and in source order.
 * Completing the root occurrence finishes the declaration. A missing body, a
 * literal Data value, a member map and an expression group have distinct
 * representations, including when empty.
 * The data root accepts an optional defs clause followed by at most one content
 * clause (object, ref or any). Other Data expressions can be named in defs
 * and selected with a root ref.
 *
 * The private source reader decodes names, header text and bounded Data operands,
 * and keeps authored spans in an identity-keyed sidecar. Schema interpretation
 * belongs to lower_schema_definition.
 *
 * Coverage roadmap: Data collection shorthand emits content first, followed by
 * headers in order. Historical permutations need an explicit ordered-field form.
 * D11 configured uniqueness is covered. Document roots, mixed/element definitions,
 * tags, attributes, content, sequences and counted repetition remain future work.
 */

/** A decoded literal body or braced Data operand. Containers use the existing ordered factories. */
export type DataOperand = Readonly<{ kind: "value"; value: OrderedProjectedValue }>;

/** Omitted operand = presence flag. Strings are decoded header text, before Schema interpretation. */
export type SchemaHeader = Readonly<{ kind?: never; body?: never; name: string; operand?: string | DataOperand }>;

/** The reader chooses the head role while it still knows whether a name was quoted. */
export type SchemaOccurrence = Readonly<{
  kind: "operation" | "name";
  name: string;
  headers: readonly SchemaHeader[];
  body?: SchemaBody;
}>;

type MemberMap = Readonly<{ kind: "members"; entries: readonly SchemaOccurrence[] }>;
type ExpressionGroup = Readonly<{ kind: "group"; items: readonly SchemaOccurrence[] }>;
export type SchemaBody = DataOperand | SchemaOccurrence | MemberMap | ExpressionGroup;

/** Readers can associate spans with these objects by identity, independently of lowering. */
export type SchemaOrigin = SchemaBody | SchemaHeader;

const completed = new WeakSet<object>();
const emptyHeaders: readonly SchemaHeader[] = Object.freeze([]);

// Constructors supply only validated own fields. Omitted fields must stay absent.
function complete<T extends SchemaOrigin>(fields: T): Readonly<T> {
  const record: T = { __proto__: null, ...fields };
  Object.freeze(record);
  completed.add(record);
  return record;
}

function is_completed(record: unknown): record is SchemaOrigin {
  return typeof record === "object" && record !== null && completed.has(record);
}

export function is_schema_occurrence(record: unknown): record is SchemaOccurrence {
  return is_completed(record) && (record.kind === "operation" || record.kind === "name");
}

function is_header(record: unknown): record is SchemaHeader {
  return is_completed(record) && record.kind === undefined;
}

// Capture cardinality and entries from the producer's own data descriptors.
function owned_list<T>(
  buffer: readonly T[], accepts: (item: unknown) => item is T, label: string,
): readonly T[] {
  if (!Array.isArray(buffer)) throw new TypeError(`Expected an array of Schema ${label} entries.`);
  const length = Object.getOwnPropertyDescriptor(buffer, "length");
  const count: unknown = length && Object.hasOwn(length, "value") ? length.value : undefined;
  // An array's physical length is an unsigned 32-bit integer.
  if (typeof count !== "number" || !Object.is(count, count >>> 0)) {
    throw new TypeError(`Expected a valid array length for Schema ${label} entries.`);
  }
  const list: T[] = [];
  for (let index = 0; index < count; index++) {
    const slot = Object.getOwnPropertyDescriptor(buffer, index);
    if (!slot || !Object.hasOwn(slot, "value")) throw new TypeError(`Expected a data slot at ${label}[${index}].`);
    const item: unknown = slot.value;
    if (!accepts(item)) throw new TypeError(`Expected an owned Schema ${label} at index ${index}.`);
    // Define an own slot without invoking any inherited indexed setter.
    Object.defineProperty(list, index, { value: item, enumerable: true, writable: true, configurable: true });
  }
  return Object.freeze(list);
}

export function value(literal: OrderedProjectedValue): DataOperand {
  assert_canonical_hson_data_value(literal);
  return complete({ kind: "value", value: literal });
}

export function header(name: string, operand?: string | DataOperand): SchemaHeader {
  if (typeof name !== "string") throw new TypeError("Expected a string header name.");
  if (operand === undefined) return complete({ name });
  if (typeof operand !== "string" && !(is_completed(operand) && operand.kind === "value")) {
    throw new TypeError("Expected decoded header text or an owned Data operand.");
  }
  return complete({ name, operand });
}

export function member_map(entries: readonly SchemaOccurrence[]): MemberMap {
  return complete({ kind: "members", entries: owned_list(entries, is_schema_occurrence, "occurrence") });
}

export function expression_group(items: readonly SchemaOccurrence[]): ExpressionGroup {
  return complete({ kind: "group", items: owned_list(items, is_schema_occurrence, "occurrence") });
}

function occurrence(
  kind: SchemaOccurrence["kind"], name: string, body?: SchemaBody, headers?: readonly SchemaHeader[],
): SchemaOccurrence {
  if (typeof name !== "string") throw new TypeError("Expected a string occurrence name.");
  if (body !== undefined && !(is_completed(body) && body.kind !== undefined)) {
    throw new TypeError("Expected an owned Schema body.");
  }
  const list = headers === undefined ? emptyHeaders : owned_list(headers, is_header, "header");
  return complete(body === undefined ? { kind, name, headers: list } : { kind, name, headers: list, body });
}

export function operation(name: string, body?: SchemaBody, headers?: readonly SchemaHeader[]): SchemaOccurrence {
  return occurrence("operation", name, body, headers);
}

export function application_name(name: string, body?: SchemaBody, headers?: readonly SchemaHeader[]): SchemaOccurrence {
  return occurrence("name", name, body, headers);
}
