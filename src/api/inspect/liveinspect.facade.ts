import type {
  LiveInspector,
  LiveInspectorOptions,
  LiveInspectorOwnedHsonOptions,
  LiveInspectorOwnedJsonOptions,
} from "../../types/liveinspect.types.js";
import { hsonLiveMap } from "../livemap/livemap.facade.js";
import { ANY_DATA } from "../schema/hson-schema.js";
import { hsonTransform } from "../transform/transform.facade.js";
import { create_live_inspector } from "./liveinspect.js";

function inspect_owned_json(options: LiveInspectorOwnedJsonOptions, origin: "json" | "hson"): LiveInspector {
  const { value, ...inspectorOptions } = options;
  const data = typeof value === "string" ? JSON.stringify(value) : value;
  const ownedMap = hsonLiveMap.fromLibraries({ source: { data, schema: ANY_DATA } });
  return create_live_inspector({ ...inspectorOptions, source: ownedMap.lib("source") }, { origin });
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
