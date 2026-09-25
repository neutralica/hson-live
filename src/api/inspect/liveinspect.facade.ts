import type { JsonValue } from "../../core/types.js";
import type { LiveMapPathHandle } from "../../types/livemap.types.js";
import type {
  LiveInspector,
  LiveInspectorMapSource,
  LiveInspectorOptions,
  LiveInspectorOwnedHsonOptions,
  LiveInspectorOwnedJsonOptions,
} from "../../types/liveinspect.types.js";
import { hsonLiveMap } from "../livemap/livemap.facade.js";
import { Hson } from "../../hson-authoring.js";
import { hsonTransform } from "../transform/transform.facade.js";
import { create_live_inspector } from "./liveinspect.js";

function is_root_collection(value: JsonValue): boolean {
  return typeof value === "object" && value !== null;
}

function primitive_root(source: LiveMapPathHandle): LiveMapPathHandle {
  return new Proxy(source, {
    get(target, property, receiver) {
      if (property === "path") return () => Object.freeze([]);
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

function inspect_owned_json(options: LiveInspectorOwnedJsonOptions, origin: "json" | "hson"): LiveInspector {
  const { value, ...inspectorOptions } = options;
  const ownedMap = is_root_collection(value)
    ? hsonLiveMap.fromLibraries({ source: { data: value, schema: Hson.schema`<type "data" content "any">` } })
    : hsonLiveMap.fromLibraries({ source: { data: { __hson_inspector_value__: value }, schema: Hson.schema`<type "data" content <__hson_inspector_value__ "any">>` } });
  const library = ownedMap.lib("source") as LiveInspectorMapSource;
  const source = is_root_collection(value)
    ? library
    : primitive_root(library.at(["__hson_inspector_value__"]) as unknown as LiveMapPathHandle);
  return create_live_inspector({ ...inspectorOptions, source }, { origin });
}

/** Canonical experimental structured-data inspection facade. */
export const hsonInspect = Object.freeze({
  create(options: LiveInspectorOptions): LiveInspector {
    return create_live_inspector(options);
  },
  fromJson(options: LiveInspectorOwnedJsonOptions): LiveInspector {
    return inspect_owned_json(options, "json");
  },
  fromHson(options: LiveInspectorOwnedHsonOptions): LiveInspector {
    const { value, ...inspectorOptions } = options;
    return inspect_owned_json({ ...inspectorOptions, value: hsonTransform.fromHson(value).toJson().value() }, "hson");
  },
});
