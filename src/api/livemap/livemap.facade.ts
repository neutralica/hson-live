import type { HsonNode, JsonValue } from "../../core/types.js";
import type { ClassifiedLiveMap, LiveMap } from "../../types/livemap.types.js";
import { hsonTransform } from "../transform/transform.facade.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { detach_hson_root_value } from "../transform/utils/node-utils/detach-hson-root-value.js";
import { validate_schema_hson_graph } from "../../internal/schema-hson-validation/validate-schema-hson-graph.js";
import { LiveMapSchemaError } from "./livemap.error.js";
import type { HsonCanonical } from "../transform/transform.types.js";
import { make_classified_livemap } from "./livemap.core.js";
import {
  define_livemap_schema,
} from "./livemap.schema.js";
import type {
  LiveMapSchemaBuilder,
  InternalDefinedLiveMapSchema,
  InternalLiveMapSchemaDefinition,
  LiveMapSchema,
} from "./livemap.schema.js";

type LiveMapSchemaNamespace = Readonly<{
  validate: (schema: LiveMapSchema, canonical: HsonCanonical) => HsonCanonical;
  define: <const TExpression extends InternalLiveMapSchemaDefinition>(
    define: (schema: LiveMapSchemaBuilder) => TExpression,
  ) => InternalDefinedLiveMapSchema<TExpression>;
}>;

const schema: LiveMapSchemaNamespace = Object.freeze({
  define: define_livemap_schema,
  validate,
});

function validate(schema: LiveMapSchema, canonical: HsonCanonical): HsonCanonical {
  if (typeof canonical !== "string") throw new TypeError("validate requires an HsonCanonical string.");
  const graph = detach_hson_root_value(parse_hson(canonical));
  const result = validate_schema_hson_graph(schema, graph);
  if (!result.ok) throw new LiveMapSchemaError("HSON Schema validation failed.", result.issues[0]?.path ?? [], result.issues);
  return canonical;
}

function must_data_livemap(map: ClassifiedLiveMap): LiveMap {
  if (map.mode === "data-object" || map.mode === "data-array") return map;
  throw new Error(`LiveMap JSON construction produced unexpected root mode ${map.mode}.`);
}

function fromJson(input: string | JsonValue): LiveMap {
  return must_data_livemap(
    make_classified_livemap(hsonTransform.fromJson(input).toNode()),
  );
}

function fromHson(input: string): ClassifiedLiveMap {
  // LiveMap owns a document/data root carrier. Public Transform detaches its
  // HSON source result, so this subsystem consumes the parser-owned root
  // directly without changing LiveMap's established root contract.
  return make_classified_livemap(parse_hson(input, { allowTopLevelTextFragment: true }));
}

function fromNode(node: HsonNode): ClassifiedLiveMap {
  return make_classified_livemap(node);
}

/** Canonical DOM-free LiveMap construction and schema facade. */
export const hsonLiveMap = Object.freeze({
  schema,
  fromJson,
  fromHson,
  fromNode,
});
