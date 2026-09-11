import type { JsonValue } from "../../core/types.js";
import {
  is_ordered_projected_object,
  ordered_projected_value_equal,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import type { HsonCanonical } from "../transform/transform.types.js";
import { emit_ordered_json, parse_ordered_json_text } from "../../core/exact-data-codec.js";

let wrap_hson_data: (value: OrderedProjectedValue) => HsonData;
const hson_data_values = new WeakMap<object, OrderedProjectedValue>();
const hson_data_construction_authority = Object.freeze({});
let hson_conversion: Readonly<{
  fromHson: (input: HsonCanonical) => OrderedProjectedValue;
  toHson: (value: OrderedProjectedValue) => HsonCanonical;
}> | undefined;

function is_hson_data(value: unknown): value is HsonData {
  return typeof value === "object" && value !== null && hson_data_values.has(value);
}

/**
 * One immutable exact canonical Hson data value.
 *
 * HsonData is data-only: it never represents Hson document structure. Object
 * member order and signed zero are part of its semantic identity.
 */
export class HsonData {
  private constructor(value: OrderedProjectedValue, authority: object) {
    if (authority !== hson_data_construction_authority) {
      throw new TypeError("HsonData construction is controlled by HsonData.from or HsonData.fromHson.");
    }
    hson_data_values.set(this, value);
    Object.freeze(this);
  }

  static {
    wrap_hson_data = (value) => new HsonData(value, hson_data_construction_authority);
  }

  /** Strictly admit ordinary JavaScript data, or retain an existing exact value. */
  static from(input: unknown): HsonData {
    return is_hson_data(input)
      ? input
      : wrap_hson_data(admit_projected_value(input));
  }

  /** Parse canonical authored Hson and require its complete semantic value to be data. */
  static fromHson(input: HsonCanonical): HsonData {
    if (hson_conversion === undefined) throw new Error("HsonData Hson conversion authority is unavailable from this entrypoint.");
    return wrap_hson_data(hson_conversion.fromHson(input));
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
  items(): readonly HsonData[] | undefined {
    const value = hson_data_value(this);
    return Array.isArray(value)
      ? Object.freeze(value.map((item) => wrap_hson_data(item)))
      : undefined;
  }

  /** Read exact ordered object entries, or undefined when this value is not an object. */
  entries(): readonly (readonly [string, HsonData])[] | undefined {
    const value = hson_data_value(this);
    if (!is_ordered_projected_object(value)) return undefined;
    return Object.freeze(value.entries.map(([name, item]) => (
      Object.freeze([name, wrap_hson_data(item)] as const)
    )));
  }

  /** Materialize a fresh ordinary-JavaScript convenience view. */
  materialize(): JsonValue {
    return materialize_projected_value(hson_data_value(this));
  }

  /** Serialize this exact data value through the canonical Hson serializer. */
  toHson(): HsonCanonical {
    if (hson_conversion === undefined) throw new Error("HsonData Hson conversion authority is unavailable from this entrypoint.");
    return hson_conversion.toHson(hson_data_value(this));
  }

  /** Exact canonical data equality. */
  equals(other: HsonData): boolean {
    return is_hson_data(other)
      && ordered_projected_value_equal(hson_data_value(this), hson_data_value(other));
  }
}

/** @internal Construct a public data boundary around an already-validated carrier. */
export function hson_data_from_value(value: OrderedProjectedValue): HsonData {
  return wrap_hson_data(value);
}

/** @internal Read the private carrier after runtime nominal validation. */
export function hson_data_value(value: HsonData): OrderedProjectedValue {
  const carrier = hson_data_values.get(value);
  if (carrier === undefined) throw new TypeError("Expected an exact HsonData value.");
  return carrier;
}

/** @internal Deterministic transport/fingerprint encoding for exact action data. */
export function encode_hson_data_internal(value: HsonData): string {
  return emit_ordered_json(hson_data_value(value));
}

/** @internal Strict direct decoder for exact action data. */
export function decode_hson_data_internal(source: string): HsonData {
  const value = parse_ordered_json_text(source);
  if (emit_ordered_json(value) !== source) {
    throw new TypeError("Exact Hson data transport must use its canonical encoding.");
  }
  return hson_data_from_value(value);
}

/** @internal Install the existing parser/serializer authority from Hson-capable entrypoints. */
export function register_hson_data_hson_conversion(authority: Readonly<{
  fromHson: (input: HsonCanonical) => OrderedProjectedValue;
  toHson: (value: OrderedProjectedValue) => HsonCanonical;
}>): void {
  if (hson_conversion === undefined) {
    hson_conversion = authority;
    return;
  }
  if (hson_conversion !== authority) throw new Error("HsonData Hson conversion authority is already installed.");
}
