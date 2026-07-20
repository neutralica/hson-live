
/* ***DO NOT IMPORT FROM bridge.ts - keep deps one-way*** */

import type { JsonValue } from "../../core/types.js";
import type { LiveTextBridgeTarget, LiveMapBridgeBinding, LiveAttrBridgeTarget, LiveInputBridgeTarget, LiveMapSchemaControlNode } from "../../types/bridge.types.js";
import type { LiveMap, LivePath } from "../../types/livemap.types.js";
import { own_disposable_for_owner } from "../livetree/managers/lifecycle-registry.js";

// bridge-bindings.ts
//
// Bindings sync an initial value, subscribe to later LiveMap changes, and return
// explicit disposers. Form bindings also write user edits back into LiveMap.
// Schema validation bindings belong here because they control writeback.
// Subscribed primitive bindings


// Preserve the current LiveMap primitive kind when possible. Form APIs surface
// user input as display values, while LiveMap remains the state authority.
export function coerce_input_value(value: JsonValue | undefined, current: JsonValue | undefined): JsonValue {
  if (typeof current === "number") {
    const next = Number(value);
    return Number.isFinite(next) ? next : value_to_text(value);
  }

  if (typeof current === "boolean") return value === true || value === "true";
  if (current === null && value === "null") return null;
  return value ?? "";
}

export function bind_livetree_text(map: LiveMap, path: LivePath, tree: LiveTextBridgeTarget): LiveMapBridgeBinding {
  const sync = (value: JsonValue | undefined) => {
    tree.text.set(value_to_text(value));
  };

  sync(map.snap(path));
  const dispose = map.sub.path(path, sync);

  return owned_bridge_binding(tree, dispose);
}

export function bind_livetree_attr(
  map: LiveMap,
  path: LivePath,
  tree: LiveAttrBridgeTarget,
  name: string
): LiveMapBridgeBinding {
  const sync = (value: JsonValue | undefined) => {
    if (value === false || value === null || value === undefined) {
      tree.attrs.drop(name);
      return;
    }

    tree.attrs.set(name, value_to_text(value));
  };

  sync(map.snap(path));
  const dispose = map.sub.path(path, sync);

  return owned_bridge_binding(tree, dispose);
}

export function bind_livetree_input_value(
  tree: LiveInputBridgeTarget,
  map: LiveMap,
  path: LivePath
): LiveMapBridgeBinding {
  let isSyncingFromMap = false;

  const syncFromMap = (value: JsonValue | undefined) => {
    isSyncingFromMap = true;
    tree.form.setValue(value_to_text(value), { silent: true });
    isSyncingFromMap = false;
  };

  const syncToMap = () => {
    if (isSyncingFromMap) return;
    map.set(path, coerce_input_value(tree.form.getValue(), map.snap(path)));
  };

  syncFromMap(map.snap(path));
  const disposePath = map.sub.path(path, syncFromMap);
  const inputListener = tree.listen.onInput(syncToMap);

  return owned_bridge_binding(tree, () => {
    inputListener.off();
    disposePath();
  });
}

export function bind_livetree_input_checked(
  tree: LiveInputBridgeTarget,
  map: LiveMap,
  path: LivePath
): LiveMapBridgeBinding {
  if (tree.form.getChecked === undefined || tree.form.setChecked === undefined) {
    return bind_livetree_input_value(tree, map, path);
  }

  let isSyncingFromMap = false;

  const syncFromMap = (value: JsonValue | undefined) => {
    isSyncingFromMap = true;
    tree.form.setChecked?.(value === true, { silent: true });
    isSyncingFromMap = false;
  };

  const syncToMap = () => {
    if (isSyncingFromMap) return;
    map.set(path, tree.form.getChecked?.() === true);
  };

  syncFromMap(map.snap(path));
  const disposePath = map.sub.path(path, syncFromMap);
  const inputListener = tree.listen.onInput(syncToMap);

  return owned_bridge_binding(tree, () => {
    inputListener.off();
    disposePath();
  });
}

export function bind_livetree_schema_number_input(
  tree: LiveInputBridgeTarget & LiveAttrBridgeTarget,
  map: LiveMap,
  path: LivePath,
  schema: LiveMapSchemaControlNode | undefined
): LiveMapBridgeBinding {
  let isSyncingFromMap = false;

  const markValid = () => {
    tree.attrs.set("data-livemap-control-valid", "true");
    tree.attrs.drop("data-livemap-control-error");
  };

  const markInvalid = (message: string) => {
    tree.attrs.set("data-livemap-control-valid", "false");
    tree.attrs.set("data-livemap-control-error", message);
  };

  const syncFromMap = (value: JsonValue | undefined) => {
    isSyncingFromMap = true;
    tree.form.setValue(value_to_text(value), { silent: true });
    isSyncingFromMap = false;
  };

  const syncToMap = () => {
    if (isSyncingFromMap) return;

    const next = Number(tree.form.getValue());
    if (!Number.isFinite(next)) {
      markInvalid("Expected finite number");
      return;
    }

    if (schema?.min !== undefined && next < schema.min) {
      markInvalid(`Expected number >= ${schema.min}`);
      return;
    }

    if (schema?.max !== undefined && next > schema.max) {
      markInvalid(`Expected number <= ${schema.max}`);
      return;
    }

    markValid();
    map.set(path, next);
  };

  syncFromMap(map.snap(path));
  const disposePath = map.sub.path(path, syncFromMap);
  const inputListener = tree.listen.onInput(syncToMap);

  return owned_bridge_binding(tree, () => {
    inputListener.off();
    disposePath();
  });
}

export function bind_livetree_schema_enum_input(
  tree: LiveInputBridgeTarget & LiveAttrBridgeTarget,
  map: LiveMap,
  path: LivePath,
  schema: LiveMapSchemaControlNode | undefined
): LiveMapBridgeBinding {
  let isSyncingFromMap = false;

  const markValid = () => {
    tree.attrs.set("data-livemap-control-valid", "true");
    tree.attrs.drop("data-livemap-control-error");
  };

  const markInvalid = (message: string) => {
    tree.attrs.set("data-livemap-control-valid", "false");
    tree.attrs.set("data-livemap-control-error", message);
  };

  const choices = schema?.choices ?? [];
  const expected = choices.join(", ");

  const syncFromMap = (value: JsonValue | undefined) => {
    isSyncingFromMap = true;
    tree.form.setValue(value_to_text(value), { silent: true });
    isSyncingFromMap = false;
  };

  const syncToMap = () => {
    if (isSyncingFromMap) return;

    const next = value_to_text(tree.form.getValue());
    if (!choices.includes(next)) {
      markInvalid(`Expected one of: ${expected}`);
      return;
    }

    markValid();
    map.set(path, next);
  };

  syncFromMap(map.snap(path));
  const disposePath = map.sub.path(path, syncFromMap);
  const inputListener = tree.listen.onInput(syncToMap);

  return owned_bridge_binding(tree, () => {
    inputListener.off();
    disposePath();
  });
}

function owned_bridge_binding(target: object, dispose: () => void): LiveMapBridgeBinding {
  if (!("quid" in target) || typeof target.quid !== "string" || target.quid.length === 0) {
    return { dispose };
  }

  return {
    dispose: own_disposable_for_owner(target.quid, dispose, "binding"),
  };
}

export function value_to_text(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
