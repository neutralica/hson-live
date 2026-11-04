import type { JsonValue, Primitive } from "../../core/types.js";
import {
  is_ordered_projected_object,
  ordered_projected_value_equal,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { admit_data_source } from "../../core/data-source-admission.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import type { HsonSchema, JsonFromSchema } from "../transform/transform.types.js";
import type { HsonData as PublicHsonData } from "../transform/transform.types.js";
import { emit_ordered_json, parse_ordered_json_text } from "../../core/exact-data-codec.js";
import { assert_canonical_hson_data_value } from "../../core/projected-value-graph.js";
import {
  hson_data_value_to_hson,
} from "./hson-data-hson.js";

let wrap_hson_data: (value: OrderedProjectedValue) => HsonDataValue;
const hson_data_values = new WeakMap<object, OrderedProjectedValue>();
const hson_data_construction_authority = Object.freeze({});

/** @internal Authenticate before ordinary-object classification. */
export function is_hson_data_value(value: unknown): value is HsonDataValue {
  return typeof value === "object" && value !== null && hson_data_values.has(value);
}

/** Supported ordinary values. Nested carriers require explicit materialization. */
type DataValueInput = Primitive | readonly DataValueInput[] | { readonly [key: string]: DataValueInput };
export type HsonDataInput = DataValueInput | HsonDataValue;

/** Preserve interfaces, readonly structure, and optional fields without accepting arbitrary objects. */
export type HsonDataInputCheck<T, Root extends boolean = true> = T extends unknown ? [T] extends [Root extends true ? HsonDataInput : DataValueInput] ? T
  : T extends HsonDataValue
  ? Root extends true ? T : never
  : T extends Primitive ? T
    : T extends (...args: never[]) => unknown ? never
      : T extends object ? keyof T extends never ? never : { readonly [K in keyof T]: HsonDataInputCheck<T[K], false> } : never : never;

/** One immutable exact Data value. Object member order and signed zero are semantic. */
export class HsonDataValue<TSchema extends HsonSchema<unknown, "data"> = HsonSchema<unknown, "data">> {
  declare private readonly hsonDataNominal: TSchema;

  private constructor(value: OrderedProjectedValue, authority: object) {
    if (authority !== hson_data_construction_authority) {
      throw new TypeError("HsonDataValue construction is controlled by HsonDataValue.from or HsonDataValue.fromSource.");
    }
    hson_data_values.set(this, value);
    Object.freeze(this);
  }

  static {
    wrap_hson_data = (value) => new HsonDataValue(value, hson_data_construction_authority);
  }

  /** Strictly admit ordinary JavaScript data, or retain an existing exact value. */
  static from<TSchema extends HsonSchema<unknown, "data">>(input: HsonDataValue<TSchema>): HsonDataValue<TSchema>;
  static from<const T>(input: T & NoInfer<HsonDataInputCheck<T>>): HsonDataValue;
  static from(input: unknown): HsonDataValue {
    return admit_data_input(input);
  }

  /** Explicitly admit serialized JSON or Hson through bilingual Data admission. */
  static fromSource(source: string): HsonDataValue {
    return hson_data_from_value(admit_hson_data_source(source));
  }

  /** Exact semantic kind. */
  get kind(): "string" | "number" | "boolean" | "null" | "array" | "object" {
    const value = hson_data_value(this);
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (is_ordered_projected_object(value)) return "object";
    return typeof value as "string" | "number" | "boolean";
  }

  /** Read a scalar value, or undefined for a container. */
  scalar(): string | number | boolean | null | undefined {
    const value = hson_data_value(this);
    return typeof value !== "object" || value === null ? value : undefined;
  }

  /** Read exact array items, or undefined when this value is not an array. */
  items(): readonly HsonDataValue[] | undefined {
    const value = hson_data_value(this);
    return Array.isArray(value)
      ? Object.freeze(value.map((item) => wrap_hson_data(item)))
      : undefined;
  }

  /** Read exact ordered object entries, or undefined when this value is not an object. */
  entries(): readonly (readonly [string, HsonDataValue])[] | undefined {
    const value = hson_data_value(this);
    if (!is_ordered_projected_object(value)) return undefined;
    return Object.freeze(value.entries.map(([name, item]) => (
      Object.freeze([name, wrap_hson_data(item)] as const)
    )));
  }

  /** Materialize a fresh ordinary-JavaScript convenience view. */
  materialize(): JsonValue & JsonFromSchema<TSchema> {
    return materialize_projected_value(hson_data_value(this)) as JsonValue & JsonFromSchema<TSchema>;
  }

  /** Serialize this exact data value through the canonical Hson serializer. */
  toHson(): PublicHsonData<TSchema> {
    return hson_data_value_to_hson(hson_data_value(this)) as PublicHsonData<TSchema>;
  }

  /** Exact canonical data equality. */
  equals(other: HsonDataValue): boolean {
    return is_hson_data_value(other)
      && ordered_projected_value_equal(hson_data_value(this), hson_data_value(other));
  }
}

/** @internal Stable source admission shared with encoded authored attributes. */
export function admit_hson_data_source(source: string): OrderedProjectedValue {
  if (typeof source !== "string") throw new TypeError("Hson.data.fromSource requires source text.");
  try { return admit_data_source(source); }
  catch (cause) { throw new TypeError("Hson.data.fromSource requires JSON or Hson Data; Document structure is not Data.", { cause }); }
}

/** @internal Construct a public data boundary around an already-validated carrier. */
export function hson_data_from_value(value: OrderedProjectedValue): HsonDataValue {
  assert_canonical_hson_data_value(value);
  return wrap_hson_data(value);
}

/** @internal Project an exact carrier to the public canonical data string. */
export function hson_data_text_from_value(value: OrderedProjectedValue): PublicHsonData {
  assert_canonical_hson_data_value(value);
  return hson_data_value_to_hson(value) as PublicHsonData;
}

/** @internal One value ingress; authenticate before ordinary-object reflection. */
export function admit_data_input(value: unknown): HsonDataValue {
  return is_hson_data_value(value) ? value : hson_data_from_value(admit_projected_value(value));
}

/** @internal Read the private carrier after runtime nominal validation. */
export function hson_data_value(value: HsonDataValue): OrderedProjectedValue {
  const carrier = hson_data_values.get(value);
  if (carrier === undefined) throw new TypeError("Expected an exact HsonDataValue value.");
  return carrier;
}

/** @internal Deterministic transport/fingerprint encoding for exact action data. */
export function encode_hson_data_internal(value: HsonDataValue): string {
  return emit_ordered_json(hson_data_value(value));
}

/** @internal Strict direct decoder for exact action data. */
export function decode_hson_data_internal(source: string): HsonDataValue {
  const value = parse_ordered_json_text(source);
  if (emit_ordered_json(value) !== source) {
    throw new TypeError("Exact Hson data transport must use its canonical encoding.");
  }
  return hson_data_from_value(value);
}
