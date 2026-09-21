import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { parse_canonical_hson_data, serialize_canonical_hson_data } from "../../core/hson-data-canonical-codec.js";
import type { HsonCanonical } from "../transform/transform.types.js";

/** Parse canonical authored Hson and require one complete data-mode value. */
export function hson_data_value_from_hson(input: HsonCanonical): OrderedProjectedValue {
  try {
    return parse_canonical_hson_data(input);
  } catch (cause) {
    throw new TypeError("HsonData.fromHson requires data-mode Hson; document Hson is not data.", { cause });
  }
}

/** Private exact data admission shared by the carrier and editor tooling. */
export function admit_canonical_hson_data_value(input: HsonCanonical): OrderedProjectedValue {
  const value = hson_data_value_from_hson(input);
  if (hson_data_value_to_hson(value) !== input) throw new TypeError("Expected canonical Hson data text.");
  return value;
}

/** Serialize one canonical data carrier through the existing Hson serializer. */
export function hson_data_value_to_hson(value: OrderedProjectedValue): HsonCanonical {
  return serialize_canonical_hson_data(value) as HsonCanonical;
}
