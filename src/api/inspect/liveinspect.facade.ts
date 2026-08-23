import type { JsonValue } from "../../core/types.js";
import type { LiveMapPathHandle } from "../../types/livemap.types.js";
import type {
  LiveInspector,
  LiveInspectorOptions,
  LiveInspectorOwnedHsonOptions,
  LiveInspectorOwnedJsonOptions,
} from "../../types/liveinspect.types.js";
import { hsonLiveMap } from "../livemap/livemap.facade.js";
import { make_livemap_core } from "../livemap/livemap.core.js";
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

/** Canonical experimental structured-data inspection facade. */
export const hsonInspect = Object.freeze({
  create(options: LiveInspectorOptions): LiveInspector {
    return create_live_inspector(options);
  },
  fromJson(options: LiveInspectorOwnedJsonOptions): LiveInspector {
    const { value, ...inspectorOptions } = options;
    const ownedMap = is_root_collection(value)
      ? hsonLiveMap.fromJson(value)
      : hsonLiveMap.fromJson({ __hson_inspector_value__: value });
    const source = is_root_collection(value)
      ? ownedMap
      : primitive_root(ownedMap.at(["__hson_inspector_value__"]));
    return create_live_inspector(
      { ...inspectorOptions, source },
      { origin: "json" },
    );
  },
  fromHson(options: LiveInspectorOwnedHsonOptions): LiveInspector {
    const { value, ...inspectorOptions } = options;
    return create_live_inspector(
      {
        ...inspectorOptions,
        source: make_livemap_core(hsonTransform.fromHson(value).toNode()),
      },
      { origin: "hson" },
    );
  },
});
