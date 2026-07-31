import type { HsonNode, JsonValue } from "../../core/types.js";
import type { ClassifiedLiveMap, LiveMap } from "../../types/livemap.types.js";
import { hsonTransform } from "../transform/transform.facade.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { make_classified_livemap } from "./livemap.core.js";
import {
  define_livemap_schema,
  LIVEMAP_SCHEMA,
  make_livemap_schema,
} from "./livemap.schema.js";
import type {
  InferLiveMapSchemaInput,
  LiveMapSchema,
  LiveMapSchemaBuilder,
} from "./livemap.schema.js";

type LiveMapSchemaNamespace = LiveMapSchemaBuilder & Readonly<{
  define: <const TInput>(
    makeShape: (schema: LiveMapSchemaBuilder) => TInput,
  ) => LiveMapSchema<InferLiveMapSchemaInput<TInput>>;
  make: <const TInput>(
    input: TInput,
  ) => LiveMapSchema<InferLiveMapSchemaInput<TInput>>;
}>;

const schema: LiveMapSchemaNamespace = Object.assign(
  {},
  LIVEMAP_SCHEMA,
  {
    define: define_livemap_schema,
    make: make_livemap_schema,
  },
);

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
