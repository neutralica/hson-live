import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import {
  is_projected_value_hson_node,
  projected_value_from_hson_node,
  projected_value_to_hson_node,
} from "../../core/projected-value-graph.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { serialize_hson } from "../transform/serializers/serialize-hson.js";
import type { HsonCanonical } from "../transform/transform.types.js";
import { register_hson_data_hson_conversion } from "./hson-data.js";

const authority = Object.freeze({
  fromHson(input: HsonCanonical): OrderedProjectedValue {
    const root = parse_hson(input);
    if (!is_projected_value_hson_node(root)) {
      throw new TypeError("HsonData.fromHson requires data-mode Hson; document Hson is not data.");
    }
    return projected_value_from_hson_node(root);
  },
  toHson(value: OrderedProjectedValue): HsonCanonical {
    return serialize_hson(projected_value_to_hson_node(value));
  },
});

register_hson_data_hson_conversion(authority);
