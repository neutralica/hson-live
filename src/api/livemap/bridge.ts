// LiveMap ↔ LiveTree bridge helpers.
//
// Snap renderers perform one-time projection from LiveMap state into LiveTree.
// Bindings subscribe LiveTree targets to LiveMap paths and return explicit disposers.

import type { JsonValue } from "../../core/types.js";
import type { LiveMap, LivePath } from "./livemap.types.js";

export type LiveMapBridgeBinding = Readonly<{
  dispose: () => void;
}>;

// LiveTree targets are narrow structural contracts. They name the small LiveTree
// surfaces the bridge consumes without requiring callers to pass a concrete
// LiveTree class.

export type LiveTextBridgeTarget = Readonly<{
  text: Readonly<{
    get: () => string;
    set: (value: string) => unknown;
    overwrite: (value: string) => unknown;
  }>;
}>;

export type LiveContentBridgeTarget = Readonly<{
  content: Readonly<{
    markup: Readonly<{
      innerHTML: string;
    }>;
  }>;
}>;

export type LiveCreateDivBridgeTarget = Readonly<{
  create: Readonly<{
    div: () => LiveSnapViewBridgeTarget;
  }>;
}>;

export type LiveSnapViewBridgeTarget = LiveContentBridgeTarget &
  LiveCreateDivBridgeTarget &
  LiveTextBridgeTarget &
  LiveAttrBridgeTarget;

export type LiveAttrBridgeTarget = Readonly<{
  attr: Readonly<{
    get: (name: string) => string | undefined;
    set: (name: string, value: string) => unknown;
    drop: (name: string) => unknown;
  }>;
}>;

export type LiveInputListenerResult = Readonly<{
  off: () => void;
  count: number;
  ok: boolean;
}>;

export type LiveInputBridgeTarget = Readonly<{
  form: Readonly<{
    getValue: () => JsonValue | undefined;
    setValue: (value: JsonValue, options?: { silent?: boolean }) => unknown;
  }>;
  listen: Readonly<{
    onInput: (listener: () => void) => LiveInputListenerResult;
  }>;
}>;

// Preserve the current LiveMap primitive kind when possible. Form APIs surface
// user input as display values, while LiveMap remains the state authority.
function coerce_input_value(value: JsonValue | undefined, current: JsonValue | undefined): JsonValue {
  if (typeof current === "number") {
    const next = Number(value);
    return Number.isFinite(next) ? next : value_to_text(value);
  }

  if (typeof current === "boolean") return value === true || value === "true";
  if (current === null && value === "null") return null;
  return value ?? "";
}

function value_to_text(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function render_livemap_snap(map: LiveMap, tree: LiveTextBridgeTarget, path: LivePath = []): void {
  tree.text.set(value_to_text(map.snap(path)));
}

export function render_livemap_snap_view(map: LiveMap, tree: LiveSnapViewBridgeTarget, path: LivePath = []): void {
  tree.text.overwrite("");
  render_snap_value(tree, map.snap(path), snap_path_parts(path));
}

function snap_path_parts(path: LivePath): readonly string[] {
  return path.map((part) => String(part));
}

function render_snap_value(tree: LiveSnapViewBridgeTarget, value: JsonValue | undefined, path: readonly string[]): void {
  tree.attr.set("data-livemap-snap-path", path.join("."));

  if (Array.isArray(value)) {
    tree.attr.set("data-livemap-snap-kind", "array");
    render_snap_array(tree, value, path);
    return;
  }

  if (is_json_object(value)) {
    tree.attr.set("data-livemap-snap-kind", "object");
    render_snap_object(tree, value, path);
    return;
  }

  tree.attr.set("data-livemap-snap-kind", primitive_snap_kind(value));
  tree.text.set(value_to_text(value));
}

function render_snap_object(
  tree: LiveSnapViewBridgeTarget,
  value: Readonly<Record<string, JsonValue>>,
  path: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    const row = tree.create.div();
    row.attr.set("data-livemap-snap-key", key);

    const label = row.create.div();
    label.attr.set("data-livemap-snap-role", "key");
    label.text.set(key);

    const child = row.create.div();
    child.attr.set("data-livemap-snap-role", "value");
    render_snap_value(child, value[key], [...path, key]);
  }
}

function render_snap_array(tree: LiveSnapViewBridgeTarget, value: readonly JsonValue[], path: readonly string[]): void {
  value.forEach((item, index) => {
    const row = tree.create.div();
    row.attr.set("data-livemap-snap-index", String(index));

    const label = row.create.div();
    label.attr.set("data-livemap-snap-role", "index");
    label.text.set(String(index));

    const child = row.create.div();
    child.attr.set("data-livemap-snap-role", "value");
    render_snap_value(child, item, [...path, String(index)]);
  });
}

function is_json_object(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function primitive_snap_kind(value: JsonValue | undefined): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return typeof value;
}

export function bind_livetree_text(map: LiveMap, path: LivePath, tree: LiveTextBridgeTarget): LiveMapBridgeBinding {
  const sync = (value: JsonValue | undefined) => {
    tree.text.set(value_to_text(value));
  };

  sync(map.snap(path));
  const dispose = map.sub.path(path, sync);

  return { dispose };
}

export function bind_livetree_attr(
  map: LiveMap,
  path: LivePath,
  tree: LiveAttrBridgeTarget,
  name: string,
): LiveMapBridgeBinding {
  const sync = (value: JsonValue | undefined) => {
    if (value === false || value === null || value === undefined) {
      tree.attr.drop(name);
      return;
    }

    tree.attr.set(name, value_to_text(value));
  };

  sync(map.snap(path));
  const dispose = map.sub.path(path, sync);

  return { dispose };
}

export function bind_livetree_input_value(
  tree: LiveInputBridgeTarget,
  map: LiveMap,
  path: LivePath,
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

  return {
    dispose: () => {
      inputListener.off();
      disposePath();
    },
  };
}
