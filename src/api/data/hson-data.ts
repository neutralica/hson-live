import type { JsonValue } from "../../core/types.js";
import {
  is_ordered_projected_object,
  ordered_projected_value_equal,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import type { HsonCanonical } from "../transform/transform.types.js";
import type { HsonData as PublicHsonData } from "../transform/transform.types.js";
import { emit_ordered_json, parse_ordered_json_text } from "../../core/exact-data-codec.js";
import { assert_canonical_hson_data_value } from "../../core/projected-value-graph.js";
import {
  hson_data_value_from_hson,
  hson_data_value_to_hson,
} from "./hson-data-hson.js";

let wrap_hson_data: (value: OrderedProjectedValue) => ExactDataCarrier;
const hson_data_values = new WeakMap<object, OrderedProjectedValue>();
const hson_data_construction_authority = Object.freeze({});

function is_hson_data(value: unknown): value is ExactDataCarrier {
  return typeof value === "object" && value !== null && hson_data_values.has(value);
}

/**
 * One immutable exact canonical Hson data value.
 *
 * ExactDataCarrier is data-only: it never represents Hson document structure. Object
 * member order and signed zero are part of its semantic identity.
 */
export class ExactDataCarrier {
  declare private readonly hsonDataNominal: void;

  private constructor(value: OrderedProjectedValue, authority: object) {
    if (authority !== hson_data_construction_authority) {
      throw new TypeError("ExactDataCarrier construction is controlled by ExactDataCarrier.from or ExactDataCarrier.fromHson.");
    }
    hson_data_values.set(this, value);
    Object.freeze(this);
  }

  static {
    wrap_hson_data = (value) => new ExactDataCarrier(value, hson_data_construction_authority);
  }

  /** Strictly admit ordinary JavaScript data, or retain an existing exact value. */
  static from(input: unknown): ExactDataCarrier {
    return is_hson_data(input)
      ? input
      : hson_data_from_value(admit_projected_value(input));
  }

  /** Parse canonical authored Hson and require its complete semantic value to be data. */
  static fromHson(input: HsonCanonical): ExactDataCarrier {
    const value = hson_data_from_value(hson_data_value_from_hson(input));
    if (value.toHson() !== input) throw new TypeError("Expected canonical Hson data text.");
    return value;
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
  items(): readonly ExactDataCarrier[] | undefined {
    const value = hson_data_value(this);
    return Array.isArray(value)
      ? Object.freeze(value.map((item) => wrap_hson_data(item)))
      : undefined;
  }

  /** Read exact ordered object entries, or undefined when this value is not an object. */
  entries(): readonly (readonly [string, ExactDataCarrier])[] | undefined {
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
    return hson_data_value_to_hson(hson_data_value(this));
  }

  /** Exact canonical data equality. */
  equals(other: ExactDataCarrier): boolean {
    return is_hson_data(other)
      && ordered_projected_value_equal(hson_data_value(this), hson_data_value(other));
  }
}

/** @internal Construct a public data boundary around an already-validated carrier. */
export function hson_data_from_value(value: OrderedProjectedValue): ExactDataCarrier {
  assert_canonical_hson_data_value(value);
  return wrap_hson_data(value);
}

/** @internal Project an exact carrier to the public canonical data string. */
export function hson_data_text_from_value(value: OrderedProjectedValue): PublicHsonData {
  return hson_data_from_value(value).toHson() as PublicHsonData;
}

/** @internal Admit public data text into an owning subsystem's parsed carrier. */
export function hson_data_from_text(value: PublicHsonData): ExactDataCarrier {
  if (typeof value !== "string") throw new TypeError("Expected canonical Hson data text.");
  return ExactDataCarrier.fromHson(value);
}

/** @internal Action input policy: a top-level string is canonical Hson data. */
export function admit_hson_data_input(value: unknown): ExactDataCarrier {
  return typeof value === "string"
    ? ExactDataCarrier.fromHson(value as HsonCanonical)
    : ExactDataCarrier.from(value);
}

/** @internal Convert an owned exact carrier to its public semantic string. */
export function hson_data_text(value: ExactDataCarrier): PublicHsonData {
  return value.toHson() as PublicHsonData;
}

/** @internal Read the private carrier after runtime nominal validation. */
export function hson_data_value(value: ExactDataCarrier): OrderedProjectedValue {
  const carrier = hson_data_values.get(value);
  if (carrier === undefined) throw new TypeError("Expected an exact ExactDataCarrier value.");
  return carrier;
}

/** @internal Deterministic transport/fingerprint encoding for exact action data. */
export function encode_hson_data_internal(value: ExactDataCarrier | PublicHsonData): string {
  return emit_ordered_json(hson_data_value(typeof value === "string" ? hson_data_from_text(value) : value));
}

/** @internal Strict direct decoder for exact action data. */
export function decode_hson_data_internal(source: string): ExactDataCarrier {
  const value = parse_ordered_json_text(source);
  if (emit_ordered_json(value) !== source) {
    throw new TypeError("Exact Hson data transport must use its canonical encoding.");
  }
  return hson_data_from_value(value);
}
